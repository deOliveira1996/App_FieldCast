import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  AlertTriangle,
  Anchor,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Crosshair,
  Gauge,
  MapPin,
  Navigation,
  ShieldAlert,
  Sliders,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { useUnits } from '../../context/UnitsContext';
import type { ActiveCoordinates } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type {
  ForecastViewMode,
  NormalizedForecast,
  SafeWindowStatus,
  WeatherModelId,
} from '../../types/weather';
import { extractTideExtrema } from '../../utils/droneFlightIndex';
import {
  formatLocalHourBadge,
  formatLocalYMD,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { safeAction } from '../../utils/safeAction';
import {
  convertWaveHeight,
  convertWindSpeed,
  getWaveUnitLabel,
  getWindUnitLabel,
  waveHeightToM,
  windSpeedToKmh,
} from '../../utils/units';
import {
  FullscreenViewer,
  ModelModeSwitchPill,
  ModuleErrorBoundary,
} from '../common';
import { WindCompass } from '../field/WindCompass';
import { degreesToCardinalShort } from '../forecast/CurrentSummaryCard';

export const NAVIGATION_LIMITS_STORAGE_KEY = 'fieldcast_navigation_limits_v1';

export interface NavigationQualityLimits {
  maxWindKmh: number;
  maxWaveM: number;
  maxCurrentKmh: number;
  enabled?: Partial<Record<'maxWindKmh' | 'maxWaveM' | 'maxCurrentKmh', boolean>>;
}

export const DEFAULT_NAVIGATION_QUALITY_LIMITS: NavigationQualityLimits = {
  maxWindKmh: 30,
  maxWaveM: 2.0,
  maxCurrentKmh: 3.5,
};

const CAN_ATTACH_ECHARTS_REF =
  (typeof ReactECharts === 'function' &&
    Boolean(
      (ReactECharts as unknown as { prototype?: { isReactComponent?: unknown } }).prototype
        ?.isReactComponent,
    )) ||
  (typeof ReactECharts === 'object' && ReactECharts !== null);

const NAV_STATUS_BADGE_MAP: Record<
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

function loadSavedNavigationLimits(): NavigationQualityLimits {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return DEFAULT_NAVIGATION_QUALITY_LIMITS;
  }
  try {
    const raw = window.localStorage.getItem(NAVIGATION_LIMITS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_NAVIGATION_QUALITY_LIMITS;
    }
    const parsed = JSON.parse(raw) as Partial<NavigationQualityLimits>;
    return {
      maxWindKmh:
        typeof parsed.maxWindKmh === 'number' && Number.isFinite(parsed.maxWindKmh)
          ? Math.max(5, Math.min(110, parsed.maxWindKmh))
          : DEFAULT_NAVIGATION_QUALITY_LIMITS.maxWindKmh,
      maxWaveM:
        typeof parsed.maxWaveM === 'number' && Number.isFinite(parsed.maxWaveM)
          ? Math.max(0.2, Math.min(12, parsed.maxWaveM))
          : DEFAULT_NAVIGATION_QUALITY_LIMITS.maxWaveM,
      maxCurrentKmh:
        typeof parsed.maxCurrentKmh === 'number' && Number.isFinite(parsed.maxCurrentKmh)
          ? Math.max(0.2, Math.min(20, parsed.maxCurrentKmh))
          : DEFAULT_NAVIGATION_QUALITY_LIMITS.maxCurrentKmh,
      ...(parsed.enabled ? { enabled: { ...parsed.enabled } } : {}),
    };
  } catch {
    return DEFAULT_NAVIGATION_QUALITY_LIMITS;
  }
}

/**
 * Energia linear de swell em águas profundas: `P ≈ 0.49 * Hs^2 * Tp` (kW/m).
 */
export function computeSwellEnergyKwPerM(
  heightM: number | null | undefined,
  periodS: number | null | undefined,
): number | null {
  if (
    typeof heightM !== 'number' ||
    !Number.isFinite(heightM) ||
    heightM < 0 ||
    typeof periodS !== 'number' ||
    !Number.isFinite(periodS) ||
    periodS <= 0
  ) {
    return null;
  }
  return Number((0.49 * heightM * heightM * periodS).toFixed(2));
}

/**
 * Esbeltez da onda em águas profundas (`Wave Steepness = Hs / L0`, onde `L0 = g * T^2 / (2π)`).
 */
