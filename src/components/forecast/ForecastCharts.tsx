import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Cloud,
  CloudRain,
  Compass,
  LayoutGrid,
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
import { HelpPopover } from '../common/HelpPopover';
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

export interface ForecastChartsProps {
  forecast: NormalizedForecast;
  viewMode: ForecastViewMode;
  showInterpolatedProfile: boolean;
  horizonHours: ForecastHorizonHours;
  selectedHourIndex: number;
  currentHourIndex?: number;
  onSelectHourIndex?: (index: number) => void;
  onResetToCurrentHour?: () => void;
  isDark?: boolean;
  visibleParams?: ForecastVisibleParams;
}

const MODEL_LABELS: Record<WeatherModelId, string> = MODEL_DISPLAY_LABELS;

function formatAxisHour(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    const weekday = d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      timeZone: timezone || undefined,
    });
    const day = d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      timeZone: timezone || undefined,
    });
    const hour = d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
    return `${weekday.replace('.', '')} ${day} ${hour}`;
  } catch {
    return new Date(timestampUnix * 1000).toISOString().slice(5, 16).replace('T', ' ');
  }
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
  const [focusTab, setFocusTab] = useState<ChartFocusTab>('all');

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
    () => slicedHours.map((h) => formatAxisHour(h.timestampUnix, forecast.timezone)),
    [slicedHours, forecast.timezone],
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
    viewMode === 'ecmwf_ifs025' || viewMode === 'gfs_seamless' || viewMode === 'icon_seamless';

  // 1A. Hourly Wind & Gusts Time-Series Chart Option
  const windTimeSeriesOption: EChartsOption = useMemo(() => {
    const nativeHours: NativeModelHour[] = isNativeModel
      ? (forecast.nativeByModel[viewMode] ?? []).slice(0, slicedHours.length)
      : [];

    const series: NonNullable<EChartsOption['series']> = [];

    if (viewMode === 'fieldcast') {
      const minValues = slicedHours.map((h) =>
        roundOrNull(h.windSpeed10m.min ?? h.windSpeed10m.mean),
      );
      const bandDiff = slicedHours.map((h) => {
        const minV = h.windSpeed10m.min;
        const maxV = h.windSpeed10m.max;
        if (minV === null || maxV === null) return 0;
        return roundOrNull(Math.max(0, maxV - minV)) ?? 0;
      });

      series.push(
        {
          name: 'Vento 10m Mín',
          type: 'line',
          data: minValues,
          stack: 'wind_uncertainty',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          name: 'Faixa Mín–Máx (10m)',
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
          name: 'Vento 10m (km/h)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => roundOrNull(h.windSpeed10m.mean)),
          markLine: currentHourMarkLine,
        },
        {
          name: 'Rajadas 10m (km/h)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: slicedHours.map((h) => roundOrNull(h.windGusts10m.mean)),
        },
      );

      if (includeAltitudeInWindChart) {
        series.push(
          {
            name: 'Vento 80m',
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, color: '#38bdf8' },
            itemStyle: { color: '#38bdf8' },
            data: slicedHours.map((h) => roundOrNull(h.windSpeed80m.mean)),
          },
          {
            name: 'Vento 100m',
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, color: '#6366f1' },
            itemStyle: { color: '#6366f1' },
            data: slicedHours.map((h) => roundOrNull(h.windSpeed100m.mean)),
          },
          {
            name: 'Vento 120m',
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, color: '#0d9488' },
            itemStyle: { color: '#0d9488' },
            data: slicedHours.map((h) => roundOrNull(h.windSpeed120m.mean)),
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
          name: `${MODEL_SHORT_LABELS[modelId]} Vento 10m`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: MODEL_COLORS[modelId] },
          itemStyle: { color: MODEL_COLORS[modelId] },
          data: list.map((h) => roundOrNull(h.windSpeed10m)),
        });
      }

      if (gustModels.length >= 2) {
        for (const modelId of gustModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} Rajada 10m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, type: 'dashed', color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => roundOrNull(h.windGusts10m)),
          });
        }
      }

      if (includeAltitudeInWindChart) {
        const altFields = [
          { id: 'windSpeed80m' as const, label: '80m' },
          { id: 'windSpeed100m' as const, label: '100m' },
          { id: 'windSpeed120m' as const, label: '120m' },
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
                data: list.map((h) => roundOrNull(h[alt.id])),
              });
            }
          }
        }
      }

      series.push({
        name: 'Consenso FieldCast 10m',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.5, type: 'dotted', color: '#f97316' },
        itemStyle: { color: '#f97316' },
        data: slicedHours.map((h) => roundOrNull(h.windSpeed10m.mean)),
        markLine: currentHourMarkLine,
      });
    } else if (isNativeModel) {
      const label = MODEL_LABELS[viewMode];
      series.push(
        {
          name: `${label} Vento 10m`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: nativeHours.map((h) => roundOrNull(h.windSpeed10m)),
          markLine: currentHourMarkLine,
        },
        {
          name: `${label} Rajadas 10m`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: nativeHours.map((h) => roundOrNull(h.windGusts10m)),
        },
      );

      if (includeAltitudeInWindChart) {
        if (nativeHours.some((h) => h.windSpeed80m !== null)) {
          series.push({
            name: `${label} Vento 80m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: '#38bdf8' },
            itemStyle: { color: '#38bdf8' },
            data: nativeHours.map((h) => roundOrNull(h.windSpeed80m)),
          });
        }
        if (nativeHours.some((h) => h.windSpeed100m !== null)) {
          series.push({
            name: `${label} Vento 100m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2, color: '#6366f1' },
            itemStyle: { color: '#6366f1' },
            data: nativeHours.map((h) => roundOrNull(h.windSpeed100m)),
          });
        }
        if (nativeHours.some((h) => h.windSpeed120m !== null)) {
          series.push({
            name: `${label} Vento 120m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: '#0d9488' },
            itemStyle: { color: '#0d9488' },
            data: nativeHours.map((h) => roundOrNull(h.windSpeed120m)),
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
        name: 'km/h',
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
  ]);

  // 1B. Temperature & Dew Point Chart Option (supports FieldCast, Native, and Spaghetti)
  const temperatureOption: EChartsOption = useMemo(() => {
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
            data: list.map((h) => roundOrNull(h.temperature2m, 1)),
          });
        }
      }

      if (dewModels.length >= 2) {
        for (const modelId of dewModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} Orvalho 2m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.5, type: 'dashed', color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => roundOrNull(h.dewPoint2m, 1)),
          });
        }
      }

      series.push({
        name: 'Consenso Temp 2m (°C)',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.5, type: 'dotted', color: '#f97316' },
        itemStyle: { color: '#f97316' },
        data: slicedHours.map((h) => roundOrNull(h.temperature2mC.mean, 1)),
      });
    } else if (isNativeModel) {
      const label = MODEL_LABELS[viewMode];
      const nativeHours = (forecast.nativeByModel[viewMode] ?? []).slice(0, slicedHours.length);
      series.push(
        {
          name: `${label} Temperatura (2m °C)`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: {
            color: isDark ? 'rgba(249, 115, 22, 0.16)' : 'rgba(249, 115, 22, 0.12)',
          },
          lineStyle: { width: 2.5, color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: nativeHours.map((h) => roundOrNull(h.temperature2m, 1)),
        },
        {
          name: `${label} Ponto de Orvalho (°C)`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: nativeHours.map((h) => roundOrNull(h.dewPoint2m, 1)),
        },
      );
    } else {
      series.push(
        {
          name: 'Temperatura (2m °C)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: {
            color: isDark ? 'rgba(249, 115, 22, 0.16)' : 'rgba(249, 115, 22, 0.12)',
          },
          lineStyle: { width: 2.5, color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: slicedHours.map((h) => roundOrNull(h.temperature2mC.mean, 1)),
        },
        {
          name: 'Ponto de Orvalho (°C)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => roundOrNull(h.dewPoint2mC.mean, 1)),
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
        name: '°C',
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
  ]);

  // 1C. Vertical Wind Profile (0-120m) Option for Selected Hour
  const verticalProfileOption: EChartsOption = useMemo(() => {
    if (!activeHour) {
      return {};
    }

    const nativePts = activeHour.verticalProfile.nativeLevels
      .filter((lvl) => lvl.speedKmh !== null)
      .map((lvl) => [roundOrNull(lvl.speedKmh), lvl.heightM]);

    const interpPts = showInterpolatedProfile
      ? activeHour.verticalProfile.interpolatedLevels
          .filter((lvl) => lvl.speedKmh !== null)
          .map((lvl) => [roundOrNull(lvl.speedKmh), lvl.heightM])
      : [];

    const series: NonNullable<EChartsOption['series']> = [
      {
        name: 'Níveis Diretos (10m/80m/100m/120m)',
        type: 'line',
        data: nativePts,
        symbolSize: 9,
        lineStyle: { width: 2.5, color: '#0080cd' },
        itemStyle: { color: '#0080cd' },
      },
    ];

    if (showInterpolatedProfile && interpPts.length > 0) {
      series.push({
        name: 'Curva Estimada 10–120m',
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
        name: 'km/h',
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: {
        type: 'value',
        name: 'Altura (m)',
        min: 0,
        max: 125,
        interval: 20,
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10, formatter: '{value}m' },
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
  ]);

  // 2. Waves & Swell Option
  const marineOption: EChartsOption = useMemo(() => {
    if (!forecast.marineAvailable) {
      return {};
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
          name: 'Altura (m)',
          min: 0,
          max: (value: { max: number }) =>
            Math.max(1.5, Math.ceil(value.max * 1.25 * 2) / 2),
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridBorderColor } },
        },
        {
          type: 'value',
          name: 'Período (s)',
          min: 0,
          max: (value: { max: number }) =>
            Math.max(10, Math.ceil(value.max + 2)),
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Altura de Onda (m)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: {
            color: isDark ? 'rgba(0, 128, 205, 0.22)' : 'rgba(0, 128, 205, 0.14)',
          },
          lineStyle: { width: 2.5, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => roundOrNull(h.marine?.waveHeight, 2)),
          markLine: currentHourMarkLine,
        },
        {
          name: 'Ondulação Swell (m)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#0d9488' },
          itemStyle: { color: '#0d9488' },
          data: slicedHours.map((h) => roundOrNull(h.marine?.swellWaveHeight, 2)),
        },
        {
          name: 'Período (s)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
          data: slicedHours.map((h) => roundOrNull(h.marine?.wavePeriod, 1)),
        },
      ],
    };
  }, [
    forecast.marineAvailable,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
    isDark,
    slicedHours,
    currentHourMarkLine,
  ]);

  // 3. Precipitation (mm/h) & Surface Pressure (hPa) (supports FieldCast, Native, and Spaghetti)
  const precipPressureOption: EChartsOption = useMemo(() => {
    const allPressures: number[] = [];
    const series: NonNullable<EChartsOption['series']> = [];

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
            name: `${MODEL_SHORT_LABELS[modelId]} Chuva (mm/h)`,
            type: 'bar',
            itemStyle: { color: MODEL_COLORS[modelId], borderRadius: [3, 3, 0, 0] },
            data: list.map((h) => roundOrNull(h.precipitation, 2)),
          });
        }
      } else {
        series.push({
          name: 'Chuva (mm/h)',
          type: 'bar',
          itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
          data: slicedHours.map((h) => roundOrNull(h.precipitationMm.mean, 2)),
        });
      }

      if (pressureModels.length >= 2) {
        for (const modelId of pressureModels) {
          const list = (forecast.nativeByModel[modelId] ?? []).slice(0, slicedHours.length);
          for (const h of list) {
            if (typeof h.surfacePressure === 'number' && Number.isFinite(h.surfacePressure)) {
              allPressures.push(h.surfacePressure);
            }
          }
          series.push({
            name: `${MODEL_SHORT_LABELS[modelId]} Pressão (hPa)`,
            type: 'line',
            yAxisIndex: 1,
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: MODEL_COLORS[modelId] },
            itemStyle: { color: MODEL_COLORS[modelId] },
            data: list.map((h) => roundOrNull(h.surfacePressure, 1)),
          });
        }
      }

      for (const h of slicedHours) {
        if (h.surfacePressureHpa.mean !== null) {
          allPressures.push(h.surfacePressureHpa.mean);
        }
      }
      series.push({
        name: 'Consenso Pressão (hPa)',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2.2, type: 'dotted', color: '#0d9488' },
        itemStyle: { color: '#0d9488' },
        data: slicedHours.map((h) => roundOrNull(h.surfacePressureHpa.mean, 1)),
      });
    } else if (isNativeModel) {
      const label = MODEL_LABELS[viewMode];
      const nativeHours = (forecast.nativeByModel[viewMode] ?? []).slice(0, slicedHours.length);
      for (const h of nativeHours) {
        if (typeof h.surfacePressure === 'number' && Number.isFinite(h.surfacePressure)) {
          allPressures.push(h.surfacePressure);
        }
      }
      series.push(
        {
          name: `${label} Chuva (mm/h)`,
          type: 'bar',
          itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
          data: nativeHours.map((h) => roundOrNull(h.precipitation, 2)),
        },
        {
          name: `${label} Pressão (hPa)`,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.2, color: '#0d9488' },
          itemStyle: { color: '#0d9488' },
          data: nativeHours.map((h) => roundOrNull(h.surfacePressure, 1)),
        },
      );
    } else {
      for (const h of slicedHours) {
        if (h.surfacePressureHpa.mean !== null) {
          allPressures.push(h.surfacePressureHpa.mean);
        }
      }
      series.push(
        {
          name: 'Chuva (mm/h)',
          type: 'bar',
          itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
          data: slicedHours.map((h) => roundOrNull(h.precipitationMm.mean, 2)),
        },
        {
          name: 'Chuva Máx (mm/h)',
          type: 'line',
          symbol: 'none',
          lineStyle: { width: 1, type: 'dotted', color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => roundOrNull(h.precipitationMm.max, 2)),
        },
        {
          name: 'Pressão (hPa)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.2, color: '#0d9488' },
          itemStyle: { color: '#0d9488' },
          data: slicedHours.map((h) => roundOrNull(h.surfacePressureHpa.mean, 1)),
        },
      );
    }

    if (series[0] && currentHourMarkLine) {
      (series[0] as { markLine?: ReturnType<typeof buildCurrentHourMarkLine> }).markLine =
        currentHourMarkLine;
    }

    const minP = allPressures.length > 0 ? Math.floor(Math.min(...allPressures) - 3) : 995;
    const maxP = allPressures.length > 0 ? Math.ceil(Math.max(...allPressures) + 3) : 1030;

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
          name: 'Chuva (mm/h)',
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridBorderColor } },
        },
        {
          type: 'value',
          name: 'Pressão (hPa)',
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
            name: `${MODEL_SHORT_LABELS[modelId]} Nuvens Baixas`,
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
            name: `${MODEL_SHORT_LABELS[modelId]} Nuvens Médias`,
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
            name: `${MODEL_SHORT_LABELS[modelId]} Nuvens Altas`,
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
          name: 'Nuvens Baixas (0–2 km)',
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
          name: `${label} Nuvens Baixas (0–2 km)`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.16 },
          lineStyle: { width: 2, color: '#64748b' },
          itemStyle: { color: '#64748b' },
          data: nativeHours.map((h) => roundOrNull(h.cloudCoverLow, 0)),
        },
        {
          name: `${label} Nuvens Médias (2–6 km)`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.14 },
          lineStyle: { width: 2, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: nativeHours.map((h) => roundOrNull(h.cloudCoverMid, 0)),
        },
        {
          name: `${label} Nuvens Altas (> 6 km)`,
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
          name: 'Nuvens Baixas (0–2 km)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.16 },
          lineStyle: { width: 2, color: '#64748b' },
          itemStyle: { color: '#64748b' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.lowPct.mean, 0)),
        },
        {
          name: 'Nuvens Médias (2–6 km)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.14 },
          lineStyle: { width: 2, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.midPct.mean, 0)),
        },
        {
          name: 'Nuvens Altas (> 6 km)',
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
        name: '% Nuvens',
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
    { id: 'all', label: 'Todos Visíveis', Icon: LayoutGrid },
    { id: 'wind', label: 'Vento & Rajada', Icon: Wind },
    { id: 'temperature', label: 'Temperatura', Icon: Thermometer },
    { id: 'rain', label: 'Chuva & Pressão', Icon: CloudRain },
    { id: 'waves', label: 'Ondas & Swell', Icon: Waves },
    { id: 'clouds', label: 'Nuvens', Icon: Cloud },
    { id: 'vertical', label: 'Perfil Vertical', Icon: Compass },
  ];

  return (
    <section aria-label="Gráficos Horários Interativos" className="space-y-4">
      {/* Climatempo-style Rounded Pill Selector Bar for Hourly Charts */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
            Gráfico Hora a Hora
          </h2>
          <span className="text-xs text-slate-500 dark:text-sky-200/75 hidden sm:inline">
            • Escolha um parâmetro em destaque ou veja o painel combinado
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
                    Vento 10m, Faixa de Oscilação &amp; Rajadas (km/h)
                  </h3>
                </div>
                <HelpPopover topic="ensemble_vs_native" />
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  option={windTimeSeriesOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
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
                      Perfil Vertical (0–120m)
                    </h3>
                    {showInterpolatedProfile && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0070b8] dark:bg-sky-900 dark:text-sky-200">
                        Estimado
                      </span>
                    )}
                    {isCurrentHourInRange && currentHourBadge && (
                      <span
                        data-testid="vertical-profile-current-badge"
                        className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                      >
                        Agora: {currentHourBadge}
                      </span>
                    )}
                  </div>
                  <HelpPopover topic="vertical_profile" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-sky-200">
                  <span>
                    Horário: <strong>{xLabels[safeSelectedIdx] ?? 'Agora'}</strong>
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
                          Ir para Agora
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
                    aria-label="Selecionar hora para inspecionar perfil vertical de vento"
                    className="w-full accent-[#0080cd] cursor-pointer"
                  />
                )}
              </div>

              <div className="h-64 sm:h-72 min-h-[256px] w-full shrink-0">
                <ReactECharts
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
                    Temperatura &amp; Ponto de Orvalho (°C)
                  </h3>
                </div>
                <HelpPopover topic="fog_risk" />
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  option={temperatureOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
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
                    Chuva Horária (mm/h) &amp; Pressão Atmosférica (hPa)
                  </h3>
                </div>
                <HelpPopover topic="barometric_trend" />
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  option={precipPressureOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
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
                    Ondas, Ondulação (Swell) &amp; Período
                  </h3>
                </div>
                <HelpPopover topic="waves_swell" />
              </div>

              {forecast.marineAvailable ? (
                <div className="h-72 sm:h-80 min-h-[288px] w-full">
                  <ReactECharts
                    option={marineOption}
                    style={{ height: '100%', minHeight: '288px', width: '100%' }}
                    notMerge={true}
                    lazyUpdate={true}
                  />
                </div>
              ) : (
                <div className="min-h-[220px] rounded-2xl border border-dashed border-sky-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36]/60 p-6 flex flex-col items-center justify-center text-center space-y-2">
                  <div className="p-2.5 rounded-2xl bg-sky-100 dark:bg-sky-900/60 text-[#0080cd] dark:text-sky-300">
                    <Mountain className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-white">
                    Localidade Continental (Sem Grade Marítima)
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-sky-200/80 max-w-md leading-relaxed">
                    Esta coordenada fica em terra firme. Você pode ocultar &ldquo;Ondas &amp; Swell&rdquo; na barra de parâmetros acima para deixar a tela ainda mais limpa.
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
                    Nebulosidade por Altitude (Baixa • Média • Alta)
                  </h3>
                </div>
                <HelpPopover topic="stratified_clouds" />
              </div>
              <div className="h-72 sm:h-80 w-full">
                <ReactECharts
                  option={cloudCoverOption}
                  style={{ height: '100%', width: '100%' }}
                  notMerge={true}
                  lazyUpdate={true}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
