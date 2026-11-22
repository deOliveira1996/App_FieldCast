import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Cloud, CloudRain, Compass, Layers, Mountain, Waves, Wind } from 'lucide-react';
import type {
  EnsembleHour,
  ForecastViewMode,
  NativeModelHour,
  NormalizedForecast,
  WeatherModelId,
} from '../../types/weather';
import { HelpPopover } from '../common/HelpPopover';
import type { ForecastHorizonHours } from './ModelSelectorBar';

export interface ForecastChartsProps {
  forecast: NormalizedForecast;
  viewMode: ForecastViewMode;
  showInterpolatedProfile: boolean;
  horizonHours: ForecastHorizonHours;
  selectedHourIndex: number;
  onSelectHourIndex?: (index: number) => void;
  isDark?: boolean;
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
  isDark = true,
}) => {
  const slicedHours: EnsembleHour[] = useMemo(
    () => forecast.hours.slice(0, horizonHours),
    [forecast.hours, horizonHours],
  );

  const safeSelectedIdx = Math.min(
    Math.max(0, selectedHourIndex),
    Math.max(0, slicedHours.length - 1),
  );
  const activeHour: EnsembleHour | undefined = slicedHours[safeSelectedIdx];

  const textColor = isDark ? '#cbd5e1' : '#334155';
  const gridBorderColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(100, 116, 139, 0.2)';
  const tooltipBg = isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)';
  const tooltipBorder = isDark ? '#334155' : '#cbd5e1';
  const tooltipText = isDark ? '#f8fafc' : '#0f172a';

  const xLabels = useMemo(
    () => slicedHours.map((h) => formatAxisHour(h.timestampUnix, forecast.timezone)),
    [slicedHours, forecast.timezone],
  );

  // 1A. Hourly Wind & Gusts Time-Series Chart Option
  const windTimeSeriesOption: EChartsOption = useMemo(() => {
    const isNativeModel =
      viewMode === 'ecmwf_ifs025' || viewMode === 'gfs_seamless' || viewMode === 'icon_seamless';
    const nativeHours: NativeModelHour[] = isNativeModel
      ? (forecast.nativeByModel[viewMode] ?? []).slice(0, horizonHours)
      : [];

    const series: NonNullable<EChartsOption['series']> = [];

    if (viewMode === 'fieldcast') {
      // Uncertainty band (min to max) using stacked band technique
      const minValues = slicedHours.map((h) => roundOrNull(h.windSpeed10m.min ?? h.windSpeed10m.mean));
      const bandDiff = slicedHours.map((h) => {
        const minV = h.windSpeed10m.min;
        const maxV = h.windSpeed10m.max;
        if (minV === null || maxV === null) return 0;
        return roundOrNull(Math.max(0, maxV - minV)) ?? 0;
      });

      series.push(
        {
          name: 'Vento 10m Mín (Ensemble)',
          type: 'line',
          data: minValues,
          stack: 'wind_uncertainty',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          name: 'Faixa Incerteza 10m (Mín–Máx)',
          type: 'line',
          data: bandDiff,
          stack: 'wind_uncertainty',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: {
            color: isDark ? 'rgba(14, 165, 233, 0.22)' : 'rgba(2, 132, 199, 0.18)',
          },
          tooltip: { show: false },
        },
        {
          name: 'Vento 10m (Média FieldCast)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, color: '#0ea5e9' },
          itemStyle: { color: '#0ea5e9' },
          data: slicedHours.map((h) => roundOrNull(h.windSpeed10m.mean)),
        },
        {
          name: 'Rajadas 10m (Estrito 10m)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
          data: slicedHours.map((h) => roundOrNull(h.windGusts10m.mean)),
        },
        {
          name: 'Vento 80m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#818cf8' },
          itemStyle: { color: '#818cf8' },
          data: slicedHours.map((h) => roundOrNull(h.windSpeed80m.mean)),
        },
        {
          name: 'Vento 100m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#a855f7' },
          itemStyle: { color: '#a855f7' },
          data: slicedHours.map((h) => roundOrNull(h.windSpeed100m.mean)),
        },
        {
          name: 'Vento 120m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#ec4899' },
          itemStyle: { color: '#ec4899' },
          data: slicedHours.map((h) => roundOrNull(h.windSpeed120m.mean)),
        },
      );
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
          lineStyle: { width: 2, color: '#0ea5e9' },
          itemStyle: { color: '#0ea5e9' },
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
          lineStyle: { width: 2, color: '#a855f7' },
          itemStyle: { color: '#a855f7' },
          data: icon.map((h) => roundOrNull(h.windSpeed10m)),
        },
        {
          name: 'Média FieldCast 10m',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.5, type: 'dotted', color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
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
          lineStyle: { width: 2.5, color: '#0ea5e9' },
          itemStyle: { color: '#0ea5e9' },
          data: nativeHours.map((h) => roundOrNull(h.windSpeed10m)),
        },
        {
          name: `${label} Rajadas 10m`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
          data: nativeHours.map((h) => roundOrNull(h.windGusts10m)),
        },
      );

      if (viewMode === 'ecmwf_ifs025') {
        series.push({
          name: `${label} Vento 100m`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: '#a855f7' },
          itemStyle: { color: '#a855f7' },
          data: nativeHours.map((h) => roundOrNull(h.windSpeed100m)),
        });
      } else {
        series.push(
          {
            name: `${label} Vento 80m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: '#818cf8' },
            itemStyle: { color: '#818cf8' },
            data: nativeHours.map((h) => roundOrNull(h.windSpeed80m)),
          },
          {
            name: `${label} Vento 120m`,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1.8, color: '#ec4899' },
            itemStyle: { color: '#ec4899' },
            data: nativeHours.map((h) => roundOrNull(h.windSpeed120m)),
          },
        );
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
    tooltipBg,
    tooltipBorder,
    tooltipText,
    textColor,
    xLabels,
    gridBorderColor,
  ]);

  // 1B. Vertical Wind Profile (0-120m) Option for Selected Hour
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
        name: 'Níveis Nativos (10m/80m/100m/120m)',
        type: 'line',
        data: nativePts,
        symbolSize: 9,
        lineStyle: { width: 2.5, color: '#0ea5e9' },
        itemStyle: { color: '#0ea5e9' },
      },
    ];

    if (showInterpolatedProfile && interpPts.length > 0) {
      series.push({
        name: 'Curva Interpolada 10–120m (Estimado)',
        type: 'line',
        smooth: true,
        data: interpPts,
        symbolSize: 5,
        lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
        itemStyle: { color: '#f59e0b' },
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

  // 2. Waves & Swell Option (when marineAvailable === true)
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
          name: 'Altura Significativa de Onda (m)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: {
            color: isDark ? 'rgba(20, 184, 166, 0.2)' : 'rgba(13, 148, 136, 0.16)',
          },
          lineStyle: { width: 2.5, color: '#14b8a6' },
          itemStyle: { color: '#14b8a6' },
          data: slicedHours.map((h) => roundOrNull(h.marine?.waveHeight, 2)),
        },
        {
          name: 'Altura Swell (m)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#0ea5e9' },
          itemStyle: { color: '#0ea5e9' },
          data: slicedHours.map((h) => roundOrNull(h.marine?.swellWaveHeight, 2)),
        },
        {
          name: 'Período de Onda (s)',
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

  // 3. Precipitation (mm/h), Probability (%) & Surface Pressure (hPa)
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
          name: 'Precipitação (mm/h)',
          type: 'bar',
          itemStyle: { color: '#38bdf8', borderRadius: [3, 3, 0, 0] },
          data: slicedHours.map((h) => roundOrNull(h.precipitationMm.mean, 2)),
        },
        {
          name: 'Chuva Máx Ensemble (mm/h)',
          type: 'line',
          symbol: 'none',
          lineStyle: { width: 1, type: 'dotted', color: '#0284c7' },
          itemStyle: { color: '#0284c7' },
          data: slicedHours.map((h) => roundOrNull(h.precipitationMm.max, 2)),
        },
        {
          name: 'Pressão Superfície (hPa)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.2, color: '#f43f5e' },
          itemStyle: { color: '#f43f5e' },
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
          areaStyle: { opacity: 0.18 },
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
          lineStyle: { width: 2, color: '#38bdf8' },
          itemStyle: { color: '#38bdf8' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.midPct.mean, 0)),
        },
        {
          name: 'Nuvens Altas (> 6 km)',
          type: 'line',
          smooth: true,
          symbol: 'none',
          areaStyle: { opacity: 0.1 },
          lineStyle: { width: 2, color: '#a855f7' },
          itemStyle: { color: '#a855f7' },
          data: slicedHours.map((h) => roundOrNull(h.cloudCover.highPct.mean, 0)),
        },
      ],
    }),
    [slicedHours, tooltipBg, tooltipBorder, tooltipText, textColor, xLabels, gridBorderColor],
  );

  return (
    <section aria-label="Gráficos Horários Interativos Apache ECharts" className="space-y-4">
      {/* Row 1: Wind Time Series (2/3 width) + Vertical Wind Profile 0-120m (1/3 width) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Wind Time Series */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wind className="w-5 h-5 text-sky-500" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Vento (10m–120m), Banda de Incerteza & Rajadas (10m)
              </h2>
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

        {/* Vertical Wind Profile 0-120m for Active Hour */}
        <div className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2 flex flex-col justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-indigo-500" aria-hidden="true" />
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Perfil Vertical (0–120m)
                </h2>
                {showInterpolatedProfile && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/40">
                    Estimado
                  </span>
                )}
              </div>
              <HelpPopover topic="vertical_profile" />
            </div>

            {/* Interactive Hour Scrubber for Vertical Profile */}
            <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Hora: <strong>{xLabels[safeSelectedIdx] ?? 'Agora'}</strong>
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
                className="w-full accent-sky-600 cursor-pointer"
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
      </div>

      {/* Row 2: Waves/Swell (or Continental Notice) + Precipitation & Pressure */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Waves & Swell Panel */}
        <div className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2 flex flex-col">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Waves className="w-5 h-5 text-teal-500" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Ondas Significativas, Swell & Período
              </h2>
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
            <div className="flex-1 min-h-[200px] rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 p-6 flex flex-col items-center justify-center text-center space-y-2.5">
              <div className="p-3 rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <Mountain className="w-7 h-7" aria-hidden="true" />
              </div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                Localidade Continental Detectada (Sem Grade Oceanográfica)
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md leading-relaxed">
                A API Open-Meteo Marine identificou que esta coordenada está em terra firme (
                <code className="font-mono">marineAvailable: false</code>). O gráfico marinho foi
                desativado graciosamente e o Índice de Confiabilidade redistribuiu os pesos sem
                penalizar esta localidade.
              </p>
            </div>
          )}
        </div>

        {/* Precipitation & Surface Pressure Panel */}
        <div className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CloudRain className="w-5 h-5 text-sky-500" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Precipitação Horária (mm/h) & Pressão Barométrica (hPa)
              </h2>
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
      </div>

      {/* Row 3: Stratified Cloud Cover (Low / Mid / High) */}
      <div className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-indigo-400" aria-hidden="true" />
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
              Nebulosidade Estratificada Separada (Baixa 0–2km • Média 2–6km • Alta &gt;6km)
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />3 camadas atmosféricas
            </span>
            <HelpPopover topic="stratified_clouds" />
          </div>
        </div>
        <div className="h-56 sm:h-60 w-full">
          <ReactECharts
            option={cloudCoverOption}
            style={{ height: '100%', width: '100%' }}
            notMerge={true}
            lazyUpdate={true}
          />
        </div>
      </div>
    </section>
  );
};
