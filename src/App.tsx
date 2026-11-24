import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import openMeteoCoastal from './test/fixtures/openMeteoCoastal.json';
import openMeteoInland from './test/fixtures/openMeteoInland.json';
import marineCoastal from './test/fixtures/marineCoastal.json';
import marineInland from './test/fixtures/marineInland.json';
import {
  GlobalErrorBoundary,
  ModuleErrorBoundary,
  ToastContainer,
} from './components/common';
import { FieldDataTab } from './components/field';
import { ForecastTab } from './components/forecast';
import { AppShell, type AppTabId } from './components/layout';
import { MapRadarTab } from './components/map';
import {
  buildLocationKey,
  checkIndexedDbHealth,
  clearErrorLogs,
  DEFAULT_SAVED_LOCATIONS,
  deleteSavedLocation,
  ensureDefaultSavedLocations,
  getCachedForecast,
  getRecentErrorLogs,
  getSavedLocations,
  getTrackSessions,
  getWaypoints,
  loadPrimaryLocationPreference,
  logErrorToDb,
  renameSavedLocation,
  resetDatabaseForTests,
  saveForecastCache,
  savePrimaryLocationPreference,
  toggleFavoriteLocation,
  upsertSavedLocation,
} from './db/database';
import { useSmartLocation } from './hooks/useSmartLocation';
import { useTheme } from './hooks/useTheme';
import { useToast } from './hooks/useToast';
import {
  probeIpWhoisHealth,
  probeNominatimHealth,
  searchLocationsNominatim,
} from './services/geocodingService';
import {
  getEndpointHealthSnapshot,
  getOverallEndpointsHealthLevel,
} from './services/httpClient';
import { evaluateDueRecurrenceRules } from './services/historicalWeatherService';
import {
  fetchOpenMeteoForecast,
  normalizeOpenMeteoForecast,
  reapplyThresholdsToForecast,
} from './services/openMeteoService';
import { probeRainViewerHealth } from './services/rainViewerService';
import { detectRuntimePlatform } from './services/platform';
import type {
  ActiveCoordinates,
  PrimaryLocationPreference,
  SavedLocation,
  TrackSession,
  Waypoint,
} from './types/field';
import type {
  ErrorLogRecord,
  HealthCheckSnapshot,
  HealthLevel,
} from './types/health';
import {
  type NominatimResult,
  SafeWindowThresholdsSchema,
} from './types/schemas';
import {
  DEFAULT_SAFE_WINDOW_THRESHOLDS,
  type ForecastViewMode,
  type NormalizedForecast,
  type SafeWindowThresholds,
} from './types/weather';
import { haversineDistanceKm } from './utils/exporters';

const THRESHOLDS_STORAGE_KEY = 'fieldcast_safe_window_thresholds';

const OFFLINE_REFERENCE_CATALOG: ReadonlyArray<{
  place_id: number;
  name: string;
  display_name: string;
  latitude: number;
  longitude: number;
  type: string;
}> = [
  {
    place_id: 9001,
    name: 'Florianópolis — SC (Costeiro)',
    display_name: 'Florianópolis, Santa Catarina, Região Sul, Brasil',
    latitude: -27.5954,
    longitude: -48.548,
    type: 'city',
  },
  {
    place_id: 9002,
    name: 'Brasília — DF (Continental)',
    display_name: 'Brasília, Distrito Federal, Região Centro-Oeste, Brasil',
    latitude: -15.7939,
    longitude: -47.8828,
    type: 'city',
  },
  {
    place_id: 9003,
    name: 'Rio de Janeiro — RJ (Baía de Guanabara)',
    display_name: 'Rio de Janeiro, Rio de Janeiro, Região Sudeste, Brasil',
    latitude: -22.9068,
    longitude: -43.1729,
    type: 'city',
  },
  {
    place_id: 9004,
    name: 'Santos — SP (Porto Costeiro)',
    display_name: 'Santos, São Paulo, Região Sudeste, Brasil',
    latitude: -23.9608,
    longitude: -46.3336,
    type: 'city',
  },
  {
    place_id: 9005,
    name: 'Ilhabela — SP (Canal de São Sebastião)',
    display_name: 'Ilhabela, Litoral Norte, São Paulo, Brasil',
    latitude: -23.7785,
    longitude: -45.3581,
    type: 'island',
  },
  {
    place_id: 9006,
    name: 'Paranaguá — PR (Baía de Paranaguá)',
    display_name: 'Paranaguá, Paraná, Região Sul, Brasil',
    latitude: -25.5161,
    longitude: -48.5225,
    type: 'city',
  },
  {
    place_id: 9007,
    name: 'Salvador — BA (Baía de Todos-os-Santos)',
    display_name: 'Salvador, Bahia, Região Nordeste, Brasil',
    latitude: -12.9714,
    longitude: -38.5014,
    type: 'city',
  },
  {
    place_id: 9008,
    name: 'Recife — PE (Costeiro)',
    display_name: 'Recife, Pernambuco, Região Nordeste, Brasil',
    latitude: -8.0476,
    longitude: -34.877,
    type: 'city',
  },
];

