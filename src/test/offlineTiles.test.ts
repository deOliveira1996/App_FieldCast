import { beforeEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { resetDatabaseForTests } from '../db/database';
import {
  buildCartoTileUrl,
  buildOfflineTileKey,
  calculateMissionTileCoordinates,
  clearOfflineTiles,
  createMissionBoundsAroundPoint,
  createOfflineCartoTileLayer,
  downloadOfflineMissionTiles,
  estimateMissionTileCount,
  getOfflineTile,
  getOfflineTilesCount,
  latToTileY,
  lonToTileX,
  MAX_CONCURRENT_TILE_DOWNLOADS,
  MAX_OFFLINE_TILES_PER_MISSION,
  OfflineTileLimitExceededError,
  saveOfflineTile,
  type OfflineDownloadProgress,
} from '../services/offlineTilesService';
import type { OfflineMissionBounds } from '../types/field';

describe('Sprint 3A — Offline Mission Tiles Service & Concurrency Queue', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  it('calcula coordenadas Slippy Map (z, x, y) corretamente para retângulo e múltiplos níveis de zoom', () => {
    // Florianópolis (-27.5954, -48.5480)
    const bounds = createMissionBoundsAroundPoint(-27.5954, -48.548, 3, 11, 13);
    const estimate = estimateMissionTileCount(bounds);
    const coords = calculateMissionTileCoordinates(bounds);

    expect(estimate.totalTiles).toBeGreaterThan(0);
    expect(estimate.totalTiles).toBeLessThanOrEqual(MAX_OFFLINE_TILES_PER_MISSION);
    expect(estimate.exceedsLimit).toBe(false);
    expect(coords.length).toBe(estimate.totalTiles);
    expect(estimate.byZoom.map((z) => z.zoom)).toEqual([11, 12, 13]);

    // Verifica que todas as coordenadas geradas estão dentro dos limites esperados em cada zoom
    for (const c of coords) {
      const expectedXMin = lonToTileX(bounds.west, c.z);
      const expectedXMax = lonToTileX(bounds.east, c.z);
      const expectedYMin = latToTileY(bounds.north, c.z);
      const expectedYMax = latToTileY(bounds.south, c.z);

      expect(c.x).toBeGreaterThanOrEqual(expectedXMin);
      expect(c.x).toBeLessThanOrEqual(expectedXMax);
      expect(c.y).toBeGreaterThanOrEqual(expectedYMin);
      expect(c.y).toBeLessThanOrEqual(expectedYMax);
    }
  });

  it('impõe trava rígida de no máximo 300 tiles por missão (MAX_OFFLINE_TILES_PER_MISSION = 300)', async () => {
    // Área ampla em zoom alto que ultrapassa 300 tiles
    const oversizedBounds: OfflineMissionBounds = {
      north: -27.0,
      south: -28.5,
      east: -47.5,
      west: -49.0,
      minZoom: 10,
      maxZoom: 14,
    };

    const estimate = estimateMissionTileCount(oversizedBounds);
    expect(estimate.totalTiles).toBeGreaterThan(MAX_OFFLINE_TILES_PER_MISSION);
    expect(estimate.exceedsLimit).toBe(true);

    expect(() =>
      calculateMissionTileCoordinates(oversizedBounds, { enforceLimit: true }),
    ).toThrowError(OfflineTileLimitExceededError);

    const mockFetch = vi.fn<typeof fetch>();
    const progressUpdates: OfflineDownloadProgress[] = [];

    await expect(
      downloadOfflineMissionTiles({
        bounds: oversizedBounds,
        theme: 'dark',
        fetchImpl: mockFetch,
        onProgress: (p) => progressUpdates.push(p),
      }),
    ).rejects.toThrowError(OfflineTileLimitExceededError);

    // Nenhum request de rede pode ter sido disparado quando o limite de 300 tiles é violado
    expect(mockFetch).not.toHaveBeenCalled();
    expect(progressUpdates.at(-1)?.status).toBe('error');
    expect(await getOfflineTilesCount()).toBe(0);
  });

  it('respeita o limite estrito de no máximo 4 downloads simultâneos e persiste tiles no Dexie', async () => {
    // Cria missão com ~16 a 30 tiles
    const bounds = createMissionBoundsAroundPoint(-27.5954, -48.548, 4, 12, 13);
    const expectedCoords = calculateMissionTileCoordinates(bounds);
    expect(expectedCoords.length).toBeGreaterThan(8);
    expect(expectedCoords.length).toBeLessThanOrEqual(MAX_OFFLINE_TILES_PER_MISSION);

    let activeInFlight = 0;
    let maxObservedConcurrency = 0;

    const fakeFetch: typeof fetch = async () => {
      activeInFlight += 1;
      if (activeInFlight > maxObservedConcurrency) {
        maxObservedConcurrency = activeInFlight;
      }

      // Simula latência de rede para forçar saturação da fila concorrente
      await new Promise((resolve) => setTimeout(resolve, 12));

      activeInFlight -= 1;

      const payload = new Uint8Array([137, 80, 78, 71]);
      return new Response(new Blob([payload], { type: 'image/png' }), {
        status: 200,
      });
    };

    const progressHistory: OfflineDownloadProgress[] = [];

    const finalProgress = await downloadOfflineMissionTiles({
      bounds,
      theme: 'dark',
      missionId: 'test-mission-concurrency',
      // Mesmo passando um valor maior, o serviço deve limitar a MAX_CONCURRENT_TILE_DOWNLOADS (4)
      maxConcurrent: 12,
      fetchImpl: fakeFetch,
      onProgress: (p) => progressHistory.push({ ...p }),
    });

    expect(maxObservedConcurrency).toBeLessThanOrEqual(MAX_CONCURRENT_TILE_DOWNLOADS);
    expect(maxObservedConcurrency).toBe(MAX_CONCURRENT_TILE_DOWNLOADS);

    expect(finalProgress.status).toBe('completed');
    expect(finalProgress.totalTiles).toBe(expectedCoords.length);
    expect(finalProgress.completedTiles).toBe(expectedCoords.length);
    expect(finalProgress.failedTiles).toBe(0);

    const savedCount = await getOfflineTilesCount('test-mission-concurrency');
    expect(savedCount).toBe(expectedCoords.length);

    // Verifica que o primeiro tile pode ser lido do Dexie pela chave determinística
    const firstCoord = expectedCoords[0]!;
    const firstKey = buildOfflineTileKey('dark', firstCoord.z, firstCoord.x, firstCoord.y);
    const cachedRecord = await getOfflineTile(firstKey);
    expect(cachedRecord).toBeDefined();
    expect(cachedRecord?.theme).toBe('dark');
    expect(cachedRecord?.sizeBytes).toBeGreaterThan(0);

    // Limpa os tiles da missão
    await clearOfflineTiles('test-mission-concurrency');
    expect(await getOfflineTilesCount('test-mission-concurrency')).toBe(0);
  });

  it('suporta cancelamento via AbortController e lida graciosamente com falhas parciais de rede/CORS', async () => {
    const bounds = createMissionBoundsAroundPoint(-15.7939, -47.8828, 3, 12, 13);
    const coords = calculateMissionTileCoordinates(bounds);
    expect(coords.length).toBeGreaterThan(4);

    let callCount = 0;
    const partialFailFetch: typeof fetch = async () => {
      callCount += 1;
      if (callCount % 3 === 0) {
        throw new TypeError('Failed to fetch (CORS / offline)');
      }
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
        status: 200,
      });
    };

    const result = await downloadOfflineMissionTiles({
      bounds,
      theme: 'light',
      missionId: 'mission-partial-fail',
      fetchImpl: partialFailFetch,
    });

    expect(result.status).toBe('completed');
    expect(result.completedTiles + result.failedTiles).toBe(coords.length);
    expect(result.completedTiles).toBeGreaterThan(0);
    expect(result.failedTiles).toBeGreaterThan(0);

    // Testa cancelamento imediato com AbortController
    const controller = new AbortController();
    controller.abort();

    const cancelledResult = await downloadOfflineMissionTiles({
      bounds,
      theme: 'light',
      missionId: 'mission-aborted',
      signal: controller.signal,
      fetchImpl: partialFailFetch,
    });

    expect(cancelledResult.status).toBe('cancelled');
    expect(cancelledResult.completedTiles).toBe(0);
  });

  it('OfflineCartoTileLayer sobrescreve createTile() lendo do Dexie primeiro e usando servidores gratuitos sem API Key (OSM / Esri) como fallback', async () => {
    const z = 12;
    const x = 1495;
    const y = 2401;
    const key = buildOfflineTileKey('light', z, x, y);

    await saveOfflineTile({
      key,
      missionId: 'tile-layer-test',
      z,
      x,
      y,
      theme: 'light',
      blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      sizeBytes: 4,
      cachedAtIso: new Date().toISOString(),
    });

    const layer = createOfflineCartoTileLayer('light');
    expect(layer.getTheme()).toBe('light');
    expect(layer.getBaseStyle()).toBe('osm');

    // Tile em cache no Dexie (não força crossOrigin='anonymous' em <img> ao vivo para evitar bloqueios de CDN)
    const cachedCoords = { x, y, z } as L.Coords;
    const cachedImg = layer.createTile(cachedCoords, () => {}) as HTMLImageElement;

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cachedImg.dataset.offlineSource).toBe('indexeddb');

    // Tile não existente em cache -> fallback para URL OpenStreetMap gratuita sem API Key
    const uncachedCoords = { x: x + 1, y, z } as L.Coords;
    const uncachedImg = layer.createTile(uncachedCoords, () => {}) as HTMLImageElement;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(uncachedImg.dataset.offlineSource).toBe('network');
    expect(uncachedImg.src).toContain('tile.openstreetmap.org/12/1496/2401.png');
    expect(uncachedImg.src).not.toContain('basemaps.cartocdn.com');

    // Verifica URL dos estilos gratuitos (OSM e Esri World Street Map / Imagery)
    const lightUrl = buildCartoTileUrl('light', z, x, y);
    expect(lightUrl).toBe('https://tile.openstreetmap.org/12/1495/2401.png');

    const darkUrl = buildCartoTileUrl('dark', z, x, y);
    expect(darkUrl).toContain(
      'server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/12/2401/1495',
    );
    expect(darkUrl).not.toContain('basemaps.cartocdn.com');

    const satelliteUrl = buildCartoTileUrl('light', z, x, y, {
      baseStyle: 'esri_satellite',
    });
    expect(satelliteUrl).toContain(
      'server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/2401/1495',
    );
  });
});
