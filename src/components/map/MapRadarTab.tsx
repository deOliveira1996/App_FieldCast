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
  Eye,
  EyeOff,
  HardDrive,
  Layers,
  Lock,
  MapPin,
  Maximize2,
  Menu,
  Minimize2,
  Navigation,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Route,
  Satellite,
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
  WifiOff,
  Wind,
  X,
  XCircle,
} from 'lucide-react';
import { CollapsibleModule, HelpPopover, ModuleErrorBoundary } from '../common';
import { useLocale, type AppLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import {
  convertPrecipitation,
  convertTemperature,
  convertWaveHeight,
  convertWindSpeed,
  getPrecipUnitLabel,
  getTempUnitLabel,
  getWaveUnitLabel,
  getWindUnitLabel,
} from '../../utils/units';
import { WeatherModelOverlayLayer } from './WeatherModelOverlayLayer';
import {
  createWindyFlagPinIcon,
  degreesToCardinal,
} from '../common/LocationPinMapPicker';
import {
  getSavedLocations,
  getTrackSessions,
  getWaypoints,
  loadPrimaryLocationPreference,
  logErrorToDb,
  savePrimaryLocationPreference,
  upsertSavedLocation,
} from '../../db/database';
import { reverseGeocodeNominatim } from '../../services/geocodingService';
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
  onSetPrimaryLocation?: (location: {
    savedLocationId?: string;
    name: string;
    latitude: number;
    longitude: number;
    region?: string;
    origin?: ActiveCoordinates['origin'];
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
const GOES_EAST_TILE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/inf/GoogleMapsCompatible_Level7/{z}/{y}/{x}.jpg';

const BASE_MAP_STYLES: ReadonlyArray<{
  id: MapBaseStyle;
  labelPt: string;
  labelEn: string;
  shortLabelPt: string;
  shortLabelEn: string;
}> = [
  {
    id: 'osm',
    labelPt: 'Mapa Padrão (OSM)',
    labelEn: 'Standard Map (OSM)',
    shortLabelPt: 'Padrão OSM',
    shortLabelEn: 'Standard OSM',
  },
  {
    id: 'esri_street',
    labelPt: 'Costeiro & Ruas (Esri)',
    labelEn: 'Coastal & Streets (Esri)',
    shortLabelPt: 'Costeiro Esri',
    shortLabelEn: 'Coastal Esri',
  },
  {
    id: 'esri_satellite',
    labelPt: 'Satélite (Esri)',
    labelEn: 'Satellite (Esri)',
    shortLabelPt: 'Satélite',
    shortLabelEn: 'Satellite',
  },
];

function isCoordinateLikeLocationName(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^Pin(\s+no\s+Mapa|\s+de\s+Previsão)?\s*\(/i.test(trimmed)) return true;
  if (/^(Local|Área)\s+Selecionad[oa]/i.test(trimmed)) return true;
  if (/^-?\d+\.\d+\s*°?\s*,\s*-?\d+\.\d+/.test(trimmed)) return true;
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatFrameTimestamp(timeUnix: number, locale: AppLocale = 'pt'): string {
  try {
    const date = new Date(timeUnix * 1000);
    return date.toLocaleTimeString(locale === 'en' ? 'en-US' : 'pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return new Date(timeUnix * 1000).toISOString().slice(11, 16);
  }
}

function formatSafeWindowLabel(
  status: SafeWindowStatus | null | undefined,
  tr: (pt: string, en: string) => string,
): {
  label: string;
  badgeClass: string;
} {
  if (status === 'green') {
    return {
      label: tr('Condição Favorável (Verde)', 'Favorable Condition (Green)'),
      badgeClass:
        'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
    };
  }
  if (status === 'red') {
    return {
      label: tr('Acima do Limite (Vermelho)', 'Above Limit (Red)'),
      badgeClass:
        'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-700',
    };
  }
  return {
    label: tr('Atenção Moderada (Amarelo)', 'Moderate Caution (Amber)'),
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
  suppressAutoCenterCoords,
  layoutKey,
  onViewportChange,
  onMapClick,
}: {
  centerLat: number;
  centerLon: number;
  recenterTrigger: number;
  suppressAutoCenterCoords?: { lat: number; lon: number } | null;
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

  useEffect(() => {
    try {
      const container = mapRef.current.getContainer();
      if (container) {
        container.style.touchAction = 'none';
        container.style.overscrollBehavior = 'contain';
      }
    } catch {
      // Ignora em ambiente headless de teste
    }
  }, [map]);

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
    const refreshSize = () => {
      try {
        mapRef.current.invalidateSize({ animate: false });
      } catch {
        // Ignora em ambiente headless de teste
      }
      emitViewportRef.current();
    };

    const rafId =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(refreshSize)
        : null;
    const timerQuick = window.setTimeout(refreshSize, 80);
    const timerSettle = window.setTimeout(refreshSize, 260);
    emitViewportRef.current();

    return () => {
      if (rafId !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId);
      }
      window.clearTimeout(timerQuick);
      window.clearTimeout(timerSettle);
    };
  }, [layoutKey]);

  useEffect(() => {
    let settleTimer: number | null = null;
    const handleViewportRefresh = () => {
      try {
        mapRef.current.invalidateSize({ animate: false });
      } catch {
        // Ignora em ambiente headless de teste
      }
      emitViewportRef.current();
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        try {
          mapRef.current.invalidateSize({ animate: false });
        } catch {
          // Ignora em ambiente headless de teste
        }
        emitViewportRef.current();
      }, 100);
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        const container = mapRef.current.getContainer();
        if (container) {
          resizeObserver = new ResizeObserver(() => {
            handleViewportRefresh();
          });
          resizeObserver.observe(container);
        }
      } catch {
        resizeObserver = null;
      }
    }

    window.addEventListener('resize', handleViewportRefresh);
    window.addEventListener('orientationchange', handleViewportRefresh);
    window.addEventListener('fieldcast:layout-refresh', handleViewportRefresh);

    return () => {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
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
      const isClickSuppressed =
        !triggerChanged &&
        suppressAutoCenterCoords !== null &&
        suppressAutoCenterCoords !== undefined &&
        Math.abs(suppressAutoCenterCoords.lat - centerLat) < 0.0005 &&
        Math.abs(suppressAutoCenterCoords.lon - centerLon) < 0.0005;

      if (!isClickSuppressed) {
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
      }
      emitViewportRef.current();
    }
  }, [centerLat, centerLon, recenterTrigger, suppressAutoCenterCoords]);

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
  labelPt: string;
  labelEn: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'wind', labelPt: 'Vento + Vetores', labelEn: 'Wind + Vectors', Icon: Wind },
  { id: 'rain', labelPt: 'Chuva (Modelo)', labelEn: 'Rain (Model)', Icon: CloudRain },
  { id: 'temperature', labelPt: 'Temperatura', labelEn: 'Temperature', Icon: Thermometer },
  { id: 'waves', labelPt: 'Ondas (Mar)', labelEn: 'Waves (Sea)', Icon: Waves },
  { id: 'none', labelPt: 'Só Radar/Mapa', labelEn: 'Radar/Map Only', Icon: Layers },
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
  onSetPrimaryLocation,
  onRadarStateChange,
  onToast,
  onErrorLog,
}: MapRadarTabProps): React.ReactElement {
  const { tr, locale } = useLocale();
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
  const {
    units,
    formatWindValue,
    formatTempValue,
    formatWaveValue,
    formatPrecipValue,
  } = useUnits();
  const [instantWindyPin, setInstantWindyPin] = useState<boolean>(true);
  const [isPinLocked, setIsPinLocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isHudHidden, setIsHudHidden] = useState<boolean>(false);
  const [showWindStreamlines, setShowWindStreamlines] = useState<boolean>(true);
  const [forecastAreaRadiusKm, setForecastAreaRadiusKm] = useState<number>(5);
  const [customPinName, setCustomPinName] = useState<string>('');
  const [resolvedPinGeo, setResolvedPinGeo] = useState<{
    lat: number;
    lon: number;
    friendlyLabel: string;
  } | null>(null);
  const [isResolvingPinGeo, setIsResolvingPinGeo] = useState<boolean>(false);
  const geocodeSeqRef = useRef<number>(0);
  const [suppressAutoCenterCoords, setSuppressAutoCenterCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [primaryPreference, setPrimaryPreference] = useState(() =>
    loadPrimaryLocationPreference(),
  );

  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (isFullscreen || !isSidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen, isSidebarOpen]);

  // Estado do Radar RainViewer e Satélite Real-Time NASA GIBS / NOAA GOES-East
  const [radarState, setRadarState] = useState<RainViewerRadarState | null>(null);
  const [isLoadingRadar, setIsLoadingRadar] = useState<boolean>(false);
  const [radarEnabled, setRadarEnabled] = useState<boolean>(true);
  const [isPlayingRadar, setIsPlayingRadar] = useState<boolean>(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [layerOpacity, setLayerOpacity] = useState<number>(0.7);
  const radarOpacity = layerOpacity;
  const cycleLayerOpacityPreset = useCallback(() => {
    setLayerOpacity((prev) => {
      const idx = RADAR_OPACITY_PRESETS.findIndex((preset) => Math.abs(preset - prev) < 0.06);
      const nextIdx = idx === -1 ? 1 : (idx + 1) % RADAR_OPACITY_PRESETS.length;
      return RADAR_OPACITY_PRESETS[nextIdx] ?? 0.7;
    });
  }, []);
  const [goesSatelliteEnabled, setGoesSatelliteEnabled] = useState<boolean>(false);
  const [satelliteTileErrors, setSatelliteTileErrors] = useState<number>(0);
  const [satelliteReloadKey, setSatelliteReloadKey] = useState<number>(0);
  const [isBrowserOffline, setIsBrowserOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOffline(false);
      setSatelliteTileErrors(0);
    };
    const handleOffline = () => {
      setIsBrowserOffline(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  const getFriendlyPlaceLabel = useCallback(
    (lat: number, lon: number, rawName?: string | null): string => {
      const trimmedCustom = customPinName.trim();
      if (
        trimmedCustom.length > 0 &&
        inspectedPoint &&
        Math.abs(inspectedPoint.latitude - lat) < 0.0015 &&
        Math.abs(inspectedPoint.longitude - lon) < 0.0015
      ) {
        return trimmedCustom;
      }
      if (
        resolvedPinGeo &&
        Math.abs(resolvedPinGeo.lat - lat) < 0.0015 &&
        Math.abs(resolvedPinGeo.lon - lon) < 0.0015
      ) {
        return resolvedPinGeo.friendlyLabel;
      }
      if (rawName && !isCoordinateLikeLocationName(rawName)) {
        return rawName;
      }
      return tr('Local no Mapa', 'Map Location');
    },
    [customPinName, inspectedPoint, resolvedPinGeo, tr],
  );

  const resolvePlaceNameForCoords = useCallback(async (lat: number, lon: number) => {
    const seq = ++geocodeSeqRef.current;
    setIsResolvingPinGeo(true);
    try {
      const res = await reverseGeocodeNominatim(lat, lon);
      if (seq !== geocodeSeqRef.current) return;
      if (res?.friendlyLabel) {
        setResolvedPinGeo({
          lat,
          lon,
          friendlyLabel: res.friendlyLabel,
        });
      }
    } finally {
      if (seq === geocodeSeqRef.current) {
        setIsResolvingPinGeo(false);
      }
    }
  }, []);

  const handleSelectMapCoordinate = useCallback(
    (
      latitude: number,
      longitude: number,
      name: string,
      origin: ActiveCoordinates['origin'] = 'search',
      options?: { suppressRecenter?: boolean },
    ): void => {
      if (!onSelectLocation) return;
      if (options?.suppressRecenter) {
        setSuppressAutoCenterCoords({ lat: latitude, lon: longitude });
      } else {
        setSuppressAutoCenterCoords(null);
      }
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
          successTitle: tr(
            `Pin de Previsão atualizado: ${name}`,
            `Forecast Pin updated: ${name}`,
          ),
          errorTitle: tr(
            'Não foi possível selecionar a coordenada no mapa',
            'Could not select map coordinate',
          ),
          onToast,
          onErrorLog: handleLogError,
        },
      );
    },
    [onSelectLocation, onToast, handleLogError, tr],
  );

  // Clique no mapa: ou desenha os 2 cantos da Área de Missão ou posiciona o Pin estilo Windy
  const handleMapClick = useCallback(
    (lat: number, lon: number) => {
      if (isDrawingMissionBox) {
        if (!drawFirstCorner) {
          setDrawFirstCorner({ latitude: lat, longitude: lon });
          onToast?.({
            type: 'info',
            title: tr('Canto 1 definido', 'Corner 1 set'),
            message: tr(
              'Toque no segundo canto do mapa para fechar o retângulo da missão.',
              'Tap the opposite corner on the map to close the mission rectangle.',
            ),
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
            title: tr(
              'Retângulo da Área de Missão atualizado',
              'Offline Mission Rectangle updated',
            ),
            message: tr(
              'Verifique a estimativa de tiles abaixo antes de iniciar o download.',
              'Check the tile estimate below before starting the download.',
            ),
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

      void resolvePlaceNameForCoords(roundedLat, roundedLon);

      if (isPinLocked) {
        return;
      }

      if (instantWindyPin && onSelectLocation) {
        const trimmed = customPinName.trim();
        const pinLabel =
          trimmed.length > 0
            ? trimmed
            : getFriendlyPlaceLabel(roundedLat, roundedLon, null);
        handleSelectMapCoordinate(roundedLat, roundedLon, pinLabel, 'search', {
          suppressRecenter: true,
        });
      }
    },
    [
      isDrawingMissionBox,
      drawFirstCorner,
      missionBounds.minZoom,
      missionBounds.maxZoom,
      onToast,
      tr,
      resolvePlaceNameForCoords,
      isPinLocked,
      instantWindyPin,
      onSelectLocation,
      customPinName,
      getFriendlyPlaceLabel,
      handleSelectMapCoordinate,
    ],
  );

  const handleCenterOnPrimaryArea = useCallback(() => {
    const primary = primaryPreference ?? loadPrimaryLocationPreference();
    setSuppressAutoCenterCoords(null);
    if (
      primary &&
      (Math.abs(primary.latitude - activeLocation.latitude) > 0.0005 ||
        Math.abs(primary.longitude - activeLocation.longitude) > 0.0005) &&
      onSelectLocation &&
      !isPinLocked
    ) {
      handleSelectMapCoordinate(
        primary.latitude,
        primary.longitude,
        primary.name,
        primary.origin ?? 'saved',
        { suppressRecenter: false },
      );
    }
    setRecenterTrigger((prev) => prev + 1);
  }, [
    primaryPreference,
    activeLocation.latitude,
    activeLocation.longitude,
    onSelectLocation,
    isPinLocked,
    handleSelectMapCoordinate,
  ]);

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

        const styleObj = BASE_MAP_STYLES.find((s) => s.id === baseStyle);
        const styleName = styleObj
          ? tr(styleObj.labelPt, styleObj.labelEn)
          : 'OpenStreetMap';

        if (result.status === 'completed') {
          onToast?.({
            type: result.failedTiles > 0 ? 'warning' : 'success',
            title:
              result.failedTiles > 0
                ? tr(
                    `Cache concluído (${result.completedTiles} salvos, ${result.failedTiles} falhas)`,
                    `Cache complete (${result.completedTiles} saved, ${result.failedTiles} failed)`,
                  )
                : tr(
                    `Área de Missão salva offline (${result.completedTiles} tiles)`,
                    `Mission Area saved offline (${result.completedTiles} tiles)`,
                  ),
            message: tr(
              `Mapa (${styleName}) salvo no dispositivo para consulta sem internet.`,
              `Map (${styleName}) saved on device for offline field use.`,
            ),
          });
        } else if (result.status === 'cancelled') {
          onToast?.({
            type: 'info',
            title: tr('Download de tiles cancelado', 'Tile download cancelled'),
            message: tr(
              `${result.completedTiles} tiles foram mantidos no cache antes do cancelamento.`,
              `${result.completedTiles} tiles were kept in offline cache before cancellation.`,
            ),
          });
        } else if (result.status === 'error') {
          onToast?.({
            type: 'error',
            title: tr('Falha ao baixar tiles da missão', 'Failed to download mission tiles'),
            message: result.errorMessage,
          });
        }

        return result;
      },
      {
        actionKey: 'download_offline_mission_tiles',
        moduleName: 'MapRadarTab',
        errorTitle: tr(
          'Erro durante download da Área de Missão Offline',
          'Error downloading Offline Mission Area',
        ),
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
        successTitle: tr(
          'Mapas salvos offline removidos com sucesso',
          'Saved offline maps cleared successfully',
        ),
        errorTitle: tr(
          'Falha ao limpar cache de tiles offline',
          'Failed to clear offline tile cache',
        ),
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  const resolvePersistablePinName = useCallback(
    (latitude: number, longitude: number): string => {
      const trimmed = customPinName.trim();
      if (trimmed.length > 0) return trimmed;
      if (
        resolvedPinGeo &&
        Math.abs(resolvedPinGeo.lat - latitude) < 0.0015 &&
        Math.abs(resolvedPinGeo.lon - longitude) < 0.0015
      ) {
        return resolvedPinGeo.friendlyLabel;
      }
      if (
        Math.abs(activeLocation.latitude - latitude) < 0.0015 &&
        Math.abs(activeLocation.longitude - longitude) < 0.0015 &&
        !isCoordinateLikeLocationName(activeLocation.name)
      ) {
        return activeLocation.name;
      }
      return tr('Pin de Previsão no Mapa', 'Map Forecast Pin');
    },
    [customPinName, resolvedPinGeo, activeLocation.latitude, activeLocation.longitude, activeLocation.name, tr],
  );

  const handleSaveInspectedCoordinate = (
    latitude: number,
    longitude: number,
  ): void => {
    const resolvedName = resolvePersistablePinName(latitude, longitude);
    const regionLabel =
      forecastAreaRadiusKm > 0
        ? tr(
            `Pin no Mapa (Área ${forecastAreaRadiusKm} km)`,
            `Map Pin (${forecastAreaRadiusKm} km Area)`,
          )
        : tr('Marcado via Pin Interativo', 'Pinned on Interactive Map');

    void safeAction(
      async () => {
        if (onSaveLocation) {
          await onSaveLocation({
            name: resolvedName,
            latitude,
            longitude,
            region: regionLabel,
            isFavorite: true,
          });
        } else {
          const nowIso = new Date().toISOString();
          await upsertSavedLocation({
            id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: resolvedName,
            latitude,
            longitude,
            elevationM: forecast?.elevationDemM,
            region: regionLabel,
            isFavorite: true,
            createdAtIso: nowIso,
            lastUsedAtIso: nowIso,
          });
        }
        const locs = await getSavedLocations();
        setDbSavedLocations(locs);
      },
      {
        actionKey: 'save_inspected_map_coordinate',
        moduleName: 'MapRadarTab',
        successTitle: tr(
          `Local "${resolvedName}" salvo nos Favoritos`,
          `Location "${resolvedName}" saved to Favorites`,
        ),
        errorTitle: tr(
          'Não foi possível salvar a coordenada',
          'Could not save coordinate',
        ),
        onToast,
        onErrorLog: handleLogError,
      },
    );
  };

  const handleSetPrimaryCoordinate = (
    latitude: number,
    longitude: number,
  ): void => {
    const resolvedName = resolvePersistablePinName(latitude, longitude);
    const regionLabel =
      forecastAreaRadiusKm > 0
        ? tr(
            `Área Principal (${forecastAreaRadiusKm} km)`,
            `Primary Area (${forecastAreaRadiusKm} km)`,
          )
        : tr('Área Principal Operacional', 'Primary Operational Area');

    void safeAction(
      async () => {
        if (onSetPrimaryLocation) {
          await onSetPrimaryLocation({
            name: resolvedName,
            latitude,
            longitude,
            region: regionLabel,
            origin: 'saved',
          });
        } else {
          if (onSaveLocation) {
            await onSaveLocation({
              name: resolvedName,
              latitude,
              longitude,
              region: regionLabel,
              isFavorite: true,
            });
          } else {
            const nowIso = new Date().toISOString();
            await upsertSavedLocation({
              id: `loc-primary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: resolvedName,
              latitude,
              longitude,
              elevationM: forecast?.elevationDemM,
              region: regionLabel,
              isFavorite: true,
              createdAtIso: nowIso,
              lastUsedAtIso: nowIso,
            });
          }
          const persisted = savePrimaryLocationPreference({
            name: resolvedName,
            latitude,
            longitude,
            region: regionLabel,
            origin: 'saved',
            updatedAtIso: new Date().toISOString(),
          });
          setPrimaryPreference(persisted);
          if (
            onSelectLocation &&
            (Math.abs(activeLocation.latitude - latitude) > 0.0005 ||
              Math.abs(activeLocation.longitude - longitude) > 0.0005)
          ) {
            await onSelectLocation({
              latitude,
              longitude,
              name: resolvedName,
              origin: 'saved',
            });
          }
        }
        setPrimaryPreference(loadPrimaryLocationPreference());
        const locs = await getSavedLocations();
        setDbSavedLocations(locs);
      },
      {
        actionKey: 'set_primary_map_coordinate',
        moduleName: 'MapRadarTab',
        successTitle: tr(
          `Área Principal definida: ${resolvedName}`,
          `Primary Area set: ${resolvedName}`,
        ),
        errorTitle: tr(
          'Não foi possível definir Área Principal',
          'Could not set Primary Area',
        ),
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

  const displayActivePlaceName = useMemo(
    () =>
      getFriendlyPlaceLabel(
        activeLocation.latitude,
        activeLocation.longitude,
        activeLocation.name,
      ),
    [activeLocation.latitude, activeLocation.longitude, activeLocation.name, getFriendlyPlaceLabel],
  );

  // Ícone de Bandeirinha Estilo Windy para o Ponto Ativo (sincronizado com modelo & hora selecionados)
  const activeWindyFlagIcon = useMemo(() => {
    const cardinal = degreesToCardinal(activeWindDir);

    const titleText =
      activeWindSpeed !== null && activeWindSpeed !== undefined
        ? `${formatWindValue(activeWindSpeed, 0)} ${cardinal ? `◄ ${cardinal}` : ''}${
            activeTempC !== null && activeTempC !== undefined
              ? ` • ${formatTempValue(activeTempC, 0)}`
              : ''
          }`
        : displayActivePlaceName.slice(0, 26);

    return createWindyFlagPinIcon({
      titleText,
      subtitleText: displayActivePlaceName.slice(0, 26),
      ctaText:
        forecastAreaRadiusKm > 0
          ? `${activeModelDisplayName} • ${tr('Área', 'Area')} ${forecastAreaRadiusKm} km`
          : `${activeModelDisplayName} • ${tr('Pin Ativo', 'Active Pin')}`,
      isPending: false,
    });
  }, [
    activeWindSpeed,
    activeWindDir,
    activeTempC,
    formatWindValue,
    formatTempValue,
    displayActivePlaceName,
    forecastAreaRadiusKm,
    activeModelDisplayName,
    tr,
  ]);

  // Ícone de Bandeirinha Estilo Windy quando o usuário inspeciona outro ponto sem aplicar automaticamente
  const inspectedPlaceLabel = useMemo(() => {
    if (!inspectedPoint) return '';
    return getFriendlyPlaceLabel(
      inspectedPoint.latitude,
      inspectedPoint.longitude,
      null,
    );
  }, [inspectedPoint, getFriendlyPlaceLabel]);

  const inspectedWindyFlagIcon = useMemo(() => {
    if (!inspectedPoint) return null;
    return createWindyFlagPinIcon({
      titleText:
        inspectedPlaceLabel || tr('Novo Pin no Mapa', 'New Map Pin'),
      subtitleText: `${inspectedPoint.latitude.toFixed(3)}°, ${inspectedPoint.longitude.toFixed(3)}°`,
      ctaText: isPinLocked
        ? tr('Pin Fixado (Consulta)', 'Pin Locked (Inspect)')
        : tr('Previsão para este local', 'Forecast for this spot'),
      isPending: true,
    });
  }, [inspectedPoint, inspectedPlaceLabel, isPinLocked, tr]);

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

  const activeStyleItem = BASE_MAP_STYLES.find((s) => s.id === baseStyle);
  const activeBaseStyleLabel = activeStyleItem
    ? tr(activeStyleItem.labelPt, activeStyleItem.labelEn)
    : tr('Mapa Padrão (OSM)', 'Standard Map (OSM)');

  const activePinTargetLat = inspectedPoint?.latitude ?? activeLocation.latitude;
  const activePinTargetLon = inspectedPoint?.longitude ?? activeLocation.longitude;

  const isSatelliteDegraded =
    goesSatelliteEnabled && (isBrowserOffline || satelliteTileErrors > 0);

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[90] h-[100dvh] w-[100vw] flex flex-col overflow-hidden bg-slate-950'
          : 'space-y-4 pb-8 min-w-0'
      }
    >
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
                {tr(
                  'Radar RainViewer temporariamente indisponível',
                  'RainViewer radar temporarily unavailable',
                )}
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                {radarState.statusMessage}.{' '}
                {tr(
                  `O mapa interativo (${activeBaseStyleLabel}), o Pin de previsão e o modo offline funcionam normalmente.`,
                  `The interactive map (${activeBaseStyleLabel}), forecast pin, and offline mode continue working normally.`,
                )}
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
            <span>{tr('Recarregar Radar', 'Reload Radar')}</span>
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
              <strong>
                {tr(
                  'Modo Seleção de Área Offline (2 Cliques):',
                  'Offline Area Selection Mode (2 Taps):',
                )}
              </strong>{' '}
              {!drawFirstCorner
                ? tr(
                    'Clique no Canto 1 do mapa para iniciar o retângulo.',
                    'Tap Corner 1 on the map to start the rectangle.',
                  )
                : tr(
                    `Canto 1 marcado (${drawFirstCorner.latitude.toFixed(3)}°, ${drawFirstCorner.longitude.toFixed(3)}°). Agora clique no Canto 2 oposto.`,
                    `Corner 1 marked (${drawFirstCorner.latitude.toFixed(3)}°, ${drawFirstCorner.longitude.toFixed(3)}°). Now tap the opposite Corner 2.`,
                  )}
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
            <span>{tr('Cancelar Desenho', 'Cancel Drawing')}</span>
          </button>
        </div>
      )}

      {/* Container Principal do Mapa Leaflet + Controles Táticos (Pin-Lock, Tela Cheia, Gaveta Windy) + Player RainViewer */}
      <section
        data-testid="map-main-section"
        className={
          isFullscreen
            ? 'flex-1 min-w-0 min-h-0 flex flex-col bg-slate-950 overflow-hidden'
            : 'rounded-2xl border border-sky-200/80 dark:border-sky-900/60 bg-white dark:bg-slate-900/90 overflow-hidden shadow-sm min-w-0'
        }
      >
        {/* Barra Tática Superior Compacta (Mobile 390x844 & Desktop) */}
        <div
          className={
            isFullscreen
              ? 'shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md px-2.5 py-1.5 space-y-1 min-w-0'
              : 'border-b border-sky-100 dark:border-slate-800 bg-white dark:bg-slate-900/95 px-2.5 py-2 sm:p-3 space-y-1.5 min-w-0'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
            <div className="space-y-0.5 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-600 text-white shadow-sm">
                  <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>{tr('Mapa & Radar', 'Map & Radar')}</span>
                </span>
                {!isFullscreen && (
                  <>
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                      {activeBaseStyleLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <HardDrive className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>{cacheStats.totalTiles} tiles</span>
                    </span>
                  </>
                )}
                {goesSatelliteEnabled && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      isSatelliteDegraded
                        ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                        : 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-200 border-indigo-200 dark:border-indigo-700'
                    }`}
                  >
                    <Satellite className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>GOES-East</span>
                  </span>
                )}
              </div>
              <p
                className={`text-[11px] truncate ${
                  isFullscreen
                    ? 'text-slate-200'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <strong className={isFullscreen ? 'text-white' : 'text-sky-900 dark:text-white'}>
                  {displayActivePlaceName}
                </strong>{' '}
                <span className="font-mono text-[10px] opacity-80">
                  ({activeLocation.latitude.toFixed(3)}°, {activeLocation.longitude.toFixed(3)}°)
                </span>
                {forecast ? ` • DEM ${Math.round(forecast.elevationDemM)}m` : ''}
              </p>
            </div>

            {/* Ações Táticas Essenciais: Pin-Lock, Centralizar Área Principal, HUD e Tela Cheia */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                type="button"
                data-testid="map-pin-lock-btn"
                onClick={() => setIsPinLocked((prev) => !prev)}
                aria-pressed={isPinLocked}
                aria-label={
                  isPinLocked
                    ? tr('Pin Fixado (clique para liberar)', 'Pin Locked (tap to unlock)')
                    : tr('Pin Livre (clique para fixar)', 'Free Pin (tap to lock)')
                }
                title={
                  isPinLocked
                    ? tr(
                        'Pin Fixado: navegue e inspecione a grade 3x3 sem alterar a previsão ativa',
                        'Pin Locked: pan and inspect the 3x3 grid without changing the active forecast',
                      )
                    : tr(
                        'Pin Livre: clicar ou arrastar no mapa atualiza o marcador de previsão',
                        'Free Pin: tapping or dragging on the map updates the forecast marker',
                      )
                }
                className={`min-h-[44px] min-w-[44px] px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1 border transition-colors ${
                  isPinLocked
                    ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                    : isFullscreen
                      ? 'bg-emerald-950/80 text-emerald-200 border-emerald-700 hover:bg-emerald-900/80'
                      : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100/80'
                }`}
              >
                {isPinLocked ? (
                  <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Unlock className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span className="hidden md:inline text-[11px]">
                  {isPinLocked ? tr('Fixo', 'Locked') : tr('Livre', 'Free')}
                </span>
              </button>

              <button
                type="button"
                data-testid="center-primary-area-btn"
                onClick={handleCenterOnPrimaryArea}
                className="min-h-[44px] min-w-[44px] px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
                aria-label={tr('Centralizar na Área Principal', 'Center on Primary Area')}
                title={tr('Centralizar na Área Principal', 'Center on Primary Area')}
              >
                <Crosshair className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden lg:inline text-[11px]">
                  {tr('Centralizar na Área Principal', 'Center on Primary')}
                </span>
              </button>

              <button
                type="button"
                data-testid="map-hud-toggle-btn"
                onClick={() => setIsHudHidden((prev) => !prev)}
                aria-pressed={isHudHidden}
                aria-label={
                  isHudHidden
                    ? tr('Mostrar HUD flutuante do mapa', 'Show floating map HUD')
                    : tr('Ocultar HUD flutuante do mapa', 'Hide floating map HUD')
                }
                title={isHudHidden ? tr('Mostrar HUD', 'Show HUD') : tr('Ocultar HUD', 'Hide HUD')}
                className={`min-h-[44px] min-w-[44px] p-2 rounded-xl text-xs font-bold inline-flex items-center justify-center border transition-colors ${
                  isHudHidden
                    ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                    : isFullscreen
                      ? 'bg-slate-800 text-sky-200 border-slate-700 hover:bg-slate-700'
                      : 'bg-sky-50 dark:bg-slate-800 text-sky-900 dark:text-sky-200 border-sky-200 dark:border-slate-700 hover:bg-sky-100'
                }`}
              >
                {isHudHidden ? (
                  <Eye className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                data-testid="map-fullscreen-btn"
                onClick={() => setIsFullscreen((prev) => !prev)}
                aria-pressed={isFullscreen}
                aria-label={
                  isFullscreen
                    ? tr('Reduzir mapa da tela cheia', 'Exit fullscreen map')
                    : tr('Expandir mapa em tela cheia', 'Expand map fullscreen')
                }
                title={isFullscreen ? tr('Reduzir Mapa', 'Exit Fullscreen') : tr('Tela Cheia', 'Fullscreen')}
                className={`min-h-[44px] min-w-[44px] px-2 sm:px-2.5 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1 border transition-colors ${
                  isFullscreen
                    ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-500 shadow-sm'
                    : 'bg-sky-50 dark:bg-slate-800 text-sky-900 dark:text-sky-200 border-sky-200 dark:border-slate-700 hover:bg-sky-100'
                }`}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Maximize2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span className="hidden xl:inline text-[11px]">
                  {isFullscreen ? tr('Sair', 'Exit') : tr('Tela Cheia', 'Fullscreen')}
                </span>
              </button>
            </div>
          </div>

          {/* Seletor Direto de Modelo Meteorológico no Mapa (compacto em linha única no mobile) */}
          <div
            className="flex items-center gap-1.5 pt-1.5 border-t border-sky-100/80 dark:border-slate-800 min-w-0 overflow-x-auto scrollbar-thin flex-nowrap sm:flex-wrap"
            role="group"
            aria-label={tr('Modelo meteorológico no mapa', 'Weather model on map')}
          >
            <span
              className={`text-[11px] font-bold mr-0.5 shrink-0 ${
                isFullscreen ? 'text-sky-300' : 'text-sky-800 dark:text-sky-300'
              }`}
            >
              {tr('Modelo:', 'Model:')}
            </span>
            {MAP_MODEL_OPTIONS.map((opt) => {
              const active = mapModelMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleMapModelSelect(opt.id)}
                  aria-pressed={active}
                  className={`min-h-[34px] px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-bold border whitespace-nowrap shrink-0 transition-all ${
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

        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            data-zoom-isolated="true"
            onWheel={(e) => {
              e.stopPropagation();
            }}
            style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
            className={
              isFullscreen
                ? 'relative flex-1 min-h-0 w-full touch-none overscroll-contain isolate overflow-hidden'
                : 'relative w-full h-[460px] sm:h-[530px] lg:h-[580px] touch-none overscroll-contain isolate overflow-hidden'
            }
          >
            <MapContainer
              center={[activeLocation.latitude, activeLocation.longitude]}
              zoom={12}
              scrollWheelZoom={true}
              touchZoom={true}
              bounceAtZoomLimits={false}
              className="w-full h-full z-0"
            >
              {/* Subclasse customizada de L.TileLayer com leitura prioritária do cache offline e servidores gratuitos OSM/Esri */}
              <OfflineBaseTileLayer theme={tileTheme} baseStyle={baseStyle} />

              {/* Ponte de sincronização de viewport, centro e clique no mapa */}
              <MapViewportBridge
                centerLat={activeLocation.latitude}
                centerLon={activeLocation.longitude}
                recenterTrigger={recenterTrigger}
                suppressAutoCenterCoords={suppressAutoCenterCoords}
                layoutKey={`${isFullscreen}_${isSidebarOpen}`}
                onViewportChange={handleViewportChange}
                onMapClick={handleMapClick}
              />

              {/* Camada Satélite Real-Time NASA GIBS / NOAA GOES-East GeoColor (zIndex 455: acima do mapa base, abaixo do RainViewer e vetores) */}
              {goesSatelliteEnabled && (
                <TileLayer
                  key={`nasa-gibs-goes-east-${satelliteReloadKey}`}
                  url={GOES_EAST_TILE_URL}
                  opacity={radarOpacity}
                  maxNativeZoom={7}
                  maxZoom={19}
                  tileSize={256}
                  zIndex={455}
                  attribution="NASA GIBS / NOAA GOES-East"
                  eventHandlers={{
                    tileerror: () => {
                      setSatelliteTileErrors((c) => c + 1);
                    },
                    tileload: () => {
                      setSatelliteTileErrors(0);
                    },
                  }}
                />
              )}

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
                selectedHourIdx={safeModelHourIdx}
                opacity={radarOpacity}
                animateFlow={true}
                showWindStreamlines={showWindStreamlines && activeWeatherLayer !== 'none'}
                temperatureUnit={units.temperature}
                precipitationUnit={units.precipitation}
                onLayerError={() => {
                  setActiveWeatherLayer('none');
                  onToast?.({
                    type: 'warning',
                    title: tr(
                      'Camada meteorológica ocultada por segurança',
                      'Weather layer hidden for safety',
                    ),
                    message: tr(
                      'O mapa base continua operando normalmente.',
                      'Base map continues operating normally.',
                    ),
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
                    interactive: false,
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
                    interactive: false,
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
                  <div className="min-w-[235px] space-y-2 text-slate-800">
                    <div className="border-b border-sky-100 pb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
                        {tr('Pin de Previsão Ativo', 'Active Forecast Pin')}
                      </span>
                      <h4 className="font-bold text-sm text-slate-900">
                        {displayActivePlaceName}
                        {isResolvingPinGeo ? ' …' : ''}
                      </h4>
                      <p className="text-[11px] font-mono text-slate-500">
                        {activeLocation.latitude.toFixed(4)}°,{' '}
                        {activeLocation.longitude.toFixed(4)}°
                        {forecastAreaRadiusKm > 0
                          ? ` • ${tr('Área', 'Area')} ${forecastAreaRadiusKm} km`
                          : ''}
                      </p>
                    </div>

                    {currentForecastHour && forecast ? (
                      <div className="space-y-1.5 text-xs">
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="bg-sky-50/80 p-2 rounded-lg border border-sky-100">
                            <span className="text-[10px] text-slate-500 block">
                              {tr('Vento 10m / Rajada', 'Wind 10m / Gust')}
                            </span>
                            <strong className="font-bold text-sky-900">
                              {formatWindValue(currentForecastHour.windSpeed10m.mean, 1)} /{' '}
                              {formatWindValue(currentForecastHour.windGusts10m.mean, 1)}
                            </strong>
                          </div>
                          <div className="bg-sky-50/80 p-2 rounded-lg border border-sky-100">
                            <span className="text-[10px] text-slate-500 block">
                              {tr('Direção / Temp', 'Direction / Temp')}
                            </span>
                            <strong className="font-bold text-sky-900">
                              {currentForecastHour.windDirection10m.degree !== null
                                ? `${degreesToCardinal(currentForecastHour.windDirection10m.degree)} (${Math.round(currentForecastHour.windDirection10m.degree)}°)`
                                : '—'}{' '}
                              • {formatTempValue(currentForecastHour.temperature2mC.mean, 1)}
                            </strong>
                          </div>
                        </div>

                        <div className="bg-sky-50/80 p-2 rounded-lg border border-sky-100 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-500">
                            {tr('Chuva / Ondas:', 'Rain / Waves:')}
                          </span>
                          <strong className="font-bold text-sky-900">
                            {formatPrecipValue(currentForecastHour.precipitationMm.mean, 1)} •{' '}
                            {forecast.marineAvailable && currentForecastHour.marine
                              ? `${formatWaveValue(currentForecastHour.marine.waveHeight, 1)} (${currentForecastHour.marine.wavePeriod?.toFixed(0) ?? '—'}s)`
                              : tr('Ponto Continental', 'Inland Point')}
                          </strong>
                        </div>

                        <div className="flex items-center justify-between pt-1 text-[11px] text-slate-600">
                          <span>
                            {tr('Confiança:', 'Confidence:')}{' '}
                            <strong className="text-sky-700">
                              {currentForecastHour.confidence.total}%
                            </strong>
                          </span>
                          <span>
                            {tr('Altitude:', 'Elevation:')}{' '}
                            <strong>{Math.round(forecast.elevationDemM)}m</strong>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        {tr(
                          'Sincronizando previsão horária para este Pin...',
                          'Syncing hourly forecast for this Pin...',
                        )}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-sky-100">
                      <button
                        type="button"
                        data-testid="popup-save-location-btn"
                        onClick={() =>
                          handleSaveInspectedCoordinate(
                            activeLocation.latitude,
                            activeLocation.longitude,
                          )
                        }
                        className="min-h-[40px] px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                      >
                        <Bookmark className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                        <span>{tr('Salvar Local', 'Save Location')}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="popup-set-primary-btn"
                        onClick={() =>
                          handleSetPrimaryCoordinate(
                            activeLocation.latitude,
                            activeLocation.longitude,
                          )
                        }
                        className="min-h-[40px] px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                      >
                        <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{tr('Definir como Principal', 'Set as Primary')}</span>
                      </button>
                    </div>
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
                            {loc.isFavorite
                              ? tr('★ Local Favorito', '★ Favorite Location')
                              : tr('Local Salvo', 'Saved Location')}
                          </span>
                          <h4 className="font-bold text-sm">{loc.name}</h4>
                          <p className="text-xs font-mono text-slate-500">
                            {loc.latitude.toFixed(4)}°, {loc.longitude.toFixed(4)}°
                          </p>
                          {loc.elevationM !== undefined && loc.elevationM !== null && (
                            <p className="text-xs text-slate-500">
                              {tr('Altitude:', 'Elevation:')} {Math.round(loc.elevationM)} m
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
                            {tr('Previsão para este local', 'Forecast for this spot')}
                          </button>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}

            {/* Marcadores de Waypoints Georreferenciados com Foto e ConditionSnapshot */}
            {showWaypoints &&
              waypoints.map((wp) => {
                const safeBadge = formatSafeWindowLabel(wp.conditions.safeWindow, tr);
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
                            {tr('Waypoint de Campo', 'Field Waypoint')}
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
                              alt={tr(
                                `Foto do waypoint ${wp.name}`,
                                `Photo of waypoint ${wp.name}`,
                              )}
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
                            {tr('Condições no Momento:', 'Conditions at Capture:')}
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            <span>
                              {tr('Vento:', 'Wind:')}{' '}
                              <strong>
                                {formatWindValue(wp.conditions.windSpeed10mKmh, 1)}
                              </strong>
                            </span>
                            <span>
                              {tr('Rajada:', 'Gust:')}{' '}
                              <strong>
                                {formatWindValue(wp.conditions.windGusts10mKmh, 1)}
                              </strong>
                            </span>
                            <span>
                              {tr('Temp:', 'Temp:')}{' '}
                              <strong>
                                {formatTempValue(wp.conditions.temperature2mC, 1)}
                              </strong>
                            </span>
                            <span>
                              {tr('Onda:', 'Wave:')}{' '}
                              <strong>
                                {wp.conditions.waveHeightM !== null
                                  ? formatWaveValue(wp.conditions.waveHeightM, 1)
                                  : tr('Cont.', 'Inland')}
                              </strong>
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-600 pt-0.5">
                            {safeBadge.label} • {tr('Confiança:', 'Confidence:')}{' '}
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
                              {tr('Distância:', 'Distance:')}{' '}
                              <strong>{track.totalDistanceKm.toFixed(2)} km</strong>
                            </p>
                            <p>
                              {tr('Pontos aceitos (≤20m):', 'Accepted points (≤20m):')}{' '}
                              <strong>{track.points.length}</strong> (
                              {tr('descartados:', 'discarded:')}{' '}
                              {track.discardedLowAccuracyCount})
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {tr('Início:', 'Start:')}{' '}
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
                      const label = getFriendlyPlaceLabel(
                        inspectedPoint.latitude,
                        inspectedPoint.longitude,
                        null,
                      );
                      handleSelectMapCoordinate(
                        inspectedPoint.latitude,
                        inspectedPoint.longitude,
                        label,
                        'search',
                        { suppressRecenter: true },
                      );
                    },
                  }}
                />
              )}
          </MapContainer>

          {/* Botão Flutuante [☰ Camadas] no canto superior esquerdo dentro do viewport do mapa (ao lado do zoom Leaflet) */}
          <button
            type="button"
            data-testid="map-layers-drawer-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setIsSidebarOpen((prev) => !prev);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-expanded={isSidebarOpen}
            aria-controls="map-windy-controls-drawer"
            aria-label={
              isSidebarOpen
                ? tr('Fechar painel de camadas do mapa', 'Close map layers panel')
                : tr('Abrir painel de camadas do mapa', 'Open map layers panel')
            }
            title={tr('Camadas, Satélite, Radar & Pin', 'Layers, Satellite, Radar & Pin')}
            className={`absolute top-2.5 left-[52px] z-[505] min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border shadow-lg backdrop-blur-md transition-all ${
              isSidebarOpen
                ? 'bg-sky-600 text-white border-sky-500'
                : isFullscreen
                  ? 'bg-slate-900/90 hover:bg-slate-800/95 text-sky-100 border-slate-700/90'
                  : 'bg-white/95 dark:bg-slate-900/95 hover:bg-sky-50 dark:hover:bg-slate-800 text-sky-900 dark:text-sky-100 border-sky-200/90 dark:border-slate-700'
            }`}
          >
            <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{tr('Camadas', 'Layers')}</span>
            {(goesSatelliteEnabled || radarEnabled) && (
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  goesSatelliteEnabled ? 'bg-indigo-400' : 'bg-emerald-400'
                }`}
                aria-hidden="true"
              />
            )}
          </button>

          {/* Scrim sutil apenas em telas mobile estreitas quando a gaveta interna estiver aberta */}
          {isSidebarOpen && (
            <div
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation();
                setIsSidebarOpen(false);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="sm:hidden absolute inset-0 z-[515] bg-slate-950/35 backdrop-blur-[1px]"
            />
          )}

          {/* Sidebar Interna Slide-Over Unificada (Camadas, Vetores, Radar, Satélite GOES-East, Estilo Base, Visibilidade & Pin) */}
          <aside
            id="map-windy-controls-drawer"
            data-testid="map-windy-drawer"
            data-open={isSidebarOpen ? 'true' : 'false'}
            aria-hidden={!isSidebarOpen}
            aria-label={tr('Painel de Camadas e Controles do Mapa', 'Map Layers & Controls Panel')}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className={`absolute inset-y-0 left-0 z-[520] w-[min(320px,88%)] sm:w-[356px] max-w-full flex flex-col bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-r border-sky-200/90 dark:border-slate-700/90 shadow-2xl transition-all duration-200 ease-out ${
              isSidebarOpen
                ? 'translate-x-0 opacity-100 pointer-events-auto'
                : '-translate-x-full opacity-0 pointer-events-none invisible overflow-hidden'
            }`}
          >
            {/* Cabeçalho fixo do Slide-Over com botão Fechar ✕ */}
            <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-sky-100 dark:border-slate-800 bg-sky-50/75 dark:bg-slate-900/95">
              <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-900 dark:text-white min-w-0">
                <SlidersHorizontal className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {tr('Camadas & Controles', 'Layers & Controls')}
                </span>
              </div>
              <button
                type="button"
                data-testid="map-layers-drawer-close"
                onClick={() => setIsSidebarOpen(false)}
                aria-label={tr('Fechar painel de camadas', 'Close layers panel')}
                title={tr('Fechar', 'Close')}
                className="min-h-[44px] min-w-[44px] -my-1.5 -mr-1.5 rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-sky-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Corpo rolável interno da Sidebar de Camadas */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3.5 text-xs">
              {/* 1. Camada Meteorológica do Modelo & Vetores Animados */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                    {tr('Camada do Modelo', 'Model Layer')}
                  </span>
                  <button
                    type="button"
                    data-testid="map-wind-flow-toggle"
                    onClick={() => setShowWindStreamlines((prev) => !prev)}
                    aria-pressed={showWindStreamlines}
                    aria-label={
                      showWindStreamlines
                        ? tr('Ocultar linhas de vento animadas', 'Hide animated wind streamlines')
                        : tr('Mostrar linhas de vento animadas', 'Show animated wind streamlines')
                    }
                    className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border transition-colors ${
                      showWindStreamlines
                        ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-sky-200 dark:border-slate-700 hover:bg-sky-50'
                    }`}
                  >
                    <Wind className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{tr('Vetores Vento', 'Wind Flow')}</span>
                  </button>
                </div>

                <div
                  className="grid grid-cols-2 gap-1.5"
                  role="group"
                  aria-label={tr('Camada meteorológica do modelo', 'Model weather layer')}
                >
                  {WEATHER_LAYER_OPTIONS.filter(
                    (opt) => opt.id !== 'waves' || forecast?.marineAvailable !== false,
                  ).map(({ id, labelPt, labelEn, Icon }) => {
                    const active = activeWeatherLayer === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setActiveWeatherLayer(id);
                          if (id !== 'none') {
                            setTimelineMode('model');
                          }
                        }}
                        aria-pressed={active}
                        className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-all ${
                          active
                            ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-sky-200/80 dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-slate-700/80'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{tr(labelPt, labelEn)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Satélite Real-Time NASA GIBS / NOAA GOES-East & Radar RainViewer */}
              <div className="pt-3 border-t border-sky-100 dark:border-slate-800 space-y-2">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                  {tr('Satélite ao Vivo & Radar', 'Live Satellite & Radar')}
                </span>

                {/* Toggle Satélite NASA GIBS / NOAA GOES-East GeoColor + HelpPopover */}
                <div className="rounded-xl border border-indigo-200/80 dark:border-indigo-900/70 bg-indigo-50/50 dark:bg-indigo-950/30 p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      data-testid="toggle-goes-satellite"
                      onClick={() => {
                        setGoesSatelliteEnabled((prev) => {
                          const next = !prev;
                          if (next) {
                            setSatelliteTileErrors(0);
                          }
                          return next;
                        });
                      }}
                      aria-pressed={goesSatelliteEnabled}
                      className={`flex-1 min-h-[44px] px-2.5 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-between gap-2 border transition-colors ${
                        goesSatelliteEnabled
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-indigo-200 dark:border-slate-700 hover:bg-indigo-50/70 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <Satellite className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {tr('Satélite GOES-East (GeoColor)', 'GOES-East Satellite (GeoColor)')}
                        </span>
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold shrink-0 ${
                          goesSatelliteEnabled
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {goesSatelliteEnabled ? tr('ATIVO', 'ON') : tr('OFF', 'OFF')}
                      </span>
                    </button>
                    <HelpPopover topic="goes_satellite" align="left" />
                  </div>

                  {goesSatelliteEnabled && !isSatelliteDegraded && (
                    <p className="text-[10px] text-indigo-800/90 dark:text-indigo-200/90 px-1 leading-snug">
                      {tr(
                        'NASA GIBS / NOAA GOES-East GeoColor ativo (z455, abaixo do radar e vetores).',
                        'NASA GIBS / NOAA GOES-East GeoColor active (z455, below radar and vectors).',
                      )}
                    </p>
                  )}

                  {isSatelliteDegraded && (
                    <div
                      role="status"
                      data-testid="goes-satellite-fallback-notice"
                      className="rounded-lg border border-amber-300/90 dark:border-amber-700/80 bg-amber-50/95 dark:bg-amber-950/60 p-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-start justify-between gap-2"
                    >
                      <div className="flex items-start gap-1.5 min-w-0">
                        <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="leading-snug">
                          {isBrowserOffline
                            ? tr(
                                'Offline: tiles GOES-East indisponíveis sem internet. Mapa base e vetores seguem ativos.',
                                'Offline: GOES-East tiles unavailable without internet. Base map and vectors remain active.',
                              )
                            : tr(
                                `Falha temporária em ${satelliteTileErrors} tile(s) NASA GIBS GOES-East. Mapa base preservado.`,
                                `Temporary error on ${satelliteTileErrors} NASA GIBS GOES-East tile(s). Base map preserved.`,
                              )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSatelliteTileErrors(0);
                          setSatelliteReloadKey((k) => k + 1);
                        }}
                        className="min-h-[32px] px-2 py-1 rounded-lg bg-amber-200/80 dark:bg-amber-900/80 hover:bg-amber-300/80 text-[10px] font-bold shrink-0"
                      >
                        {tr('Tentar', 'Retry')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Controles RainViewer + Segurança Mapa Limpo */}
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRadarEnabled((prev) => !prev)}
                    aria-pressed={radarEnabled}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-between gap-2 border transition-colors ${
                      radarEnabled
                        ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Radar className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                      <span>{tr('Radar Chuva (RainViewer)', 'Rain Radar (RainViewer)')}</span>
                    </span>
                    <span className="text-[10px] font-bold">
                      {radarEnabled ? tr('ATIVO', 'ON') : tr('OFF', 'OFF')}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-radar-safety"
                    onClick={() => {
                      const isBareMap =
                        !radarEnabled &&
                        activeWeatherLayer === 'none' &&
                        !goesSatelliteEnabled;
                      if (isBareMap) {
                        setRadarEnabled(true);
                        setActiveWeatherLayer(lastActiveWeatherLayerRef.current || 'wind');
                      } else {
                        setIsPlayingRadar(false);
                        setRadarEnabled(false);
                        setGoesSatelliteEnabled(false);
                        setActiveWeatherLayer('none');
                      }
                    }}
                    aria-pressed={
                      !radarEnabled &&
                      activeWeatherLayer === 'none' &&
                      !goesSatelliteEnabled
                    }
                    className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
                      !radarEnabled &&
                      activeWeatherLayer === 'none' &&
                      !goesSatelliteEnabled
                        ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                        : 'bg-white dark:bg-slate-800 border-sky-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-slate-700'
                    }`}
                    title={tr(
                      'Alternar rapidamente entre mapa limpo (sem radar/satélite/overlay) e camadas meteorológicas',
                      'Quickly toggle between clean base map and weather layers',
                    )}
                  >
                    <XCircle className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />
                    <span>
                      {!radarEnabled &&
                      activeWeatherLayer === 'none' &&
                      !goesSatelliteEnabled
                        ? tr('Camada Oculta (Ativar Radar)', 'Layers Hidden (Enable Radar)')
                        : tr('Desativar Radar', 'Disable Radar')}
                    </span>
                  </button>
                </div>

                {/* Controle de Opacidade Compartilhado (Modelo + Radar + Satélite GOES-East) */}
                <div className="rounded-xl bg-sky-50/70 dark:bg-slate-800/80 border border-sky-200/70 dark:border-slate-700 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-sky-900 dark:text-sky-200 inline-flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
                      <span>{tr('Opacidade das Camadas', 'Layer Opacity')}</span>
                    </span>
                    <span className="font-mono font-bold text-sky-700 dark:text-sky-300">
                      {Math.round(radarOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="map-layer-opacity-slider"
                    min={20}
                    max={100}
                    step={5}
                    value={Math.round(radarOpacity * 100)}
                    onChange={(e) => setLayerOpacity(Number(e.target.value) / 100)}
                    aria-label={tr(
                      'Opacidade das camadas de modelo, radar e satélite',
                      'Model, radar, and satellite layer opacity',
                    )}
                    className="w-full min-h-[36px] accent-sky-600 cursor-pointer"
                  />
                  <div className="flex items-center justify-between gap-1">
                    {RADAR_OPACITY_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setLayerOpacity(preset)}
                        className={`flex-1 min-h-[30px] rounded-lg text-[10px] font-bold border transition-colors ${
                          Math.abs(radarOpacity - preset) < 0.04
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-sky-200/80 dark:border-slate-700 hover:bg-sky-50'
                        }`}
                      >
                        {Math.round(preset * 100)}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 3. Estilo de Mapa Base */}
              <div className="pt-3 border-t border-sky-100 dark:border-slate-800 space-y-1.5">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                  {tr('Mapa Base (Gratuito)', 'Base Map (Free)')}
                </span>
                <div
                  className="grid grid-cols-3 gap-1 rounded-xl bg-sky-50/90 dark:bg-slate-800 p-1 border border-sky-200/80 dark:border-slate-700"
                  role="group"
                  aria-label={tr('Seletor de Estilo de Mapa Base', 'Base Map Style Selector')}
                >
                  {BASE_MAP_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setBaseStyle(style.id)}
                      className={`min-h-[38px] px-2 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                        baseStyle === style.id
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:text-sky-700 hover:bg-white/60 dark:hover:bg-slate-700'
                      }`}
                    >
                      {tr(style.shortLabelPt, style.shortLabelEn)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. Camadas de Campo (Locais Salvos, Waypoints, Trilhas, Área Offline) */}
              <div className="pt-3 border-t border-sky-100 dark:border-slate-800 space-y-1.5">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                  {tr('Dados de Campo no Mapa', 'Field Data Overlays')}
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowSavedLocations((prev) => !prev)}
                    aria-pressed={showSavedLocations}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                      showSavedLocations
                        ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Bookmark className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                    <span className="truncate">{tr('Locais', 'Locations')} ({savedLocations.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowWaypoints((prev) => !prev)}
                    aria-pressed={showWaypoints}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                      showWaypoints
                        ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                    <span className="truncate">Waypoints ({waypoints.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowTracks((prev) => !prev)}
                    aria-pressed={showTracks}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                      showTracks
                        ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Route className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                    <span className="truncate">{tr('Trilhas', 'Tracks')} ({tracks.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowMissionOverlay((prev) => !prev)}
                    aria-pressed={showMissionOverlay}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                      showMissionOverlay
                        ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Square className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                    <span className="truncate">{tr('Área Offline', 'Offline Area')}</span>
                  </button>
                </div>
              </div>

              {/* 5. Controles do Pin (Trava Pin-Lock, Modo Instantâneo, Raio de Área, Nome, Salvar e Principal) */}
              <div className="pt-3 border-t border-sky-100 dark:border-slate-800 space-y-2.5">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                  {tr('Pin de Previsão & Trava', 'Forecast Pin & Lock')}
                </span>

                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsPinLocked((prev) => !prev)}
                    aria-pressed={isPinLocked}
                    className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-between gap-1.5 border transition-colors ${
                      isPinLocked
                        ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                        : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isPinLocked ? (
                        <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>
                        {isPinLocked
                          ? tr('Pin Fixado (Só Consulta)', 'Pin Locked (Inspect Only)')
                          : tr('Pin Livre (Toque/Arraste)', 'Free Pin (Tap/Drag)')}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInstantWindyPin((prev) => !prev)}
                    aria-pressed={instantWindyPin}
                    className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                      instantWindyPin
                        ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                        : 'bg-sky-50/70 dark:bg-slate-800 border-sky-200 dark:border-slate-700 text-sky-900 dark:text-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {instantWindyPin
                        ? tr('Pin Instantâneo: Ativo', 'Instant Pin: Active')
                        : tr(
                            'Modo Inspeção (Confirmar)',
                            'Inspect Mode (Confirm)',
                          )}
                    </span>
                  </button>
                </div>

                {/* Raio da Área do Pin */}
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {tr('Área de Cobertura do Pin:', 'Pin Coverage Area:')}
                  </span>
                  <div className="grid grid-cols-5 gap-1 rounded-xl bg-sky-50/80 dark:bg-slate-800 p-1 border border-sky-200/80 dark:border-slate-700">
                    {FORECAST_AREA_RADIUS_OPTIONS_KM.map((radiusKm) => (
                      <button
                        key={radiusKm}
                        type="button"
                        onClick={() => setForecastAreaRadiusKm(radiusKm)}
                        className={`min-h-[34px] px-1 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          forecastAreaRadiusKm === radiusKm
                            ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-200 shadow-sm border border-sky-200/70 dark:border-slate-600'
                            : 'text-slate-600 dark:text-slate-400 hover:text-sky-700'
                        }`}
                      >
                        {radiusKm === 0 ? tr('Ponto', 'Pt') : `${radiusKm}km`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="inline-flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-xl bg-sky-50/70 dark:bg-slate-800 border border-sky-200 dark:border-slate-700 text-[11px] font-semibold text-sky-900 dark:text-sky-200 min-w-0">
                  <Navigation className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                  <span className="truncate flex-1">
                    {getFriendlyPlaceLabel(
                      activePinTargetLat,
                      activePinTargetLon,
                      activeLocation.name,
                    )}
                  </span>
                  <span className="font-mono text-[10px] opacity-75 shrink-0">
                    {activePinTargetLat.toFixed(3)}°, {activePinTargetLon.toFixed(3)}°
                  </span>
                </div>

                <input
                  type="text"
                  value={customPinName}
                  onChange={(e) => setCustomPinName(e.target.value)}
                  placeholder={tr(
                    'Nome personalizado para este Pin ou Área...',
                    'Custom name for this Pin or Area...',
                  )}
                  aria-label={tr(
                    'Nome personalizado para o Pin no mapa',
                    'Custom name for map Pin',
                  )}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />

                <div className="space-y-1.5">
                  {onSelectLocation && (
                    <button
                      type="button"
                      disabled={isPinLocked}
                      onClick={() => {
                        const targetName = resolvePersistablePinName(
                          activePinTargetLat,
                          activePinTargetLon,
                        );
                        handleSelectMapCoordinate(
                          activePinTargetLat,
                          activePinTargetLon,
                          targetName,
                          'search',
                          { suppressRecenter: true },
                        );
                      }}
                      title={
                        isPinLocked
                          ? tr(
                              'Pin Fixado: destrave o Pin Livre para aplicar novo local',
                              'Pin Locked: unlock Free Pin to apply a new spot',
                            )
                          : tr(
                              'Aplicar previsão para este Pin',
                              'Apply forecast for this Pin',
                            )
                      }
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{tr('Previsão para este Pin', 'Forecast for this Pin')}</span>
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      data-testid="map-save-location-btn"
                      onClick={() =>
                        handleSaveInspectedCoordinate(
                          activePinTargetLat,
                          activePinTargetLon,
                        )
                      }
                      className="min-h-[44px] px-2.5 py-2 rounded-xl text-[11px] font-semibold border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-sky-800 dark:text-sky-200 inline-flex items-center justify-center gap-1 transition-colors"
                    >
                      <Bookmark className="w-3.5 h-3.5 text-sky-600 shrink-0" aria-hidden="true" />
                      <span className="truncate">{tr('Salvar Local', 'Save Location')}</span>
                    </button>

                    <button
                      type="button"
                      data-testid="map-set-primary-btn"
                      onClick={() =>
                        handleSetPrimaryCoordinate(
                          activePinTargetLat,
                          activePinTargetLon,
                        )
                      }
                      className="min-h-[44px] px-2.5 py-2 rounded-xl text-[11px] font-semibold border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 inline-flex items-center justify-center gap-1 transition-colors"
                    >
                      <Crosshair className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                      <span className="truncate">{tr('Principal', 'Primary')}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Badge de Consulta da Grade 3x3 quando o Pin está Fixado */}
          {isPinLocked && inspectedPoint && (
            <div
              data-testid="map-locked-grid-badge"
              className={`absolute bottom-3 z-[510] max-w-[calc(100%-1.5rem)] sm:max-w-[330px] rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50/95 dark:bg-amber-950/95 backdrop-blur-md px-3 py-2 shadow-lg text-[11px] text-amber-950 dark:text-amber-100 space-y-0.5 pointer-events-none transition-all ${
                isSidebarOpen ? 'hidden sm:block sm:left-[368px]' : 'left-3'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {inspectedPlaceLabel || tr('Grade 3x3', '3x3 Grid')} ({inspectedPoint.latitude.toFixed(3)}°, {inspectedPoint.longitude.toFixed(3)}°)
                </span>
              </div>
              {lockedGridSample && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                  <span>
                    {tr('Vento:', 'Wind:')}{' '}
                    <strong>
                      {formatWindValue(lockedGridSample.windSpeedKmh, 0)}
                      {lockedGridSample.windDirectionDeg !== null
                        ? ` (${degreesToCardinal(lockedGridSample.windDirectionDeg)})`
                        : ''}
                    </strong>
                  </span>
                  <span>
                    {tr('Chuva:', 'Rain:')}{' '}
                    <strong>
                      {formatPrecipValue(lockedGridSample.precipMm, 1)}
                    </strong>
                  </span>
                  <span>
                    {tr('Temp:', 'Temp:')}{' '}
                    <strong>
                      {formatTempValue(lockedGridSample.tempC, 1)}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* HUD Meteorológico Compacto Não-Sobreposto (top-2.5 right-2.5, oculto em mobile estreito quando a sidebar está aberta) */}
          <div
            data-testid="map-weather-hud"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className={
              isHudHidden
                ? 'hidden'
                : `absolute top-2.5 right-2.5 z-[490] max-w-[220px] sm:max-w-[270px] rounded-2xl border backdrop-blur-md p-2 sm:p-2.5 shadow-md space-y-1.5 pointer-events-auto ${
                    isFullscreen
                      ? 'border-slate-700/90 bg-slate-900/92 text-slate-100'
                      : 'border-sky-200/90 dark:border-sky-800 bg-white/95 dark:bg-slate-900/95'
                  } ${isSidebarOpen ? 'hidden sm:block' : 'block'}`
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold ${
                  isFullscreen
                    ? 'text-sky-100'
                    : 'text-sky-900 dark:text-sky-100'
                }`}
              >
                <Radar className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                <span>{tr('Modelo:', 'Model:')} {activeModelDisplayName}</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  activeSpatialGrid.source === 'live_grid'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-sky-50 text-sky-700 border border-sky-200'
                }`}
              >
                {isLoadingSpatialGrid
                  ? tr('Atualizando...', 'Updating...')
                  : activeSpatialGrid.source === 'live_grid'
                    ? tr('Grade ao Vivo', 'Live Grid')
                    : tr('Campo do Ponto', 'Point Field')}
              </span>
            </div>

            <div
              className={`text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5 ${
                isFullscreen
                  ? 'text-slate-300'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <span>
                {tr('Vento:', 'Wind:')}{' '}
                <strong className={isFullscreen ? 'text-white' : 'text-slate-900 dark:text-white'}>
                  {formatWindValue(activeWindSpeed, 0)}
                </strong>
              </span>
              <span>
                {tr('Chuva:', 'Rain:')}{' '}
                <strong className={isFullscreen ? 'text-white' : 'text-slate-900 dark:text-white'}>
                  {formatPrecipValue(activePrecipMm, 1)}
                </strong>
              </span>
              <span>
                {tr('Temp:', 'Temp:')}{' '}
                <strong className={isFullscreen ? 'text-white' : 'text-slate-900 dark:text-white'}>
                  {formatTempValue(activeTempC, 0)}
                </strong>
              </span>
            </div>

            <div
              className={`text-[10px] flex items-center gap-1.5 ${
                isFullscreen
                  ? 'text-slate-300'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
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
                  ? tr(
                      'Radar RainViewer pausado pelo usuário',
                      'RainViewer radar paused by user',
                    )
                  : radarState?.available && activeFrame
                    ? tr(
                        `RainViewer: ${frames.length} quadros • ${formatFrameTimestamp(activeFrame.timeUnix, locale)} (só chuva ativa)${
                          radarTileErrorCount > 0 ? ' (alguns tiles falharam)' : ''
                        }`,
                        `RainViewer: ${frames.length} frames • ${formatFrameTimestamp(activeFrame.timeUnix, locale)} (active rain only)${
                          radarTileErrorCount > 0 ? ' (some tiles failed)' : ''
                        }`,
                      )
                    : isLoadingRadar
                      ? tr('Carregando Radar RainViewer...', 'Loading RainViewer Radar...')
                      : tr(
                          'Radar RainViewer indisponível (usando camada do modelo)',
                          'RainViewer radar unavailable (using model layer)',
                        )}
              </span>
            </div>

            {goesSatelliteEnabled && (
              <div
                className={`text-[10px] flex items-center gap-1.5 ${
                  isFullscreen
                    ? 'text-slate-200'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isSatelliteDegraded ? 'bg-amber-500' : 'bg-indigo-500'
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {isSatelliteDegraded
                    ? tr(
                        'Satélite GOES-East offline/indisponível',
                        'GOES-East Satellite offline/unavailable',
                      )
                    : tr(
                        `Satélite GOES-East GeoColor (${Math.round(radarOpacity * 100)}%)`,
                        `GOES-East GeoColor Satellite (${Math.round(radarOpacity * 100)}%)`,
                      )}
                </span>
              </div>
            )}

            {activeLegendSpec && (
              <div
                className={
                  isFullscreen
                    ? 'pt-1 border-t border-slate-700/80'
                    : 'pt-1 border-t border-sky-100 dark:border-slate-800'
                }
              >
                <div
                  className={`flex items-center justify-between text-[10px] font-semibold mb-1 ${
                    isFullscreen
                      ? 'text-slate-200'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span>
                    {activeWeatherLayer === 'wind'
                      ? tr('Vento 10m', 'Wind 10m')
                      : activeWeatherLayer === 'rain'
                        ? tr('Precipitação', 'Precipitation')
                        : activeWeatherLayer === 'temperature'
                          ? tr('Temperatura 2m', 'Temperature 2m')
                          : tr('Altura de Onda', 'Wave Height')}
                  </span>
                  <span>
                    {activeWeatherLayer === 'wind'
                      ? getWindUnitLabel(units.wind)
                      : activeWeatherLayer === 'temperature'
                        ? getTempUnitLabel(units.temperature)
                        : activeWeatherLayer === 'waves'
                          ? getWaveUnitLabel(units.wave)
                          : activeWeatherLayer === 'rain'
                            ? `${getPrecipUnitLabel(units.precipitation)}/h`
                            : activeLegendSpec.unit}
                  </span>
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
                <div
                  className={`flex items-center justify-between text-[9px] font-mono mt-0.5 ${
                    isFullscreen
                      ? 'text-slate-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {activeLegendSpec.stops.map((stop) => {
                    const hasPlus = stop.valueLabel.includes('+');
                    const num = Number.parseFloat(stop.valueLabel);
                    let displayLabel = stop.valueLabel;
                    if (Number.isFinite(num)) {
                      if (activeWeatherLayer === 'wind') {
                        const converted = convertWindSpeed(num, units.wind);
                        displayLabel =
                          converted !== null
                            ? `${
                                units.wind === 'ms'
                                  ? converted.toFixed(1)
                                  : String(Math.round(converted))
                              }${hasPlus ? '+' : ''}`
                            : stop.valueLabel;
                      } else if (activeWeatherLayer === 'temperature') {
                        const converted = convertTemperature(num, units.temperature);
                        displayLabel =
                          converted !== null
                            ? `${Math.round(converted)}°${hasPlus ? '+' : ''}`
                            : stop.valueLabel;
                      } else if (activeWeatherLayer === 'waves') {
                        const converted = convertWaveHeight(num, units.wave);
                        displayLabel =
                          converted !== null
                            ? `${converted.toFixed(1)}${getWaveUnitLabel(units.wave)}${hasPlus ? '+' : ''}`
                            : stop.valueLabel;
                      } else if (activeWeatherLayer === 'rain') {
                        const converted = convertPrecipitation(num, units.precipitation);
                        displayLabel =
                          converted !== null
                            ? `${
                                units.precipitation === 'in'
                                  ? converted.toFixed(2)
                                  : String(num)
                              }${hasPlus ? '+' : ''}`
                            : stop.valueLabel;
                      }
                    }
                    return <span key={stop.valueLabel}>{displayLabel}</span>;
                  })}
                </div>
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Barra de Reprodução Dual: Radar ao Vivo (RainViewer) ou Linha do Tempo do Modelo */}
        <div
          className={
            isFullscreen
              ? 'shrink-0 border-t border-slate-800 bg-slate-950/95 p-2.5 space-y-2 min-w-0'
              : 'border-t border-sky-100 dark:border-slate-800 bg-sky-50/40 dark:bg-slate-950/80 p-3 sm:p-4 space-y-2.5 min-w-0'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              className="inline-flex items-center rounded-xl bg-white dark:bg-slate-900 p-1 border border-sky-200/80 dark:border-slate-700"
              role="group"
              aria-label={tr('Fonte da linha do tempo do mapa', 'Map timeline source')}
            >
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
                {tr('Radar Chuva (RainViewer)', 'Rain Radar (RainViewer)')}
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
                {tr('Previsão', 'Forecast')} {activeModelDisplayName} ({maxModelTimelineHours}h)
              </button>
            </div>

            {timelineMode === 'model' && currentForecastHour && (
              <div className="flex items-center gap-2 text-xs">
                {safeModelHourIdx === currentLocalHourIdx ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                    {tr('Agora', 'Now')} • {formatLocalHourBadge(currentForecastHour.timestampUnix, forecast?.timezone)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedModelHourIdx(currentLocalHourIdx)}
                    className="px-2.5 py-0.5 rounded-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
                  >
                    {tr('Voltar para Agora', 'Back to Now')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            {/* Botões Play/Pause, Passo Anterior/Próximo e Opacidade (todos >= 44x44px) */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => setIsPlayingRadar((prev) => !prev)}
                disabled={
                  timelineMode === 'rainviewer'
                    ? frames.length <= 1 || !radarEnabled
                    : maxModelTimelineHours <= 1
                }
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-sm transition-colors"
                aria-label={
                  isPlayingRadar
                    ? tr('Pausar animação do radar', 'Pause radar animation')
                    : tr('Reproduzir radar', 'Play radar')
                }
              >
                {isPlayingRadar ? (
                  <>
                    <Pause className="w-4 h-4" aria-hidden="true" />
                    <span>{tr('Pausar', 'Pause')}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {timelineMode === 'rainviewer'
                        ? tr('Play Radar', 'Play Radar')
                        : tr('Play Modelo', 'Play Model')}
                    </span>
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
                title={tr('Quadro anterior', 'Previous frame')}
                aria-label={tr('Quadro anterior', 'Previous frame')}
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
                title={tr('Próximo quadro', 'Next frame')}
                aria-label={tr('Próximo quadro', 'Next frame')}
              >
                <SkipForward className="w-4 h-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={cycleLayerOpacityPreset}
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-slate-800 text-xs font-semibold text-sky-800 dark:text-slate-200 inline-flex items-center gap-1.5"
                title={tr('Alternar opacidade da camada', 'Toggle layer opacity')}
              >
                <Layers className="w-4 h-4 text-sky-600" aria-hidden="true" />
                <span>
                  {tr('Opacidade', 'Opacity')} {Math.round(radarOpacity * 100)}%
                </span>
              </button>

              <button
                type="button"
                onClick={() => void loadRainViewerRadar(true)}
                disabled={isLoadingRadar}
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-slate-800 text-xs font-semibold text-sky-800 dark:text-slate-200 inline-flex items-center gap-1.5"
                title={tr('Recarregar quadros do RainViewer', 'Reload RainViewer frames')}
              >
                <RefreshCw
                  className={`w-4 h-4 ${isLoadingRadar ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">
                  {tr('Atualizar Radar', 'Refresh Radar')}
                </span>
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
                    aria-label={tr(
                      'Linha do tempo do radar RainViewer',
                      'RainViewer radar timeline',
                    )}
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
                    aria-label={tr(
                      'Linha do tempo da previsão do modelo meteorológico',
                      'Weather model forecast timeline',
                    )}
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
                      {formatFrameTimestamp(currentForecastHour.timestampUnix, locale)}
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
                      {activeFrame.isNowcast
                        ? tr('Previsão (+30m)', 'Nowcast (+30m)')
                        : tr('Observado', 'Observed')}
                    </span>
                    <span className="font-mono text-xs sm:text-sm font-bold text-sky-900 dark:text-white bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-sky-200 dark:border-slate-800">
                      {formatFrameTimestamp(activeFrame.timeUnix, locale)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-slate-500">
                    {isLoadingRadar
                      ? tr('Carregando radar...', 'Loading radar...')
                      : tr('Radar pronto', 'Radar ready')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Módulo Isolado Abaixo do Mapa (Oculto em Tela Cheia): Mapas Offline / Área de Missão com Trava de 300 Tiles */}
      {!isFullscreen && (
        <CollapsibleModule
          testId="offline-maps-module"
          defaultOpen={false}
          keepMounted={true}
          hideIconStyle="chevron"
          icon={
            <HardDrive
              className="w-4 h-4 text-sky-600 dark:text-sky-400"
              aria-hidden="true"
            />
          }
          title={tr(
            'Mapas Offline (Área de Missão — trava de 300 tiles)',
            'Offline Maps (Mission Area — 300-tile cap)',
          )}
          subtitle={tr(
            `${cacheStats.totalTiles} tiles salvos (${formatBytes(cacheStats.totalBytes)}) • ${activeBaseStyleLabel}`,
            `${cacheStats.totalTiles} tiles saved (${formatBytes(cacheStats.totalBytes)}) • ${activeBaseStyleLabel}`,
          )}
          badge={
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                tileEstimate.exceedsLimit
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                  : 'bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300 border-sky-200 dark:border-sky-800'
              }`}
            >
              {tileEstimate.totalTiles} / {MAX_OFFLINE_TILES_PER_MISSION} tiles
            </span>
          }
          bodyClassName="px-4 pb-4 pt-2 sm:px-5 sm:pb-5 space-y-4 min-w-0"
        >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-sky-100 dark:border-slate-800 pb-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-sky-600" aria-hidden="true" />
                <span>
                  {tr(
                    'Mapa Offline para Campo (Salvar Área no Dispositivo)',
                    'Offline Field Map (Save Area on Device)',
                  )}
                </span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                {tr(
                  `Até ${MAX_OFFLINE_TILES_PER_MISSION} tiles / missão • ${MAX_CONCURRENT_TILE_DOWNLOADS} conexões simultâneas`,
                  `Up to ${MAX_OFFLINE_TILES_PER_MISSION} tiles / mission • ${MAX_CONCURRENT_TILE_DOWNLOADS} concurrent`,
                )}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              {tr(
                'Selecione um retângulo ou raio ao redor do Pin e salve o mapa ',
                'Select a rectangle or radius around the Pin and save the ',
              )}
              <strong>{activeBaseStyleLabel}</strong>{' '}
              {tr(
                'no armazenamento do dispositivo para consulta em campo mesmo sem sinal.',
                'map on your device for field use even without signal.',
              )}
            </p>
          </div>

          {/* Resumo do Cache Salvo & Botão de Limpeza */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3.5 py-2 rounded-xl bg-sky-50/70 dark:bg-slate-800/90 border border-sky-200/80 dark:border-slate-700 text-xs">
              <div className="font-bold text-sky-900 dark:text-white">
                {cacheStats.totalTiles} {tr('tiles salvos', 'tiles saved')} ({formatBytes(cacheStats.totalBytes)})
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr('Claro', 'Light')}: {cacheStats.lightTiles} • {tr('Escuro', 'Dark')}: {cacheStats.darkTiles}
              </div>
            </div>

            <button
              type="button"
              onClick={handleClearOfflineTileCache}
              disabled={cacheStats.totalTiles === 0 || isDownloadingTiles}
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/40 hover:bg-rose-100/80 disabled:opacity-40 text-rose-700 dark:text-rose-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span>{tr('Limpar Mapas Salvos', 'Clear Saved Maps')}</span>
            </button>
          </div>
        </div>

        {/* Controles de Definição do Retângulo e Níveis de Zoom */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Coluna 1: Seleção da Área Geográfica */}
          <div className="lg:col-span-7 space-y-3">
            <div className="text-xs font-bold text-sky-800 dark:text-sky-300">
              {tr(
                '1. Escolha a Área do Mapa para Salvar Offline',
                '1. Choose the Map Area to Save Offline',
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleUseCurrentViewportForMission}
                disabled={isDownloadingTiles}
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
              >
                <Compass className="w-4 h-4" aria-hidden="true" />
                <span>{tr('Usar Visão Atual do Mapa', 'Use Current Map View')}</span>
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
                    ? tr('Desenhando no Mapa (2 Cliques)...', 'Drawing on Map (2 Taps)...')
                    : tr('Desenhar Retângulo (2 Cliques)', 'Draw Rectangle (2 Taps)')}
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
                  {tr('Raio', 'Radius')} {radiusKm} km
                </button>
              ))}
            </div>

            {/* Coordenadas do Retângulo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-sky-50/50 dark:bg-slate-950/60 p-3 rounded-xl border border-sky-100 dark:border-slate-800">
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  {tr('Norte (Lat)', 'North (Lat)')}
                </span>
                <strong className="text-sky-950 dark:text-slate-200">
                  {missionBounds.north.toFixed(4)}°
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  {tr('Sul (Lat)', 'South (Lat)')}
                </span>
                <strong className="text-sky-950 dark:text-slate-200">
                  {missionBounds.south.toFixed(4)}°
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  {tr('Leste (Lon)', 'East (Lon)')}
                </span>
                <strong className="text-sky-950 dark:text-slate-200">
                  {missionBounds.east.toFixed(4)}°
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-sans text-slate-500 block">
                  {tr('Oeste (Lon)', 'West (Lon)')}
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
                  {tr('Zoom Mínimo', 'Min Zoom')} ({missionBounds.minZoom})
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
                      Zoom {z}{' '}
                      {z <= 10
                        ? tr('(Visão Regional)', '(Regional View)')
                        : z <= 13
                          ? tr('(Visão Local)', '(Local View)')
                          : tr('(Detalhe Costeiro)', '(Coastal Detail)')}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {tr('Zoom Máximo', 'Max Zoom')} ({missionBounds.maxZoom})
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
                      Zoom {z}{' '}
                      {z <= 10
                        ? tr('(Visão Regional)', '(Regional View)')
                        : z <= 13
                          ? tr('(Visão Local)', '(Local View)')
                          : tr('(Detalhe Costeiro)', '(Coastal Detail)')}
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
                  {tr('2. Estimativa de Armazenamento', '2. Storage Estimate')}
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
                      {tr(
                        `Limite de ${MAX_OFFLINE_TILES_PER_MISSION} tiles excedido (${tileEstimate.totalTiles} estimados)`,
                        `${MAX_OFFLINE_TILES_PER_MISSION}-tile limit exceeded (${tileEstimate.totalTiles} estimated)`,
                      )}
                    </strong>
                    <span>
                      {tr(
                        'Escolha um raio menor ou reduza o Zoom Máximo para habilitar o download offline.',
                        'Choose a smaller radius or lower Max Zoom to enable offline download.',
                      )}
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
                          ? tr('Salvando tiles offline...', 'Saving offline tiles...')
                          : downloadProgress.status === 'completed'
                            ? tr('Mapa salvo com sucesso', 'Map saved successfully')
                            : downloadProgress.status === 'cancelled'
                              ? tr('Download cancelado', 'Download cancelled')
                              : tr('Falha no download', 'Download failed')}
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
                      {downloadProgress.failedTiles}{' '}
                      {tr(
                        'tile(s) ignorados por oscilação de rede.',
                        'tile(s) skipped due to network fluctuation.',
                      )}
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
                    ? tr('Salvando Mapa Offline...', 'Saving Offline Map...')
                    : tr(
                        `Salvar ${tileEstimate.totalTiles} Tiles Offline`,
                        `Save ${tileEstimate.totalTiles} Offline Tiles`,
                      )}
                </span>
              </button>

              {isDownloadingTiles && (
                <button
                  type="button"
                  onClick={handleCancelOfflineDownload}
                  className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors"
                >
                  <XCircle className="w-4 h-4" aria-hidden="true" />
                  <span>{tr('Cancelar', 'Cancel')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
        </CollapsibleModule>
      )}
    </div>
  );
}

/**
 * Aba Mapa & Radar encapsulada em `<ModuleErrorBoundary>` para isolamento Zero-Crash.
 */
export function MapRadarTab(props: MapRadarTabProps): React.ReactElement {
  const { tr } = useLocale();
  return (
    <ModuleErrorBoundary
      moduleName={tr(
        'Aba Mapa Interativo, Pin Estilo Windy & Radar',
        'Interactive Map, Weather Pin & Radar Tab',
      )}
      fallbackDescription={tr(
        'Falha isolada no motor cartográfico ou camada de radar. As abas Previsão e Campo & Dados continuam operacionais.',
        'Isolated failure in the map engine or radar layer. Forecast and Field & Data tabs remain operational.',
      )}
      onErrorLog={props.onErrorLog}
    >
      <MapRadarTabContent {...props} />
    </ModuleErrorBoundary>
  );
}

export default MapRadarTab;
