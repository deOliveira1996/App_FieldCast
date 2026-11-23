import { useEffect, useState } from 'react';
import type { EnsembleHour, EphemerisData } from '../types/weather';

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

/**
 * Extracts calendar and clock components for `date` in `timezone`,
 * falling back safely to browser-local time if `timezone` is invalid or unavailable.
 */
export function getLocalDateParts(date: Date, timezone?: string): LocalDateParts {
  const ms = date.getMilliseconds();

  if (timezone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const parts = formatter.formatToParts(date);
      const map: Record<string, number> = {};
      for (const p of parts) {
        if (p.type !== 'literal') {
          map[p.type] = Number(p.value);
        }
      }
      if (
        Number.isFinite(map.year) &&
        Number.isFinite(map.month) &&
        Number.isFinite(map.day) &&
        Number.isFinite(map.hour) &&
        Number.isFinite(map.minute) &&
        Number.isFinite(map.second)
      ) {
        return {
          year: map.year!,
          month: map.month!,
          day: map.day!,
          hour: map.hour === 24 ? 0 : map.hour!,
          minute: map.minute!,
          second: map.second!,
          ms,
        };
      }
    } catch {
      // Fallback to browser local below
    }
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    ms,
  };
}

export function formatLocalYMD(date: Date, timezone?: string): string {
  const parts = getLocalDateParts(date, timezone);
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatLocalHourBadge(timestampUnix: number, timezone?: string): string {
  const parts = getLocalDateParts(new Date(timestampUnix * 1000), timezone);
  return `${String(parts.hour).padStart(2, '0')}:00`;
}

/**
 * Resolves the index in `hours` corresponding to the current local hour window.
 *
 * 1. Primary match: `hours[i].timestampUnix <= nowUnix < hours[i].timestampUnix + 3600`
 *    (e.g. 18:08 matches the 18:00 hour bucket).
 * 2. Stale/offline fixture fallback: if `nowUnix` is outside the forecast's date range,
 *    matches the current local hour-of-day (0..23 in `timezone`, with browser-local fallback)
 *    on the closest/first matching day rather than reverting to 00:00.
 */
export function findCurrentLocalHourIndex(
  hours: ReadonlyArray<Pick<EnsembleHour, 'timestampUnix'>> | undefined,
  timezone?: string,
  now: Date = new Date(),
): number {
  if (!hours || hours.length === 0) {
    return 0;
  }

  const nowUnix = Math.floor(now.getTime() / 1000);

  for (let i = 0; i < hours.length; i++) {
    const startUnix = hours[i]!.timestampUnix;
    if (startUnix <= nowUnix && nowUnix < startUnix + 3600) {
      return i;
    }
  }

  // Fallback for stale/offline cached forecasts outside the live date window:
  // match current local hour-of-day (0..23) in the target timezone.
  const targetHour = getLocalDateParts(now, timezone).hour;
  const firstUnix = hours[0]!.timestampUnix;

  let bestMatchIndex = -1;
  let bestMatchDistance = Infinity;

  for (let i = 0; i < hours.length; i++) {
    const hUnix = hours[i]!.timestampUnix;
    const hHour = getLocalDateParts(new Date(hUnix * 1000), timezone).hour;
    if (hHour === targetHour) {
      if (nowUnix < firstUnix) {
        // Future forecast relative to `now`: pick earliest day at targetHour
        return i;
      }
      const dist = Math.abs(nowUnix - hUnix);
      if (dist < bestMatchDistance) {
        bestMatchDistance = dist;
        bestMatchIndex = i;
      }
    }
  }

  if (bestMatchIndex >= 0) {
    return bestMatchIndex;
  }

  return nowUnix < firstUnix ? 0 : Math.min(hours.length - 1, Math.max(0, Math.round((nowUnix - firstUnix) / 3600)));
}

/**
 * Resolves the index in `ephemerisByDay` corresponding to today's local date in `timezone`.
 */
export function findCurrentLocalDayIndex(
  ephemerisByDay: ReadonlyArray<Pick<EphemerisData, 'dateIso'>> | undefined,
  timezone?: string,
  now: Date = new Date(),
): number {
  if (!ephemerisByDay || ephemerisByDay.length === 0) {
    return 0;
  }

  const todayYmd = formatLocalYMD(now, timezone);
  for (let i = 0; i < ephemerisByDay.length; i++) {
    const raw = ephemerisByDay[i]!.dateIso;
    const parsed = new Date(raw);
    const dayYmd = Number.isNaN(parsed.getTime())
      ? raw.slice(0, 10)
      : formatLocalYMD(parsed, timezone);
    if (dayYmd === todayYmd || raw.slice(0, 10) === todayYmd) {
      return i;
    }
  }

  return 0;
}

/**
 * Computes milliseconds until the next local hour boundary in `timezone`.
 */
export function getMsUntilNextLocalHour(now: Date = new Date(), timezone?: string): number {
  const { minute, second, ms } = getLocalDateParts(now, timezone);
  const elapsedInHourMs = minute * 60_000 + second * 1000 + ms;
  const remaining = 3_600_000 - elapsedInHourMs;
  return Math.max(10, remaining);
}

/**
 * React hook returning the live local-hour index inside `hours`, automatically
 * updating on every local hour rollover and when the tab/app regains visibility.
 */
export function useCurrentLocalHourIndex(
  hours: ReadonlyArray<Pick<EnsembleHour, 'timestampUnix'>> | undefined,
  timezone?: string,
): number {
  const [currentHourIndex, setCurrentHourIndex] = useState<number>(() =>
    findCurrentLocalHourIndex(hours, timezone),
  );

  useEffect(() => {
    if (!hours || hours.length === 0) {
      setCurrentHourIndex(0);
      return;
    }

    let timerId: ReturnType<typeof setTimeout> | undefined;
    let isDisposed = false;

    const syncAndSchedule = () => {
      if (isDisposed) {
        return;
      }
      const now = new Date();
      setCurrentHourIndex(findCurrentLocalHourIndex(hours, timezone, now));
      const delayMs = getMsUntilNextLocalHour(now, timezone);
      timerId = setTimeout(syncAndSchedule, delayMs);
    };

    syncAndSchedule();

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      syncAndSchedule();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityOrFocus);
    }

    return () => {
      isDisposed = true;
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityOrFocus);
      }
    };
  }, [hours, timezone]);

  return currentHourIndex;
}
