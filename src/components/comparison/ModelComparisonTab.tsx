import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  CloudRain,
  Eye,
  EyeOff,
  GitCompare,
  Layers,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Sparkles,
  Waves,
  Wind,
} from 'lucide-react';
import {
  WEATHER_MODELS,
  type ForecastViewMode,
  type NativeModelHour,
  type NormalizedForecast,
  type WeatherModelId,
} from '../../types/weather';
import {
  formatLocalHourBadge,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { MODEL_COLORS, MODEL_DISPLAY_LABELS } from '../../utils/modelComparison';
import {
  convertPrecipitation,
  convertPressure,
  convertTemperature,
  convertWindSpeed,
  getPrecipUnitLabel,
  getPressureUnitLabel,
  getTempUnitLabel,
  getWindUnitLabel,
  type UnitPreferences,
} from '../../utils/units';
import { useUnits } from '../../context/UnitsContext';
import { CollapsibleModule } from '../common/CollapsibleModule';
import { HelpPopover } from '../common/HelpPopover';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { ForecastSkeleton } from '../common/SkeletonLoaders';
import { degreesToCardinalShort } from '../forecast/CurrentSummaryCard';
import { ForecastCharts } from '../forecast/ForecastCharts';
import type { ForecastTabProps } from '../forecast/ForecastTab';
import {
  type ForecastParamKey,
  type ForecastVisibleParams,
  loadPersistedVisibleParams,
  persistVisibleParams,
} from '../forecast/forecastParamsVisibility';
import { ThresholdSettingsModal } from '../forecast/ThresholdSettingsModal';
import { WindguruTable } from '../forecast/WindguruTable';

export type ComparisonHorizonHours = 24 | 48 | 72 | 168;

export interface ModelComparisonTabProps extends ForecastTabProps {
  onNavigateBackToSummary?: () => void;
}

const COMPARISON_VIEW_MODES: ReadonlyArray<{
  id: ForecastViewMode;
  label: string;
  sublabel: string;
}> = [
  { id: 'fieldcast', label: 'FieldCast Ensemble', sublabel: 'Consenso Ponderado' },
  { id: 'ecmwf_ifs025', label: 'ECMWF', sublabel: 'IFS 0.25° (9 km)' },
  { id: 'gfs_seamless', label: 'GFS', sublabel: 'NOAA Global' },
  { id: 'icon_seamless', label: 'ICON', sublabel: 'DWD Alemão' },
  { id: 'gem_seamless', label: 'GEM', sublabel: 'CMC Canadense' },
  { id: 'spaghetti', label: 'Spaghetti', sublabel: 'Curvas Sobrepostas' },
];

const COMPARISON_HORIZONS: ReadonlyArray<{
  hours: ComparisonHorizonHours;
  label: string;
}> = [
  { hours: 24, label: '24h' },
  { hours: 48, label: '48h' },
  { hours: 72, label: '72h' },
  { hours: 168, label: '168h' },
];

interface PlotGroupToggles {
  windAndVertical: boolean;
  rainAndPressure: boolean;
  wavesAndMsl: boolean;
  stratifiedClouds: boolean;
}

const DEFAULT_PLOT_GROUP_TOGGLES: PlotGroupToggles = {
  windAndVertical: true,
  rainAndPressure: true,
  wavesAndMsl: true,
  stratifiedClouds: true,
};

function formatMatrixTimestamp(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    return d.toLocaleString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return formatLocalHourBadge(timestampUnix, timezone);
  }
}

function formatSpreadRange(
  minVal: number | null | undefined,
  maxVal: number | null | undefined,
  stdDev: number | null | undefined,
  unit: string,
  decimals = 0,
  converter: (v: number) => number = (v) => v,
): string {
  if (
    minVal !== null &&
    minVal !== undefined &&
    maxVal !== null &&
    maxVal !== undefined &&
    Number.isFinite(minVal) &&
    Number.isFinite(maxVal)
  ) {
    const cMin = converter(minVal);
    const cMax = converter(maxVal);
    const spread = Math.max(0, cMax - cMin);
    const cStd =
      stdDev !== null && stdDev !== undefined && Number.isFinite(stdDev)
        ? Math.abs(converter(minVal + stdDev) - converter(minVal))
        : null;
    const stdPart = cStd !== null ? ` (±${cStd.toFixed(decimals)})` : '';
    return `Δ ${spread.toFixed(decimals)} ${unit}${stdPart}`;
  }
  return '—';
}