function loadPersistedThresholds(): SafeWindowThresholds {
  if (typeof window === 'undefined') {
    return DEFAULT_SAFE_WINDOW_THRESHOLDS;
  }
  try {
    const raw = window.localStorage.getItem(THRESHOLDS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SAFE_WINDOW_THRESHOLDS;
    }
    const parsed = SafeWindowThresholdsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SAFE_WINDOW_THRESHOLDS;
  } catch {
    return DEFAULT_SAFE_WINDOW_THRESHOLDS;
  }
}

function persistThresholds(thresholds: SafeWindowThresholds): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(thresholds));
  } catch {
    // Ignora falha de localStorage em modo privado restrito
  }
}

/**
 * Determina se uma coordenada corresponde a um ponto continental (ex.: Brasília / Planalto Central)
 * para selecionar o fixture offline adequado (`openMeteoInland` vs `openMeteoCoastal`).
 */
export function isCoordinateInlandFixtureTarget(latitude: number, longitude: number): boolean {
  const distToBrasiliaKm = haversineDistanceKm(latitude, longitude, -15.7939, -47.8828);
  const distToFlorianopolisKm = haversineDistanceKm(latitude, longitude, -27.5954, -48.548);
  if (distToBrasiliaKm <= 350) {
    return true;
  }
  if (distToFlorianopolisKm <= 350) {
    return false;
  }
  // Heurística geográfica para o interior continental brasileiro vs costa atlântica
  return longitude < -46.8 && latitude > -23.5;
}

/**
 * Constrói uma previsão normalizada (`NormalizedForecast`) a partir dos fixtures reais de 48h
 * (`openMeteoCoastal`/`marineCoastal` ou `openMeteoInland`/`marineInland`) para garantir
 * resiliência absoluta em cold-boot offline ou navegador sandboxed sem rede.
 */
export function buildBundledFallbackForecast(
  latitude: number,
  longitude: number,
  thresholds: SafeWindowThresholds = DEFAULT_SAFE_WINDOW_THRESHOLDS,
  fetchedAtIso: string = new Date().toISOString(),
): NormalizedForecast {
  const useInland = isCoordinateInlandFixtureTarget(latitude, longitude);
  const baseForecast = useInland ? openMeteoInland : openMeteoCoastal;
  const baseMarine = useInland ? marineInland : marineCoastal;

  const normalized = normalizeOpenMeteoForecast({
    forecastRaw: {
      ...baseForecast,
      latitude,
      longitude,
    },
    marineRaw: {
      ...baseMarine,
      latitude,
      longitude,
    },
    isContinental: useInland,
    marineApiError: false,
    thresholds,
    fetchedAtIso,
    fromCache: true,
    cacheAgeMinutes: 0,
    interpolationActive: true,
  });

  return {
    ...normalized,
    locationKey: buildLocationKey(latitude, longitude),
    latitude,
    longitude,
    fromCache: true,
  };
}

/**
 * Garante que os dois pontos padrão (Florianópolis Costeiro e Brasília Continental)
 * possuam previsão em cache no Dexie desde o primeiro boot para funcionamento 100% offline.
 */
async function ensureBundledForecastCacheSeeded(
  thresholds: SafeWindowThresholds,
): Promise<void> {
  const coastalLoc = DEFAULT_SAVED_LOCATIONS[0]!;
  const inlandLoc = DEFAULT_SAVED_LOCATIONS[1]!;

  const [existingCoastal, existingInland] = await Promise.all([
    getCachedForecast(coastalLoc.latitude, coastalLoc.longitude, 5),
    getCachedForecast(inlandLoc.latitude, inlandLoc.longitude, 5),
  ]);

  const nowMs = Date.now();
  if (!existingInland) {
    const inlandForecast = buildBundledFallbackForecast(
      inlandLoc.latitude,
      inlandLoc.longitude,
      thresholds,
      new Date(nowMs - 2000).toISOString(),
    );
    await saveForecastCache(inlandForecast);
  }

  if (!existingCoastal) {
    const coastalForecast = buildBundledFallbackForecast(
      coastalLoc.latitude,
      coastalLoc.longitude,
      thresholds,
      new Date(nowMs - 1000).toISOString(),
    );
    await saveForecastCache(coastalForecast);
  }
}

