import type { ActiveCoordinates, SavedLocation } from '../types/field';
import type { ServiceEndpointStatus } from '../types/health';
import {
  IpWhoIsResponseSchema,
  NominatimResponseSchema,
  NominatimReverseResultSchema,
  type NominatimResult,
  type NominatimReverseResult,
} from '../types/schemas';
import {
  fetchWithCircuitBreaker,
  getServiceEndpointStatus,
  markServiceDegraded,
} from './httpClient';

export const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_REVERSE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
export const IPWHOIS_ENDPOINT = 'https://ipwho.is/';
export const NOMINATIM_MIN_INTERVAL_MS = 1000;
export const REVERSE_GEOCODE_CACHE_STORAGE_KEY = 'fieldcast_reverse_geocode_cache_v42';
export const REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 100;

let lastNominatimRequestTimestampMs = 0;

export interface ReverseGeocodeResult {
  latitude: number;
  longitude: number;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  friendlyLabel: string;
  fullDisplayName: string;
  fromCache: boolean;
}

const reverseGeocodeMemoryCache = new Map<string, ReverseGeocodeResult>();
let reverseGeocodeStorageHydrated = false;

export interface GeocodingLocationResult {
  id: string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  type?: string;
}

/**
 * Reseta o controlador de rate-limit do Nominatim (útil para testes unitários).
 */
export function resetNominatimRateLimiter(): void {
  lastNominatimRequestTimestampMs = 0;
}

/**
 * Retorna o timestamp (ms) da última requisição disparada ao Nominatim.
 */
export function getLastNominatimRequestTimestampMs(): number {
  return lastNominatimRequestTimestampMs;
}

/**
 * Monta a URL de busca textual do Nominatim (OSM).
 */
export function buildNominatimSearchUrl(query: string, limit = 5): string {
  const params = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
  });
  return `${NOMINATIM_SEARCH_ENDPOINT}?${params.toString()}`;
}

function mapNominatimItem(item: NominatimResult, index: number): GeocodingLocationResult | null {
  const latitude = Number.parseFloat(item.lat);
  const longitude = Number.parseFloat(item.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const shortName = item.name?.trim() || item.display_name.split(',')[0]?.trim() || 'Local';
  const id = item.place_id
    ? `nom-${item.place_id}`
    : `nom-${latitude.toFixed(4)}-${longitude.toFixed(4)}-${index}`;

  return {
    id,
    name: shortName,
    displayName: item.display_name,
    latitude,
    longitude,
    type: item.type,
  };
}

/**
 * Busca localidades no Nominatim (OpenStreetMap) respeitando a política de uso:
 * - Rate-limit mínimo de 1000ms (1 req/s) entre requisições consecutivas.
 * - Sem sobrescrita do header `User-Agent` no navegador.
 * - Validação Zod via `NominatimResponseSchema`.
 */
export async function searchLocationsNominatim(
  query: string,
  options?: {
    limit?: number;
    minIntervalMs?: number;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxRetries?: number;
    backoffBaseMs?: number;
  },
): Promise<GeocodingLocationResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const minInterval = options?.minIntervalMs ?? NOMINATIM_MIN_INTERVAL_MS;
  const now = Date.now();
  const elapsed = now - lastNominatimRequestTimestampMs;

  if (lastNominatimRequestTimestampMs > 0 && elapsed < minInterval) {
    const waitMs = minInterval - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastNominatimRequestTimestampMs = Date.now();
  const url = buildNominatimSearchUrl(trimmed, options?.limit ?? 5);

  const result = await fetchWithCircuitBreaker({
    service: 'nominatim',
    url,
    schema: NominatimResponseSchema,
    // Não envia User-Agent customizado para evitar bloqueio CORS no browser
    headers: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    fetchImpl: options?.fetchImpl,
    timeoutMs: options?.timeoutMs,
    maxRetries: options?.maxRetries,
    backoffBaseMs: options?.backoffBaseMs,
  });

  const mapped: GeocodingLocationResult[] = [];
  result.data.forEach((item, idx) => {
    const parsed = mapNominatimItem(item, idx);
    if (parsed) {
      mapped.push(parsed);
    }
  });

  return mapped;
}

function hydrateReverseGeocodeCacheFromStorage(): void {
  if (reverseGeocodeStorageHydrated) {
    return;
  }
  reverseGeocodeStorageHydrated = true;
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const raw = localStorage.getItem(REVERSE_GEOCODE_CACHE_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as Array<[string, ReverseGeocodeResult]>;
    if (!Array.isArray(parsed)) {
      return;
    }
    for (const entry of parsed.slice(-REVERSE_GEOCODE_CACHE_MAX_ENTRIES)) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        entry[1] &&
        typeof entry[1].friendlyLabel === 'string'
      ) {
        reverseGeocodeMemoryCache.set(entry[0], entry[1]);
      }
    }
  } catch {
    // Ignora cache corrompido ou localStorage indisponível
  }
}

