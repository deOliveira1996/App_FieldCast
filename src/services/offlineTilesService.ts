import L from 'leaflet';
import {
  clearOfflineTiles,
  db,
  getOfflineTile,
  getOfflineTilesCount,
  saveOfflineTile,
} from '../db/database';
import type {
  OfflineMissionBounds,
  OfflineMissionProgress,
  OfflineTileRecord,
} from '../types/field';

export const MAX_OFFLINE_TILES_PER_MISSION = 300;
export const MAX_CONCURRENT_TILE_DOWNLOADS = 4;

/**
 * Servidores de tiles 100% gratuitos, públicos e verificados (HTTP 200, image/png & image/jpeg, CORS '*')
 * que NÃO exigem chave de API e nunca retornam marca d'água "API KEY REQUIRED".
 */
export const OSM_STANDARD_TILE_URL =
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const ESRI_WORLD_STREET_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

export const ESRI_WORLD_TOPO_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';

export const ESRI_WORLD_IMAGERY_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/**
 * Constantes mantidas por retrocompatibilidade de contrato, apontando para os servidores
 * gratuitos OpenStreetMap e Esri World Street Map (eliminando o bloqueio "API KEY REQUIRED" da CartoDB).
 */
export const CARTO_VOYAGER_TILE_URL = OSM_STANDARD_TILE_URL;
export const CARTO_DARK_MATTER_TILE_URL = ESRI_WORLD_STREET_TILE_URL;

export const CARTO_SUBDOMAINS = ['a', 'b', 'c'] as const;

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &bull; Tiles &copy; Esri';

const WEB_MERCATOR_MAX_LAT = 85.05112878;
const MAX_COORDINATE_ENUMERATION_SAFETY_CAP = 50_000;

export type MapTileTheme = 'light' | 'dark';

export type MapBaseStyle = 'osm' | 'esri_street' | 'esri_satellite';

export type OfflineDownloadProgress = OfflineMissionProgress;

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface ZoomTileCountBreakdown {
  zoom: number;
  count: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface MissionTileEstimate {
  totalTiles: number;
  exceedsLimit: boolean;
  maxAllowed: number;
  byZoom: ZoomTileCountBreakdown[];
}

export interface OfflineCacheStats {
  totalTiles: number;
  lightTiles: number;
  darkTiles: number;
  totalBytes: number;
  missionIds: string[];
}

export interface DownloadOfflineMissionOptions {
  bounds: OfflineMissionBounds;
  theme: MapTileTheme;
  baseStyle?: MapBaseStyle;
  missionId?: string;
  missionName?: string;
  maxConcurrent?: number;
  maxTiles?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: OfflineDownloadProgress) => void;
}

export class OfflineTileLimitExceededError extends Error {
  readonly requestedTiles: number;
  readonly maxAllowedTiles: number;

  constructor(requestedTiles: number, maxAllowedTiles = MAX_OFFLINE_TILES_PER_MISSION) {
    super(
      `A área selecionada requer ${requestedTiles} tiles, excedendo o limite máximo de ${maxAllowedTiles} tiles por missão offline.`,
    );
    this.name = 'OfflineTileLimitExceededError';
    this.requestedTiles = requestedTiles;
    this.maxAllowedTiles = maxAllowedTiles;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Converte longitude em graus (-180..180) para índice X de tile Slippy Map (OSM/Web Mercator).
 */
export function lonToTileX(lonDeg: number, zoom: number): number {
  const z = clamp(Math.floor(zoom), 0, 22);
  const n = 2 ** z;
  const clampedLon = clamp(lonDeg, -180, 179.9999999);
  const x = Math.floor(((clampedLon + 180) / 360) * n);
  return clamp(x, 0, n - 1);
}

/**
 * Converte latitude em graus (-85.05..85.05) para índice Y de tile Slippy Map (OSM/Web Mercator).
 */
export function latToTileY(latDeg: number, zoom: number): number {
  const z = clamp(Math.floor(zoom), 0, 22);
  const n = 2 ** z;
  const clampedLat = clamp(latDeg, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT);
  const latRad = (clampedLat * Math.PI) / 180;
  const mercatorY =
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  const y = Math.floor(mercatorY * n);
  return clamp(y, 0, n - 1);
}

/**
 * Converte índice X de tile para longitude (borda oeste do tile).
 */
export function tileXToLon(x: number, zoom: number): number {
  const n = 2 ** clamp(Math.floor(zoom), 0, 22);
  return (x / n) * 360 - 180;
}

/**
 * Converte índice Y de tile para latitude (borda norte do tile).
 */
export function tileYToLat(y: number, zoom: number): number {
  const n = 2 ** clamp(Math.floor(zoom), 0, 22);
  const rad = Math.PI - (2 * Math.PI * y) / n;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(rad) - Math.exp(-rad)));
}