export function computeWaveSteepness(
  waveHeightM: number | null | undefined,
  wavePeriodS: number | null | undefined,
): { ratio: number; inverseRatio: number | null; classification: string } | null {
  if (
    typeof waveHeightM !== 'number' ||
    !Number.isFinite(waveHeightM) ||
    waveHeightM < 0 ||
    typeof wavePeriodS !== 'number' ||
    !Number.isFinite(wavePeriodS) ||
    wavePeriodS <= 0
  ) {
    return null;
  }
  const wavelengthM = (9.80665 * wavePeriodS * wavePeriodS) / (2 * Math.PI);
  if (wavelengthM <= 0) {
    return null;
  }
  const ratio = waveHeightM / wavelengthM;
  const inverseRatio = waveHeightM > 0.01 ? Math.round(wavelengthM / waveHeightM) : null;
  const classification =
    ratio >= 0.04
      ? 'Íngreme / Crista Curta'
      : ratio >= 0.022
        ? 'Moderada'
        : 'Suave / Longa';

  return {
    ratio: Number(ratio.toFixed(4)),
    inverseRatio,
    classification,
  };
}

export interface NavigationTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  isDark?: boolean;
  viewMode?: ForecastViewMode;
  onViewModeChange?: (mode: ForecastViewMode) => void;
  onRequestGps?: () => void | Promise<void>;
  onOpenLocationsModal?: () => void;
  simulatedCompassHeadingDeg?: number | null;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

function formatShortLocalTime(timestampUnix: number, timezone?: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    const day = d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone || undefined,
    });
    const hour = formatLocalHourBadge(timestampUnix, timezone);
    return `${day} ${hour}`;
  } catch {
    return formatLocalHourBadge(timestampUnix, timezone);
  }
}