function formatAltitudeWindCell(
  speed80m: number | null | undefined,
  speed100m: number | null | undefined,
  windUnit: UnitPreferences['wind'] = 'kmh',
): string {
  const s80 = convertWindSpeed(speed80m, windUnit);
  const s100 = convertWindSpeed(speed100m, windUnit);
  const lbl = getWindUnitLabel(windUnit);
  const fmt = (v: number) => (windUnit === 'ms' ? v.toFixed(1) : String(Math.round(v)));
  if (s80 !== null && s100 !== null) {
    return `${fmt(s80)} / ${fmt(s100)} ${lbl}`;
  }
  if (s100 !== null) {
    return `${fmt(s100)} ${lbl} (100m)`;
  }
  if (s80 !== null) {
    return `${fmt(s80)} ${lbl} (80m)`;
  }
  return '—';
}

export const ModelComparisonTab: React.FC<ModelComparisonTabProps> = ({
  forecast,
  activeLocation,
  isLoading = false,
  isDark = false,
  viewMode: propViewMode,
  onViewModeChange: propOnViewModeChange,
  thresholds,
  onSaveThresholds,
  onReloadForecast,
  onToast,
  onErrorLog,
}) => {
  const { units, formatTempValue, formatWindValue, formatPrecipValue, formatPressureValue } =
    useUnits();
  const [internalViewMode, setInternalViewMode] = useState<ForecastViewMode>('fieldcast');
  const viewMode = propViewMode ?? internalViewMode;
  const setViewMode = useCallback(
    (nextMode: ForecastViewMode) => {
      setInternalViewMode(nextMode);
      propOnViewModeChange?.(nextMode);
    },
    [propOnViewModeChange],
  );

  const [horizonHours, setHorizonHours] = useState<ComparisonHorizonHours>(168);
  const [showInterpolatedProfile, setShowInterpolatedProfile] = useState<boolean>(false);

  // Analytical plots are strictly ON-DEMAND (hidden until requested by the user)
  const [showAnalyticalPlots, setShowAnalyticalPlots] = useState<boolean>(false);
  const [plotToggles, setPlotToggles] = useState<PlotGroupToggles>(DEFAULT_PLOT_GROUP_TOGGLES);

  // Fullscreen Windguru 168h Table portal modal
  const [isTableFullscreen, setIsTableFullscreen] = useState<boolean>(false);
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState<boolean>(false);

  const currentLocalHourIndex = useCurrentLocalHourIndex(forecast?.hours, forecast?.timezone);
  const [manualHourIndex, setManualHourIndex] = useState<number | null>(null);

  const [tableVisibleParams, setTableVisibleParams] = useState<ForecastVisibleParams>(() =>
    loadPersistedVisibleParams(),
  );

  const handleToggleTableParam = useCallback((key: ForecastParamKey) => {
    setTableVisibleParams((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persistVisibleParams(next);
      return next;
    });
  }, []);

  const forecastKey = forecast
    ? `${forecast.locationKey}_${forecast.hours[0]?.timestampUnix ?? 0}`
    : '';

  useEffect(() => {
    setManualHourIndex(null);
  }, [forecastKey]);

  useEffect(() => {
    if (!isTableFullscreen || typeof document === 'undefined') {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTableFullscreen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTableFullscreen]);

  const maxSliceLen = forecast ? Math.min(forecast.hours.length, horizonHours) : 0;
  const safeHourIndex = forecast
    ? Math.min(
        Math.max(0, manualHourIndex ?? currentLocalHourIndex),
        Math.max(0, maxSliceLen - 1),
      )
    : 0;

  const handleSelectHourIndex = useCallback(
    (idx: number) => {
      if (idx === currentLocalHourIndex) {
        setManualHourIndex(null);
      } else {
        setManualHourIndex(idx);
      }
    },
    [currentLocalHourIndex],
  );

  const handleMasterPlotsToggle = () => {
    setShowAnalyticalPlots((prev) => {
      const next = !prev;
      if (
        next &&
        !plotToggles.windAndVertical &&
        !plotToggles.rainAndPressure &&
        !plotToggles.wavesAndMsl &&
        !plotToggles.stratifiedClouds
      ) {
        setPlotToggles(DEFAULT_PLOT_GROUP_TOGGLES);
      }
      return next;
    });
  };

  const handleTogglePlotGroup = (groupKey: keyof PlotGroupToggles) => {
    if (!showAnalyticalPlots) {
      setShowAnalyticalPlots(true);
      setPlotToggles({
        windAndVertical: groupKey === 'windAndVertical',
        rainAndPressure: groupKey === 'rainAndPressure',
        wavesAndMsl: groupKey === 'wavesAndMsl',
        stratifiedClouds: groupKey === 'stratifiedClouds',
      });
      return;
    }

    setPlotToggles((prev) => {
      const next = { ...prev, [groupKey]: !prev[groupKey] };
      const anyActive =
        next.windAndVertical ||
        next.rainAndPressure ||
        next.wavesAndMsl ||
        next.stratifiedClouds;
      if (!anyActive) {
        setShowAnalyticalPlots(false);
      }
      return next;
    });
  };

  const chartsVisibleParams: ForecastVisibleParams = useMemo(
    () => ({
      wind10m: plotToggles.windAndVertical,
      verticalProfile: plotToggles.windAndVertical,
      rainPressure: plotToggles.rainAndPressure,
      tempVisibility: plotToggles.windAndVertical && plotToggles.rainAndPressure,
      waves: plotToggles.wavesAndMsl,
      clouds: plotToggles.stratifiedClouds,
      alerts: false,
      charts: showAnalyticalPlots,
      table168h: true,
      ephemeris: false,
    }),
    [plotToggles, showAnalyticalPlots],
  );

  const windguruForecast: NormalizedForecast | null = useMemo(() => {
    if (!forecast) {
      return null;
    }
    if (horizonHours === 24) {
      return {
        ...forecast,
        hours: forecast.hours.slice(0, 24),
      };
    }
    return forecast;
  }, [forecast, horizonHours]);

  if (isLoading && !forecast) {
    return <ForecastSkeleton />;
  }

  if (!forecast || !windguruForecast) {
    return (
      <div
        data-testid="model-comparison-tab"
        className="rounded-2xl border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#132a47] p-8 text-center space-y-3 shadow-sm"
      >
        <p className="text-base font-bold text-slate-900 dark:text-white">
          Nenhuma previsão disponível para comparação em {activeLocation.name}
        </p>
        <p className="text-xs text-slate-600 dark:text-sky-200">
          Recarregue os modelos globais ou selecione outra coordenada.
        </p>
        {onReloadForecast && (
          <button
            type="button"
            onClick={() => void onReloadForecast()}
            className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-full text-xs font-bold bg-[#0080cd] hover:bg-[#006bb3] text-white transition-colors"
          >
            Recarregar Modelos
          </button>
        )}
      </div>
    );
  }

  const activeHour = forecast.hours[safeHourIndex];
  const confidence = activeHour?.confidence ?? forecast.overallConfidence;
  const activeThresholds = thresholds ?? forecast.thresholdsUsed;

  const nativeHourByModel: Record<WeatherModelId, NativeModelHour | undefined> = {
    ecmwf_ifs025: forecast.nativeByModel.ecmwf_ifs025?.[safeHourIndex],
    gfs_seamless: forecast.nativeByModel.gfs_seamless?.[safeHourIndex],
    icon_seamless: forecast.nativeByModel.icon_seamless?.[safeHourIndex],
    gem_seamless: forecast.nativeByModel.gem_seamless?.[safeHourIndex],
  };

  const activeTimestampText = activeHour
    ? formatMatrixTimestamp(activeHour.timestampUnix, forecast.timezone)
    : 'Agora';

  const currentLocalHHMM = forecast.hours[currentLocalHourIndex]
    ? formatLocalHourBadge(forecast.hours[currentLocalHourIndex]!.timestampUnix, forecast.timezone)
    : '00:00';
  const activeStepHHMM = activeHour
    ? formatLocalHourBadge(activeHour.timestampUnix, forecast.timezone)
    : currentLocalHHMM;
  const isMatrixAtCurrentHour =
    manualHourIndex === null || safeHourIndex === currentLocalHourIndex;

  const renderWindguruTableInstance = () => (
    <WindguruTable
      forecast={windguruForecast}
      viewMode={viewMode}
      showInterpolatedProfile={showInterpolatedProfile}
      horizonHours={horizonHours === 24 ? undefined : horizonHours}
      selectedHourIndex={safeHourIndex}
      currentHourIndex={currentLocalHourIndex}
      onSelectHourIndex={handleSelectHourIndex}
      visibleParams={tableVisibleParams}
      onToggleParam={handleToggleTableParam}
      onOpenThresholdModal={() => setIsThresholdModalOpen(true)}
    />
  );

  return (
    <ModuleErrorBoundary
      moduleName="Comparação Multi-Modelo & Gráficos (FieldCast V4)"
      onReset={onReloadForecast}
      onErrorLog={onErrorLog}
    >
      <div data-testid="model-comparison-tab" className="space-y-4 sm:space-y-5">
        {/* 1. Model Selector + Horizon Selector (24h, 48h, 72h, 168h) */}
        <section
          aria-label="Seletor Multi-Modelo e Horizonte Temporal"
          className="rounded-2xl border border-sky-200/85 dark:border-sky-800/75 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-3"
        >
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            {/* Model Pills */}
            <div
              data-testid="comparison-model-selector"
              className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1 xl:pb-0 min-w-0"
            >
              {COMPARISON_VIEW_MODES.map((m) => {
                const isSelected = viewMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`comparison-model-pill-${m.id}`}
                    onClick={() => setViewMode(m.id)}
                    aria-pressed={isSelected}
                    className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-left inline-flex items-center gap-2 shrink-0 border transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      isSelected
                        ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                        : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                    }`}
                  >
                    {m.id === 'fieldcast' ? (
                      <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                    ) : m.id === 'spaghetti' ? (
                      <GitCompare className="w-4 h-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
                    )}
                    <div>
                      <span className="block text-xs font-extrabold leading-tight">{m.label}</span>
                      <span
                        className={`block text-[10px] leading-tight ${
                          isSelected ? 'text-sky-100' : 'text-slate-500 dark:text-sky-300/75'
                        }`}
                      >
                        {m.sublabel}
                      </span>
                    </div>
                  </button>
                );
              })}
              <HelpPopover topic="ensemble_vs_native" className="shrink-0" />
            </div>

            {/* Vertical Curve Toggle + Horizon Selector (24h, 48h, 72h, 168h) */}
            <div className="flex flex-wrap items-center justify-between xl:justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowInterpolatedProfile((prev) => !prev)}
                aria-pressed={showInterpolatedProfile}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  showInterpolatedProfile
                    ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                    : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
                }`}
              >
                <Activity className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Curva 10–120m</span>
              </button>

              <div
                role="group"
                data-testid="comparison-horizon-selector"
                aria-label="Horizonte temporal da comparação"
                className="inline-flex items-center gap-1 rounded-xl border border-sky-200/80 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36] p-1"
              >
                <Clock className="w-4 h-4 text-[#0080cd] ml-2 hidden sm:inline" aria-hidden="true" />
                {COMPARISON_HORIZONS.map((h) => {
                  const active = horizonHours === h.hours;
                  return (
                    <button
                      key={h.hours}
                      type="button"
                      data-testid={`horizon-btn-${h.hours}h`}
                      onClick={() => setHorizonHours(h.hours)}
                      aria-pressed={active}
                      className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                        active
                          ? 'bg-[#0080cd] text-white shadow-sm'
                          : 'text-slate-700 dark:text-sky-200 hover:bg-sky-100/80 dark:hover:bg-sky-900/50'
                      }`}
                    >
                      {h.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 2. Model Comparison Matrix Card (Collapsible) */}
        <CollapsibleModule
          testId="model-comparison-matrix"
          title={`Matriz Comparativa — ${activeLocation.name}`}
          subtitle={activeTimestampText}
          icon={<GitCompare className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
          defaultOpen={true}
          keepMounted={true}
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 border-b border-slate-100 dark:border-sky-800/70 pb-2.5">
            <div className="space-y-0.5">
              <p className="text-[11px] text-slate-500 dark:text-sky-200/80">
                Comparação instantânea do Consenso FieldCast contra ECMWF IFS, NOAA GFS, DWD ICON e CMC GEM
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Confidence Score Pill (0-100) */}
              <div
                data-testid="matrix-confidence-score"
                className={`min-h-[44px] px-3.5 py-1.5 rounded-xl border inline-flex items-center gap-2 text-xs font-extrabold ${
                  confidence.badge === 'green'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/70 dark:bg-emerald-950/60 dark:text-emerald-200'
                    : confidence.badge === 'amber'
                      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/60 dark:text-amber-200'
                      : 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-700/70 dark:bg-rose-950/60 dark:text-rose-200'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Confiança Ensemble: {Math.round(confidence.total)}/100</span>
              </div>

              {/* Hour Stepper Controls */}
              <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36] p-0.5">
                <button
                  type="button"
                  disabled={safeHourIndex <= 0}
                  onClick={() => handleSelectHourIndex(Math.max(0, safeHourIndex - 1))}
                  aria-label="Hora anterior na matriz"
                  className="min-h-[44px] min-w-[44px] rounded-lg inline-flex items-center justify-center text-slate-700 dark:text-sky-200 hover:bg-white dark:hover:bg-sky-900/50 disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid="matrix-stepper-active-time"
                  onClick={() => setManualHourIndex(null)}
                  title={
                    isMatrixAtCurrentHour
                      ? `Horário local atual (${currentLocalHHMM})`
                      : `Hora selecionada: ${activeStepHHMM} — clique para voltar para Agora (${currentLocalHHMM})`
                  }
                  className={`min-h-[44px] px-3 rounded-lg text-xs font-bold transition-colors ${
                    isMatrixAtCurrentHour
                      ? 'text-[#0070b8] dark:text-sky-200 hover:bg-white dark:hover:bg-sky-900/50'
                      : 'bg-amber-100/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 hover:bg-amber-200/80'
                  }`}
                >
                  {isMatrixAtCurrentHour
                    ? `Agora (${currentLocalHHMM})`
                    : `${activeStepHHMM} ↺ Agora`}
                </button>
                <button
                  type="button"
                  disabled={safeHourIndex >= maxSliceLen - 1}
                  onClick={() => handleSelectHourIndex(Math.min(maxSliceLen - 1, safeHourIndex + 1))}
                  aria-label="Próxima hora na matriz"
                  className="min-h-[44px] min-w-[44px] rounded-lg inline-flex items-center justify-center text-slate-700 dark:text-sky-200 hover:bg-white dark:hover:bg-sky-900/50 disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Matrix Table */}
          {activeHour && (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200">
                    <th className="py-2.5 px-3 font-extrabold min-w-[140px]">Parâmetro</th>
                    <th className="py-2.5 px-3 font-extrabold text-[#0070b8] dark:text-sky-300 bg-sky-50/90 dark:bg-sky-950/60 min-w-[135px]">
                      FieldCast Ensemble
                    </th>
                    {WEATHER_MODELS.map((modelId) => (
                      <th key={modelId} className="py-2.5 px-3 font-bold min-w-[115px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: MODEL_COLORS[modelId] }}
                            aria-hidden="true"
                          />
                          <span>{MODEL_DISPLAY_LABELS[modelId]}</span>
                        </span>
                      </th>
                    ))}
                    <th className="py-2.5 px-3 font-bold text-slate-600 dark:text-sky-300 min-w-[130px]">
                      Dispersão (Spread)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-sky-800/50 text-slate-800 dark:text-sky-100">
                  {/* Temp 2m */}
                  <tr>
                    <th className="py-2 px-3 font-bold">Temperatura (2m)</th>
                    <td className="py-2 px-3 font-extrabold bg-sky-50/45 dark:bg-sky-950/35">
                      {formatTempValue(activeHour.temperature2mC.mean, 1)}
                    </td>
                    {WEATHER_MODELS.map((modelId) => {
                      const val = nativeHourByModel[modelId]?.temperature2m;
                      return (
                        <td key={modelId} className="py-2 px-3 font-semibold">
                          {formatTempValue(val, 1)}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-sky-300">
                      {formatSpreadRange(
                        activeHour.temperature2mC.min,
                        activeHour.temperature2mC.max,
                        activeHour.temperature2mC.stdDev,
                        getTempUnitLabel(units.temperature),
                        1,
                        (v) => convertTemperature(v, units.temperature) ?? v,
                      )}
                    </td>
                  </tr>

                  {/* Rain & % */}
                  <tr>
                    <th className="py-2 px-3 font-bold">
                      Chuva ({getPrecipUnitLabel(units.precipitation)}/h • %)
                    </th>
                    <td className="py-2 px-3 font-extrabold bg-sky-50/45 dark:bg-sky-950/35">
                      {activeHour.precipitationMm.mean !== null
                        ? formatPrecipValue(activeHour.precipitationMm.mean, 1)
                        : formatPrecipValue(0, 1)}{' '}
                      <span className="text-[11px] font-bold text-[#0070b8] dark:text-sky-300">
                        ({activeHour.precipitationProbabilityPct.mean !== null
                          ? `${Math.round(activeHour.precipitationProbabilityPct.mean)}%`
                          : '0%'})
                      </span>
                    </td>
                    {WEATHER_MODELS.map((modelId) => {
                      const m = nativeHourByModel[modelId];
                      const mm = m?.precipitation;
                      const prob = m?.precipitationProbability;
                      return (
                        <td key={modelId} className="py-2 px-3 font-semibold">
                          {typeof mm === 'number' && Number.isFinite(mm)
                            ? formatPrecipValue(mm, 1)
                            : '—'}
                          {typeof prob === 'number' && Number.isFinite(prob)
                            ? ` (${Math.round(prob)}%)`
                            : ''}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-sky-300">
                      {formatSpreadRange(
                        activeHour.precipitationMm.min,
                        activeHour.precipitationMm.max,
                        activeHour.precipitationMm.stdDev,
                        getPrecipUnitLabel(units.precipitation),
                        1,
                        (v) => convertPrecipitation(v, units.precipitation) ?? v,
                      )}
                    </td>
                  </tr>

                  {/* Wind 10m */}
                  <tr>
                    <th className="py-2 px-3 font-bold">Vento 10m</th>
                    <td className="py-2 px-3 font-extrabold bg-sky-50/45 dark:bg-sky-950/35">
                      {activeHour.windSpeed10m.mean !== null
                        ? `${formatWindValue(activeHour.windSpeed10m.mean, 0)} ${degreesToCardinalShort(activeHour.windDirection10m.degree)}`
                        : '—'}
                    </td>
                    {WEATHER_MODELS.map((modelId) => {
                      const m = nativeHourByModel[modelId];
                      const spd = m?.windSpeed10m;
                      return (
                        <td key={modelId} className="py-2 px-3 font-semibold">
                          {typeof spd === 'number' && Number.isFinite(spd)
                            ? `${formatWindValue(spd, 0)} ${degreesToCardinalShort(m?.windDirection10m)}`
                            : '—'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-sky-300">
                      {formatSpreadRange(
                        activeHour.windSpeed10m.min,
                        activeHour.windSpeed10m.max,
                        activeHour.windSpeed10m.stdDev,
                        getWindUnitLabel(units.wind),
                        units.wind === 'ms' ? 1 : 0,
                        (v) => convertWindSpeed(v, units.wind) ?? v,
                      )}
                    </td>
                  </tr>

                  {/* Wind 80m / 100m */}
                  <tr>
                    <th className="py-2 px-3 font-bold">Vento 80m / 100m</th>
                    <td className="py-2 px-3 font-extrabold bg-sky-50/45 dark:bg-sky-950/35">
                      {formatAltitudeWindCell(
                        activeHour.windSpeed80m.mean,
                        activeHour.windSpeed100m.mean,
                        units.wind,
                      )}
                    </td>
                    {WEATHER_MODELS.map((modelId) => {
                      const m = nativeHourByModel[modelId];
                      return (
                        <td key={modelId} className="py-2 px-3 font-semibold">
                          {formatAltitudeWindCell(m?.windSpeed80m, m?.windSpeed100m, units.wind)}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-sky-300">
                      {activeHour.windSpeed80m.min !== null && activeHour.windSpeed80m.max !== null
                        ? formatSpreadRange(
                            activeHour.windSpeed80m.min,
                            activeHour.windSpeed80m.max,
                            activeHour.windSpeed80m.stdDev,
                            getWindUnitLabel(units.wind),
                            units.wind === 'ms' ? 1 : 0,
                            (v) => convertWindSpeed(v, units.wind) ?? v,
                          )
                        : formatSpreadRange(
                            activeHour.windSpeed100m.min,
                            activeHour.windSpeed100m.max,
                            activeHour.windSpeed100m.stdDev,
                            getWindUnitLabel(units.wind),
                            units.wind === 'ms' ? 1 : 0,
                            (v) => convertWindSpeed(v, units.wind) ?? v,
                          )}
                    </td>
                  </tr>

                  {/* Gusts 10m */}
                  <tr>
                    <th className="py-2 px-3 font-bold">Rajadas 10m</th>
                    <td className="py-2 px-3 font-extrabold text-orange-600 dark:text-orange-300 bg-sky-50/45 dark:bg-sky-950/35">
                      {formatWindValue(activeHour.windGusts10m.mean, 0)}
                    </td>
                    {WEATHER_MODELS.map((modelId) => {
                      const gust = nativeHourByModel[modelId]?.windGusts10m;
                      return (
                        <td key={modelId} className="py-2 px-3 font-semibold">
                          {typeof gust === 'number' && Number.isFinite(gust)
                            ? formatWindValue(gust, 0)
                            : '—'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-sky-300">
                      {formatSpreadRange(
                        activeHour.windGusts10m.min,
                        activeHour.windGusts10m.max,
                        activeHour.windGusts10m.stdDev,
                        getWindUnitLabel(units.wind),
                        units.wind === 'ms' ? 1 : 0,
                        (v) => convertWindSpeed(v, units.wind) ?? v,
                      )}
                    </td>
                  </tr>

                  {/* Surface Pressure */}
                  <tr>
                    <th className="py-2 px-3 font-bold">Pressão Superfície</th>
                    <td className="py-2 px-3 font-extrabold bg-sky-50/45 dark:bg-sky-950/35">
                      {formatPressureValue(activeHour.surfacePressureHpa.mean)}
                    </td>
                    {WEATHER_MODELS.map((modelId) => {
                      const p = nativeHourByModel[modelId]?.surfacePressure;
                      return (
                        <td key={modelId} className="py-2 px-3 font-semibold">
                          {typeof p === 'number' && Number.isFinite(p)
                            ? formatPressureValue(p)
                            : '—'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-sky-300">
                      {formatSpreadRange(
                        activeHour.surfacePressureHpa.min,
                        activeHour.surfacePressureHpa.max,
                        activeHour.surfacePressureHpa.stdDev,
                        getPressureUnitLabel(units.pressure),
                        units.pressure === 'inhg' ? 2 : 1,
                        (v) => convertPressure(v, units.pressure) ?? v,
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Confidence Sub-Breakdown Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
            <div className="rounded-xl bg-[#f4f8fb] dark:bg-[#0d1f36] px-3 py-2 border border-slate-200/70 dark:border-sky-800">
              <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                Acordo Inter-Modelos
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.modelAgreement.toFixed(1)} / 50 pts
              </span>
            </div>
            <div className="rounded-xl bg-[#f4f8fb] dark:bg-[#0d1f36] px-3 py-2 border border-slate-200/70 dark:border-sky-800">
              <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                Integridade das Fontes
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.sourceIntegrity.toFixed(1)} / 30 pts
              </span>
            </div>
            <div className="rounded-xl bg-[#f4f8fb] dark:bg-[#0d1f36] px-3 py-2 border border-slate-200/70 dark:border-sky-800">
              <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                Proximidade Temporal
              </span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {confidence.breakdown.timeHorizon.toFixed(1)} / 20 pts
              </span>
            </div>
            <div className="rounded-xl bg-[#f4f8fb] dark:bg-[#0d1f36] px-3 py-2 border border-slate-200/70 dark:border-sky-800">
              <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                Coerência Direcional (R)
              </span>
              <span className="font-extrabold text-emerald-700 dark:text-emerald-300">
                {activeHour?.windDirection10m.resultantLengthR !== null &&
                activeHour?.windDirection10m.resultantLengthR !== undefined
                  ? `${Math.round(activeHour.windDirection10m.resultantLengthR * 100)}%`
                  : 'Estável'}
              </span>
            </div>
          </div>
        </CollapsibleModule>

        {/* 3. On-Demand Plot Toggle Controls */}
        <section
          data-testid="comparison-plots-toggles"
          aria-label="Controles de Gráficos Analíticos Sob Demanda"
          className="rounded-2xl border border-sky-200/85 dark:border-sky-800/75 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-900/60 text-[#0080cd] dark:text-sky-300 border border-sky-200/80 dark:border-sky-700/60">
                <BarChart3 className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Gráficos Analíticos Sob Demanda ({horizonHours}h)
                </h2>
                <p className="text-xs text-slate-500 dark:text-sky-200/80">
                  Mantenha a leitura enxuta ou habilite apenas as curvas meteorológicas que deseja inspecionar
                </p>
              </div>
            </div>

            {/* Master Toggle */}
            <button
              type="button"
              data-testid="master-plots-toggle"
              onClick={handleMasterPlotsToggle}
              aria-pressed={showAnalyticalPlots}
              className={`min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 border shrink-0 transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                showAnalyticalPlots
                  ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                  : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-800 dark:text-sky-100 border-sky-200 dark:border-sky-700 hover:bg-sky-50'
              }`}
            >
              {showAnalyticalPlots ? (
                <Eye className="w-4 h-4" aria-hidden="true" />
              ) : (
                <EyeOff className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
              )}
              <span>Exibir Gráficos Analíticos</span>
            </button>
          </div>

          {/* Per-Plot Toggle Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {(
              [
                {
                  key: 'windAndVertical' as const,
                  label: 'Vento & Perfil Vertical',
                  Icon: Wind,
                },
                {
                  key: 'rainAndPressure' as const,
                  label: 'Chuva & Pressão',
                  Icon: CloudRain,
                },
                {
                  key: 'wavesAndMsl' as const,
                  label: 'Ondas & Maré MSL',
                  Icon: Waves,
                },
                {
                  key: 'stratifiedClouds' as const,
                  label: 'Nebulosidade Estratificada',
                  Icon: Cloud,
                },
              ] as const
            ).map(({ key, label, Icon }) => {
              const isActive = showAnalyticalPlots && plotToggles[key];
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`plot-toggle-${key}`}
                  onClick={() => handleTogglePlotGroup(key)}
                  aria-pressed={isActive}
                  className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 border transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isActive
                      ? 'bg-sky-50 dark:bg-sky-900/70 text-[#0070b8] dark:text-sky-100 border-sky-400 dark:border-sky-500 shadow-xs'
                      : 'bg-white dark:bg-[#0d1f36]/65 text-slate-600 dark:text-sky-200/80 border-slate-200 dark:border-sky-800 hover:bg-sky-50/70'
                  }`}
                >
                  {isActive ? (
                    <Check className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                  ) : (
                    <Icon className="w-4 h-4 text-slate-400 dark:text-sky-400/75" aria-hidden="true" />
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. On-Demand ForecastCharts (Rendered ONLY when requested) */}
        {showAnalyticalPlots && (
          <ForecastCharts
            forecast={forecast}
            viewMode={viewMode}
            showInterpolatedProfile={showInterpolatedProfile}
            horizonHours={horizonHours}
            selectedHourIndex={safeHourIndex}
            currentHourIndex={currentLocalHourIndex}
            onSelectHourIndex={handleSelectHourIndex}
            onResetToCurrentHour={
              manualHourIndex !== null ? () => setManualHourIndex(null) : undefined
            }
            isDark={isDark}
            visibleParams={chartsVisibleParams}
          />
        )}

        {/* 5. Multi-Model 168h Windguru Table + Fullscreen Action */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-xs font-bold text-slate-600 dark:text-sky-200">
              Grade Horária Multi-Modelo Estilo Windguru ({Math.min(forecast.hours.length, horizonHours)}h)
            </span>
            <button
              type="button"
              data-testid="table-fullscreen-btn"
              onClick={() => setIsTableFullscreen(true)}
              aria-label="Abrir tabela multi-modelo em Tela Cheia"
              title="Tela Cheia da Tabela"
              className="min-h-[44px] min-w-[44px] p-2 sm:px-3 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 bg-white dark:bg-[#132a47] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-[#0070b8] dark:text-sky-200 border border-sky-200 dark:border-sky-700 shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <Maximize2 className="w-4 h-4 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
            </button>
          </div>

          {renderWindguruTableInstance()}
        </div>

        {/* Fullscreen Portal Modal for Windguru 168h Table */}
        {isTableFullscreen &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Tabela Multi-Modelo em Tela Cheia"
              data-testid="table-fullscreen-modal"
              onClick={() => setIsTableFullscreen(false)}
              className="fixed inset-0 z-[85] bg-slate-950/80 backdrop-blur-sm flex flex-col p-2 sm:p-5 overflow-y-auto"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[98vw] mx-auto my-auto rounded-3xl border border-sky-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0b192c] p-3 sm:p-5 shadow-2xl space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#132a47] px-4 py-3 rounded-2xl border border-slate-200 dark:border-sky-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                      Tabela Multi-Modelo ({Math.min(forecast.hours.length, horizonHours)}h) —{' '}
                      {activeLocation.name}
                    </h3>
                    <div className="inline-flex items-center gap-1">
                      {COMPARISON_HORIZONS.map((h) => (
                        <button
                          key={h.hours}
                          type="button"
                          onClick={() => setHorizonHours(h.hours)}
                          aria-pressed={horizonHours === h.hours}
                          className={`min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                            horizonHours === h.hours
                              ? 'bg-[#0080cd] text-white border-[#0080cd]'
                              : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800'
                          }`}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsTableFullscreen(false)}
                    aria-label="Reduzir tabela em tela cheia"
                    className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 bg-[#0080cd] hover:bg-[#006bb3] text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <Minimize2 className="w-4 h-4" aria-hidden="true" />
                    <span>Reduzir</span>
                  </button>
                </div>

                {renderWindguruTableInstance()}
              </div>
            </div>,
            document.body,
          )}

        {/* Safe Window Thresholds Modal */}
        <ThresholdSettingsModal
          isOpen={isThresholdModalOpen}
          onClose={() => setIsThresholdModalOpen(false)}
          thresholds={activeThresholds}
          onSaveThresholds={async (next) => {
            if (onSaveThresholds) {
              await onSaveThresholds(next);
            }
          }}
          onToast={onToast}
        />
      </div>
    </ModuleErrorBoundary>
  );
};
