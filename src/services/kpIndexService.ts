import { NoaaSwpcKpForecastSchema, type NoaaSwpcKpPoint } from '../types/schemas';

export const NOAA_SWPC_KP_FORECAST_URL =
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

const KP_CACHE_STORAGE_KEY = 'fieldcast_kp_cache_v1';
const KP_MANUAL_OVERRIDE_STORAGE_KEY = 'fieldcast_kp_manual_override_v1';

export type GeomagneticScale = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

export interface KpClassification {
  kp: number;
  scale: GeomagneticScale;
  label: string;
  severity: 'green' | 'amber' | 'red';
  droneAdvisory: string;
}

export interface KpForecastEntry {
  timeTagUtc: string;
  timestampUnix: number;
  kp: number;
  status: 'observed' | 'estimated' | 'predicted';
  noaaScale: string | null;
}

export interface KpIndexDataset {
  currentKp: number;
  currentStatus: 'observed' | 'estimated' | 'predicted' | 'manual' | 'offline';
  classification: KpClassification;
  entries: KpForecastEntry[];
  fetchedAtIso: string;
  fromCache: boolean;
}

export interface ManualKpOverride {
  enabled: boolean;
  kpValue: number;
  updatedAtIso: string;
}

export function classifyKpScale(rawKp: number): KpClassification {
  const kp = Math.max(0, Math.min(9, Number.isFinite(rawKp) ? rawKp : 0));

  if (kp >= 8.67) {
    return {
      kp,
      scale: 'G5',
      label: 'Tempestade Extrema (G5)',
      severity: 'red',
      droneAdvisory: 'Não voar com GNSS/RTK: degradação severa de satélite, bússola e link RF.',
    };
  }
  if (kp >= 7.67) {
    return {
      kp,
      scale: 'G4',
      label: 'Tempestade Severa (G4)',
      severity: 'red',
      droneAdvisory: 'Alto risco para drones: perda de lock GPS/RTK e erro acentuado de magnetômetro.',
    };
  }
  if (kp >= 6.67) {
    return {
      kp,
      scale: 'G3',
      label: 'Tempestade Forte (G3)',
      severity: 'red',
      droneAdvisory: 'Evitar voos autônomos BVLOS; usar modo ATTI apenas se estritamente necessário.',
    };
  }
  if (kp >= 5.67) {
    return {
      kp,
      scale: 'G2',
      label: 'Tempestade Moderada (G2)',
      severity: 'amber',
      droneAdvisory: 'Instabilidade GNSS provável; recalibrar bússola antes da decolagem e limitar alcance.',
    };
  }
  if (kp >= 4.67) {
    return {
      kp,
      scale: 'G1',
      label: 'Tempestade Menor (G1)',
      severity: 'amber',
      droneAdvisory: 'Atenção moderada a oscilações de satélites e precisão RTK; manter linha de visada.',
    };
  }
  if (kp >= 3.67) {
    return {
      kp,
      scale: 'G0',
      label: 'Atividade Geomagnética Elevada',
      severity: 'amber',
      droneAdvisory: 'Monitorar HDOP/satélites durante o voo; condição operável com atenção.',
    };
  }
  return {
    kp,
    scale: 'G0',
    label: 'Condição Geomagnética Calma',
    severity: 'green',
    droneAdvisory: 'Recepção GNSS/GPS e referência magnética estáveis para operações com drone.',
  };
}

