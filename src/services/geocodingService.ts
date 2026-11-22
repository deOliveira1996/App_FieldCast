import type { ActiveCoordinates, SavedLocation } from '../types/field';
import {
  IpWhoIsResponseSchema,
  NominatimResponseSchema,
  type NominatimResult,
} from '../types/schemas';
import { fetchWithCircuitBreaker } from './httpClient';

export const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
export const IPWHOIS_ENDPOINT = 'https://ipwho.is/';
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

let lastNominatimRequestTimestampMs = 0;

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
