import React, { useState } from 'react';
import { Compass, Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import type { EphemerisData } from '../../types/weather';
import { HelpPopover } from '../common/HelpPopover';

export interface EphemerisCardProps {
  ephemerisByDay: EphemerisData[];
  timezone?: string;
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
    const d = new Date(iso);
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
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  if (!ephemerisByDay || ephemerisByDay.length === 0) {
    return null;
  }

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
            return (
              <button
                key={day.dateIso}
                type="button"
                onClick={() => setSelectedDayIndex(idx)}
                aria-pressed={isSelected}
                className={`min-h-[38px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  isSelected
                    ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                    : 'bg-sky-50/70 dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-sky-200/80 dark:border-sky-800 hover:bg-sky-100/80'
                }`}
              >
                {formatDateTab(day.dateIso, timezone)}
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
