import type { AppLocale } from '../../i18n/translations';
import type { RouteMissionCategory } from '../../services/routeForecastService';
import type { ActiveCoordinates } from '../../types/field';
import type { SafeWindowStatus } from '../../types/weather';
import { getLocalDateParts } from '../../utils/localTimeHour';
import type { ImportedRoutePoint, RelativeWindAnalysis } from '../../utils/routeImporter';
import { convertWaveHeight, type WaveHeightUnit, type WindSpeedUnit } from '../../utils/units';

export const ROUTE_STATUS_HEX: Record<SafeWindowStatus, string> = {
  green: '#10b981',
  amber: '#f59e0b',
  red: '#f43f5e',
};

export const ROUTE_DRAFT_HEX = '#0284c7';

export const STATUS_RANK: Record<SafeWindowStatus, number> = {
  green: 0,
  amber: 1,
  red: 2,
};

export function worstRouteStatus(
  a: SafeWindowStatus,
  b: SafeWindowStatus,
): SafeWindowStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function getStatusBadgeClasses(status: SafeWindowStatus): {
  pill: string;
  dot: string;
  cardBorder: string;
  cardBg: string;
  text: string;
} {
  if (status === 'red') {
    return {
      pill: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700/70',
      dot: 'bg-rose-500',
      cardBorder: 'border-rose-300 dark:border-rose-700/70',
      cardBg: 'bg-rose-50/90 dark:bg-rose-950/40',
      text: 'text-rose-800 dark:text-rose-200',
    };
  }
  if (status === 'amber') {
    return {
      pill: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/70',
      dot: 'bg-amber-500',
      cardBorder: 'border-amber-300 dark:border-amber-700/70',
      cardBg: 'bg-amber-50/90 dark:bg-amber-950/40',
      text: 'text-amber-900 dark:text-amber-200',
    };
  }
  return {
    pill: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/70',
    dot: 'bg-emerald-500',
    cardBorder: 'border-emerald-300 dark:border-emerald-700/70',
    cardBg: 'bg-emerald-50/90 dark:bg-emerald-950/40',
    text: 'text-emerald-800 dark:text-emerald-200',
  };
}

export function formatRouteStatusLabel(status: SafeWindowStatus, isEn: boolean): string {
  if (status === 'green') return isEn ? 'GO (Safe)' : 'FAVORÁVEL';
  if (status === 'amber') return isEn ? 'CAUTION' : 'ATENÇÃO';
  return isEn ? 'NO-GO (Restricted)' : 'RESTRITO';
}

export function formatRouteDistance(
  km: number,
  category: RouteMissionCategory,
  windUnit: WindSpeedUnit,
): string {
  if (!Number.isFinite(km) || km < 0) return '0.0 km';
  const nm = km / 1.852;
  if (category === 'navigation') {
    if (windUnit === 'kt') {
      return `${nm.toFixed(1)} NM (${km.toFixed(1)} km)`;
    }
    return `${km.toFixed(1)} km (${nm.toFixed(1)} NM)`;
  }
  if (windUnit === 'kt') {
    return `${nm.toFixed(1)} NM (${km.toFixed(1)} km)`;
  }
  if (windUnit === 'mph') {
    const mi = km / 1.609344;
    return `${mi.toFixed(1)} mi (${km.toFixed(1)} km)`;
  }
  return `${km.toFixed(1)} km`;
}

export function formatCompactDistance(
  km: number,
  category: RouteMissionCategory,
  windUnit: WindSpeedUnit,
): string {
  if (!Number.isFinite(km) || km < 0) return '0.0 km';
  if (windUnit === 'kt' || category === 'navigation') {
    if (windUnit === 'kt') {
      return `${(km / 1.852).toFixed(1)} NM`;
    }
  }
  if (windUnit === 'mph') {
    return `${(km / 1.609344).toFixed(1)} mi`;
  }
  return `${km.toFixed(1)} km`;
}

export function formatAltitudeWithUnit(meters: number, waveUnit: WaveHeightUnit): string {
  if (!Number.isFinite(meters)) return '—';
  const roundedM = Math.round(meters);
  if (waveUnit === 'ft') {
    const ft = Math.round(convertWaveHeight(roundedM, 'ft') ?? roundedM * 3.28084);
    return `${ft} ft (${roundedM} m)`;
  }
  return `${roundedM} m`;
}