function persistReverseGeocodeCacheToStorage(): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const serialized = JSON.stringify(
      Array.from(reverseGeocodeMemoryCache.entries()).slice(-REVERSE_GEOCODE_CACHE_MAX_ENTRIES),
    );
    localStorage.setItem(REVERSE_GEOCODE_CACHE_STORAGE_KEY, serialized);
  } catch {
    // Ignora falha de cota em localStorage
  }
}

function setReverseGeocodeCacheEntry(key: string, value: ReverseGeocodeResult): void {
  hydrateReverseGeocodeCacheFromStorage();
  if (reverseGeocodeMemoryCache.has(key)) {
    reverseGeocodeMemoryCache.delete(key);
  }
  reverseGeocodeMemoryCache.set(key, value);
  while (reverseGeocodeMemoryCache.size > REVERSE_GEOCODE_CACHE_MAX_ENTRIES) {
    const oldestKey = reverseGeocodeMemoryCache.keys().next().value;
    if (oldestKey === undefined) break;
    reverseGeocodeMemoryCache.delete(oldestKey);
  }
  persistReverseGeocodeCacheToStorage();
}

/**
 * Limpa o cache de geocodificação reversa em memória e localStorage (útil em testes).
 */
export function clearReverseGeocodeCache(): void {
  reverseGeocodeMemoryCache.clear();
  reverseGeocodeStorageHydrated = true;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(REVERSE_GEOCODE_CACHE_STORAGE_KEY);
    }
  } catch {
    // Ignora
  }
}

/**
 * Monta a URL de geocodificação reversa do Nominatim (OSM).
 */
export function buildNominatimReverseUrl(latitude: number, longitude: number): string {
  return `${NOMINATIM_REVERSE_ENDPOINT}?lat=${latitude}&lon=${longitude}&format=jsonv2&addressdetails=1&accept-language=pt-BR`;
}

function formatReverseGeocodeResult(
  latitude: number,
  longitude: number,
  payload: NominatimReverseResult,
): ReverseGeocodeResult | null {
  if (payload.error) {
    return null;
  }

  const addr = payload.address;
  const neighborhoodRaw =
    addr?.neighbourhood ??
    addr?.neighborhood ??
    addr?.suburb ??
    addr?.quarter ??
    addr?.city_district ??
    addr?.hamlet ??
    null;
  const cityRaw =
    addr?.city ?? addr?.town ?? addr?.municipality ?? addr?.village ?? null;
  const stateRaw = addr?.state ?? addr?.region ?? null;

  const neighborhood = neighborhoodRaw?.trim() || null;
  const city = cityRaw?.trim() || null;
  const state = stateRaw?.trim() || null;

  let friendlyLabel: string | null = null;
  if (neighborhood && city && neighborhood.toLowerCase() !== city.toLowerCase()) {
    friendlyLabel = `${neighborhood}, ${city}`;
  } else if (city && state) {
    friendlyLabel = `${city} — ${state}`;
  } else if (city) {
    friendlyLabel = city;
  } else if (neighborhood && state) {
    friendlyLabel = `${neighborhood} — ${state}`;
  } else if (neighborhood) {
    friendlyLabel = neighborhood;
  } else if (state) {
    friendlyLabel = state;
  } else {
    const fallback =
      payload.name?.trim() ||
      payload.display_name?.split(',')[0]?.trim() ||
      null;
    friendlyLabel = fallback;
  }

  if (!friendlyLabel) {
    return null;
  }

  return {
    latitude,
    longitude,
    neighborhood,
    city,
    state,
    friendlyLabel,
    fullDisplayName: payload.display_name?.trim() || friendlyLabel,
    fromCache: false,
  };
}

/**
 * Executa geocodificação reversa via Nominatim (OSM) para traduzir `(lat, lon)` em Bairro/Cidade/Estado,
 * com cache em memória + `localStorage` (até 100 entradas) e degradação graciosa offline (`null`).
 */
