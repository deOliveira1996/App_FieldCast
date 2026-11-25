import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  GitCompare,
  Navigation,
  Sliders,
  SlidersHorizontal,
  Table,
} from 'lucide-react';
import { useUnits } from '../../context/UnitsContext';
import {
  convertPrecipitation,
  convertPressure,
  convertTemperature,
  convertWaveHeight,
  convertWindSpeed,
} from '../../utils/units';
import type {
  EnsembleHour,
  ForecastViewMode,
  NativeModelHour,
  NormalizedForecast,
  SafeWindowStatus,
} from '../../types/weather';
import { formatLocalHourBadge, useCurrentLocalHourIndex } from '../../utils/localTimeHour';
import {
  type ComparableVariableId,
  detectSharedComparableVariables,
  MODEL_SHORT_LABELS,
  type SharedComparableVariableStatus,
} from '../../utils/modelComparison';
import { HelpPopover } from '../common/HelpPopover';
import type { ForecastHorizonHours } from './ModelSelectorBar';
import {
  COMPLETE_VISIBLE_PARAMS,
  FORECAST_PARAM_DEFINITIONS,
  type ForecastParamKey,
  type ForecastVisibleParams,
} from './forecastParamsVisibility';

export interface WindguruTableProps {
  forecast: NormalizedForecast;
  viewMode: ForecastViewMode;
  showInterpolatedProfile: boolean;
  horizonHours?: ForecastHorizonHours;
  selectedHourIndex: number;
  currentHourIndex?: number;
  onSelectHourIndex: (index: number) => void;
  visibleParams?: ForecastVisibleParams;
  onToggleParam?: (key: ForecastParamKey) => void;
  onOpenThresholdModal?: () => void;
}

const SEMAPHORE_CELL_CLASS: Record<SafeWindowStatus, string> = {
  green: 'bg-emerald-500 text-white font-extrabold',
  amber: 'bg-amber-400 text-slate-950 font-extrabold',
  red: 'bg-rose-500 text-white font-extrabold',
};

/**
 * Windguru authentic color heatmap progression:
 * light cyan -> mint green -> yellow -> orange -> coral/magenta
 */
function getWindSpeedBgClass(speedKmh: number | null): string {
  if (speedKmh === null || Number.isNaN(speedKmh)) {
    return 'bg-white dark:bg-[#132a47] text-slate-400';
  }
  if (speedKmh < 8) {
    return 'bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-100';
  }
  if (speedKmh < 14) {
    return 'bg-[#ccf2ff] dark:bg-sky-900/60 text-slate-900 dark:text-sky-100 font-semibold';
  }
  if (speedKmh < 21) {
    return 'bg-[#80ffbf] dark:bg-emerald-800/70 text-slate-950 dark:text-emerald-100 font-bold';
  }
  if (speedKmh < 29) {
    return 'bg-[#ffff80] dark:bg-amber-600/70 text-slate-950 dark:text-amber-50 font-bold';
  }
  if (speedKmh < 38) {
    return 'bg-[#ffbf66] dark:bg-orange-600/80 text-slate-950 dark:text-white font-extrabold';
  }
  if (speedKmh < 50) {
    return 'bg-[#ff7373] dark:bg-rose-600/85 text-white font-extrabold';
  }
  return 'bg-[#d966ff] dark:bg-fuchsia-600/90 text-white font-extrabold';
}

function getWaveBgClass(waveM: number | null | undefined): string {
  if (waveM === null || waveM === undefined || Number.isNaN(waveM)) {
    return 'bg-white dark:bg-[#132a47] text-slate-400';
  }
  if (waveM < 0.7) {
    return 'bg-[#f0f9ff] dark:bg-sky-950/50 text-sky-900 dark:text-sky-200';
  }
  if (waveM < 1.5) {
    return 'bg-[#bae6fd] dark:bg-sky-900/70 text-sky-950 dark:text-sky-100 font-bold';
  }
  if (waveM < 2.5) {
    return 'bg-[#7dd3fc] dark:bg-sky-800/80 text-sky-950 dark:text-white font-extrabold';
  }
  return 'bg-[#0284c7] text-white font-extrabold';
}

function getRainBgClass(mm: number | null): string {
  if (!mm || mm <= 0.05) {
    return 'bg-white dark:bg-[#132a47] text-slate-300 dark:text-slate-600';
  }
  if (mm < 1.2) {
    return 'bg-[#cce6ff] dark:bg-sky-900/70 text-sky-950 dark:text-sky-100 font-semibold';
  }
  if (mm < 4) {
    return 'bg-[#66b3ff] dark:bg-sky-700 text-slate-950 dark:text-white font-bold';
  }
  return 'bg-[#0073e6] text-white font-extrabold';
}

