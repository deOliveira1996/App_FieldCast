import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import {
  DEFAULT_SAVED_LOCATIONS,
  getLatestCachedForecast,
  getSavedLocations,
} from '../db/database';
import {
  fetchIpApproximateLocation,
  reverseGeocodeNominatim,
} from '../services/geocodingService';
import type { ActiveCoordinates, LocationOrigin } from '../types/field';
import type { GpsHealthStatus } from '../types/health';
import { haversineDistanceKm } from '../utils/exporters';

export const GPS_TIMEOUT_MS = 8000;

export interface RawGpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

export interface ResolveCascadingLocationOptions {
  timeoutMs?: number;
  locale?: 'pt' | 'en';
  isNativePlatformFn?: () => boolean;
  getGpsPositionFn?: (timeoutMs: number) => Promise<RawGpsFix>;
  fetchIpLocationFn?: () => Promise<ActiveCoordinates>;
  getCachedLocationFn?: () => Promise<ActiveCoordinates | null>;
  reverseGeocodeFn?: (
    latitude: number,
    longitude: number,
  ) => Promise<{ friendlyLabel: string } | null>;
}

export interface SmartLocationResolution {
  coordinates: ActiveCoordinates;
  gpsStatus: GpsHealthStatus;
  tierResolved: 1 | 2 | 3;
}

/**
 * Obtém fix de GPS via `@capacitor/geolocation` (no Android/iOS nativo)
 * ou `navigator.geolocation.getCurrentPosition` (na Web) com timeout estrito de 8000ms.
 */