export const NavigationTab: React.FC<NavigationTabProps> = ({
  forecast,
  activeLocation,
  isDark = false,
  viewMode,
  onViewModeChange,
  onRequestGps,
  onOpenLocationsModal,
  simulatedCompassHeadingDeg = null,
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

  const [navLimits, setNavLimits] = useState<NavigationQualityLimits>(() =>
    loadSavedNavigationLimits(),
  );

  // Estados colapsáveis das seções (todos expandidos por padrão para preservação integral dos testes V3)
  const [isScoreExpanded, setIsScoreExpanded] = useState<boolean>(true);
  const [isTideSectionExpanded, setIsTideSectionExpanded] = useState<boolean>(true);
  const [isCompassSectionExpanded, setIsCompassSectionExpanded] = useState<boolean>(true);

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
        // Ignora descarte transitório durante troca de layout/orientação
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
        window.localStorage.setItem(NAVIGATION_LIMITS_STORAGE_KEY, JSON.stringify(navLimits));
      } catch {
        // Ignora erro de quota/storage
      }
    }
  }, [navLimits]);

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

  const activeHour = hours[effectiveHourIndex];
  const marine = activeHour?.marine ?? null;

  // Métricas atmosféricas de superfície dinamicamente guiadas pelo modelo selecionado ou Ensemble
  const resolvedSurface = useMemo(() => {
    if (!activeHour) {
      return {
        sourceLabel: 'FieldCast Ensemble',
        windSpeed10mKmh: null as number | null,
        windDirection10mDeg: null as number | null,
        windGusts10mKmh: null as number | null,
        visibilityM: null as number | null,
      };
    }

    if (isWeatherModelId(effectiveViewMode)) {
      const modelSeries = forecast?.nativeByModel?.[effectiveViewMode] ?? [];
      const nativeHour =
        modelSeries.find((item) => item.timestampUnix === activeHour.timestampUnix) ??
        modelSeries[effectiveHourIndex];

      const windSpeed10mKmh =
        nativeHour?.windSpeed10m ??
        activeHour.windSpeed10m.valuesByModel?.[effectiveViewMode] ??
        null;
      const windDirection10mDeg =
        nativeHour?.windDirection10m ??
        activeHour.windDirection10m.valuesByModel?.[effectiveViewMode] ??
        null;
      const windGusts10mKmh =
        nativeHour?.windGusts10m ??
        activeHour.windGusts10m.valuesByModel?.[effectiveViewMode] ??
        null;
      const visibilityM =
        nativeHour?.visibility ??
        activeHour.visibilityM.valuesByModel?.[effectiveViewMode] ??
        null;

      return {
        sourceLabel: MODEL_BADGE_NAMES[effectiveViewMode],
        windSpeed10mKmh,
        windDirection10mDeg,
        windGusts10mKmh,
        visibilityM,
      };
    }

    return {
      sourceLabel: 'FieldCast Ensemble',
      windSpeed10mKmh: activeHour.windSpeed10m.mean,
      windDirection10mDeg: activeHour.windDirection10m.degree,
      windGusts10mKmh: activeHour.windGusts10m.mean,
      visibilityM: activeHour.visibilityM.mean,
    };
  }, [activeHour, effectiveHourIndex, effectiveViewMode, forecast?.nativeByModel]);

  const swellEnergyKwPerM = useMemo(() => {
    const hs = marine?.swellWaveHeight ?? marine?.waveHeight ?? null;
    const tp = marine?.swellWavePeriod ?? marine?.wavePeriod ?? null;
    return computeSwellEnergyKwPerM(hs, tp);
  }, [marine]);

  const waveSteepness = useMemo(
    () => computeWaveSteepness(marine?.waveHeight, marine?.wavePeriod),
    [marine],
  );

  // Score de Qualidade de Navegação Costeira (0–100) — zero penalidade oceânica em coordenadas continentais!
  const navigationAssessment = useMemo(() => {
    if (!activeHour) {
      return {
        score: 0,
        status: 'red' as SafeWindowStatus,
        label: 'Sem Dados de Navegação',
        reasons: ['Nenhuma janela horária carregada.'],
      };
    }

    let score = 100;
    const reasons: string[] = [];

    const wind = resolvedSurface.windSpeed10mKmh;
    const gust = resolvedSurface.windGusts10mKmh;
    const visKm =
      resolvedSurface.visibilityM !== null ? resolvedSurface.visibilityM / 1000 : null;
    const checkWind = navLimits.enabled?.maxWindKmh ?? true;
    const checkWave = navLimits.enabled?.maxWaveM ?? true;
    const checkCurrent = navLimits.enabled?.maxCurrentKmh ?? true;
    const windLabel = getWindUnitLabel(units.wind);
    const waveLabel = getWaveUnitLabel(units.wave);
    const fmtWind = (kmh: number) =>
      (convertWindSpeed(kmh, units.wind) ?? kmh).toFixed(1);
    const fmtWave = (m: number) =>
      (convertWaveHeight(m, units.wave) ?? m).toFixed(units.wave === 'ft' ? 1 : 2);

    if (checkWind && wind !== null) {
      if (wind > navLimits.maxWindKmh) {
        score -= 34;
        reasons.push(
          `Vento 10m em ${fmtWind(wind)} ${windLabel} acima do limite (${fmtWind(navLimits.maxWindKmh)} ${windLabel})`,
        );
      } else if (wind > navLimits.maxWindKmh * 0.78) {
        score -= 15;
        reasons.push(`Vento de superfície moderado (${fmtWind(wind)} ${windLabel})`);
      }
    }

    if (checkWind && gust !== null && gust > navLimits.maxWindKmh * 1.45) {
      score -= 14;
      reasons.push(`Rajadas costeiras fortes (${fmtWind(gust)} ${windLabel})`);
    }

    if (forecast?.marineAvailable && marine) {
      if (checkWave && marine.waveHeight !== null && marine.waveHeight !== undefined) {
        if (marine.waveHeight > navLimits.maxWaveM) {
          score -= 34;
          reasons.push(
            `Onda significativa ${fmtWave(marine.waveHeight)} ${waveLabel} acima do limite (${fmtWave(navLimits.maxWaveM)} ${waveLabel})`,
          );
        } else if (marine.waveHeight > navLimits.maxWaveM * 0.78) {
          score -= 16;
          reasons.push(`Ondulação próxima ao limite operacional (${fmtWave(marine.waveHeight)} ${waveLabel})`);
        }
      }

      if (checkCurrent && marine.oceanCurrentVelocity !== null && marine.oceanCurrentVelocity !== undefined) {
        if (marine.oceanCurrentVelocity > navLimits.maxCurrentKmh) {
          score -= 18;
          reasons.push(
            `Corrente oceânica intensa (${fmtWind(marine.oceanCurrentVelocity)} ${windLabel} > ${fmtWind(navLimits.maxCurrentKmh)} ${windLabel})`,
          );
        } else if (marine.oceanCurrentVelocity > navLimits.maxCurrentKmh * 0.8) {
          score -= 8;
          reasons.push(
            `Corrente moderada (${fmtWind(marine.oceanCurrentVelocity)} ${windLabel})`,
          );
        }
      }

      if (waveSteepness && waveSteepness.ratio >= 0.04) {
        score -= 10;
        reasons.push('Esbeltez elevada (ondas curtas/íngremes com risco de impacto de proa)');
      }
    }

    if (activeHour.fogRisk || (visKm !== null && visKm < 2.0)) {
      score -= 16;
      reasons.push(
        visKm !== null
          ? `Visibilidade horizontal reduzida (${visKm.toFixed(1)} km)`
          : 'Risco de nevoeiro costeiro',
      );
    } else if (visKm !== null && visKm < 5.0) {
      score -= 8;
      reasons.push(`Visibilidade moderada (${visKm.toFixed(1)} km)`);
    }

    if (activeHour.barometricSquallRisk) {
      score -= 12;
      reasons.push('Queda barométrica brusca (> 4 hPa/3h — risco de linha de instabilidade)');
    }

    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    const status: SafeWindowStatus =
      clamped >= 75 ? 'green' : clamped >= 50 ? 'amber' : 'red';
    const label =
      status === 'green'
        ? forecast?.marineAvailable
          ? 'Navegação Costeira Favorável'
          : 'Superfície Continental Estável'
        : status === 'amber'
          ? 'Atenção à Navegação (Cautela)'
          : 'Condições Severas / Restrição Náutica';

    if (reasons.length === 0) {
      reasons.push(
        forecast?.marineAvailable
          ? 'Vento, altura de onda, corrente e visibilidade dentro dos limites operacionais.'
          : 'Coordenada continental (sem penalidade oceânica) — vento e visibilidade seguros.',
      );
    }

    return {
      score: clamped,
      status,
      label,
      reasons,
    };
  }, [
    activeHour,
    forecast?.marineAvailable,
    marine,
    navLimits,
    resolvedSurface,
    units.wave,
    units.wind,
    waveSteepness,
  ]);

  const tideExtrema = useMemo(() => {
    const windowHours =
      hours.length - currentHourIndex >= 12
        ? hours.slice(currentHourIndex, currentHourIndex + 72)
        : hours;
    return extractTideExtrema(windowHours, forecast?.timezone);
  }, [currentHourIndex, forecast?.timezone, hours]);

  const hasMslSeries = useMemo(
    () =>
      Boolean(forecast?.marineAvailable) &&
      hours.some((h) => typeof h.marine?.seaLevelHeightMsl === 'number'),
    [forecast?.marineAvailable, hours],
  );

  const chartSlice = useMemo(() => {
    const start =
      hours.length - currentHourIndex >= 12 ? Math.max(0, currentHourIndex) : 0;
    return hours.slice(start, start + 48);
  }, [currentHourIndex, hours]);

  const tideChartOption: EChartsOption = useMemo(() => {
    const labels = chartSlice.map((h) => formatShortLocalTime(h.timestampUnix, forecast?.timezone));
    const mslData = chartSlice.map((h) =>
      typeof h.marine?.seaLevelHeightMsl === 'number'
        ? Number(h.marine.seaLevelHeightMsl.toFixed(2))
        : null,
    );
    const waveData = chartSlice.map((h) =>
      typeof h.marine?.waveHeight === 'number' ? Number(h.marine.waveHeight.toFixed(2)) : null,
    );
    const selectedLocalLabel = activeHour
      ? formatShortLocalTime(activeHour.timestampUnix, forecast?.timezone)
      : undefined;

    const textColor = isDark ? '#cbd5e1' : '#334155';
    const gridColor = isDark ? 'rgba(56, 189, 248, 0.14)' : 'rgba(148, 163, 184, 0.25)';

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 34,
        right: 44,
        bottom: 28,
        left: 44,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: textColor, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Maré MSL (m)',
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor } },
        },
        {
          type: 'value',
          name: 'Onda (m)',
          min: 0,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Nível do Mar (MSL)',
          type: 'line',
          smooth: true,
          yAxisIndex: 0,
          data: mslData,
          lineStyle: { width: 3, color: '#0284c7' },
          itemStyle: { color: '#0284c7' },
          areaStyle: {
            color: isDark ? 'rgba(2, 132, 199, 0.22)' : 'rgba(2, 132, 199, 0.14)',
          },
          markLine: selectedLocalLabel
            ? {
                symbol: ['none', 'none'],
                label: { formatter: 'Hora Ref.', color: '#0284c7', fontSize: 10 },
                lineStyle: { color: '#0ea5e9', type: 'dashed', width: 2 },
                data: [{ xAxis: selectedLocalLabel }],
              }
            : undefined,
        },
        {
          name: 'Altura de Onda (m)',
          type: 'line',
          smooth: true,
          yAxisIndex: 1,
          data: waveData,
          lineStyle: { width: 2, color: '#10b981' },
          itemStyle: { color: '#10b981' },
        },
      ],
    };
  }, [activeHour, chartSlice, forecast?.timezone, isDark]);

  const groupedTides = useMemo(() => {
    const groups = new Map<string, typeof tideExtrema>();
    for (const item of tideExtrema.slice(0, 12)) {
      const existing = groups.get(item.dayYmd) ?? [];
      existing.push(item);
      groups.set(item.dayYmd, existing);
    }
    return Array.from(groups.entries());
  }, [tideExtrema]);

  const handleRequestGpsClick = () => {
    if (!onRequestGps) return;
    void safeAction(async () => onRequestGps(), {
      actionKey: 'navigation_tab_request_gps',
      moduleName: 'NavigationTab',
      errorTitle: 'Falha ao atualizar GPS de navegação',
      onToast,
      onErrorLog,
    });
  };

  const navScoreStyles = NAV_STATUS_BADGE_MAP[navigationAssessment.status];

  return (
    <div data-testid="navigation-tab" className="space-y-6 pb-8">
      {/* Cabeçalho Operacional de Navegação */}
      <section className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              <Anchor className="w-4 h-4" aria-hidden="true" />
              <span>Módulo de Navegação Marítima &amp; Superfície</span>
            </div>
            <h2 className="text-lg md:text-xl font-extrabold text-slate-900 dark:text-white">
              {activeLocation.name}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1 font-mono">
                <MapPin className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                {activeLocation.latitude.toFixed(5)}°, {activeLocation.longitude.toFixed(5)}°
              </span>
              {forecast && (
                <span>
                  Altitude DEM: <strong>{Math.round(forecast.elevationDemM)} m</strong>
                </span>
              )}
              {activeHour && (
                <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 font-semibold">
                  <Clock className="w-3.5 h-3.5" />
                  Janela Local:{' '}
                  {formatLocalYMD(new Date(activeHour.timestampUnix * 1000), forecast?.timezone)} ·{' '}
                  {formatLocalHourBadge(activeHour.timestampUnix, forecast?.timezone)}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onRequestGps && (
              <button
                type="button"
                onClick={handleRequestGpsClick}
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <Crosshair className="w-4 h-4" aria-hidden="true" />
                <span>Sincronizar GPS</span>
              </button>
            )}
            {onOpenLocationsModal && (
              <button
                type="button"
                onClick={onOpenLocationsModal}
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-sky-700 bg-slate-50 dark:bg-sky-950/60 hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-2 transition-colors"
              >
                <Navigation className="w-4 h-4" aria-hidden="true" />
                <span>Trocar Ponto</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra Seletora de Modelo Meteorológico */}
        <div className="pt-3 border-t border-slate-100 dark:border-sky-800/50">
          <ModelModeSwitchPill
            viewMode={effectiveViewMode}
            onViewModeChange={handleViewModeSelect}
            allowSpaghetti={false}
            compact={true}
            label="Modelo Atmosférico:"
            testId="navigation-model-selector"
          />
        </div>

        {/* Navegação Temporal Rápida */}
        {hours.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-sky-800/50 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 mr-1">
              Horizonte de Navegação:
            </span>
            {[0, 3, 6, 12, 24, 48].map((offset) => {
              const targetIdx = currentHourIndex + offset;
              if (targetIdx >= hours.length) return null;
              const isSelected = selectedOffset === offset;
              return (
                <button
                  key={offset}
                  type="button"
                  onClick={() => setSelectedOffset(offset)}
                  className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                    isSelected
                      ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                      : 'bg-slate-50 dark:bg-sky-950/40 text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800/60 hover:bg-sky-50'
                  }`}
                >
                  {offset === 0 ? 'Hora Atual' : `+${offset}h`}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Painel 0: Score de Qualidade de Navegação Costeira (0–100) + Energia de Swell & Esbeltez */}
      <section
        data-testid="navigation-quality-score-card"
        aria-label="Score de Qualidade de Navegação Costeira"
        className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
              <Gauge className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                Score de Qualidade de Navegação Costeira
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Fonte vento/visib.: <strong>{resolvedSurface.sourceLabel}</strong> · Ondas, corrente e esbeltez
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              data-testid="navigation-quality-score-badge"
              className={`px-3.5 py-2 rounded-2xl border text-right ${navScoreStyles.container}`}
            >
              <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">
                Score Náutico
              </span>
              <span className={`text-2xl font-black leading-none ${navScoreStyles.scoreText}`}>
                {navigationAssessment.score}/100
              </span>
            </div>

            <button
              type="button"
              data-testid="toggle-nav-score-section"
              aria-expanded={isScoreExpanded}
              onClick={() => setIsScoreExpanded((prev) => !prev)}
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-1.5 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/50"
            >
              {isScoreExpanded ? (
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

        {isScoreExpanded && (
          <div className="space-y-4">
            <div
              className={`rounded-xl border p-3.5 flex items-center gap-2.5 text-xs sm:text-sm font-bold ${navScoreStyles.container}`}
            >
              {navigationAssessment.status === 'green' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0" />
              ) : navigationAssessment.status === 'amber' ? (
                <AlertTriangle className="w-5 h-5 shrink-0" />
              ) : (
                <ShieldAlert className="w-5 h-5 shrink-0" />
              )}
              <span>{navigationAssessment.label}</span>
            </div>

            {/* Métricas Físicas Derivadas: Energia de Swell & Esbeltez da Onda */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  Energia de Swell
                </p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                  {swellEnergyKwPerM !== null ? `${swellEnergyKwPerM.toFixed(1)} kW/m` : 'N/D'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  P ≈ 0.49 · Hs² · Tp
                </p>
              </div>

              <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Esbeltez da Onda
                </p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                  {waveSteepness
                    ? waveSteepness.inverseRatio
                      ? `1:${waveSteepness.inverseRatio}`
                      : waveSteepness.ratio.toFixed(3)
                    : 'N/D'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {waveSteepness
                    ? `${waveSteepness.classification} (${(waveSteepness.ratio * 100).toFixed(1)}%)`
                    : 'Sem grade oceânica'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Vento 10m ({resolvedSurface.sourceLabel})
                </p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                  {resolvedSurface.windSpeed10mKmh !== null
                    ? `${resolvedSurface.windSpeed10mKmh.toFixed(1)} km/h`
                    : 'N/D'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Rajada:{' '}
                  {resolvedSurface.windGusts10mKmh !== null
                    ? `${resolvedSurface.windGusts10mKmh.toFixed(1)} km/h`
                    : 'N/D'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Visibilidade Costeira
                </p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-1">
                  {resolvedSurface.visibilityM !== null
                    ? `${(resolvedSurface.visibilityM / 1000).toFixed(1)} km`
                    : 'N/D'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {activeHour?.fogRisk ? 'Alerta de nevoeiro' : 'Horizonte óptico'}
                </p>
              </div>
            </div>

            <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200">
              {navigationAssessment.reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${navScoreStyles.dot}`} />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>

            {/* Limites Editáveis da Embarcação (persistidos em localStorage) */}
            <div className="pt-3 border-t border-slate-100 dark:border-sky-800/50 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                <Sliders className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>Limites Operacionais da Embarcação:</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  <label className="flex items-center justify-between gap-1 cursor-pointer">
                    <span>Vento Máx ({getWindUnitLabel(units.wind)})</span>
                    <input
                      type="checkbox"
                      data-testid="nav-limit-enable-wind"
                      checked={navLimits.enabled?.maxWindKmh ?? true}
                      onChange={(e) =>
                        setNavLimits((prev) => ({
                          ...prev,
                          enabled: { ...(prev.enabled ?? {}), maxWindKmh: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 accent-sky-600 rounded"
                    />
                  </label>
                  <input
                    type="number"
                    data-testid="nav-limit-max-wind"
                    min={1}
                    max={150}
                    step={0.5}
                    disabled={!(navLimits.enabled?.maxWindKmh ?? true)}
                    value={Number(
                      (convertWindSpeed(navLimits.maxWindKmh, units.wind) ?? navLimits.maxWindKmh).toFixed(1),
                    )}
                    onChange={(e) => {
                      const num = Number(e.target.value);
                      if (!Number.isFinite(num)) return;
                      setNavLimits((prev) => ({
                        ...prev,
                        maxWindKmh: Math.max(5, Math.min(110, windSpeedToKmh(num, units.wind))),
                      }));
                    }}
                    className="mt-1 w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white disabled:opacity-45"
                  />
                </div>

                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  <label className="flex items-center justify-between gap-1 cursor-pointer">
                    <span>Onda Máx Hs ({getWaveUnitLabel(units.wave)})</span>
                    <input
                      type="checkbox"
                      data-testid="nav-limit-enable-wave"
                      checked={navLimits.enabled?.maxWaveM ?? true}
                      onChange={(e) =>
                        setNavLimits((prev) => ({
                          ...prev,
                          enabled: { ...(prev.enabled ?? {}), maxWaveM: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 accent-sky-600 rounded"
                    />
                  </label>
                  <input
                    type="number"
                    data-testid="nav-limit-max-wave"
                    min={0.2}
                    max={40}
                    step={0.1}
                    disabled={!(navLimits.enabled?.maxWaveM ?? true)}
                    value={Number(
                      (convertWaveHeight(navLimits.maxWaveM, units.wave) ?? navLimits.maxWaveM).toFixed(1),
                    )}
                    onChange={(e) => {
                      const num = Number(e.target.value);
                      if (!Number.isFinite(num)) return;
                      setNavLimits((prev) => ({
                        ...prev,
                        maxWaveM: Math.max(0.2, Math.min(12, waveHeightToM(num, units.wave))),
                      }));
                    }}
                    className="mt-1 w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white disabled:opacity-45"
                  />
                </div>

                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  <label className="flex items-center justify-between gap-1 cursor-pointer">
                    <span>Corrente Máx ({getWindUnitLabel(units.wind)})</span>
                    <input
                      type="checkbox"
                      data-testid="nav-limit-enable-current"
                      checked={navLimits.enabled?.maxCurrentKmh ?? true}
                      onChange={(e) =>
                        setNavLimits((prev) => ({
                          ...prev,
                          enabled: { ...(prev.enabled ?? {}), maxCurrentKmh: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 accent-sky-600 rounded"
                    />
                  </label>
                  <input
                    type="number"
                    data-testid="nav-limit-max-current"
                    min={0.1}
                    max={25}
                    step={0.1}
                    disabled={!(navLimits.enabled?.maxCurrentKmh ?? true)}
                    value={Number(
                      (convertWindSpeed(navLimits.maxCurrentKmh, units.wind) ?? navLimits.maxCurrentKmh).toFixed(1),
                    )}
                    onChange={(e) => {
                      const num = Number(e.target.value);
                      if (!Number.isFinite(num)) return;
                      setNavLimits((prev) => ({
                        ...prev,
                        maxCurrentKmh: Math.max(0.2, Math.min(20, windSpeedToKmh(num, units.wind))),
                      }));
                    }}
                    className="mt-1 w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white disabled:opacity-45"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Painel 1: Tábua / Curva de Maré Regional & Condições Marinhas */}
      <section
        aria-label="Tábua de Maré Regional e Condições Marinhas"
        className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
              <Waves className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                Tábua de Marés Estimada &amp; Ondulação
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Picos horários de Preia-mar / Baixa-mar (MSL) e vetor de corrente marinha
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {forecast?.marineAvailable ? (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                Área Costeira Ativa
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-sky-950/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-sky-800">
                Coordenada Continental
              </span>
            )}

            <button
              type="button"
              data-testid="toggle-tide-section"
              aria-expanded={isTideSectionExpanded}
              onClick={() => {
                setIsTideSectionExpanded((prev) => {
                  const next = !prev;
                  if (next) {
                    setTimeout(resizeMountedCharts, 80);
                  }
                  return next;
                });
              }}
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-1.5 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/50"
            >
              {isTideSectionExpanded ? (
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

        {/* Aviso Obrigatório DHN / Marinha — sempre visível para segurança náutica */}
        <div
          role="note"
          data-testid="dhn-tide-disclaimer"
          className="rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/35 p-3.5 flex items-start gap-3 text-xs text-amber-950 dark:text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p>
            <strong>Aviso de Navegação Costeira:</strong> A curva de nível do mar{' '}
            <code>sea_level_height_msl</code> (~8 km Open-Meteo Marine) indica variação regional e{' '}
            <strong>não substitui a Tábua de Marés oficial da DHN / Marinha do Brasil</strong> nem
            cartas náuticas portuárias.
          </p>
        </div>

        {isTideSectionExpanded &&
          (forecast?.marineAvailable ? (
            <>
              {/* KPIs Marinhos da Hora Selecionada */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Nível do Mar (MSL)
                  </p>
                  <p className="text-xl font-extrabold text-sky-700 dark:text-sky-300 mt-1">
                    {typeof marine?.seaLevelHeightMsl === 'number'
                      ? `${marine.seaLevelHeightMsl >= 0 ? '+' : ''}${marine.seaLevelHeightMsl.toFixed(2)} m`
                      : 'N/D'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Referência regional aproximada
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Onda Significativa
                  </p>
                  <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                    {marine?.waveHeight !== null && marine?.waveHeight !== undefined
                      ? `${marine.waveHeight.toFixed(2)} m`
                      : 'N/D'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Período:{' '}
                    {marine?.wavePeriod !== null && marine?.wavePeriod !== undefined
                      ? `${marine.wavePeriod.toFixed(1)} s`
                      : 'N/D'}{' '}
                    · {degreesToCardinalShort(marine?.waveDirection)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Swell Primário
                  </p>
                  <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                    {marine?.swellWaveHeight !== null && marine?.swellWaveHeight !== undefined
                      ? `${marine.swellWaveHeight.toFixed(2)} m`
                      : 'N/D'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {marine?.swellWavePeriod !== null && marine?.swellWavePeriod !== undefined
                      ? `${marine.swellWavePeriod.toFixed(1)} s`
                      : 'N/D'}{' '}
                    · {degreesToCardinalShort(marine?.swellWaveDirection)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Corrente Oceânica
                  </p>
                  <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                    {marine?.oceanCurrentVelocity !== null &&
                    marine?.oceanCurrentVelocity !== undefined
                      ? `${marine.oceanCurrentVelocity.toFixed(2)} km/h`
                      : 'N/D'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Rumo: {degreesToCardinalShort(marine?.oceanCurrentDirection)}{' '}
                    {typeof marine?.oceanCurrentDirection === 'number'
                      ? `(${Math.round(marine.oceanCurrentDirection)}°)`
                      : ''}
                  </p>
                </div>
              </div>

              {/* Gráfico de Maré & Onda com Tela Cheia */}
              {hasMslSeries && chartSlice.length > 0 && (
                <FullscreenViewer
                  title="Curva de Maré Regional (MSL) & Altura de Onda (48h)"
                  subtitle={`${activeLocation.name} · Não substitui Tábua oficial DHN / Marinha`}
                  testId="navigation-tide-chart-fullscreen"
                  className="rounded-xl border border-slate-200/70 dark:border-sky-800/60 bg-slate-50/50 dark:bg-[#0f243d]/70 p-3"
                >
                  {({ isFullscreen }) => (
                    <ReactECharts
                      {...getEChartsRefProps('tideWave')}
                      option={tideChartOption}
                      style={{
                        height: isFullscreen ? 'calc(100vh - 150px)' : 240,
                        width: '100%',
                      }}
                    />
                  )}
                </FullscreenViewer>
              )}

              {/* Tabela Agrupada de Preia-mar / Baixa-mar */}
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2.5">
                  Eventos de Preia-mar e Baixa-mar (Próximas 72h)
                </h4>
                {groupedTides.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {groupedTides.map(([dayYmd, events]) => (
                      <div
                        key={dayYmd}
                        className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-3.5 space-y-2"
                      >
                        <p className="text-xs font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300 border-b border-slate-200/70 dark:border-sky-800/50 pb-1.5">
                          {dayYmd}
                        </p>
                        <div className="space-y-1.5">
                          {events.map((ev) => (
                            <div
                              key={`${ev.timestampUnix}-${ev.type}`}
                              className="flex items-center justify-between text-xs py-1"
                            >
                              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                                {ev.type === 'high' ? (
                                  <ArrowUp className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                                ) : (
                                  <ArrowDown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                )}
                                {ev.label}
                              </span>
                              <span className="font-mono font-bold text-slate-900 dark:text-white">
                                {ev.hourBadge} · {ev.seaLevelHeightMsl >= 0 ? '+' : ''}
                                {ev.seaLevelHeightMsl.toFixed(2)} m
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Série MSL insuficiente para detectar extremos locais nesta grade marinha; utilize o gráfico horário acima.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-sky-800/60 bg-slate-50/70 dark:bg-[#0f243d] p-4 text-xs sm:text-sm text-slate-700 dark:text-slate-200">
              Coordenada continental sem grade oceânica da Open-Meteo Marine. Sem impacto na confiabilidade atmosférica — o painel de vento de superfície e a bússola vetorial permanecem ativos abaixo.
            </div>
          ))}
      </section>

      {/* Painel 2: Referência Vetorial de Superfície + Bússola 3D */}
      <section
        aria-label="Painel de Bússola e Vetor de Superfície"
        className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
              <Compass className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                Bússola Vetorial &amp; Vento de Superfície (10m)
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Modelo ativo: <strong>{resolvedSurface.sourceLabel}</strong> · Orientação 3D sem salto 360°/0°
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="toggle-compass-section"
            aria-expanded={isCompassSectionExpanded}
            onClick={() => setIsCompassSectionExpanded((prev) => !prev)}
            className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-sky-800 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center gap-1.5 transition-colors hover:bg-sky-50 dark:hover:bg-sky-900/50"
          >
            {isCompassSectionExpanded ? (
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

        {isCompassSectionExpanded && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <ModuleErrorBoundary moduleName="Bússola de Navegação e Vento" onErrorLog={onErrorLog}>
                <WindCompass
                  windDirection10mDeg={resolvedSurface.windDirection10mDeg}
                  windSpeed10mKmh={resolvedSurface.windSpeed10mKmh}
                  waveDirectionDeg={marine?.waveDirection ?? null}
                  waveHeightM={marine?.waveHeight ?? null}
                  marineAvailable={forecast?.marineAvailable ?? false}
                  simulatedHeadingDeg={simulatedCompassHeadingDeg}
                  onToast={onToast}
                  onErrorLog={onErrorLog}
                />
              </ModuleErrorBoundary>
            </div>

            <div
              aria-label="Resumo Vetorial de Superfície"
              className="rounded-2xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/40 dark:bg-[#0f243d]/40 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    Vetor de Superfície (10m)
                  </h4>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  {resolvedSurface.sourceLabel}
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-[#132a47] border border-slate-200/60 dark:border-sky-800/40">
                  <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                    <Wind className="w-4 h-4 text-sky-500" />
                    Vento 10m
                  </span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    {resolvedSurface.windSpeed10mKmh !== null
                      ? `${resolvedSurface.windSpeed10mKmh.toFixed(1)} km/h`
                      : 'N/D'}
                  </strong>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-[#132a47] border border-slate-200/60 dark:border-sky-800/40">
                  <span className="text-slate-600 dark:text-slate-300">Direção Verdadeira</span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    {degreesToCardinalShort(resolvedSurface.windDirection10mDeg)}{' '}
                    {typeof resolvedSurface.windDirection10mDeg === 'number'
                      ? `(${Math.round(resolvedSurface.windDirection10mDeg)}°)`
                      : ''}
                  </strong>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-[#132a47] border border-slate-200/60 dark:border-sky-800/40">
                  <span className="text-slate-600 dark:text-slate-300">Rajadas Máx 10m</span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    {resolvedSurface.windGusts10mKmh !== null
                      ? `${resolvedSurface.windGusts10mKmh.toFixed(1)} km/h`
                      : 'N/D'}
                  </strong>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-[#132a47] border border-slate-200/60 dark:border-sky-800/40">
                  <span className="text-slate-600 dark:text-slate-300">Visibilidade Superfície</span>
                  <strong className="text-sm text-slate-900 dark:text-white">
                    {resolvedSurface.visibilityM !== null
                      ? `${(resolvedSurface.visibilityM / 1000).toFixed(1)} km`
                      : 'N/D'}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
