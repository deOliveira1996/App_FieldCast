import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Clock,
  Cloud,
  CloudRain,
  Compass,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Mountain,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import type {
  EnsembleHour,
  ForecastViewMode,
  NativeModelHour,
  NormalizedForecast,
  WeatherModelId,
} from '../../types/weather';
import { formatLocalHourBadge, useCurrentLocalHourIndex } from '../../utils/localTimeHour';
import {
  getSharedModelsForVariable,
  MODEL_COLORS,
  MODEL_DISPLAY_LABELS,
  MODEL_SHORT_LABELS,
} from '../../utils/modelComparison';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import {
  convertPrecipitation,
  convertPressure,
  convertTemperature,
  convertWaveHeight,
  convertWindSpeed,
  type WaveHeightUnit,
} from '../../utils/units';
import { HelpPopover } from '../common/HelpPopover';
import { degreesToCardinalShort } from './CurrentSummaryCard';
import type { ForecastHorizonHours } from './ModelSelectorBar';
import {
  COMPLETE_VISIBLE_PARAMS,
  type ForecastVisibleParams,
} from './forecastParamsVisibility';

export type ChartFocusTab =
  | 'all'
  | 'wind'
  | 'temperature'
  | 'rain'
  | 'waves'
  | 'clouds'
  | 'vertical';

export type ChartHorizonHours = 24 | ForecastHorizonHours;

export type FullscreenChartId =
  | 'wind'
  | 'vertical'
  | 'temperature'
  | 'rain'
  | 'waves'
  | 'clouds';

export interface ForecastChartsProps {
  forecast: NormalizedForecast;
  viewMode: ForecastViewMode;
  showInterpolatedProfile: boolean;
  horizonHours: ChartHorizonHours;
  selectedHourIndex: number;
  currentHourIndex?: number;
  onSelectHourIndex?: (index: number) => void;
  onResetToCurrentHour?: () => void;
  isDark?: boolean;
  visibleParams?: ForecastVisibleParams;
}

const CAN_ATTACH_ECHARTS_REF =
  (typeof ReactECharts === 'function' &&
    Boolean(
      (ReactECharts as unknown as { prototype?: { isReactComponent?: unknown } }).prototype
        ?.isReactComponent,
    )) ||
  (typeof ReactECharts === 'object' && ReactECharts !== null);

const MODEL_LABELS: Record<WeatherModelId, string> = MODEL_DISPLAY_LABELS;

function formatAxisHour(
  timestampUnix: number,
  timezone: string,
  intlLocale = 'pt-BR',
): string {
  try {
    const d = new Date(timestampUnix * 1000);
    const weekday = d.toLocaleDateString(intlLocale, {
      weekday: 'short',
      timeZone: timezone || undefined,
    });
    const day = d.toLocaleDateString(intlLocale, {
      day: '2-digit',
      timeZone: timezone || undefined,
    });
    const hour = d.toLocaleTimeString(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || undefined,
    });
    return `${weekday.replace('.', '')} ${day} ${hour}`;
  } catch {
    return new Date(timestampUnix * 1000).toISOString().slice(5, 16).replace('T', ' ');
  }
}

function formatAltLabel(meters: number, waveUnit: WaveHeightUnit): string {
  if (waveUnit === 'ft') {
    const converted = convertWaveHeight(meters, 'ft');
    return `${converted !== null ? Math.round(converted) : Math.round(meters * 3.28084)}ft`;
  }
  return `${meters}m`;
}