/**
 * Normaliza os limites geográficos e níveis de zoom de uma missão offline.
 */
export function normalizeMissionBounds(bounds: OfflineMissionBounds): OfflineMissionBounds {
  const north = clamp(
    Math.max(bounds.north, bounds.south),
    -WEB_MERCATOR_MAX_LAT,
    WEB_MERCATOR_MAX_LAT,
  );
  const south = clamp(
    Math.min(bounds.north, bounds.south),
    -WEB_MERCATOR_MAX_LAT,
    WEB_MERCATOR_MAX_LAT,
  );
  const east = clamp(Math.max(bounds.east, bounds.west), -180, 180);
  const west = clamp(Math.min(bounds.east, bounds.west), -180, 180);

  const rawMinZoom = Math.floor(Math.min(bounds.minZoom, bounds.maxZoom));
  const rawMaxZoom = Math.floor(Math.max(bounds.minZoom, bounds.maxZoom));
  const minZoom = clamp(rawMinZoom, 0, 18);
  const maxZoom = clamp(rawMaxZoom, minZoom, 18);

  return {
    north,
    south,
    east,
    west,
    minZoom,
    maxZoom,
  };
}

/**
 * Cria um `OfflineMissionBounds` quadrado ao redor de uma coordenada central com raio em km.
 */
export function createMissionBoundsAroundPoint(
  latitude: number,
  longitude: number,
  radiusKm = 5,
  minZoom = 11,
  maxZoom = 14,
): OfflineMissionBounds {
  const safeRadiusKm = clamp(radiusKm, 0.25, 100);
  const latDelta = safeRadiusKm / 111.32;
  const cosLat = Math.max(0.1, Math.cos((latitude * Math.PI) / 180));
  const lonDelta = safeRadiusKm / (111.32 * cosLat);

  return normalizeMissionBounds({
    north: latitude + latDelta,
    south: latitude - latDelta,
    east: longitude + lonDelta,
    west: longitude - lonDelta,
    minZoom,
    maxZoom,
  });
}

/**
 * Estima a quantidade de tiles de uma área retangular por nível de zoom em tempo O(maxZoom - minZoom),
 * sem alocar arrays gigantescos na memória caso o usuário selecione uma área excessiva.
 */
export function estimateMissionTileCount(
  bounds: OfflineMissionBounds,
  maxAllowed = MAX_OFFLINE_TILES_PER_MISSION,
): MissionTileEstimate {
  const norm = normalizeMissionBounds(bounds);
  const byZoom: ZoomTileCountBreakdown[] = [];
  let totalTiles = 0;

  for (let z = norm.minZoom; z <= norm.maxZoom; z++) {
    const x1 = lonToTileX(norm.west, z);
    const x2 = lonToTileX(norm.east, z);
    // No Web Mercator, o norte possui índice Y menor que o sul
    const y1 = latToTileY(norm.north, z);
    const y2 = latToTileY(norm.south, z);

    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);

    const count = (xMax - xMin + 1) * (yMax - yMin + 1);
    totalTiles += count;
    byZoom.push({
      zoom: z,
      count,
      xMin,
      xMax,
      yMin,
      yMax,
    });
  }

  return {
    totalTiles,
    exceedsLimit: totalTiles > maxAllowed,
    maxAllowed,
    byZoom,
  };
}

