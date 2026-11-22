import React, { useMemo, useState } from 'react';
import { GitCompare, Navigation, Sliders, SlidersHorizontal, Table } from 'lucide-react';
import type {
  EnsembleHour,
  ForecastViewMode,
  NativeModelHour,
  NormalizedForecast,
  SafeWindowStatus,
} from '../../types/weather';
import { HelpPopover } from '../common/HelpPopover';
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
  selectedHourIndex: number;
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

function getCloudCellBgClass(pct: number): string {
  if (pct < 15) {
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
  selectedHourIndex,
  onSelectHourIndex,
  visibleParams = COMPLETE_VISIBLE_PARAMS,
  onToggleParam,
  onOpenThresholdModal,
}) => {
  const [isCompareMode, setIsCompareMode] = useState<boolean>(false);
  const [isInlineTuneOpen, setIsInlineTuneOpen] = useState<boolean>(false);

  const hours: EnsembleHour[] = forecast.hours;
  const isNative =
    viewMode === 'ecmwf_ifs025' || viewMode === 'gfs_seamless' || viewMode === 'icon_seamless';
  const nativeList: NativeModelHour[] = isNative ? forecast.nativeByModel[viewMode] ?? [] : [];

  const ecmwfList = forecast.nativeByModel.ecmwf_ifs025 ?? [];
  const gfsList = forecast.nativeByModel.gfs_seamless ?? [];
  const iconList = forecast.nativeByModel.icon_seamless ?? [];

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

  return (
    <section
      aria-label="Tabela Horária Compacta Estilo Windguru (168h)"
      className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] shadow-sm overflow-hidden"
    >
      {/* Windguru-Style Clean Action Toolbar (Tune / Compare / Limites) */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-sky-800/70 flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-[#132a47]">
        <div className="flex items-center gap-2.5">
          <div className="px-2.5 py-1 rounded-lg bg-[#0080cd] text-white text-xs font-extrabold tracking-tight flex items-center gap-1.5">
            <Table className="w-3.5 h-3.5" aria-hidden="true" />
            <span>FieldCast BLEND</span>
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
              Tabela Horária de Previsão ({hours.length}h)
            </h2>
          </div>
        </div>

        {/* Windguru Action Buttons: Parâmetros (Tune), Comparar Modelos (Compare), Limites */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsInlineTuneOpen((prev) => !prev)}
            aria-expanded={isInlineTuneOpen}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
              isInlineTuneOpen
                ? 'bg-[#0080cd] text-white border-[#0080cd]'
                : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Parâmetros (Tune)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCompareMode((prev) => !prev)}
            aria-pressed={isCompareMode}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
              isCompareMode
                ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isCompareMode ? 'Comparar Modelos: Ativo' : 'Comparar Modelos (Compare)'}</span>
          </button>

          {onOpenThresholdModal && (
            <button
              type="button"
              onClick={onOpenThresholdModal}
              className="min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 hover:bg-sky-50 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
              <span>Limites</span>
            </button>
          )}

          <HelpPopover topic="safe_window" />
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
      <div className="overflow-x-auto scrollbar-thin bg-white dark:bg-[#132a47]">
        <table className="w-full border-collapse text-center text-[11px] select-none">
          <thead>
            {/* Day Header Row */}
            <tr className="bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-800 dark:text-sky-100 border-b border-slate-200 dark:border-sky-800">
              <th className="sticky left-0 z-20 bg-[#f4f8fb] dark:bg-[#0d1f36] px-3 py-1.5 text-left font-bold min-w-[164px] border-r border-slate-200 dark:border-sky-800">
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
                return (
                  <th
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className={`min-w-[38px] px-1 py-1 cursor-pointer transition-colors border-r border-slate-100 dark:border-sky-800/50 ${
                      isSelected
                        ? 'bg-[#0080cd] text-white font-extrabold'
                        : 'hover:bg-sky-50 dark:hover:bg-sky-900/40'
                    }`}
                  >
                    {formatHourOnly(h.timestampUnix, forecast.timezone)}h
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-sky-800/50">
            {/* 1. Wind Speed 10m + Direction + Gusts 10m */}
            {visibleParams.wind10m && (
              <>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-bold text-slate-800 dark:text-sky-100 border-r border-slate-200 dark:border-sky-800 flex items-center justify-between gap-1">
                    <span>Vento (km/h)</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                      {Math.round(forecast.overallConfidence.total)}%
                    </span>
                  </th>
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.windSpeed10m ?? null
                      : h.windSpeed10m.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          val,
                        )}`}
                      >
                        {val !== null ? Math.round(val) : '—'}
                      </td>
                    );
                  })}
                </tr>

                {/* Windguru Compare Mode: Sub-rows for GFS, ECMWF, ICON */}
                {isCompareMode && (
                  <>
                    <tr className="text-[10px]">
                      <th className="sticky left-0 z-10 bg-[#f8fafc] dark:bg-[#0d1f36] pl-5 pr-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                        ↳ ECMWF 9 km
                      </th>
                      {hours.map((h, idx) => {
                        const val = ecmwfList[idx]?.windSpeed10m ?? null;
                        return (
                          <td
                            key={h.timestampUnix}
                            onClick={() => onSelectHourIndex(idx)}
                            className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                              val,
                            )}`}
                          >
                            {val !== null ? Math.round(val) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="text-[10px]">
                      <th className="sticky left-0 z-10 bg-[#f8fafc] dark:bg-[#0d1f36] pl-5 pr-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                        ↳ GFS 13 km
                      </th>
                      {hours.map((h, idx) => {
                        const val = gfsList[idx]?.windSpeed10m ?? null;
                        return (
                          <td
                            key={h.timestampUnix}
                            onClick={() => onSelectHourIndex(idx)}
                            className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                              val,
                            )}`}
                          >
                            {val !== null ? Math.round(val) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="text-[10px]">
                      <th className="sticky left-0 z-10 bg-[#f8fafc] dark:bg-[#0d1f36] pl-5 pr-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                        ↳ ICON 13 km
                      </th>
                      {hours.map((h, idx) => {
                        const val = iconList[idx]?.windSpeed10m ?? null;
                        return (
                          <td
                            key={h.timestampUnix}
                            onClick={() => onSelectHourIndex(idx)}
                            className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                              val,
                            )}`}
                          >
                            {val !== null ? Math.round(val) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}

                {/* Wind Gusts 10m */}
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-bold text-slate-800 dark:text-sky-100 border-r border-slate-200 dark:border-sky-800">
                    Rajadas (km/h)
                  </th>
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.windGusts10m ?? null
                      : h.windGusts10m.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          val,
                        )}`}
                      >
                        {val !== null ? Math.round(val) : '—'}
                      </td>
                    );
                  })}
                </tr>

                {/* Wind Direction 10m Arrow (Crisp dark arrows on clean white background) */}
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-bold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Direção do vento
                  </th>
                  {hours.map((h, idx) => {
                    const deg = isNative
                      ? nativeList[idx]?.windDirection10m ?? null
                      : h.windDirection10m.degree;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className="px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] border-r border-slate-100 dark:border-sky-800/40"
                      >
                        <DirectionArrow degree={deg} label="Direção do Vento 10m" />
                      </td>
                    );
                  })}
                </tr>
              </>
            )}

            {/* 2. Marine Waves, Period & Direction */}
            {visibleParams.waves && forecast.marineAvailable && (
              <>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-bold text-slate-800 dark:text-sky-100 border-r border-slate-200 dark:border-sky-800">
                    Ondas (m)
                  </th>
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      onClick={() => onSelectHourIndex(idx)}
                      className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWaveBgClass(
                        h.marine?.waveHeight,
                      )}`}
                    >
                      {h.marine?.waveHeight !== null && h.marine?.waveHeight !== undefined
                        ? h.marine.waveHeight.toFixed(1)
                        : '—'}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Período de vaga (s)
                  </th>
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      onClick={() => onSelectHourIndex(idx)}
                      className="px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-200 font-semibold border-r border-slate-100 dark:border-sky-800/40"
                    >
                      {h.marine?.wavePeriod !== null && h.marine?.wavePeriod !== undefined
                        ? Math.round(h.marine.wavePeriod)
                        : '—'}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Direção das ondas
                  </th>
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      onClick={() => onSelectHourIndex(idx)}
                      className="px-1 py-1 cursor-pointer bg-white dark:bg-[#132a47] border-r border-slate-100 dark:border-sky-800/40"
                    >
                      <DirectionArrow degree={h.marine?.waveDirection} label="Direção da Onda" />
                    </td>
                  ))}
                </tr>
              </>
            )}

            {/* 3. Vertical Profile Rows (80m / 100m / 120m) — Shown only when verticalProfile is enabled */}
            {visibleParams.verticalProfile && (
              <>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-semibold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Vento 80m (km/h)
                  </th>
                  {hours.map((h, idx) => {
                    const nativeVal = isNative
                      ? nativeList[idx]?.windSpeed80m ?? null
                      : h.windSpeed80m.mean;
                    const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 80) : null;
                    const finalVal = nativeVal ?? interpVal;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          finalVal,
                        )}`}
                      >
                        {finalVal !== null ? `${Math.round(finalVal)}${interpVal !== null ? '*' : ''}` : '—'}
                      </td>
                    );
                  })}
                </tr>

                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-semibold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Vento 100m (km/h)
                  </th>
                  {hours.map((h, idx) => {
                    const nativeVal = isNative
                      ? nativeList[idx]?.windSpeed100m ?? null
                      : h.windSpeed100m.mean;
                    const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 100) : null;
                    const finalVal = nativeVal ?? interpVal;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          finalVal,
                        )}`}
                      >
                        {finalVal !== null ? `${Math.round(finalVal)}${interpVal !== null ? '*' : ''}` : '—'}
                      </td>
                    );
                  })}
                </tr>

                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-semibold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Vento 120m (km/h)
                  </th>
                  {hours.map((h, idx) => {
                    const nativeVal = isNative
                      ? nativeList[idx]?.windSpeed120m ?? null
                      : h.windSpeed120m.mean;
                    const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 120) : null;
                    const finalVal = nativeVal ?? interpVal;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getWindSpeedBgClass(
                          finalVal,
                        )}`}
                      >
                        {finalVal !== null ? `${Math.round(finalVal)}${interpVal !== null ? '*' : ''}` : '—'}
                      </td>
                    );
                  })}
                </tr>
              </>
            )}

            {/* 4. Temperature 2m (°C) */}
            {visibleParams.tempVisibility && (
              <tr>
                <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-bold text-slate-800 dark:text-sky-100 border-r border-slate-200 dark:border-sky-800">
                  Temperatura (°C)
                </th>
                {hours.map((h, idx) => {
                  const val = isNative
                    ? nativeList[idx]?.temperature2m ?? null
                    : h.temperature2mC.mean;
                  return (
                    <td
                      key={h.timestampUnix}
                      onClick={() => onSelectHourIndex(idx)}
                      className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getTempBgClass(
                        val,
                      )}`}
                    >
                      {val !== null ? Math.round(val) : '—'}
                    </td>
                  );
                })}
              </tr>
            )}

            {/* 5. Stratified Clouds High / Mid / Low (%) — Windguru 3-row gray shading */}
            {visibleParams.clouds && (
              <>
                <tr className="text-[10px]">
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Nuvens Altas (%)
                  </th>
                  {hours.map((h, idx) => {
                    const high = isNative
                      ? nativeList[idx]?.cloudCoverHigh ?? 0
                      : h.cloudCover.highPct.mean ?? 0;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-0.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getCloudCellBgClass(
                          high,
                        )}`}
                      >
                        {Math.round(high) > 5 ? Math.round(high) : ''}
                      </td>
                    );
                  })}
                </tr>
                <tr className="text-[10px]">
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Nuvens Médias (%)
                  </th>
                  {hours.map((h, idx) => {
                    const mid = isNative
                      ? nativeList[idx]?.cloudCoverMid ?? 0
                      : h.cloudCover.midPct.mean ?? 0;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-0.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getCloudCellBgClass(
                          mid,
                        )}`}
                      >
                        {Math.round(mid) > 5 ? Math.round(mid) : ''}
                      </td>
                    );
                  })}
                </tr>
                <tr className="text-[10px]">
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Nuvens Baixas (%)
                  </th>
                  {hours.map((h, idx) => {
                    const low = isNative
                      ? nativeList[idx]?.cloudCoverLow ?? 0
                      : h.cloudCover.lowPct.mean ?? 0;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-0.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getCloudCellBgClass(
                          low,
                        )}`}
                      >
                        {Math.round(low) > 5 ? Math.round(low) : ''}
                      </td>
                    );
                  })}
                </tr>
              </>
            )}

            {/* 6. Precipitation (mm/h) & Surface Pressure (hPa) */}
            {visibleParams.rainPressure && (
              <>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1.5 text-left font-bold text-slate-800 dark:text-sky-100 border-r border-slate-200 dark:border-sky-800">
                    Precipitação (mm/h)
                  </th>
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.precipitation ?? null
                      : h.precipitationMm.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1.5 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${getRainBgClass(
                          val,
                        )}`}
                      >
                        {val !== null && val > 0.05 ? val.toFixed(1) : ''}
                      </td>
                    );
                  })}
                </tr>

                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-semibold text-slate-600 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                    Pressão (hPa)
                  </th>
                  {hours.map((h, idx) => {
                    const val = isNative
                      ? nativeList[idx]?.surfacePressure ?? null
                      : h.surfacePressureHpa.mean;
                    return (
                      <td
                        key={h.timestampUnix}
                        onClick={() => onSelectHourIndex(idx)}
                        className={`px-1 py-1 cursor-pointer border-r border-slate-100 dark:border-sky-800/40 ${
                          h.barometricSquallRisk
                            ? 'bg-rose-100 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100 font-bold'
                            : 'bg-white dark:bg-[#132a47] text-slate-600 dark:text-sky-200/80'
                        }`}
                      >
                        {val !== null ? Math.round(val) : '—'}
                      </td>
                    );
                  })}
                </tr>
              </>
            )}

            {/* 7. Safe Window Semaphore Row */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-[#132a47] px-3 py-1 text-left font-bold text-slate-700 dark:text-sky-200 border-r border-slate-200 dark:border-sky-800">
                Janela Operacional
              </th>
              {hours.map((h, idx) => (
                <td
                  key={h.timestampUnix}
                  onClick={() => onSelectHourIndex(idx)}
                  title={
                    h.safeWindowReasons.length > 0
                      ? h.safeWindowReasons.join(' | ')
                      : 'Dentro dos limites operacionais'
                  }
                  className={`px-1 py-1 cursor-pointer text-[10px] border-r border-white/40 dark:border-sky-900/40 ${
                    SEMAPHORE_CELL_CLASS[h.safeWindow]
                  }`}
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
