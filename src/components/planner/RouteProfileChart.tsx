import React, { useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Activity } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import type { RouteForecast4DResult } from '../../services/routeForecastService';
import type { ErrorLogRecord } from '../../types/health';
import {
  convertPrecipitation,
  convertWaveHeight,
  convertWindSpeed,
} from '../../utils/units';
import { CollapsibleModule } from '../common/CollapsibleModule';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import {
  formatCompactDistance,
  formatExactEtaHHMM,
  formatRouteStatusLabel,
  getStatusBadgeClasses,
} from './routeDisplayUtils';

const CAN_ATTACH_ECHARTS_REF =
  (typeof ReactECharts === 'function' &&
    Boolean(
      (ReactECharts as unknown as { prototype?: { isReactComponent?: unknown } }).prototype
        ?.isReactComponent,
    )) ||
  (typeof ReactECharts === 'object' && ReactECharts !== null);

export interface RouteProfileChartProps {
  forecastResult: RouteForecast4DResult;
  isDark?: boolean;
  selectedCheckpointIndex: number | null;
  onSelectCheckpoint?: (index: number) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

export const RouteProfileChart: React.FC<RouteProfileChartProps> = ({
  forecastResult,
  isDark = false,
  selectedCheckpointIndex,
  onSelectCheckpoint,
  onErrorLog,
}) => {
  const { isEn, tr } = useLocale();
  const { units, windLabel, waveLabel, precipLabel } = useUnits();
  const chartRef = useRef<ReactECharts | null>(null);

  const isNav = forecastResult.category === 'navigation';
  const altLabel = `${forecastResult.operationalAltitudeM}m`;

  const chartOption: EChartsOption = useMemo(() => {
    const textColor = isDark ? '#cbd5e1' : '#334155';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(148, 163, 184, 0.25)';
    const tooltipBg = isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)';

    const cps = forecastResult.checkpoints;

    const xLabels = cps.map((cp, idx) => {
      const eta = formatExactEtaHHMM(cp.etaUnix, cp.timezone);
      const dist = formatCompactDistance(
        cp.checkpoint.cumulativeDistanceKm,
        forecastResult.category,
        units.wind,
      );
      return `P${idx + 1} ${eta}\n${dist}`;
    });

    const windData = cps.map((cp) => {
      const v = convertWindSpeed(cp.operationalWindKmh, units.wind);
      return v !== null ? Number(v.toFixed(1)) : null;
    });

    const gustData = cps.map((cp) => {
      const v = convertWindSpeed(cp.windGusts10mKmh, units.wind);
      return v !== null ? Number(v.toFixed(1)) : null;
    });

    const rainProbData = cps.map((cp) =>
      cp.precipitationProbabilityPct !== null ? Math.round(cp.precipitationProbabilityPct) : null,
    );

    const rainMmData = cps.map((cp) => {
      const v = convertPrecipitation(cp.precipitationMm, units.precipitation);
      return v !== null ? Number(v.toFixed(units.precipitation === 'in' ? 2 : 1)) : null;
    });

    const waveData = cps.map((cp) => {
      const v = convertWaveHeight(cp.waveHeightM, units.wave);
      return v !== null ? Number(v.toFixed(units.wave === 'ft' ? 1 : 2)) : null;
    });

    const demElevData = cps.map((cp) => {
      const v = convertWaveHeight(cp.elevationDemM, units.wave);
      return v !== null ? Math.round(v) : null;
    });

    const windSeriesName = isNav
      ? `${tr('Vento 10m', '10m Wind')} (${windLabel})`
      : `${tr('Vento', 'Wind')} ${altLabel} (${windLabel})`;
    const gustSeriesName = `${tr('Rajadas 10m', '10m Gusts')} (${windLabel})`;
    const rainProbSeriesName = tr('Prob. Chuva (%)', 'Rain Prob (%)');
    const secondarySeriesName = isNav
      ? `${tr('Onda Hs', 'Wave Hs')} (${waveLabel})`
      : `${tr('Elevação DEM', 'DEM Elevation')} (${waveLabel})`;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: isDark ? '#334155' : '#bae6fd',
        textStyle: { color: isDark ? '#f8fafc' : '#0f172a', fontSize: 12 },
        formatter: (params: unknown) => {
          const items = Array.isArray(params)
            ? (params as Array<{ dataIndex?: number; seriesName?: string; value?: unknown; color?: string }>)
            : [];
          const idx = items[0]?.dataIndex ?? 0;
          const cp = cps[idx];
          if (!cp) return '';
          const eta = formatExactEtaHHMM(cp.etaUnix, cp.timezone);
          const dist = formatCompactDistance(
            cp.checkpoint.cumulativeDistanceKm,
            forecastResult.category,
            units.wind,
          );
          const precipVal = rainMmData[idx];
          const lines = [
            `<strong>P${idx + 1} · ${cp.checkpoint.label}</strong> (${dist} @ ${eta})`,
          ];
          for (const it of items) {
            const valStr =
              it.value !== null && it.value !== undefined && it.value !== ''
                ? String(it.value)
                : '—';
            lines.push(
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${it.color ?? '#0284c7'};margin-right:6px;"></span>${it.seriesName}: <strong>${valStr}</strong>`,
            );
          }
          if (precipVal !== null) {
            lines.push(
              `${tr('Precipitação', 'Precipitation')}: <strong>${precipVal} ${precipLabel}/h</strong>`,
            );
          }
          if (!isNav && cp.windShearKtPer100ft !== null) {
            lines.push(`Wind Shear: <strong>${cp.windShearKtPer100ft.toFixed(1)} kt/100ft</strong>`);
          }
          if (isNav && cp.seaLevelHeightMslM !== null) {
            const msl = convertWaveHeight(cp.seaLevelHeightMslM, units.wave);
            lines.push(
              `${tr('Maré Est. MSL', 'Est. Tide MSL')}: <strong>${msl !== null ? msl.toFixed(2) : '—'} ${waveLabel}</strong>`,
            );
          }
          return lines.join('<br/>');
        },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 44,
        left: 14,
        right: 18,
        bottom: 34,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: {
          color: textColor,
          fontSize: 10,
          lineHeight: 13,
          interval: 0,
          hideOverlap: true,
        },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: windLabel,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor } },
        },
        {
          type: 'value',
          name: waveLabel,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          show: false,
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: windSeriesName,
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2.6, color: '#0284c7' },
          itemStyle: { color: '#0284c7' },
          data: windData,
        },
        {
          name: gustSeriesName,
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
          itemStyle: { color: '#f59e0b' },
          data: gustData,
        },
        {
          name: secondarySeriesName,
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2.2, color: isNav ? '#0d9488' : '#10b981' },
          areaStyle: {
            color: isNav ? 'rgba(13, 148, 136, 0.14)' : 'rgba(16, 185, 129, 0.18)',
          },
          itemStyle: { color: isNav ? '#0d9488' : '#10b981' },
          data: isNav ? waveData : demElevData,
        },
        {
          name: rainProbSeriesName,
          type: 'bar',
          yAxisIndex: 2,
          barMaxWidth: 18,
          itemStyle: {
            color: 'rgba(56, 189, 248, 0.35)',
            borderRadius: [4, 4, 0, 0],
          },
          data: rainProbData,
        },
      ],
    };
  }, [altLabel, forecastResult, isDark, isNav, precipLabel, tr, units.precipitation, units.wave, units.wind, waveLabel, windLabel]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      try {
        chartRef.current?.getEchartsInstance?.()?.resize?.();
      } catch {
        // Ignora durante desmontagem
      }
    };
    window.addEventListener('resize', handleRefresh);
    window.addEventListener('fieldcast:layout-refresh', handleRefresh);
    return () => {
      window.removeEventListener('resize', handleRefresh);
      window.removeEventListener('fieldcast:layout-refresh', handleRefresh);
    };
  }, []);

  const echartsRefProps = CAN_ATTACH_ECHARTS_REF
    ? {
        ref: (instance: ReactECharts | null) => {
          chartRef.current = instance;
        },
      }
    : {};

  const chartEvents = useMemo(
    () =>
      onSelectCheckpoint
        ? {
            click: (params: { dataIndex?: number }) => {
              if (typeof params?.dataIndex === 'number') {
                onSelectCheckpoint(params.dataIndex);
              }
            },
          }
        : undefined,
    [onSelectCheckpoint],
  );

  return (
    <CollapsibleModule
      testId="route-profile-chart-module"
      storageKey="fieldcast_planner_chart_open_v43"
      defaultOpen={true}
      keepMounted={true}
      icon={<Activity className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
      title={tr('Perfil Meteorológico 4D da Rota', '4D Route Weather Profile')}
      subtitle={
        isNav
          ? tr(
              `Vento 10m, Rajadas (${windLabel}), Onda Hs (${waveLabel}) e Chuva ao longo dos checkpoints`,
              `10m Wind, Gusts (${windLabel}), Wave Hs (${waveLabel}) and Rain along checkpoints`,
            )
          : tr(
              `Vento ${altLabel}, Rajadas (${windLabel}), Elevação DEM (${waveLabel}) e Chuva ao longo dos checkpoints`,
              `${altLabel} Wind, Gusts (${windLabel}), DEM Elevation (${waveLabel}) and Rain along checkpoints`,
            )
      }
    >
      <ModuleErrorBoundary
        moduleName={tr('Gráfico de Perfil 4D da Rota', '4D Route Profile Chart')}
        onErrorLog={onErrorLog}
      >
        <div className="space-y-3">
          {/* Pílulas clicáveis de status P1..Pn */}
          <div className="flex flex-wrap items-center gap-1.5">
            {forecastResult.checkpoints.map((cp, idx) => {
              const style = getStatusBadgeClasses(cp.status);
              const isSelected = selectedCheckpointIndex === idx;
              return (
                <button
                  key={`pill-cp-${idx}`}
                  type="button"
                  onClick={() => onSelectCheckpoint?.(idx)}
                  className={`min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-lg text-[11px] font-bold border inline-flex items-center justify-center gap-1.5 transition-all ${
                    style.pill
                  } ${isSelected ? 'ring-2 ring-[#0080cd] ring-offset-1 dark:ring-offset-[#132a47]' : ''}`}
                  title={`${cp.checkpoint.label} — ${formatRouteStatusLabel(cp.status, isEn)}`}
                >
                  <span className={`w-2 h-2 rounded-full ${style.dot}`} aria-hidden="true" />
                  <span>P{idx + 1}</span>
                  <span className="font-mono font-normal opacity-85">
                    {formatExactEtaHHMM(cp.etaUnix, cp.timezone)}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            data-chart-id="route-4d-profile"
            className="w-full h-[290px] sm:h-[320px] min-h-[280px]"
          >
            <ReactECharts
              {...echartsRefProps}
              option={chartOption}
              onEvents={chartEvents}
              style={{ width: '100%', height: '100%', minHeight: 280 }}
              notMerge={true}
              lazyUpdate={true}
            />
          </div>
        </div>
      </ModuleErrorBoundary>
    </CollapsibleModule>
  );
};

export default RouteProfileChart;