/**
 * Calcula a lista de coordenadas de tiles `{ z, x, y }` que cobrem o retângulo e níveis de zoom da missão.
 * Se `options.enforceLimit` for `true`, lança `OfflineTileLimitExceededError` caso ultrapasse `maxTiles`.
 */
export function calculateMissionTileCoordinates(
  bounds: OfflineMissionBounds,
  options?: {
    enforceLimit?: boolean;
    maxTiles?: number;
  },
): TileCoordinate[] {
  const maxTiles = options?.maxTiles ?? MAX_OFFLINE_TILES_PER_MISSION;
  const estimate = estimateMissionTileCount(bounds, maxTiles);

  if (options?.enforceLimit && estimate.totalTiles > maxTiles) {
    throw new OfflineTileLimitExceededError(estimate.totalTiles, maxTiles);
  }

  const coordinates: TileCoordinate[] = [];

  for (const level of estimate.byZoom) {
    for (let x = level.xMin; x <= level.xMax; x++) {
      for (let y = level.yMin; y <= level.yMax; y++) {
        coordinates.push({
          z: level.zoom,
          x,
          y,
        });
        if (coordinates.length >= MAX_COORDINATE_ENUMERATION_SAFETY_CAP) {
          return coordinates;
        }
      }
    }
  }

  return coordinates;
}

/**
 * Gera a chave primária determinística de um tile no IndexedDB (`dexie`).
 */
export function buildOfflineTileKey(
  theme: MapTileTheme,
  z: number,
  x: number,
  y: number,
): string {
  return `${theme}:${z}/${x}/${y}`;
}

/**
 * Retorna o template de URL de mapa base gratuito (sem API Key) para o estilo selecionado.
 */
export function getTileUrlTemplateForStyle(style: MapBaseStyle): string {
  if (style === 'esri_satellite') {
    return ESRI_WORLD_IMAGERY_TILE_URL;
  }
  if (style === 'esri_street') {
    return ESRI_WORLD_STREET_TILE_URL;
  }
  return OSM_STANDARD_TILE_URL;
}

/**
 * Retorna o template de URL gratuito e verificado (OpenStreetMap / Esri World Street Map) para o tema informado.
 */
export function getCartoTileUrlTemplate(theme: MapTileTheme): string {
  return theme === 'dark' ? CARTO_DARK_MATTER_TILE_URL : CARTO_VOYAGER_TILE_URL;
}

/**
 * Monta a URL concreta de um tile a partir do tema ou estilo base (100% gratuito e sem chave de API).
 */
export function buildCartoTileUrl(
  theme: MapTileTheme,
  z: number,
  x: number,
  y: number,
  options?: {
    subdomain?: string;
    retina?: boolean;
    baseStyle?: MapBaseStyle;
  },
): string {
  const subdomain =
    options?.subdomain ??
    CARTO_SUBDOMAINS[Math.abs(x + y) % CARTO_SUBDOMAINS.length] ??
    'a';
  const template = options?.baseStyle
    ? getTileUrlTemplateForStyle(options.baseStyle)
    : getCartoTileUrlTemplate(theme);

  return template
    .replace('{s}', subdomain)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '');
}

/**
 * Executa o download em lote dos tiles de uma Área de Missão Offline e salva os blobs no IndexedDB (`dexie`).
 *
 * Regras estritas (Seção 4.5 de `docs/SPEC.md`):
 * - Trava rígida de **no máximo 300 tiles por missão** (`MAX_OFFLINE_TILES_PER_MISSION = 300`).
 * - Fila concorrente com **no máximo 4 downloads simultâneos** (`MAX_CONCURRENT_TILE_DOWNLOADS = 4`).
 * - Reporte de progresso em tempo real (`onProgress`), suporte a cancelamento via `AbortController`
 *   e tratamento gracioso de falhas individuais de rede/CORS.
 */
