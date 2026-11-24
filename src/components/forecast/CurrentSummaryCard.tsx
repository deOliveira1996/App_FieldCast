import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudRain,
  Compass,
  Droplets,
  Gauge,
  Map as MapIcon,
  Moon,
  Mountain,
  ShieldCheck,
  Sliders,
  Star,
  Sun,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import type { ActiveCoordinates } from '../../types/field';
import type {
  ConfidenceBadgeColor,
  EnsembleHour,
  NormalizedForecast,
  SafeWindowStatus,
} from '../../types/weather';
import {
  formatLocalHourBadge,
  formatLocalYMD,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { safeAction } from '../../utils/safeAction';
import { HelpPopover } from '../common/HelpPopover';
import {
  COMPLETE_VISIBLE_PARAMS,
  type ForecastVisibleParams,
} from './forecastParamsVisibility';

export interface CurrentSummaryCardProps {
  forecast: NormalizedForecast;
  activeLocation: ActiveCoordinates;
  selectedHourIndex?: number;
  onResetToCurrentHour?: () => void;
  onOpenThresholdModal: () => void;
  onOpenLocationsModal?: () => void;
  visibleParams?: ForecastVisibleParams;
  isMiniMapOpen?: boolean;
  onToggleMiniMap?: () => void;
  isPrimaryLocation?: boolean;
  onSetPrimaryLocation?: (coords: {
    latitude: number;
    longitude: number;
    name: string;
    origin?: ActiveCoordinates['origin'];
  }) => void | Promise<void>;
}

const CONFIDENCE_COLOR_STYLES: Record<
  ConfidenceBadgeColor,
  {
    badge: string;
    dot: string;
    label: string;
  }
> = {
  green: {
    badge:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/60 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Alta Confiabilidade',
  },
  amber: {
    badge:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-200',
    dot: 'bg-amber-500',
    label: 'Confiabilidade Moderada',
  },
  red: {
    badge:
      'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-700/60 dark:bg-rose-950/60 dark:text-rose-200',
    dot: 'bg-rose-500',
    label: 'Divergência entre Modelos',
  },
};

const SAFE_WINDOW_STYLES: Record<
  SafeWindowStatus,
  {
    container: string;
    dot: string;
    title: string;
  }
> = {
  green: {
    container:
      'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/50 dark:text-emerald-100',
    dot: 'bg-emerald-500',
    title: 'Janela Favorável',
  },
  amber: {
    container:
      'border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-100',
    dot: 'bg-amber-500',
    title: 'Atenção Moderada',
  },
  red: {
    container:
      'border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-700/60 dark:bg-rose-950/50 dark:text-rose-100',
    dot: 'bg-rose-500',
    title: 'Acima dos Limites',
  },
};

export function degreesToCardinalShort(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(deg)) {
    return '—';
  }
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return directions[index] ?? 'N';
}

function formatTimeHHMM(isoString: string | null | undefined, timezone?: string): string {
  if (!isoString) {
    return '—';
  }
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) {
      return isoString.slice(11, 16) || '00:00';
    }
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return isoString.slice(11, 16) || '00:00';
  }
}

function formatHourDateTimeLabel(hour: EnsembleHour | undefined, timezone?: string): string {
  if (!hour) {
    return 'Agora';
  }
  try {
    const d = new Date(hour.timestampUnix * 1000);
    return d.toLocaleString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return hour.timestampIso;
  }
}

