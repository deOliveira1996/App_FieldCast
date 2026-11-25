import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Compass,
  Gauge,
  Plane,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import { useUnits } from '../../context/UnitsContext';
import {
  buildFallbackKpDataset,
  classifyKpScale,
  fetchNoaaKpIndex,
  type KpIndexDataset,
  loadManualKpOverride,
  saveManualKpOverride,
} from '../../services/kpIndexService';
import type { ActiveCoordinates } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type {
  EnsembleHour,
  ForecastViewMode,
  NativeModelHour,
  NormalizedForecast,
  SafeWindowStatus,
  WeatherModelId,
} from '../../types/weather';
import {
  computeDroneFlightAssessment,
  DEFAULT_DRONE_FLIGHT_LIMITS,
  type DroneFlightLimitKey,
  type DroneFlightLimits,
  getWindSpeedAtAltitude,
} from '../../utils/droneFlightIndex';
import {
  convertPressure,
  convertWindSpeed,
  getPressureUnitLabel,
  getWindUnitLabel,
  windSpeedToKmh,
} from '../../utils/units';
import {
  formatLocalHourBadge,
  formatLocalYMD,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { safeAction } from '../../utils/safeAction';
import { FullscreenViewer, ModelModeSwitchPill } from '../common';

const DRONE_LIMITS_STORAGE_KEY = 'fieldcast_drone_limits_v1';

const ALTITUDE_OPTIONS: ReadonlyArray<30 | 50 | 80 | 100 | 120> = [30, 50, 80, 100, 120];

const CAN_ATTACH_ECHARTS_REF =
  (typeof ReactECharts === 'function' &&
    Boolean(
      (ReactECharts as unknown as { prototype?: { isReactComponent?: unknown } }).prototype
        ?.isReactComponent,
    )) ||
  (typeof ReactECharts === 'object' && ReactECharts !== null);

const MODEL_BADGE_NAMES: Record<WeatherModelId, string> = {
  ecmwf_ifs025: 'ECMWF IFS 0.25°',
  gfs_seamless: 'NOAA GFS',
  icon_seamless: 'DWD ICON',
  gem_seamless: 'CMC GEM',
};

function isWeatherModelId(mode: ForecastViewMode): mode is WeatherModelId {
  return (
    mode === 'ecmwf_ifs025' ||
    mode === 'gfs_seamless' ||
    mode === 'icon_seamless' ||
    mode === 'gem_seamless'
  );
}

const STATUS_BADGE_MAP: Record<
  SafeWindowStatus,
  { container: string; dot: string; scoreText: string }
> = {
  green: {
    container:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/70 dark:bg-emerald-950/50 dark:text-emerald-100',
    dot: 'bg-emerald-500',
    scoreText: 'text-emerald-700 dark:text-emerald-300',
  },
  amber: {
    container:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-100',
    dot: 'bg-amber-500',
    scoreText: 'text-amber-700 dark:text-amber-300',
  },
  red: {
    container:
      'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700/70 dark:bg-rose-950/50 dark:text-rose-100',
    dot: 'bg-rose-500',
    scoreText: 'text-rose-700 dark:text-rose-300',
  },
};

export interface AeronauticsTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  isDark?: boolean;
  viewMode?: ForecastViewMode;
  onViewModeChange?: (mode: ForecastViewMode) => void;
  initialKpDataset?: KpIndexDataset;
  onFetchKpIndex?: () => Promise<KpIndexDataset>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

/**
 * Tesoura de Vento / Low-Level Wind Shear em `kt/100ft` entre 10m e 80m (ou 100m/120m).
 */
export function computeWindShearKtPer100ft(hour: EnsembleHour | undefined): {
  valueKtPer100ft: number;
  referenceTopM: number;
  severity: 'low' | 'moderate' | 'high';
  label: string;
} | null {
  if (!hour) {
    return null;
  }

  let referenceTopM = 80;
  let vTopKmh = hour.windSpeed80m.mean;
  let dirTopDeg = hour.windDirection80m.degree;

  if (vTopKmh === null) {
    if (hour.windSpeed100m.mean !== null) {
      referenceTopM = 100;
      vTopKmh = hour.windSpeed100m.mean;
      dirTopDeg = hour.windDirection100m.degree;
    } else if (hour.windSpeed120m.mean !== null) {
      referenceTopM = 120;
      vTopKmh = hour.windSpeed120m.mean;
      dirTopDeg = hour.windDirection120m.degree;
    } else {
      vTopKmh = getWindSpeedAtAltitude(hour, 80);
    }
  }

  const v10Kmh = hour.windSpeed10m.mean;
  const dir10Deg = hour.windDirection10m.degree;

  let valueKtPer100ft: number | null = null;

  if (typeof hour.windShearKtPer100ft === 'number' && Number.isFinite(hour.windShearKtPer100ft)) {
    valueKtPer100ft = Number(hour.windShearKtPer100ft.toFixed(2));
  } else if (v10Kmh !== null && vTopKmh !== null) {
    let deltaKmh: number;
    if (
      typeof dir10Deg === 'number' &&
      Number.isFinite(dir10Deg) &&
      typeof dirTopDeg === 'number' &&
      Number.isFinite(dirTopDeg)
    ) {
      const r10 = (dir10Deg * Math.PI) / 180;
      const rTop = (dirTopDeg * Math.PI) / 180;
      const du = vTopKmh * Math.sin(rTop) - v10Kmh * Math.sin(r10);
      const dv = vTopKmh * Math.cos(rTop) - v10Kmh * Math.cos(r10);
      deltaKmh = Math.hypot(du, dv);
    } else {
      deltaKmh = Math.abs(vTopKmh - v10Kmh);
    }

    const deltaKt = deltaKmh * 0.539957;
    const deltaHundredFt = ((referenceTopM - 10) * 3.28084) / 100;
    valueKtPer100ft =
      deltaHundredFt > 0 ? Number((deltaKt / deltaHundredFt).toFixed(2)) : 0;
  }

  if (valueKtPer100ft === null) {
    return null;
  }

  const severity: 'low' | 'moderate' | 'high' =
    valueKtPer100ft >= 6 ? 'high' : valueKtPer100ft >= 3 ? 'moderate' : 'low';
  const label =
    severity === 'high'
      ? 'Cisalhamento Severo'
      : severity === 'moderate'
        ? 'Cisalhamento Moderado'
        : 'Cisalhamento Leve';

  return {
    valueKtPer100ft,
    referenceTopM,
    severity,
    label,
  };
}

/**
 * Base Estimada de Nuvens / Teto Convectivo LCL (`125 * (T - Td)` metros AGL — Fórmula de Espy).
 */
export function computeCloudBaseLclM(
  temp2mC: number | null | undefined,
  dewPoint2mC: number | null | undefined,
): {
  metersAgl: number;
  feetAgl: number;
  category: 'IFR' | 'MVFR' | 'VFR';
  label: string;
} | null {
  if (
    typeof temp2mC !== 'number' ||
    !Number.isFinite(temp2mC) ||
    typeof dewPoint2mC !== 'number' ||
    !Number.isFinite(dewPoint2mC)
  ) {
    return null;
  }
  const spreadC = Math.max(0, temp2mC - dewPoint2mC);
  const metersAgl = Math.round(125 * spreadC);
  const feetAgl = Math.round(metersAgl * 3.28084);
  const category: 'IFR' | 'MVFR' | 'VFR' =
    metersAgl < 300 ? 'IFR' : metersAgl < 900 ? 'MVFR' : 'VFR';
  const label =
    category === 'IFR'
      ? 'Teto Baixo (IFR)'
      : category === 'MVFR'
        ? 'Teto Marginal (MVFR)'
        : 'Teto Amplo (VFR)';

  return {
    metersAgl,
    feetAgl,
    category,
    label,
  };
}

/**
 * Risco de Tempestade / Convecção combinando `CAPE (J/kg)` + `thunderstormRisk` + código WMO.
 */
export function computeConvectiveStormRisk(hour: EnsembleHour | undefined): {
  capeJkg: number | null;
  risk: 'none' | 'moderate' | 'high';
  label: string;
} {
  if (!hour) {
    return {
      capeJkg: null,
      risk: 'none',
      label: 'N/D',
    };
  }

  const capeJkg =
    typeof hour.capeJkg?.mean === 'number' && Number.isFinite(hour.capeJkg.mean)
      ? Math.round(hour.capeJkg.mean)
      : null;

  const isWmoStorm =
    typeof hour.weatherCodeDominant === 'number' && hour.weatherCodeDominant >= 95;

  if (hour.thunderstormRisk === 'high' || (capeJkg !== null && capeJkg >= 1500) || isWmoStorm) {
    return {
      capeJkg,
      risk: 'high',
      label: 'Alto (Tempestade / Cb)',
    };
  }

  if (
    hour.thunderstormRisk === 'moderate' ||
    (capeJkg !== null && capeJkg >= 500) ||
    hour.barometricSquallRisk
  ) {
    return {
      capeJkg,
      risk: 'moderate',
      label: 'Moderado (Convecção)',
    };
  }

  return {
    capeJkg,
    risk: 'none',
    label: 'Baixo / Estável',
  };
}

/**
 * Densidade-Altitude aproximada baseada na atmosfera padrão `ISA` + altitude `DEM` + pressão superficial.
 */
export function computeApproximateDensityAltitude(
  elevationDemM: number | null | undefined,
  surfacePressureHpa: number | null | undefined,
  temp2mC: number | null | undefined,
): {
  densityAltitudeM: number;
  densityAltitudeFt: number;
  isaDeltaC: number;
} | null {
  if (
    typeof elevationDemM !== 'number' ||
    !Number.isFinite(elevationDemM) ||
    typeof temp2mC !== 'number' ||
    !Number.isFinite(temp2mC)
  ) {
    return null;
  }

  const isaTempC = 15 - 0.0065 * elevationDemM;
  const isaDeltaC = Number((temp2mC - isaTempC).toFixed(1));
  const pressureAltitudeFt =
    typeof surfacePressureHpa === 'number' &&
    Number.isFinite(surfacePressureHpa) &&
    surfacePressureHpa > 300 &&
    surfacePressureHpa < 1100
      ? 145366.45 * (1 - Math.pow(surfacePressureHpa / 1013.25, 0.190284))
      : elevationDemM * 3.28084;

  const densityAltitudeFt = Math.round(pressureAltitudeFt + 118.8 * (temp2mC - isaTempC));
  const densityAltitudeM = Math.round(densityAltitudeFt / 3.28084);

  return {
    densityAltitudeM,
    densityAltitudeFt,
    isaDeltaC,
  };
}

/**
 * Projeta uma `EnsembleHour` para um único modelo meteorológico quando selecionado pelo piloto,
 * tratando variáveis parcialmente nulas (`80m`/`100m`/`120m`, `visibility`, `cape`) de forma segura.
 */
function projectHourForSingleModel(
  baseHour: EnsembleHour | undefined,
  nativeHour: NativeModelHour | undefined,
  modelId: WeatherModelId,
): EnsembleHour | undefined {
  if (!baseHour) {
    return undefined;
  }

  const pickScalar = (
    nativeVal: number | null | undefined,
    byModelVal: number | null | undefined,
  ): number | null => {
    if (typeof nativeVal === 'number' && Number.isFinite(nativeVal)) {
      return nativeVal;
    }
    if (typeof byModelVal === 'number' && Number.isFinite(byModelVal)) {
      return byModelVal;
    }
    return null;
  };

  const w10 = pickScalar(nativeHour?.windSpeed10m, baseHour.windSpeed10m.valuesByModel?.[modelId]);
  const w80 = pickScalar(nativeHour?.windSpeed80m, baseHour.windSpeed80m.valuesByModel?.[modelId]);
  const w100 = pickScalar(
    nativeHour?.windSpeed100m,
    baseHour.windSpeed100m.valuesByModel?.[modelId],
  );
  const w120 = pickScalar(
    nativeHour?.windSpeed120m,
    baseHour.windSpeed120m.valuesByModel?.[modelId],
  );

  const dir10 = pickScalar(
    nativeHour?.windDirection10m,
    baseHour.windDirection10m.valuesByModel?.[modelId],
  );
  const dir80 = pickScalar(
    nativeHour?.windDirection80m,
    baseHour.windDirection80m.valuesByModel?.[modelId],
  );
  const dir100 = pickScalar(
    nativeHour?.windDirection100m,
    baseHour.windDirection100m.valuesByModel?.[modelId],
  );
  const dir120 = pickScalar(
    nativeHour?.windDirection120m,
    baseHour.windDirection120m.valuesByModel?.[modelId],
  );

  const gust10 = pickScalar(
    nativeHour?.windGusts10m,
    baseHour.windGusts10m.valuesByModel?.[modelId],
  );
  const precipMm = pickScalar(
    nativeHour?.precipitation,
    baseHour.precipitationMm.valuesByModel?.[modelId],
  );
  const precipProb = pickScalar(
    nativeHour?.precipitationProbability,
    baseHour.precipitationProbabilityPct.valuesByModel?.[modelId],
  );
  const temp2m = pickScalar(
    nativeHour?.temperature2m,
    baseHour.temperature2mC.valuesByModel?.[modelId],
  );
  const dew2m = pickScalar(
    nativeHour?.dewPoint2m,
    baseHour.dewPoint2mC.valuesByModel?.[modelId],
  );
  const visM = pickScalar(nativeHour?.visibility, baseHour.visibilityM.valuesByModel?.[modelId]);
  const pressHpa = pickScalar(
    nativeHour?.surfacePressure,
    baseHour.surfacePressureHpa.valuesByModel?.[modelId],
  );
  const capeVal = pickScalar(nativeHour?.cape, baseHour.capeJkg?.valuesByModel?.[modelId]);

  const refTopSpeed = w80 ?? w100 ?? w120;
  const refTopHeight = w80 !== null ? 80 : w100 !== null ? 100 : 120;
  const alpha =
    w10 !== null && w10 > 0.5 && refTopSpeed !== null && refTopSpeed > 0.5
      ? Math.max(0.05, Math.min(0.6, Math.log(refTopSpeed / w10) / Math.log(refTopHeight / 10)))
      : baseHour.verticalProfile.alpha ?? 0.14;

  const estimateSpeedAt = (h: number, direct: number | null): number | null => {
    if (direct !== null) return direct;
    if (w10 !== null) {
      return Number((w10 * Math.pow(h / 10, alpha)).toFixed(1));
    }
    return getWindSpeedAtAltitude(baseHour, h);
  };

  const interpolatedLevels = [10, 30, 50, 80, 100, 120].map((heightM) => {
    const direct =
      heightM === 10
        ? w10
        : heightM === 80
          ? w80
          : heightM === 100
            ? w100
            : heightM === 120
              ? w120
              : null;
    const directDir =
      heightM === 10
        ? dir10
        : heightM === 80
          ? dir80
          : heightM === 100
            ? dir100
            : heightM === 120
              ? dir120
              : dir80 ?? dir10;

    return {
      heightM,
      speedKmh: estimateSpeedAt(heightM, direct),
      directionDeg: directDir ?? null,
      isInterpolated: direct === null,
    };
  });

  return {
    ...baseHour,
    windSpeed10m: { ...baseHour.windSpeed10m, mean: w10 },
    windSpeed80m: { ...baseHour.windSpeed80m, mean: w80 },
    windSpeed100m: { ...baseHour.windSpeed100m, mean: w100 },
    windSpeed120m: { ...baseHour.windSpeed120m, mean: w120 },
    windDirection10m: { ...baseHour.windDirection10m, degree: dir10 },
    windDirection80m: { ...baseHour.windDirection80m, degree: dir80 },
    windDirection100m: { ...baseHour.windDirection100m, degree: dir100 },
    windDirection120m: { ...baseHour.windDirection120m, degree: dir120 },
    windGusts10m: { ...baseHour.windGusts10m, mean: gust10 },
    precipitationMm: { ...baseHour.precipitationMm, mean: precipMm },
    precipitationProbabilityPct: {
      ...baseHour.precipitationProbabilityPct,
      mean: precipProb,
    },
    temperature2mC: { ...baseHour.temperature2mC, mean: temp2m },
    dewPoint2mC: { ...baseHour.dewPoint2mC, mean: dew2m },
    dewPointSpreadC:
      temp2m !== null && dew2m !== null ? Number((temp2m - dew2m).toFixed(1)) : null,
    visibilityM: { ...baseHour.visibilityM, mean: visM },
    surfacePressureHpa: {
      ...baseHour.surfacePressureHpa,
      mean: pressHpa ?? baseHour.surfacePressureHpa.mean,
    },
    capeJkg: baseHour.capeJkg
      ? { ...baseHour.capeJkg, mean: capeVal }
      : capeVal !== null
        ? {
            mean: capeVal,
            min: capeVal,
            max: capeVal,
            stdDev: 0,
            sampleCount: 1,
          }
        : undefined,
    weatherCodeDominant: nativeHour?.weatherCode ?? baseHour.weatherCodeDominant,
    windShearKtPer100ft: undefined,
    verticalProfile: {
      ...baseHour.verticalProfile,
      alpha,
      interpolatedLevels,
    },
  };
}

function loadSavedDroneLimits(): DroneFlightLimits {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return DEFAULT_DRONE_FLIGHT_LIMITS;
  }
  try {
    const raw = window.localStorage.getItem(DRONE_LIMITS_STORAGE_KEY);
    if (!raw) return DEFAULT_DRONE_FLIGHT_LIMITS;
    const parsed = JSON.parse(raw) as Partial<DroneFlightLimits>;
    const alt =
      parsed.targetAltitudeM === 30 ||
      parsed.targetAltitudeM === 50 ||
      parsed.targetAltitudeM === 80 ||
      parsed.targetAltitudeM === 100 ||
      parsed.targetAltitudeM === 120
        ? parsed.targetAltitudeM
        : DEFAULT_DRONE_FLIGHT_LIMITS.targetAltitudeM;
    return {
      targetAltitudeM: alt,
      maxWindKmh:
        typeof parsed.maxWindKmh === 'number' && Number.isFinite(parsed.maxWindKmh)
          ? Math.max(5, Math.min(100, parsed.maxWindKmh))
          : DEFAULT_DRONE_FLIGHT_LIMITS.maxWindKmh,
      maxGustKmh:
        typeof parsed.maxGustKmh === 'number' && Number.isFinite(parsed.maxGustKmh)
          ? Math.max(10, Math.min(120, parsed.maxGustKmh))
          : DEFAULT_DRONE_FLIGHT_LIMITS.maxGustKmh,
      maxKpIndex:
        typeof parsed.maxKpIndex === 'number' && Number.isFinite(parsed.maxKpIndex)
          ? Math.max(1, Math.min(9, parsed.maxKpIndex))
          : DEFAULT_DRONE_FLIGHT_LIMITS.maxKpIndex,
      maxPrecipMm:
        typeof parsed.maxPrecipMm === 'number' && Number.isFinite(parsed.maxPrecipMm)
          ? Math.max(0, Math.min(20, parsed.maxPrecipMm))
          : DEFAULT_DRONE_FLIGHT_LIMITS.maxPrecipMm,
      minVisibilityKm:
        typeof parsed.minVisibilityKm === 'number' && Number.isFinite(parsed.minVisibilityKm)
          ? Math.max(0.2, Math.min(20, parsed.minVisibilityKm))
          : DEFAULT_DRONE_FLIGHT_LIMITS.minVisibilityKm,
      ...(parsed.enabled ? { enabled: { ...parsed.enabled } } : {}),
    };
  } catch {
    return DEFAULT_DRONE_FLIGHT_LIMITS;
  }
}

