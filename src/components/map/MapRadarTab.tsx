import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  Rectangle,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  AlertTriangle,
  Bookmark,
  Camera,
  CheckCircle2,
  Compass,
  Crosshair,
  Download,
  HardDrive,
  Layers,
  MapPin,
  Maximize2,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Route,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { ModuleErrorBoundary } from '../common';
import {
  getSavedLocations,
  getTrackSessions,
  getWaypoints,
  logErrorToDb,
} from '../../db/database';
import {
  createMissionBoundsAroundPoint,
  createOfflineCartoTileLayer,
  downloadOfflineMissionTiles,
  estimateMissionTileCount,
  getOfflineCacheStats,
  clearOfflineTiles,
  MAX_CONCURRENT_TILE_DOWNLOADS,
  MAX_OFFLINE_TILES_PER_MISSION,
  normalizeMissionBounds,
  type MapTileTheme,
  type OfflineCacheStats,
  type OfflineDownloadProgress,
  type OfflineCartoTileLayer,
} from '../../services/offlineTilesService';
import {
  fetchRainViewerRadar,
  type RadarAnimationFrame,
  type RainViewerRadarState,
} from '../../services/rainViewerService';
import type {
  ActiveCoordinates,
  OfflineMissionBounds,
  SavedLocation,
  TrackSession,
  Waypoint,
} from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type { NormalizedForecast, SafeWindowStatus } from '../../types/weather';
import { safeAction } from '../../utils/safeAction';

export interface MapRadarTabProps {
  activeLocation: ActiveCoordinates;
  forecast?: NormalizedForecast | null;
  savedLocations?: SavedLocation[];
  waypoints?: Waypoint[];
  tracks?: TrackSession[];
  isDark?: boolean;
  onSelectLocation?: (coords: {
    latitude: number;
    longitude: number;
    name: string;
    origin?: ActiveCoordinates['origin'];
  }) => void | Promise<void>;
  onSaveLocation?: (location: {
    name: string;
    latitude: number;
    longitude: number;
    region?: string;
    isFavorite?: boolean;
  }) => void | Promise<void>;
  onRadarStateChange?: (state: RainViewerRadarState) => void;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

interface ViewportSnapshot {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

interface InspectedCoordinate {
  latitude: number;
  longitude: number;
}

const RADAR_OPACITY_PRESETS = [0.45, 0.7, 0.9] as const;
const MISSION_RADIUS_PRESETS_KM = [2, 5, 10, 15] as const;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatFrameTimestamp(timeUnix: number): string {
  try {
    const date = new Date(timeUnix * 1000);
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return new Date(timeUnix * 1000).toISOString().slice(11, 16);
  }
}

function formatSafeWindowLabel(status: SafeWindowStatus | null | undefined): {
  label: string;
  badgeClass: string;
} {
  if (status === 'green') {
    return {
      label: 'Janela Segura (Verde)',
      badgeClass:
        'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/40',
    };
  }
  if (status === 'red') {
    return {
      label: 'Fora de Limite (Vermelho)',
      badgeClass:
        'bg-rose-500/20 text-rose-800 dark:text-rose-300 border-rose-500/40',
    };
  }
  return {
    label: 'Atenção Operacional (Amarelo)',
    badgeClass:
      'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40',
  };
}

function createActiveLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: 'fieldcast-active-location-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
    html: `
      <div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;width:34px;height:34px;border-radius:9999px;background:rgba(14,165,233,0.28);border:2px solid rgba(56,189,248,0.85);"></span>
        <span style="position:relative;width:16px;height:16px;border-radius:9999px;background:#0284c7;border:3px solid #ffffff;box-shadow:0 2px 8px rgba(2,132,199,0.65);"></span>
      </div>
    `,
  });
}