export const CurrentSummaryCard: React.FC<CurrentSummaryCardProps> = ({
  forecast,
  activeLocation,
  selectedHourIndex,
  onResetToCurrentHour,
  onOpenThresholdModal,
  onOpenLocationsModal,
  visibleParams = COMPLETE_VISIBLE_PARAMS,
  isMiniMapOpen,
  onToggleMiniMap,
  isPrimaryLocation = false,
  onSetPrimaryLocation,
}) => {
  const [showConfidenceDetails, setShowConfidenceDetails] = useState(false);
  const [isSettingPrimary, setIsSettingPrimary] = useState(false);

  const currentLocalHourIndex = useCurrentLocalHourIndex(forecast.hours, forecast.timezone);
  const resolvedHourIndex = selectedHourIndex ?? currentLocalHourIndex;

  const safeIndex = Math.min(
    Math.max(0, resolvedHourIndex),
    Math.max(0, forecast.hours.length - 1),
  );
  const currentHour: EnsembleHour | undefined = forecast.hours[safeIndex];
  const isCurrentLocalHour = safeIndex === currentLocalHourIndex;
  const displayedHourHHMM = currentHour
    ? formatLocalHourBadge(currentHour.timestampUnix, forecast.timezone)
    : '00:00';
  const currentLocalHourObj = forecast.hours[currentLocalHourIndex];
  const currentLocalHHMM = currentLocalHourObj
    ? formatLocalHourBadge(currentLocalHourObj.timestampUnix, forecast.timezone)
    : displayedHourHHMM;

  const confidence = currentHour?.confidence ?? forecast.overallConfidence;
  const confStyle = CONFIDENCE_COLOR_STYLES[confidence.badge] ?? CONFIDENCE_COLOR_STYLES.amber;

  const safeWindowStatus: SafeWindowStatus = currentHour?.safeWindow ?? 'green';
  const safeStyle = SAFE_WINDOW_STYLES[safeWindowStatus] ?? SAFE_WINDOW_STYLES.green;

  const updatedAtHHMM = formatTimeHHMM(forecast.fetchedAtIso, forecast.timezone);

  // Compute Day Min & Max Temperature across 24h window around selected hour
  const dayTempStats = useMemo(() => {
    const startIdx = Math.floor(safeIndex / 24) * 24;
    const windowHours = forecast.hours.slice(startIdx, startIdx + 24);
    const temps = (windowHours.length > 0 ? windowHours : forecast.hours.slice(0, 24))
      .map((h) => h.temperature2mC.mean)
      .filter((v): v is number => v !== null && !Number.isNaN(v));
    if (temps.length === 0) {
      return { min: null, max: null };
    }
    return {
      min: Math.round(Math.min(...temps)),
      max: Math.round(Math.max(...temps)),
    };
  }, [forecast.hours, safeIndex]);

  const activeEphemeris = useMemo(() => {
    if (currentHour) {
      const hourYmd = formatLocalYMD(new Date(currentHour.timestampUnix * 1000), forecast.timezone);
      const matched = forecast.ephemerisByDay.find((day) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day.dateIso)) {
          return day.dateIso === hourYmd;
        }
        const parsed = new Date(day.dateIso);
        const dayYmd = Number.isNaN(parsed.getTime())
          ? day.dateIso.slice(0, 10)
          : formatLocalYMD(parsed, forecast.timezone);
        return dayYmd === hourYmd || day.dateIso.slice(0, 10) === hourYmd;
      });
      if (matched) {
        return matched;
      }
    }
    return forecast.ephemerisByDay[Math.floor(safeIndex / 24)] ?? forecast.ephemerisByDay[0];
  }, [currentHour, forecast.ephemerisByDay, forecast.timezone, safeIndex]);

  const windCardDir = degreesToCardinalShort(currentHour?.windDirection10m.degree);
  const windSpd =
    currentHour?.windSpeed10m.mean !== null && currentHour?.windSpeed10m.mean !== undefined
      ? Math.round(currentHour.windSpeed10m.mean)
      : null;
  const gustSpd =
    currentHour?.windGusts10m.mean !== null && currentHour?.windGusts10m.mean !== undefined
      ? Math.round(currentHour.windGusts10m.mean)
      : null;

  return (
    <section
      aria-label="Resumo Atual, Confiabilidade e Semáforo Operacional"
      className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] shadow-sm p-5 sm:p-6 space-y-5"
    >
      {/* Top Header Row: Climatempo Clean Title + Map Pin Button + Confidence & Semaphore Pills */}
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            {onOpenLocationsModal ? (
              <button
                type="button"
                onClick={onOpenLocationsModal}
                className="group inline-flex items-center gap-2 text-left rounded-xl hover:text-[#0080cd] transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 min-w-0"
              >
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white group-hover:text-[#0080cd] dark:group-hover:text-sky-300 leading-tight">
                  Previsão para {activeLocation.name}
                </h1>
              </button>
            ) : (
              <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white leading-tight">
                Previsão para {activeLocation.name}
              </h1>
            )}

            {onToggleMiniMap && (
              <button
                type="button"
                onClick={onToggleMiniMap}
                aria-expanded={isMiniMapOpen}
                className={`min-h-[34px] px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 border shrink-0 transition-all ${
                  isMiniMapOpen
                    ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                    : 'bg-sky-50 dark:bg-sky-900/50 hover:bg-sky-100 text-[#0070b8] dark:text-sky-200 border-sky-200 dark:border-sky-700'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isMiniMapOpen ? 'Ocultar Mapa Pin' : 'Dar Pin no Mapa'}</span>
              </button>
            )}

            {isPrimaryLocation ? (
              <span
                data-testid="primary-location-badge"
                className="min-h-[44px] px-3.5 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 border bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700/70 shrink-0"
              >
                <Star
                  className="w-3.5 h-3.5 fill-emerald-500 text-emerald-600 dark:text-emerald-300"
                  aria-hidden="true"
                />
                <span>Área Principal Salva</span>
              </span>
            ) : onSetPrimaryLocation ? (
              <button
                type="button"
                data-testid="set-primary-location-btn"
                disabled={isSettingPrimary}
                onClick={() => {
                  void safeAction(
                    async () => {
                      await onSetPrimaryLocation({
                        latitude: activeLocation.latitude,
                        longitude: activeLocation.longitude,
                        name: activeLocation.name,
                        origin: activeLocation.origin,
                      });
                    },
                    {
                      actionKey: 'set_primary_location_summary_card',
                      moduleName: 'CurrentSummaryCard',
                      errorTitle: 'Não foi possível definir a área principal',
                      onLoadingChange: setIsSettingPrimary,
                    },
                  );
                }}
                className="min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 border shrink-0 transition-all bg-white dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-[#0070b8] dark:text-sky-200 border-sky-200 dark:border-sky-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <Star className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                <span>Definir como Área Principal</span>
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              data-testid="current-hour-badge"
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                isCurrentLocalHour
                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700/70'
                  : 'bg-sky-50 dark:bg-sky-900/60 text-[#0070b8] dark:text-sky-200 border-sky-200 dark:border-sky-700'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isCurrentLocalHour ? 'bg-amber-500' : 'bg-[#0080cd]'
                }`}
                aria-hidden="true"
              />
              <span>
                {isCurrentLocalHour
                  ? `Agora • ${displayedHourHHMM}`
                  : `Visualizando ${displayedHourHHMM}`}
              </span>
            </span>

            {!isCurrentLocalHour && onResetToCurrentHour && (
              <button
                type="button"
                onClick={onResetToCurrentHour}
                data-testid="reset-current-hour-btn"
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors"
              >
                Voltar para Agora ({currentLocalHHMM})
              </button>
            )}

            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-[#0d1f36] text-slate-600 dark:text-sky-200">
              <Mountain className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
              <span>Alt. {Math.round(forecast.elevationDemM)}m</span>
            </span>

            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-[#0d1f36] text-slate-500 dark:text-sky-200/80">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Atualizado {updatedAtHHMM}</span>
            </span>
          </div>

          <p className="text-xs text-slate-500 dark:text-sky-200/80 capitalize">
            {formatHourDateTimeLabel(currentHour, forecast.timezone)} •{' '}
            <span className="normal-case">
              Lat {forecast.latitude.toFixed(3)}°, Lon {forecast.longitude.toFixed(3)}°
            </span>
          </p>
        </div>

        {/* Right Status Pills: Unified-Height Single-Border Confidence + Safe Window + Limits */}
        <div
          data-testid="summary-header-badges"
          className="flex flex-wrap items-center gap-2.5 shrink-0"
        >
          <div
            className={`min-h-[42px] max-w-full inline-flex items-center rounded-xl border px-2 py-1 gap-1.5 ${confStyle.badge}`}
          >
            <button
              type="button"
              onClick={() => setShowConfidenceDetails((prev) => !prev)}
              aria-expanded={showConfidenceDetails}
              className="min-h-[34px] px-1.5 py-0.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 min-w-0"
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${confStyle.dot}`} />
              <span className="sm:whitespace-nowrap text-left">
                Confiança {Math.round(confidence.total)}% • {confStyle.label}
              </span>
              {showConfidenceDetails ? (
                <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
            <HelpPopover topic="confidence" />
          </div>

          <div
            className={`min-h-[42px] max-w-full inline-flex items-center rounded-xl border px-2 py-1 gap-1.5 ${safeStyle.container}`}
          >
            <div className="px-1.5 py-0.5 flex items-center gap-2 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${safeStyle.dot}`} />
              <span className="text-xs font-bold sm:whitespace-nowrap">{safeStyle.title}</span>
            </div>

            <button
              type="button"
              onClick={onOpenThresholdModal}
              aria-label="Configurar limites do Semáforo de Janela Segura"
              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-white dark:bg-[#132a47] hover:bg-sky-50 text-slate-700 dark:text-sky-100 border border-slate-200 dark:border-sky-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors shrink-0"
            >
              <Sliders className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
              <span>Limites</span>
            </button>
            <HelpPopover topic="safe_window" />
          </div>
        </div>
      </div>

      {/* Expandable Confidence Score Breakdown */}
      {showConfidenceDetails && (
        <div
          role="region"
          aria-label="Detalhamento do Índice de Confiabilidade"
          className="rounded-xl border border-sky-100 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-800 dark:text-sky-100 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#0080cd]" />
              <span>Composição da Confiabilidade ({Math.round(confidence.total)}/100 pontos)</span>
            </h3>
            {confidence.isContinental && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 dark:bg-sky-900 text-[#0070b8] dark:text-sky-200">
                Ponto Continental (pesos adaptados para terra firme)
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl bg-white dark:bg-[#132a47] p-3 border border-slate-200/70 dark:border-sky-800">
              <span className="text-slate-500 dark:text-sky-200/75 block">Acordo entre Modelos</span>
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.modelAgreement.toFixed(1)} / 50 pts
              </span>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#132a47] p-3 border border-slate-200/70 dark:border-sky-800">
              <span className="text-slate-500 dark:text-sky-200/75 block">Qualidade das Fontes</span>
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.sourceIntegrity.toFixed(1)} / 30 pts
              </span>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#132a47] p-3 border border-slate-200/70 dark:border-sky-800">
              <span className="text-slate-500 dark:text-sky-200/75 block">Proximidade Temporal</span>
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.timeHorizon.toFixed(1)} / 20 pts
              </span>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#132a47] p-3 border border-slate-200/70 dark:border-sky-800">
              <span className="text-slate-500 dark:text-sky-200/75 block">Gradiente Vertical</span>
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                {confidence.breakdown.shearPenalty > 0
                  ? `-${confidence.breakdown.shearPenalty.toFixed(1)} pts`
                  : 'Estável'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Climatempo-Style Clean Ice-Blue Summary Grid (#f4f8fb) with Padded Responsive Cards */}
      {currentHour && (
        <div className="rounded-2xl bg-[#f4f8fb] dark:bg-[#0d1f36]/85 border border-sky-100/80 dark:border-sky-800/60 p-3.5 sm:p-4">
          <div
            data-testid="summary-metrics-grid"
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5"
          >
            {/* Block 1: Temperatura (Min in Blue, Max in Orange) + Sensação/Orvalho */}
            {visibleParams.tempVisibility && (
              <div
                data-testid="summary-card-temperature"
                className="rounded-xl border border-slate-200/85 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 min-h-[84px] flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Thermometer className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                      Temperatura
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                      Agora:{' '}
                      <strong className="text-slate-800 dark:text-white">
                        {currentHour.temperature2mC.mean !== null
                          ? `${currentHour.temperature2mC.mean.toFixed(1)}°C`
                          : '—'}
                      </strong>{' '}
                      • Orvalho{' '}
                      {currentHour.dewPoint2mC.mean !== null
                        ? `${currentHour.dewPoint2mC.mean.toFixed(0)}°`
                        : '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-base font-extrabold shrink-0">
                  <span
                    title="Mínima do dia"
                    className="inline-flex items-center gap-0.5 text-[#0080cd] dark:text-sky-400"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    {dayTempStats.min !== null ? `${dayTempStats.min}°` : '—'}
                  </span>
                  <span
                    title="Máxima do dia"
                    className="inline-flex items-center gap-0.5 text-orange-500 dark:text-orange-400"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                    {dayTempStats.max !== null ? `${dayTempStats.max}°` : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Block 2: Chuva (mm + % de chance) */}
            {visibleParams.rainPressure && (
              <div
                data-testid="summary-card-rain"
                className="rounded-xl border border-slate-200/85 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 min-h-[84px] flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CloudRain className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                      Chuva
                    </span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Droplets className="w-3 h-3 text-sky-500 shrink-0" />
                      <div className="w-16 h-1.5 rounded-full bg-sky-200 dark:bg-sky-900 overflow-hidden">
                        <div
                          className="h-full bg-[#0080cd] rounded-full"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(0, currentHour.precipitationProbabilityPct.mean ?? 0),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-sm font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                    {currentHour.precipitationMm.mean !== null
                      ? `${currentHour.precipitationMm.mean.toFixed(1)}mm`
                      : '0mm'}{' '}
                    -{' '}
                    <span className="text-[#0080cd] dark:text-sky-300">
                      {currentHour.precipitationProbabilityPct.mean !== null
                        ? `${Math.round(currentHour.precipitationProbabilityPct.mean)}%`
                        : '0%'}
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* Block 3: Vento 10m & Rajada */}
            {visibleParams.wind10m && (
              <div
                data-testid="summary-card-wind"
                className="rounded-xl border border-slate-200/85 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 min-h-[84px] flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Wind className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                      Vento &amp; Rajada
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                      Rajada de vento:{' '}
                      <strong className="text-slate-800 dark:text-sky-100">
                        {gustSpd !== null ? `${windCardDir} - ${gustSpd} km/h` : '—'}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-sm font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                    {windSpd !== null ? `← ${windCardDir} - ${windSpd} km/h` : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Block 4: Ondas & Swell */}
            {visibleParams.waves && (
              <div
                data-testid="summary-card-waves"
                className="rounded-xl border border-slate-200/85 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 min-h-[84px] flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Waves className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                      Ondas &amp; Swell
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                      {forecast.marineAvailable && currentHour.marine
                        ? `Swell: ${
                            currentHour.marine.swellWaveHeight !== null
                              ? `${currentHour.marine.swellWaveHeight.toFixed(1)}m (${
                                  currentHour.marine.swellWavePeriod !== null &&
                                  currentHour.marine.swellWavePeriod !== undefined
                                    ? Math.round(currentHour.marine.swellWavePeriod)
                                    : '—'
                                }s)`
                              : '—'
                          }`
                        : 'Interior / Terra Firme'}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {forecast.marineAvailable && currentHour.marine ? (
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                      {currentHour.marine.waveHeight !== null
                        ? `${currentHour.marine.waveHeight.toFixed(1)}m`
                        : '—'}{' '}
                      <span className="text-xs font-semibold text-slate-500 dark:text-sky-300">
                        (
                        {currentHour.marine.wavePeriod !== null &&
                        currentHour.marine.wavePeriod !== undefined
                          ? Math.round(currentHour.marine.wavePeriod)
                          : '—'}
                        s • {degreesToCardinalShort(currentHour.marine.waveDirection)})
                      </span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 dark:bg-sky-900 text-[#0070b8] dark:text-sky-200">
                      Continental
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Block 5: Pressão & Visibilidade */}
            {(visibleParams.rainPressure || visibleParams.tempVisibility) && (
              <div
                data-testid="summary-card-pressure"
                className="rounded-xl border border-slate-200/85 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 min-h-[84px] flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Gauge className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                      Pressão &amp; Visibilidade
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                      Visibilidade:{' '}
                      <strong className="text-slate-700 dark:text-sky-100">
                        {currentHour.visibilityM.mean !== null
                          ? `${(currentHour.visibilityM.mean / 1000).toFixed(1)} km`
                          : 'Boa'}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-sm font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                    {currentHour.surfacePressureHpa.mean !== null
                      ? `${Math.round(currentHour.surfacePressureHpa.mean)} hPa`
                      : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Block 6: Sol & Lua (Climatempo style) */}
            {visibleParams.ephemeris && activeEphemeris && (
              <div
                data-testid="summary-card-ephemeris"
                className="rounded-xl border border-slate-200/85 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 min-h-[84px] flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Sun className="w-5 h-5 text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                      Sol &amp; Lua
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 inline-flex items-center gap-1 flex-wrap">
                      <Moon className="w-3 h-3 text-sky-500 shrink-0" />
                      <span>
                        {activeEphemeris.moonPhaseLabel} (
                        {Math.round(activeEphemeris.moonIlluminationPct)}%)
                      </span>
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                    {formatTimeHHMM(activeEphemeris.sunriseIso, forecast.timezone)}h às{' '}
                    {formatTimeHHMM(activeEphemeris.sunsetIso, forecast.timezone)}h
                  </span>
                </div>
              </div>
            )}

            {/* Optional Block 7: Perfil Vertical (80m - 120m) when enabled */}
            {visibleParams.verticalProfile && (
              <div
                data-testid="summary-card-vertical"
                className="rounded-xl border border-slate-200/85 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 min-h-[84px] flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:col-span-2 xl:col-span-3 shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Compass className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-600 dark:text-sky-200 block">
                      Perfil Vertical de Vento (80m / 100m / 120m)
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                      Expoente de cisalhamento α ={' '}
                      {currentHour.verticalProfile.alpha !== null
                        ? currentHour.verticalProfile.alpha.toFixed(3)
                        : 'Normal'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-800 dark:text-white shrink-0">
                  <span>
                    80m:{' '}
                    <strong className="text-[#0080cd] dark:text-sky-300">
                      {currentHour.windSpeed80m.mean !== null
                        ? `${Math.round(currentHour.windSpeed80m.mean)} km/h`
                        : '—'}
                    </strong>
                  </span>
                  <span>
                    100m:{' '}
                    <strong className="text-[#0080cd] dark:text-sky-300">
                      {currentHour.windSpeed100m.mean !== null
                        ? `${Math.round(currentHour.windSpeed100m.mean)} km/h`
                        : '—'}
                    </strong>
                  </span>
                  <span>
                    120m:{' '}
                    <strong className="text-[#0080cd] dark:text-sky-300">
                      {currentHour.windSpeed120m.mean !== null
                        ? `${Math.round(currentHour.windSpeed120m.mean)} km/h`
                        : '—'}
                    </strong>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