function getPrecipProbBgClass(pct: number | null): string {
  if (pct === null || Number.isNaN(pct) || pct < 15) {
    return 'bg-white dark:bg-[#132a47] text-slate-400 dark:text-slate-500';
  }
  if (pct < 45) {
    return 'bg-[#e0f2fe] dark:bg-sky-950/60 text-sky-900 dark:text-sky-200';
  }
  if (pct < 75) {
    return 'bg-[#bae6fd] dark:bg-sky-900/70 text-sky-950 dark:text-sky-100 font-semibold';
  }
  return 'bg-[#38bdf8] dark:bg-sky-700 text-slate-950 dark:text-white font-bold';
}

function getTempBgClass(tempC: number | null): string {
  if (tempC === null || Number.isNaN(tempC)) {
    return 'bg-white dark:bg-[#132a47] text-slate-400';
  }
  if (tempC < 16) {
    return 'bg-[#e0f2fe] dark:bg-sky-950/60 text-slate-800 dark:text-sky-100 font-semibold';
  }
  if (tempC < 23) {
    return 'bg-[#fef9c3] dark:bg-amber-950/40 text-slate-900 dark:text-amber-100 font-semibold';
  }
  if (tempC < 28) {
    return 'bg-[#ffedd5] dark:bg-orange-950/50 text-slate-900 dark:text-orange-100 font-bold';
  }
  return 'bg-[#fed7aa] dark:bg-orange-900/70 text-slate-950 dark:text-white font-extrabold';
}

function getVisibilityBgClass(visMeters: number | null): string {
  if (visMeters === null || Number.isNaN(visMeters)) {
    return 'bg-white dark:bg-[#132a47] text-slate-400';
  }
  if (visMeters < 1000) {
    return 'bg-rose-100 dark:bg-rose-900/70 text-rose-900 dark:text-rose-100 font-bold';
  }
  if (visMeters < 4000) {
    return 'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 font-semibold';
  }
  return 'bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-100';
}

function getCloudCellBgClass(pct: number | null): string {
  if (pct === null || Number.isNaN(pct) || pct < 15) {
    return 'bg-white dark:bg-[#132a47] text-slate-300 dark:text-slate-600';
  }
  if (pct < 45) {
    return 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300';
  }
  if (pct < 75) {
    return 'bg-slate-200/90 dark:bg-slate-700/80 text-slate-800 dark:text-slate-100 font-semibold';
  }
  return 'bg-slate-300 dark:bg-slate-600 text-slate-950 dark:text-white font-bold';
}

function formatDayGroupHeader(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    return d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return new Date(timestampUnix * 1000).toISOString().slice(0, 10);
  }
}

function formatHourOnly(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return '00';
  }
}

const DirectionArrow: React.FC<{ degree: number | null | undefined; label?: string }> = ({
  degree,
  label,
}) => {
  if (degree === null || degree === undefined || Number.isNaN(degree)) {
    return <span className="text-slate-300">—</span>;
  }
  const blowToRotation = (degree + 180) % 360;
  return (
    <span
      title={`${label ?? 'Direção'}: ${Math.round(degree)}°`}
      className="inline-flex flex-col items-center justify-center leading-none py-0.5"
    >
      <Navigation
        className="w-3.5 h-3.5 text-slate-900 dark:text-white fill-slate-900 dark:fill-white"
        style={{ transform: `rotate(${blowToRotation}deg)` }}
        aria-hidden="true"
      />
    </span>
  );
};