export const AeronauticsTab: React.FC<AeronauticsTabProps> = ({
  forecast,
  activeLocation,
  isDark = false,
  viewMode,
  onViewModeChange,
  initialKpDataset,
  onFetchKpIndex,
  onToast,
  onErrorLog,
}) => {
  const { units } = useUnits();
  const hours = forecast?.hours ?? [];
  const currentHourIndex = useCurrentLocalHourIndex(hours, forecast?.timezone);
  const [selectedOffset, setSelectedOffset] = useState<number>(0);

  const [internalViewMode, setInternalViewMode] = useState<ForecastViewMode>('fieldcast');
  const rawViewMode = viewMode ?? internalViewMode;
  const effectiveViewMode: ForecastViewMode =
    rawViewMode === 'spaghetti' ? 'fieldcast' : rawViewMode;

  const [kpDataset, setKpDataset] = useState<KpIndexDataset>(
    () => initialKpDataset ?? buildFallbackKpDataset(),
  );
  const [isFetchingKp, setIsFetchingKp] = useState<boolean>(false);
  const [manualOverride, setManualOverride] = useState(() => loadManualKpOverride());
  const [droneLimits, setDroneLimits] = useState<DroneFlightLimits>(() => loadSavedDroneLimits());

  // Estados colapsáveis (todos expandidos por padrão para preservar 100% dos seletores de teste V3)
  const [isAviationMetricsExpanded, setIsAviationMetricsExpanded] = useState<boolean>(true);
  const [isDroneCardExpanded, setIsDroneCardExpanded] = useState<boolean>(true);
  const [isKpPanelExpanded, setIsKpPanelExpanded] = useState<boolean>(true);
  const [isVerticalProfileExpanded, setIsVerticalProfileExpanded] = useState<boolean>(true);

  const chartRefs = useRef<Record<string, ReactECharts | null>>({});

  const getEChartsRefProps = useCallback((chartKey: string): { ref?: React.Ref<ReactECharts> } => {
    if (!CAN_ATTACH_ECHARTS_REF) {
      return {};
    }
    return {
      ref: (instance: ReactECharts | null) => {
        if (instance) {
          chartRefs.current[chartKey] = instance;
        } else {
          delete chartRefs.current[chartKey];
        }
      },
    };
  }, []);

  const resizeMountedCharts = useCallback(() => {
    for (const instance of Object.values(chartRefs.current)) {
      try {
        instance?.getEchartsInstance?.()?.resize?.();
      } catch {
        // Ignora descarte transitório durante rotação de tela
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const handleViewportRefresh = () => {
      resizeMountedCharts();
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(resizeMountedCharts, 140);
    };

    window.addEventListener('resize', handleViewportRefresh);
    window.addEventListener('orientationchange', handleViewportRefresh);
    window.addEventListener('fieldcast:layout-refresh', handleViewportRefresh);

    return () => {
      window.removeEventListener('resize', handleViewportRefresh);
      window.removeEventListener('orientationchange', handleViewportRefresh);
      window.removeEventListener('fieldcast:layout-refresh', handleViewportRefresh);
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
      }
    };
  }, [resizeMountedCharts]);

  useEffect(() => {
    setSelectedOffset(0);
  }, [forecast?.locationKey]);

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      try {
        window.localStorage.setItem(DRONE_LIMITS_STORAGE_KEY, JSON.stringify(droneLimits));
      } catch {
        // ignore quota errors
      }
    }
  }, [droneLimits]);

  useEffect(() => {
    if (initialKpDataset) {
      setKpDataset(initialKpDataset);
      return;
    }

    let cancelled = false;
    setIsFetchingKp(true);
    const runner = onFetchKpIndex ?? (() => fetchNoaaKpIndex());

    void runner()
      .then((dataset) => {
        if (!cancelled) {
          setKpDataset(dataset);
        }
      })
      .catch(() => {
        // mantém cache / fallback offline
      })
      .finally(() => {
        if (!cancelled) {
          setIsFetchingKp(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialKpDataset, onFetchKpIndex]);

  const handleViewModeSelect = useCallback(
    (nextMode: ForecastViewMode) => {
      if (viewMode === undefined) {
        setInternalViewMode(nextMode);
      }
      onViewModeChange?.(nextMode);
    },
    [onViewModeChange, viewMode],
  );

  const effectiveHourIndex = useMemo(() => {
    if (hours.length === 0) return 0;
    return Math.max(0, Math.min(hours.length - 1, currentHourIndex + selectedOffset));
  }, [currentHourIndex, hours.length, selectedOffset]);

  const rawSelectedHour = hours[effectiveHourIndex];

  const selectedHour = useMemo(() => {
    if (!rawSelectedHour || !isWeatherModelId(effectiveViewMode)) {
      return rawSelectedHour;
    }
    const modelSeries = forecast?.nativeByModel?.[effectiveViewMode] ?? [];
    const nativeHour =
      modelSeries.find((item) => item.timestampUnix === rawSelectedHour.timestampUnix) ??
      modelSeries[effectiveHourIndex];
    return projectHourForSingleModel(rawSelectedHour, nativeHour, effectiveViewMode);
  }, [effectiveHourIndex, effectiveViewMode, forecast?.nativeByModel, rawSelectedHour]);

  const activeModelLabel = isWeatherModelId(effectiveViewMode)
    ? MODEL_BADGE_NAMES[effectiveViewMode]
    : 'FieldCast Ensemble';

  const effectiveKp = manualOverride.enabled ? manualOverride.kpValue : kpDataset.currentKp;
  const kpClassification = useMemo(() => classifyKpScale(effectiveKp), [effectiveKp]);

  const flightAssessment = useMemo(
    () => computeDroneFlightAssessment(selectedHour, effectiveKp, droneLimits),
    [droneLimits, effectiveKp, selectedHour],
  );

  // Derivações físicas de aviação e baixa troposfera
  const windShearMetrics = useMemo(
    () => computeWindShearKtPer100ft(selectedHour),
    [selectedHour],
  );

  const lclCloudBase = useMemo(
    () =>
      computeCloudBaseLclM(
        selectedHour?.temperature2mC.mean,
        selectedHour?.dewPoint2mC.mean,
      ),
    [selectedHour],
  );

  const convectiveRisk = useMemo(
    () => computeConvectiveStormRisk(selectedHour),
    [selectedHour],
  );

  const densityAltitude = useMemo(
    () =>
      computeApproximateDensityAltitude(
        forecast?.elevationDemM,
        selectedHour?.surfacePressureHpa.mean,
        selectedHour?.temperature2mC.mean,
      ),
    [forecast?.elevationDemM, selectedHour],
  );

  const upcomingWindows = useMemo(() => {
    if (hours.length === 0) return [];
    const startIdx =
      hours.length - currentHourIndex >= 6
        ? currentHourIndex
        : Math.max(0, hours.length - 12);
    const slice = hours.slice(startIdx, startIdx + 12);
    return slice.map((h, idx) => {
      const absIdx = startIdx + idx;
      let projected = h;
      if (isWeatherModelId(effectiveViewMode)) {
        const modelSeries = forecast?.nativeByModel?.[effectiveViewMode] ?? [];
        const nativeHour =
          modelSeries.find((item) => item.timestampUnix === h.timestampUnix) ??
          modelSeries[absIdx];
        projected = projectHourForSingleModel(h, nativeHour, effectiveViewMode) ?? h;
      }
      return {
        offset: absIdx - currentHourIndex,
        hourBadge: formatLocalHourBadge(h.timestampUnix, forecast?.timezone),
        assessment: computeDroneFlightAssessment(projected, effectiveKp, droneLimits),
      };
    });
  }, [
    currentHourIndex,
    droneLimits,
    effectiveKp,
    effectiveViewMode,
    forecast?.nativeByModel,
    forecast?.timezone,
    hours,
  ]);

  const handleManualKpValueChange = (nextVal: number) => {
    const clamped = Math.max(
      0,
      Math.min(9, Number.isFinite(nextVal) ? Number(nextVal.toFixed(1)) : 0),
    );
    const nextOverride = {
      enabled: true,
      kpValue: clamped,
      updatedAtIso: new Date().toISOString(),
    };
    setManualOverride(nextOverride);
    saveManualKpOverride(nextOverride);
  };

  const handleToggleManualOverride = (enabled: boolean) => {
    const nextOverride = {
      enabled,
      kpValue: manualOverride.kpValue,
      updatedAtIso: new Date().toISOString(),
    };
    setManualOverride(nextOverride);
    saveManualKpOverride(nextOverride);
  };

  const handleRefreshKp = () => {
    void safeAction(
      async () => {
        setIsFetchingKp(true);
        try {
          const fresh = onFetchKpIndex ? await onFetchKpIndex() : await fetchNoaaKpIndex();
          setKpDataset(fresh);
          onToast?.({
            type: 'success',
            title: 'Índice Kp atualizado (NOAA SWPC)',
            message: `Kp atual: ${fresh.currentKp.toFixed(1)} (${fresh.classification.scale})`,
          });
        } finally {
          setIsFetchingKp(false);
        }
      },
      {
        actionKey: 'aeronautics_refresh_kp',
        moduleName: 'AeronauticsTab',
        errorTitle: 'Erro ao atualizar Índice Kp NOAA',
        onToast,
        onErrorLog,
      },
    );
  };

  const verticalChartOption: EChartsOption = useMemo(() => {
    const altitudes = [10, 50, 80, 100, 120];
    const values = altitudes.map((alt) => {
      const speed = getWindSpeedAtAltitude(selectedHour, alt);
      return speed !== null ? Number(speed.toFixed(1)) : 0;
    });
    const textColor = isDark ? '#cbd5e1' : '#334155';
    const gridColor = isDark ? 'rgba(56, 189, 248, 0.14)' : 'rgba(148, 163, 184, 0.25)';

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      grid: { top: 20, right: 20, bottom: 26, left: 48 },
      xAxis: {
        type: 'category',
        data: altitudes.map((a) => `${a}m`),
        axisLabel: { color: textColor, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: 'km/h',
        nameTextStyle: { color: textColor, fontSize: 10 },
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: [
        {
          name: 'Vento em Altitude',
          type: 'bar',
          barWidth: '48%',
          data: values.map((v, idx) => ({
            value: v,
            itemStyle: {
              borderRadius: [6, 6, 0, 0],
              color:
                altitudes[idx] === droneLimits.targetAltitudeM
                  ? '#0284c7'
                  : v > droneLimits.maxWindKmh
                    ? '#e11d48'
                    : '#10b981',
            },
          })),
        },
      ],
    };
  }, [droneLimits.maxWindKmh, droneLimits.targetAltitudeM, isDark, selectedHour]);

  const kpTimelineOption: EChartsOption = useMemo(() => {
    const entries = kpDataset.entries.slice(-16);
    const textColor = isDark ? '#cbd5e1' : '#334155';
    const gridColor = isDark ? 'rgba(56, 189, 248, 0.14)' : 'rgba(148, 163, 184, 0.25)';

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      grid: { top: 18, right: 16, bottom: 26, left: 36 },
      xAxis: {
        type: 'category',
        data: entries.map((e) => e.timeTagUtc.slice(5, 16)),
        axisLabel: { color: textColor, fontSize: 9 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 9,
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: [
        {
          name: 'Índice Kp',
          type: 'bar',
          data: entries.map((e) => ({
            value: e.kp,
            itemStyle: {
              borderRadius: [4, 4, 0, 0],
              color: e.kp >= 5 ? '#e11d48' : e.kp >= 3.7 ? '#f59e0b' : '#10b981',
            },
          })),
        },
      ],
    };
  }, [isDark, kpDataset.entries]);

  const scoreStyles = STATUS_BADGE_MAP[flightAssessment.status];
  const kpBadgeStyles = STATUS_BADGE_MAP[kpClassification.severity];

  return (
    <div data-testid="aeronautics-tab" className="space-y-6 pb-8">
      {/* Cabeçalho Aeronáutico */}
      <section className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              <Plane className="w-4 h-4" aria-hidden="true" />
              <span>Módulo de Aeronáutica, Voo de Drone &amp; Clima Espacial (Kp)</span>
            </div>
            <h2 className="text-lg md:text-xl font-extrabold text-slate-900 dark:text-white">
              {activeLocation.name}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-3">
              <span>
                Solo DEM: <strong>{forecast ? `${Math.round(forecast.elevationDemM)} m` : 'N/D'}</strong>
              </span>
              <span>
                Alvo AGL: <strong>{droneLimits.targetAltitudeM} m</strong>
              </span>
              <span>
                Modelo: <strong>{activeModelLabel}</strong>
              </span>
              {selectedHour && (
                <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 font-semibold">
                  <Clock className="w-3.5 h-3.5" />
                  {formatLocalYMD(new Date(selectedHour.timestampUnix * 1000), forecast?.timezone)} ·{' '}
                  {formatLocalHourBadge(selectedHour.timestampUnix, forecast?.timezone)}
                </span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={handleRefreshKp}
            disabled={isFetchingKp}
            className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <RefreshCw className={`w-4 h-4 ${isFetchingKp ? 'animate-spin' : ''}`} />
            <span>Atualizar NOAA Kp</span>
          </button>
        </div>

        {/* Barra Seletora de Modelo Meteorológico */}
        <div className="pt-3 border-t border-slate-100 dark:border-sky-800/50">
          <ModelModeSwitchPill
            viewMode={effectiveViewMode}
            onViewModeChange={handleViewModeSelect}
            allowSpaghetti={false}
            compact={true}
            label="Modelo Aeronáutico:"
            testId="aeronautics-model-selector"
          />
        </div>

        {/* Seletor de Próximas Janelas de Voo (12h) */}
        {upcomingWindows.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-sky-800/50 space-y-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Janelas de Decolagem (Próximas 12h — toque para simular hora):
            </p>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {upcomingWindows.map((win) => {
                const isSelected = selectedOffset === win.offset;
                const dotColor =
                  win.assessment.status === 'green'
                    ? 'bg-emerald-500'
                    : win.assessment.status === 'amber'
                      ? 'bg-amber-500'
                      : 'bg-rose-500';
                return (
                  <button
                    key={win.offset}
                    type="button"
                    onClick={() => setSelectedOffset(win.offset)}
                    className={`min-h-[44px] min-w-[72px] shrink-0 px-3 py-1.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                        : 'bg-slate-50 dark:bg-[#0f243d] text-slate-800 dark:text-sky-100 border-slate-200 dark:border-sky-800/60 hover:bg-sky-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                      {win.hourBadge}
                    </span>
                    <span
                      className={`text-[10px] ${
                        isSelected ? 'text-sky-100' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Score {win.assessment.score}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Painel de Derivações Físicas Aeronáuticas (Wind Shear, LCL, CAPE/Convecção & Densidade-Altitude) */}
      <section
        data-testid="aviation-metrics-panel"
        aria-label="Indicadores Físicos de Aviação e Baixa Troposfera"
        className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
              <Gauge className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                Indicadores Físicos de Aviação &amp; Baixa Troposfera
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Tesoura de vento (kt/100ft), teto LCL (AGL), convecção CAPE e densidade-altitude ISA+DEM
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="toggle-aviation-metrics"
            aria-expanded={isAviationMetricsExpanded}
            onClick={() => setIsAviationMetricsExpanded((prev) => !prev)}
            className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-1.5 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/50"
          >
            {isAviationMetricsExpanded ? (
              <>
                <ChevronUp className="w-4 h-4" aria-hidden="true" />
                <span>Recolher</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
                <span>Expandir</span>
              </>
            )}
          </button>
        </div>

        {isAviationMetricsExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Wind className="w-3.5 h-3.5 text-sky-500" />
                Tesoura de Vento (Shear)
              </p>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                {windShearMetrics
                  ? `${windShearMetrics.valueKtPer100ft.toFixed(2)} kt/100ft`
                  : 'N/D'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {windShearMetrics
                  ? `${windShearMetrics.label} (10m–${windShearMetrics.referenceTopM}m)`
                  : 'Sem gradiente vertical'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Cloud className="w-3.5 h-3.5 text-sky-500" />
                Base de Nuvens / Teto LCL
              </p>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                {lclCloudBase ? `${lclCloudBase.metersAgl} m AGL` : 'N/D'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {lclCloudBase
                  ? `${lclCloudBase.feetAgl} ft · ${lclCloudBase.label}`
                  : '125 × (T − Td)'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                Convecção &amp; Tempestade
              </p>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                {convectiveRisk.label}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                CAPE:{' '}
                {convectiveRisk.capeJkg !== null ? `${convectiveRisk.capeJkg} J/kg` : 'N/D'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5 text-rose-500" />
                Densidade-Altitude (ISA+DEM)
              </p>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                {densityAltitude ? `${densityAltitude.densityAltitudeM} m` : 'N/D'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {densityAltitude
                  ? `${densityAltitude.densityAltitudeFt} ft (ISA ${
                      densityAltitude.isaDeltaC >= 0 ? '+' : ''
                    }${densityAltitude.isaDeltaC}°C)`
                  : 'Aguardando T2m / DEM'}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Grid Principal: Índice de Voo para Drone + Índice Kp Geomagnético */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card A: Índice de Condições de Voo para Drone (0–100) */}
        <section
          data-testid="drone-flight-score-card"
          aria-label="Índice de Condições de Voo para Drone"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                Índice de Condições de Voo (Drone)
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Vento AGL ({droneLimits.targetAltitudeM}m), rajadas, chuva, nevoeiro, cisalhamento e Kp
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                data-testid="drone-flight-score"
                className={`px-3.5 py-2 rounded-2xl border text-right ${scoreStyles.container}`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">
                  Score Drone
                </span>
                <span className={`text-2xl font-black leading-none ${scoreStyles.scoreText}`}>
                  {flightAssessment.score}/100
                </span>
              </div>

              <button
                type="button"
                data-testid="toggle-drone-score-card"
                aria-expanded={isDroneCardExpanded}
                onClick={() => setIsDroneCardExpanded((prev) => !prev)}
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-1 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/50"
                title={isDroneCardExpanded ? 'Recolher detalhes do Drone' : 'Expandir detalhes do Drone'}
              >
                {isDroneCardExpanded ? (
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {isDroneCardExpanded && (
            <>
              <div
                className={`rounded-xl border p-3.5 flex items-center gap-2.5 text-xs sm:text-sm font-bold ${scoreStyles.container}`}
              >
                {flightAssessment.status === 'green' ? (
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                ) : flightAssessment.status === 'amber' ? (
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                ) : (
                  <ShieldAlert className="w-5 h-5 shrink-0" />
                )}
                <span>{flightAssessment.label}</span>
              </div>

              {/* Métricas instantâneas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="rounded-xl bg-slate-50 dark:bg-[#0f243d] p-3 border border-slate-200/60 dark:border-sky-800/50">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                    Vento {droneLimits.targetAltitudeM}m
                  </span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    {flightAssessment.altitudeWindKmh !== null
                      ? `${(convertWindSpeed(flightAssessment.altitudeWindKmh, units.wind) ?? flightAssessment.altitudeWindKmh).toFixed(1)} ${getWindUnitLabel(units.wind)}`
                      : 'N/D'}
                  </strong>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-[#0f243d] p-3 border border-slate-200/60 dark:border-sky-800/50">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                    Rajadas 10m
                  </span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    {flightAssessment.gust10mKmh !== null
                      ? `${(convertWindSpeed(flightAssessment.gust10mKmh, units.wind) ?? flightAssessment.gust10mKmh).toFixed(1)} ${getWindUnitLabel(units.wind)}`
                      : 'N/D'}
                  </strong>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-[#0f243d] p-3 border border-slate-200/60 dark:border-sky-800/50">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                    Visibilidade
                  </span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    {flightAssessment.visibilityKm !== null
                      ? `${flightAssessment.visibilityKm.toFixed(1)} km`
                      : 'N/D'}
                  </strong>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-[#0f243d] p-3 border border-slate-200/60 dark:border-sky-800/50">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                    Kp Efetivo
                  </span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    Kp {flightAssessment.effectiveKp.toFixed(1)}
                  </strong>
                </div>
              </div>

              {/* Motivos / Fatores operacionais */}
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200">
                {flightAssessment.reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${scoreStyles.dot}`} />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>

              {/* Seletor de Altitude AGL & Limites da Aeronave */}
              <div className="pt-3 border-t border-slate-100 dark:border-sky-800/50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    Altitude de Missão (AGL):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {ALTITUDE_OPTIONS.map((alt) => (
                      <button
                        key={alt}
                        type="button"
                        onClick={() => setDroneLimits((prev) => ({ ...prev, targetAltitudeM: alt }))}
                        className={`min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-xl text-xs font-bold border transition-colors ${
                          droneLimits.targetAltitudeM === alt
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-sky-800'
                        }`}
                      >
                        {alt}m
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {(
                    [
                      {
                        key: 'maxWindKmh' as DroneFlightLimitKey,
                        label: `Vento Máx (${getWindUnitLabel(units.wind)})`,
                        testId: 'drone-limit-max-wind',
                        toggleTestId: 'drone-limit-enable-wind',
                        min: 5,
                        max: 150,
                        step: 1,
                        value: Number(
                          (
                            convertWindSpeed(droneLimits.maxWindKmh, units.wind) ??
                            droneLimits.maxWindKmh
                          ).toFixed(1),
                        ),
                        onValueChange: (val: number) => ({
                          maxWindKmh: Math.max(5, windSpeedToKmh(val, units.wind)),
                        }),
                      },
                      {
                        key: 'maxGustKmh' as DroneFlightLimitKey,
                        label: `Rajada Máx (${getWindUnitLabel(units.wind)})`,
                        testId: 'drone-limit-max-gust',
                        toggleTestId: 'drone-limit-enable-gust',
                        min: 5,
                        max: 200,
                        step: 1,
                        value: Number(
                          (
                            convertWindSpeed(droneLimits.maxGustKmh, units.wind) ??
                            droneLimits.maxGustKmh
                          ).toFixed(1),
                        ),
                        onValueChange: (val: number) => ({
                          maxGustKmh: Math.max(5, windSpeedToKmh(val, units.wind)),
                        }),
                      },
                      {
                        key: 'maxKpIndex' as DroneFlightLimitKey,
                        label: 'Kp Máx Tolerado',
                        testId: 'drone-limit-max-kp',
                        toggleTestId: 'drone-limit-enable-kp',
                        min: 1,
                        max: 9,
                        step: 0.5,
                        value: droneLimits.maxKpIndex,
                        onValueChange: (val: number) => ({
                          maxKpIndex: Math.max(1, Math.min(9, val || 4.5)),
                        }),
                      },
                      {
                        key: 'minVisibilityKm' as DroneFlightLimitKey,
                        label: 'Visib. Mín (km)',
                        testId: 'drone-limit-min-vis',
                        toggleTestId: 'drone-limit-enable-visibility',
                        min: 0.2,
                        max: 20,
                        step: 0.5,
                        value: droneLimits.minVisibilityKm,
                        onValueChange: (val: number) => ({
                          minVisibilityKm: Math.max(0.2, val || 3),
                        }),
                      },
                    ] as const
                  ).map((item) => {
                    const checked = droneLimits.enabled?.[item.key] ?? true;
                    return (
                      <div key={item.key} className="text-[11px] text-slate-600 dark:text-slate-300">
                        <label className="flex items-center justify-between gap-1 cursor-pointer">
                          <span className="truncate">{item.label}</span>
                          <input
                            type="checkbox"
                            data-testid={item.toggleTestId}
                            checked={checked}
                            onChange={(e) =>
                              setDroneLimits((prev) => ({
                                ...prev,
                                enabled: {
                                  ...(prev.enabled ?? {}),
                                  [item.key]: e.target.checked,
                                },
                              }))
                            }
                            className="h-4 w-4 accent-sky-600 rounded shrink-0"
                          />
                        </label>
                        <input
                          type="number"
                          data-testid={item.testId}
                          min={item.min}
                          max={item.max}
                          step={item.step}
                          disabled={!checked}
                          value={item.value}
                          onChange={(e) => {
                            const num = Number(e.target.value);
                            if (!Number.isFinite(num)) return;
                            setDroneLimits((prev) => ({
                              ...prev,
                              ...item.onValueChange(num),
                            }));
                          }}
                          className={`mt-1 w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white ${!checked ? 'opacity-45' : ''}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>

        {/* Card B: Índice Kp Geomagnético (NOAA SWPC + Input Manual) */}
        <section
          data-testid="kp-index-panel"
          aria-label="Painel de Índice Kp Geomagnético"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <Activity className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  Índice Kp Geomagnético &amp; GNSS
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Feed aberto NOAA SWPC ·{' '}
                  {manualOverride.enabled
                    ? 'Modo Override Manual Ativo'
                    : kpDataset.fromCache
                      ? 'Cache Local / Offline'
                      : 'NOAA SWPC ao vivo'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className={`px-3.5 py-2 rounded-2xl border text-right ${kpBadgeStyles.container}`}>
                <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">
                  Escala {kpClassification.scale}
                </span>
                <span className={`text-2xl font-black leading-none ${kpBadgeStyles.scoreText}`}>
                  Kp {effectiveKp.toFixed(1)}
                </span>
              </div>

              <button
                type="button"
                data-testid="toggle-kp-panel"
                aria-expanded={isKpPanelExpanded}
                onClick={() => {
                  setIsKpPanelExpanded((prev) => {
                    const next = !prev;
                    if (next) {
                      setTimeout(resizeMountedCharts, 80);
                    }
                    return next;
                  });
                }}
                className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-1 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/50"
                title={isKpPanelExpanded ? 'Recolher painel Kp' : 'Expandir painel Kp'}
              >
                {isKpPanelExpanded ? (
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {isKpPanelExpanded && (
            <>
              <div className={`rounded-xl border p-3.5 space-y-1 text-xs ${kpBadgeStyles.container}`}>
                <p className="font-bold flex items-center gap-1.5">
                  <Compass className="w-4 h-4 shrink-0" />
                  {kpClassification.label}
                </p>
                <p>{kpClassification.droneAdvisory}</p>
              </div>

              {/* Controles de Input Manual do Índice Kp */}
              <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/80 dark:bg-[#0f243d] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      data-testid="kp-override-toggle"
                      checked={manualOverride.enabled}
                      onChange={(e) => handleToggleManualOverride(e.target.checked)}
                      className="w-4 h-4 accent-sky-600 rounded"
                    />
                    <span>Usar input manual de Índice Kp (simulação/boletim local)</span>
                  </label>

                  {manualOverride.enabled && (
                    <button
                      type="button"
                      onClick={() => handleToggleManualOverride(false)}
                      className="min-h-[44px] min-w-[44px] px-3 py-1 rounded-xl border border-slate-300 dark:border-sky-700 text-xs font-semibold text-slate-700 dark:text-sky-200 hover:bg-white dark:hover:bg-sky-900/40 inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Voltar ao NOAA ({kpDataset.currentKp.toFixed(1)})</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Ajuste deslizante Kp (0.0 – 9.0)
                    </label>
                    <input
                      type="range"
                      aria-label="Slider Índice Kp Manual"
                      min={0}
                      max={9}
                      step={0.1}
                      value={manualOverride.enabled ? manualOverride.kpValue : kpDataset.currentKp}
                      onChange={(e) => handleManualKpValueChange(Number(e.target.value))}
                      className="w-full h-3 accent-sky-600 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Valor Kp Manual
                    </label>
                    <input
                      type="number"
                      data-testid="kp-manual-input"
                      aria-label="Índice Kp Manual"
                      min={0}
                      max={9}
                      step={0.1}
                      value={manualOverride.enabled ? manualOverride.kpValue : kpDataset.currentKp}
                      onChange={(e) => handleManualKpValueChange(Number(e.target.value))}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#132a47] text-sm font-extrabold text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Gráfico de Barras Kp 3h NOAA SWPC com Tela Cheia */}
              {kpDataset.entries.length > 0 && (
                <FullscreenViewer
                  title="Série NOAA SWPC Kp (Observado / Estimado / Previsto UTC)"
                  subtitle={`Escala atual: ${kpClassification.scale} · Kp ${effectiveKp.toFixed(1)}`}
                  testId="aeronautics-kp-chart-fullscreen"
                  className="rounded-xl border border-slate-200/70 dark:border-sky-800/60 bg-slate-50/50 dark:bg-[#0f243d]/70 p-3"
                >
                  {({ isFullscreen }) => (
                    <ReactECharts
                      {...getEChartsRefProps('kpTimeline')}
                      option={kpTimelineOption}
                      style={{
                        height: isFullscreen ? 'calc(100vh - 150px)' : 190,
                        width: '100%',
                      }}
                    />
                  )}
                </FullscreenViewer>
              )}
            </>
          )}
        </section>
      </div>

      {/* Perfil Vertical de Vento (10m – 120m) */}
      <section
        aria-label="Perfil Vertical de Vento em Altitude"
        className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Perfil Vertical AGL (10m a 120m) &amp; Cisalhamento
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Expoente Hellmann α:{' '}
                <strong>
                  {selectedHour?.verticalProfile.alpha !== null &&
                  selectedHour?.verticalProfile.alpha !== undefined
                    ? selectedHour.verticalProfile.alpha.toFixed(2)
                    : 'N/D'}
                </strong>{' '}
                · Queda Pressão 3h:{' '}
                <strong>
                  {selectedHour?.pressureDelta3hHpa !== null &&
                  selectedHour?.pressureDelta3hHpa !== undefined
                    ? `${selectedHour.pressureDelta3hHpa >= 0 ? '+' : ''}${
                        units.pressure === 'inhg'
                          ? `${(convertPressure(selectedHour.pressureDelta3hHpa, 'inhg') ?? 0).toFixed(2)}`
                          : selectedHour.pressureDelta3hHpa.toFixed(1)
                      } ${getPressureUnitLabel(units.pressure)}`
                    : 'N/D'}
                </strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedHour?.verticalProfile.atypicalShearWarning && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                Cisalhamento Atípico Detectado
              </span>
            )}

            <button
              type="button"
              data-testid="toggle-vertical-profile-section"
              aria-expanded={isVerticalProfileExpanded}
              onClick={() => {
                setIsVerticalProfileExpanded((prev) => {
                  const next = !prev;
                  if (next) {
                    setTimeout(resizeMountedCharts, 80);
                  }
                  return next;
                });
              }}
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-1.5 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/50"
            >
              {isVerticalProfileExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                  <span>Recolher</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  <span>Expandir</span>
                </>
              )}
            </button>
          </div>
        </div>

        {isVerticalProfileExpanded && (
          <FullscreenViewer
            title="Perfil Vertical AGL (10m a 120m) & Cisalhamento"
            subtitle={`${activeLocation.name} · Modelo: ${activeModelLabel} · Alvo AGL: ${droneLimits.targetAltitudeM}m`}
            testId="aeronautics-vertical-chart-fullscreen"
            className="rounded-xl border border-slate-200/70 dark:border-sky-800/60 bg-slate-50/50 dark:bg-[#0f243d]/70 p-3"
          >
            {({ isFullscreen }) => (
              <ReactECharts
                {...getEChartsRefProps('verticalProfile')}
                option={verticalChartOption}
                style={{
                  height: isFullscreen ? 'calc(100vh - 150px)' : 210,
                  width: '100%',
                }}
              />
            )}
          </FullscreenViewer>
        )}
      </section>
    </div>
  );
};
