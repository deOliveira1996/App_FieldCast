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
  Circle,
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
  CloudRain,
  Compass,
  Crosshair,
  Download,
  HardDrive,
  Layers,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Route,
  ShieldAlert,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Thermometer,
  Trash2,
  Unlock,
  Waves,
  Wind,
  XCircle,
} from 'lucide-react';
import { ModuleErrorBoundary } from '../common';
import { WeatherModelOverlayLayer } from './WeatherModelOverlayLayer';
import {
  createWindyFlagPinIcon,
  degreesToCardinal,
} from '../common/LocationPinMapPicker';
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
  type MapBaseStyle,
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
import {
  buildOfflineFallbackSpatialGrid,
  extractGridSnapshotAtHour,
  fetchOpenMeteoSpatialGrid,
  getLayerLegendSpec,
  getModelModeDisplayName,
  interpolateGridValueAtPoint,
  type MapModelMode,
  type SpatialGridForecast,
  type WeatherMapLayerId,
} from '../../services/weatherGridService';
import type {
  ActiveCoordinates,
  OfflineMissionBounds,
  SavedLocation,
  TrackSession,
  Waypoint,
} from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type {
  ForecastViewMode,
  NormalizedForecast,
  SafeWindowStatus,
} from '../../types/weather';
import {
  findCurrentLocalHourIndex,
  formatLocalHourBadge,
} from '../../utils/localTimeHour';
import { safeAction } from '../../utils/safeAction';

export interface MapRadarTabProps {
  activeLocation: ActiveCoordinates;
  forecast?: NormalizedForecast | null;
  savedLocations?: SavedLocation[];
  waypoints?: Waypoint[];
  tracks?: TrackSession[];
  isDark?: boolean;
  viewMode?: ForecastViewMode;
  onViewModeChange?: (mode: ForecastViewMode) => void;
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
const FORECAST_AREA_RADIUS_OPTIONS_KM = [0, 2, 5, 10, 25] as const;

const BASE_MAP_STYLES: ReadonlyArray<{
  id: MapBaseStyle;
  label: string;
  shortLabel: string;
}> = [
  { id: 'osm', label: 'Mapa Padrão (OSM)', shortLabel: 'Padrão OSM' },
  {
    id: 'esri_street',
    label: 'Costeiro & Ruas (Esri)',
    shortLabel: 'Costeiro Esri',
  },
  { id: 'esri_satellite', label: 'Satélite (Esri)', shortLabel: 'Satélite' },
];

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
      label: 'Condição Favorável (Verde)',
      badgeClass:
        'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
    };
  }
  if (status === 'red') {
    return {
      label: 'Acima do Limite (Vermelho)',
      badgeClass:
        'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-700',
    };
  }
  return {
    label: 'Atenção Moderada (Amarelo)',
    badgeClass:
      'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-700',
  };
}