export async function reverseGeocodeNominatim(
  latitude: number,
  longitude: number,
  options?: {
    minIntervalMs?: number;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxRetries?: number;
    backoffBaseMs?: number;
  },
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  hydrateReverseGeocodeCacheFromStorage();
  const cached = reverseGeocodeMemoryCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      fromCache: true,
    };
  }

  try {
    const minInterval = options?.minIntervalMs ?? NOMINATIM_MIN_INTERVAL_MS;
    const now = Date.now();
    const elapsed = now - lastNominatimRequestTimestampMs;

    if (lastNominatimRequestTimestampMs > 0 && elapsed < minInterval) {
      const waitMs = minInterval - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    lastNominatimRequestTimestampMs = Date.now();
    const url = buildNominatimReverseUrl(latitude, longitude);

    const response = await fetchWithCircuitBreaker({
      service: 'nominatim',
      url,
      schema: NominatimReverseResultSchema,
      headers: {
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs ?? 6000,
      maxRetries: options?.maxRetries ?? 1,
      backoffBaseMs: options?.backoffBaseMs,
      degradedOnOpen: true,
    });

    const formatted = formatReverseGeocodeResult(latitude, longitude, response.data);
    if (!formatted) {
      return null;
    }

    setReverseGeocodeCacheEntry(cacheKey, formatted);
    return formatted;
  } catch {
    return null;
  }
}

/**
 * Converte um resultado do Nominatim em `SavedLocation` pronto para salvar no Dexie.
 */
export function geocodingResultToSavedLocation(
  result: GeocodingLocationResult,
  isFavorite = true,
): SavedLocation {
  const nowIso = new Date().toISOString();
  return {
    id: result.id,
    name: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
    region: result.displayName,
    isFavorite,
    createdAtIso: nowIso,
    lastUsedAtIso: nowIso,
  };
}

/**
 * Converte um resultado do Nominatim em `ActiveCoordinates`.
 */
export function geocodingResultToActiveCoordinates(
  result: GeocodingLocationResult,
): ActiveCoordinates {
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    accuracyM: null,
    name: result.name,
    origin: 'search',
    isApproximateIp: false,
    updatedAtIso: new Date().toISOString(),
  };
}

/**
 * Obtém localização aproximada via IP público usando `https://ipwho.is/`
 * como segundo nível da cascata de geolocalização (sinalizada como `"Aproximado via IP"`).
 */
export async function fetchIpApproximateLocation(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
}): Promise<ActiveCoordinates> {
  const result = await fetchWithCircuitBreaker({
    service: 'ipwhois',
    url: IPWHOIS_ENDPOINT,
    schema: IpWhoIsResponseSchema,
    fetchImpl: options?.fetchImpl,
    timeoutMs: options?.timeoutMs,
    maxRetries: options?.maxRetries,
    backoffBaseMs: options?.backoffBaseMs,
  });

  const payload = result.data;
  if (
    !payload.success ||
    typeof payload.latitude !== 'number' ||
    !Number.isFinite(payload.latitude) ||
    typeof payload.longitude !== 'number' ||
    !Number.isFinite(payload.longitude)
  ) {
    throw new Error(payload.message ?? 'Resposta inválida de geolocalização por IP (ipwho.is)');
  }

  const placeParts = [payload.city, payload.region].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  const baseName = placeParts.length > 0 ? placeParts.join(', ') : 'Localização IP';

  return {
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: 5000,
    name: `${baseName} (Aproximado via IP)`,
    origin: 'ip',
    isApproximateIp: true,
    updatedAtIso: new Date().toISOString(),
  };
}

/**
 * Executa sonda real sob demanda para o endpoint Nominatim (respeitando rate-limit de 1 req/s).
 * Nunca lança exceção não tratada ao ser usado pelo módulo de Diagnóstico.
 */
export async function probeNominatimHealth(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  minIntervalMs?: number;
}): Promise<ServiceEndpointStatus> {
  try {
    await searchLocationsNominatim('Florianopolis', {
      limit: 1,
      minIntervalMs: options?.minIntervalMs,
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs ?? 6000,
      maxRetries: 0,
    });
  } catch (err) {
    const status = getServiceEndpointStatus('nominatim');
    if (status.status === 'healthy' || status.status === 'unverified') {
      const reason = err instanceof Error ? err.message : 'Falha ao sondar Nominatim';
      return markServiceDegraded('nominatim', reason);
    }
  }
  return getServiceEndpointStatus('nominatim');
}

/**
 * Executa sonda real sob demanda para o endpoint de geolocalização por IP (`ipwho.is`).
 * Nunca lança exceção não tratada ao ser usado pelo módulo de Diagnóstico.
 */
export async function probeIpWhoisHealth(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ServiceEndpointStatus> {
  try {
    await fetchIpApproximateLocation({
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs ?? 6000,
      maxRetries: 0,
    });
  } catch (err) {
    const status = getServiceEndpointStatus('ipwhois');
    if (status.status === 'healthy' || status.status === 'unverified') {
      const reason = err instanceof Error ? err.message : 'Falha ao sondar ipwho.is';
      return markServiceDegraded('ipwhois', reason);
    }
  }
  return getServiceEndpointStatus('ipwhois');
}