export function formatExactEtaHHMM(timestampUnix: number, timezone?: string): string {
  const parts = getLocalDateParts(new Date(timestampUnix * 1000), timezone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function formatExactEtaDateTime(
  timestampUnix: number,
  timezone: string | undefined,
  locale: AppLocale,
): string {
  const parts = getLocalDateParts(new Date(timestampUnix * 1000), timezone);
  const dd = String(parts.day).padStart(2, '0');
  const mm = String(parts.month).padStart(2, '0');
  const hh = String(parts.hour).padStart(2, '0');
  const min = String(parts.minute).padStart(2, '0');
  return locale === 'en' ? `${mm}/${dd} ${hh}:${min}` : `${dd}/${mm} ${hh}:${min}`;
}

export function formatRelativeWindSummary(
  rel: RelativeWindAnalysis | null,
  isEn: boolean,
): {
  label: string;
  shortLabel: string;
  badgeClass: string;
} {
  if (!rel) {
    return {
      label: isEn ? 'N/A' : 'N/D',
      shortLabel: '—',
      badgeClass:
        'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    };
  }
  const deg = Math.round(rel.relativeAngleDeg);
  if (rel.classification === 'headwind') {
    return {
      label: isEn ? `Headwind (${deg}°)` : `Proa (${deg}°)`,
      shortLabel: isEn ? `Head ${deg}°` : `Proa ${deg}°`,
      badgeClass:
        'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700/70',
    };
  }
  if (rel.classification === 'tailwind') {
    return {
      label: isEn ? `Tailwind (${deg}°)` : `Popa (${deg}°)`,
      shortLabel: isEn ? `Tail ${deg}°` : `Popa ${deg}°`,
      badgeClass:
        'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/70',
    };
  }
  return {
    label: isEn ? `Crosswind (${deg}°)` : `Través (${deg}°)`,
    shortLabel: isEn ? `Cross ${deg}°` : `Través ${deg}°`,
    badgeClass:
      'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/70',
  };
}

export function formatDurationCompact(hours: number, isEn: boolean): string {
  if (!Number.isFinite(hours) || hours <= 0) {
    return isEn ? '0 min' : '0 min';
  }
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function toDateTimeLocalInputValue(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function buildDefaultDepartureInputValue(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return toDateTimeLocalInputValue(now);
}

export function parseDateTimeLocalToUnix(value: string): number {
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) {
    return Math.floor(parsed.getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

export function buildQuickExampleRoute(
  activeLocation: ActiveCoordinates,
  category: RouteMissionCategory,
  isEn: boolean,
): { name: string; points: ImportedRoutePoint[] } {
  const baseLat = Number.isFinite(activeLocation.latitude) ? activeLocation.latitude : -27.5954;
  const baseLon = Number.isFinite(activeLocation.longitude) ? activeLocation.longitude : -48.548;

  // Navigation: ~14 km coastal/channel leg; Aerial: ~5 km UAV/paragliding corridor
  const scale = category === 'navigation' ? 1.0 : 0.36;
  const offsets: ReadonlyArray<[number, number, string, string]> = [
    [0, 0, 'P1 — Partida', 'P1 — Departure'],
    [0.024 * scale, 0.018 * scale, 'P2 — Trecho Inicial', 'P2 — Initial Leg'],
    [0.052 * scale, 0.044 * scale, 'P3 — Ponto Médio', 'P3 — Midpoint'],
    [0.076 * scale, 0.078 * scale, 'P4 — Aproximação', 'P4 — Approach'],
    [0.095 * scale, 0.112 * scale, 'P5 — Destino', 'P5 — Destination'],
  ];

  const points: ImportedRoutePoint[] = offsets.map(([dLat, dLon, labelPt, labelEn]) => ({
    latitude: Number(Math.max(-89.9, Math.min(89.9, baseLat + dLat)).toFixed(5)),
    longitude: Number(Math.max(-179.9, Math.min(179.9, baseLon + dLon)).toFixed(5)),
    name: isEn ? labelEn : labelPt,
  }));

  const modeTag =
    category === 'navigation'
      ? isEn
        ? 'Marine Route'
        : 'Rota Náutica'
      : isEn
        ? 'Aerial Corridor'
        : 'Corredor Aéreo';

  return {
    name: `${modeTag} — ${activeLocation.name}`,
    points,
  };
}

export function slugifyRouteFilename(raw: string): string {
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'rota-4d'
  );
}

export async function readUploadedRouteFile(file: File): Promise<string | Uint8Array> {
  const isKmz = file.name.trim().toLowerCase().endsWith('.kmz');

  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (isKmz) return bytes;
    return bytes;
  }

  if (!isKmz && typeof file.text === 'function') {
    return await file.text();
  }

  if (typeof FileReader !== 'undefined') {
    return await new Promise<string | Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo selecionado.'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Conteúdo de arquivo não suportado.'));
        }
      };
      if (isKmz) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file, 'utf-8');
      }
    });
  }

  throw new Error('Leitura de arquivos indisponível neste ambiente.');
}