export async function acquireDeviceGpsFix(
  timeoutMs = GPS_TIMEOUT_MS,
  isNativePlatformFn?: () => boolean,
): Promise<RawGpsFix> {
  const isNative =
    isNativePlatformFn?.() ??
    (() => {
      try {
        return Capacitor.isNativePlatform();
      } catch {
        return false;
      }
    })();

  if (isNative) {
    try {
      await Geolocation.requestPermissions();
    } catch {
      // Prossegue caso já concedido
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 15000,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracyM: pos.coords.accuracy ?? null,
    };
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('API de geolocalização GPS indisponível neste dispositivo.');
  }

  return new Promise<RawGpsFix>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timeout de GPS excedido (${timeoutMs}ms).`));
      }
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
        });
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(err.message || 'Permissão negada ou falha no receptor GPS.'));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 15000,
      },
    );
  });
}

/**
 * Recupera a última coordenada salva ou em cache no Dexie (Nível 3 da cascata).
 */
export async function resolveDexieCachedCoordinates(): Promise<ActiveCoordinates> {
  const nowIso = new Date().toISOString();

  try {
    const latestForecast = await getLatestCachedForecast();
    if (
      latestForecast &&
      Number.isFinite(latestForecast.latitude) &&
      Number.isFinite(latestForecast.longitude)
    ) {
      return {
        latitude: latestForecast.latitude,
        longitude: latestForecast.longitude,
        accuracyM: null,
        name: `Último local salvo (${latestForecast.latitude.toFixed(3)}, ${latestForecast.longitude.toFixed(3)})`,
        origin: 'cached',
        isApproximateIp: false,
        updatedAtIso: nowIso,
      };
    }
  } catch {
    // Continua para savedLocations
  }

  try {
    const saved = await getSavedLocations();
    const firstSaved = saved[0];
    if (firstSaved) {
      return {
        latitude: firstSaved.latitude,
        longitude: firstSaved.longitude,
        accuracyM: null,
        name: firstSaved.name,
        origin: 'cached',
        isApproximateIp: false,
        updatedAtIso: nowIso,
      };
    }
  } catch {
    // Fallback para default
  }

  const fallback = DEFAULT_SAVED_LOCATIONS[0]!;
  return {
    latitude: fallback.latitude,
    longitude: fallback.longitude,
    accuracyM: null,
    name: fallback.name,
    origin: 'cached',
    isApproximateIp: false,
    updatedAtIso: nowIso,
  };
}

/**
 * Executa a cascata de geolocalização de 3 níveis especificada na Seção 4.1 de `docs/SPEC.md`:
 * 1. GPS do dispositivo (`timeout: 8000ms`, `origin: 'gps'`)
 * 2. Geolocalização aproximada por IP via `https://ipwho.is/` (sinalizada como `"Aproximado via IP"`, `origin: 'ip'`)
 * 3. Última coordenada salva/em cache no IndexedDB (`dexie`, `origin: 'cached'`)
 */
export async function resolveCascadingLocation(
  options?: ResolveCascadingLocationOptions,
): Promise<SmartLocationResolution> {
  const timeoutMs = options?.timeoutMs ?? GPS_TIMEOUT_MS;
  const fallbackGpsLabel =
    options?.locale === 'en' ? 'Current GPS Location' : 'Localização Atual (GPS)';
  const getGpsFn =
    options?.getGpsPositionFn ??
    ((t: number) => acquireDeviceGpsFix(t, options?.isNativePlatformFn));
  const reverseGeocodeFn =
    options?.reverseGeocodeFn ??
    ((lat: number, lon: number) => reverseGeocodeNominatim(lat, lon));
  const fetchIpFn = options?.fetchIpLocationFn ?? (() => fetchIpApproximateLocation());
  const getCachedFn = options?.getCachedLocationFn ?? resolveDexieCachedCoordinates;

  // Nível 1: GPS Nativo / Web (timeout 8s) + Geocodificação Reversa amigável
  try {
    const fix = await getGpsFn(timeoutMs);
    if (Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)) {
      let resolvedName = fallbackGpsLabel;
      try {
        const rev = await reverseGeocodeFn(fix.latitude, fix.longitude);
        if (rev?.friendlyLabel && rev.friendlyLabel.trim().length > 0) {
          resolvedName = rev.friendlyLabel.trim();
        }
      } catch {
        resolvedName = fallbackGpsLabel;
      }

      const coords: ActiveCoordinates = {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyM: fix.accuracyM,
        name: resolvedName,
        origin: 'gps',
        isApproximateIp: false,
        updatedAtIso: new Date().toISOString(),
      };
      return {
        coordinates: coords,
        gpsStatus: 'granted',
        tierResolved: 1,
      };
    }
  } catch {
    // Avança para o Nível 2 (Fallback IP)
  }

  // Nível 2: Fallback IP (https://ipwho.is/)
  try {
    const ipCoords = await fetchIpFn();
    if (Number.isFinite(ipCoords.latitude) && Number.isFinite(ipCoords.longitude)) {
      const normalizedName = ipCoords.name.includes('Aproximado via IP')
        ? ipCoords.name
        : `${ipCoords.name} (Aproximado via IP)`;

      const coords: ActiveCoordinates = {
        ...ipCoords,
        name: normalizedName,
        origin: 'ip',
        isApproximateIp: true,
        updatedAtIso: new Date().toISOString(),
      };
      return {
        coordinates: coords,
        gpsStatus: 'fallback_ip',
        tierResolved: 2,
      };
    }
  } catch {
    // Avança para o Nível 3 (Cache Dexie)
  }

  // Nível 3: Última coordenada no Dexie
  const cached = await getCachedFn();
  const fallbackDefault = DEFAULT_SAVED_LOCATIONS[0]!;
  const finalCoords: ActiveCoordinates = cached
    ? {
        ...cached,
        origin: 'cached',
        isApproximateIp: false,
        updatedAtIso: new Date().toISOString(),
      }
    : {
        latitude: fallbackDefault.latitude,
        longitude: fallbackDefault.longitude,
        accuracyM: null,
        name: fallbackDefault.name,
        origin: 'cached',
        isApproximateIp: false,
        updatedAtIso: new Date().toISOString(),
      };

  return {
    coordinates: finalCoords,
    gpsStatus: 'offline_cache',
    tierResolved: 3,
  };
}

export interface UseSmartLocationOptions extends ResolveCascadingLocationOptions {
  autoResolveOnMount?: boolean;
  initialCoordinates?: ActiveCoordinates;
  onAutoResolved?: (resolution: SmartLocationResolution) => void;
}

export interface UseSmartLocationReturn {
  activeLocation: ActiveCoordinates;
  gpsStatus: GpsHealthStatus;
  tierResolved: 1 | 2 | 3;
  isLocating: boolean;
  error: string | null;
  resolveLocation: () => Promise<SmartLocationResolution>;
  setManualLocation: (coords: {
    latitude: number;
    longitude: number;
    name: string;
    origin?: LocationOrigin;
    accuracyM?: number | null;
  }) => ActiveCoordinates;
  distanceFromActiveKm: (latitude: number, longitude: number) => number;
}

