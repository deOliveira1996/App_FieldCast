import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  CloudRain,
  Compass,
  Gauge,
  MapPin,
  Mountain,
  ShieldCheck,
  Sliders,
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
import { HelpPopover } from '../common/HelpPopover';

export interface CurrentSummaryCardProps {
  forecast: NormalizedForecast;
  activeLocation: ActiveCoordinates;
  selectedHourIndex: number;
  onOpenThresholdModal: () => void;
  onOpenLocationsModal?: () => void;
}

const CONFIDENCE_COLOR_STYLES: Record<
  ConfidenceBadgeColor,
  {
    badge: string;
    bar: string;
    label: string;
  }
> = {
  green: {
    badge:
      'border-emerald-500/40 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
    bar: 'bg-emerald-500',
    label: 'Alta Confiabilidade',
  },
  amber: {
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-200',
    bar: 'bg-amber-500',
    label: 'Confiabilidade Moderada',
  },
  red: {
    badge: 'border-red-500/40 bg-red-500/15 text-red-900 dark:text-red-200',
    bar: 'bg-red-500',
    label: 'Baixa Confiabilidade / Divergência',
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
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
    dot: 'bg-emerald-500',
    title: 'Janela Segura (Verde)',
  },
  amber: {
    container: 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100',
    dot: 'bg-amber-500',
    title: 'Atenção Operacional (Amarelo)',
  },
  red: {
    container: 'border-red-500/40 bg-red-500/10 text-red-950 dark:text-red-100',
    dot: 'bg-red-500',
    title: 'Fora dos Limites (Vermelho)',
  },
};

function degreesToCardinal(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(deg)) {
    return '—';
  }
  const directions = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return `${directions[index]} (${Math.round(deg)}°)`;
}