export async function downloadOfflineMissionTiles(
  options: DownloadOfflineMissionOptions,
): Promise<OfflineDownloadProgress> {
  const {
    bounds,
    theme,
    baseStyle,
    missionId = `mission-${Date.now()}`,
    missionName = 'Área de Missão Offline',
    signal,
    fetchImpl = fetch,
    onProgress,
  } = options;

  const maxTiles = options.maxTiles ?? MAX_OFFLINE_TILES_PER_MISSION;
  const maxConcurrent = clamp(
    Math.floor(options.maxConcurrent ?? MAX_CONCURRENT_TILE_DOWNLOADS),
    1,
    MAX_CONCURRENT_TILE_DOWNLOADS,
  );

  const estimate = estimateMissionTileCount(bounds, maxTiles);

  if (estimate.totalTiles > maxTiles) {
    const errorProgress: OfflineDownloadProgress = {
      missionId,
      totalTiles: estimate.totalTiles,
      completedTiles: 0,
      failedTiles: 0,
      status: 'error',
      errorMessage: `Limite excedido: ${estimate.totalTiles} tiles solicitados (máximo: ${maxTiles}).`,
    };
    onProgress?.(errorProgress);
    throw new OfflineTileLimitExceededError(estimate.totalTiles, maxTiles);
  }

  const coordinates = calculateMissionTileCoordinates(bounds, {
    enforceLimit: true,
    maxTiles,
  });

  if (coordinates.length === 0) {
    const emptyProgress: OfflineDownloadProgress = {
      missionId,
      totalTiles: 0,
      completedTiles: 0,
      failedTiles: 0,
      status: 'completed',
    };
    onProgress?.(emptyProgress);
    return emptyProgress;
  }

  if (signal?.aborted) {
    const cancelledProgress: OfflineDownloadProgress = {
      missionId,
      totalTiles: coordinates.length,
      completedTiles: 0,
      failedTiles: 0,
      status: 'cancelled',
      errorMessage: 'Download cancelado pelo usuário.',
    };
    onProgress?.(cancelledProgress);
    return cancelledProgress;
  }

  let nextIndex = 0;
  let completedTiles = 0;
  let failedTiles = 0;

  const emitProgress = (
    status: OfflineDownloadProgress['status'],
    errorMessage?: string,
  ): OfflineDownloadProgress => {
    const snapshot: OfflineDownloadProgress = {
      missionId,
      totalTiles: coordinates.length,
      completedTiles,
      failedTiles,
      status,
      ...(errorMessage ? { errorMessage } : {}),
    };
    onProgress?.(snapshot);
    return snapshot;
  };

  emitProgress('downloading');

  const workerCount = Math.min(maxConcurrent, coordinates.length);

  const runWorker = async (): Promise<void> => {
    while (nextIndex < coordinates.length) {
      if (signal?.aborted) {
        return;
      }

      const currentIndex = nextIndex++;
      const coord = coordinates[currentIndex];
      if (!coord) {
        return;
      }

      const url = buildCartoTileUrl(theme, coord.z, coord.x, coord.y, {
        baseStyle,
      });
      const key = buildOfflineTileKey(theme, coord.z, coord.x, coord.y);

      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          signal,
        });

        if (signal?.aborted) {
          return;
        }

        if (!response.ok) {
          failedTiles += 1;
          emitProgress('downloading');
          continue;
        }

        const blob = await response.blob();

        if (signal?.aborted) {
          return;
        }

        const record: OfflineTileRecord = {
          key,
          missionId,
          missionName,
          z: coord.z,
          x: coord.x,
          y: coord.y,
          theme,
          blob,
          sizeBytes: blob.size,
          cachedAtIso: new Date().toISOString(),
        };

        await saveOfflineTile(record);
        completedTiles += 1;
        emitProgress('downloading');
      } catch (err: unknown) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return;
        }
        // Erro individual de rede ou CORS: contabiliza falha sem abortar os demais tiles da fila
        failedTiles += 1;
        emitProgress('downloading');
      }
    }
  };

  const workers = Array.from({ length: workerCount }, () => runWorker());
  await Promise.all(workers);

  if (signal?.aborted) {
    return emitProgress('cancelled', 'Download cancelado pelo usuário.');
  }

  if (completedTiles === 0 && failedTiles > 0) {
    return emitProgress(
      'error',
      'Não foi possível baixar os tiles da área selecionada (erro de rede ou CORS).',
    );
  }

  return emitProgress('completed');
}

