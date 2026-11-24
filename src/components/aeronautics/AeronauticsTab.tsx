import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Compass,
  Plane,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Wind,
} from 'lucide-react';
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
import type { NormalizedForecast, SafeWindowStatus } from '../../types/weather';
import {
  computeDroneFlightAssessment,
  DEFAULT_DRONE_FLIGHT_LIMITS,
  type DroneFlightLimits,
  getWindSpeedAtAltitude,
} from '../../utils/droneFlightIndex';
import {
  formatLocalHourBadge,
  formatLocalYMD,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { safeAction } from '../../utils/safeAction';

const DRONE_LIMITS_STORAGE_KEY = 'fieldcast_drone_limits_v1';

const ALTITUDE_OPTIONS: ReadonlyArray<30 | 50 | 80 | 100 | 120> = [30, 50, 80, 100, 120];

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
  initialKpDataset?: KpIndexDataset;
  onFetchKpIndex?: () => Promise<KpIndexDataset>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
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
    };
  } catch {
    return DEFAULT_DRONE_FLIGHT_LIMITS;
  }
}

export const AeronauticsTab: React.FC<AeronauticsTabProps> = ({
  forecast,
  activeLocation,
  isDark = false,
  initialKpDataset,
  onFetchKpIndex,
  onToast,
  onErrorLog,
}) => {
  const hours = forecast?.hours ?? [];
  const currentHourIndex = useCurrentLocalHourIndex(hours, forecast?.timezone);
  const [selectedOffset, setSelectedOffset] = useState<number>(0);

  const [kpDataset, setKpDataset] = useState<KpIndexDataset>(
    () => initialKpDataset ?? buildFallbackKpDataset(),
  );
  const [isFetchingKp, setIsFetchingKp] = useState<boolean>(false);
  const [manualOverride, setManualOverride] = useState(() => loadManualKpOverride());
  const [droneLimits, setDroneLimits] = useState<DroneFlightLimits>(() => loadSavedDroneLimits());

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

  const effectiveHourIndex = useMemo(() => {
    if (hours.length === 0) return 0;
    return Math.max(0, Math.min(hours.length - 1, currentHourIndex + selectedOffset));
  }, [currentHourIndex, hours.length, selectedOffset]);

  const selectedHour = hours[effectiveHourIndex];

  const effectiveKp = manualOverride.enabled ? manualOverride.kpValue : kpDataset.currentKp;
  const kpClassification = useMemo(() => classifyKpScale(effectiveKp), [effectiveKp]);

  const flightAssessment = useMemo(
    () => computeDroneFlightAssessment(selectedHour, effectiveKp, droneLimits),
    [droneLimits, effectiveKp, selectedHour],
  );

  const upcomingWindows = useMemo(() => {
    if (hours.length === 0) return [];
    const startIdx =
      hours.length - currentHourIndex >= 6
        ? currentHourIndex
        : Math.max(0, hours.length - 12);
    const slice = hours.slice(startIdx, startIdx + 12);
    return slice.map((h, idx) => ({
      offset: startIdx + idx - currentHourIndex,
      hourBadge: formatLocalHourBadge(h.timestampUnix, forecast?.timezone),
      assessment: computeDroneFlightAssessment(h, effectiveKp, droneLimits),
    }));
  }, [currentHourIndex, droneLimits, effectiveKp, forecast?.timezone, hours]);

  const handleManualKpValueChange = (nextVal: number) => {
    const clamped = Math.max(0, Math.min(9, Number.isFinite(nextVal) ? Number(nextVal.toFixed(1)) : 0));
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
      <section className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              <Plane className="w-4 h-4" aria-hidden="true" />
              <span>Módulo de Aeronáutica, Voo de Drone & Clima Espacial (Kp)</span>
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

        {/* Seletor de Próximas Janelas de Voo (12h) */}
        {upcomingWindows.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-sky-800/50 space-y-2">
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
                    <span className={`text-[10px] ${isSelected ? 'text-sky-100' : 'text-slate-500 dark:text-slate-400'}`}>
                      Score {win.assessment.score}
                    </span>
                  </button>
                );
              })}
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
          </div>

          <div className={`rounded-xl border p-3.5 flex items-center gap-2.5 text-xs sm:text-sm font-bold ${scoreStyles.container}`}>
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
                  ? `${flightAssessment.altitudeWindKmh.toFixed(1)} km/h`
                  : 'N/D'}
              </strong>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-[#0f243d] p-3 border border-slate-200/60 dark:border-sky-800/50">
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">Rajadas 10m</span>
              <strong className="text-sm text-slate-900 dark:text-white">
                {flightAssessment.gust10mKmh !== null
                  ? `${flightAssessment.gust10mKmh.toFixed(1)} km/h`
                  : 'N/D'}
              </strong>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-[#0f243d] p-3 border border-slate-200/60 dark:border-sky-800/50">
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">Visibilidade</span>
              <strong className="text-sm text-slate-900 dark:text-white">
                {flightAssessment.visibilityKm !== null
                  ? `${flightAssessment.visibilityKm.toFixed(1)} km`
                  : 'N/D'}
              </strong>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-[#0f243d] p-3 border border-slate-200/60 dark:border-sky-800/50">
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">Kp Efetivo</span>
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
              <label className="block text-[11px] text-slate-600 dark:text-slate-300">
                Vento Máx (km/h)
                <input
                  type="number"
                  min={10}
                  max={90}
                  value={droneLimits.maxWindKmh}
                  onChange={(e) =>
                    setDroneLimits((prev) => ({
                      ...prev,
                      maxWindKmh: Math.max(10, Number(e.target.value) || 36),
                    }))
                  }
                  className="mt-1 w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white"
                />
              </label>

              <label className="block text-[11px] text-slate-600 dark:text-slate-300">
                Rajada Máx (km/h)
                <input
                  type="number"
                  min={15}
                  max={110}
                  value={droneLimits.maxGustKmh}
                  onChange={(e) =>
                    setDroneLimits((prev) => ({
                      ...prev,
                      maxGustKmh: Math.max(15, Number(e.target.value) || 48),
                    }))
                  }
                  className="mt-1 w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white"
                />
              </label>

              <label className="block text-[11px] text-slate-600 dark:text-slate-300">
                Kp Máx Tolerado
                <input
                  type="number"
                  min={1}
                  max={9}
                  step={0.5}
                  value={droneLimits.maxKpIndex}
                  onChange={(e) =>
                    setDroneLimits((prev) => ({
                      ...prev,
                      maxKpIndex: Math.max(1, Math.min(9, Number(e.target.value) || 4.5)),
                    }))
                  }
                  className="mt-1 w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white"
                />
              </label>

              <label className="block text-[11px] text-slate-600 dark:text-slate-300">
                Visib. Mín (km)
                <input
                  type="number"
                  min={0.5}
                  max={15}
                  step={0.5}
                  value={droneLimits.minVisibilityKm}
                  onChange={(e) =>
                    setDroneLimits((prev) => ({
                      ...prev,
                      minVisibilityKm: Math.max(0.5, Number(e.target.value) || 3),
                    }))
                  }
                  className="mt-1 w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-sky-700 bg-white dark:bg-[#0f243d] text-xs font-bold text-slate-900 dark:text-white"
                />
              </label>
            </div>
          </div>
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
                  Índice Kp Geomagnético & GNSS
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

            <div className={`px-3.5 py-2 rounded-2xl border text-right ${kpBadgeStyles.container}`}>
              <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">
                Escala {kpClassification.scale}
              </span>
              <span className={`text-2xl font-black leading-none ${kpBadgeStyles.scoreText}`}>
                Kp {effectiveKp.toFixed(1)}
              </span>
            </div>
          </div>

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

          {/* Gráfico de Barras Kp 3h NOAA SWPC */}
          {kpDataset.entries.length > 0 && (
            <div className="rounded-xl border border-slate-200/70 dark:border-sky-800/60 bg-slate-50/50 dark:bg-[#0f243d]/70 p-3">
              <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                Série NOAA SWPC Kp (Observado / Estimado / Previsto UTC)
              </p>
              <ReactECharts option={kpTimelineOption} style={{ height: 190, width: '100%' }} />
            </div>
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
                Perfil Vertical AGL (10m a 120m) & Cisalhamento
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
                    ? `${selectedHour.pressureDelta3hHpa >= 0 ? '+' : ''}${selectedHour.pressureDelta3hHpa.toFixed(1)} hPa`
                    : 'N/D'}
                </strong>
              </p>
            </div>
          </div>

          {selectedHour?.verticalProfile.atypicalShearWarning && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
              Cisalhamento Atípico Detectado
            </span>
          )}
        </div>

        <div className="rounded-xl border border-slate-200/70 dark:border-sky-800/60 bg-slate-50/50 dark:bg-[#0f243d]/70 p-3">
          <ReactECharts option={verticalChartOption} style={{ height: 210, width: '100%' }} />
        </div>
      </section>
    </div>
  );
};
