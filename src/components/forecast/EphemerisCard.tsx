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
      aria-label="Efemérides Solares e Lunares (SunCalc Offline)"
      className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm space-y-4"
    >
      {/* Header + Day Selector Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            <Sun className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Efemérides Solares, Crepúsculos & Fase da Lua (100% Offline)
              </h2>
              <HelpPopover topic="ephemeris" />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Cálculo astronômico local via SunCalc para planejamento de luz natural e marés
            </p>
          </div>
        </div>

        {/* Day Selector Pills (>= 44x44px) */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1 md:pb-0">
          {ephemerisByDay.map((day, idx) => {
            const isSelected = idx === safeIdx;
            return (
              <button
                key={day.dateIso}
                type="button"
                onClick={() => setSelectedDayIndex(idx)}
                aria-pressed={isSelected}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  isSelected
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
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
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <Sunrise className="w-4 h-4" aria-hidden="true" />
              Nascer & Pôr do Sol
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Nascer do Sol</span>
                <span className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                  {formatTimeIso(activeDay.sunriseIso, timezone)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Pôr do Sol</span>
                <span className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                  {formatTimeIso(activeDay.sunsetIso, timezone)}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Civil Twilight */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
              <Sunset className="w-4 h-4" aria-hidden="true" />
              Crepúsculo Civil (Sol -6°)
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Alvorada Civil</span>
                <span className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                  {formatTimeIso(activeDay.civilDawnIso, timezone)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Crepúsculo Civil</span>
                <span className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                  {formatTimeIso(activeDay.civilDuskIso, timezone)}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Nautical Twilight */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
              <Compass className="w-4 h-4" aria-hidden="true" />
              Crepúsculo Náutico (Sol -12°)
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Alvorada Náutica</span>
                <span className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                  {formatTimeIso(activeDay.nauticalDawnIso, timezone)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">
                  Crepúsculo Náutico
                </span>
                <span className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                  {formatTimeIso(activeDay.nauticalDuskIso, timezone)}
                </span>
              </div>
            </div>
          </div>

          {/* 4. Moon Phase & Illumination */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
              <Moon className="w-4 h-4" aria-hidden="true" />
              Fase & Iluminação Lunar
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                {activeDay.moonPhaseLabel}
              </span>
              <span className="text-sm font-mono font-extrabold text-purple-700 dark:text-purple-300">
                {Math.round(activeDay.moonIlluminationPct)}% ilum.
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, activeDay.moonIlluminationPct))}%`,
                }}
              />
            </div>
            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              Ciclo lunar: {(activeDay.moonPhaseValue * 100).toFixed(0)}% (0%=Nova, 50%=Cheia)
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