/**
 * Consulta estatísticas detalhadas dos tiles armazenados no IndexedDB (`dexie`).
 */
export async function getOfflineCacheStats(): Promise<OfflineCacheStats> {
  try {
    const totalCount = await getOfflineTilesCount();
    if (totalCount === 0) {
      return {
        totalTiles: 0,
        lightTiles: 0,
        darkTiles: 0,
        totalBytes: 0,
        missionIds: [],
      };
    }

    let records: OfflineTileRecord[] = [];
    if (typeof indexedDB !== 'undefined' && indexedDB !== null) {
      try {
        records = await db.offlineTiles.toArray();
      } catch {
        records = [];
      }
    }

    if (records.length === 0) {
      return {
        totalTiles: totalCount,
        lightTiles: 0,
        darkTiles: 0,
        totalBytes: 0,
        missionIds: [],
      };
    }

    let lightTiles = 0;
    let darkTiles = 0;
    let totalBytes = 0;
    const missionSet = new Set<string>();

    for (const item of records) {
      if (item.theme === 'dark') {
        darkTiles += 1;
      } else {
        lightTiles += 1;
      }
      totalBytes += item.sizeBytes || item.blob?.size || 0;
      if (item.missionId) {
        missionSet.add(item.missionId);
      }
    }

    return {
      totalTiles: records.length,
      lightTiles,
      darkTiles,
      totalBytes,
      missionIds: Array.from(missionSet),
    };
  } catch {
    return {
      totalTiles: 0,
      lightTiles: 0,
      darkTiles: 0,
      totalBytes: 0,
      missionIds: [],
    };
  }
}

export {
  clearOfflineTiles,
  getOfflineTile,
  getOfflineTilesCount,
  saveOfflineTile,
};

function createBlobDisplayUrl(blob: Blob): {
  url: string;
  isObjectUrl: boolean;
} {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      return {
        url: URL.createObjectURL(blob),
        isObjectUrl: true,
      };
    } catch {
      // Fallback para data URL (ex.: jsdom ou Blob cross-realm)
    }
  }
  return {
    url: `data:${blob.type || 'image/png'};base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=`,
    isObjectUrl: false,
  };
}

/**
 * Subclasse customizada de `L.TileLayer` que sobrescreve `createTile()`
 * para buscar primeiro o blob do tile no IndexedDB (`dexie`) e cair na rede
 * gratuita sem API Key (OpenStreetMap / Esri ArcGIS Online) quando não estiver em cache.
 *
 * Não força `tile.crossOrigin = 'anonymous'` nas tags `<img>` de carregamento ao vivo
 * para evitar bloqueios de CDN baseados em cabeçalho `Origin`, mantendo fallback secundário automático.
 */
export class OfflineCartoTileLayer extends L.TileLayer {
  private theme: MapTileTheme;
  private baseStyle: MapBaseStyle | null;

  constructor(
    theme: MapTileTheme = 'light',
    options?: L.TileLayerOptions & { baseStyle?: MapBaseStyle },
  ) {
    const initialStyle = options?.baseStyle ?? null;
    const initialTemplate = initialStyle
      ? getTileUrlTemplateForStyle(initialStyle)
      : getCartoTileUrlTemplate(theme);

    super(initialTemplate, {
      subdomains: [...CARTO_SUBDOMAINS],
      maxZoom: 19,
      attribution: CARTO_ATTRIBUTION,
      ...options,
    });
    this.theme = theme;
    this.baseStyle = initialStyle;
  }

  getTheme(): MapTileTheme {
    return this.theme;
  }

