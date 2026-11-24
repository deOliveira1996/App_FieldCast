import React, { useEffect, useState } from 'react';
import { Compass, Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import type { EphemerisData } from '../../types/weather';
import { findCurrentLocalDayIndex, formatLocalYMD } from '../../utils/localTimeHour';
import { HelpPopover } from '../common/HelpPopover';

export interface EphemerisCardProps {
  ephemerisByDay: EphemerisData[];
  timezone?: string;
}

const BARE_DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseEphemerisDate(iso: string): Date {
  if (BARE_DATE_ISO_RE.test(iso)) {
    return new Date(`${iso}T12:00:00Z`);
  }
  return new Date(iso);
}

function isEphemerisDateToday(dateIso: string, todayYmd: string, timezone?: string): boolean {
  if (BARE_DATE_ISO_RE.test(dateIso)) {
    return dateIso === todayYmd;
  }
  const d = parseEphemerisDate(dateIso);
  if (Number.isNaN(d.getTime())) {
    return dateIso.slice(0, 10) === todayYmd;
  }
  return formatLocalYMD(d, timezone) === todayYmd;
}

function resolveInitialDayIndex(ephemerisByDay: EphemerisData[], timezone?: string): number {
  if (!ephemerisByDay || ephemerisByDay.length === 0) {
    return 0;
  }
  const todayYmd = formatLocalYMD(new Date(), timezone);
  const exactTodayIdx = ephemerisByDay.findIndex((day) =>
    isEphemerisDateToday(day.dateIso, todayYmd, timezone),
  );
  if (exactTodayIdx >= 0) {
    return exactTodayIdx;
  }
  return findCurrentLocalDayIndex(ephemerisByDay, timezone);
}

function formatTimeIso(iso: string | null | undefined, timezone?: string): string {
  if (!iso) {
    return '—';
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso.slice(11, 16) || '—';
    }
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return iso.slice(11, 16) || '—';
  }
}

function formatDateTab(iso: string, timezone?: string): string {
  try {
    const d = parseEphemerisDate(iso);
    if (Number.isNaN(d.getTime())) {
      return iso.slice(0, 10);
    }
    return d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export const EphemerisCard: React.FC<EphemerisCardProps> = ({ ephemerisByDay, timezone }) => {
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() =>
    resolveInitialDayIndex(ephemerisByDay, timezone),
  );

  useEffect(() => {
    setSelectedDayIndex(resolveInitialDayIndex(ephemerisByDay, timezone));
  }, [ephemerisByDay, timezone]);

  if (!ephemerisByDay || ephemerisByDay.length === 0) {
    return null;
  }

  const todayYmd = formatLocalYMD(new Date(), timezone);
  const safeIdx = Math.min(Math.max(0, selectedDayIndex), ephemerisByDay.length - 1);
  const activeDay = ephemerisByDay[safeIdx];

  return (
    <section
      aria-label="Sol, Luz Natural e Fase da Lua"
      className="rounded-2xl border border-sky-200/80 dark:border-sky-800/70 bg-white/95 dark:bg-[#132a47]/95 p-4 sm:p-5 shadow-sm shadow-sky-900/5 space-y-4"
    >
      {/* Header + Day Selector Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-sky-100 dark:border-sky-800/70 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-300 border border-sky-200/80 dark:border-sky-700/60">
            <Sun className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h2 className="text-sm sm:text-base font-extrabold text-sky-950 dark:text-white">
                Sol, Luz Natural &amp; Fase da Lua
              </h2>
              <HelpPopover topic="ephemeris" />
            </div>
            <p className="text-xs text-slate-500 dark:text-sky-200/80">
              Horários de nascer e pôr do sol, crepúsculos e iluminação lunar para esta coordenada
            </p>
          </div>
        </div>

        {/* Day Selector Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1 md:pb-0">
          {ephemerisByDay.map((day, idx) => {
            const isSelected = idx === safeIdx;
            const isToday = isEphemerisDateToday(day.dateIso, todayYmd, timezone);
            return (
              <button
                key={day.dateIso}
                type="button"
                onClick={() => setSelectedDayIndex(idx)}
                aria-pressed={isSelected}
                data-today={isToday ? 'true' : undefined}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 inline-flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                    : isToday
                      ? 'bg-amber-50/90 dark:bg-amber-950/45 text-amber-950 dark:text-amber-100 border-amber-300 dark:border-amber-700 hover:bg-amber-100/80'
                      : 'bg-sky-50/70 dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-sky-200/80 dark:border-sky-800 hover:bg-sky-100/80'
                }`}
              >
                <span>{formatDateTab(day.dateIso, timezone)}</span>
                {isToday && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold leading-none ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-amber-400/90 text-slate-950'
                    }`}
                  >
                    Hoje
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Metrics Cards Grid */}
      {activeDay && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Sunrise & Sunset */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3.5 space-y-2">
            <span className="text-xs font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1.5">
              <Sunrise className="w-4 h-4 text-amber-500" aria-hidden="true" />
              Nascer &amp; Pôr do Sol
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 dark:text-sky-200/75 block">Nascer do Sol</span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.sunriseIso, timezone)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-sky-200/75 block">Pôr do Sol</span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.sunsetIso, timezone)}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Civil Twilight */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3.5 space-y-2">
            <span className="text-xs font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1.5">
              <Sunset className="w-4 h-4 text-sky-500" aria-hidden="true" />
              Claridade Natural (Civil)
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 dark:text-sky-200/75 block">Primeira Luz</span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.civilDawnIso, timezone)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-sky-200/75 block">Última Luz</span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.civilDuskIso, timezone)}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Nautical Twilight */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3.5 space-y-2">
            <span className="text-xs font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-sky-500" aria-hidden="true" />
              Crepúsculo Náutico
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 dark:text-sky-200/75 block">Alvorada</span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.nauticalDawnIso, timezone)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-sky-200/75 block">Anoitecer</span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.nauticalDuskIso, timezone)}
                </span>
              </div>
            </div>
          </div>

          {/* 4. Moon Phase & Illumination */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3.5 space-y-1.5">
            <span className="text-xs font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1.5">
              <Moon className="w-4 h-4 text-sky-500" aria-hidden="true" />
              Fase da Lua
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-sky-950 dark:text-white">
                {activeDay.moonPhaseLabel}
              </span>
              <span className="text-xs font-bold text-sky-700 dark:text-sky-300">
                {Math.round(activeDay.moonIlluminationPct)}% iluminada
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-sky-100 dark:bg-sky-900 overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, activeDay.moonIlluminationPct))}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-sky-200/70">
              Ciclo lunar: {(activeDay.moonPhaseValue * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
