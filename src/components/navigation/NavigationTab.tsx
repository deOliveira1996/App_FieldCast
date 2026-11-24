import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  AlertTriangle,
  Anchor,
  ArrowDown,
  ArrowUp,
  Clock,
  Compass,
  Crosshair,
  MapPin,
  Navigation,
  Waves,
  Wind,
} from 'lucide-react';
import type { ActiveCoordinates } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type { NormalizedForecast } from '../../types/weather';
import { extractTideExtrema } from '../../utils/droneFlightIndex';
import {
  formatLocalHourBadge,
  formatLocalYMD,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { safeAction } from '../../utils/safeAction';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { WindCompass } from '../field/WindCompass';
import { degreesToCardinalShort } from '../forecast/CurrentSummaryCard';

export interface NavigationTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  isDark?: boolean;
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
  onRequestGps,
  onOpenLocationsModal,
  simulatedCompassHeadingDeg = null,
  onToast,
  onErrorLog,
}) => {
  const hours = forecast?.hours ?? [];
  const currentHourIndex = useCurrentLocalHourIndex(hours, forecast?.timezone);
  const [selectedOffset, setSelectedOffset] = useState<number>(0);

  useEffect(() => {
    setSelectedOffset(0);
  }, [forecast?.locationKey]);

  const effectiveHourIndex = useMemo(() => {
    if (hours.length === 0) return 0;
    return Math.max(0, Math.min(hours.length - 1, currentHourIndex + selectedOffset));
  }, [currentHourIndex, hours.length, selectedOffset]);

  const activeHour = hours[effectiveHourIndex];
  const marine = activeHour?.marine ?? null;

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

  return (
    <div data-testid="navigation-tab" className="space-y-6 pb-8">
      {/* Cabeçalho Operacional de Navegação */}
      <section className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              <Anchor className="w-4 h-4" aria-hidden="true" />
              <span>Módulo de Navegação Marítima & Superfície</span>
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
                  Janela Local: {formatLocalYMD(new Date(activeHour.timestampUnix * 1000), forecast?.timezone)} ·{' '}
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

        {/* Navegação Temporal Rápida */}
        {hours.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-sky-800/50 flex flex-wrap items-center gap-2">
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
                Tábua de Marés Estimada & Ondulação
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Picos horários de Preia-mar / Baixa-mar (MSL) e vetor de corrente marinha
              </p>
            </div>
          </div>

          {forecast?.marineAvailable ? (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
              Área Costeira Ativa
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-sky-950/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-sky-800">
              Coordenada Continental
            </span>
          )}
        </div>

        {/* Aviso Obrigatório DHN / Marinha */}
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

        {forecast?.marineAvailable ? (
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
                  Período: {marine?.wavePeriod !== null && marine?.wavePeriod !== undefined ? `${marine.wavePeriod.toFixed(1)} s` : 'N/D'} ·{' '}
                  {degreesToCardinalShort(marine?.waveDirection)}
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
                  {marine?.oceanCurrentVelocity !== null && marine?.oceanCurrentVelocity !== undefined
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

            {/* Gráfico de Maré & Onda */}
            {hasMslSeries && chartSlice.length > 0 && (
              <div className="rounded-xl border border-slate-200/70 dark:border-sky-800/60 bg-slate-50/50 dark:bg-[#0f243d]/70 p-3">
                <ReactECharts option={tideChartOption} style={{ height: 240, width: '100%' }} />
              </div>
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
        )}
      </section>

      {/* Painel 2: Referência Vetorial de Superfície + Bússola */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <ModuleErrorBoundary moduleName="Bússola de Navegação e Vento" onErrorLog={onErrorLog}>
            <WindCompass
              windDirection10mDeg={activeHour?.windDirection10m.degree ?? null}
              windSpeed10mKmh={activeHour?.windSpeed10m.mean ?? null}
              waveDirectionDeg={marine?.waveDirection ?? null}
              waveHeightM={marine?.waveHeight ?? null}
              marineAvailable={forecast?.marineAvailable ?? false}
              simulatedHeadingDeg={simulatedCompassHeadingDeg}
              onToast={onToast}
              onErrorLog={onErrorLog}
            />
          </ModuleErrorBoundary>
        </div>

        <section
          aria-label="Resumo Vetorial de Superfície"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Vetor de Superfície (10m)
            </h3>
          </div>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#0f243d]">
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <Wind className="w-4 h-4 text-sky-500" />
                Vento 10m
              </span>
              <strong className="text-sm text-slate-900 dark:text-white">
                {activeHour?.windSpeed10m.mean !== null && activeHour?.windSpeed10m.mean !== undefined
                  ? `${activeHour.windSpeed10m.mean.toFixed(1)} km/h`
                  : 'N/D'}
              </strong>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#0f243d]">
              <span className="text-slate-600 dark:text-slate-300">Direção Verdadeira</span>
              <strong className="text-sm text-slate-900 dark:text-white">
                {degreesToCardinalShort(activeHour?.windDirection10m.degree)}{' '}
                {typeof activeHour?.windDirection10m.degree === 'number'
                  ? `(${Math.round(activeHour.windDirection10m.degree)}°)`
                  : ''}
              </strong>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#0f243d]">
              <span className="text-slate-600 dark:text-slate-300">Rajadas Máx 10m</span>
              <strong className="text-sm text-slate-900 dark:text-white">
                {activeHour?.windGusts10m.mean !== null && activeHour?.windGusts10m.mean !== undefined
                  ? `${activeHour.windGusts10m.mean.toFixed(1)} km/h`
                  : 'N/D'}
              </strong>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#0f243d]">
              <span className="text-slate-600 dark:text-slate-300">Visibilidade Superfície</span>
              <strong className="text-sm text-slate-900 dark:text-white">
                {activeHour?.visibilityM.mean !== null && activeHour?.visibilityM.mean !== undefined
                  ? `${(activeHour.visibilityM.mean / 1000).toFixed(1)} km`
                  : 'N/D'}
              </strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