const INITIAL_FALLBACK_COORDINATES: ActiveCoordinates = {
  latitude: DEFAULT_SAVED_LOCATIONS[0]!.latitude,
  longitude: DEFAULT_SAVED_LOCATIONS[0]!.longitude,
  accuracyM: null,
  name: DEFAULT_SAVED_LOCATIONS[0]!.name,
  origin: 'cached',
  isApproximateIp: false,
  updatedAtIso: new Date().toISOString(),
};

/**
 * Hook React de geolocalização inteligente em cascata (GPS 8s -> ipwho.is -> Dexie Cache).
 */
export function useSmartLocation(options?: UseSmartLocationOptions): UseSmartLocationReturn {
  const [activeLocation, setActiveLocation] = useState<ActiveCoordinates>(
    options?.initialCoordinates ?? INITIAL_FALLBACK_COORDINATES,
  );
  const [gpsStatus, setGpsStatus] = useState<GpsHealthStatus>('offline_cache');
  const [tierResolved, setTierResolved] = useState<1 | 2 | 3>(3);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const manualSelectionVersionRef = useRef<number>(0);
  const resolveGenerationRef = useRef<number>(0);

  const runResolveLocation = useCallback(
    async (isStartupAuto: boolean): Promise<SmartLocationResolution> => {
      const generation = ++resolveGenerationRef.current;
      const manualVersionAtStart = manualSelectionVersionRef.current;
      setIsLocating(true);
      setError(null);
      try {
        const res = await resolveCascadingLocation(optionsRef.current);
        const supersededByManual =
          isStartupAuto && manualSelectionVersionRef.current !== manualVersionAtStart;
        const supersededByNewerRequest = generation !== resolveGenerationRef.current;

        if (!supersededByManual && !supersededByNewerRequest) {
          setActiveLocation(res.coordinates);
          setGpsStatus(res.gpsStatus);
          setTierResolved(res.tierResolved);
        }
        return res;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Falha na resolução de geolocalização em cascata.';
        if (generation === resolveGenerationRef.current) {
          setError(msg);
        }
        throw err;
      } finally {
        if (generation === resolveGenerationRef.current) {
          setIsLocating(false);
        }
      }
    },
    [],
  );

  const resolveLocation = useCallback(
    async (): Promise<SmartLocationResolution> => runResolveLocation(false),
    [runResolveLocation],
  );

  const setManualLocation = useCallback(
    (coords: {
      latitude: number;
      longitude: number;
      name: string;
      origin?: LocationOrigin;
      accuracyM?: number | null;
    }): ActiveCoordinates => {
      manualSelectionVersionRef.current += 1;
      resolveGenerationRef.current += 1;
      const origin: LocationOrigin = coords.origin ?? 'saved';
      const updated: ActiveCoordinates = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyM: coords.accuracyM ?? null,
        name: coords.name,
        origin,
        isApproximateIp: origin === 'ip',
        updatedAtIso: new Date().toISOString(),
      };
      setActiveLocation(updated);
      setIsLocating(false);
      if (origin === 'gps') {
        setGpsStatus('granted');
        setTierResolved(1);
      } else if (origin === 'ip') {
        setGpsStatus('fallback_ip');
        setTierResolved(2);
      }
      return updated;
    },
    [],
  );

  const distanceFromActiveKm = useCallback(
    (latitude: number, longitude: number): number => {
      return haversineDistanceKm(
        activeLocation.latitude,
        activeLocation.longitude,
        latitude,
        longitude,
      );
    },
    [activeLocation.latitude, activeLocation.longitude],
  );

  useEffect(() => {
    if (options?.autoResolveOnMount !== false) {
      let cancelled = false;
      const manualVersionAtMount = manualSelectionVersionRef.current;
      void runResolveLocation(true)
        .then((res) => {
          if (!cancelled && manualSelectionVersionRef.current === manualVersionAtMount) {
            optionsRef.current?.onAutoResolved?.(res);
          }
        })
        .catch(() => {
          // Erro já registrado no estado do hook
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [options?.autoResolveOnMount, runResolveLocation]);

  return {
    activeLocation,
    gpsStatus,
    tierResolved,
    isLocating,
    error,
    resolveLocation,
    setManualLocation,
    distanceFromActiveKm,
  };
}
