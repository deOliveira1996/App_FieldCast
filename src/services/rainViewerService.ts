import {
  RainViewerResponseSchema,
  type RainViewerResponse,
} from '../types/schemas';
import {
  fetchWithCircuitBreaker,
  markServiceDegraded,
} from './httpClient';

export const RAINVIEWER_MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const DEFAULT_RAINVIEWER_HOST = 'https://tilecache.rainviewer.com';
export const RAINVIEWER_MAX_NATIVE_ZOOM = 7;

export interface RadarAnimationFrame {
  timeUnix: number;
  timeIso: string;
  path: string;
  tileUrlTemplate: string;
  isNowcast: boolean;
}

export interface RainViewerRadarState {
  available: boolean;
  degraded: boolean;
  host: string;
  frames: RadarAnimationFrame[];
  pastCount: number;
  nowcastCount: number;
  maxNativeZoom: number;
  fetchedAtIso: string;
  statusMessage: string;
}

/**
 * Monta o template de URL de tile do RainViewer compatível com `L.TileLayer` do Leaflet.
 */
export function buildRainViewerTileUrl(
  host: string,
  path: string,
  colorScheme = 2,
  smoothData = '1_1',
): string {
  const cleanHost = host.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanHost}${cleanPath}/256/{z}/{x}/{y}/${colorScheme}/${smoothData}.png`;
}

/**
 * Normaliza a resposta validada do RainViewer em frames prontos para reprodução (Play/Pause e Timeline).
 */
export function normalizeRainViewerResponse(raw: RainViewerResponse): RainViewerRadarState {
  const host = raw.host || DEFAULT_RAINVIEWER_HOST;
  const pastFrames: RadarAnimationFrame[] = (raw.radar.past ?? []).map((f) => ({
    timeUnix: f.time,
    timeIso: new Date(f.time * 1000).toISOString(),
    path: f.path,
    tileUrlTemplate: buildRainViewerTileUrl(host, f.path),
    isNowcast: false,
  }));

  const nowcastFrames: RadarAnimationFrame[] = (raw.radar.nowcast ?? []).map((f) => ({
    timeUnix: f.time,
    timeIso: new Date(f.time * 1000).toISOString(),
    path: f.path,
    tileUrlTemplate: buildRainViewerTileUrl(host, f.path),
    isNowcast: true,
  }));

  const allFrames = [...pastFrames, ...nowcastFrames];
  const hasFrames = allFrames.length > 0;

  return {
    available: hasFrames,
    degraded: !hasFrames,
    host,
    frames: allFrames,
    pastCount: pastFrames.length,
    nowcastCount: nowcastFrames.length,
    maxNativeZoom: RAINVIEWER_MAX_NATIVE_ZOOM,
    fetchedAtIso: new Date().toISOString(),
    statusMessage: hasFrames
      ? `Radar operacional (${pastFrames.length} quadros passados, ${nowcastFrames.length} nowcast)`
      : 'Radar sem quadros disponíveis no momento (modo degradado)',
  };
}

/**
 * Busca os quadros de animação do radar de chuva RainViewer com degradação graciosa.
 * Nunca lança exceção fatal: em caso de indisponibilidade, sinaliza estado degradado (âmbar).
 */
export async function fetchRainViewerRadar(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
}): Promise<RainViewerRadarState> {
  try {
    const result = await fetchWithCircuitBreaker({
      service: 'rainviewer',
      url: RAINVIEWER_MAPS_URL,
      schema: RainViewerResponseSchema,
      degradedOnOpen: true,
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs,
      maxRetries: options?.maxRetries,
      backoffBaseMs: options?.backoffBaseMs,
    });

    const state = normalizeRainViewerResponse(result.data);
    if (state.degraded) {
      markServiceDegraded('rainviewer', state.statusMessage);
    }
    return state;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Indisponibilidade temporária do RainViewer';
    markServiceDegraded('rainviewer', `Modo degradado (âmbar): ${reason}`);

    return {
      available: false,
      degraded: true,
      host: DEFAULT_RAINVIEWER_HOST,
      frames: [],
      pastCount: 0,
      nowcastCount: 0,
      maxNativeZoom: RAINVIEWER_MAX_NATIVE_ZOOM,
      fetchedAtIso: new Date().toISOString(),
      statusMessage: `Radar indisponível — operando em modo degradado (${reason})`,
    };
  }
}