export function App(): React.ReactElement {
  const { theme, isDark, toggleTheme } = useTheme('dark');
  const { toasts, addToast, dismissToast } = useToast();

  const [activeTab, setActiveTab] = useState<AppTabId>('forecast');
  const [viewMode, setViewMode] = useState<ForecastViewMode>('fieldcast');
  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState<boolean>(false);

  const [thresholds, setThresholds] = useState<SafeWindowThresholds>(() =>
    loadPersistedThresholds(),
  );

  const [primaryLocation, setPrimaryLocation] = useState<PrimaryLocationPreference | null>(() =>
    loadPrimaryLocationPreference(),
  );

  const initialStartupCoords = useMemo<ActiveCoordinates>(() => {
    const persistedPrimary = loadPrimaryLocationPreference();
    if (persistedPrimary) {
      return {
        latitude: persistedPrimary.latitude,
        longitude: persistedPrimary.longitude,
        accuracyM: null,
        name: persistedPrimary.name,
        origin: persistedPrimary.origin,
        isApproximateIp: persistedPrimary.origin === 'ip',
        updatedAtIso: persistedPrimary.updatedAtIso,
      };
    }
    return {
      latitude: DEFAULT_SAVED_LOCATIONS[0]!.latitude,
      longitude: DEFAULT_SAVED_LOCATIONS[0]!.longitude,
      accuracyM: null,
      name: DEFAULT_SAVED_LOCATIONS[0]!.name,
      origin: 'saved',
      isApproximateIp: false,
      updatedAtIso: new Date().toISOString(),
    };
  }, []);

  // Inicializa sincronamente com a área principal persistida (ou fallback costeiro) para zero tela vazia
  const [forecast, setForecast] = useState<NormalizedForecast | null>(() =>
    buildBundledFallbackForecast(
      initialStartupCoords.latitude,
      initialStartupCoords.longitude,
      loadPersistedThresholds(),
    ),
  );
  const [isRefreshingForecast, setIsRefreshingForecast] = useState<boolean>(false);

  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(
    DEFAULT_SAVED_LOCATIONS,
  );
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [tracks, setTracks] = useState<TrackSession[]>([]);
  const [indexedDbOk, setIndexedDbOk] = useState<boolean>(true);
  const [recentErrors, setRecentErrors] = useState<ErrorLogRecord[]>([]);
  const [healthCheckedAtIso, setHealthCheckedAtIso] = useState<string>(() =>
    new Date().toISOString(),
  );
  const [healthTick, setHealthTick] = useState<number>(0);

  const thresholdsRef = useRef<SafeWindowThresholds>(thresholds);
  thresholdsRef.current = thresholds;

  const hasUserSelectedLocationRef = useRef<boolean>(false);
  const activeFetchRequestIdRef = useRef<number>(0);

  const {
    activeLocation,
    gpsStatus,
    resolveLocation,
    setManualLocation,
  } = useSmartLocation({
    autoResolveOnMount: false,
    timeoutMs: 3500,
    initialCoordinates: initialStartupCoords,
  });

  const refreshHealthMetrics = useCallback(async () => {
    const [idbHealthy, errors] = await Promise.all([
      checkIndexedDbHealth(),
      getRecentErrorLogs(50),
    ]);
    setIndexedDbOk(idbHealthy);
    setRecentErrors(errors);
    setHealthCheckedAtIso(new Date().toISOString());
    setHealthTick((prev) => prev + 1);
  }, []);

  const handleErrorLog = useCallback(
    async (record: ErrorLogRecord) => {
      await logErrorToDb({
        timestampUtcIso: record.timestampUtcIso,
        module: record.module,
        action: record.action,
        message: record.message,
        stack: record.stack,
      });
      await refreshHealthMetrics();
    },
    [refreshHealthMetrics],
  );

  /**
   * Carrega previsão multi-modelo + oceanográfica para uma coordenada:
   * 1. Exibe imediatamente o cache local ou fixture correspondente (Stale-While-Revalidate).
   * 2. Tenta atualizar via rede com Circuit Breaker (`fetchOpenMeteoForecast`).
   * 3. Caso o navegador esteja offline/sandboxed, mantém a previsão normalizada do cache/fixture com `fromCache: true`.
   */
  const loadForecastForCoordinates = useCallback(
    async (
      latitude: number,
      longitude: number,
      options?: { silent?: boolean; forceNetwork?: boolean },
    ): Promise<NormalizedForecast> => {
      const requestId = ++activeFetchRequestIdRef.current;
      const currentThresholds = thresholdsRef.current;

      setIsRefreshingForecast(true);

      // Passo 1: Carregamento instantâneo via cache exato ou fixture (zero bloqueio visual)
      try {
        await ensureBundledForecastCacheSeeded(currentThresholds);
        const exactCached = await getCachedForecast(latitude, longitude, 15);
        if (requestId === activeFetchRequestIdRef.current) {
          if (exactCached) {
            const withThresholds = reapplyThresholdsToForecast(
              { ...exactCached.forecast, fromCache: true },
              currentThresholds,
            );
            setForecast(withThresholds);
          } else {
            const immediateFallback = buildBundledFallbackForecast(
              latitude,
              longitude,
              currentThresholds,
            );
            await saveForecastCache(immediateFallback);
            setForecast(immediateFallback);
          }
        }
      } catch {
        // Continua para tentativa de rede
      }

      // Passo 2: Tentativa de atualização na API real Open-Meteo Forecast + Marine
      try {
        const fetched = await fetchOpenMeteoForecast(latitude, longitude, {
          thresholds: currentThresholds,
          forecastDays: 7,
          interpolationActive: true,
          timeoutMs: 4500,
          maxRetries: 1,
          backoffBaseMs: 200,
        });

        // Se retornou do fallback de cache no `fetchOpenMeteoForecast`, garante que corresponde à coordenada solicitada
        const distFromRequestedKm = haversineDistanceKm(
          latitude,
          longitude,
          fetched.latitude,
          fetched.longitude,
        );

        let finalForecast = fetched;
        if (fetched.fromCache && distFromRequestedKm > 15) {
          finalForecast = buildBundledFallbackForecast(
            latitude,
            longitude,
            currentThresholds,
          );
          await saveForecastCache(finalForecast);
        }

        if (requestId === activeFetchRequestIdRef.current) {
          setForecast(finalForecast);

          // Atualiza a altitude DEM do local salvo caso corresponda a um ponto favorito
          const currentSaved = await getSavedLocations();
          const matchingSaved = currentSaved.find(
            (loc) =>
              Math.abs(loc.latitude - latitude) < 0.002 &&
              Math.abs(loc.longitude - longitude) < 0.002,
          );
          if (
            matchingSaved &&
            matchingSaved.elevationM !== finalForecast.elevationDemM
          ) {
            await upsertSavedLocation({
              ...matchingSaved,
              elevationM: finalForecast.elevationDemM,
            });
            setSavedLocations(await getSavedLocations());
          }

          if (!options?.silent && options?.forceNetwork) {
            addToast({
              type: finalForecast.fromCache ? 'info' : 'success',
              title: finalForecast.fromCache
                ? 'Modo Offline — Previsão carregada do cache local'
                : 'Previsão 168h atualizada com sucesso',
              message: `DEM ${Math.round(finalForecast.elevationDemM)}m • Confiança ${finalForecast.overallConfidence.total}/100`,
            });
          }
        }

        return finalForecast;
      } catch {
        const fallback = buildBundledFallbackForecast(
          latitude,
          longitude,
          currentThresholds,
        );
        await saveForecastCache(fallback);

        if (requestId === activeFetchRequestIdRef.current) {
          setForecast(fallback);
          if (!options?.silent && options?.forceNetwork) {
            addToast({
              type: 'warning',
              title: 'Modo Offline Ativo',
              message:
                'Sem conexão com a Open-Meteo. Exibindo previsão consolidada do cache offline.',
            });
          }
        }
        return fallback;
      } finally {
        if (requestId === activeFetchRequestIdRef.current) {
          setIsRefreshingForecast(false);
        }
        await refreshHealthMetrics();
      }
    },
    [addToast, refreshHealthMetrics],
  );

  // Inicialização principal do banco Dexie, pontos salvos, waypoints, trilhas e previsão inicial
  useEffect(() => {
    let cancelled = false;

    const bootstrapApp = async () => {
      try {
        await ensureBundledForecastCacheSeeded(thresholdsRef.current);
        const [initialSaved, initialWaypoints, initialTracks] = await Promise.all([
          ensureDefaultSavedLocations(),
          getWaypoints(),
          getTrackSessions(),
        ]);

        if (cancelled) return;
        setSavedLocations(initialSaved);
        setWaypoints(initialWaypoints);
        setTracks(initialTracks);

        if (!hasUserSelectedLocationRef.current) {
          const persistedPrimary = loadPrimaryLocationPreference();
          const defaultLoc = persistedPrimary
            ? {
                latitude: persistedPrimary.latitude,
                longitude: persistedPrimary.longitude,
                name: persistedPrimary.name,
                origin: persistedPrimary.origin,
              }
            : (() => {
                const fallbackSaved =
                  initialSaved.find((loc) => loc.id === 'loc-florianopolis-sc') ??
                  initialSaved[0] ??
                  DEFAULT_SAVED_LOCATIONS[0]!;
                return {
                  latitude: fallbackSaved.latitude,
                  longitude: fallbackSaved.longitude,
                  name: fallbackSaved.name,
                  origin: 'saved' as const,
                };
              })();

          setManualLocation({
            latitude: defaultLoc.latitude,
            longitude: defaultLoc.longitude,
            name: defaultLoc.name,
            origin: defaultLoc.origin,
          });
          await loadForecastForCoordinates(defaultLoc.latitude, defaultLoc.longitude, {
            silent: true,
          });
        }

        // Verifica regras de recorrência semanal vencidas sem bloquear a tela inicial
        void evaluateDueRecurrenceRules().then(({ generatedLogs }) => {
          if (!cancelled && generatedLogs.length > 0) {
            addToast({
              type: 'info',
              title: 'Log histórico periódico atualizado',
              message: `${generatedLogs.length} relatório(s) semanal(is) pronto(s) em Campo & Dados.`,
            });
          }
        });
      } catch (err) {
        await handleErrorLog({
          timestampUtcIso: new Date().toISOString(),
          module: 'AppBootstrap',
          action: 'bootstrapApp',
          message:
            err instanceof Error ? err.message : 'Erro ao inicializar armazenamento Dexie',
        });
      } finally {
        if (!cancelled) {
          await refreshHealthMetrics();
        }
      }
    };

    void bootstrapApp();

    return () => {
      cancelled = true;
    };
  }, [handleErrorLog, loadForecastForCoordinates, refreshHealthMetrics]);

  // Handlers de Pontos Salvos & Geolocalização
  const handleSelectLocation = useCallback(
    async (coords: {
      latitude: number;
      longitude: number;
      name: string;
      origin?: ActiveCoordinates['origin'];
    }) => {
      hasUserSelectedLocationRef.current = true;
      const origin = coords.origin ?? 'saved';
      setManualLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        name: coords.name,
        origin,
      });

      // Atualiza lastUsedAtIso se o ponto pertencer aos favoritos salvos
      const allSaved = await getSavedLocations();
      const matched = allSaved.find(
        (item) =>
          Math.abs(item.latitude - coords.latitude) < 0.001 &&
          Math.abs(item.longitude - coords.longitude) < 0.001,
      );
      if (matched) {
        await upsertSavedLocation({
          ...matched,
          lastUsedAtIso: new Date().toISOString(),
        });
        setSavedLocations(await getSavedLocations());
      }

      await loadForecastForCoordinates(coords.latitude, coords.longitude, {
        silent: false,
        forceNetwork: true,
      });
    },
    [loadForecastForCoordinates, setManualLocation],
  );

  const handleSaveLocation = useCallback(
    async (locInput: {
      name: string;
      latitude: number;
      longitude: number;
      region?: string;
      isFavorite?: boolean;
    }) => {
      const nowIso = new Date().toISOString();
      const allSaved = await getSavedLocations();
      const existing = allSaved.find(
        (item) =>
          Math.abs(item.latitude - locInput.latitude) < 0.001 &&
          Math.abs(item.longitude - locInput.longitude) < 0.001,
      );

      const elevationFromCurrent =
        forecast &&
        Math.abs(forecast.latitude - locInput.latitude) < 0.01 &&
        Math.abs(forecast.longitude - locInput.longitude) < 0.01
          ? forecast.elevationDemM
          : existing?.elevationM;

      const record: SavedLocation = {
        id:
          existing?.id ??
          `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: locInput.name.trim() || 'Ponto Salvo',
        latitude: locInput.latitude,
        longitude: locInput.longitude,
        elevationM: elevationFromCurrent,
        region: locInput.region ?? existing?.region ?? 'Ponto Operacional Salvo',
        isFavorite: locInput.isFavorite ?? true,
        createdAtIso: existing?.createdAtIso ?? nowIso,
        lastUsedAtIso: nowIso,
      };

      await upsertSavedLocation(record);
      setSavedLocations(await getSavedLocations());
    },
    [forecast],
  );

  const handleRenameLocation = useCallback(
    async (id: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;

      const target = savedLocations.find((l) => l.id === id);
      await renameSavedLocation(id, trimmed);
      const updatedList = await getSavedLocations();
      setSavedLocations(updatedList);

      if (
        target &&
        Math.abs(target.latitude - activeLocation.latitude) < 0.001 &&
        Math.abs(target.longitude - activeLocation.longitude) < 0.001
      ) {
        setManualLocation({
          latitude: activeLocation.latitude,
          longitude: activeLocation.longitude,
          name: trimmed,
          origin: activeLocation.origin,
          accuracyM: activeLocation.accuracyM,
        });
      }
    },
    [activeLocation, savedLocations, setManualLocation],
  );

  const handleToggleFavoriteLocation = useCallback(async (id: string) => {
    await toggleFavoriteLocation(id);
    setSavedLocations(await getSavedLocations());
  }, []);

  const handleDeleteLocation = useCallback(async (id: string) => {
    await deleteSavedLocation(id);
    setSavedLocations(await getSavedLocations());
  }, []);

  const handleSearchQuery = useCallback(
    async (query: string): Promise<NominatimResult[]> => {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return [];
      }

      try {
        const liveResults = await searchLocationsNominatim(query, {
          limit: 6,
          timeoutMs: 5000,
          maxRetries: 1,
        });
        await refreshHealthMetrics();
        if (liveResults.length > 0) {
          return liveResults.map((item, idx) => ({
            place_id: idx + 1,
            lat: String(item.latitude),
            lon: String(item.longitude),
            display_name: item.displayName,
            name: item.name,
            type: item.type,
          }));
        }
      } catch {
        // Fallback offline automático: pesquisa nos locais salvos e catálogo offline de referência
        await refreshHealthMetrics();
      }

      const offlineMatches: NominatimResult[] = [];
      const seenCoords = new Set<string>();

      for (const saved of savedLocations) {
        const hay = `${saved.name} ${saved.region ?? ''}`.toLowerCase();
        if (hay.includes(normalizedQuery)) {
          const key = buildLocationKey(saved.latitude, saved.longitude);
          if (!seenCoords.has(key)) {
            seenCoords.add(key);
            offlineMatches.push({
              place_id: 8000 + offlineMatches.length,
              lat: String(saved.latitude),
              lon: String(saved.longitude),
              display_name: `${saved.name} (${saved.region ?? 'Ponto Salvo Offline'})`,
              name: saved.name,
              type: 'saved_offline',
            });
          }
        }
      }

      for (const refItem of OFFLINE_REFERENCE_CATALOG) {
        const hay = `${refItem.name} ${refItem.display_name}`.toLowerCase();
        if (hay.includes(normalizedQuery)) {
          const key = buildLocationKey(refItem.latitude, refItem.longitude);
          if (!seenCoords.has(key)) {
            seenCoords.add(key);
            offlineMatches.push({
              place_id: refItem.place_id,
              lat: String(refItem.latitude),
              lon: String(refItem.longitude),
              display_name: refItem.display_name,
              name: refItem.name,
              type: refItem.type,
            });
          }
        }
      }

      return offlineMatches;
    },
    [refreshHealthMetrics, savedLocations],
  );

  const handleSetPrimaryLocation = useCallback(
    async (locInput?: {
      savedLocationId?: string;
      name: string;
      latitude: number;
      longitude: number;
      region?: string;
      origin?: ActiveCoordinates['origin'];
    }) => {
      const targetLat = locInput?.latitude ?? activeLocation.latitude;
      const targetLon = locInput?.longitude ?? activeLocation.longitude;
      const targetName = (locInput?.name ?? activeLocation.name).trim() || 'Área Principal';
      const targetOrigin = locInput?.origin ?? activeLocation.origin;

      const allSaved = await getSavedLocations();
      const matched = allSaved.find(
        (item) =>
          (locInput?.savedLocationId && item.id === locInput.savedLocationId) ||
          (Math.abs(item.latitude - targetLat) < 0.002 &&
            Math.abs(item.longitude - targetLon) < 0.002),
      );

      let savedId = matched?.id ?? locInput?.savedLocationId;
      if (!matched) {
        const nowIso = new Date().toISOString();
        savedId =
          savedId ?? `loc-primary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await upsertSavedLocation({
          id: savedId,
          name: targetName,
          latitude: targetLat,
          longitude: targetLon,
          region: locInput?.region ?? 'Área Principal Operacional',
          isFavorite: true,
          createdAtIso: nowIso,
          lastUsedAtIso: nowIso,
        });
        setSavedLocations(await getSavedLocations());
      } else {
        await upsertSavedLocation({
          ...matched,
          isFavorite: true,
          lastUsedAtIso: new Date().toISOString(),
        });
        setSavedLocations(await getSavedLocations());
      }

      const persisted = savePrimaryLocationPreference({
        savedLocationId: savedId,
        name: targetName,
        latitude: targetLat,
        longitude: targetLon,
        region: locInput?.region ?? matched?.region,
        origin: targetOrigin,
        updatedAtIso: new Date().toISOString(),
      });
      setPrimaryLocation(persisted);
      hasUserSelectedLocationRef.current = true;

      if (
        Math.abs(activeLocation.latitude - targetLat) >= 0.001 ||
        Math.abs(activeLocation.longitude - targetLon) >= 0.001
      ) {
        setManualLocation({
          latitude: targetLat,
          longitude: targetLon,
          name: targetName,
          origin: targetOrigin,
        });
        await loadForecastForCoordinates(targetLat, targetLon, {
          silent: true,
          forceNetwork: true,
        });
      }

      addToast({
        type: 'success',
        title: 'Área principal definida',
        message: `"${targetName}" agora abre por padrão no aplicativo.`,
      });
    },
    [activeLocation, addToast, loadForecastForCoordinates, setManualLocation],
  );

  const handleRequestGps = useCallback(async () => {
    hasUserSelectedLocationRef.current = true;
    const resolution = await resolveLocation();
    let finalCoords = resolution.coordinates;

    // Se caiu no nível 3 (cache offline), preserva o nome amigável do ponto salvo correspondente
    if (resolution.tierResolved === 3) {
      const matchedSaved = savedLocations.find(
        (loc) =>
          Math.abs(loc.latitude - finalCoords.latitude) < 0.005 &&
          Math.abs(loc.longitude - finalCoords.longitude) < 0.005,
      );
      if (matchedSaved) {
        finalCoords = setManualLocation({
          latitude: matchedSaved.latitude,
          longitude: matchedSaved.longitude,
          name: matchedSaved.name,
          origin: 'cached',
        });
      }
    }

    // Quando o GPS real é liberado e resolvido, identifica o ponto como padrão se não houver área customizada ainda
    if (resolution.tierResolved === 1 && !loadPrimaryLocationPreference()) {
      const persisted = savePrimaryLocationPreference({
        name: finalCoords.name,
        latitude: finalCoords.latitude,
        longitude: finalCoords.longitude,
        region: 'Área Principal via GPS',
        origin: 'gps',
        updatedAtIso: new Date().toISOString(),
      });
      setPrimaryLocation(persisted);
    }

    addToast({
      type:
        resolution.tierResolved === 1
          ? 'success'
          : resolution.tierResolved === 2
            ? 'info'
            : 'warning',
      title:
        resolution.tierResolved === 1
          ? 'Posição GPS obtida com sucesso'
          : resolution.tierResolved === 2
            ? 'Localização aproximada via IP (ipwho.is)'
            : 'GPS indisponível — Usando coordenada em cache offline',
      message: `${finalCoords.name} (${finalCoords.latitude.toFixed(4)}°, ${finalCoords.longitude.toFixed(4)}°) • Você pode fixá-la como Área Principal no topo.`,
    });

    await loadForecastForCoordinates(finalCoords.latitude, finalCoords.longitude, {
      silent: true,
    });
  }, [addToast, loadForecastForCoordinates, resolveLocation, savedLocations, setManualLocation]);

  const handleSaveThresholds = useCallback(
    async (nextThresholds: SafeWindowThresholds) => {
      const validated = SafeWindowThresholdsSchema.parse(nextThresholds);
      setThresholds(validated);
      persistThresholds(validated);

      setForecast((prev) => {
        if (!prev) return null;
        const updated = reapplyThresholdsToForecast(prev, validated);
        void saveForecastCache(updated);
        return updated;
      });
    },
    [],
  );

  const handleRefreshForecast = useCallback(async () => {
    await loadForecastForCoordinates(
      activeLocation.latitude,
      activeLocation.longitude,
      {
        silent: false,
        forceNetwork: true,
      },
    );
  }, [activeLocation.latitude, activeLocation.longitude, loadForecastForCoordinates]);

  const handleRunHealthCheck = useCallback(async () => {
    await Promise.allSettled([
      loadForecastForCoordinates(activeLocation.latitude, activeLocation.longitude, {
        silent: true,
        forceNetwork: true,
      }),
      probeRainViewerHealth(),
      probeNominatimHealth(),
      probeIpWhoisHealth(),
    ]);
    await refreshHealthMetrics();
  }, [
    activeLocation.latitude,
    activeLocation.longitude,
    loadForecastForCoordinates,
    refreshHealthMetrics,
  ]);

  const handleClearErrorLogs = useCallback(async () => {
    await clearErrorLogs();
    await refreshHealthMetrics();
  }, [refreshHealthMetrics]);

  // Snapshot completo e reativo do Health Check para o cabeçalho e modal de autodiagnóstico
  const healthSnapshot: HealthCheckSnapshot = useMemo(() => {
    void healthTick;
    const endpoints = getEndpointHealthSnapshot();
    const rawEndpointsLevel = getOverallEndpointsHealthLevel();
    const usingCachedForecast = Boolean(forecast?.fromCache);

    const cacheAgeMinutes = forecast
      ? Math.max(
          0,
          Math.round((Date.now() - new Date(forecast.fetchedAtIso).getTime()) / 60_000),
        )
      : null;

    let overall: HealthLevel = rawEndpointsLevel;
    if (!indexedDbOk && !forecast) {
      overall = 'down';
    } else if (overall === 'down' && forecast !== null) {
      // Quando offline porém operando com cache local íntegro no Dexie, sinaliza Modo Degradado / Cache
      overall = 'degraded';
    } else if (overall === 'healthy' && (usingCachedForecast || !indexedDbOk)) {
      overall = 'degraded';
    }

    return {
      overall,
      platform: detectRuntimePlatform(),
      gpsStatus,
      indexedDbOk,
      usingCachedForecast,
      cacheAgeMinutes,
      endpoints,
      recentErrors,
      checkedAtIso: healthCheckedAtIso,
    };
  }, [
    forecast,
    gpsStatus,
    healthCheckedAtIso,
    healthTick,
    indexedDbOk,
    recentErrors,
  ]);

  const primaryLocationKey = useMemo(() => {
    if (!primaryLocation) return null;
    return (
      primaryLocation.savedLocationId ??
      buildLocationKey(primaryLocation.latitude, primaryLocation.longitude)
    );
  }, [primaryLocation]);

  const isActivePrimaryLocation = useMemo(() => {
    if (!primaryLocation) return false;
    return (
      Math.abs(primaryLocation.latitude - activeLocation.latitude) < 0.002 &&
      Math.abs(primaryLocation.longitude - activeLocation.longitude) < 0.002
    );
  }, [activeLocation.latitude, activeLocation.longitude, primaryLocation]);

  return (
    <GlobalErrorBoundary
      onErrorLog={handleErrorLog}
      onClearCache={resetDatabaseForTests}
    >
      <AppShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        activeLocation={activeLocation}
        savedLocations={savedLocations}
        primaryLocationKey={primaryLocationKey}
        onSetPrimaryLocation={handleSetPrimaryLocation}
        healthSnapshot={healthSnapshot}
        activeAlertsCount={forecast?.alerts.length ?? 0}
        isRefreshingForecast={isRefreshingForecast}
        onRefreshForecast={handleRefreshForecast}
        onSelectLocation={handleSelectLocation}
        onSaveLocation={handleSaveLocation}
        onRenameLocation={handleRenameLocation}
        onToggleFavoriteLocation={handleToggleFavoriteLocation}
        onDeleteLocation={handleDeleteLocation}
        onSearchQuery={handleSearchQuery}
        onRequestGps={handleRequestGps}
        onRunHealthCheck={handleRunHealthCheck}
        onClearErrorLogs={handleClearErrorLogs}
        onToast={addToast}
        isLocationsModalOpen={isLocationsModalOpen}
        onLocationsModalOpenChange={setIsLocationsModalOpen}
      >
        {activeTab === 'forecast' && (
          <ModuleErrorBoundary
            moduleName="Módulo de Previsão Multi-Modelo (168h)"
            onReset={handleRefreshForecast}
            onErrorLog={handleErrorLog}
          >
            <ForecastTab
              forecast={forecast}
              activeLocation={activeLocation}
              isLoading={isRefreshingForecast && !forecast}
              isDark={isDark}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              thresholds={thresholds}
              onSaveThresholds={handleSaveThresholds}
              onSelectLocation={handleSelectLocation}
              onSaveLocation={handleSaveLocation}
              onRequestGps={handleRequestGps}
              isPrimaryLocation={isActivePrimaryLocation}
              onSetPrimaryLocation={handleSetPrimaryLocation}
              onOpenLocationsModal={() => setIsLocationsModalOpen(true)}
              onReloadForecast={handleRefreshForecast}
              onToast={addToast}
              onErrorLog={handleErrorLog}
            />
          </ModuleErrorBoundary>
        )}

        {activeTab === 'map' && (
          <ModuleErrorBoundary
            moduleName="Módulo de Mapa Interativo, Radar & Cache Offline"
            onErrorLog={handleErrorLog}
          >
            <MapRadarTab
              activeLocation={activeLocation}
              forecast={forecast}
              savedLocations={savedLocations}
              waypoints={waypoints}
              tracks={tracks}
              isDark={isDark}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onSelectLocation={handleSelectLocation}
              onSaveLocation={handleSaveLocation}
              onToast={addToast}
              onErrorLog={handleErrorLog}
            />
          </ModuleErrorBoundary>
        )}

        {activeTab === 'field' && (
          <ModuleErrorBoundary
            moduleName="Módulo de Operações de Campo, GPS Tracker & Exportação"
            onErrorLog={handleErrorLog}
          >
            <FieldDataTab
              forecast={forecast}
              activeLocation={activeLocation}
              savedLocations={savedLocations}
              waypoints={waypoints}
              tracks={tracks}
              onWaypointsChange={setWaypoints}
              onTracksChange={setTracks}
              onToast={addToast}
              onErrorLog={handleErrorLog}
            />
          </ModuleErrorBoundary>
        )}
      </AppShell>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </GlobalErrorBoundary>
  );
}

export default App;