function createSavedLocationIcon(isFavorite: boolean): L.DivIcon {
  const bg = isFavorite ? '#d97706' : '#475569';
  return L.divIcon({
    className: 'fieldcast-saved-location-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `
      <div style="width:28px;height:28px;border-radius:9999px;background:${bg};border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:13px;font-weight:700;">
        ★
      </div>
    `,
  });
}

function createWaypointIcon(hasPhoto: boolean): L.DivIcon {
  const bg = hasPhoto ? '#7c3aed' : '#059669';
  const symbol = hasPhoto ? '📷' : '⚑';
  return L.divIcon({
    className: 'fieldcast-waypoint-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
    html: `
      <div style="width:30px;height:30px;border-radius:10px;background:${bg};border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:13px;font-weight:700;">
        ${symbol}
      </div>
    `,
  });
}

function createInspectedPointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'fieldcast-inspected-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `
      <div style="width:28px;height:28px;border-radius:9999px;background:rgba(244,63,94,0.9);border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:14px;font-weight:700;">
        +
      </div>
    `,
  });
}

/**
 * Monta e sincroniza a subclasse `OfflineCartoTileLayer` (com `createTile()` lendo primeiro do Dexie)
 * diretamente na instância do mapa Leaflet.
 */
function OfflineBaseTileLayer({ theme }: { theme: MapTileTheme }): null {
  const map = useMap();
  const layerRef = useRef<OfflineCartoTileLayer | null>(null);

  useEffect(() => {
    const layer = createOfflineCartoTileLayer(theme);
    layer.addTo(map);
    layer.bringToBack();
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.setTheme(theme);
    }
  }, [theme]);

  return null;
}

/**
 * Sincroniza centro do mapa, corrige dimensões do container Leaflet ao trocar de aba
 * e reporta bounds/zoom atuais para a ferramenta de Área de Missão Offline.
 */
function MapViewportBridge({
  centerLat,
  centerLon,
  recenterTrigger,
  onViewportChange,
  onMapClick,
}: {
  centerLat: number;
  centerLon: number;
  recenterTrigger: number;
  onViewportChange: (viewport: ViewportSnapshot) => void;
  onMapClick: (lat: number, lon: number) => void;
}): null {
  const map = useMap();
  const prevCenterRef = useRef<{ lat: number; lon: number; trigger: number }>({
    lat: centerLat,
    lon: centerLon,
    trigger: recenterTrigger,
  });

  const emitViewport = useCallback(() => {
    try {
      const b = map.getBounds();
      onViewportChange({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
        zoom: map.getZoom(),
      });
    } catch {
      // Ignora caso o mapa ainda não esteja inicializado
    }
  }, [map, onViewportChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      emitViewport();
    }, 120);
    emitViewport();
    return () => window.clearTimeout(timer);
  }, [map, emitViewport]);

  useEffect(() => {
    const prev = prevCenterRef.current;
    const coordsChanged =
      Math.abs(prev.lat - centerLat) > 0.0001 ||
      Math.abs(prev.lon - centerLon) > 0.0001;
    const triggerChanged = prev.trigger !== recenterTrigger;

    if (coordsChanged || triggerChanged) {
      prevCenterRef.current = {
        lat: centerLat,
        lon: centerLon,
        trigger: recenterTrigger,
      };
      map.setView([centerLat, centerLon], map.getZoom(), { animate: true });
      emitViewport();
    }
  }, [centerLat, centerLon, recenterTrigger, map, emitViewport]);

  useMapEvents({
    moveend() {
      emitViewport();
    },
    zoomend() {
      emitViewport();
    },
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}

function MapRadarTabContent({
  activeLocation,
  forecast,
  savedLocations: savedLocationsProp,
  waypoints: waypointsProp,
  tracks: tracksProp,
  isDark = true,
  onSelectLocation,
  onSaveLocation,
  onRadarStateChange,
  onToast,
  onErrorLog,
}: MapRadarTabProps): React.ReactElement {
  const tileTheme: MapTileTheme = isDark ? 'dark' : 'light';

  // Estado do Radar RainViewer
  const [radarState, setRadarState] = useState<RainViewerRadarState | null>(null);
  const [isLoadingRadar, setIsLoadingRadar] = useState<boolean>(false);
  const [radarEnabled, setRadarEnabled] = useState<boolean>(true);
  const [isPlayingRadar, setIsPlayingRadar] = useState<boolean>(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [radarOpacityIndex, setRadarOpacityIndex] = useState<number>(1);
  const radarOpacity = RADAR_OPACITY_PRESETS[radarOpacityIndex] ?? 0.7;

  // Camadas visíveis no mapa
  const [showSavedLocations, setShowSavedLocations] = useState<boolean>(true);
  const [showWaypoints, setShowWaypoints] = useState<boolean>(true);
  const [showTracks, setShowTracks] = useState<boolean>(true);
  const [showMissionOverlay, setShowMissionOverlay] = useState<boolean>(true);

  // Dados locais de fallback do Dexie (caso o pai não injete via props)
  const [dbSavedLocations, setDbSavedLocations] = useState<SavedLocation[]>([]);
  const [dbWaypoints, setDbWaypoints] = useState<Waypoint[]>([]);
  const [dbTracks, setDbTracks] = useState<TrackSession[]>([]);

  // Estado de navegação e inspeção do mapa
  const [recenterTrigger, setRecenterTrigger] = useState<number>(0);
  const [viewport, setViewport] = useState<ViewportSnapshot>({
    north: activeLocation.latitude + 0.045,
    south: activeLocation.latitude - 0.045,
    east: activeLocation.longitude + 0.045,
    west: activeLocation.longitude - 0.045,
    zoom: 12,
  });
  const [inspectedPoint, setInspectedPoint] = useState<InspectedCoordinate | null>(
    null,
  );

  // Estado da Ferramenta "Área de Missão Offline"
  const [missionBounds, setMissionBounds] = useState<OfflineMissionBounds>(() =>
    createMissionBoundsAroundPoint(
      activeLocation.latitude,
      activeLocation.longitude,
      5,
      11,
      14,
    ),
  );
  const [selectedRadiusKm, setSelectedRadiusKm] = useState<number | null>(5);
  const [isDrawingMissionBox, setIsDrawingMissionBox] = useState<boolean>(false);
  const [drawFirstCorner, setDrawFirstCorner] = useState<InspectedCoordinate | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] =
    useState<OfflineDownloadProgress | null>(null);
  const [isDownloadingTiles, setIsDownloadingTiles] = useState<boolean>(false);
  const [cacheStats, setCacheStats] = useState<OfflineCacheStats>({
    totalTiles: 0,
    lightTiles: 0,
    darkTiles: 0,
    totalBytes: 0,
    missionIds: [],
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleLogError = useCallback(
    async (record: ErrorLogRecord) => {
      if (onErrorLog) {
        await onErrorLog(record);
      } else {
        await logErrorToDb(record);
      }
    },
    [onErrorLog],
  );

  const refreshCacheStats = useCallback(async () => {
    const stats = await getOfflineCacheStats();
    setCacheStats(stats);
  }, []);

  // Carrega dados do Dexie como fallback inicial
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [locs, wps, trks, stats] = await Promise.all([
          getSavedLocations(),
          getWaypoints(),
          getTrackSessions(),
          getOfflineCacheStats(),
        ]);
        if (!mounted) return;
        setDbSavedLocations(locs);
        setDbWaypoints(wps);
        setDbTracks(trks);
        setCacheStats(stats);
      } catch {
        // Fallback silencioso
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const savedLocations = savedLocationsProp ?? dbSavedLocations;
  const waypoints = waypointsProp ?? dbWaypoints;
  const tracks = tracksProp ?? dbTracks;

  // Busca quadros do RainViewer
  const loadRainViewerRadar = useCallback(
    async (showSuccessToast = false) => {
      await safeAction(
        async () => {
          const state = await fetchRainViewerRadar();
          setRadarState(state);
          onRadarStateChange?.(state);
          if (state.frames.length > 0) {
            const defaultIndex = Math.max(0, state.pastCount - 1);
            setCurrentFrameIndex(defaultIndex);
          } else {
            setCurrentFrameIndex(0);
            setIsPlayingRadar(false);
          }

          if (showSuccessToast && onToast) {
            onToast({
              type: state.degraded ? 'warning' : 'success',
              title: state.degraded
                ? 'Radar RainViewer em modo degradado'
                : 'Radar RainViewer atualizado',
              message: state.statusMessage,
            });
          }
          return state;
        },
        {
          actionKey: 'fetch_rainviewer_radar',
          moduleName: 'MapRadarTab',
          errorTitle: 'Falha ao atualizar radar RainViewer',
          onLoadingChange: setIsLoadingRadar,
          onToast,
          onErrorLog: handleLogError,
        },
      );
    },
    [onRadarStateChange, onToast, handleLogError],
  );

  useEffect(() => {
    void loadRainViewerRadar(false);
  }, [loadRainViewerRadar]);

  // Loop de animação do player do radar
  const frames = radarState?.frames ?? [];
  const activeFrame: RadarAnimationFrame | undefined =
    frames[currentFrameIndex] ?? frames[0];

  useEffect(() => {
    if (!isPlayingRadar || !radarEnabled || frames.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setCurrentFrameIndex((prev) => (prev + 1) % frames.length);
    }, 650);
    return () => window.clearInterval(timer);
  }, [isPlayingRadar, radarEnabled, frames.length]);

  // Cancela eventual download em andamento ao desmontar
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Estimativa ao vivo de tiles da Área de Missão Offline
  const tileEstimate = useMemo(
    () =>
      estimateMissionTileCount(missionBounds, MAX_OFFLINE_TILES_PER_MISSION),
    [missionBounds],
  );

  // Hora atual da previsão para o popup do ponto ativo
  const currentForecastHour = useMemo(() => {
    if (!forecast || forecast.hours.length === 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    let closest = forecast.hours[0];
    let bestDiff = Infinity;
    for (const h of forecast.hours) {
      const diff = Math.abs(h.timestampUnix - nowSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = h;
      }
    }
    return closest ?? forecast.hours[0] ?? null;
  }, [forecast]);

  // Clique no mapa: ou desenha os 2 cantos da Área de Missão ou inspeciona coordenada
  const handleMapClick = useCallback(
    (lat: number, lon: number) => {
      if (isDrawingMissionBox) {
        if (!drawFirstCorner) {
          setDrawFirstCorner({ latitude: lat, longitude: lon });
          onToast?.({
            type: 'info',
            title: 'Canto 1 definido',
            message: 'Toque no segundo canto do mapa para fechar o retângulo da missão.',
          });
        } else {
          const nextBounds = normalizeMissionBounds({
            north: Math.max(drawFirstCorner.latitude, lat),
            south: Math.min(drawFirstCorner.latitude, lat),
            east: Math.max(drawFirstCorner.longitude, lon),
            west: Math.min(drawFirstCorner.longitude, lon),
            minZoom: missionBounds.minZoom,
            maxZoom: missionBounds.maxZoom,
          });
          setMissionBounds(nextBounds);
          setSelectedRadiusKm(null);
          setDrawFirstCorner(null);
          setIsDrawingMissionBox(false);
          setShowMissionOverlay(true);
          onToast?.({
            type: 'success',
            title: 'Retângulo da Área de Missão atualizado',
            message: 'Verifique a estimativa de tiles abaixo antes de iniciar o download.',
          });
        }
        return;
      }

      setInspectedPoint({
        latitude: Number(lat.toFixed(5)),
        longitude: Number(lon.toFixed(5)),
      });
    },
    [
      isDrawingMissionBox,
      drawFirstCorner,
      missionBounds.minZoom,
      missionBounds.maxZoom,
      onToast,
    ],
  );

  // Aplica a visão atual do mapa como retângulo de missão (com margem interna de 10%)
  const handleUseCurrentViewportForMission = (): void => {
    void safeAction(
      () => {
        const latSpan = Math.max(0.004, viewport.north - viewport.south);
        const lonSpan = Math.max(0.004, viewport.east - viewport.west);
        const padLat = latSpan * 0.1;
        const padLon = lonSpan * 0.1;

        const nextBounds = normalizeMissionBounds({
          north: viewport.north - padLat,
          south: viewport.south + padLat,
          east: viewport.east - padLon,
          west: viewport.west + padLon,
          minZoom: missionBounds.minZoom,
          maxZoom: missionBounds.maxZoom,
        });
        setMissionBounds(nextBounds);
        setSelectedRadiusKm(null);
        setIsDrawingMissionBox(false);
        setDrawFirstCorner(null);
        setShowMissionOverlay(true);
      },
      {
        actionKey: 'mission_use_viewport',
        moduleName: 'MapRadarTab',
        successTitle: 'Área de missão ajustada para a visão atual do mapa',
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  // Aplica preset de raio (km) ao redor do ponto ativo
  const handleSelectRadiusPreset = (radiusKm: number): void => {
    void safeAction(
      () => {
        const nextBounds = createMissionBoundsAroundPoint(
          activeLocation.latitude,
          activeLocation.longitude,
          radiusKm,
          missionBounds.minZoom,
          missionBounds.maxZoom,
        );
        setMissionBounds(nextBounds);
        setSelectedRadiusKm(radiusKm);
        setIsDrawingMissionBox(false);
        setDrawFirstCorner(null);
        setShowMissionOverlay(true);
      },
      {
        actionKey: `mission_preset_${radiusKm}`,
        moduleName: 'MapRadarTab',
        onErrorLog: handleLogError,
      },
    );
  };

  // Altera níveis de zoom da missão
  const handleZoomRangeChange = (
    field: 'minZoom' | 'maxZoom',
    value: number,
  ): void => {
    setMissionBounds((prev) => {
      const nextMin = field === 'minZoom' ? value : prev.minZoom;
      const nextMax = field === 'maxZoom' ? value : prev.maxZoom;
      return normalizeMissionBounds({
        ...prev,
        minZoom: Math.min(nextMin, nextMax),
        maxZoom: Math.max(nextMin, nextMax),
      });
    });
  };

  // Inicia download dos tiles da Área de Missão Offline via safeAction
  const handleStartOfflineDownload = (): void => {
    if (tileEstimate.exceedsLimit || tileEstimate.totalTiles === 0) {
      onToast?.({
        type: 'warning',
        title: 'Download bloqueado pela trava de 300 tiles',
        message: `A área atual exige ${tileEstimate.totalTiles} tiles (máximo: ${MAX_OFFLINE_TILES_PER_MISSION}). Reduza o raio ou o zoom máximo.`,
      });
      return;
    }

    void safeAction(
      async () => {
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const missionId = `mission-${activeLocation.latitude.toFixed(2)}-${activeLocation.longitude.toFixed(2)}-${Date.now()}`;
        const result = await downloadOfflineMissionTiles({
          bounds: missionBounds,
          theme: tileTheme,
          missionId,
          missionName: `${activeLocation.name} (Z${missionBounds.minZoom}-${missionBounds.maxZoom})`,
          maxConcurrent: MAX_CONCURRENT_TILE_DOWNLOADS,
          maxTiles: MAX_OFFLINE_TILES_PER_MISSION,
          signal: controller.signal,
          onProgress: (progress) => {
            setDownloadProgress(progress);
          },
        });

        await refreshCacheStats();

        if (result.status === 'completed') {
          onToast?.({
            type: result.failedTiles > 0 ? 'warning' : 'success',
            title:
              result.failedTiles > 0
                ? `Cache concluído (${result.completedTiles} salvos, ${result.failedTiles} falhas)`
                : `Área de Missão salva offline (${result.completedTiles} tiles)`,
            message: `Tiles CartoDB (${tileTheme === 'dark' ? 'DarkMatter' : 'Voyager'}) armazenados no IndexedDB.`,
          });
        } else if (result.status === 'cancelled') {
          onToast?.({
            type: 'info',
            title: 'Download de tiles cancelado',
            message: `${result.completedTiles} tiles foram mantidos no cache antes do cancelamento.`,
          });
        } else if (result.status === 'error') {
          onToast?.({
            type: 'error',
            title: 'Falha ao baixar tiles da missão',
            message: result.errorMessage,
          });
        }

        return result;
      },
      {
        actionKey: 'download_offline_mission_tiles',
        moduleName: 'MapRadarTab',
        errorTitle: 'Erro durante download da Área de Missão Offline',
        onLoadingChange: setIsDownloadingTiles,
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  const handleCancelOfflineDownload = (): void => {
    void safeAction(
      () => {
        abortControllerRef.current?.abort();
      },
      {
        actionKey: 'cancel_offline_mission_download',
        moduleName: 'MapRadarTab',
        onErrorLog: handleLogError,
      },
    );
  };

  const handleClearOfflineTileCache = (): void => {
    void safeAction(
      async () => {
        await clearOfflineTiles();
        setDownloadProgress(null);
        await refreshCacheStats();
      },
      {
        actionKey: 'clear_offline_tile_cache',
        moduleName: 'MapRadarTab',
        successTitle: 'Cache de tiles offline limpo com sucesso',
        errorTitle: 'Falha ao limpar cache de tiles offline',
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  const handleSelectMapCoordinate = (
    latitude: number,
    longitude: number,
    name: string,
    origin: ActiveCoordinates['origin'] = 'search',
  ): void => {
    if (!onSelectLocation) return;
    void safeAction(
      async () => {
        await onSelectLocation({
          latitude,
          longitude,
          name,
          origin,
        });
        setInspectedPoint(null);
      },
      {
        actionKey: 'select_map_coordinate',
        moduleName: 'MapRadarTab',
        successTitle: `Local ativo alterado para ${name}`,
        errorTitle: 'Não foi possível selecionar a coordenada no mapa',
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  const handleSaveInspectedCoordinate = (
    latitude: number,
    longitude: number,
  ): void => {
    if (!onSaveLocation) return;
    const defaultName = `Ponto de Campo (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;
    void safeAction(
      async () => {
        await onSaveLocation({
          name: defaultName,
          latitude,
          longitude,
          region: 'Marcado via Mapa Interativo',
          isFavorite: true,
        });
        const locs = await getSavedLocations();
        setDbSavedLocations(locs);
      },
      {
        actionKey: 'save_inspected_map_coordinate',
        moduleName: 'MapRadarTab',
        successTitle: 'Coordenada salva nos Pontos Favoritos',
        errorTitle: 'Não foi possível salvar a coordenada',
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  // Ícones memorizados para o Leaflet
  const activeMarkerIcon = useMemo(() => createActiveLocationIcon(), []);
  const inspectedMarkerIcon = useMemo(() => createInspectedPointIcon(), []);

  const progressPct =
    downloadProgress && downloadProgress.totalTiles > 0
      ? Math.min(
          100,
          Math.round(
            ((downloadProgress.completedTiles + downloadProgress.failedTiles) /
              downloadProgress.totalTiles) *
              100,
          ),
        )
      : 0;

  return (
    <div className="space-y-4 pb-8">
      {/* Cabeçalho Operacional do Mapa & Controles Rápidos de Camada */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
                <Radar className="w-3.5 h-3.5" aria-hidden="true" />
                Mapa Tático &amp; Radar RainViewer
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                Base CORS: CartoDB {isDark ? 'DarkMatter (Noturno)' : 'Voyager (Solar)'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
                Cache Offline: {cacheStats.totalTiles} tiles
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Ponto ativo:{' '}
              <strong className="text-slate-900 dark:text-white">
                {activeLocation.name}
              </strong>{' '}
              ({activeLocation.latitude.toFixed(4)}, {activeLocation.longitude.toFixed(4)})
              {forecast ? ` • Altitude DEM: ${Math.round(forecast.elevationDemM)}m` : ''}
            </p>
          </div>

          {/* Botões de Camadas e Centralização (todos >= 44x44px) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRecenterTrigger((prev) => prev + 1)}
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
              title="Centralizar mapa no ponto ativo"
            >
              <Crosshair className="w-4 h-4" aria-hidden="true" />
              <span>Centralizar</span>
            </button>

            <button
              type="button"
              onClick={() => setRadarEnabled((prev) => !prev)}
              aria-pressed={radarEnabled}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                radarEnabled
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-800 dark:text-sky-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Radar className="w-4 h-4" aria-hidden="true" />
              <span>Radar</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSavedLocations((prev) => !prev)}
              aria-pressed={showSavedLocations}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                showSavedLocations
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Bookmark className="w-4 h-4" aria-hidden="true" />
              <span>Locais ({savedLocations.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setShowWaypoints((prev) => !prev)}
              aria-pressed={showWaypoints}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                showWaypoints
                  ? 'bg-violet-500/15 border-violet-500/40 text-violet-800 dark:text-violet-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              <span>Waypoints ({waypoints.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTracks((prev) => !prev)}
              aria-pressed={showTracks}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                showTracks
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Route className="w-4 h-4" aria-hidden="true" />
              <span>Trilhas ({tracks.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setShowMissionOverlay((prev) => !prev)}
              aria-pressed={showMissionOverlay}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                showMissionOverlay
                  ? 'bg-teal-500/15 border-teal-500/40 text-teal-800 dark:text-teal-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Square className="w-4 h-4" aria-hidden="true" />
              <span>Área Offline</span>
            </button>
          </div>
        </div>
      </section>

      {/* Aviso Não-Bloqueante Âmbar quando RainViewer estiver degradado ou indisponível */}
      {radarState && (radarState.degraded || !radarState.available) && (
        <div
          role="status"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="text-xs sm:text-sm">
              <p className="font-bold text-amber-900 dark:text-amber-200">
                Radar RainViewer em Modo Degradado (Não-Bloqueante)
              </p>
              <p className="text-amber-800 dark:text-amber-300/90">
                {radarState.statusMessage}. O mapa base CartoDB, tiles salvos em cache
                offline, waypoints e trilhas GPS permanecem 100% operacionais.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadRainViewerRadar(true)}
            disabled={isLoadingRadar}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white shrink-0 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoadingRadar ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Tentar Radar Novamente</span>
          </button>
        </div>
      )}

      {/* Banner de Modo Desenho de Retângulo (2 Cliques) */}
      {isDrawingMissionBox && (
        <div
          role="status"
          className="rounded-2xl border border-sky-500/50 bg-sky-500/15 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-sky-900 dark:text-sky-200">
            <Maximize2 className="w-5 h-5 text-sky-500 shrink-0" aria-hidden="true" />
            <span>
              <strong>Modo Seleção de Retângulo Ativo:</strong>{' '}
              {!drawFirstCorner
                ? 'Toque no Canto 1 do mapa para iniciar a Área de Missão Offline.'
                : `Canto 1 marcado (${drawFirstCorner.latitude.toFixed(3)}, ${drawFirstCorner.longitude.toFixed(3)}). Agora toque no Canto 2 oposto.`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsDrawingMissionBox(false);
              setDrawFirstCorner(null);
            }}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white shrink-0"
          >
            <XCircle className="w-4 h-4" aria-hidden="true" />
            <span>Cancelar Desenho</span>
          </button>
        </div>
      )}

      {/* Container Principal do Mapa Leaflet + Player RainViewer */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-sm">
        <div className="relative w-full h-[420px] sm:h-[500px] lg:h-[540px] z-0">
          <MapContainer
            center={[activeLocation.latitude, activeLocation.longitude]}
            zoom={12}
            scrollWheelZoom={true}
            className="w-full h-full z-0"
          >
            {/* Subclasse customizada de L.TileLayer com leitura prioritária do IndexedDB (Dexie) */}
            <OfflineBaseTileLayer theme={tileTheme} />

            {/* Ponte de sincronização de viewport, centro e clique no mapa */}
            <MapViewportBridge
              centerLat={activeLocation.latitude}
              centerLon={activeLocation.longitude}
              recenterTrigger={recenterTrigger}
              onViewportChange={setViewport}
              onMapClick={handleMapClick}
            />

            {/* Overlay de Radar Animado RainViewer */}
            {radarEnabled && activeFrame && (
              <TileLayer
                key={activeFrame.path}
                url={activeFrame.tileUrlTemplate}
                opacity={radarOpacity}
                maxNativeZoom={radarState?.maxNativeZoom ?? 7}
                maxZoom={19}
                zIndex={250}
                attribution="RainViewer"
              />
            )}

            {/* Retângulo da Área de Missão Offline */}
            {showMissionOverlay && (
              <Rectangle
                bounds={[
                  [missionBounds.south, missionBounds.west],
                  [missionBounds.north, missionBounds.east],
                ]}
                pathOptions={{
                  color: tileEstimate.exceedsLimit ? '#f43f5e' : '#10b981',
                  weight: 2.5,
                  dashArray: '6 4',
                  fillColor: tileEstimate.exceedsLimit ? '#f43f5e' : '#10b981',
                  fillOpacity: 0.12,
                }}
              />
            )}

            {/* Marcador do Canto 1 durante desenho de retângulo */}
            {isDrawingMissionBox && drawFirstCorner && (
              <CircleMarker
                center={[drawFirstCorner.latitude, drawFirstCorner.longitude]}
                radius={8}
                pathOptions={{
                  color: '#0ea5e9',
                  fillColor: '#38bdf8',
                  fillOpacity: 0.9,
                  weight: 2,
                }}
              />
            )}

            {/* Marcador do Ponto Ativo com Resumo Meteorológico & Oceanográfico */}
            <Marker
              position={[activeLocation.latitude, activeLocation.longitude]}
              icon={activeMarkerIcon}
            >
              <Popup>
                <div className="min-w-[220px] space-y-2 text-slate-900">
                  <div className="border-b border-slate-200 pb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                      Ponto Operacional Ativo
                    </span>
                    <h4 className="font-bold text-sm">{activeLocation.name}</h4>
                    <p className="text-xs font-mono text-slate-600">
                      {activeLocation.latitude.toFixed(4)},{' '}
                      {activeLocation.longitude.toFixed(4)}
                    </p>
                  </div>

                  {currentForecastHour && forecast ? (
                    <div className="space-y-1.5 text-xs">
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-slate-100 p-1.5 rounded">
                          <span className="text-[10px] text-slate-500 block">
                            Vento 10m / Rajada
                          </span>
                          <strong className="font-mono">
                            {currentForecastHour.windSpeed10m.mean?.toFixed(1) ?? '—'} /{' '}
                            {currentForecastHour.windGusts10m.mean?.toFixed(1) ?? '—'}{' '}
                            km/h
                          </strong>
                        </div>
                        <div className="bg-slate-100 p-1.5 rounded">
                          <span className="text-[10px] text-slate-500 block">
                            Direção / Temp
                          </span>
                          <strong className="font-mono">
                            {currentForecastHour.windDirection10m.degree !== null
                              ? `${Math.round(currentForecastHour.windDirection10m.degree)}°`
                              : '—'}{' '}
                            •{' '}
                            {currentForecastHour.temperature2mC.mean?.toFixed(1) ?? '—'}
                            °C
                          </strong>
                        </div>
                      </div>

                      <div className="bg-slate-100 p-1.5 rounded flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">
                          Mar / Ondas:
                        </span>
                        <strong className="font-mono">
                          {forecast.marineAvailable && currentForecastHour.marine
                            ? `${currentForecastHour.marine.waveHeight?.toFixed(1) ?? '—'}m (${currentForecastHour.marine.wavePeriod?.toFixed(0) ?? '—'}s)`
                            : 'Continental (Sem grade)'}
                        </strong>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-[11px]">
                        <span>
                          Confiança:{' '}
                          <strong>{currentForecastHour.confidence.total}/100</strong>
                        </span>
                        <span>
                          Alt DEM: <strong>{Math.round(forecast.elevationDemM)}m</strong>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Aguardando sincronização da previsão horária...
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>

            {/* Marcadores de Locais Salvos */}
            {showSavedLocations &&
              savedLocations
                .filter(
                  (loc) =>
                    Math.abs(loc.latitude - activeLocation.latitude) > 0.0005 ||
                    Math.abs(loc.longitude - activeLocation.longitude) > 0.0005,
                )
                .map((loc) => (
                  <Marker
                    key={loc.id}
                    position={[loc.latitude, loc.longitude]}
                    icon={createSavedLocationIcon(loc.isFavorite)}
                  >
                    <Popup>
                      <div className="min-w-[200px] space-y-2 text-slate-900">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                            {loc.isFavorite ? '★ Ponto Favorito Salvo' : 'Ponto Salvo'}
                          </span>
                          <h4 className="font-bold text-sm">{loc.name}</h4>
                          <p className="text-xs font-mono text-slate-600">
                            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                          </p>
                          {loc.elevationM !== undefined && loc.elevationM !== null && (
                            <p className="text-xs text-slate-600">
                              Altitude DEM: {Math.round(loc.elevationM)} m
                            </p>
                          )}
                        </div>
                        {onSelectLocation && (
                          <button
                            type="button"
                            onClick={() =>
                              handleSelectMapCoordinate(
                                loc.latitude,
                                loc.longitude,
                                loc.name,
                                'saved',
                              )
                            }
                            className="w-full min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                          >
                            Tornar Ponto Ativo
                          </button>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}

            {/* Marcadores de Waypoints Georreferenciados com Foto e ConditionSnapshot */}
            {showWaypoints &&
              waypoints.map((wp) => {
                const safeBadge = formatSafeWindowLabel(wp.conditions.safeWindow);
                return (
                  <Marker
                    key={wp.id}
                    position={[wp.latitude, wp.longitude]}
                    icon={createWaypointIcon(Boolean(wp.photoDataUrl))}
                  >
                    <Popup>
                      <div className="min-w-[230px] max-w-[260px] space-y-2 text-slate-900">
                        <div className="border-b border-slate-200 pb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
                            Waypoint Georreferenciado
                          </span>
                          <h4 className="font-bold text-sm">{wp.name}</h4>
                          <p className="text-[11px] font-mono text-slate-600">
                            {wp.latitude.toFixed(4)}, {wp.longitude.toFixed(4)} • UTC{' '}
                            {wp.timestampUtcIso.slice(0, 16).replace('T', ' ')}
                          </p>
                        </div>

                        {wp.photoDataUrl && (
                          <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                            <img
                              src={wp.photoDataUrl}
                              alt={`Foto do waypoint ${wp.name}`}
                              className="w-full h-28 object-cover"
                            />
                            {wp.photoSizeKb && (
                              <span className="block text-[10px] text-right px-2 py-0.5 text-slate-500 font-mono">
                                {wp.photoSizeKb.toFixed(0)} KB
                              </span>
                            )}
                          </div>
                        )}

                        {wp.note && (
                          <p className="text-xs text-slate-700 bg-slate-100 p-2 rounded">
                            {wp.note}
                          </p>
                        )}

                        <div className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 space-y-1">
                          <div className="font-semibold text-slate-700">
                            Snapshot Meteorológico:
                          </div>
                          <div className="grid grid-cols-2 gap-1 font-mono">
                            <span>
                              Vento:{' '}
                              {wp.conditions.windSpeed10mKmh?.toFixed(1) ?? '—'} km/h
                            </span>
                            <span>
                              Rajada:{' '}
                              {wp.conditions.windGusts10mKmh?.toFixed(1) ?? '—'} km/h
                            </span>
                            <span>
                              Temp: {wp.conditions.temperature2mC?.toFixed(1) ?? '—'}°C
                            </span>
                            <span>
                              Onda:{' '}
                              {wp.conditions.waveHeightM !== null
                                ? `${wp.conditions.waveHeightM.toFixed(1)}m`
                                : 'Cont.'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-600 pt-0.5">
                            {safeBadge.label} • Confiança:{' '}
                            {wp.conditions.confidenceTotal ?? '—'}/100
                          </div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

            {/* Polylines de Trilhas GPS Gravadas (TrackSession[]) */}
            {showTracks &&
              tracks.map((track) => {
                if (track.points.length === 0) return null;
                const positions: [number, number][] = track.points.map((pt) => [
                  pt.latitude,
                  pt.longitude,
                ]);
                const firstPoint = track.points[0];
                const lastPoint = track.points[track.points.length - 1];

                return (
                  <React.Fragment key={track.id}>
                    {positions.length >= 2 && (
                      <Polyline
                        positions={positions}
                        pathOptions={{
                          color:
                            track.status === 'recording' ? '#0ea5e9' : '#10b981',
                          weight: 4,
                          opacity: 0.9,
                        }}
                      />
                    )}
                    {firstPoint && (
                      <CircleMarker
                        center={[firstPoint.latitude, firstPoint.longitude]}
                        radius={6}
                        pathOptions={{
                          color: '#ffffff',
                          fillColor: '#10b981',
                          fillOpacity: 1,
                          weight: 2,
                        }}
                      >
                        <Popup>
                          <div className="text-xs space-y-1 text-slate-900">
                            <strong className="block text-sm">{track.name}</strong>
                            <p>
                              Distância:{' '}
                              <strong>{track.totalDistanceKm.toFixed(2)} km</strong>
                            </p>
                            <p>
                              Pontos aceitos (&le;20m):{' '}
                              <strong>{track.points.length}</strong> (descartados:{' '}
                              {track.discardedLowAccuracyCount})
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Início UTC:{' '}
                              {track.startedAtIso.slice(0, 19).replace('T', ' ')}
                            </p>
                          </div>
                        </Popup>
                      </CircleMarker>
                    )}
                    {lastPoint && track.points.length > 1 && (
                      <CircleMarker
                        center={[lastPoint.latitude, lastPoint.longitude]}
                        radius={6}
                        pathOptions={{
                          color: '#ffffff',
                          fillColor: '#0284c7',
                          fillOpacity: 1,
                          weight: 2,
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}

            {/* Marcador de Inspeção ao Clicar no Mapa */}
            {inspectedPoint && (
              <Marker
                position={[inspectedPoint.latitude, inspectedPoint.longitude]}
                icon={inspectedMarkerIcon}
              >
                <Popup>
                  <div className="min-w-[200px] space-y-2 text-slate-900">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                        Coordenada Inspecionada
                      </span>
                      <p className="text-xs font-mono font-bold">
                        {inspectedPoint.latitude.toFixed(5)},{' '}
                        {inspectedPoint.longitude.toFixed(5)}
                      </p>
                    </div>
                    {onSelectLocation && (
                      <button
                        type="button"
                        onClick={() =>
                          handleSelectMapCoordinate(
                            inspectedPoint.latitude,
                            inspectedPoint.longitude,
                            `Ponto (${inspectedPoint.latitude.toFixed(3)}, ${inspectedPoint.longitude.toFixed(3)})`,
                            'search',
                          )
                        }
                        className="w-full min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                      >
                        Carregar Previsão Aqui
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>

        {/* Barra de Reprodução do Radar Animado RainViewer */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/80 p-3 sm:p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Botões Play/Pause, Passo Anterior/Próximo e Opacidade (todos >= 44x44px) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlayingRadar((prev) => !prev)}
                disabled={frames.length <= 1 || !radarEnabled}
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-sm transition-colors"
                aria-label={
                  isPlayingRadar ? 'Pausar animação do radar' : 'Reproduzir radar'
                }
              >
                {isPlayingRadar ? (
                  <>
                    <Pause className="w-4 h-4" aria-hidden="true" />
                    <span>Pausar</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" aria-hidden="true" />
                    <span>Play Radar</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlayingRadar(false);
                  setCurrentFrameIndex((prev) =>
                    frames.length > 0
                      ? (prev - 1 + frames.length) % frames.length
                      : 0,
                  );
                }}
                disabled={frames.length <= 1 || !radarEnabled}
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 inline-flex items-center justify-center"
                title="Quadro anterior do radar"
                aria-label="Quadro anterior do radar"
              >
                <SkipBack className="w-4 h-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlayingRadar(false);
                  setCurrentFrameIndex((prev) =>
                    frames.length > 0 ? (prev + 1) % frames.length : 0,
                  );
                }}
                disabled={frames.length <= 1 || !radarEnabled}
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-slate-700 dark:text-slate-200 inline-flex items-center justify-center"
                title="Próximo quadro do radar"
                aria-label="Próximo quadro do radar"
              >
                <SkipForward className="w-4 h-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setRadarOpacityIndex(
                    (prev) => (prev + 1) % RADAR_OPACITY_PRESETS.length,
                  )
                }
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                title="Alternar opacidade da camada de radar"
              >
                <Layers className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>Opacidade {Math.round(radarOpacity * 100)}%</span>
              </button>

              <button
                type="button"
                onClick={() => void loadRainViewerRadar(true)}
                disabled={isLoadingRadar}
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                title="Recarregar quadros do RainViewer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isLoadingRadar ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Atualizar Radar</span>
              </button>
            </div>

            {/* Slider Temporal & Timestamp do Frame */}
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  value={Math.min(currentFrameIndex, Math.max(0, frames.length - 1))}
                  disabled={frames.length <= 1 || !radarEnabled}
                  onChange={(e) => {
                    setIsPlayingRadar(false);
                    setCurrentFrameIndex(Number(e.target.value));
                  }}
                  aria-label="Linha do tempo do radar RainViewer"
                  className="w-full min-h-[44px] accent-sky-500 cursor-pointer disabled:opacity-40"
                />
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                {activeFrame ? (
                  <>
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${
                        activeFrame.isNowcast
                          ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30'
                          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      {activeFrame.isNowcast ? 'Nowcast (+30m)' : 'Observado'}
                    </span>
                    <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800">
                      {formatFrameTimestamp(activeFrame.timeUnix)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs font-mono text-slate-500">
                    {isLoadingRadar
                      ? 'Carregando quadros...'
                      : 'Sem quadros ativos'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Painel de Coordenada Inspecionada no Mapa (quando o usuário clica em um ponto) */}
      {inspectedPoint && (
        <section className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-600 dark:text-sky-300">
              <MapPin className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Ponto Selecionado no Mapa:{' '}
                <span className="font-mono">
                  {inspectedPoint.latitude.toFixed(4)},{' '}
                  {inspectedPoint.longitude.toFixed(4)}
                </span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Você pode consultar a previsão completa de 168h para esta coordenada ou
                salvá-la nos locais favoritos offline.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onSelectLocation && (
              <button
                type="button"
                onClick={() =>
                  handleSelectMapCoordinate(
                    inspectedPoint.latitude,
                    inspectedPoint.longitude,
                    `Ponto (${inspectedPoint.latitude.toFixed(3)}, ${inspectedPoint.longitude.toFixed(3)})`,
                    'search',
                  )
                }
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-sm"
              >
                Usar Esta Coordenada
              </button>
            )}
            {onSaveLocation && (
              <button
                type="button"
                onClick={() =>
                  handleSaveInspectedCoordinate(
                    inspectedPoint.latitude,
                    inspectedPoint.longitude,
                  )
                }
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
              >
                Salvar Favorito
              </button>
            )}
            <button
              type="button"
              onClick={() => setInspectedPoint(null)}
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        </section>
      )}

      {/* Ferramenta: Área de Missão Offline (Cache de Tiles CORS no IndexedDB) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                <span>Área de Missão Offline (Cache IndexedDB)</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                Máx {MAX_OFFLINE_TILES_PER_MISSION} tiles / missão •{' '}
                {MAX_CONCURRENT_TILE_DOWNLOADS} downloads simultâneos
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Selecione um retângulo no mapa e baixe os tiles CartoDB com CORS (
              <code>crossOrigin: &apos;anonymous&apos;</code>) para navegação em campo
              100% sem internet.
            </p>
          </div>

          {/* Resumo do Cache Salvo & Botão de Limpeza */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-xs">
              <div className="font-bold text-slate-900 dark:text-white">
                {cacheStats.totalTiles} tiles em cache ({formatBytes(cacheStats.totalBytes)})
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Claro: {cacheStats.lightTiles} • Escuro: {cacheStats.darkTiles}
              </div>
            </div>

            <button
              type="button"
              onClick={handleClearOfflineTileCache}
              disabled={cacheStats.totalTiles === 0 || isDownloadingTiles}
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40 text-rose-700 dark:text-rose-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span>Limpar Cache</span>
            </button>
          </div>
        </div>

        {/* Controles de Definição do Retângulo e Níveis de Zoom */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Coluna 1: Seleção da Área Geográfica */}
          <div className="lg:col-span-7 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              1. Definir Retângulo da Missão
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleUseCurrentViewportForMission}
                disabled={isDownloadingTiles}
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-700 transition-colors"
              >
                <Compass className="w-4 h-4 text-sky-400" aria-hidden="true" />
                <span>Usar Visão Atual do Mapa</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsDrawingMissionBox((prev) => !prev);
                  setDrawFirstCorner(null);
                }}
                disabled={isDownloadingTiles}
                aria-pressed={isDrawingMissionBox}
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  isDrawingMissionBox
                    ? 'bg-sky-600 text-white border-sky-500'
                    : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Maximize2 className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isDrawingMissionBox
                    ? 'Desenhando (2 Cliques)...'
                    : 'Desenhar no Mapa (2 Cliques)'}
                </span>
              </button>

              {MISSION_RADIUS_PRESETS_KM.map((radiusKm) => (
                <button
                  key={radiusKm}
                  type="button"
                  onClick={() => handleSelectRadiusPreset(radiusKm)}
                  disabled={isDownloadingTiles}
                  className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                    selectedRadiusKm === radiusKm
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-800 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-slate-800/70 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                >
                  Raio {radiusKm} km
                </button>
              ))}
            </div>

            {/* Coordenadas do Retângulo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div>
                <span className="text-[10px] uppercase text-slate-500 block">
                  Norte (Lat)
                </span>
                <strong>{missionBounds.north.toFixed(4)}°</strong>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-500 block">
                  Sul (Lat)
                </span>
                <strong>{missionBounds.south.toFixed(4)}°</strong>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-500 block">
                  Leste (Lon)
                </span>
                <strong>{missionBounds.east.toFixed(4)}°</strong>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-500 block">
                  Oeste (Lon)
                </span>
                <strong>{missionBounds.west.toFixed(4)}°</strong>
              </div>
            </div>

            {/* Seleção de Níveis de Zoom */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Zoom Mínimo ({missionBounds.minZoom})
                </span>
                <select
                  value={missionBounds.minZoom}
                  disabled={isDownloadingTiles}
                  onChange={(e) =>
                    handleZoomRangeChange('minZoom', Number(e.target.value))
                  }
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-900 dark:text-white"
                >
                  {[8, 9, 10, 11, 12, 13, 14, 15, 16].map((z) => (
                    <option key={z} value={z}>
                      Zoom {z} {z <= 10 ? '(Regional)' : z <= 13 ? '(Local)' : '(Detalhe)'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Zoom Máximo ({missionBounds.maxZoom})
                </span>
                <select
                  value={missionBounds.maxZoom}
                  disabled={isDownloadingTiles}
                  onChange={(e) =>
                    handleZoomRangeChange('maxZoom', Number(e.target.value))
                  }
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-900 dark:text-white"
                >
                  {[8, 9, 10, 11, 12, 13, 14, 15, 16].map((z) => (
                    <option key={z} value={z}>
                      Zoom {z} {z <= 10 ? '(Regional)' : z <= 13 ? '(Local)' : '(Detalhe)'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Coluna 2: Estimativa de Tiles, Trava de 300 Tiles e Progresso de Download */}
          <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  2. Estimativa &amp; Trava de Segurança
                </span>
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${
                    tileEstimate.exceedsLimit
                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                  }`}
                >
                  {tileEstimate.totalTiles} / {MAX_OFFLINE_TILES_PER_MISSION} tiles
                </span>
              </div>

              {/* Barra visual de ocupação do limite de 300 tiles */}
              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    tileEstimate.exceedsLimit
                      ? 'bg-rose-500'
                      : tileEstimate.totalTiles > 220
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (tileEstimate.totalTiles / MAX_OFFLINE_TILES_PER_MISSION) *
                          100,
                      ),
                    )}%`,
                  }}
                />
              </div>

              {/* Distribuição por nível de zoom */}
              <div className="flex flex-wrap gap-1.5">
                {tileEstimate.byZoom.map((item) => (
                  <span
                    key={item.zoom}
                    className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300"
                  >
                    Z{item.zoom}: <strong>{item.count}</strong>
                  </span>
                ))}
              </div>

              {/* Alerta bloqueante caso ultrapasse 300 tiles */}
              {tileEstimate.exceedsLimit && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200"
                >
                  <ShieldAlert
                    className="w-5 h-5 text-rose-500 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <strong className="block">
                      Limite de {MAX_OFFLINE_TILES_PER_MISSION} tiles excedido (
                      {tileEstimate.totalTiles} estimados)
                    </strong>
                    <span>
                      Reduza o raio da área ou diminua o Zoom Máximo para liberar o
                      download offline.
                    </span>
                  </div>
                </div>
              )}

              {/* Barra de Progresso do Download em Tempo Real */}
              {downloadProgress && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                      {downloadProgress.status === 'downloading' && (
                        <RefreshCw
                          className="w-3.5 h-3.5 animate-spin text-sky-500"
                          aria-hidden="true"
                        />
                      )}
                      {downloadProgress.status === 'completed' && (
                        <CheckCircle2
                          className="w-3.5 h-3.5 text-emerald-500"
                          aria-hidden="true"
                        />
                      )}
                      {downloadProgress.status === 'cancelled' && (
                        <XCircle
                          className="w-3.5 h-3.5 text-amber-500"
                          aria-hidden="true"
                        />
                      )}
                      {downloadProgress.status === 'error' && (
                        <AlertTriangle
                          className="w-3.5 h-3.5 text-rose-500"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        {downloadProgress.status === 'downloading'
                          ? 'Baixando tiles (máx 4 simultâneos)...'
                          : downloadProgress.status === 'completed'
                            ? 'Download finalizado'
                            : downloadProgress.status === 'cancelled'
                              ? 'Download cancelado'
                              : 'Falha no download'}
                      </span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {downloadProgress.completedTiles}/{downloadProgress.totalTiles}{' '}
                      ({progressPct}%)
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-150"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {downloadProgress.failedTiles > 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {downloadProgress.failedTiles} tile(s) falharam por rede/CORS e
                      foram ignorados com segurança.
                    </p>
                  )}
                  {downloadProgress.errorMessage && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">
                      {downloadProgress.errorMessage}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Botões de Download e Cancelamento (ambos >= 44x44px) */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleStartOfflineDownload}
                disabled={
                  isDownloadingTiles ||
                  tileEstimate.exceedsLimit ||
                  tileEstimate.totalTiles === 0
                }
                className="flex-1 min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 disabled:cursor-not-allowed text-white shadow-sm transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isDownloadingTiles
                    ? 'Baixando Missão...'
                    : `Baixar ${tileEstimate.totalTiles} Tiles (${isDark ? 'Escuro' : 'Claro'})`}
                </span>
              </button>

              {isDownloadingTiles && (
                <button
                  type="button"
                  onClick={handleCancelOfflineDownload}
                  className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors"
                >
                  <XCircle className="w-4 h-4" aria-hidden="true" />
                  <span>Cancelar</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Aba Mapa & Radar encapsulada em `<ModuleErrorBoundary>` para isolamento Zero-Crash.
 */
export function MapRadarTab(props: MapRadarTabProps): React.ReactElement {
  return (
    <ModuleErrorBoundary
      moduleName="Aba Mapa Interativo, Radar RainViewer & Cache Offline"
      fallbackDescription="Falha isolada no motor cartográfico Leaflet ou camada de radar. As abas Previsão e Campo & Dados continuam operacionais."
      onErrorLog={props.onErrorLog}
    >
      <MapRadarTabContent {...props} />
    </ModuleErrorBoundary>
  );
}

export default MapRadarTab;