export const WindguruTable: React.FC<WindguruTableProps> = ({
  forecast,
  viewMode,
  showInterpolatedProfile,
  horizonHours,
  selectedHourIndex,
  currentHourIndex,
  onSelectHourIndex,
  visibleParams = COMPLETE_VISIBLE_PARAMS,
  onToggleParam,
  onOpenThresholdModal,
}) => {
  const { units, windLabel, tempLabel, waveLabel, pressureLabel, precipLabel } = useUnits();
  const [expandedCompareVars, setExpandedCompareVars] = useState<
    Partial<Record<ComparableVariableId, boolean>>
  >({});
  const [isInlineTuneOpen, setIsInlineTuneOpen] = useState<boolean>(false);
  const [isHudCompact, setIsHudCompact] = useState<boolean>(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const currentHourHeaderRef = useRef<HTMLTableCellElement | null>(null);

  const hours: EnsembleHour[] = useMemo(
    () => (horizonHours !== undefined ? forecast.hours.slice(0, horizonHours) : forecast.hours),
    [forecast.hours, horizonHours],
  );

  const liveCurrentHourIndex = useCurrentLocalHourIndex(
    currentHourIndex === undefined ? hours : undefined,
    forecast.timezone,
  );
  const resolvedCurrentHourIndex = currentHourIndex ?? liveCurrentHourIndex;

  const hasCurrentHourInSlice =
    resolvedCurrentHourIndex >= 0 && resolvedCurrentHourIndex < hours.length;
  const currentHourBadgeText = hasCurrentHourInSlice
    ? formatLocalHourBadge(hours[resolvedCurrentHourIndex]!.timestampUnix, forecast.timezone)
    : null;

  const scrollCurrentHourHorizontally = (smooth = true) => {
    const container = tableScrollRef.current;
    const headerEl = currentHourHeaderRef.current;
    if (!container || !headerEl) {
      return;
    }
    const stickyColWidth = container.clientWidth > 0 && container.clientWidth < 640 ? 116 : 148;
    const targetLeft = Math.max(0, headerEl.offsetLeft - stickyColWidth);
    if (smooth && typeof container.scrollTo === 'function') {
      container.scrollTo({ left: targetLeft, behavior: 'smooth' });
    } else {
      container.scrollLeft = targetLeft;
    }
  };

  // Posiciona horizontalmente no horário local atual na abertura/troca de estação (sem scrollIntoView)
  useEffect(() => {
    const container = tableScrollRef.current;
    const headerEl = currentHourHeaderRef.current;
    if (!container || !headerEl) {
      return;
    }
    const stickyColWidth = container.clientWidth > 0 && container.clientWidth < 640 ? 116 : 148;
    container.scrollLeft = Math.max(0, headerEl.offsetLeft - stickyColWidth);
  }, [forecast.latitude, forecast.longitude, resolvedCurrentHourIndex, viewMode, horizonHours]);

  const fmtWindCell = (kmh: number | null | undefined, suffix = ''): string => {
    const v = convertWindSpeed(kmh, units.wind);
    if (v === null) return '—';
    const rounded = units.wind === 'ms' ? v.toFixed(1) : String(Math.round(v));
    return `${rounded}${suffix}`;
  };

  const fmtTempCell = (c: number | null | undefined): string => {
    const v = convertTemperature(c, units.temperature);
    return v !== null ? String(Math.round(v)) : '—';
  };

  const fmtWaveCell = (m: number | null | undefined): string => {
    const v = convertWaveHeight(m, units.wave);
    return v !== null ? v.toFixed(1) : '—';
  };

  const fmtPrecipCell = (mm: number | null | undefined, showZero = false): string => {
    const v = convertPrecipitation(mm, units.precipitation);
    if (v === null) return showZero ? '—' : '';
    if (!showZero && (mm ?? 0) <= 0.05) return '';
    return units.precipitation === 'in' ? v.toFixed(2) : v.toFixed(1);
  };

  const fmtPressCell = (hpa: number | null | undefined): string => {
    const v = convertPressure(hpa, units.pressure);
    if (v === null) return '—';
    return units.pressure === 'inhg' ? v.toFixed(2) : String(Math.round(v));
  };

  const isNative =
    viewMode === 'ecmwf_ifs025' ||
    viewMode === 'gfs_seamless' ||
    viewMode === 'icon_seamless' ||
    viewMode === 'gem_seamless';
  const nativeList: NativeModelHour[] = isNative
    ? (forecast.nativeByModel[viewMode] ?? []).slice(0, hours.length)
    : [];

  const sharedStatuses = useMemo(
    () => detectSharedComparableVariables(forecast, hours.length),
    [forecast, hours.length],
  );

  const sharedById = useMemo(() => {
    const map = {} as Record<ComparableVariableId, SharedComparableVariableStatus>;
    for (const s of sharedStatuses) {
      map[s.id] = s;
    }
    return map;
  }, [sharedStatuses]);

  const visibleComparableVarIds = useMemo(
    () =>
      sharedStatuses
        .filter((status) => status.isComparable && visibleParams[status.definition.group])
        .map((status) => status.id),
    [sharedStatuses, visibleParams],
  );

  const expandedVisibleCount = useMemo(
    () => visibleComparableVarIds.filter((id) => Boolean(expandedCompareVars[id])).length,
    [visibleComparableVarIds, expandedCompareVars],
  );

  const allComparableExpanded =
    visibleComparableVarIds.length > 0 &&
    expandedVisibleCount === visibleComparableVarIds.length;
  const someComparableExpanded = expandedVisibleCount > 0 && !allComparableExpanded;

  const toggleVariableCompare = (varId: ComparableVariableId) => {
    setExpandedCompareVars((prev) => ({
      ...prev,
      [varId]: !prev[varId],
    }));
  };

  const handleGlobalCompareToggle = () => {
    if (allComparableExpanded) {
      setExpandedCompareVars({});
      return;
    }
    setExpandedCompareVars((prev) => {
      const next = { ...prev };
      for (const id of visibleComparableVarIds) {
        next[id] = true;
      }
      return next;
    });
  };

  const handleCollapseAllCompare = () => {
    setExpandedCompareVars({});
  };

  const dayGroups = useMemo(() => {
    const groups: Array<{ dayLabel: string; count: number }> = [];
    for (const h of hours) {
      const lbl = formatDayGroupHeader(h.timestampUnix, forecast.timezone);
      const last = groups[groups.length - 1];
      if (last && last.dayLabel === lbl) {
        last.count += 1;
      } else {
        groups.push({ dayLabel: lbl, count: 1 });
      }
    }
    return groups;
  }, [hours, forecast.timezone]);

  const getInterpolatedSpeed = (h: EnsembleHour, targetHeight: number): number | null => {
    if (!showInterpolatedProfile) {
      return null;
    }
    const found = h.verticalProfile.interpolatedLevels.find(
      (lvl) => lvl.heightM === targetHeight,
    );
    return found?.speedKmh ?? null;
  };

  const getCurrentColBorderClass = (idx: number): string =>
    idx === resolvedCurrentHourIndex
      ? 'border-l-2 border-l-amber-500 [border-left-style:dashed]'
      : '';

  const renderVariableHeaderCell = (
    label: string,
    varId?: ComparableVariableId,
    options?: {
      thClassName?: string;
      extraBadge?: React.ReactNode;
    },
  ) => {
    const status = varId ? sharedById[varId] : undefined;
    const isComparable = Boolean(status?.isComparable);
    const isExpanded = Boolean(varId && expandedCompareVars[varId]);

    return (
      <th
        className={
          options?.thClassName ??
          'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-bold text-slate-800 dark:text-sky-100 border-r border-slate-200 dark:border-sky-800'
        }
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate">{label}</span>
            {options?.extraBadge}
          </div>
          {isComparable && varId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleVariableCompare(varId);
              }}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Ocultar' : 'Expandir'} comparação de modelos para ${label}`}
              title={`${isExpanded ? 'Ocultar' : 'Comparar'} modelos (${status?.activeModels.length ?? 0} modelos)`}
              data-testid={`compare-toggle-${varId}`}
              className={`min-h-[24px] min-w-[24px] p-0.5 rounded-md inline-flex items-center justify-center border transition-colors shrink-0 ${
                isExpanded
                  ? 'bg-[#0080cd] text-white border-[#0080cd]'
                  : 'bg-sky-50 dark:bg-[#0d1f36] text-slate-600 dark:text-sky-200 border-slate-200 dark:border-sky-700 hover:bg-sky-100 dark:hover:bg-sky-900/50'
              }`}
            >
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </th>
    );
  };

  const renderCompareSubRows = (
    varId: ComparableVariableId,
    renderValue: (hour: NativeModelHour | undefined) => React.ReactNode,
    getCellBg: (hour: NativeModelHour | undefined) => string,
  ) => {
    const status = sharedById[varId];
    if (!status?.isComparable || !expandedCompareVars[varId]) {
      return null;
    }

    return status.activeModels.map((modelId) => {
      const modelHours = (forecast.nativeByModel[modelId] ?? []).slice(0, hours.length);
      return (
        <tr
          key={`${varId}_${modelId}`}
          data-compare-row={`${varId}:${modelId}`}
          className="text-[10px]"
        >
          <th className="sticky left-0 z-10 bg-[#f8fafc] dark:bg-[#0d1f36] pl-5 pr-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
            <div className="flex items-center justify-between gap-1">
              <span>↳ {MODEL_SHORT_LABELS[modelId]}</span>
            </div>
          </th>
          {hours.map((h, idx) => {
            const mHour = modelHours[idx];
            const isCurrentCol = idx === resolvedCurrentHourIndex;
            return (
              <td
                key={h.timestampUnix}
                data-current-hour-cell={isCurrentCol ? 'true' : undefined}
                onClick={() => onSelectHourIndex(idx)}
                className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getCellBg(
                  mHour,
                )} ${getCurrentColBorderClass(idx)}`}
              >
                {renderValue(mHour)}
              </td>
            );
          })}
        </tr>
      );
    });
  };

  return (
    <section
      aria-label="Tabela Horária Compacta Estilo Windguru (168h)"
      className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] shadow-sm"
    >
      {/* Windguru-Style Clean Action Toolbar (Tune / Compare / Limites) */}
      <div className="px-3 py-2 sm:px-4 sm:py-2.5 rounded-t-2xl border-b border-slate-200 dark:border-sky-800/70 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#132a47]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="px-2 py-0.5 rounded-lg bg-[#0080cd] text-white text-[11px] font-extrabold tracking-tight flex items-center gap-1">
            <Table className="w-3.5 h-3.5" aria-hidden="true" />
            <span>FieldCast</span>
          </div>
          {!isHudCompact && (
            <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
              Tabela ({hours.length}h)
            </h2>
          )}
          {hasCurrentHourInSlice && currentHourBadgeText && (
            <button
              type="button"
              onClick={() => {
                onSelectHourIndex(resolvedCurrentHourIndex);
                scrollCurrentHourHorizontally(true);
              }}
              className="min-h-[30px] px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 inline-flex items-center gap-1 transition-colors"
            >
              <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>Agora: {currentHourBadgeText}</span>
            </button>
          )}
        </div>

        {/* Windguru Action Buttons: Parâmetros (Tune), Comparar Modelos (Expandir/Recolher Todas), Limites */}
        <div className="flex flex-wrap items-center gap-1.5">
          {!isHudCompact && (
            <button
              type="button"
              onClick={() => setIsInlineTuneOpen((prev) => !prev)}
              aria-expanded={isInlineTuneOpen}
              aria-label="Parâmetros da tabela (Tune)"
              title="Parâmetros da tabela"
              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1 border transition-colors ${
                isInlineTuneOpen
                  ? 'bg-[#0080cd] text-white border-[#0080cd]'
                  : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Tune</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleGlobalCompareToggle}
            aria-pressed={allComparableExpanded}
            data-testid="compare-all-toggle"
            disabled={visibleComparableVarIds.length === 0}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1 border transition-colors disabled:opacity-50 ${
              allComparableExpanded || someComparableExpanded
                ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {allComparableExpanded
                ? `Recolher Todas (${expandedVisibleCount}/${visibleComparableVarIds.length})`
                : someComparableExpanded
                  ? `Expandir Todas (${expandedVisibleCount}/${visibleComparableVarIds.length})`
                  : `Comparar Modelos (${visibleComparableVarIds.length})`}
            </span>
          </button>

          {someComparableExpanded && (
            <button
              type="button"
              onClick={handleCollapseAllCompare}
              data-testid="collapse-all-compare"
              className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 bg-slate-100 dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 hover:bg-slate-200 transition-colors"
            >
              Recolher todas
            </button>
          )}

          {!isHudCompact && onOpenThresholdModal && (
            <button
              type="button"
              onClick={onOpenThresholdModal}
              aria-label="Limites da Janela Segura"
              title="Limites da Janela Segura"
              className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 hover:bg-sky-50 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
            </button>
          )}

          {!isHudCompact && <HelpPopover topic="safe_window" />}

          <button
            type="button"
            data-testid="windguru-hud-toggle"
            onClick={() => setIsHudCompact((prev) => !prev)}
            aria-expanded={!isHudCompact}
            aria-label={isHudCompact ? 'Mostrar controles da tabela' : 'Minimizar controles da tabela'}
            title={isHudCompact ? 'Mostrar controles' : 'Minimizar controles'}
            className="min-h-[34px] min-w-[34px] p-1.5 rounded-lg bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-600 dark:text-sky-200 border border-slate-200 dark:border-sky-800 hover:bg-sky-50 inline-flex items-center justify-center transition-colors"
          >
            {isHudCompact ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Inline Windguru "Tune" Drawer to Show/Hide Table Rows */}
      {isInlineTuneOpen && onToggleParam && (
        <div className="px-4 py-2.5 bg-[#f4f8fb] dark:bg-[#0d1f36] border-b border-sky-100 dark:border-sky-800/70 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-600 dark:text-sky-200 mr-1">
            Mostrar/Ocultar linhas da tabela:
          </span>
          {FORECAST_PARAM_DEFINITIONS.filter((d) =>
            ['wind10m', 'verticalProfile', 'waves', 'rainPressure', 'tempVisibility', 'clouds'].includes(
              d.key,
            ),
          ).map((def) => {
            const active = visibleParams[def.key];
            return (
              <button
                key={def.key}
                type="button"
                onClick={() => onToggleParam(def.key)}
                aria-pressed={active}
                className={`min-h-[28px] px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                  active
                    ? 'bg-[#0080cd] text-white border-[#0080cd]'
                    : 'bg-white dark:bg-[#132a47] text-slate-500 dark:text-sky-300/70 border-slate-200 dark:border-sky-800'
                }`}
              >
                {active ? '✓ ' : '+ '}
                {def.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Scrollable Table Container */}
      <div
        ref={tableScrollRef}
        className="overflow-x-auto scrollbar-thin rounded-b-2xl bg-white dark:bg-[#132a47]"
      >
        <table className="w-full border-collapse text-center text-[11px] select-none">
          <thead>
            {/* Day Header Row */}
            <tr className="bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-800 dark:text-sky-100 border-b border-slate-200 dark:border-sky-800">
              <th className="sticky left-0 z-20 bg-[#f4f8fb] dark:bg-[#0d1f36] px-2.5 py-1 text-left font-bold min-w-[112px] sm:min-w-[144px] border-r border-slate-200 dark:border-sky-800">
                Dia / Parâmetro
              </th>
              {dayGroups.map((g, idx) => (
                <th
                  key={`${g.dayLabel}_${idx}`}
                  colSpan={g.count}
                  className="px-2 py-1.5 font-bold text-xs capitalize border-r border-slate-200 dark:border-sky-800 whitespace-nowrap"
                >
                  {g.dayLabel}
                </th>
              ))}
            </tr>

            {/* Hour Row */}
            <tr className="bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-200 border-b border-slate-200 dark:border-sky-800">
              <th className="sticky left-0 z-20 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-bold border-r border-slate-200 dark:border-sky-800">
                Horário (h)
              </th>
              {hours.map((h, idx) => {
                const isSelected = idx === selectedHourIndex;
                const isCurrent = idx === resolvedCurrentHourIndex;
                const hourOnly = formatHourOnly(h.timestampUnix, forecast.timezone);
                const fullHHMM = formatLocalHourBadge(h.timestampUnix, forecast.timezone);
                return (
                  <th
                    key={h.timestampUnix}
                    ref={isCurrent ? currentHourHeaderRef : undefined}
                    data-current-hour={isCurrent ? 'true' : undefined}
                    onClick={() => onSelectHourIndex(idx)}
                    className={`min-w-[42px] px-1 py-1 cursor-pointer transition-colors border-r border-slate-100 dark:border-sky-800/50 ${getCurrentColBorderClass(
                      idx,
                    )} ${
                      isCurrent
                        ? isSelected
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-950 dark:text-amber-100 font-extrabold ring-2 ring-inset ring-[#0080cd]'
                          : 'bg-amber-50 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100 font-extrabold'
                        : isSelected
                          ? 'bg-[#0080cd] text-white font-extrabold'
                          : 'hover:bg-sky-50 dark:hover:bg-sky-900/40'
                    }`}
                  >
                    {isCurrent ? (
                      <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold leading-none">
                        {fullHHMM}
                      </span>
                    ) : (
                      <span>{hourOnly}h</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-sky-800/50">
            {/* 1. Wind Speed 10m + Gusts 10m + Direction 10m */}
            {visibleParams.wind10m && (
              <>
                <tr>
                  {renderVariableHeaderCell(`Vento (${windLabel})`, 'windSpeed10m', {
                    extraBadge: (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 shrink-0">
                        {Math.round(forecast.overallConfidence.total)}%
                      </span>
                    ),
                  })}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.windSpeed10m ?? null
                      : h.windSpeed10m.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          val,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtWindCell(val)}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windSpeed10m',
                  (m) => fmtWindCell(m?.windSpeed10m),
                  (m) => getWindSpeedBgClass(m?.windSpeed10m ?? null),
                )}

                {/* Wind Gusts 10m */}
                <tr>
                  {renderVariableHeaderCell(`Rajadas (${windLabel})`, 'windGusts10m')}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.windGusts10m ?? null
                      : h.windGusts10m.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          val,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtWindCell(val)}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windGusts10m',
                  (m) => fmtWindCell(m?.windGusts10m),
                  (m) => getWindSpeedBgClass(m?.windGusts10m ?? null),
                )}

                {/* Wind Direction 10m Arrow */}
                <tr>
                  {renderVariableHeaderCell('Direção do vento', 'windDirection10m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-bold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const deg = isNative
                      ? nativeList[idx]?.windDirection10m ?? null
                      : h.windDirection10m.degree;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] border-r border-slate-100 dark:border-sky-800/40 ${getCurrentColBorderClass(
                          idx,
                        )}`}
                      >
                        <DirectionArrow degree={deg} label="Direção do Vento 10m" />
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windDirection10m',
                  (m) => <DirectionArrow degree={m?.windDirection10m} label="Direção do Vento 10m" />,
                  () => 'bg-white dark:bg-[#132a47]',
                )}
              </>
            )}

            {/* 2. Marine Waves, Period & Direction (single ocean grid -> no multi-model compare arrow) */}
            {visibleParams.waves && forecast.marineAvailable && (
              <>
                <tr>
                  {renderVariableHeaderCell(`Ondas (${waveLabel})`)}
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                      onClick={() => onSelectHourIndex(idx)}
                      className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWaveBgClass(
                        h.marine?.waveHeight,
                      )} ${getCurrentColBorderClass(idx)}`}
                    >
                      {fmtWaveCell(h.marine?.waveHeight)}
                    </td>
                  ))}
                </tr>

                <tr>
                  {renderVariableHeaderCell('Período de vaga (s)', undefined, {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                      onClick={() => onSelectHourIndex(idx)}
                      className={`px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-200 font-semibold border-r border-slate-100 dark:border-sky-800/40 ${getCurrentColBorderClass(
                        idx,
                      )}`}
                    >
                      {h.marine?.wavePeriod !== null && h.marine?.wavePeriod !== undefined
                        ? Math.round(h.marine.wavePeriod)
                        : '—'}
                    </td>
                  ))}
                </tr>

                <tr>
                  {renderVariableHeaderCell('Direção das ondas', undefined, {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                      onClick={() => onSelectHourIndex(idx)}
                      className={`px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] border-r border-slate-100 dark:border-sky-800/40 ${getCurrentColBorderClass(
                        idx,
                      )}`}
                    >
                      <DirectionArrow degree={h.marine?.waveDirection} label="Direção da Onda" />
                    </td>
                  ))}
                </tr>
              </>
            )}

            {/* 3. Vertical Profile Rows (80m / 100m / 120m speed & direction) */}
            {visibleParams.verticalProfile && (
              <>
                <tr>
                  {renderVariableHeaderCell(`Vento 80m (${windLabel})`, 'windSpeed80m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-semibold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const nativeVal = isNative
                      ? nativeList[idx]?.windSpeed80m ?? null
                      : h.windSpeed80m.mean;
                    const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 80) : null;
                    const finalVal = nativeVal ?? interpVal;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          finalVal,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtWindCell(finalVal, interpVal !== null ? '*' : '')}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windSpeed80m',
                  (m) => fmtWindCell(m?.windSpeed80m),
                  (m) => getWindSpeedBgClass(m?.windSpeed80m ?? null),
                )}

                <tr>
                  {renderVariableHeaderCell('Direção 80m', 'windDirection80m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const deg = isNative
                      ? nativeList[idx]?.windDirection80m ?? null
                      : h.windDirection80m.degree;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] border-r border-slate-100 dark:border-sky-800/40 ${getCurrentColBorderClass(
                          idx,
                        )}`}
                      >
                        <DirectionArrow degree={deg} label="Direção do Vento 80m" />
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windDirection80m',
                  (m) => <DirectionArrow degree={m?.windDirection80m} label="Direção do Vento 80m" />,
                  () => 'bg-white dark:bg-[#132a47]',
                )}

                <tr>
                  {renderVariableHeaderCell(`Vento 100m (${windLabel})`, 'windSpeed100m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-semibold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const nativeVal = isNative
                      ? nativeList[idx]?.windSpeed100m ?? null
                      : h.windSpeed100m.mean;
                    const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 100) : null;
                    const finalVal = nativeVal ?? interpVal;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          finalVal,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtWindCell(finalVal, interpVal !== null ? '*' : '')}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windSpeed100m',
                  (m) => fmtWindCell(m?.windSpeed100m),
                  (m) => getWindSpeedBgClass(m?.windSpeed100m ?? null),
                )}

                <tr>
                  {renderVariableHeaderCell('Direção 100m', 'windDirection100m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const deg = isNative
                      ? nativeList[idx]?.windDirection100m ?? null
                      : h.windDirection100m.degree;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] border-r border-slate-100 dark:border-sky-800/40 ${getCurrentColBorderClass(
                          idx,
                        )}`}
                      >
                        <DirectionArrow degree={deg} label="Direção do Vento 100m" />
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windDirection100m',
                  (m) => <DirectionArrow degree={m?.windDirection100m} label="Direção do Vento 100m" />,
                  () => 'bg-white dark:bg-[#132a47]',
                )}

                <tr>
                  {renderVariableHeaderCell(`Vento 120m (${windLabel})`, 'windSpeed120m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-semibold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const nativeVal = isNative
                      ? nativeList[idx]?.windSpeed120m ?? null
                      : h.windSpeed120m.mean;
                    const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 120) : null;
                    const finalVal = nativeVal ?? interpVal;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          finalVal,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtWindCell(finalVal, interpVal !== null ? '*' : '')}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windSpeed120m',
                  (m) => fmtWindCell(m?.windSpeed120m),
                  (m) => getWindSpeedBgClass(m?.windSpeed120m ?? null),
                )}

                <tr>
                  {renderVariableHeaderCell('Direção 120m', 'windDirection120m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const deg = isNative
                      ? nativeList[idx]?.windDirection120m ?? null
                      : h.windDirection120m.degree;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] border-r border-slate-100 dark:border-sky-800/40 ${getCurrentColBorderClass(
                          idx,
                        )}`}
                      >
                        <DirectionArrow degree={deg} label="Direção do Vento 120m" />
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'windDirection120m',
                  (m) => <DirectionArrow degree={m?.windDirection120m} label="Direção do Vento 120m" />,
                  () => 'bg-white dark:bg-[#132a47]',
                )}
              </>
            )}

            {/* 4. Temperature 2m, Dew Point 2m & Visibility */}
            {visibleParams.tempVisibility && (
              <>
                <tr>
                  {renderVariableHeaderCell(`Temperatura (${tempLabel})`, 'temperature2m')}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.temperature2m ?? null
                      : h.temperature2mC.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getTempBgClass(
                          val,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtTempCell(val)}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'temperature2m',
                  (m) => fmtTempCell(m?.temperature2m),
                  (m) => getTempBgClass(m?.temperature2m ?? null),
                )}

                <tr>
                  {renderVariableHeaderCell(`Ponto de Orvalho (${tempLabel})`, 'dewPoint2m', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.dewPoint2m ?? null
                      : h.dewPoint2mC.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getTempBgClass(
                          val,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtTempCell(val)}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'dewPoint2m',
                  (m) => fmtTempCell(m?.dewPoint2m),
                  (m) => getTempBgClass(m?.dewPoint2m ?? null),
                )}

                <tr>
                  {renderVariableHeaderCell('Visibilidade (km)', 'visibility', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.visibility ?? null
                      : h.visibilityM.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getVisibilityBgClass(
                          val,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {val !== null ? (val / 1000).toFixed(1) : '—'}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'visibility',
                  (m) => (m?.visibility !== null && m?.visibility !== undefined ? (m.visibility / 1000).toFixed(1) : '—'),
                  (m) => getVisibilityBgClass(m?.visibility ?? null),
                )}
              </>
            )}

            {/* 5. Stratified Clouds High / Mid / Low (%) */}
            {visibleParams.clouds && (
              <>
                <tr className="text-[10px]">
                  {renderVariableHeaderCell('Nuvens Altas (%)', 'cloudCoverHigh', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const high = isNative
                      ? nativeList[idx]?.cloudCoverHigh ?? 0
                      : h.cloudCover.highPct.mean ?? 0;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-0.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getCloudCellBgClass(
                          high,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {Math.round(high) > 5 ? Math.round(high) : ''}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'cloudCoverHigh',
                  (m) => (m?.cloudCoverHigh !== null && m?.cloudCoverHigh !== undefined ? Math.round(m.cloudCoverHigh) : '—'),
                  (m) => getCloudCellBgClass(m?.cloudCoverHigh ?? null),
                )}

                <tr className="text-[10px]">
                  {renderVariableHeaderCell('Nuvens Médias (%)', 'cloudCoverMid', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const mid = isNative
                      ? nativeList[idx]?.cloudCoverMid ?? 0
                      : h.cloudCover.midPct.mean ?? 0;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-0.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getCloudCellBgClass(
                          mid,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {Math.round(mid) > 5 ? Math.round(mid) : ''}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'cloudCoverMid',
                  (m) => (m?.cloudCoverMid !== null && m?.cloudCoverMid !== undefined ? Math.round(m.cloudCoverMid) : '—'),
                  (m) => getCloudCellBgClass(m?.cloudCoverMid ?? null),
                )}

                <tr className="text-[10px]">
                  {renderVariableHeaderCell('Nuvens Baixas (%)', 'cloudCoverLow', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const low = isNative
                      ? nativeList[idx]?.cloudCoverLow ?? 0
                      : h.cloudCover.lowPct.mean ?? 0;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-0.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getCloudCellBgClass(
                          low,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {Math.round(low) > 5 ? Math.round(low) : ''}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'cloudCoverLow',
                  (m) => (m?.cloudCoverLow !== null && m?.cloudCoverLow !== undefined ? Math.round(m.cloudCoverLow) : '—'),
                  (m) => getCloudCellBgClass(m?.cloudCoverLow ?? null),
                )}
              </>
            )}

            {/* 6. Precipitation, Precip Prob (%) & Surface Pressure */}
            {visibleParams.rainPressure && (
              <>
                <tr>
                  {renderVariableHeaderCell(`Precipitação (${precipLabel}/h)`, 'precipitation')}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.precipitation ?? null
                      : h.precipitationMm.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getRainBgClass(
                          val,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtPrecipCell(val, false)}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'precipitation',
                  (m) => fmtPrecipCell(m?.precipitation, true),
                  (m) => getRainBgClass(m?.precipitation ?? null),
                )}

                <tr>
                  {renderVariableHeaderCell('Prob. Chuva (%)', 'precipitationProbability', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.precipitationProbability ?? null
                      : h.precipitationProbabilityPct.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getPrecipProbBgClass(
                          val,
                        )} ${getCurrentColBorderClass(idx)}`}
                      >
                        {val !== null ? Math.round(val) : '—'}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'precipitationProbability',
                  (m) =>
                    m?.precipitationProbability !== null &&
                    m?.precipitationProbability !== undefined
                      ? Math.round(m.precipitationProbability)
                      : '—',
                  (m) => getPrecipProbBgClass(m?.precipitationProbability ?? null),
                )}

                <tr>
                  {renderVariableHeaderCell(`Pressão (${pressureLabel})`, 'surfacePressure', {
                    thClassName:
                      'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
                  })}
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.surfacePressure ?? null
                      : h.surfacePressureHpa.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${
                          h.barometricSquallRisk
                            ? 'bg-rose-100 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100 font-bold'
                            : 'bg-white dark:bg-[#132a47] text-slate-600 dark:text-sky-200/80'
                        } ${getCurrentColBorderClass(idx)}`}
                      >
                        {fmtPressCell(val)}
                      </td>
                    );
                  })}
                </tr>
                {renderCompareSubRows(
                  'surfacePressure',
                  (m) => fmtPressCell(m?.surfacePressure),
                  () => 'bg-white dark:bg-[#132a47] text-slate-600 dark:text-sky-200/80',
                )}
              </>
            )}

            {/* 7. Safe Window Semaphore Row */}
            <tr>
              {renderVariableHeaderCell('Janela Operacional', undefined, {
                thClassName:
                  'sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-bold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800',
              })}
              {hours.map((h, idx) => (
                <td
                  key={h.timestampUnix}
                  data-current-hour-cell={idx === resolvedCurrentHourIndex ? 'true' : undefined}
                  onClick={() => onSelectHourIndex(idx)}
                  title={
                    h.safeWindowReasons.length > 0
                      ? h.safeWindowReasons.join(' | ')
                      : 'Dentro dos limites operacionais'
                  }
                  className={`px-1 py-1 cursor-pointer text-[10px] border-r border-white/40 dark:border-sky-900/40 ${
                    SEMAPHORE_CELL_CLASS[h.safeWindow]
                  } ${getCurrentColBorderClass(idx)}`}
                >
                  {h.safeWindow === 'green' ? 'OK' : h.safeWindow === 'amber' ? 'ATN' : 'LIM'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};
