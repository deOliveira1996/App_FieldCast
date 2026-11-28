import React, { useEffect, useState } from 'react';
import { Compass, Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import { useLocale, type AppLocale } from '../../context/LocaleContext';
import type { EphemerisData } from '../../types/weather';
import { findCurrentLocalDayIndex, formatLocalYMD } from '../../utils/localTimeHour';
import { HelpPopover } from '../common/HelpPopover';

export interface EphemerisCardProps {
  ephemerisByDay: EphemerisData[];
  timezone?: string;
  /** When true, omits the redundant outer card frame & title header for embedding inside CollapsibleModule. */
  embedded?: boolean;
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

function formatTimeIso(
  iso: string | null | undefined,
  timezone?: string,
  intlLocale = 'pt-BR',
): string {
  if (!iso) {
    return '—';
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso.slice(11, 16) || '—';
    }
    return d.toLocaleTimeString(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || undefined,
    });
  } catch {
    return iso.slice(11, 16) || '—';
  }
}

function formatDateTab(iso: string, timezone?: string, intlLocale = 'pt-BR'): string {
  try {
    const d = parseEphemerisDate(iso);
    if (Number.isNaN(d.getTime())) {
      return iso.slice(0, 10);
    }
    return d.toLocaleDateString(intlLocale, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function computeSolarNoonAndDuration(
  sunriseIso: string | null | undefined,
  sunsetIso: string | null | undefined,
): { solarNoonIso: string | null; daylightLabel: string | null } {
  if (!sunriseIso || !sunsetIso) {
    return { solarNoonIso: null, daylightLabel: null };
  }
  const sr = new Date(sunriseIso);
  const ss = new Date(sunsetIso);
  if (Number.isNaN(sr.getTime()) || Number.isNaN(ss.getTime()) || ss.getTime() <= sr.getTime()) {
    return { solarNoonIso: null, daylightLabel: null };
  }
  const midMs = Math.round((sr.getTime() + ss.getTime()) / 2);
  const totalMin = Math.round((ss.getTime() - sr.getTime()) / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return {
    solarNoonIso: new Date(midMs).toISOString(),
    daylightLabel: `${hours}h${String(mins).padStart(2, '0')}m`,
  };
}

function getLocalizedMoonPhaseLabel(
  phaseValue: number,
  fallbackPtLabel: string,
  locale: AppLocale,
): string {
  const p = ((phaseValue % 1) + 1) % 1;
  if (locale === 'en') {
    if (p < 0.0625 || p >= 0.9375) return 'New Moon';
    if (p < 0.1875) return 'Waxing Crescent';
    if (p < 0.3125) return 'First Quarter';
    if (p < 0.4375) return 'Waxing Gibbous';
    if (p < 0.5625) return 'Full Moon';
    if (p < 0.6875) return 'Waning Gibbous';
    if (p < 0.8125) return 'Last Quarter';
    return 'Waning Crescent';
  }
  if (fallbackPtLabel && fallbackPtLabel.trim().length > 0) {
    return fallbackPtLabel;
  }
  if (p < 0.0625 || p >= 0.9375) return 'Lua Nova';
  if (p < 0.1875) return 'Lua Crescente';
  if (p < 0.3125) return 'Quarto Crescente';
  if (p < 0.4375) return 'Gibosa Crescente';
  if (p < 0.5625) return 'Lua Cheia';
  if (p < 0.6875) return 'Gibosa Minguante';
  if (p < 0.8125) return 'Quarto Minguante';
  return 'Lua Minguante';
}

const MoonPhaseDiscSvg: React.FC<{ phaseValue: number; label: string }> = ({
  phaseValue,
  label,
}) => {
  const p = ((phaseValue % 1) + 1) % 1;
  const r = 20;
  const cx = 24;
  const cy = 24;
  const topY = cy - r;
  const botY = cy + r;
  const rx = Number((Math.abs(Math.cos(p * 2 * Math.PI)) * r).toFixed(2));

  const isNew = p < 0.02 || p > 0.98;
  const isFull = Math.abs(p - 0.5) < 0.02;

  let litPath: string | null = null;
  if (!isNew && !isFull) {
    if (p < 0.5) {
      // Waxing: right limb illuminated
      const termSweep = p < 0.25 ? 0 : 1;
      litPath = `M ${cx} ${topY} A ${r} ${r} 0 0 1 ${cx} ${botY} A ${rx} ${r} 0 0 ${termSweep} ${cx} ${topY} Z`;
    } else {
      // Waning: left limb illuminated
      const termSweep = p < 0.75 ? 0 : 1;
      litPath = `M ${cx} ${topY} A ${r} ${r} 0 0 0 ${cx} ${botY} A ${rx} ${r} 0 0 ${termSweep} ${cx} ${topY} Z`;
    }
  }

  return (
    <svg
      viewBox="0 0 48 48"
      width="44"
      height="44"
      role="img"
      aria-label={label}
      className="w-11 h-11 shrink-0 drop-shadow-xs"
    >
      {/* Shadowed lunar disc */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        className="fill-slate-800 dark:fill-slate-950 stroke-sky-300/70 dark:stroke-sky-600/70"
        strokeWidth="1.5"
      />
      {/* Illuminated portion */}
      {isFull && <circle cx={cx} cy={cy} r={r - 0.5} fill="#fde68a" />}
      {litPath && <path d={litPath} fill="#fde68a" />}
      {/* Subtle lunar craters */}
      <circle cx="18" cy="18" r="2.2" fill="rgba(15, 23, 42, 0.14)" />
      <circle cx="29" cy="28" r="3" fill="rgba(15, 23, 42, 0.12)" />
      <circle cx="27" cy="16" r="1.5" fill="rgba(15, 23, 42, 0.12)" />
      {/* Rim highlight */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        className="stroke-sky-400/50 dark:stroke-sky-500/40"
        strokeWidth="1.2"
      />
    </svg>
  );
};

export const EphemerisCard: React.FC<EphemerisCardProps> = ({
  ephemerisByDay,
  timezone,
  embedded = false,
}) => {
  const { locale, tr } = useLocale();
  const intlLocale = locale === 'en' ? 'en-US' : 'pt-BR';

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

  const { solarNoonIso, daylightLabel } = activeDay
    ? computeSolarNoonAndDuration(activeDay.sunriseIso, activeDay.sunsetIso)
    : { solarNoonIso: null, daylightLabel: null };

  const moonLabel = activeDay
    ? getLocalizedMoonPhaseLabel(activeDay.moonPhaseValue, activeDay.moonPhaseLabel, locale)
    : '';

  const daySelectorBar = (
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
            className={`min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-xl text-xs font-bold shrink-0 border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 inline-flex items-center gap-1.5 ${
              isSelected
                ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                : isToday
                  ? 'bg-amber-50/90 dark:bg-amber-950/45 text-amber-950 dark:text-amber-100 border-amber-300 dark:border-amber-700 hover:bg-amber-100/80'
                  : 'bg-sky-50/70 dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-sky-200/80 dark:border-sky-800 hover:bg-sky-100/80'
            }`}
          >
            <span>{formatDateTab(day.dateIso, timezone, intlLocale)}</span>
            {isToday && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold leading-none ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-amber-400/90 text-slate-950'
                }`}
              >
                {tr('Hoje', 'Today')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <section
      aria-label={tr('Sol, Luz Natural e Fase da Lua', 'Sun, Daylight & Moon Phase')}
      className={
        embedded
          ? 'space-y-3'
          : 'rounded-2xl border border-sky-200/80 dark:border-sky-800/70 bg-white/95 dark:bg-[#132a47]/95 p-4 sm:p-5 shadow-sm shadow-sky-900/5 space-y-4'
      }
    >
      {/* Header + Day Selector Pills */}
      {embedded ? (
        <div className="flex items-center justify-between gap-2">{daySelectorBar}</div>
      ) : (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-sky-100 dark:border-sky-800/70 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-300 border border-sky-200/80 dark:border-sky-700/60">
              <Sun className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm sm:text-base font-extrabold text-sky-950 dark:text-white">
                  {tr('Sol, Luz Natural & Fase da Lua', 'Sun, Daylight & Moon Phase')}
                </h2>
                <HelpPopover topic="ephemeris" />
              </div>
              <p className="text-xs text-slate-500 dark:text-sky-200/80">
                {tr(
                  'Nascer, meio-dia solar, pôr do sol, crepúsculos e fase lunar para esta coordenada',
                  'Sunrise, solar noon, sunset, twilights, and lunar phase for this coordinate',
                )}
              </p>
            </div>
          </div>

          {daySelectorBar}
        </div>
      )}

      {/* Metrics Cards Grid */}
      {activeDay && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
          {/* 1. Sunrise, Solar Noon & Sunset */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3 sm:p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-xs font-bold text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
                <Sunrise className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
                {tr('Trajetória Solar', 'Solar Arc')}
              </span>
              {daylightLabel && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100/90 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200">
                  {daylightLabel}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-sky-200/75 block truncate">
                  {tr('Nascer do Sol', 'Sunrise')}
                </span>
                <span className="text-sm sm:text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.sunriseIso, timezone, intlLocale)}
                </span>
              </div>
              <div className="text-center">
                <span className="text-[10px] text-slate-500 dark:text-sky-200/75 block truncate">
                  {tr('Meio-Dia Solar', 'Solar Noon')}
                </span>
                <span
                  data-testid="ephemeris-solar-noon"
                  className="text-sm sm:text-base font-extrabold text-amber-700 dark:text-amber-300"
                >
                  {formatTimeIso(solarNoonIso, timezone, intlLocale)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 dark:text-sky-200/75 block truncate">
                  {tr('Pôr do Sol', 'Sunset')}
                </span>
                <span className="text-sm sm:text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.sunsetIso, timezone, intlLocale)}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Civil Twilight (First & Last Light) */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3 sm:p-3.5 space-y-2">
            <span className="text-xs font-bold text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
              <Sunset className="w-4 h-4 text-sky-500 shrink-0" aria-hidden="true" />
              {tr('Luz Natural (Civil)', 'Daylight (Civil)')}
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[11px] text-slate-500 dark:text-sky-200/75 block">
                  {tr('Primeira Luz', 'First Light')}
                </span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.civilDawnIso, timezone, intlLocale)}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 dark:text-sky-200/75 block">
                  {tr('Última Luz', 'Last Light')}
                </span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.civilDuskIso, timezone, intlLocale)}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Nautical Twilight (Dawn & Dusk) */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3 sm:p-3.5 space-y-2">
            <span className="text-xs font-bold text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-sky-500 shrink-0" aria-hidden="true" />
              {tr('Alvorada & Anoitecer (Náutico)', 'Dawn & Dusk (Nautical)')}
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[11px] text-slate-500 dark:text-sky-200/75 block">
                  {tr('Alvorada', 'Nautical Dawn')}
                </span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.nauticalDawnIso, timezone, intlLocale)}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 dark:text-sky-200/75 block">
                  {tr('Anoitecer', 'Nautical Dusk')}
                </span>
                <span className="text-base font-extrabold text-sky-950 dark:text-white">
                  {formatTimeIso(activeDay.nauticalDuskIso, timezone, intlLocale)}
                </span>
              </div>
            </div>
          </div>

          {/* 4. Dedicated Graphic + Textual Moon Phase & Illumination */}
          <div
            data-testid="moon-phase-status"
            className="rounded-2xl border border-sky-100 dark:border-sky-800/70 bg-sky-50/55 dark:bg-[#0d1f36]/75 p-3 sm:p-3.5 flex items-center gap-3"
          >
            <MoonPhaseDiscSvg phaseValue={activeDay.moonPhaseValue} label={moonLabel} />
            <div className="min-w-0 flex-1 space-y-1">
              <span className="text-[11px] font-bold text-sky-900 dark:text-sky-200 flex items-center gap-1">
                <Moon className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 shrink-0" aria-hidden="true" />
                {tr('Fase da Lua', 'Moon Phase')}
              </span>
              <div className="flex items-baseline justify-between gap-1.5">
                <span className="text-xs sm:text-sm font-extrabold text-sky-950 dark:text-white truncate">
                  {moonLabel}
                </span>
                <span className="text-[11px] font-extrabold text-sky-700 dark:text-sky-300 shrink-0">
                  {Math.round(activeDay.moonIlluminationPct)}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-sky-100 dark:bg-sky-900 overflow-hidden">
                <div
                  className="h-full bg-amber-400 dark:bg-amber-300 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, activeDay.moonIlluminationPct))}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-sky-200/75">
                {tr(
                  `${Math.round(activeDay.moonIlluminationPct)}% iluminada • Ciclo ${(activeDay.moonPhaseValue * 100).toFixed(0)}%`,
                  `${Math.round(activeDay.moonIlluminationPct)}% illuminated • Cycle ${(activeDay.moonPhaseValue * 100).toFixed(0)}%`,
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