function createSavedLocationIcon(isFavorite: boolean): L.DivIcon {
  const bg = isFavorite ? '#0284c7' : '#38bdf8';
  return L.divIcon({
    className: 'fieldcast-saved-location-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `
      <div style="width:28px;height:28px;border-radius:9999px;background:${bg};border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(2,132,199,0.45);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:13px;font-weight:700;">
        ★
      </div>
    `,
  });
}

function createWaypointIcon(hasPhoto: boolean): L.DivIcon {
  const bg = hasPhoto ? '#0ea5e9' : '#10b981';
  const symbol = hasPhoto ? '📷' : '⚑';
  return L.divIcon({
    className: 'fieldcast-waypoint-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
    html: `
      <div style="width:30px;height:30px;border-radius:10px;background:${bg};border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:13px;font-weight:700;">
        ${symbol}
      </div>
    `,
  });
}

/**
 * Monta e sincroniza a subclasse `OfflineCartoTileLayer` (com `createTile()` lendo primeiro do Dexie
 * e caindo nos servidores gratuitos OpenStreetMap / Esri sem API Key).
 */
function OfflineBaseTileLayer({
  theme,
  baseStyle,
}: {
  theme: MapTileTheme;
  baseStyle: MapBaseStyle;
}): null {
  const map = useMap();
  const layerRef = useRef<OfflineCartoTileLayer | null>(null);

  useEffect(() => {
    const layer = createOfflineCartoTileLayer(theme, { baseStyle });
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
      layerRef.current.setBaseStyle(baseStyle);
    }
  }, [theme, baseStyle]);

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
  layoutKey,
  onViewportChange,
  onMapClick,
}: {
  centerLat: number;
  centerLon: number;
  recenterTrigger: number;
  layoutKey: string;
  onViewportChange: (viewport: ViewportSnapshot) => void;
  onMapClick: (lat: number, lon: number) => void;
}): null {
  const map = useMap();
  const mapRef = useRef(map);
  mapRef.current = map;
  const prevCenterRef = useRef<{ lat: number; lon: number; trigger: number }>({
    lat: centerLat,
    lon: centerLon,
    trigger: recenterTrigger,
  });

  const emitViewport = useCallback(() => {
    try {
      const b = mapRef.current.getBounds();
      onViewportChange({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
        zoom: mapRef.current.getZoom(),
      });
    } catch {
      // Ignora caso o mapa ainda não esteja inicializado
    }
  }, [onViewportChange]);

  const emitViewportRef = useRef(emitViewport);
  emitViewportRef.current = emitViewport;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        mapRef.current.invalidateSize();
      } catch {
        // Ignora em ambiente headless de teste
      }
      emitViewportRef.current();
    }, 80);
    emitViewportRef.current();
    return () => window.clearTimeout(timer);
  }, [layoutKey]);

  useEffect(() => {
    let settleTimer: number | null = null;
    const handleViewportRefresh = () => {
      try {
        mapRef.current.invalidateSize();
      } catch {
        // Ignora em ambiente headless de teste
      }
      emitViewportRef.current();
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        try {
          mapRef.current.invalidateSize();
        } catch {
          // Ignora em ambiente headless de teste
        }
        emitViewportRef.current();
      }, 80);
    };

    window.addEventListener('resize', handleViewportRefresh);
    window.addEventListener('orientationchange', handleViewportRefresh);
    window.addEventListener('fieldcast:layout-refresh', handleViewportRefresh);

    return () => {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      window.removeEventListener('resize', handleViewportRefresh);
      window.removeEventListener('orientationchange', handleViewportRefresh);
      window.removeEventListener('fieldcast:layout-refresh', handleViewportRefresh);
    };
  }, []);

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
      const currentCenter =
        typeof mapRef.current.getCenter === 'function'
          ? mapRef.current.getCenter()
          : null;
      const alreadyNearCenter =
        currentCenter &&
        Math.abs(currentCenter.lat - centerLat) < 0.0002 &&
        Math.abs(currentCenter.lng - centerLon) < 0.0002;
      if (!alreadyNearCenter || triggerChanged) {
        mapRef.current.setView([centerLat, centerLon], mapRef.current.getZoom(), {
          animate: triggerChanged,
        });
      }
      emitViewportRef.current();
    }
  }, [centerLat, centerLon, recenterTrigger]);

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

const MAP_MODEL_OPTIONS: ReadonlyArray<{
  id: MapModelMode;
  label: string;
}> = [
  { id: 'fieldcast', label: 'FieldCast Ensemble' },
  { id: 'ecmwf_ifs025', label: 'ECMWF 9 km' },
  { id: 'gfs_seamless', label: 'GFS 13 km' },
  { id: 'icon_seamless', label: 'ICON 13 km' },
  { id: 'gem_seamless', label: 'GEM 15 km' },
];

const WEATHER_LAYER_OPTIONS: ReadonlyArray<{
  id: WeatherMapLayerId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'wind', label: 'Vento + Vetores', Icon: Wind },
  { id: 'rain', label: 'Chuva (Modelo)', Icon: CloudRain },
  { id: 'temperature', label: 'Temperatura', Icon: Thermometer },
  { id: 'waves', label: 'Ondas (Mar)', Icon: Waves },
  { id: 'none', label: 'Só Radar/Mapa', Icon: Layers },
];

function MapRadarTabContent({
  activeLocation,
  forecast,
  savedLocations: savedLocationsProp,
  waypoints: waypointsProp,
  tracks: tracksProp,
  isDark = false,
  viewMode,
  onViewModeChange,
  onSelectLocation,
  onSaveLocation,
  onRadarStateChange,
  onToast,
  onErrorLog,
}: MapRadarTabProps): React.ReactElement {
  const tileTheme: MapTileTheme = isDark ? 'dark' : 'light';

  // Estilo de Mapa Base (100% gratuito, sem API Key)
  const [baseStyle, setBaseStyle] = useState<MapBaseStyle>('osm');

  // Modelo Meteorológico e Camada Visual no Mapa
  const [internalMapModel, setInternalMapModel] = useState<MapModelMode>('fieldcast');
  const mapModelMode: MapModelMode =
    viewMode && viewMode !== 'spaghetti' ? viewMode : internalMapModel;

  const handleMapModelSelect = (nextModel: MapModelMode) => {
    setInternalMapModel(nextModel);
    onViewModeChange?.(nextModel);
  };

  const [activeWeatherLayer, setActiveWeatherLayer] =
    useState<WeatherMapLayerId>('wind');
  const lastActiveWeatherLayerRef =
    useRef<Exclude<WeatherMapLayerId, 'none'>>('wind');
  if (activeWeatherLayer !== 'none') {
    lastActiveWeatherLayerRef.current = activeWeatherLayer;
  }
  const [timelineMode, setTimelineMode] = useState<'rainviewer' | 'model'>('rainviewer');
  const [selectedModelHourIdx, setSelectedModelHourIdx] = useState<number>(() =>
    findCurrentLocalHourIndex(forecast?.hours, forecast?.timezone),
  );
  const [liveSpatialGrid, setLiveSpatialGrid] = useState<SpatialGridForecast | null>(
    null,
  );
  const [isLoadingSpatialGrid, setIsLoadingSpatialGrid] = useState<boolean>(false);
  const [radarTileErrorCount, setRadarTileErrorCount] = useState<number>(0);

  // Modo Pin estilo Windy, Trava Reativa de Marcador (Pin-Lock), Tela Cheia e Gaveta Windy
  const [instantWindyPin, setInstantWindyPin] = useState<boolean>(true);
  const [isPinLocked, setIsPinLocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [forecastAreaRadiusKm, setForecastAreaRadiusKm] = useState<number>(5);
  const [customPinName, setCustomPinName] = useState<string>('');

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

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
  const handleViewportChange = useCallback((next: ViewportSnapshot) => {
    setViewport((prev) => {
      if (
        prev.zoom === next.zoom &&
        Math.abs(prev.north - next.north) < 1e-5 &&
        Math.abs(prev.south - next.south) < 1e-5 &&
        Math.abs(prev.east - next.east) < 1e-5 &&
        Math.abs(prev.west - next.west) < 1e-5
      ) {
        return prev;
      }
      return next;
    });
  }, []);
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
          setRadarTileErrorCount(0);
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

  // Sincroniza hora local padrão quando a previsão muda
  const currentLocalHourIdx = useMemo(
    () => findCurrentLocalHourIndex(forecast?.hours, forecast?.timezone),
    [forecast?.hours, forecast?.timezone],
  );

  useEffect(() => {
    setSelectedModelHourIdx(currentLocalHourIdx);
  }, [forecast?.locationKey, currentLocalHourIdx]);

  // Se o ponto for continental e camada atual for ondas, volta automaticamente para vento
  useEffect(() => {
    if (activeWeatherLayer === 'waves' && forecast && !forecast.marineAvailable) {
      setActiveWeatherLayer('wind');
    }
  }, [activeWeatherLayer, forecast]);

  // Busca grade espacial real multi-modelo na Open-Meteo (com debounce leve ao mover mapa)
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsLoadingSpatialGrid(true);
      void fetchOpenMeteoSpatialGrid(viewport, {
        forecastDays: 2,
        signal: controller.signal,
        anchorForecast: forecast,
      })
        .then((grid) => {
          if (!cancelled && grid) {
            setLiveSpatialGrid(grid);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoadingSpatialGrid(false);
          }
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeLocation.latitude,
    activeLocation.longitude,
    viewport.north.toFixed(2),
    viewport.south.toFixed(2),
    viewport.east.toFixed(2),
    viewport.west.toFixed(2),
    forecast,
  ]);

  const fallbackSpatialGrid = useMemo(
    () => buildOfflineFallbackSpatialGrid(forecast, viewport),
    [forecast, viewport],
  );

  const activeSpatialGrid = liveSpatialGrid ?? fallbackSpatialGrid;
  const maxModelTimelineHours = useMemo(() => {
    const fcLen = forecast?.hours.length ?? 0;
    const gridLen = activeSpatialGrid.byModel[mapModelMode]?.length ?? 0;
    return Math.max(1, Math.min(48, Math.max(fcLen, gridLen)));
  }, [activeSpatialGrid.byModel, forecast?.hours.length, mapModelMode]);

  // Loop de animação (RainViewer ou Previsão do Modelo)
  const frames = radarState?.frames ?? [];
  const activeFrame: RadarAnimationFrame | undefined =
    frames[currentFrameIndex] ?? frames[0];

  useEffect(() => {
    if (!isPlayingRadar) {
      return;
    }
    if (timelineMode === 'rainviewer') {
      if (!radarEnabled || frames.length <= 1) return;
      const timer = window.setInterval(() => {
        setCurrentFrameIndex((prev) => (prev + 1) % frames.length);
      }, 650);
      return () => window.clearInterval(timer);
    }

    if (maxModelTimelineHours <= 1) return;
    const timer = window.setInterval(() => {
      setSelectedModelHourIdx((prev) => (prev + 1) % maxModelTimelineHours);
    }, 750);
    return () => window.clearInterval(timer);
  }, [
    isPlayingRadar,
    timelineMode,
    radarEnabled,
    frames.length,
    maxModelTimelineHours,
  ]);

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

  // Hora ativa da previsão (sincronizada com o slider de modelo ou janela horária local)
  const safeModelHourIdx = Math.max(
    0,
    Math.min((forecast?.hours.length ?? 1) - 1, selectedModelHourIdx),
  );
  const currentForecastHour = useMemo(() => {
    if (!forecast || forecast.hours.length === 0) return null;
    return forecast.hours[safeModelHourIdx] ?? forecast.hours[0] ?? null;
  }, [forecast, safeModelHourIdx]);

  const activeNativeModelHour = useMemo(() => {
    if (!forecast || mapModelMode === 'fieldcast') return null;
    return forecast.nativeByModel[mapModelMode]?.[safeModelHourIdx] ?? null;
  }, [forecast, mapModelMode, safeModelHourIdx]);

  const activeMapGridSlice = useMemo(
    () =>
      extractGridSnapshotAtHour(
        activeSpatialGrid,
        mapModelMode,
        safeModelHourIdx,
        currentForecastHour?.timestampUnix,
      ),
    [activeSpatialGrid, mapModelMode, safeModelHourIdx, currentForecastHour?.timestampUnix],
  );

  const activeModelDisplayName = getModelModeDisplayName(mapModelMode);
  const activeLegendSpec = getLayerLegendSpec(activeWeatherLayer);

  const handleSelectMapCoordinate = useCallback(
    (
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
        },
        {
          actionKey: 'select_map_coordinate',
          moduleName: 'MapRadarTab',
          successTitle: `Pin de Previsão atualizado: ${name}`,
          errorTitle: 'Não foi possível selecionar a coordenada no mapa',
          onToast,
          onErrorLog: handleLogError,
        },
      );
    },
    [onSelectLocation, onToast, handleLogError],
  );

  // Clique no mapa: ou desenha os 2 cantos da Área de Missão ou posiciona o Pin estilo Windy
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

      const roundedLat = Number(lat.toFixed(5));
      const roundedLon = Number(lon.toFixed(5));
      setInspectedPoint({
        latitude: roundedLat,
        longitude: roundedLon,
      });

      if (isPinLocked) {
        return;
      }

      if (instantWindyPin && onSelectLocation) {
        const trimmed = customPinName.trim();
        const areaLabel =
          forecastAreaRadiusKm > 0 ? ` • Área ${forecastAreaRadiusKm}km` : '';
        const pinLabel =
          trimmed.length > 0
            ? `${trimmed}${areaLabel}`
            : `Pin no Mapa (${roundedLat.toFixed(3)}, ${roundedLon.toFixed(3)}${areaLabel})`;
        handleSelectMapCoordinate(roundedLat, roundedLon, pinLabel, 'search');
      }
    },
    [
      isDrawingMissionBox,
      drawFirstCorner,
      missionBounds.minZoom,
      missionBounds.maxZoom,
      onToast,
      isPinLocked,
      instantWindyPin,
      onSelectLocation,
      customPinName,
      forecastAreaRadiusKm,
      handleSelectMapCoordinate,
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
          baseStyle,
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

        const styleName =
          BASE_MAP_STYLES.find((s) => s.id === baseStyle)?.label ?? 'OpenStreetMap';

        if (result.status === 'completed') {
          onToast?.({
            type: result.failedTiles > 0 ? 'warning' : 'success',
            title:
              result.failedTiles > 0
                ? `Cache concluído (${result.completedTiles} salvos, ${result.failedTiles} falhas)`
                : `Área de Missão salva offline (${result.completedTiles} tiles)`,
            message: `Tiles (${styleName}) armazenados no IndexedDB para uso sem internet.`,
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

  const handleSaveInspectedCoordinate = (
    latitude: number,
    longitude: number,
  ): void => {
    if (!onSaveLocation) return;
    const trimmed = customPinName.trim();
    const defaultName =
      trimmed.length > 0
        ? trimmed
        : `Pin de Previsão (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;
    void safeAction(
      async () => {
        await onSaveLocation({
          name: defaultName,
          latitude,
          longitude,
          region:
            forecastAreaRadiusKm > 0
              ? `Pin no Mapa (Área ${forecastAreaRadiusKm} km)`
              : 'Marcado via Pin Interativo',
          isFavorite: true,
        });
        const locs = await getSavedLocations();
        setDbSavedLocations(locs);
      },
      {
        actionKey: 'save_inspected_map_coordinate',
        moduleName: 'MapRadarTab',
        successTitle: 'Pin salvo nos Locais Favoritos',
        errorTitle: 'Não foi possível salvar a coordenada',
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  const activeWindSpeed =
    mapModelMode === 'fieldcast'
      ? currentForecastHour?.windSpeed10m.mean ?? null
      : activeNativeModelHour?.windSpeed10m ?? currentForecastHour?.windSpeed10m.mean ?? null;
  const activeWindDir =
    mapModelMode === 'fieldcast'
      ? currentForecastHour?.windDirection10m.degree ?? null
      : activeNativeModelHour?.windDirection10m ?? currentForecastHour?.windDirection10m.degree ?? null;
  const activeTempC =
    mapModelMode === 'fieldcast'
      ? currentForecastHour?.temperature2mC.mean ?? null
      : activeNativeModelHour?.temperature2m ?? currentForecastHour?.temperature2mC.mean ?? null;
  const activePrecipMm =
    mapModelMode === 'fieldcast'
      ? currentForecastHour?.precipitationMm.mean ?? null
      : activeNativeModelHour?.precipitation ?? currentForecastHour?.precipitationMm.mean ?? null;

  // Ícone de Bandeirinha Estilo Windy para o Ponto Ativo (sincronizado com modelo & hora selecionados)
  const activeWindyFlagIcon = useMemo(() => {
    const cardinal = degreesToCardinal(activeWindDir);

    const titleText =
      activeWindSpeed !== null && activeWindSpeed !== undefined
        ? `${Math.round(activeWindSpeed)} km/h ${cardinal ? `◄ ${cardinal}` : ''}${
            activeTempC !== null && activeTempC !== undefined ? ` • ${Math.round(activeTempC)}°C` : ''
          }`
        : `${activeLocation.latitude.toFixed(3)}°, ${activeLocation.longitude.toFixed(3)}°`;

    return createWindyFlagPinIcon({
      titleText,
      subtitleText: activeLocation.name.slice(0, 26),
      ctaText:
        forecastAreaRadiusKm > 0
          ? `${activeModelDisplayName} • Área ${forecastAreaRadiusKm} km`
          : `${activeModelDisplayName} • Pin Ativo`,
      isPending: false,
    });
  }, [
    activeWindSpeed,
    activeWindDir,
    activeTempC,
    activeLocation,
    forecastAreaRadiusKm,
    activeModelDisplayName,
  ]);

  // Ícone de Bandeirinha Estilo Windy quando o usuário inspeciona outro ponto sem aplicar automaticamente
  const inspectedWindyFlagIcon = useMemo(() => {
    if (!inspectedPoint) return null;
    return createWindyFlagPinIcon({
      titleText: `${inspectedPoint.latitude.toFixed(3)}°, ${inspectedPoint.longitude.toFixed(3)}°`,
      subtitleText: customPinName.trim() || 'Novo Pin no Mapa',
      ctaText: isPinLocked ? 'Pin Fixado (Consulta)' : 'Previsão para este local',
      isPending: true,
    });
  }, [inspectedPoint, customPinName, isPinLocked]);

  // Valores interpolados da grade 3x3 no ponto consultado quando o Pin está fixado
  const lockedGridSample = useMemo(() => {
    if (!isPinLocked || !inspectedPoint) return null;
    const pts = activeMapGridSlice?.points ?? [];
    if (pts.length === 0) return null;
    const wind = interpolateGridValueAtPoint(
      pts,
      inspectedPoint.latitude,
      inspectedPoint.longitude,
      'wind',
    );
    const rain = interpolateGridValueAtPoint(
      pts,
      inspectedPoint.latitude,
      inspectedPoint.longitude,
      'rain',
    );
    const temp = interpolateGridValueAtPoint(
      pts,
      inspectedPoint.latitude,
      inspectedPoint.longitude,
      'temperature',
    );
    return {
      windSpeedKmh: wind.value,
      windDirectionDeg: wind.windDirectionDeg,
      precipMm: rain.value,
      tempC: temp.value,
    };
  }, [isPinLocked, inspectedPoint, activeMapGridSlice?.points]);

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

  const activeBaseStyleLabel =
    BASE_MAP_STYLES.find((s) => s.id === baseStyle)?.label ??
    'Mapa Padrão (OSM)';

  return (
    <div className="space-y-4 pb-8 min-w-0">
      {/* Aviso Suave Não-Bloqueante quando RainViewer estiver degradado ou indisponível */}
      {!isFullscreen && radarState && (radarState.degraded || !radarState.available) && (
        <div
          role="status"
          className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0"
        >
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full bg-amber-400 shrink-0 mt-1.5"
              aria-hidden="true"
            />
            <div className="text-xs sm:text-sm min-w-0">
              <p className="font-bold text-slate-800 dark:text-amber-200">
                Radar RainViewer temporariamente indisponível
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                {radarState.statusMessage}. O mapa interativo ({activeBaseStyleLabel}),
                o Pin de previsão estilo Windy e o cache offline funcionam normalmente.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadRainViewerRadar(true)}
            disabled={isLoadingRadar}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 shrink-0 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoadingRadar ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Recarregar Radar</span>
          </button>
        </div>
      )}

      {/* Banner de Modo Desenho de Retângulo (2 Cliques) */}
      {!isFullscreen && isDrawingMissionBox && (
        <div
          role="status"
          className="rounded-2xl border border-sky-300 bg-sky-50/90 dark:bg-sky-950/50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0"
        >
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-sky-900 dark:text-sky-200 min-w-0">
            <Maximize2 className="w-5 h-5 text-sky-600 shrink-0" aria-hidden="true" />
            <span>
              <strong>Modo Seleção de Área Offline (2 Cliques):</strong>{' '}
              {!drawFirstCorner
                ? 'Clique no Canto 1 do mapa para iniciar o retângulo.'
                : `Canto 1 marcado (${drawFirstCorner.latitude.toFixed(3)}°, ${drawFirstCorner.longitude.toFixed(3)}°). Agora clique no Canto 2 oposto.`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsDrawingMissionBox(false);
              setDrawFirstCorner(null);
            }}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-sky-200 shrink-0"
          >
            <XCircle className="w-4 h-4" aria-hidden="true" />
            <span>Cancelar Desenho</span>
          </button>
        </div>
      )}

      {/* Container Principal do Mapa Leaflet + Controles Táticos (Pin-Lock, Tela Cheia, Gaveta Windy) + Player RainViewer */}
      <section
        data-testid="map-main-section"
        className={
          isFullscreen
            ? 'fixed inset-0 z-[80] flex flex-col bg-slate-950 overflow-hidden'
            : 'rounded-2xl border border-sky-200/80 dark:border-sky-900/60 bg-white dark:bg-slate-900/90 overflow-hidden shadow-sm min-w-0'
        }
      >
        {/* Barra Tática Superior (Normal: topo do card | Tela Cheia: flutuante sobre o mapa) */}
        <div
          className={
            isFullscreen
              ? 'absolute top-2.5 left-14 right-2.5 sm:right-auto sm:max-w-[calc(100vw-22rem)] z-[520] rounded-2xl border border-slate-700/90 bg-slate-900/95 backdrop-blur-md p-2.5 sm:p-3 shadow-2xl space-y-2 min-w-0'
              : 'border-b border-sky-100 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-3.5 sm:p-4 space-y-2.5 min-w-0'
          }
        >
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 min-w-0">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-sky-600 text-white shadow-sm">
                  <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Mapa &amp; Radar</span>
                </span>
                {!isFullscreen && (
                  <>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                      100% Gratuito • {activeBaseStyleLabel}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <HardDrive className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Cache Offline: {cacheStats.totalTiles} tiles</span>
                    </span>
                  </>
                )}
              </div>
              <p
                className={`text-xs truncate ${
                  isFullscreen
                    ? 'text-slate-200'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Pin ativo:{' '}
                <strong className={isFullscreen ? 'text-white' : 'text-sky-900 dark:text-white'}>
                  {activeLocation.name}
                </strong>{' '}
                ({activeLocation.latitude.toFixed(4)}°, {activeLocation.longitude.toFixed(4)}°)
                {forecast ? ` • DEM: ${Math.round(forecast.elevationDemM)}m` : ''}
              </p>
            </div>

            {/* Botões Principais: Pin-Lock Reativo, Gaveta Windy, Centralizar e Tela Cheia */}
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <button
                type="button"
                data-testid="map-pin-lock-btn"
                onClick={() => setIsPinLocked((prev) => !prev)}
                aria-pressed={isPinLocked}
                title={
                  isPinLocked
                    ? 'Pin Fixado: navegue por oceanos/continentes e inspecione a grade 3x3 sem alterar a previsão ativa'
                    : 'Pin Livre: clicar ou arrastar no mapa atualiza o marcador de previsão'
                }
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
                  isPinLocked
                    ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                    : isFullscreen
                      ? 'bg-emerald-950/80 text-emerald-200 border-emerald-700 hover:bg-emerald-900/80'
                      : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100/80'
                }`}
              >
                {isPinLocked ? (
                  <>
                    <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Pin Fixado</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Pin Livre</span>
                  </>
                )}
              </button>

              <button
                type="button"
                data-testid="map-sidebar-toggle"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                aria-expanded={isSidebarOpen}
                aria-controls="map-windy-controls-drawer"
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
                  isSidebarOpen
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                    : isFullscreen
                      ? 'bg-slate-800 text-sky-200 border-slate-700 hover:bg-slate-700'
                      : 'bg-sky-50 dark:bg-slate-800 text-sky-900 dark:text-sky-200 border-sky-200 dark:border-slate-700 hover:bg-sky-100'
                }`}
              >
                {isSidebarOpen ? (
                  <>
                    <PanelRightClose className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Ocultar Gaveta</span>
                  </>
                ) : (
                  <>
                    <PanelRightOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Camadas &amp; Offline</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setRecenterTrigger((prev) => prev + 1)}
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
                title="Centralizar mapa no Pin ativo"
              >
                <Crosshair className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Centralizar Pin</span>
              </button>

              <button
                type="button"
                data-testid="map-fullscreen-btn"
                onClick={() => setIsFullscreen((prev) => !prev)}
                aria-pressed={isFullscreen}
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
                  isFullscreen
                    ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-500 shadow-sm'
                    : 'bg-sky-50 dark:bg-slate-800 text-sky-900 dark:text-sky-200 border-sky-200 dark:border-slate-700 hover:bg-sky-100'
                }`}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Reduzir Mapa</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Tela Cheia</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Seletor Direto de Modelo Meteorológico no Mapa (FieldCast Ensemble + ECMWF + GFS + ICON + GEM) */}
          <div
            className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-sky-100/80 dark:border-slate-800 min-w-0"
            role="group"
            aria-label="Modelo meteorológico no mapa"
          >
            <span
              className={`text-[11px] font-bold mr-1 ${
                isFullscreen ? 'text-sky-300' : 'text-sky-800 dark:text-sky-300'
              }`}
            >
              Modelo:
            </span>
            {MAP_MODEL_OPTIONS.map((opt) => {
              const active = mapModelMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleMapModelSelect(opt.id)}
                  aria-pressed={active}
                  className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                    active
                      ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                      : isFullscreen
                        ? 'bg-slate-800/90 text-sky-100 border-slate-700 hover:bg-slate-700'
                        : 'bg-sky-50/70 dark:bg-slate-800 text-slate-700 dark:text-sky-200 border-sky-200 dark:border-slate-700 hover:bg-sky-100/70'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={
            isFullscreen
              ? 'relative flex-1 min-h-0 w-full z-0'
              : 'relative w-full h-[430px] sm:h-[510px] lg:h-[550px] z-0'
          }
        >
          <MapContainer
            center={[activeLocation.latitude, activeLocation.longitude]}
            zoom={12}
            scrollWheelZoom={true}
            className="w-full h-full z-0"
          >
            {/* Subclasse customizada de L.TileLayer com leitura prioritária do IndexedDB (Dexie) e servidores gratuitos OSM/Esri */}
            <OfflineBaseTileLayer theme={tileTheme} baseStyle={baseStyle} />

            {/* Ponte de sincronização de viewport, centro e clique no mapa */}
            <MapViewportBridge
              centerLat={activeLocation.latitude}
              centerLon={activeLocation.longitude}
              recenterTrigger={recenterTrigger}
              layoutKey={`${isFullscreen}_${isSidebarOpen}`}
              onViewportChange={handleViewportChange}
              onMapClick={handleMapClick}
            />

            {/* Overlay de Campo Meteorológico do Modelo (Vento, Chuva, Temp, Ondas) */}
            <WeatherModelOverlayLayer
              layerId={activeWeatherLayer}
              modelMode={mapModelMode}
              points={activeMapGridSlice?.points ?? []}
              hourTimestamp={
                activeMapGridSlice?.timestampUnix ??
                currentForecastHour?.timestampUnix ??
                null
              }
              opacity={radarOpacity}
              animateFlow={true}
              onLayerError={() => {
                setActiveWeatherLayer('none');
                onToast?.({
                  type: 'warning',
                  title: 'Camada meteorológica ocultada por segurança',
                  message: 'O mapa base continua operando normalmente.',
                });
              }}
            />

            {/* Overlay de Radar Animado RainViewer */}
            {radarEnabled && activeFrame && (
              <TileLayer
                key={activeFrame.path}
                url={activeFrame.tileUrlTemplate}
                opacity={radarOpacity}
                maxNativeZoom={radarState?.maxNativeZoom ?? 7}
                maxZoom={19}
                zIndex={460}
                attribution="RainViewer"
                eventHandlers={{
                  tileerror: () => {
                    setRadarTileErrorCount((c) => c + 1);
                  },
                }}
              />
            )}

            {/* Círculo de Área de Cobertura da Previsão ao redor do Pin Ativo */}
            {forecastAreaRadiusKm > 0 && (
              <Circle
                center={[activeLocation.latitude, activeLocation.longitude]}
                radius={forecastAreaRadiusKm * 1000}
                pathOptions={{
                  color: '#0284c7',
                  weight: 2,
                  dashArray: '6 4',
                  fillColor: '#38bdf8',
                  fillOpacity: 0.12,
                }}
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
                  color: tileEstimate.exceedsLimit ? '#f43f5e' : '#0ea5e9',
                  weight: 2,
                  dashArray: '6 4',
                  fillColor: tileEstimate.exceedsLimit ? '#f43f5e' : '#38bdf8',
                  fillOpacity: 0.08,
                }}
              />
            )}

            {/* Marcador do Canto 1 durante desenho de retângulo */}
            {isDrawingMissionBox && drawFirstCorner && (
              <CircleMarker
                center={[drawFirstCorner.latitude, drawFirstCorner.longitude]}
                radius={8}
                pathOptions={{
                  color: '#0284c7',
                  fillColor: '#38bdf8',
                  fillOpacity: 0.9,
                  weight: 2,
                }}
              />
            )}

            {/* Pin Principal Estilo Bandeirinha do Windy (Arrastável quando Pin Livre!) */}
            <Marker
              key={isPinLocked ? 'map-active-pin-locked' : 'map-active-pin-free'}
              position={[activeLocation.latitude, activeLocation.longitude]}
              icon={activeWindyFlagIcon}
              draggable={!isPinLocked}
              eventHandlers={{
                dragend(e) {
                  if (isPinLocked) return;
                  const marker = e.target as L.Marker;
                  const pos = marker.getLatLng();
                  handleMapClick(pos.lat, pos.lng);
                },
              }}
            >
              <Popup>
                <div className="min-w-[230px] space-y-2 text-slate-800">
                  <div className="border-b border-sky-100 pb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
                      Pin de Previsão Ativo
                    </span>
                    <h4 className="font-bold text-sm text-slate-900">
                      {activeLocation.name}
                    </h4>
                    <p className="text-xs font-mono text-slate-500">
                      {activeLocation.latitude.toFixed(4)}°,{' '}
                      {activeLocation.longitude.toFixed(4)}°
                      {forecastAreaRadiusKm > 0
                        ? ` • Área ${forecastAreaRadiusKm} km`
                        : ''}
                    </p>
                  </div>

                  {currentForecastHour && forecast ? (
                    <div className="space-y-1.5 text-xs">
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-sky-50/80 p-2 rounded-lg border border-sky-100">
                          <span className="text-[10px] text-slate-500 block">
                            Vento 10m / Rajada
                          </span>
                          <strong className="font-bold text-sky-900">
                            {currentForecastHour.windSpeed10m.mean?.toFixed(1) ?? '—'} /{' '}
                            {currentForecastHour.windGusts10m.mean?.toFixed(1) ?? '—'}{' '}
                            km/h
                          </strong>
                        </div>
                        <div className="bg-sky-50/80 p-2 rounded-lg border border-sky-100">
                          <span className="text-[10px] text-slate-500 block">
                            Direção / Temp
                          </span>
                          <strong className="font-bold text-sky-900">
                            {currentForecastHour.windDirection10m.degree !== null
                              ? `${degreesToCardinal(currentForecastHour.windDirection10m.degree)} (${Math.round(currentForecastHour.windDirection10m.degree)}°)`
                              : '—'}{' '}
                            •{' '}
                            {currentForecastHour.temperature2mC.mean?.toFixed(1) ?? '—'}
                            °C
                          </strong>
                        </div>
                      </div>

                      <div className="bg-sky-50/80 p-2 rounded-lg border border-sky-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">
                          Mar / Ondas:
                        </span>
                        <strong className="font-bold text-sky-900">
                          {forecast.marineAvailable && currentForecastHour.marine
                            ? `${currentForecastHour.marine.waveHeight?.toFixed(1) ?? '—'}m (${currentForecastHour.marine.wavePeriod?.toFixed(0) ?? '—'}s)`
                            : 'Ponto Continental'}
                        </strong>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-[11px] text-slate-600">
                        <span>
                          Confiança:{' '}
                          <strong className="text-sky-700">
                            {currentForecastHour.confidence.total}%
                          </strong>
                        </span>
                        <span>
                          Altitude: <strong>{Math.round(forecast.elevationDemM)}m</strong>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Sincronizando previsão horária para este Pin...
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
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
                            {loc.isFavorite ? '★ Local Favorito' : 'Local Salvo'}
                          </span>
                          <h4 className="font-bold text-sm">{loc.name}</h4>
                          <p className="text-xs font-mono text-slate-500">
                            {loc.latitude.toFixed(4)}°, {loc.longitude.toFixed(4)}°
                          </p>
                          {loc.elevationM !== undefined && loc.elevationM !== null && (
                            <p className="text-xs text-slate-500">
                              Altitude: {Math.round(loc.elevationM)} m
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
                            className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                          >
                            Previsão para este local
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
                        <div className="border-b border-sky-100 pb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
                            Waypoint de Campo
                          </span>
                          <h4 className="font-bold text-sm">{wp.name}</h4>
                          <p className="text-[11px] font-mono text-slate-500">
                            {wp.latitude.toFixed(4)}°, {wp.longitude.toFixed(4)}° •{' '}
                            {wp.timestampUtcIso.slice(0, 16).replace('T', ' ')}
                          </p>
                        </div>

                        {wp.photoDataUrl && (
                          <div className="rounded-lg overflow-hidden border border-sky-100 bg-sky-50">
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
                          <p className="text-xs text-slate-700 bg-sky-50/70 p-2 rounded-lg">
                            {wp.note}
                          </p>
                        )}

                        <div className="text-[11px] bg-sky-50/50 border border-sky-100 rounded-lg p-2 space-y-1">
                          <div className="font-semibold text-sky-900">
                            Condições no Momento:
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            <span>
                              Vento:{' '}
                              <strong>
                                {wp.conditions.windSpeed10mKmh?.toFixed(1) ?? '—'} km/h
                              </strong>
                            </span>
                            <span>
                              Rajada:{' '}
                              <strong>
                                {wp.conditions.windGusts10mKmh?.toFixed(1) ?? '—'} km/h
                              </strong>
                            </span>
                            <span>
                              Temp:{' '}
                              <strong>
                                {wp.conditions.temperature2mC?.toFixed(1) ?? '—'}°C
                              </strong>
                            </span>
                            <span>
                              Onda:{' '}
                              <strong>
                                {wp.conditions.waveHeightM !== null
                                  ? `${wp.conditions.waveHeightM.toFixed(1)}m`
                                  : 'Cont.'}
                              </strong>
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-600 pt-0.5">
                            {safeBadge.label} • Confiança:{' '}
                            {wp.conditions.confidenceTotal ?? '—'}%
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
                            track.status === 'recording' ? '#0284c7' : '#0ea5e9',
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
                              Início:{' '}
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

            {/* Marcador de Pin Inspecionado (quando em modo de inspeção antes de aplicar) */}
            {inspectedPoint &&
              inspectedWindyFlagIcon &&
              (Math.abs(inspectedPoint.latitude - activeLocation.latitude) >
                0.0002 ||
                Math.abs(inspectedPoint.longitude - activeLocation.longitude) >
                  0.0002) && (
                <Marker
                  position={[inspectedPoint.latitude, inspectedPoint.longitude]}
                  icon={inspectedWindyFlagIcon}
                  eventHandlers={{
                    click() {
                      if (isPinLocked) return;
                      const trimmed = customPinName.trim();
                      const label =
                        trimmed ||
                        `Pin (${inspectedPoint.latitude.toFixed(3)}, ${inspectedPoint.longitude.toFixed(3)})`;
                      handleSelectMapCoordinate(
                        inspectedPoint.latitude,
                        inspectedPoint.longitude,
                        label,
                        'search',
                      );
                    },
                  }}
                />
              )}
          </MapContainer>

          {/* Badge de Consulta da Grade 3x3 quando o Pin está Fixado */}
          {isPinLocked && inspectedPoint && (
            <div
              data-testid="map-locked-grid-badge"
              className="absolute bottom-3 left-3 z-[510] max-w-[calc(100%-1.5rem)] sm:max-w-[330px] rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50/95 dark:bg-amber-950/95 backdrop-blur-md px-3 py-2 shadow-lg text-[11px] text-amber-950 dark:text-amber-100 space-y-0.5 pointer-events-none"
            >
              <div className="flex items-center gap-1.5 font-bold">
                <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Grade 3x3 ({inspectedPoint.latitude.toFixed(3)}°, {inspectedPoint.longitude.toFixed(3)}°)
                </span>
              </div>
              {lockedGridSample && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                  <span>
                    Vento:{' '}
                    <strong>
                      {lockedGridSample.windSpeedKmh !== null
                        ? `${Math.round(lockedGridSample.windSpeedKmh)} km/h`
                        : '—'}
                      {lockedGridSample.windDirectionDeg !== null
                        ? ` (${degreesToCardinal(lockedGridSample.windDirectionDeg)})`
                        : ''}
                    </strong>
                  </span>
                  <span>
                    Chuva:{' '}
                    <strong>
                      {lockedGridSample.precipMm !== null
                        ? `${lockedGridSample.precipMm.toFixed(1)} mm`
                        : '—'}
                    </strong>
                  </span>
                  <span>
                    Temp:{' '}
                    <strong>
                      {lockedGridSample.tempC !== null
                        ? `${lockedGridSample.tempC.toFixed(1)}°C`
                        : '—'}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* HUD Flutuante no Mapa: Informa Modelo Meteorológico, Radar RainViewer & Escala de Cores */}
          <div
            data-testid="map-weather-hud"
            className={`absolute z-[500] max-w-[270px] sm:max-w-[310px] rounded-2xl border border-sky-200/90 dark:border-sky-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-2.5 sm:p-3 shadow-md space-y-1.5 pointer-events-auto ${
              isFullscreen
                ? 'bottom-3 right-3 sm:bottom-auto sm:top-3 sm:right-3'
                : 'top-3 right-3'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-sky-900 dark:text-sky-100">
                <Radar className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                <span>Modelo: {activeModelDisplayName}</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  activeSpatialGrid.source === 'live_grid'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-sky-50 text-sky-700 border border-sky-200'
                }`}
              >
                {isLoadingSpatialGrid
                  ? 'Atualizando...'
                  : activeSpatialGrid.source === 'live_grid'
                    ? 'Grade ao Vivo'
                    : 'Campo do Ponto'}
              </span>
            </div>

            <div className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                Vento:{' '}
                <strong className="text-slate-900 dark:text-white">
                  {activeWindSpeed !== null ? `${Math.round(activeWindSpeed)} km/h` : '—'}
                </strong>
              </span>
              <span>
                Chuva:{' '}
                <strong className="text-slate-900 dark:text-white">
                  {activePrecipMm !== null ? `${activePrecipMm.toFixed(1)} mm` : '—'}
                </strong>
              </span>
              <span>
                Temp:{' '}
                <strong className="text-slate-900 dark:text-white">
                  {activeTempC !== null ? `${Math.round(activeTempC)}°C` : '—'}
                </strong>
              </span>
            </div>

            <div className="text-[10px] flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  !radarEnabled
                    ? 'bg-slate-400'
                    : radarState?.available && radarTileErrorCount === 0
                      ? 'bg-emerald-500'
                      : 'bg-amber-500'
                }`}
                aria-hidden="true"
              />
              <span>
                {!radarEnabled
                  ? 'Radar RainViewer pausado pelo usuário'
                  : radarState?.available && activeFrame
                    ? `RainViewer: ${frames.length} quadros • ${formatFrameTimestamp(activeFrame.timeUnix)}${
                        radarTileErrorCount > 0 ? ' (alguns tiles falharam)' : ''
                      }`
                    : isLoadingRadar
                      ? 'Carregando Radar RainViewer...'
                      : 'Radar RainViewer indisponível (usando camada do modelo)'}
              </span>
            </div>

            {activeLegendSpec && (
              <div className="pt-1 border-t border-sky-100 dark:border-slate-800">
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  <span>{activeLegendSpec.title}</span>
                  <span>{activeLegendSpec.unit}</span>
                </div>
                <div className="flex items-center rounded-full overflow-hidden h-2 border border-slate-200/80 dark:border-slate-700">
                  {activeLegendSpec.stops.map((stop) => (
                    <div
                      key={stop.valueLabel}
                      className="flex-1 h-full"
                      style={{ backgroundColor: stop.color }}
                      title={`${stop.valueLabel} ${activeLegendSpec.unit}`}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  {activeLegendSpec.stops.map((stop) => (
                    <span key={stop.valueLabel}>{stop.valueLabel}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Barra de Reprodução Dual: Radar ao Vivo (RainViewer) ou Linha do Tempo do Modelo */}
        <div
          className={
            isFullscreen
              ? 'shrink-0 border-t border-slate-800 bg-slate-950/95 p-3 space-y-2.5 min-w-0'
              : 'border-t border-sky-100 dark:border-slate-800 bg-sky-50/40 dark:bg-slate-950/80 p-3 sm:p-4 space-y-2.5 min-w-0'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center rounded-xl bg-white dark:bg-slate-900 p-1 border border-sky-200/80 dark:border-slate-700" role="group" aria-label="Fonte da linha do tempo do mapa">
              <button
                type="button"
                onClick={() => {
                  setIsPlayingRadar(false);
                  setTimelineMode('rainviewer');
                }}
                aria-pressed={timelineMode === 'rainviewer'}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                  timelineMode === 'rainviewer'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-sky-700'
                }`}
              >
                Radar Chuva (RainViewer)
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPlayingRadar(false);
                  setTimelineMode('model');
                }}
                aria-pressed={timelineMode === 'model'}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                  timelineMode === 'model'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-sky-700'
                }`}
              >
                Previsão {activeModelDisplayName} ({maxModelTimelineHours}h)
              </button>
            </div>

            {timelineMode === 'model' && currentForecastHour && (
              <div className="flex items-center gap-2 text-xs">
                {safeModelHourIdx === currentLocalHourIdx ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                    Agora • {formatLocalHourBadge(currentForecastHour.timestampUnix, forecast?.timezone)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedModelHourIdx(currentLocalHourIdx)}
                    className="px-2.5 py-0.5 rounded-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
                  >
                    Voltar para Agora
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Botões Play/Pause, Passo Anterior/Próximo e Opacidade (todos >= 44x44px) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlayingRadar((prev) => !prev)}
                disabled={
                  timelineMode === 'rainviewer'
                    ? frames.length <= 1 || !radarEnabled
                    : maxModelTimelineHours <= 1
                }
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
                    <span>{timelineMode === 'rainviewer' ? 'Play Radar' : 'Play Modelo'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlayingRadar(false);
                  if (timelineMode === 'rainviewer') {
                    setCurrentFrameIndex((prev) =>
                      frames.length > 0
                        ? (prev - 1 + frames.length) % frames.length
                        : 0,
                    );
                  } else {
                    setSelectedModelHourIdx((prev) =>
                      maxModelTimelineHours > 0
                        ? (prev - 1 + maxModelTimelineHours) % maxModelTimelineHours
                        : 0,
                    );
                  }
                }}
                disabled={
                  timelineMode === 'rainviewer'
                    ? frames.length <= 1 || !radarEnabled
                    : maxModelTimelineHours <= 1
                }
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-slate-800 disabled:opacity-40 text-sky-800 dark:text-slate-200 inline-flex items-center justify-center"
                title="Quadro anterior"
                aria-label="Quadro anterior"
              >
                <SkipBack className="w-4 h-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlayingRadar(false);
                  if (timelineMode === 'rainviewer') {
                    setCurrentFrameIndex((prev) =>
                      frames.length > 0 ? (prev + 1) % frames.length : 0,
                    );
                  } else {
                    setSelectedModelHourIdx((prev) =>
                      maxModelTimelineHours > 0 ? (prev + 1) % maxModelTimelineHours : 0,
                    );
                  }
                }}
                disabled={
                  timelineMode === 'rainviewer'
                    ? frames.length <= 1 || !radarEnabled
                    : maxModelTimelineHours <= 1
                }
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-slate-800 disabled:opacity-40 text-sky-800 dark:text-slate-200 inline-flex items-center justify-center"
                title="Próximo quadro"
                aria-label="Próximo quadro"
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
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-slate-800 text-xs font-semibold text-sky-800 dark:text-slate-200 inline-flex items-center gap-1.5"
                title="Alternar opacidade da camada de radar"
              >
                <Layers className="w-4 h-4 text-sky-600" aria-hidden="true" />
                <span>Opacidade {Math.round(radarOpacity * 100)}%</span>
              </button>

              <button
                type="button"
                onClick={() => void loadRainViewerRadar(true)}
                disabled={isLoadingRadar}
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-slate-800 text-xs font-semibold text-sky-800 dark:text-slate-200 inline-flex items-center gap-1.5"
                title="Recarregar quadros do RainViewer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isLoadingRadar ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Atualizar Radar</span>
              </button>
            </div>

            {/* Slider Temporal & Timestamp do Frame / Hora do Modelo */}
            <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 flex items-center gap-2">
                {timelineMode === 'rainviewer' ? (
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
                    className="w-full min-h-[44px] accent-sky-600 cursor-pointer disabled:opacity-40"
                  />
                ) : (
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, maxModelTimelineHours - 1)}
                    value={safeModelHourIdx}
                    disabled={maxModelTimelineHours <= 1}
                    onChange={(e) => {
                      setIsPlayingRadar(false);
                      setSelectedModelHourIdx(Number(e.target.value));
                    }}
                    aria-label="Linha do tempo da previsão do modelo meteorológico"
                    className="w-full min-h-[44px] accent-sky-600 cursor-pointer disabled:opacity-40"
                  />
                )}
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                {timelineMode === 'model' && currentForecastHour ? (
                  <>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold border bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border-sky-200 dark:border-sky-800">
                      {activeModelDisplayName}
                    </span>
                    <span className="font-mono text-xs sm:text-sm font-bold text-sky-900 dark:text-white bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-sky-200 dark:border-slate-800">
                      {formatFrameTimestamp(currentForecastHour.timestampUnix)}
                    </span>
                  </>
                ) : activeFrame ? (
                  <>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                        activeFrame.isNowcast
                          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      }`}
                    >
                      {activeFrame.isNowcast ? 'Previsão (+30m)' : 'Observado'}
                    </span>
                    <span className="font-mono text-xs sm:text-sm font-bold text-sky-900 dark:text-white bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-sky-200 dark:border-slate-800">
                      {formatFrameTimestamp(activeFrame.timeUnix)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-slate-500">
                    {isLoadingRadar
                      ? 'Carregando radar...'
                      : 'Radar pronto'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Gaveta Recolhível Estilo Windy: Camadas do Modelo, Radar, Mapa Base, Pin & Área de Missão Offline */}
      {isSidebarOpen && (
        <div
          id="map-windy-controls-drawer"
          data-testid="map-windy-drawer"
          className={
            isFullscreen
              ? 'fixed bottom-24 right-3 z-[85] max-h-[55vh] w-[calc(100vw-1.5rem)] sm:w-[440px] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-md p-4 shadow-2xl space-y-4 min-w-0'
              : 'space-y-4 min-w-0'
          }
        >
          {/* Card de Camadas, Mapa Base e Controles do Pin Estilo Windy */}
          <section className="rounded-2xl border border-sky-200/80 dark:border-sky-900/60 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-3.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 dark:border-slate-800 pb-2.5">
              <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-900 dark:text-white min-w-0">
                <SlidersHorizontal className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                <span className="truncate">Gaveta de Camadas, Radar &amp; Pin (Estilo Windy)</span>
              </div>

              {/* Seletor de Estilo de Mapa Base (Padrão OSM / Costeiro Esri / Satélite Esri) */}
              <div
                className="inline-flex flex-wrap items-center rounded-xl bg-sky-50/90 dark:bg-slate-800 p-1 border border-sky-200/80 dark:border-slate-700 min-w-0"
                role="group"
                aria-label="Seletor de Estilo de Mapa Base"
              >
                {BASE_MAP_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setBaseStyle(style.id)}
                    className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      baseStyle === style.id
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-sky-700 hover:bg-white/60'
                    }`}
                  >
                    {style.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Camada Meteorológica do Modelo */}
            <div
              className="flex flex-wrap items-center gap-1.5 min-w-0"
              role="group"
              aria-label="Camada meteorológica do modelo"
            >
              <span className="text-[11px] font-bold text-sky-800 dark:text-sky-300 mr-1">
                Camada do Modelo:
              </span>
              {WEATHER_LAYER_OPTIONS.filter(
                (opt) => opt.id !== 'waves' || forecast?.marineAvailable !== false,
              ).map(({ id, label, Icon }) => {
                const active = activeWeatherLayer === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveWeatherLayer(id)}
                    aria-pressed={active}
                    className={`min-h-[40px] px-3 py-1.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border transition-all ${
                      active
                        ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-sky-200/80 dark:border-slate-700 hover:bg-sky-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Botões de Camadas Visíveis e Segurança (todos >= 44x44px) */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-sky-100 dark:border-slate-800 min-w-0">
              <button
                type="button"
                data-testid="toggle-radar-safety"
                onClick={() => {
                  const isBareMap = !radarEnabled && activeWeatherLayer === 'none';
                  if (isBareMap) {
                    setRadarEnabled(true);
                    setActiveWeatherLayer(lastActiveWeatherLayerRef.current || 'wind');
                  } else {
                    setIsPlayingRadar(false);
                    setRadarEnabled(false);
                    setActiveWeatherLayer('none');
                  }
                }}
                aria-pressed={!radarEnabled && activeWeatherLayer === 'none'}
                className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
                  !radarEnabled && activeWeatherLayer === 'none'
                    ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                    : 'bg-white dark:bg-slate-800 border-sky-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-sky-50'
                }`}
                title="Alternar rapidamente entre mapa limpo (sem radar/overlay) e camadas meteorológicas"
              >
                <XCircle className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                <span>
                  {!radarEnabled && activeWeatherLayer === 'none'
                    ? 'Camada Oculta (Ativar Radar)'
                    : 'Desativar Radar'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setRadarEnabled((prev) => !prev)}
                aria-pressed={radarEnabled}
                className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  radarEnabled
                    ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Radar className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                <span>Radar Chuva</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSavedLocations((prev) => !prev)}
                aria-pressed={showSavedLocations}
                className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  showSavedLocations
                    ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Bookmark className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                <span>Locais ({savedLocations.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowWaypoints((prev) => !prev)}
                aria-pressed={showWaypoints}
                className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  showWaypoints
                    ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Camera className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                <span>Waypoints ({waypoints.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowTracks((prev) => !prev)}
                aria-pressed={showTracks}
                className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  showTracks
                    ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Route className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                <span>Trilhas ({tracks.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowMissionOverlay((prev) => !prev)}
                aria-pressed={showMissionOverlay}
                className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  showMissionOverlay
                    ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Square className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                <span>Área Offline</span>
              </button>
            </div>

            {/* Controles do Pin Estilo Windy (Modo Instantâneo, Raio de Área e Nome/Favorito) */}
            <div className="pt-2.5 border-t border-sky-100 dark:border-slate-800 space-y-2.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setInstantWindyPin((prev) => !prev)}
                  aria-pressed={instantWindyPin}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                    instantWindyPin
                      ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                      : 'bg-sky-50/70 dark:bg-slate-800 border-sky-200 dark:border-slate-700 text-sky-900 dark:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {instantWindyPin
                      ? 'Pin Instantâneo (Estilo Windy): Ativo'
                      : 'Modo Inspeção (Confirmar antes de aplicar)'}
                  </span>
                </button>

                <div className="inline-flex flex-wrap items-center rounded-xl bg-sky-50/80 dark:bg-slate-800 p-1 border border-sky-200/80 dark:border-slate-700 min-w-0">
                  <span className="text-[11px] font-semibold text-sky-800 dark:text-sky-300 px-2">
                    Área do Pin:
                  </span>
                  {FORECAST_AREA_RADIUS_OPTIONS_KM.map((radiusKm) => (
                    <button
                      key={radiusKm}
                      type="button"
                      onClick={() => setForecastAreaRadiusKm(radiusKm)}
                      className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        forecastAreaRadiusKm === radiusKm
                          ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-200 shadow-sm border border-sky-200/70 dark:border-slate-600'
                          : 'text-slate-600 dark:text-slate-400 hover:text-sky-700'
                      }`}
                    >
                      {radiusKm === 0 ? 'Ponto' : `${radiusKm} km`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sky-50/70 dark:bg-slate-800 border border-sky-200 dark:border-slate-700 text-xs font-semibold text-sky-900 dark:text-sky-200">
                    <Navigation className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                    <span className="font-mono font-bold">
                      {(inspectedPoint?.latitude ?? activeLocation.latitude).toFixed(4)}°,{' '}
                      {(inspectedPoint?.longitude ?? activeLocation.longitude).toFixed(4)}°
                    </span>
                  </div>

                  <input
                    type="text"
                    value={customPinName}
                    onChange={(e) => setCustomPinName(e.target.value)}
                    placeholder="Nome personalizado para este Pin ou Área..."
                    aria-label="Nome personalizado para o Pin no mapa"
                    className="flex-1 min-w-0 w-full sm:w-auto min-h-[44px] px-3.5 py-1.5 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  {onSelectLocation && (
                    <button
                      type="button"
                      disabled={isPinLocked}
                      onClick={() => {
                        const targetLat =
                          inspectedPoint?.latitude ?? activeLocation.latitude;
                        const targetLon =
                          inspectedPoint?.longitude ?? activeLocation.longitude;
                        const trimmed = customPinName.trim();
                        const areaSuffix =
                          forecastAreaRadiusKm > 0
                            ? ` • Área ${forecastAreaRadiusKm}km`
                            : '';
                        const targetName =
                          trimmed.length > 0
                            ? `${trimmed}${areaSuffix}`
                            : `Pin no Mapa (${targetLat.toFixed(3)}, ${targetLon.toFixed(3)}${areaSuffix})`;
                        handleSelectMapCoordinate(
                          targetLat,
                          targetLon,
                          targetName,
                          'search',
                        );
                      }}
                      title={
                        isPinLocked
                          ? 'Pin Fixado: destrave o Pin Livre para aplicar novo local'
                          : 'Aplicar previsão para este Pin'
                      }
                      className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm inline-flex items-center gap-1.5 transition-colors"
                    >
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Previsão para este Pin</span>
                    </button>
                  )}

                  {onSaveLocation && (
                    <button
                      type="button"
                      onClick={() =>
                        handleSaveInspectedCoordinate(
                          inspectedPoint?.latitude ?? activeLocation.latitude,
                          inspectedPoint?.longitude ?? activeLocation.longitude,
                        )
                      }
                      className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-sky-800 dark:text-sky-200 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Bookmark className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                      <span>Salvar Pin nos Favoritos</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

      {/* Ferramenta: Área de Missão Offline (Cache de Tiles no IndexedDB — 100% Gratuito sem API Key) */}
      <section className="rounded-2xl border border-sky-200/80 dark:border-sky-900/60 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-sm space-y-4 min-w-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-sky-100 dark:border-slate-800 pb-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-sky-600" aria-hidden="true" />
                <span>Mapa Offline para Campo (Salvar Área no Dispositivo)</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                Até {MAX_OFFLINE_TILES_PER_MISSION} tiles / missão •{' '}
                {MAX_CONCURRENT_TILE_DOWNLOADS} conexões simultâneas
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Selecione um retângulo ou raio ao redor do Pin e salve o mapa{' '}
              <strong>{activeBaseStyleLabel}</strong> no IndexedDB para consulta em
              campo mesmo sem sinal de celular.
            </p>
          </div>

          {/* Resumo do Cache Salvo & Botão de Limpeza */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3.5 py-2 rounded-xl bg-sky-50/70 dark:bg-slate-800/90 border border-sky-200/80 dark:border-slate-700 text-xs">
              <div className="font-bold text-sky-900 dark:text-white">
                {cacheStats.totalTiles} tiles salvos ({formatBytes(cacheStats.totalBytes)})
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Padrão: {cacheStats.lightTiles} • Costeiro: {cacheStats.darkTiles}
              </div>
            </div>

            <button
              type="button"
              onClick={handleClearOfflineTileCache}
              disabled={cacheStats.totalTiles === 0 || isDownloadingTiles}
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/40 hover:bg-rose-100/80 disabled:opacity-40 text-rose-700 dark:text-rose-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span>Limpar Mapas Salvos</span>
            </button>
          </div>
        </div>

        {/* Controles de Definição do Retângulo e Níveis de Zoom */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Coluna 1: Seleção da Área Geográfica */}
          <div className="lg:col-span-7 space-y-3">
            <div className="text-xs font-bold text-sky-800 dark:text-sky-300">
              1. Escolha a Área do Mapa para Salvar Offline
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleUseCurrentViewportForMission}
                disabled={isDownloadingTiles}
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
              >
                <Compass className="w-4 h-4" aria-hidden="true" />
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
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-white dark:bg-slate-900 text-sky-800 dark:text-slate-200 border-sky-200 dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-slate-800'
                }`}
              >
                <Maximize2 className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isDrawingMissionBox
                    ? 'Desenhando no Mapa (2 Cliques)...'
                    : 'Desenhar Retângulo (2 Cliques)'}
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
                      ? 'bg-sky-100 dark:bg-sky-950/70 border-sky-400 text-sky-900 dark:text-sky-200'
                      : 'bg-sky-50/50 dark:bg-slate-800/70 border-sky-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-sky-100/60'
                  }`}
                >
                  Raio {radiusKm} km
                </button>
              ))}
            </div>

            {/* Coordenadas do Retângulo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-sky-50/50 dark:bg-slate-950/60 p-3 rounded-xl border border-sky-100 dark:border-slate-800">
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  Norte (Lat)
                </span>
                <strong className="text-sky-950 dark:text-slate-200">
                  {missionBounds.north.toFixed(4)}°
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  Sul (Lat)
                </span>
                <strong className="text-sky-950 dark:text-slate-200">
                  {missionBounds.south.toFixed(4)}°
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  Leste (Lon)
                </span>
                <strong className="text-sky-950 dark:text-slate-200">
                  {missionBounds.east.toFixed(4)}°
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  Oeste (Lon)
                </span>
                <strong className="text-sky-950 dark:text-slate-200">
                  {missionBounds.west.toFixed(4)}°
                </strong>
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
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-white"
                >
                  {[8, 9, 10, 11, 12, 13, 14, 15, 16].map((z) => (
                    <option key={z} value={z}>
                      Zoom {z} {z <= 10 ? '(Visão Regional)' : z <= 13 ? '(Visão Local)' : '(Detalhe Costeiro)'}
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
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-white"
                >
                  {[8, 9, 10, 11, 12, 13, 14, 15, 16].map((z) => (
                    <option key={z} value={z}>
                      Zoom {z} {z <= 10 ? '(Visão Regional)' : z <= 13 ? '(Visão Local)' : '(Detalhe Costeiro)'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Coluna 2: Estimativa de Tiles, Trava de 300 Tiles e Progresso de Download */}
          <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-sky-100 dark:border-slate-800 bg-sky-50/40 dark:bg-slate-950/60 p-4 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-sky-800 dark:text-sky-300">
                  2. Estimativa de Armazenamento
                </span>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold border ${
                    tileEstimate.exceedsLimit
                      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200'
                  }`}
                >
                  {tileEstimate.totalTiles} / {MAX_OFFLINE_TILES_PER_MISSION} tiles
                </span>
              </div>

              {/* Barra visual de ocupação do limite de 300 tiles */}
              <div className="w-full h-2.5 rounded-full bg-sky-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    tileEstimate.exceedsLimit
                      ? 'bg-rose-500'
                      : tileEstimate.totalTiles > 220
                        ? 'bg-amber-500'
                        : 'bg-sky-600'
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
                    className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-sky-200/80 dark:border-slate-800 text-[11px] font-mono text-sky-900 dark:text-slate-300"
                  >
                    Z{item.zoom}: <strong>{item.count}</strong>
                  </span>
                ))}
              </div>

              {/* Alerta bloqueante caso ultrapasse 300 tiles */}
              {tileEstimate.exceedsLimit && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50/90 dark:bg-rose-950/40 p-3 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200"
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
                      Escolha um raio menor ou reduza o Zoom Máximo para habilitar o
                      download offline.
                    </span>
                  </div>
                </div>
              )}

              {/* Barra de Progresso do Download em Tempo Real */}
              {downloadProgress && (
                <div className="rounded-xl border border-sky-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                      {downloadProgress.status === 'downloading' && (
                        <RefreshCw
                          className="w-3.5 h-3.5 animate-spin text-sky-600"
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
                          ? 'Salvando tiles offline...'
                          : downloadProgress.status === 'completed'
                            ? 'Mapa salvo com sucesso'
                            : downloadProgress.status === 'cancelled'
                              ? 'Download cancelado'
                              : 'Falha no download'}
                      </span>
                    </span>
                    <span className="font-mono font-bold text-sky-900 dark:text-white">
                      {downloadProgress.completedTiles}/{downloadProgress.totalTiles}{' '}
                      ({progressPct}%)
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-sky-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-600 transition-all duration-150"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {downloadProgress.failedTiles > 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {downloadProgress.failedTiles} tile(s) ignorados por oscilação de
                      rede.
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
                className="flex-1 min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-45 disabled:cursor-not-allowed text-white shadow-sm transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isDownloadingTiles
                    ? 'Salvando Mapa Offline...'
                    : `Salvar ${tileEstimate.totalTiles} Tiles Offline`}
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
      )}
    </div>
  );
}

/**
 * Aba Mapa & Radar encapsulada em `<ModuleErrorBoundary>` para isolamento Zero-Crash.
 */
export function MapRadarTab(props: MapRadarTabProps): React.ReactElement {
  return (
    <ModuleErrorBoundary
      moduleName="Aba Mapa Interativo, Pin Estilo Windy & Radar"
      fallbackDescription="Falha isolada no motor cartográfico Leaflet ou camada de radar. As abas Previsão e Campo & Dados continuam operacionais."
      onErrorLog={props.onErrorLog}
    >
      <MapRadarTabContent {...props} />
    </ModuleErrorBoundary>
  );
}

export default MapRadarTab;