function parseUtcTagToUnix(tag: string): number {
  const normalized = tag.endsWith('Z') ? tag : `${tag}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function normalizeSwpcArray(raw: NoaaSwpcKpPoint[]): KpForecastEntry[] {
  return raw.map((item) => {
    const statusLower = String(item.observed || '').toLowerCase();
    const status: KpForecastEntry['status'] =
      statusLower === 'observed'
        ? 'observed'
        : statusLower === 'estimated'
          ? 'estimated'
          : 'predicted';
    return {
      timeTagUtc: item.time_tag,
      timestampUnix: parseUtcTagToUnix(item.time_tag),
      kp: Number(item.kp.toFixed(2)),
      status,
      noaaScale: item.noaa_scale ?? null,
    };
  });
}

export function loadManualKpOverride(): ManualKpOverride {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return { enabled: false, kpValue: 2, updatedAtIso: new Date().toISOString() };
  }
  try {
    const raw = window.localStorage.getItem(KP_MANUAL_OVERRIDE_STORAGE_KEY);
    if (!raw) {
      return { enabled: false, kpValue: 2, updatedAtIso: new Date().toISOString() };
    }
    const parsed = JSON.parse(raw) as Partial<ManualKpOverride>;
    if (typeof parsed.enabled === 'boolean' && typeof parsed.kpValue === 'number') {
      return {
        enabled: parsed.enabled,
        kpValue: Math.max(0, Math.min(9, parsed.kpValue)),
        updatedAtIso: parsed.updatedAtIso ?? new Date().toISOString(),
      };
    }
  } catch {
    // fallback
  }
  return { enabled: false, kpValue: 2, updatedAtIso: new Date().toISOString() };
}

export function saveManualKpOverride(override: ManualKpOverride): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(KP_MANUAL_OVERRIDE_STORAGE_KEY, JSON.stringify(override));
  } catch {
    // ignore storage quota errors
  }
}

export function loadCachedKpDataset(): KpIndexDataset | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(KP_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KpIndexDataset;
    if (typeof parsed.currentKp === 'number' && Array.isArray(parsed.entries)) {
      return { ...parsed, fromCache: true };
    }
  } catch {
    // ignore
  }
  return null;
}

export function buildFallbackKpDataset(): KpIndexDataset {
  const cached = loadCachedKpDataset();
  if (cached) return cached;
  const kp = 1.67;
  const nowUnix = Math.floor(Date.now() / 1000);
  return {
    currentKp: kp,
    currentStatus: 'offline',
    classification: classifyKpScale(kp),
    entries: [
      {
        timeTagUtc: new Date(nowUnix * 1000).toISOString().slice(0, 19),
        timestampUnix: nowUnix,
        kp,
        status: 'estimated',
        noaaScale: null,
      },
    ],
    fetchedAtIso: new Date().toISOString(),
    fromCache: true,
  };
}

/**
 * Consulta a série oficial aberta de Índice Kp Planetário da NOAA SWPC (`Access-Control-Allow-Origin: *`),
 * mantendo cache local em `localStorage` e degradação segura offline.
 */
export async function fetchNoaaKpIndex(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<KpIndexDataset> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 7000;

  if (!fetchImpl) {
    return buildFallbackKpDataset();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(NOAA_SWPC_KP_FORECAST_URL, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const rawJson: unknown = await res.json();
    const parsed = NoaaSwpcKpForecastSchema.parse(rawJson);
    const entries = normalizeSwpcArray(parsed);

    if (entries.length === 0) {
      throw new Error('Feed NOAA SWPC Kp vazio');
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    // Seleciona leitura observada/estimada mais próxima do instante atual
    let currentEntry = entries[entries.length - 1]!;
    let bestDist = Infinity;
    for (const item of entries) {
      if (item.status === 'observed' || item.status === 'estimated') {
        const dist = Math.abs(item.timestampUnix - nowUnix);
        if (dist <= bestDist) {
          bestDist = dist;
          currentEntry = item;
        }
      }
    }

    const dataset: KpIndexDataset = {
      currentKp: currentEntry.kp,
      currentStatus: currentEntry.status,
      classification: classifyKpScale(currentEntry.kp),
      entries: entries.slice(-32),
      fetchedAtIso: new Date().toISOString(),
      fromCache: false,
    };

    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      try {
        window.localStorage.setItem(KP_CACHE_STORAGE_KEY, JSON.stringify(dataset));
      } catch {
        // ignore quota error
      }
    }

    return dataset;
  } catch {
    clearTimeout(timer);
    return buildFallbackKpDataset();
  }
}
