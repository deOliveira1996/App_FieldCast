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
  onSelectHourIndex?: (index: number) => void;
  isDark?: boolean;
  visibleParams?: ForecastVisibleParams;
}

const MODEL_LABELS: Record<WeatherModelId, string> = {
  ecmwf_ifs025: 'ECMWF IFS 0.25°',
  gfs_seamless: 'NOAA GFS',
  icon_seamless: 'DWD ICON',
};

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

export const ForecastCharts: React.FC<ForecastChartsProps> = ({
  forecast,
  viewMode,
  showInterpolatedProfile,
  horizonHours,
  selectedHourIndex,
  onSelectHourIndex,
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

  const textColor = isDark ? '#cbd5e1' : '#475569';
  const gridBorderColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.22)';
  const tooltipBg = isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)';
  const tooltipBorder = isDark ? '#334155' : '#bae6fd';
  const tooltipText = isDark ? '#f8fafc' : '#0f172a';

  const xLabels = useMemo(
    () => slicedHours.map((h) => formatAxisHour(h.timestampUnix, forecast.timezone)),
    [slicedHours, forecast.timezone],
  );

  const includeAltitudeInWindChart =
    visibleParams.verticalProfile || focusTab === 'vertical';

  // 1A. Hourly Wind & Gusts Time-Series Chart Option
  const windTimeSeriesOption: EChartsOption = useMemo(() => {
    const isNativeModel =
      viewMode === 'ecmwf_ifs025' || viewMode === 'gfs_seamless' || viewMode === 'icon_seamless';
    const nativeHours: NativeModelHour[] = isNativeModel
      ? (forecast.nativeByModel[viewMode] ?? []).slice(0, horizonHours)
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
      const ecmwf = (forecast.nativeByModel.ecmwf_ifs025 ?? []).slice(0, horizonHours);
      const gfs = (forecast.nativeByModel.gfs_seamless ?? []).slice(0, horizonHours);
      const icon = (forecast.nativeByModel.icon_seamless ?? []).slice(0, horizonHours);

      series.push(
        {
          name: 'ECMWF 10m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: '#0080cd' },
          itemStyle: { color: '#0080cd' },
          data: ecmwf.map((h) => roundOrNull(h.windSpeed10m)),
        },
        {
          name: 'GFS 10m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: '#10b981' },
          itemStyle: { color: '#10b981' },
          data: gfs.map((h) => roundOrNull(h.windSpeed10m)),
        },
        {
          name: 'ICON 10m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: '#6366f1' },
          itemStyle: { color: '#6366f1' },
          data: icon.map((h) => roundOrNull(h.windSpeed10m)),
        },
        {
          name: 'Consenso FieldCast 10m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, type: 'dotted', color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: slicedHours.map((h) => roundOrNull(h.windSpeed10m.mean)),
        },
      );
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
        if (viewMode === 'ecmwf_ifs025') {
          series.push({
            name: `${label} Vento 100m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 2, color: '#6366f1' },
            itemStyle: { color: '#6366f1' },
            data: nativeHours.map((h) => roundOrNull(h.windSpeed100m)),
          });
        } else {
          series.push(
            {
              name: `${label} Vento 80m`,
              type: 'line',
              smooth: true,
              symbol: 'none',
              lineStyle: { width: 1.8, color: '#38bdf8' },
              itemStyle: { color: '#38bdf8' },
              data: nativeHours.map((h) => roundOrNull(h.windSpeed80m)),
            },
            {
              name: `${label} Vento 120m`,
              type: 'line',
              smooth: true,
              symbol: 'none',
              lineStyle: { width: 1.8, color: '#0d9488' },
              itemStyle: { color: '#0d9488' },
              data: nativeHours.map((h) => roundOrNull(h.windSpeed120m)),
            },
          );
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
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 38,
        left: 44,
        right: 18,
        bottom: 36,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10 },
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
    forecast.nativeByModel,
    horizonHours,
    slicedHours,
    isDark,
    includeAltitudeInWindChart,
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
  ]);

  // 1B. Temperature & Dew Point Chart Option (Climatempo style)
  const temperatureOption: EChartsOption = useMemo(
    () => ({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 38,
        left: 44,
        right: 18,
        bottom: 36,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: {
        type: 'value',
        name: '°C',
        nameTextStyle: { color: textColor, fontSize: 11 },
        axisLabel: { color: textColor, fontSize: 10, formatter: '{value}°' },
        splitLine: { lineStyle: { color: gridBorderColor } },
      },
      series: [
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
      ],
    }),
    [slicedHours, isDark, tooltipBg, tooltipBorder, tooltipText, textColor, xLabels, gridBorderColor],
  );

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
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 38,
        left: 52,
        right: 22,
        bottom: 36,
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
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 38,
        left: 44,
        right: 44,
        bottom: 36,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridBorderColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Altura (m)',
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridBorderColor } },
        },
        {
          type: 'value',
          name: 'Período (s)',
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
  ]);

  // 3. Precipitation (mm/h) & Surface Pressure (hPa)
  const precipPressureOption: EChartsOption = useMemo(() => {
    const pressures = slicedHours
      .map((h) => h.surfacePressureHpa.mean)
      .filter((v): v is number => v !== null);
    const minP = pressures.length > 0 ? Math.floor(Math.min(...pressures) - 3) : 995;
    const maxP = pressures.length > 0 ? Math.ceil(Math.max(...pressures) + 3) : 1030;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 38,
        left: 44,
        right: 52,
        bottom: 36,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10 },
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
      series: [
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
      ],
    };
  }, [slicedHours, tooltipBg, tooltipBorder, tooltipText, textColor, xLabels, gridBorderColor]);

  // 4. Stratified Cloud Cover (Baixa, Média e Alta — %)
  const cloudCoverOption: EChartsOption = useMemo(
    () => ({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText, fontSize: 12 },
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 38,
        left: 44,
        right: 18,
        bottom: 36,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10 },
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
      series: [
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
      ],
    }),
    [slicedHours, tooltipBg, tooltipBorder, tooltipText, textColor, xLabels, gridBorderColor],
  );

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

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-0.5">
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
              <div className="h-64 sm:h-72 w-full">
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
              className={`${
                showWindChart ? 'lg:col-span-1' : 'lg:col-span-3'
              } rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2 flex flex-col justify-between`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Compass className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Perfil Vertical (0–120m)
                    </h3>
                    {showInterpolatedProfile && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0070b8] dark:bg-sky-900 dark:text-sky-200">
                        Estimado
                      </span>
                    )}
                  </div>
                  <HelpPopover topic="vertical_profile" />
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-sky-200">
                  <span>
                    Horário: <strong>{xLabels[safeSelectedIdx] ?? 'Agora'}</strong>
                  </span>
                  <span className="font-mono">
                    α ={' '}
                    {activeHour?.verticalProfile.alpha !== null &&
                    activeHour?.verticalProfile.alpha !== undefined
                      ? activeHour.verticalProfile.alpha.toFixed(3)
                      : 'N/A'}
                  </span>
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

              <div className="h-56 sm:h-60 w-full">
                <ReactECharts
                  option={verticalProfileOption}
                  style={{ height: '100%', width: '100%' }}
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
            <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Thermometer className="w-5 h-5 text-orange-500" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Temperatura &amp; Ponto de Orvalho (°C)
                  </h3>
                </div>
                <HelpPopover topic="fog_risk" />
              </div>
              <div className="h-60 sm:h-64 w-full">
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
            <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CloudRain className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Chuva Horária (mm/h) &amp; Pressão Atmosférica (hPa)
                  </h3>
                </div>
                <HelpPopover topic="barometric_trend" />
              </div>
              <div className="h-60 sm:h-64 w-full">
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
            <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2 flex flex-col">
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
                <div className="h-60 sm:h-64 w-full flex-1">
                  <ReactECharts
                    option={marineOption}
                    style={{ height: '100%', width: '100%' }}
                    notMerge={true}
                    lazyUpdate={true}
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-[180px] rounded-2xl border border-dashed border-sky-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36]/60 p-6 flex flex-col items-center justify-center text-center space-y-2">
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
            <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Nebulosidade por Altitude (Baixa • Média • Alta)
                  </h3>
                </div>
                <HelpPopover topic="stratified_clouds" />
              </div>
              <div className="h-60 sm:h-64 w-full">
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