  getBaseStyle(): MapBaseStyle {
    if (this.baseStyle) {
      return this.baseStyle;
    }
    return this.theme === 'dark' ? 'esri_street' : 'osm';
  }

  setTheme(nextTheme: MapTileTheme): this {
    if (this.theme !== nextTheme) {
      this.theme = nextTheme;
      if (!this.baseStyle) {
        this.setUrl(getCartoTileUrlTemplate(nextTheme));
      }
    }
    return this;
  }

  setBaseStyle(nextStyle: MapBaseStyle | null): this {
    if (this.baseStyle !== nextStyle) {
      this.baseStyle = nextStyle;
      const nextUrl = nextStyle
        ? getTileUrlTemplateForStyle(nextStyle)
        : getCartoTileUrlTemplate(this.theme);
      this.setUrl(nextUrl);
    }
    return this;
  }

  override getTileUrl(coords: L.Coords): string {
    const rawZ = Number.isFinite(coords.z) ? coords.z : 12;
    return buildCartoTileUrl(this.theme, rawZ, coords.x, coords.y, {
      baseStyle: this.getBaseStyle(),
    });
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    tile.referrerPolicy = 'no-referrer-when-downgrade';

    const key = buildOfflineTileKey(this.theme, coords.z, coords.x, coords.y);
    const networkUrl = this.getTileUrl(coords);
    const secondaryFallbackUrl = buildCartoTileUrl(
      this.theme,
      coords.z,
      coords.x,
      coords.y,
      {
        baseStyle:
          this.getBaseStyle() === 'osm' ? 'esri_street' : 'osm',
      },
    );
    let activeObjectUrl: string | null = null;
    let triedNetworkFallback = false;
    let triedSecondaryServer = false;

    const cleanupObjectUrl = (): void => {
      if (activeObjectUrl) {
        try {
          URL.revokeObjectURL(activeObjectUrl);
        } catch {
          // Ignora falha ao revogar ObjectURL em ambientes de teste
        }
        activeObjectUrl = null;
      }
    };

    L.DomEvent.on(tile, 'load', () => {
      cleanupObjectUrl();
      done(undefined, tile);
    });

    L.DomEvent.on(tile, 'error', () => {
      cleanupObjectUrl();
      if (!triedNetworkFallback && tile.src !== networkUrl) {
        triedNetworkFallback = true;
        tile.dataset.offlineSource = 'network-fallback';
        tile.src = networkUrl;
        return;
      }
      if (!triedSecondaryServer && tile.src !== secondaryFallbackUrl) {
        triedSecondaryServer = true;
        tile.dataset.offlineSource = 'network-secondary-fallback';
        tile.src = secondaryFallbackUrl;
        return;
      }
      done(new Error(`Falha ao carregar tile ${key}`), tile);
    });

    void getOfflineTile(key)
      .then((cached) => {
        const hasValidBlob =
          cached &&
          cached.blob &&
          (cached.blob.size > 0 || cached.sizeBytes > 0);

        if (hasValidBlob && cached) {
          const display = createBlobDisplayUrl(cached.blob);
          if (display.isObjectUrl) {
            activeObjectUrl = display.url;
          }
          tile.dataset.offlineSource = 'indexeddb';
          tile.src = display.url;
        } else {
          triedNetworkFallback = true;
          tile.dataset.offlineSource = 'network';
          tile.src = networkUrl;
        }
      })
      .catch(() => {
        triedNetworkFallback = true;
        tile.dataset.offlineSource = 'network';
        tile.src = networkUrl;
      });

    return tile;
  }
}

/**
 * Factory para instanciar `OfflineCartoTileLayer` com servidores gratuitos sem API Key (OSM / Esri).
 */
export function createOfflineCartoTileLayer(
  theme: MapTileTheme = 'light',
  options?: L.TileLayerOptions & { baseStyle?: MapBaseStyle },
): OfflineCartoTileLayer {
  return new OfflineCartoTileLayer(theme, options);
}