function formatTimeHHMM(isoString: string, timezone?: string): string {
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
      weekday: 'short',
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
  onOpenThresholdModal,
  onOpenLocationsModal,
}) => {
  const [showConfidenceDetails, setShowConfidenceDetails] = useState(false);

  const safeIndex = Math.min(
    Math.max(0, selectedHourIndex),
    Math.max(0, forecast.hours.length - 1),
  );
  const currentHour: EnsembleHour | undefined = forecast.hours[safeIndex];
  const confidence = currentHour?.confidence ?? forecast.overallConfidence;
  const confStyle = CONFIDENCE_COLOR_STYLES[confidence.badge] ?? CONFIDENCE_COLOR_STYLES.amber;

  const safeWindowStatus: SafeWindowStatus = currentHour?.safeWindow ?? 'green';
  const safeStyle = SAFE_WINDOW_STYLES[safeWindowStatus] ?? SAFE_WINDOW_STYLES.green;

  const updatedAtHHMM = formatTimeHHMM(forecast.fetchedAtIso, forecast.timezone);

  const originLabel = activeLocation.isApproximateIp
    ? 'Aproximado via IP'
    : activeLocation.origin === 'gps'
      ? 'GPS Preciso'
      : activeLocation.origin === 'cached'
        ? 'Cache Offline'
        : activeLocation.origin === 'saved'
          ? 'Ponto Salvo'
          : 'Busca Geográfica';

  return (
    <section
      aria-label="Resumo Atual, Confiabilidade e Semáforo Operacional"
      className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-5 space-y-4"
    >
      {/* Top Row: Location Metadata, DEM Elevation, Timestamp & Confidence/Semaphore Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {onOpenLocationsModal ? (
              <button
                type="button"
                onClick={onOpenLocationsModal}
                className="min-h-[44px] px-3 py-1.5 -ml-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <MapPin className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
                  {activeLocation.name}
                </h1>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2">
                <MapPin className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
                  {activeLocation.name}
                </h1>
              </div>
            )}

            {/* DEM Elevation Badge (Exclusively from Open-Meteo DEM) */}
            <span
              title="Altitude extraída exclusivamente do Modelo Digital de Elevação (DEM) da Open-Meteo"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
            >
              <Mountain className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span>Altitude DEM: {Math.round(forecast.elevationDemM)} m</span>
            </span>

            {/* Location Origin Badge */}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                activeLocation.isApproximateIp
                  ? 'bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-500/40'
                  : 'bg-sky-500/10 text-sky-900 dark:text-sky-300 border-sky-500/30'
              }`}
            >
              <Compass className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{originLabel}</span>
            </span>

            {/* Updated Timestamp Badge */}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                forecast.fromCache
                  ? 'bg-amber-500/15 text-amber-900 dark:text-amber-300 border border-amber-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                Atualizado às {updatedAtHHMM}
                {forecast.fromCache ? ' (Cache Offline)' : ''}
              </span>
            </span>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">
            Coordenadas: {forecast.latitude.toFixed(4)}°, {forecast.longitude.toFixed(4)}° • Fuso:{' '}
            {forecast.timezone} • Exibindo hora #{safeIndex + 1} (
            {formatHourDateTimeLabel(currentHour, forecast.timezone)})
          </p>
        </div>

        {/* Confidence Score Badge + Safe Window Semaphore */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Confidence Badge Button + HelpPopover */}
          <div className="inline-flex items-center rounded-xl border p-1 pr-1.5 gap-1 bg-slate-50 dark:bg-slate-950/60 border-slate-300 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowConfidenceDetails((prev) => !prev)}
              aria-expanded={showConfidenceDetails}
              title="Clique para inspecionar os 4 pilares do Índice de Confiabilidade"
              className={`min-h-[44px] px-3 py-1.5 rounded-lg border text-xs font-bold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${confStyle.badge}`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <div className="text-left">
                <span className="block text-[10px] uppercase tracking-wider opacity-80">
                  Confiança
                </span>
                <span className="text-sm font-extrabold">
                  {Math.round(confidence.total)}/100 • {confStyle.label}
                </span>
              </div>
              {showConfidenceDetails ? (
                <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
            </button>
            <HelpPopover topic="confidence" />
          </div>

          {/* Safe Window Semaphore + Threshold Config Button + HelpPopover */}
          <div
            className={`inline-flex items-center rounded-xl border p-1 pr-1.5 gap-1 ${safeStyle.container}`}
          >
            <div className="px-3 py-1.5 flex items-center gap-2.5">
              <span className={`w-3 h-3 rounded-full shrink-0 ${safeStyle.dot}`} />
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">
                  Semáforo Operacional
                </span>
                <span className="text-xs sm:text-sm font-extrabold">{safeStyle.title}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenThresholdModal}
              aria-label="Configurar limites do Semáforo de Janela Segura"
              title="Configurar Limites (Vento, Rajada, Onda, Chuva)"
              className="min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-lg bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300/80 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <Sliders className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span className="hidden sm:inline">Limites</span>
            </button>

            <HelpPopover topic="safe_window" />
          </div>
        </div>
      </div>

      {/* Expandable Confidence Score Breakdown Tooltip/Panel */}
      {showConfidenceDetails && (
        <div
          role="region"
          aria-label="Detalhamento do Índice de Confiabilidade"
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/90 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Decomposição Auditável do Índice de Confiabilidade ({Math.round(confidence.total)} /
              100 pts)
            </h3>
            {confidence.isContinental && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/15 text-sky-800 dark:text-sky-300 border border-sky-500/30">
                Regra Continental Ativa: Pesos redistribuídos sem penalidade marinha
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">
                1. Concordância entre Modelos
              </span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.modelAgreement.toFixed(1)} / 50 pts
              </span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Dispersão escalar + coerência vetorial R
              </span>
            </div>

            <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">
                2. Integridade & Frescor das Fontes
              </span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.sourceIntegrity.toFixed(1)} / 30 pts
              </span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Disponibilidade de modelos & idade do cache
              </span>
            </div>

            <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">
                3. Horizonte Temporal
              </span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.timeHorizon.toFixed(1)} / 20 pts
              </span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Cheio 0–24h • Decaimento 24–72h e &gt;72h
              </span>
            </div>

            <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400 block">
                4. Penalidade de Cisalhamento (α)
              </span>
              <span
                className={`text-base font-extrabold ${
                  confidence.breakdown.shearPenalty > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {confidence.breakdown.shearPenalty > 0
                  ? `-${confidence.breakdown.shearPenalty.toFixed(1)} pts`
                  : '0 pts (Normal)'}
              </span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Desconto se α fora de [0.05, 0.40]
              </span>
            </div>
          </div>

          {confidence.reasons.length > 0 && (
            <ul className="text-xs text-slate-700 dark:text-slate-300 list-disc pl-5 space-y-1">
              {confidence.reasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Primary Weather & Marine Metrics Grid */}
      {currentHour && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* 1. Wind 10m & Gusts */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Vento 10m & Rajada</span>
              <Wind className="w-4 h-4 text-sky-500" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                {currentHour.windSpeed10m.mean !== null
                  ? Math.round(currentHour.windSpeed10m.mean)
                  : '—'}
              </span>
              <span className="text-xs font-semibold text-slate-500">km/h</span>
            </div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Rajadas 10m:{' '}
              {currentHour.windGusts10m.mean !== null
                ? `${Math.round(currentHour.windGusts10m.mean)} km/h`
                : '—'}
            </p>
            <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
              Dir: {degreesToCardinal(currentHour.windDirection10m.degree)} • R=
              {currentHour.windDirection10m.resultantLengthR !== null
                ? currentHour.windDirection10m.resultantLengthR.toFixed(2)
                : '—'}
            </p>
          </div>

          {/* 2. Wind Altitude (80m / 100m / 120m) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Perfil Vertical (80–120m)</span>
              <Compass className="w-4 h-4 text-indigo-500" aria-hidden="true" />
            </div>
            <div className="space-y-0.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">80m:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {currentHour.windSpeed80m.mean !== null
                    ? `${Math.round(currentHour.windSpeed80m.mean)} km/h`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">100m:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {currentHour.windSpeed100m.mean !== null
                    ? `${Math.round(currentHour.windSpeed100m.mean)} km/h`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">120m:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {currentHour.windSpeed120m.mean !== null
                    ? `${Math.round(currentHour.windSpeed120m.mean)} km/h`
                    : '—'}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Expoente α:{' '}
              {currentHour.verticalProfile.alpha !== null
                ? currentHour.verticalProfile.alpha.toFixed(3)
                : 'N/A'}
            </p>
          </div>

          {/* 3. Marine (Waves & Swell) or Continental Notice */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Ondas & Swell</span>
              <Waves className="w-4 h-4 text-teal-500" aria-hidden="true" />
            </div>
            {forecast.marineAvailable && currentHour.marine ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                    {currentHour.marine.waveHeight !== null
                      ? currentHour.marine.waveHeight.toFixed(1)
                      : '—'}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    m ({currentHour.marine.wavePeriod ?? '—'}s)
                  </span>
                </div>
                <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                  Swell:{' '}
                  {currentHour.marine.swellWaveHeight !== null
                    ? `${currentHour.marine.swellWaveHeight.toFixed(1)}m (${
                        currentHour.marine.swellWavePeriod ?? '—'
                      }s)`
                    : '—'}
                </p>
                <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  Dir: {degreesToCardinal(currentHour.marine.waveDirection)}
                </p>
              </>
            ) : (
              <div className="pt-1 space-y-1">
                <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  Ponto Continental
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  Grade marinha não aplicável em terra firme (sem penalidade na confiança).
                </p>
              </div>
            )}
          </div>

          {/* 4. Precipitation & Probability */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Chuva & Probabilidade</span>
              <CloudRain className="w-4 h-4 text-sky-500" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                {currentHour.precipitationMm.mean !== null
                  ? currentHour.precipitationMm.mean.toFixed(1)
                  : '0.0'}
              </span>
              <span className="text-xs font-semibold text-slate-500">mm/h</span>
            </div>
            <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
              Probabilidade:{' '}
              {currentHour.precipitationProbabilityPct.mean !== null
                ? `${Math.round(currentHour.precipitationProbabilityPct.mean)}%`
                : '—'}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Nuvens B/M/A: {Math.round(currentHour.cloudCover.lowPct.mean ?? 0)}% /{' '}
              {Math.round(currentHour.cloudCover.midPct.mean ?? 0)}% /{' '}
              {Math.round(currentHour.cloudCover.highPct.mean ?? 0)}%
            </p>
          </div>

          {/* 5. Temperature, Dew Point & Barometric Pressure */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-1 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
              <span>Temp, Orvalho & Pressão</span>
              <Thermometer className="w-4 h-4 text-rose-500" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                {currentHour.temperature2mC.mean !== null
                  ? `${currentHour.temperature2mC.mean.toFixed(1)}°C`
                  : '—'}
              </span>
              <span className="text-xs text-slate-500">
                Orv:{' '}
                {currentHour.dewPoint2mC.mean !== null
                  ? `${currentHour.dewPoint2mC.mean.toFixed(1)}°C`
                  : '—'}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-indigo-500" aria-hidden="true" />
              <span>
                {currentHour.surfacePressureHpa.mean !== null
                  ? `${Math.round(currentHour.surfacePressureHpa.mean)} hPa`
                  : '—'}
              </span>
              {currentHour.pressureDelta3hHpa !== null && (
                <span
                  className={`font-mono text-[11px] ${
                    currentHour.pressureDelta3hHpa <= -4
                      ? 'text-red-600 dark:text-red-400 font-bold'
                      : 'text-slate-500'
                  }`}
                >
                  ({currentHour.pressureDelta3hHpa > 0 ? '+' : ''}
                  {currentHour.pressureDelta3hHpa.toFixed(1)}/3h)
                </span>
              )}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Visibilidade:{' '}
              {currentHour.visibilityM.mean !== null
                ? `${(currentHour.visibilityM.mean / 1000).toFixed(1)} km`
                : 'N/D'}
            </p>
          </div>
        </div>
      )}

      {/* Safe Window Reasons Strip if Amber or Red */}
      {currentHour && currentHour.safeWindowReasons.length > 0 && (
        <div className="rounded-xl bg-slate-100 dark:bg-slate-800/70 px-3.5 py-2 text-xs text-slate-700 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong className="font-bold">Motivos do Semáforo nesta hora:</strong>{' '}
            {currentHour.safeWindowReasons.join(' • ')}
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Tetos ativos: Vento ≤ {forecast.thresholdsUsed.maxWindKmh} km/h | Rajada ≤{' '}
            {forecast.thresholdsUsed.maxGustKmh} km/h | Onda ≤ {forecast.thresholdsUsed.maxWaveM}m |
            Chuva ≤ {forecast.thresholdsUsed.maxPrecipProbPct}%
          </span>
        </div>
      )}
    </section>
  );
};