function roundOrNull(val: number | null | undefined, decimals = 1): number | null {
  if (val === null || val === undefined || Number.isNaN(val)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

export function buildCurrentHourMarkLine(xLabel: string, hourBadgeLabel: string) {
  return {
    symbol: ['none', 'none'] as [string, string],
    silent: true,
    animation: false,
    lineStyle: {
      type: 'dashed' as const,
      color: '#d97706',
      width: 2,
    },
    label: {
      show: true,
      position: 'end' as const,
      formatter: hourBadgeLabel,
      backgroundColor: '#d97706',
      color: '#ffffff',
      fontWeight: 'bold' as const,
      fontSize: 10,
      borderRadius: 6,
      padding: [3, 8],
    },
    data: [{ xAxis: xLabel }],
  };
}

export const ForecastCharts: React.FC<ForecastChartsProps> = ({
  forecast,
  viewMode,
  showInterpolatedProfile,
  horizonHours,
  selectedHourIndex,
  currentHourIndex,
  onSelectHourIndex,
  onResetToCurrentHour,
  isDark = false,
  visibleParams = COMPLETE_VISIBLE_PARAMS,
}) => {
  const {
    units,
    windLabel,
    tempLabel,
    waveLabel,
    pressureLabel,
    precipLabel,
    formatWindValue,
    formatTempValue,
    formatPrecipValue,
    formatPressureValue,
    formatWaveValue,
  } = useUnits();
  const { locale, tr } = useLocale();
  const intlLocale = locale === 'en' ? 'en-US' : 'pt-BR';
  const [focusTab, setFocusTab] = useState<ChartFocusTab>('all');
  const [fullscreenChartId, setFullscreenChartId] = useState<FullscreenChartId | null>(null);
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
        // Ignore transient disposal during viewport rotation
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
      settleTimer = setTimeout(resizeMountedCharts, 160);
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
    if (!fullscreenChartId || typeof document === 'undefined') {
      return;
    }
    const timer = setTimeout(resizeMountedCharts, 80);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreenChartId(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [fullscreenChartId, resizeMountedCharts]);

  const slicedHours: EnsembleHour[] = useMemo(
    () => forecast.hours.slice(0, horizonHours),
    [forecast.hours, horizonHours],
  );

  const safeSelectedIdx = Math.min(
    Math.max(0, selectedHourIndex),
    Math.max(0, slicedHours.length - 1),
  );
  const activeHour: EnsembleHour | undefined = slicedHours[safeSelectedIdx];

  const liveCurrentHourIndex = useCurrentLocalHourIndex(
    currentHourIndex === undefined ? slicedHours : undefined,
    forecast.timezone,
  );
  const resolvedCurrentHourIndex = currentHourIndex ?? liveCurrentHourIndex;

  const isCurrentHourInRange =
    resolvedCurrentHourIndex >= 0 && resolvedCurrentHourIndex < slicedHours.length;

  const textColor = isDark ? '#cbd5e1' : '#475569';
  const gridBorderColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.22)';
  const tooltipBg = isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)';
  const tooltipBorder = isDark ? '#334155' : '#bae6fd';
  const tooltipText = isDark ? '#f8fafc' : '#0f172a';

  const xLabels = useMemo(
    () => slicedHours.map((h) => formatAxisHour(h.timestampUnix, forecast.timezone, intlLocale)),
    [slicedHours, forecast.timezone, intlLocale],
  );

  const currentHourXLabel = isCurrentHourInRange ? xLabels[resolvedCurrentHourIndex] : undefined;
  const currentHourBadge =
    isCurrentHourInRange && slicedHours[resolvedCurrentHourIndex]
      ? formatLocalHourBadge(slicedHours[resolvedCurrentHourIndex]!.timestampUnix, forecast.timezone)
      : undefined;

  const currentHourMarkLine = useMemo(
    () =>
      currentHourXLabel && currentHourBadge
        ? buildCurrentHourMarkLine(currentHourXLabel, currentHourBadge)
        : undefined,
    [currentHourXLabel, currentHourBadge],
  );

  const includeAltitudeInWindChart =
    visibleParams.verticalProfile || focusTab === 'vertical';

  const isNativeModel =
    viewMode === 'ecmwf_ifs025' ||
    viewMode === 'gfs_seamless' ||
    viewMode === 'icon_seamless' ||
    viewMode === 'gem_seamless';

  const hasSeaLevelMsl = useMemo(
    () =>
      forecast.marineAvailable &&
      slicedHours.some(
        (h) =>
          typeof h.marine?.seaLevelHeightMsl === 'number' &&
          Number.isFinite(h.marine.seaLevelHeightMsl),
      ),
    [forecast.marineAvailable, slicedHours],
  );

  const timeSeriesEvents = useMemo(
    () =>
      onSelectHourIndex
        ? {
            click: (params: { dataIndex?: number }) => {
              if (
                typeof params?.dataIndex === 'number' &&
                params.dataIndex >= 0 &&
                params.dataIndex < slicedHours.length
              ) {
                onSelectHourIndex(params.dataIndex);
              }
            },
          }
        : undefined,
    [onSelectHourIndex, slicedHours.length],
  );

  const activeSummaryMetrics = useMemo(() => {
    if (!activeHour) {
      return null;
    }
    const nativeHour = isNativeModel
      ? forecast.nativeByModel[viewMode]?.[safeSelectedIdx]
      : undefined;

    const windSpeed = isNativeModel
      ? (nativeHour?.windSpeed10m ?? activeHour.windSpeed10m.mean)
      : activeHour.windSpeed10m.mean;
    const windDir = isNativeModel
      ? (nativeHour?.windDirection10m ?? activeHour.windDirection10m.degree)
      : activeHour.windDirection10m.degree;
    const gusts = isNativeModel
      ? (nativeHour?.windGusts10m ?? activeHour.windGusts10m.mean)
      : activeHour.windGusts10m.mean;
    const temp = isNativeModel
      ? (nativeHour?.temperature2m ?? activeHour.temperature2mC.mean)
      : activeHour.temperature2mC.mean;
    const dewPoint = isNativeModel
      ? (nativeHour?.dewPoint2m ?? activeHour.dewPoint2mC.mean)
      : activeHour.dewPoint2mC.mean;
    const precipMm = isNativeModel
      ? (nativeHour?.precipitation ?? activeHour.precipitationMm.mean)
      : activeHour.precipitationMm.mean;
    const precipProb = isNativeModel
      ? (nativeHour?.precipitationProbability ?? activeHour.precipitationProbabilityPct.mean)
      : activeHour.precipitationProbabilityPct.mean;
    const pressureHpa = isNativeModel
      ? (nativeHour?.surfacePressure ?? activeHour.surfacePressureHpa.mean)
      : activeHour.surfacePressureHpa.mean;

    return {
      timeLabel:
        xLabels[safeSelectedIdx] ??
        formatLocalHourBadge(activeHour.timestampUnix, forecast.timezone),
      hourBadge: formatLocalHourBadge(activeHour.timestampUnix, forecast.timezone),
      sourceLabel: isNativeModel
        ? MODEL_LABELS[viewMode]
        : viewMode === 'spaghetti'
          ? tr('Consenso FieldCast (Comparação)', 'FieldCast Consensus (Compare)')
          : tr('Consenso FieldCast', 'FieldCast Consensus'),
      windSpeed,
      windDir,
      windCardinal: degreesToCardinalShort(windDir),
      gusts,
      temp,
      dewPoint,
      precipMm,
      precipProb,
      pressureHpa,
      waveHeight: activeHour.marine?.waveHeight ?? null,
      wavePeriod: activeHour.marine?.wavePeriod ?? null,
      waveDirCardinal: degreesToCardinalShort(activeHour.marine?.waveDirection),
      seaLevelHeightMsl:
        typeof activeHour.marine?.seaLevelHeightMsl === 'number' &&
        Number.isFinite(activeHour.marine.seaLevelHeightMsl)
          ? activeHour.marine.seaLevelHeightMsl
          : null,
    };
  }, [
    activeHour,
    isNativeModel,
    forecast.nativeByModel,
    forecast.timezone,
    viewMode,
    safeSelectedIdx,
    xLabels,
    tr,
  ]);

  // 1A. Hourly Wind & Gusts Time-Series Chart Option
  const windTimeSeriesOption: EChartsOption = useMemo(() => {
    const nativeHours: NativeModelHour[] = isNativeModel
      ? (forecast.nativeByModel[viewMode] ?? []).slice(0, slicedHours.length)
      : [];
    const cw = (kmh: number | null | undefined) =>
      roundOrNull(convertWindSpeed(kmh, units.wind));

    const series: NonNullable<EChartsOption['series']> = [];

    if (viewMode === 'fieldcast') {
      const minValues = slicedHours.map((h) => cw(h.windSpeed10m.min ?? h.windSpeed10m.mean));
      const bandDiff = slicedHours.map((h) => {
        const minV = convertWindSpeed(h.windSpeed10m.min, units.wind);
        const maxV = convertWindSpeed(h.windSpeed10m.max, units.wind);
        if (minV === null || maxV === null) return 0;
        return roundOrNull(Math.max(0, maxV - minV)) ?? 0;
      });

      series.push(
        {
          name: tr('Vento 10m Mín', 'Wind 10m Min'),
          type: 'line',
          data: minValues,
          stack: 'wind_uncertainty',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          name: tr('Faixa Mín–Máx (10m)', 'Min–Max Band (10m)'),
          type: 'line',
          data: bandDiff,
          stack: 'wind_uncertainty',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: {
            color: isDark ? 'rgba(14, 165, 233, 0.22)' : 'rgba(0, 128, 205, 0.16)',
          },
          tooltip: { show: false },
        },
        {
          name: tr(`Vento 10m (${windLabel})`, `Wind 10m (${windLabel})`),
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => cw(h.windSpeed10m.mean)),
          markLine: currentHourMarkLine,
        },
        {
          name: tr(`Rajadas 10m (${windLabel})`, `Gusts 10m (${windLabel})`),
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: slicedHours.map((h) => cw(h.windGusts10m.mean)),
        },
      );

      if (includeAltitudeInWindChart) {
        series.push(
          {
            name: tr(`Vento ${formatAltLabel(80, units.wave)}`, `Wind ${formatAltLabel(80, units.wave)}`),
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, color: '#38bdf8' },
            itemStyle: { color: '#38bdf8' },
            data: slicedHours.map((h) => cw(h.windSpeed80m.mean)),
          },
          {
            name: tr(`Vento ${formatAltLabel(100, units.wave)}`, `Wind ${formatAltLabel(100, units.wave)}`),
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, color: '#6366f1' },
            itemStyle: { color: '#6366f1' },
            data: slicedHours.map((h) => cw(h.windSpeed100m.mean)),
          },
          {
            name: tr(`Vento ${formatAltLabel(120, units.wave)}`, `Wind ${formatAltLabel(120, units.wave)}`),
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, color: '#0d9488' },
            itemStyle: { color: '#0d9488' },
            data: slicedHours.map((h) => cw(h.windSpeed120m.mean)),
          },
        );
      }
    } else if (viewMode === 'spaghetti') {
      const windModels = getSharedModelsForVariable(forecast, 'windSpeed10m', slicedHours.length);
      const gustModels = getSharedModelsForVariable(forecast, 'windGusts10m', slicedHours.length);

      const activeWindModels = windModels.length >= 2 ? windModels : [];
      for (const modelId of activeWindModels) {
        const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
        series.push({
          name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Vento 10m', 'Wind 10m')}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: MODEL_COLORS[modelId] },
          itemStyle: { color: MODEL_COLORS[modelId] },
          data: list.map((h) => cw(h.windSpeed10m)),
        });
      }

      if (gustModels.length >= 2) {
        for (const modelId of gustModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Rajada 10m', 'Gust 10m')}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, type: 'dashed', color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => cw(h.windGusts10m)),
          });
        }
      }

      if (includeAltitudeInWindChart) {
        const altFields = [
          { id: 'windSpeed80m' as const, label: formatAltLabel(80, units.wave) },
          { id: 'windSpeed100m' as const, label: formatAltLabel(100, units.wave) },
          { id: 'windSpeed120m' as const, label: formatAltLabel(120, units.wave) },
        ];
        for (const alt of altFields) {
          const models = getSharedModelsForVariable(forecast, alt.id, slicedHours.length);
          if (models.length >= 2) {
            for (const modelId of models) {
              const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
              series.push({
                name: `${MODEL_SHORT_LABELS[modelId]} ${alt.label}`,
                type: 'line',
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1.3, type: 'dotted', color: MODEL_COLORS[modelId] },
                itemStyle: { color: MODEL_COLORS[modelId] },
                data: list.map((h) => cw(h[alt.id])),
              });
            }
          }
        }
      }

      series.push({
        name: tr('Consenso FieldCast 10m', 'FieldCast Consensus 10m'),
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.5, type: 'dotted', color: '#f97316' },
        itemStyle: { color: '#f97316' },
        data: slicedHours.map((h) => cw(h.windSpeed10m.mean)),
        markLine: currentHourMarkLine,
      });
    } else if (isNativeModel) {
      const label = MODEL_LABELS[viewMode];
      series.push(
        {
          name: `${label} ${tr('Vento 10m', 'Wind 10m')}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: nativeHours.map((h) => cw(h.windSpeed10m)),
          markLine: currentHourMarkLine,
        },
        {
          name: `${label} ${tr('Rajadas 10m', 'Gusts 10m')}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: nativeHours.map((h) => cw(h.windGusts10m)),
        },
      );

      if (includeAltitudeInWindChart) {
        if (nativeHours.some((h) => h.windSpeed80m !== null)) {
          series.push({
            name: `${label} ${tr(`Vento ${formatAltLabel(80, units.wave)}`, `Wind ${formatAltLabel(80, units.wave)}`)}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: '#38bdf8' },
            itemStyle: { color: '#38bdf8' },
            data: nativeHours.map((h) => cw(h.windSpeed80m)),
          });
        }
        if (nativeHours.some((h) => h.windSpeed100m !== null)) {
          series.push({
            name: `${label} ${tr(`Vento ${formatAltLabel(100, units.wave)}`, `Wind ${formatAltLabel(100, units.wave)}`)}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2, color: '#6366f1' },
            itemStyle: { color: '#6366f1' },
            data: nativeHours.map((h) => cw(h.windSpeed100m)),
          });
        }
        if (nativeHours.some((h) => h.windSpeed120m !== null)) {
          series.push({
            name: `${label} ${tr(`Vento ${formatAltLabel(120, units.wave)}`, `Wind ${formatAltLabel(120, units.wave)}`)}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: '#0d9488' },
            itemStyle: { color: '#0d9488' },
            data: nativeHours.map((h) => cw(h.windSpeed120m)),
          });
        }
      }
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 56,
        left: 16,
        right: 20,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: {
        type: 'value',
        name: windLabel,
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridBorderColor } },
      },
      series,
    };
  }, [
    viewMode,
    isNativeModel,
    forecast,
    slicedHours,
    isDark,
    includeAltitudeInWindChart,
    currentHourMarkLine,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
    units.wind,
    units.wave,
    windLabel,
    tr,
  ]);

  // 1B. Temperature & Dew Point Chart Option (supports FieldCast, Native, and Spaghetti)
  const temperatureOption: EChartsOption = useMemo(() => {
    const ct = (c: number | null | undefined) =>
      roundOrNull(convertTemperature(c, units.temperature), 1);
    const series: NonNullable<EChartsOption['series']> = [];

    if (viewMode === 'spaghetti') {
      const tempModels = getSharedModelsForVariable(forecast, 'temperature2m', slicedHours.length);
      const dewModels = getSharedModelsForVariable(forecast, 'dewPoint2m', slicedHours.length);

      if (tempModels.length >= 2) {
        for (const modelId of tempModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} Temp 2m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2, color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => ct(h.temperature2m)),
          });
        }
      }

      if (dewModels.length >= 2) {
        for (const modelId of dewModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Orvalho 2m', 'Dew 2m')}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, type: 'dashed', color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => ct(h.dewPoint2m)),
          });
        }
      }

      series.push({
        name: tr(`Consenso Temp 2m (${tempLabel})`, `Consensus Temp 2m (${tempLabel})`),
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.5, type: 'dotted', color: '#f97316' },
        itemStyle: { color: '#f97316' },
        data: slicedHours.map((h) => ct(h.temperature2mC.mean)),
      });
    } else if (isNativeModel) {
      const label = MODEL_LABELS[viewMode];
      const nativeHours = (forecast.nativeByModel[viewMode] ?? []).slice(0, slicedHours.length);
      series.push(
        {
          name: `${label} ${tr(`Temperatura (2m ${tempLabel})`, `Temperature (2m ${tempLabel})`)}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: {
            color: isDark ? 'rgba(249, 115, 22, 0.16)' : 'rgba(249, 115, 22, 0.12)',
          },
          lineStyle: { width: 2.5, color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: nativeHours.map((h) => ct(h.temperature2m)),
        },
        {
          name: `${label} ${tr(`Ponto de Orvalho (${tempLabel})`, `Dew Point (${tempLabel})`)}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: nativeHours.map((h) => ct(h.dewPoint2m)),
        },
      );
    } else {
      series.push(
        {
          name: tr(`Temperatura (2m ${tempLabel})`, `Temperature (2m ${tempLabel})`),
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: {
            color: isDark ? 'rgba(249, 115, 22, 0.16)' : 'rgba(249, 115, 22, 0.12)',
          },
          lineStyle: { width: 2.5, color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: slicedHours.map((h) => ct(h.temperature2mC.mean)),
        },
        {
          name: tr(`Ponto de Orvalho (${tempLabel})`, `Dew Point (${tempLabel})`),
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => ct(h.dewPoint2mC.mean)),
        },
      );
    }

    if (series[0] && currentHourMarkLine) {
      (series[0] as { markLine?: ReturnType<typeof buildCurrentHourMarkLine> }).markLine =
        currentHourMarkLine;
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 56,
        left: 16,
        right: 20,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: {
        type: 'value',
        name: tempLabel,
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10, formatter: '{value}°' },
        splitLine: { lineStyle: { color: gridBorderColor } },
      },
      series,
    };
  }, [
    viewMode,
    isNativeModel,
    forecast,
    slicedHours,
    isDark,
    currentHourMarkLine,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
    units.temperature,
    tempLabel,
    tr,
  ]);

  // 1C. Vertical Wind Profile (0-120m) Option for Selected Hour
  const verticalProfileOption: EChartsOption = useMemo(() => {
    if (!activeHour) {
      return {};
    }

    const cw = (kmh: number | null | undefined) =>
      roundOrNull(convertWindSpeed(kmh, units.wind));
    const ch = (m: number) =>
      units.wave === 'ft'
        ? roundOrNull(convertWaveHeight(m, 'ft'), 0)
        : m;

    const nativePts = activeHour.verticalProfile.nativeLevels
      .filter((lvl) => lvl.speedKmh !== null)
      .map((lvl) => [cw(lvl.speedKmh), ch(lvl.heightM)]);

    const interpPts = showInterpolatedProfile
      ? activeHour.verticalProfile.interpolatedLevels
          .filter((lvl) => lvl.speedKmh !== null)
          .map((lvl) => [cw(lvl.speedKmh), ch(lvl.heightM)])
      : [];

    const series: NonNullable<EChartsOption['series']> = [
      {
        name: tr(
          `Níveis Diretos (${formatAltLabel(10, units.wave)}/${formatAltLabel(80, units.wave)}/${formatAltLabel(100, units.wave)}/${formatAltLabel(120, units.wave)})`,
          `Native Levels (${formatAltLabel(10, units.wave)}/${formatAltLabel(80, units.wave)}/${formatAltLabel(100, units.wave)}/${formatAltLabel(120, units.wave)})`,
        ),
        type: 'line',
        data: nativePts,
        symbolSize: 9,
        lineStyle: { width: 2.5, color: '#0080cd' },
        itemStyle: { color: '#0080cd' },
      },
    ];

    if (showInterpolatedProfile && interpPts.length > 0) {
      series.push({
        name: tr(
          `Curva Estimada ${formatAltLabel(10, units.wave)}–${formatAltLabel(120, units.wave)}`,
          `Estimated Curve ${formatAltLabel(10, units.wave)}–${formatAltLabel(120, units.wave)}`,
        ),
        type: 'line',
        smooth: true,
        data: interpPts,
        symbolSize: 5,
        lineStyle: { width: 2, type: 'dashed', color: '#f97316' },
        itemStyle: { color: '#f97316' },
      });
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 48,
        left: 16,
        right: 22,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        name: windLabel,
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: {
        type: 'value',
        name: tr(`Altura (${waveLabel})`, `Height (${waveLabel})`),
        min: 0,
        max: units.wave === 'ft' ? 410 : 125,
        interval: units.wave === 'ft' ? 80 : 20,
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10, formatter: `{value}${waveLabel}` },
        splitLine: { lineStyle: { color: gridBorderColor } },
      },
      series,
    };
  }, [
    activeHour,
    showInterpolatedProfile,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    gridBorderColor,
    units.wind,
    units.wave,
    windLabel,
    waveLabel,
    tr,
  ]);

  // 2. Waves, Swell & Optional Sea-Level (MSL) Option
  const marineOption: EChartsOption = useMemo(() => {
    if (!forecast.marineAvailable) {
      return {};
    }

    const cWave = (m: number | null | undefined) =>
      roundOrNull(convertWaveHeight(m, units.wave), units.wave === 'ft' ? 1 : 2);

    const minSeaLevel = hasSeaLevelMsl
      ? Math.min(
          0,
          ...slicedHours
            .map((h) => convertWaveHeight(h.marine?.seaLevelHeightMsl, units.wave))
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
        )
      : 0;
    const heightAxisMin = minSeaLevel < 0 ? Math.floor(minSeaLevel * 2) / 2 : 0;

    const marineSeries: NonNullable<EChartsOption['series']> = [
      {
        name: tr(`Altura de Onda (${waveLabel})`, `Wave Height (${waveLabel})`),
        type: 'line',
        smooth: true,
        symbol: 'none',
        areaStyle: {
          color: isDark ? 'rgba(0, 128, 205, 0.22)' : 'rgba(0, 128, 205, 0.14)',
        },
        lineStyle: { width: 2.5, color: '#0080cd' },
        itemStyle: { color: '#0080cd' },
        data: slicedHours.map((h) => cWave(h.marine?.waveHeight)),
        markLine: currentHourMarkLine,
      },
      {
        name: tr(`Ondulação Swell (${waveLabel})`, `Swell Wave Height (${waveLabel})`),
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, type: 'dashed', color: '#0d9488' },
        itemStyle: { color: '#0d9488' },
        data: slicedHours.map((h) => cWave(h.marine?.swellWaveHeight)),
      },
      {
        name: tr('Período (s)', 'Period (s)'),
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: '#f59e0b' },
        itemStyle: { color: '#f59e0b' },
        data: slicedHours.map((h) => roundOrNull(h.marine?.wavePeriod, 1)),
      },
    ];

    if (hasSeaLevelMsl) {
      marineSeries.push({
        name: tr(`Nível do Mar Est. (MSL ${waveLabel})`, `Est. Sea Level (MSL ${waveLabel})`),
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, type: 'dotted', color: '#6366f1' },
        itemStyle: { color: '#6366f1' },
        data: slicedHours.map((h) => cWave(h.marine?.seaLevelHeightMsl)),
      });
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 56,
        left: 16,
        right: 20,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: hasSeaLevelMsl
            ? tr(`Altura / MSL (${waveLabel})`, `Height / MSL (${waveLabel})`)
            : tr(`Altura (${waveLabel})`, `Height (${waveLabel})`),
          min: heightAxisMin,
          max: (value: { max: number }) =>
            Math.max(units.wave === 'ft' ? 5 : 1.5, Math.ceil(value.max * 1.25 * 2) / 2),
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridBorderColor } },
        },
        {
          type: 'value',
          name: tr('Período (s)', 'Period (s)'),
          min: 0,
          max: (value: { max: number }) =>
            Math.max(10, Math.ceil(value.max + 2)),
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: marineSeries,
    };
  }, [
    forecast.marineAvailable,
    hasSeaLevelMsl,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
    isDark,
    slicedHours,
    currentHourMarkLine,
    units.wave,
    waveLabel,
    tr,
  ]);

  // 3. Precipitation (mm/h or in/h) & Surface Pressure (hPa or inHg)
  const precipPressureOption: EChartsOption = useMemo(() => {
    const allPressures: number[] = [];
    const series: NonNullable<EChartsOption['series']> = [];
    const cp = (mm: number | null | undefined) =>
      roundOrNull(convertPrecipitation(mm, units.precipitation), 2);
    const cPress = (hpa: number | null | undefined) =>
      roundOrNull(
        convertPressure(hpa, units.pressure),
        units.pressure === 'inhg' ? 2 : 1,
      );

    if (viewMode === 'spaghetti') {
      const precipModels = getSharedModelsForVariable(forecast, 'precipitation', slicedHours.length);
      const pressureModels = getSharedModelsForVariable(
        forecast,
        'surfacePressure',
        slicedHours.length,
      );

      if (precipModels.length >= 2) {
        for (const modelId of precipModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Chuva', 'Rain')} (${precipLabel}/h)`,
            type: 'bar',
            itemStyle: { color: MODEL_COLORS[modelId], borderRadius: [3, 3, 0, 0] },
            data: list.map((h) => cp(h.precipitation)),
          });
        }
      } else {
        series.push({
          name: tr(`Chuva (${precipLabel}/h)`, `Rain (${precipLabel}/h)`),
          type: 'bar',
          itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
          data: slicedHours.map((h) => cp(h.precipitationMm.mean)),
        });
      }

      if (pressureModels.length >= 2) {
        for (const modelId of pressureModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          for (const h of list) {
            const pConv = cPress(h.surfacePressure);
            if (pConv !== null) {
              allPressures.push(pConv);
            }
          }
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Pressão', 'Pressure')} (${pressureLabel})`,
            type: 'line',
            yAxisIndex: 1,
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => cPress(h.surfacePressure)),
          });
        }
      }

      for (const h of slicedHours) {
        const pConv = cPress(h.surfacePressureHpa.mean);
        if (pConv !== null) {
          allPressures.push(pConv);
        }
      }
      series.push({
        name: tr(`Consenso Pressão (${pressureLabel})`, `Consensus Pressure (${pressureLabel})`),
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.2, type: 'dotted', color: '#0d9488' },
        itemStyle: { color: '#0d9488' },
        data: slicedHours.map((h) => cPress(h.surfacePressureHpa.mean)),
      });
    } else if (isNativeModel) {
      const label = MODEL_LABELS[viewMode];
      const nativeHours = (forecast.nativeByModel[viewMode] ?? []).slice(0, slicedHours.length);
      for (const h of nativeHours) {
        const pConv = cPress(h.surfacePressure);
        if (pConv !== null) {
          allPressures.push(pConv);
        }
      }
      series.push(
        {
          name: `${label} ${tr('Chuva', 'Rain')} (${precipLabel}/h)`,
          type: 'bar',
          itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
          data: nativeHours.map((h) => cp(h.precipitation)),
        },
        {
          name: `${label} ${tr('Pressão', 'Pressure')} (${pressureLabel})`,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.2, color: '#0d9488' },
          itemStyle: { color: '#0d9488' },
          data: nativeHours.map((h) => cPress(h.surfacePressure)),
        },
      );
    } else {
      for (const h of slicedHours) {
        const pConv = cPress(h.surfacePressureHpa.mean);
        if (pConv !== null) {
          allPressures.push(pConv);
        }
      }
      series.push(
        {
          name: tr(`Chuva (${precipLabel}/h)`, `Rain (${precipLabel}/h)`),
          type: 'bar',
          itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
          data: slicedHours.map((h) => cp(h.precipitationMm.mean)),
        },
        {
          name: tr(`Chuva Máx (${precipLabel}/h)`, `Max Rain (${precipLabel}/h)`),
          type: 'line',
          symbol: 'none',
          lineStyle: { width: 1, type: 'dotted', color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => cp(h.precipitationMm.max)),
        },
        {
          name: tr(`Pressão (${pressureLabel})`, `Pressure (${pressureLabel})`),
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.2, color: '#0d9488' },
          itemStyle: { color: '#0d9488' },
          data: slicedHours.map((h) => cPress(h.surfacePressureHpa.mean)),
        },
      );
    }

    if (series[0] && currentHourMarkLine) {
      (series[0] as { markLine?: ReturnType<typeof buildCurrentHourMarkLine> }).markLine =
        currentHourMarkLine;
    }

    const minP =
      units.pressure === 'inhg'
        ? allPressures.length > 0
          ? Math.floor((Math.min(...allPressures) - 0.1) * 10) / 10
          : 29.4
        : allPressures.length > 0
          ? Math.floor(Math.min(...allPressures) - 3)
          : 995;
    const maxP =
      units.pressure === 'inhg'
        ? allPressures.length > 0
          ? Math.ceil((Math.max(...allPressures) + 0.1) * 10) / 10
          : 30.4
        : allPressures.length > 0
          ? Math.ceil(Math.max(...allPressures) + 3)
          : 1030;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 56,
        left: 16,
        right: 20,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: tr(`Chuva (${precipLabel}/h)`, `Rain (${precipLabel}/h)`),
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridBorderColor } },
        },
        {
          type: 'value',
          name: tr(`Pressão (${pressureLabel})`, `Pressure (${pressureLabel})`),
          min: minP,
          max: maxP,
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series,
    };
  }, [
    viewMode,
    isNativeModel,
    forecast,
    slicedHours,
    currentHourMarkLine,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
    units.precipitation,
    units.pressure,
    precipLabel,
    pressureLabel,
    tr,
  ]);

  // 4. Stratified Cloud Cover (Baixa, Média e Alta — %) (supports FieldCast, Native, and Spaghetti)
  const cloudCoverOption: EChartsOption = useMemo(() => {
    const series: NonNullable<EChartsOption['series']> = [];

    if (viewMode === 'spaghetti') {
      const lowModels = getSharedModelsForVariable(forecast, 'cloudCoverLow', slicedHours.length);
      const midModels = getSharedModelsForVariable(forecast, 'cloudCoverMid', slicedHours.length);
      const highModels = getSharedModelsForVariable(forecast, 'cloudCoverHigh', slicedHours.length);

      if (lowModels.length >= 2) {
        for (const modelId of lowModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Nuvens Baixas', 'Low Clouds')}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2, color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => roundOrNull(h.cloudCoverLow, 0)),
          });
        }
      }

      if (midModels.length >= 2) {
        for (const modelId of midModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Nuvens Médias', 'Mid Clouds')}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.6, type: 'dashed', color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => roundOrNull(h.cloudCoverMid, 0)),
          });
        }
      }

      if (highModels.length >= 2) {
        for (const modelId of highModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} ${tr('Nuvens Altas', 'High Clouds')}`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.3, type: 'dotted', color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => roundOrNull(h.cloudCoverHigh, 0)),
          });
        }
      }

      if (series.length === 0) {
        series.push({
          name: tr('Nuvens Baixas (0–2 km)', 'Low Clouds (0–2 km)'),
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: '#64748b' },
          itemStyle: { color: '#64748b' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.lowPct.mean, 0)),
        });
      }
    } else if (isNativeModel) {
      const label = MODEL_LABELS[viewMode];
      const nativeHours = (forecast.nativeByModel[viewMode] ?? []).slice(0, slicedHours.length);
      series.push(
        {
          name: `${label} ${tr('Nuvens Baixas (0–2 km)', 'Low Clouds (0–2 km)')}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.16 },
          lineStyle: { width: 2, color: '#64748b' },
          itemStyle: { color: '#64748b' },
          data: nativeHours.map((h) => roundOrNull(h.cloudCoverLow, 0)),
        },
        {
          name: `${label} ${tr('Nuvens Médias (2–6 km)', 'Mid Clouds (2–6 km)')}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.14 },
          lineStyle: { width: 2, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: nativeHours.map((h) => roundOrNull(h.cloudCoverMid, 0)),
        },
        {
          name: `${label} ${tr('Nuvens Altas (> 6 km)', 'High Clouds (> 6 km)')}`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.1 },
          lineStyle: { width: 2, color: '#94a3b8' },
          itemStyle: { color: '#94a3b8' },
          data: nativeHours.map((h) => roundOrNull(h.cloudCoverHigh, 0)),
        },
      );
    } else {
      series.push(
        {
          name: tr('Nuvens Baixas (0–2 km)', 'Low Clouds (0–2 km)'),
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.16 },
          lineStyle: { width: 2, color: '#64748b' },
          itemStyle: { color: '#64748b' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.lowPct.mean, 0)),
        },
        {
          name: tr('Nuvens Médias (2–6 km)', 'Mid Clouds (2–6 km)'),
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.14 },
          lineStyle: { width: 2, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.midPct.mean, 0)),
        },
        {
          name: tr('Nuvens Altas (> 6 km)', 'High Clouds (> 6 km)'),
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.1 },
          lineStyle: { width: 2, color: '#94a3b8' },
          itemStyle: { color: '#94a3b8' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.highPct.mean, 0)),
        },
      );
    }

    if (series[0] && currentHourMarkLine) {
      (series[0] as { markLine?: ReturnType<typeof buildCurrentHourMarkLine> }).markLine =
        currentHourMarkLine;
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 56,
        left: 16,
        right: 20,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: {
        type: 'value',
        name: tr('% Nuvens', '% Clouds'),
        min: 0,
        max: 100,
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: gridBorderColor } },
      },
      series,
    };
  }, [
    viewMode,
    isNativeModel,
    forecast,
    slicedHours,
    currentHourMarkLine,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
    tr,
  ]);

  const showWindChart =
    focusTab === 'wind' || (focusTab === 'all' && visibleParams.wind10m);
  const showVerticalChart =
    focusTab === 'vertical' || (focusTab === 'all' && visibleParams.verticalProfile);
  const showTempChart =
    focusTab === 'temperature' || (focusTab === 'all' && visibleParams.tempVisibility);
  const showRainChart =
    focusTab === 'rain' || (focusTab === 'all' && visibleParams.rainPressure);
  const showWavesChart =
    focusTab === 'waves' || (focusTab === 'all' && visibleParams.waves);
  const showCloudsChart =
    focusTab === 'clouds' || (focusTab === 'all' && visibleParams.clouds);

  const focusTabs: Array<{
    id: ChartFocusTab;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'all', label: tr('Todos Visíveis', 'All Visible'), Icon: LayoutGrid },
    { id: 'wind', label: tr('Vento & Rajada', 'Wind & Gusts'), Icon: Wind },
    { id: 'temperature', label: tr('Temperatura', 'Temperature'), Icon: Thermometer },
    { id: 'rain', label: tr('Chuva & Pressão', 'Rain & Pressure'), Icon: CloudRain },
    { id: 'waves', label: tr('Ondas & Swell', 'Waves & Swell'), Icon: Waves },
    { id: 'clouds', label: tr('Nuvens', 'Clouds'), Icon: Cloud },
    { id: 'vertical', label: tr('Perfil Vertical', 'Vertical Profile'), Icon: Compass },
  ];

  const windChartTitle = tr(
    `Vento 10m, Faixa de Oscilação & Rajadas (${windLabel})`,
    `10m Wind, Spread Band & Gusts (${windLabel})`,
  );
  const verticalChartTitle = tr(
    `Perfil Vertical (0–${formatAltLabel(120, units.wave)})`,
    `Vertical Profile (0–${formatAltLabel(120, units.wave)})`,
  );
  const tempChartTitle = tr(
    `Temperatura & Ponto de Orvalho (${tempLabel})`,
    `Temperature & Dew Point (${tempLabel})`,
  );
  const rainChartTitle = tr(
    `Chuva Horária (${precipLabel}/h) & Pressão Atmosférica (${pressureLabel})`,
    `Hourly Rain (${precipLabel}/h) & Surface Pressure (${pressureLabel})`,
  );
  const wavesChartTitle = tr(
    `Ondas (${waveLabel}), Swell & Período`,
    `Waves (${waveLabel}), Swell & Period`,
  );
  const cloudsChartTitle = tr(
    'Nebulosidade por Altitude (Baixa • Média • Alta)',
    'Stratified Cloud Cover (Low • Mid • High)',
  );

  return (
    <section
      aria-label={tr('Gráficos Horários Interativos', 'Interactive Hourly Charts')}
      className="space-y-4"
    >
      {/* Climatempo-style Rounded Pill Selector Bar for Hourly Charts */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
            {tr('Gráfico Hora a Hora', 'Hour-by-Hour Charts')}
          </h2>
          <span className="text-xs text-slate-500 dark:text-sky-200/75 hidden sm:inline">
            •{' '}
            {tr(
              'Escolha um parâmetro em destaque ou veja o painel combinado',
              'Focus on one parameter or view all panels',
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-0.5 max-w-full">
          {focusTabs.map(({ id, label, Icon }) => {
            const isSelected = focusTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFocusTab(id)}
                aria-pressed={isSelected}
                className={`min-h-[34px] px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 shrink-0 border transition-all ${
                  isSelected
                    ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                    : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Permanent Active-Hour Summary Strip (visible without hover/tap) */}
      {activeSummaryMetrics && (
        <div
          data-testid="charts-hour-summary"
          className="rounded-2xl border border-sky-200/85 dark:border-sky-800/75 bg-sky-50/75 dark:bg-[#0d1f36]/90 px-4 py-3 shadow-xs space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-900 dark:text-white">
                <Clock className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                <span>{tr('Resumo da Janela Horária', 'Time-Window Summary')}</span>
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white dark:bg-[#132a47] text-[#0070b8] dark:text-sky-200 border border-sky-200 dark:border-sky-700 capitalize">
                {activeSummaryMetrics.timeLabel}
              </span>
              {isCurrentHourInRange && safeSelectedIdx === resolvedCurrentHourIndex && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                  {tr('Agora', 'Now')}
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/80 dark:bg-[#132a47]/80 text-slate-600 dark:text-sky-200/80 border border-slate-200/80 dark:border-sky-800">
                {activeSummaryMetrics.sourceLabel}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isCurrentHourInRange &&
                safeSelectedIdx !== resolvedCurrentHourIndex &&
                (onResetToCurrentHour || onSelectHourIndex) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onResetToCurrentHour) {
                        onResetToCurrentHour();
                      } else {
                        onSelectHourIndex?.(resolvedCurrentHourIndex);
                      }
                    }}
                    className="min-h-[30px] px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors"
                  >
                    {tr(`Voltar p/ Agora (${currentHourBadge})`, `Back to Now (${currentHourBadge})`)}
                  </button>
                )}
              <span className="text-[11px] text-slate-500 dark:text-sky-300/75 hidden md:inline">
                {tr(
                  'Toque nos gráficos para inspecionar outro horário',
                  'Tap charts to inspect another hour',
                )}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2 text-xs">
            <div className="rounded-xl bg-white dark:bg-[#132a47] border border-sky-100 dark:border-sky-800/70 px-2.5 py-2">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                {tr('Hora Local', 'Local Time')}
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {activeSummaryMetrics.hourBadge}
              </span>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#132a47] border border-sky-100 dark:border-sky-800/70 px-2.5 py-2">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                {tr('Vento Médio 10m', 'Mean Wind 10m')}
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {formatWindValue(activeSummaryMetrics.windSpeed, 0)}{' '}
                <span className="font-semibold text-[#0070b8] dark:text-sky-300">
                  {activeSummaryMetrics.windCardinal}
                  {activeSummaryMetrics.windDir !== null
                    ? ` ${Math.round(activeSummaryMetrics.windDir)}°`
                    : ''}
                </span>
              </span>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#132a47] border border-sky-100 dark:border-sky-800/70 px-2.5 py-2">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                {tr('Rajadas 10m', 'Gusts 10m')}
              </span>
              <span className="font-extrabold text-orange-600 dark:text-orange-300">
                {formatWindValue(activeSummaryMetrics.gusts, 0)}
              </span>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#132a47] border border-sky-100 dark:border-sky-800/70 px-2.5 py-2">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                {tr('Temp / Orvalho', 'Temp / Dew Pt')}
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {formatTempValue(activeSummaryMetrics.temp, 1)}{' '}
                <span className="font-semibold text-slate-500 dark:text-sky-300">
                  / {formatTempValue(activeSummaryMetrics.dewPoint, 0)}
                </span>
              </span>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#132a47] border border-sky-100 dark:border-sky-800/70 px-2.5 py-2">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                {tr('Precipitação', 'Precipitation')}
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {activeSummaryMetrics.precipMm !== null
                  ? formatPrecipValue(activeSummaryMetrics.precipMm, 1)
                  : formatPrecipValue(0, 1)}{' '}
                <span className="font-semibold text-[#0070b8] dark:text-sky-300">
                  •{' '}
                  {activeSummaryMetrics.precipProb !== null
                    ? `${Math.round(activeSummaryMetrics.precipProb)}%`
                    : '0%'}
                </span>
              </span>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#132a47] border border-sky-100 dark:border-sky-800/70 px-2.5 py-2">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                {tr('Pressão', 'Pressure')}
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {formatPressureValue(activeSummaryMetrics.pressureHpa)}
              </span>
            </div>

            {forecast.marineAvailable && (
              <div className="rounded-xl bg-white dark:bg-[#132a47] border border-sky-100 dark:border-sky-800/70 px-2.5 py-2">
                <span className="text-[10px] font-semibold text-slate-500 dark:text-sky-300/75 block">
                  {tr('Onda / Período', 'Wave / Period')}
                  {activeSummaryMetrics.seaLevelHeightMsl !== null ? ' • MSL' : ''}
                </span>
                <span className="font-extrabold text-slate-900 dark:text-white">
                  {formatWaveValue(activeSummaryMetrics.waveHeight, 1)}{' '}
                  <span className="font-semibold text-[#0070b8] dark:text-sky-300">
                    {activeSummaryMetrics.wavePeriod !== null
                      ? `${Math.round(activeSummaryMetrics.wavePeriod)}s`
                      : '—'}
                  </span>
                </span>
                {activeSummaryMetrics.seaLevelHeightMsl !== null && (
                  <span className="block text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                    {tr('Nível do Mar Est. (MSL):', 'Est. Sea Level (MSL):')}{' '}
                    {(() => {
                      const mslConv =
                        convertWaveHeight(activeSummaryMetrics.seaLevelHeightMsl, units.wave) ??
                        activeSummaryMetrics.seaLevelHeightMsl;
                      return `${mslConv >= 0 ? '+' : ''}${mslConv.toFixed(units.wave === 'ft' ? 1 : 2)} ${waveLabel}`;
                    })()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row 1: Wind Time Series + Vertical Wind Profile 0-120m (when enabled) */}
      {(showWindChart || showVerticalChart) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {showWindChart && (
            <div
              data-chart-id="wind"
              data-current-hour-index={isCurrentHourInRange ? resolvedCurrentHourIndex : ''}
              data-current-hour-label={currentHourBadge ?? ''}
              className={`${
                showVerticalChart ? 'lg:col-span-2' : 'lg:col-span-3'
              } rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Wind className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {windChartTitle}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="chart-fullscreen-btn"
                    data-chart-fullscreen-target="wind"
                    onClick={() =>
                      setFullscreenChartId((prev) => (prev === 'wind' ? null : 'wind'))
                    }
                    aria-pressed={fullscreenChartId === 'wind'}
                    aria-label={
                      fullscreenChartId === 'wind'
                        ? tr('Reduzir gráfico de Vento', 'Minimize Wind chart')
                        : tr('Tela Cheia do gráfico de Vento', 'Fullscreen Wind chart')
                    }
                    className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {fullscreenChartId === 'wind' ? (
                      <>
                        <Minimize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Reduzir', 'Minimize')}</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Tela Cheia', 'Fullscreen')}</span>
                      </>
                    )}
                  </button>
                  <HelpPopover topic="ensemble_vs_native" />
                </div>
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  {...getEChartsRefProps('wind')}
                  option={windTimeSeriesOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
                  onEvents={timeSeriesEvents}
                />
              </div>
            </div>
          )}

          {showVerticalChart && (
            <div
              data-chart-id="vertical"
              data-current-hour-index={isCurrentHourInRange ? resolvedCurrentHourIndex : ''}
              data-current-hour-label={currentHourBadge ?? ''}
              className={`${
                showWindChart ? 'lg:col-span-1' : 'lg:col-span-3'
              } rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2 flex flex-col justify-between`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Compass className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {verticalChartTitle}
                    </h3>
                    {showInterpolatedProfile && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0070b8] dark:bg-sky-900 dark:text-sky-200">
                        {tr('Estimado', 'Estimated')}
                      </span>
                    )}
                    {isCurrentHourInRange && currentHourBadge && (
                      <span
                        data-testid="vertical-profile-current-badge"
                        className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                      >
                        {tr('Agora:', 'Now:')} {currentHourBadge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      data-testid="chart-fullscreen-btn"
                      data-chart-fullscreen-target="vertical"
                      onClick={() =>
                        setFullscreenChartId((prev) => (prev === 'vertical' ? null : 'vertical'))
                      }
                      aria-pressed={fullscreenChartId === 'vertical'}
                      aria-label={
                        fullscreenChartId === 'vertical'
                          ? tr('Reduzir gráfico de Perfil Vertical', 'Minimize Vertical Profile chart')
                          : tr('Tela Cheia do gráfico de Perfil Vertical', 'Fullscreen Vertical Profile chart')
                      }
                      className="min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      {fullscreenChartId === 'vertical' ? (
                        <Minimize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                      ) : (
                        <Maximize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                      )}
                    </button>
                    <HelpPopover topic="vertical_profile" />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-sky-200">
                  <span>
                    {tr('Horário:', 'Time:')} <strong>{xLabels[safeSelectedIdx] ?? tr('Agora', 'Now')}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    {isCurrentHourInRange &&
                      safeSelectedIdx !== resolvedCurrentHourIndex &&
                      (onSelectHourIndex || onResetToCurrentHour) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (onResetToCurrentHour) {
                              onResetToCurrentHour();
                            } else {
                              onSelectHourIndex?.(resolvedCurrentHourIndex);
                            }
                          }}
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors"
                        >
                          {tr('Ir para Agora', 'Go to Now')}
                        </button>
                      )}
                    <span className="font-mono">
                      α ={' '}
                      {activeHour?.verticalProfile.alpha !== null &&
                      activeHour?.verticalProfile.alpha !== undefined
                        ? activeHour.verticalProfile.alpha.toFixed(3)
                        : 'N/A'}
                    </span>
                  </div>
                </div>

                {onSelectHourIndex && slicedHours.length > 1 && (
                  <input
                    type="range"
                    min={0}
                    max={slicedHours.length - 1}
                    value={safeSelectedIdx}
                    onChange={(e) => onSelectHourIndex(Number(e.target.value))}
                    aria-label={tr(
                      'Selecionar hora para inspecionar perfil vertical de vento',
                      'Select hour to inspect vertical wind profile',
                    )}
                    className="w-full accent-[#0080cd] cursor-pointer"
                  />
                )}
              </div>

              <div className="h-64 sm:h-72 min-h-[256px] w-full shrink-0">
                <ReactECharts
                  {...getEChartsRefProps('vertical')}
                  option={verticalProfileOption}
                  style={{ height: '100%', minHeight: '256px', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Row 2: Temperature & Dew Point + Precipitation & Pressure */}
      {(showTempChart || showRainChart) && (
        <div
          className={`grid grid-cols-1 ${
            showTempChart && showRainChart ? 'lg:grid-cols-2' : 'lg:grid-cols-1'
          } gap-4`}
        >
          {showTempChart && (
            <div
              data-chart-id="temperature"
              data-current-hour-index={isCurrentHourInRange ? resolvedCurrentHourIndex : ''}
              data-current-hour-label={currentHourBadge ?? ''}
              className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Thermometer className="w-5 h-5 text-orange-500" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {tempChartTitle}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="chart-fullscreen-btn"
                    data-chart-fullscreen-target="temperature"
                    onClick={() =>
                      setFullscreenChartId((prev) =>
                        prev === 'temperature' ? null : 'temperature',
                      )
                    }
                    aria-pressed={fullscreenChartId === 'temperature'}
                    aria-label={
                      fullscreenChartId === 'temperature'
                        ? tr('Reduzir gráfico de Temperatura', 'Minimize Temperature chart')
                        : tr('Tela Cheia do gráfico de Temperatura', 'Fullscreen Temperature chart')
                    }
                    className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {fullscreenChartId === 'temperature' ? (
                      <>
                        <Minimize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Reduzir', 'Minimize')}</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Tela Cheia', 'Fullscreen')}</span>
                      </>
                    )}
                  </button>
                  <HelpPopover topic="fog_risk" />
                </div>
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  {...getEChartsRefProps('temperature')}
                  option={temperatureOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
                  onEvents={timeSeriesEvents}
                />
              </div>
            </div>
          )}

          {showRainChart && (
            <div
              data-chart-id="rain"
              data-current-hour-index={isCurrentHourInRange ? resolvedCurrentHourIndex : ''}
              data-current-hour-label={currentHourBadge ?? ''}
              className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CloudRain className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {rainChartTitle}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="chart-fullscreen-btn"
                    data-chart-fullscreen-target="rain"
                    onClick={() =>
                      setFullscreenChartId((prev) => (prev === 'rain' ? null : 'rain'))
                    }
                    aria-pressed={fullscreenChartId === 'rain'}
                    aria-label={
                      fullscreenChartId === 'rain'
                        ? tr('Reduzir gráfico de Chuva e Pressão', 'Minimize Rain & Pressure chart')
                        : tr('Tela Cheia do gráfico de Chuva e Pressão', 'Fullscreen Rain & Pressure chart')
                    }
                    className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {fullscreenChartId === 'rain' ? (
                      <>
                        <Minimize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Reduzir', 'Minimize')}</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Tela Cheia', 'Fullscreen')}</span>
                      </>
                    )}
                  </button>
                  <HelpPopover topic="barometric_trend" />
                </div>
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  {...getEChartsRefProps('rain')}
                  option={precipPressureOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
                  onEvents={timeSeriesEvents}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Row 3: Waves/Swell + Stratified Cloud Cover */}
      {(showWavesChart || showCloudsChart) && (
        <div
          className={`grid grid-cols-1 ${
            showWavesChart && showCloudsChart ? 'lg:grid-cols-2' : 'lg:grid-cols-1'
          } gap-4`}
        >
          {showWavesChart && (
            <div
              data-chart-id="waves"
              data-current-hour-index={isCurrentHourInRange ? resolvedCurrentHourIndex : ''}
              data-current-hour-label={currentHourBadge ?? ''}
              className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Waves className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {wavesChartTitle}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="chart-fullscreen-btn"
                    data-chart-fullscreen-target="waves"
                    onClick={() =>
                      setFullscreenChartId((prev) => (prev === 'waves' ? null : 'waves'))
                    }
                    aria-pressed={fullscreenChartId === 'waves'}
                    aria-label={
                      fullscreenChartId === 'waves'
                        ? tr('Reduzir gráfico de Ondas e Maré MSL', 'Minimize Waves & MSL chart')
                        : tr('Tela Cheia do gráfico de Ondas e Maré MSL', 'Fullscreen Waves & MSL chart')
                    }
                    className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {fullscreenChartId === 'waves' ? (
                      <>
                        <Minimize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Reduzir', 'Minimize')}</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Tela Cheia', 'Fullscreen')}</span>
                      </>
                    )}
                  </button>
                  <HelpPopover topic="waves_swell" />
                </div>
              </div>

              {forecast.marineAvailable ? (
                <>
                  <div className="h-72 sm:h-80 min-h-[288px] w-full">
                    <ReactECharts
                      {...getEChartsRefProps('waves')}
                      option={marineOption}
                      style={{ height: '100%', minHeight: '288px', width: '100%' }}
                      notMerge={true}
                      lazyUpdate={true}
                      onEvents={timeSeriesEvents}
                    />
                  </div>
                  {hasSeaLevelMsl && (
                    <p
                      data-testid="waves-msl-disclaimer"
                      className="text-[11px] leading-snug text-slate-600 dark:text-sky-200/85 bg-sky-50/80 dark:bg-[#0d1f36]/80 border border-sky-200/80 dark:border-sky-800/70 rounded-xl px-3 py-2"
                    >
                      {tr(
                        'Nível do Mar (MSL ~8 km): estimativa barométrica/maré indicativa; não substitui Tábua de Marés oficial da DHN/Marinha.',
                        'Sea Level (MSL ~8 km): hydrodynamic estimate only; does NOT replace official DHN/Marinha port tide tables.',
                      )}
                    </p>
                  )}
                </>
              ) : (
                <div className="min-h-[220px] rounded-2xl border border-dashed border-sky-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36]/60 p-6 flex flex-col items-center justify-center text-center space-y-2">
                  <div className="p-2.5 rounded-2xl bg-sky-100 dark:bg-sky-900/60 text-[#0080cd] dark:text-sky-300">
                    <Mountain className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-white">
                    {tr('Localidade Continental (Sem Grade Marítima)', 'Inland Coordinate (No Marine Grid)')}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-sky-200/80 max-w-md leading-relaxed">
                    {tr(
                      'Esta coordenada fica em terra firme. Você pode ocultar “Ondas & Swell” na barra de parâmetros acima para deixar a tela ainda mais limpa.',
                      'This coordinate is inland. You can hide "Waves & Swell" in the parameter bar above to keep the screen cleaner.',
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {showCloudsChart && (
            <div
              data-chart-id="clouds"
              data-current-hour-index={isCurrentHourInRange ? resolvedCurrentHourIndex : ''}
              data-current-hour-label={currentHourBadge ?? ''}
              className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {cloudsChartTitle}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="chart-fullscreen-btn"
                    data-chart-fullscreen-target="clouds"
                    onClick={() =>
                      setFullscreenChartId((prev) => (prev === 'clouds' ? null : 'clouds'))
                    }
                    aria-pressed={fullscreenChartId === 'clouds'}
                    aria-label={
                      fullscreenChartId === 'clouds'
                        ? tr('Reduzir gráfico de Nebulosidade', 'Minimize Cloud Cover chart')
                        : tr('Tela Cheia do gráfico de Nebulosidade', 'Fullscreen Cloud Cover chart')
                    }
                    className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {fullscreenChartId === 'clouds' ? (
                      <>
                        <Minimize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Reduzir', 'Minimize')}</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                        <span className="hidden sm:inline">{tr('Tela Cheia', 'Fullscreen')}</span>
                      </>
                    )}
                  </button>
                  <HelpPopover topic="stratified_clouds" />
                </div>
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  {...getEChartsRefProps('clouds')}
                  option={cloudCoverOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
                  onEvents={timeSeriesEvents}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Viewport Portal Modal (z-[85], 70vh chart height) */}
      {fullscreenChartId !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tr('Visualização de Gráfico em Tela Cheia', 'Fullscreen Chart View')}
            data-testid="chart-fullscreen-modal"
            onClick={() => setFullscreenChartId(null)}
            className="fixed inset-0 z-[85] bg-slate-950/80 backdrop-blur-sm flex flex-col p-3 sm:p-6 overflow-y-auto"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-7xl mx-auto my-auto rounded-3xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#132a47] p-4 sm:p-6 shadow-2xl space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-sky-800 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                    {fullscreenChartId === 'wind' && windChartTitle}
                    {fullscreenChartId === 'vertical' && verticalChartTitle}
                    {fullscreenChartId === 'temperature' && tempChartTitle}
                    {fullscreenChartId === 'rain' && rainChartTitle}
                    {fullscreenChartId === 'waves' &&
                      tr(
                        `Ondas (${waveLabel}), Swell, Período & Maré Est. (MSL)`,
                        `Waves (${waveLabel}), Swell, Period & Est. Sea Level (MSL)`,
                      )}
                    {fullscreenChartId === 'clouds' && cloudsChartTitle}
                  </h3>
                  {activeSummaryMetrics && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-50 dark:bg-[#0d1f36] text-[#0070b8] dark:text-sky-200 border border-sky-200 dark:border-sky-700 capitalize">
                      {activeSummaryMetrics.timeLabel} • {activeSummaryMetrics.sourceLabel}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  data-testid="chart-fullscreen-btn"
                  onClick={() => setFullscreenChartId(null)}
                  aria-label={tr('Reduzir gráfico em tela cheia', 'Minimize fullscreen chart')}
                  className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 bg-[#0080cd] hover:bg-[#006bb3] text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <Minimize2 className="w-4 h-4" aria-hidden="true" />
                  <span>{tr('Reduzir', 'Minimize')}</span>
                </button>
              </div>

              {fullscreenChartId === 'vertical' && onSelectHourIndex && slicedHours.length > 1 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-sky-200">
                    <span>
                      {tr('Janela inspecionada:', 'Inspected window:')}{' '}
                      <strong>{xLabels[safeSelectedIdx] ?? tr('Agora', 'Now')}</strong>
                    </span>
                    <span className="font-mono">
                      α ={' '}
                      {activeHour?.verticalProfile.alpha !== null &&
                      activeHour?.verticalProfile.alpha !== undefined
                        ? activeHour.verticalProfile.alpha.toFixed(3)
                        : 'N/A'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={slicedHours.length - 1}
                    value={safeSelectedIdx}
                    onChange={(e) => onSelectHourIndex(Number(e.target.value))}
                    aria-label={tr(
                      'Selecionar hora no perfil vertical em tela cheia',
                      'Select hour in fullscreen vertical profile',
                    )}
                    className="w-full accent-[#0080cd] cursor-pointer"
                  />
                </div>
              )}

              {fullscreenChartId === 'waves' && !forecast.marineAvailable ? (
                <div className="min-h-[40vh] rounded-2xl border border-dashed border-sky-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36]/60 p-8 flex flex-col items-center justify-center text-center space-y-2">
                  <Mountain className="w-8 h-8 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                  <h4 className="text-base font-bold text-slate-800 dark:text-white">
                    {tr('Localidade Continental (Sem Grade Marítima)', 'Inland Coordinate (No Marine Grid)')}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-sky-200/80 max-w-md">
                    {tr(
                      'A coordenada selecionada está em terra firme e não possui grade oceânica costeira.',
                      'The selected coordinate is inland and has no coastal marine grid.',
                    )}
                  </p>
                </div>
              ) : (
                <div className="w-full" style={{ height: '70vh', minHeight: '360px' }}>
                  <ReactECharts
                    {...getEChartsRefProps('fullscreen')}
                    option={
                      fullscreenChartId === 'wind'
                        ? windTimeSeriesOption
                        : fullscreenChartId === 'vertical'
                          ? verticalProfileOption
                          : fullscreenChartId === 'temperature'
                            ? temperatureOption
                            : fullscreenChartId === 'rain'
                              ? precipPressureOption
                              : fullscreenChartId === 'waves'
                                ? marineOption
                                : cloudCoverOption
                    }
                    style={{ height: '70vh', minHeight: '360px', width: '100%' }}
                    notMerge={true}
                    lazyUpdate={true}
                    onEvents={fullscreenChartId === 'vertical' ? undefined : timeSeriesEvents}
                  />
                </div>
              )}

              {fullscreenChartId === 'waves' && forecast.marineAvailable && hasSeaLevelMsl && (
                <p className="text-xs leading-snug text-slate-600 dark:text-sky-200/85 bg-sky-50/80 dark:bg-[#0d1f36]/80 border border-sky-200/80 dark:border-sky-800/70 rounded-xl px-3.5 py-2">
                  {tr(
                    'Nível do Mar (MSL ~8 km): estimativa barométrica/maré indicativa; não substitui Tábua de Marés oficial da DHN/Marinha.',
                    'Sea Level (MSL ~8 km): hydrodynamic estimate only; does NOT replace official DHN/Marinha port tide tables.',
                  )}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
};
