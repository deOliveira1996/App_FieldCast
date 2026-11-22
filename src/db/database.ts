import Dexie, { type Table } from 'dexie';
import { haversineDistanceKm } from '../utils/exporters';
import type {
  OfflineTileRecord,
  SavedLocation,
  TrackSession,
  Waypoint,
} from '../types/field';
import type { ErrorLogRecord } from '../types/health';
import type { NormalizedForecast } from '../types/weather';

export interface ForecastCacheRecord {
  locationKey: string;
  latitude: number;
  longitude: number;
  fetchedAtIso: string;
  forecast: NormalizedForecast;
}

/**
 * Gera chave normalizada de coordenada com 3 casas decimais (~110m de resolução)
 * para indexação consistente no cache de previsão.
 */
export function buildLocationKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

export const DEFAULT_SAVED_LOCATIONS: SavedLocation[] = [
  {
    id: 'loc-florianopolis-sc',
    name: 'Florianópolis — SC (Costeiro)',
    latitude: -27.5954,
    longitude: -48.548,
    elevationM: 23,
    region: 'Santa Catarina, Brasil',
    isFavorite: true,
    createdAtIso: '2025-01-01T00:00:00.000Z',
    lastUsedAtIso: '2025-01-02T00:00:00.000Z',
  },
  {
    id: 'loc-brasilia-df',
    name: 'Brasília — DF (Continental)',
    latitude: -15.7939,
    longitude: -47.8828,
    elevationM: 1092,
    region: 'Distrito Federal, Brasil',
    isFavorite: true,
    createdAtIso: '2025-01-01T00:00:00.000Z',
    lastUsedAtIso: '2025-01-01T00:00:00.000Z',
  },
];

export class FieldCastDatabase extends Dexie {
  savedLocations!: Table<SavedLocation, string>;
  forecastCache!: Table<ForecastCacheRecord, string>;
  waypoints!: Table<Waypoint, string>;
  tracks!: Table<TrackSession, string>;
  offlineTiles!: Table<OfflineTileRecord, string>;
  errorLogs!: Table<ErrorLogRecord, number>;

  constructor() {
    super('FieldCastDB');
    this.version(1).stores({
      savedLocations: 'id, name, isFavorite, lastUsedAtIso',
      forecastCache: 'locationKey, fetchedAtIso, latitude, longitude',
      waypoints: 'id, timestampUtcIso, trackId',
      tracks: 'id, startedAtIso, status',
      offlineTiles: 'key, missionId, z, theme, cachedAtIso',
      errorLogs: '++id, timestampUtcIso, module, action',
    });
  }
}

export const db = new FieldCastDatabase();

/**
 * Fallback em memória para ambientes onde `indexedDB` não está disponível
 * (ex.: ambiente headless `jsdom` no Vitest ou modo privado restrito).
 */
const memoryStore = {
  savedLocations: new Map<string, SavedLocation>(),
  forecastCache: new Map<string, ForecastCacheRecord>(),
  waypoints: new Map<string, Waypoint>(),
  tracks: new Map<string, TrackSession>(),
  offlineTiles: new Map<string, OfflineTileRecord>(),
  errorLogs: [] as ErrorLogRecord[],
  nextErrorId: 1,
};

function hasNativeIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

/**
 * Limpa o store em memória e o banco IndexedDB (útil para isolamento de testes e botão "Limpar Cache").
 */
export async function resetDatabaseForTests(): Promise<void> {
  memoryStore.savedLocations.clear();
  memoryStore.forecastCache.clear();
  memoryStore.waypoints.clear();
  memoryStore.tracks.clear();
  memoryStore.offlineTiles.clear();
  memoryStore.errorLogs = [];
  memoryStore.nextErrorId = 1;

  if (hasNativeIndexedDb()) {
    try {
      await Promise.all([
        db.savedLocations.clear(),
        db.forecastCache.clear(),
        db.waypoints.clear(),
        db.tracks.clear(),
        db.offlineTiles.clear(),
        db.errorLogs.clear(),
      ]);
    } catch {
      // Ignora caso o banco ainda não esteja aberto no ambiente
    }
  }
}

/**
 * Verifica a saúde do armazenamento local (IndexedDB ou fallback resiliente).
 */
export async function checkIndexedDbHealth(): Promise<boolean> {
  if (!hasNativeIndexedDb()) {
    return true;
  }
  try {
    await db.open();
    return db.isOpen();
  } catch {
    return false;
  }
}

// ============================================================================
// CRUD: SavedLocations
// ============================================================================

export async function getSavedLocations(): Promise<SavedLocation[]> {
  if (hasNativeIndexedDb()) {
    try {
      const list = await db.savedLocations.toArray();
      for (const item of list) {
        memoryStore.savedLocations.set(item.id, item);
      }
      return sortSavedLocations(list);
    } catch {
      // Fallback para memória
    }
  }
  return sortSavedLocations(Array.from(memoryStore.savedLocations.values()));
}

function sortSavedLocations(locations: SavedLocation[]): SavedLocation[] {
  return [...locations].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    return b.lastUsedAtIso.localeCompare(a.lastUsedAtIso);
  });
}

export async function ensureDefaultSavedLocations(): Promise<SavedLocation[]> {
  const existing = await getSavedLocations();
  if (existing.length > 0) {
    return existing;
  }
  for (const loc of DEFAULT_SAVED_LOCATIONS) {
    await upsertSavedLocation(loc);
  }
  return getSavedLocations();
}

export async function upsertSavedLocation(location: SavedLocation): Promise<void> {
  memoryStore.savedLocations.set(location.id, { ...location });
  if (hasNativeIndexedDb()) {
    try {
      await db.savedLocations.put(location);
    } catch {
      // Mantém no fallback em memória
    }
  }
}

export async function renameSavedLocation(id: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) return;

  const existing = memoryStore.savedLocations.get(id);
  if (existing) {
    memoryStore.savedLocations.set(id, { ...existing, name: trimmed });
  }

  if (hasNativeIndexedDb()) {
    try {
      await db.savedLocations.update(id, { name: trimmed });
    } catch {
      // Fallback já atualizado
    }
  }
}

export async function toggleFavoriteLocation(id: string): Promise<void> {
  const all = await getSavedLocations();
  const target = all.find((l) => l.id === id);
  if (!target) return;

  const updated: SavedLocation = {
    ...target,
    isFavorite: !target.isFavorite,
    lastUsedAtIso: new Date().toISOString(),
  };
  await upsertSavedLocation(updated);
}

export async function deleteSavedLocation(id: string): Promise<void> {
  memoryStore.savedLocations.delete(id);
  if (hasNativeIndexedDb()) {
    try {
      await db.savedLocations.delete(id);
    } catch {
      // Ignora falha de IDB
    }
  }
}

// ============================================================================
// CRUD: ForecastCache
// ============================================================================

export async function saveForecastCache(forecast: NormalizedForecast): Promise<void> {
  const locationKey =
    forecast.locationKey || buildLocationKey(forecast.latitude, forecast.longitude);
  const record: ForecastCacheRecord = {
    locationKey,
    latitude: forecast.latitude,
    longitude: forecast.longitude,
    fetchedAtIso: forecast.fetchedAtIso,
    forecast: {
      ...forecast,
      locationKey,
    },
  };

  memoryStore.forecastCache.set(locationKey, record);

  if (hasNativeIndexedDb()) {
    try {
      await db.forecastCache.put(record);
    } catch {
      // Mantém no fallback em memória
    }
  }
}

/**
 * Busca previsão em cache para a coordenada informada (chave exata ou ponto em raio <= 15 km).
 */
export async function getCachedForecast(
  latitude: number,
  longitude: number,
  maxDistanceKm = 15,
): Promise<ForecastCacheRecord | null> {
  const key = buildLocationKey(latitude, longitude);

  if (hasNativeIndexedDb()) {
    try {
      const exact = await db.forecastCache.get(key);
      if (exact) {
        memoryStore.forecastCache.set(key, exact);
        return exact;
      }
      const all = await db.forecastCache.toArray();
      for (const item of all) {
        memoryStore.forecastCache.set(item.locationKey, item);
      }
    } catch {
      // Fallback para memória
    }
  }

  const memExact = memoryStore.forecastCache.get(key);
  if (memExact) {
    return memExact;
  }

  // Busca o ponto mais próximo dentro de maxDistanceKm
  let nearest: ForecastCacheRecord | null = null;
  let bestDist = Infinity;

  for (const record of memoryStore.forecastCache.values()) {
    const dist = haversineDistanceKm(latitude, longitude, record.latitude, record.longitude);
    if (dist <= maxDistanceKm && dist < bestDist) {
      bestDist = dist;
      nearest = record;
    }
  }

  return nearest;
}

export async function getLatestCachedForecast(): Promise<ForecastCacheRecord | null> {
  if (hasNativeIndexedDb()) {
    try {
      const all = await db.forecastCache.toArray();
      for (const item of all) {
        memoryStore.forecastCache.set(item.locationKey, item);
      }
    } catch {
      // Fallback para memória
    }
  }

  const allRecords = Array.from(memoryStore.forecastCache.values());
  if (allRecords.length === 0) {
    return null;
  }
  allRecords.sort((a, b) => b.fetchedAtIso.localeCompare(a.fetchedAtIso));
  return allRecords[0] ?? null;
}

// ============================================================================
// CRUD: Waypoints
// ============================================================================

export async function saveWaypoint(waypoint: Waypoint): Promise<void> {
  memoryStore.waypoints.set(waypoint.id, { ...waypoint });
  if (hasNativeIndexedDb()) {
    try {
      await db.waypoints.put(waypoint);
    } catch {
      // Mantém em memória
    }
  }
}

export async function getWaypoints(): Promise<Waypoint[]> {
  if (hasNativeIndexedDb()) {
    try {
      const list = await db.waypoints.toArray();
      for (const wp of list) {
        memoryStore.waypoints.set(wp.id, wp);
      }
    } catch {
      // Fallback
    }
  }
  return Array.from(memoryStore.waypoints.values()).sort((a, b) =>
    b.timestampUtcIso.localeCompare(a.timestampUtcIso),
  );
}

export async function deleteWaypoint(id: string): Promise<void> {
  memoryStore.waypoints.delete(id);
  if (hasNativeIndexedDb()) {
    try {
      await db.waypoints.delete(id);
    } catch {
      // Ignora
    }
  }
}

// ============================================================================
// CRUD: Tracks
// ============================================================================

export async function saveTrackSession(track: TrackSession): Promise<void> {
  memoryStore.tracks.set(track.id, { ...track, points: [...track.points] });
  if (hasNativeIndexedDb()) {
    try {
      await db.tracks.put(track);
    } catch {
      // Mantém em memória
    }
  }
}

export async function getTrackSessions(): Promise<TrackSession[]> {
  if (hasNativeIndexedDb()) {
    try {
      const list = await db.tracks.toArray();
      for (const trk of list) {
        memoryStore.tracks.set(trk.id, trk);
      }
    } catch {
      // Fallback
    }
  }
  return Array.from(memoryStore.tracks.values()).sort((a, b) =>
    b.startedAtIso.localeCompare(a.startedAtIso),
  );
}

export async function deleteTrackSession(id: string): Promise<void> {
  memoryStore.tracks.delete(id);
  if (hasNativeIndexedDb()) {
    try {
      await db.tracks.delete(id);
    } catch {
      // Ignora
    }
  }
}

// ============================================================================
// CRUD: OfflineTiles
// ============================================================================

export async function saveOfflineTile(tile: OfflineTileRecord): Promise<void> {
  memoryStore.offlineTiles.set(tile.key, tile);
  if (hasNativeIndexedDb()) {
    try {
      await db.offlineTiles.put(tile);
    } catch {
      // Mantém em memória
    }
  }
}

export async function getOfflineTile(key: string): Promise<OfflineTileRecord | undefined> {
  if (hasNativeIndexedDb()) {
    try {
      const tile = await db.offlineTiles.get(key);
      if (tile) {
        memoryStore.offlineTiles.set(key, tile);
        return tile;
      }
    } catch {
      // Fallback
    }
  }
  return memoryStore.offlineTiles.get(key);
}

export async function getOfflineTilesCount(missionId?: string): Promise<number> {
  if (hasNativeIndexedDb()) {
    try {
      if (missionId) {
        return await db.offlineTiles.where('missionId').equals(missionId).count();
      }
      return await db.offlineTiles.count();
    } catch {
      // Fallback
    }
  }
  if (!missionId) {
    return memoryStore.offlineTiles.size;
  }
  let count = 0;
  for (const t of memoryStore.offlineTiles.values()) {
    if (t.missionId === missionId) count++;
  }
  return count;
}

export async function clearOfflineTiles(missionId?: string): Promise<void> {
  if (!missionId) {
    memoryStore.offlineTiles.clear();
  } else {
    for (const [k, v] of memoryStore.offlineTiles.entries()) {
      if (v.missionId === missionId) {
        memoryStore.offlineTiles.delete(k);
      }
    }
  }

  if (hasNativeIndexedDb()) {
    try {
      if (!missionId) {
        await db.offlineTiles.clear();
      } else {
        await db.offlineTiles.where('missionId').equals(missionId).delete();
      }
    } catch {
      // Ignora
    }
  }
}

// ============================================================================
// CRUD: ErrorLogs
// ============================================================================

export async function logErrorToDb(record: Omit<ErrorLogRecord, 'id'>): Promise<void> {
  const entry: ErrorLogRecord = {
    ...record,
    id: memoryStore.nextErrorId++,
  };
  memoryStore.errorLogs.push(entry);
  if (memoryStore.errorLogs.length > 200) {
    memoryStore.errorLogs.shift();
  }

  if (hasNativeIndexedDb()) {
    try {
      await db.errorLogs.add(record);
    } catch {
      // Ignora falha de gravação de log para preservar Zero-Crash
    }
  }
}

export async function getRecentErrorLogs(limit = 50): Promise<ErrorLogRecord[]> {
  if (hasNativeIndexedDb()) {
    try {
      const rows = await db.errorLogs.orderBy('timestampUtcIso').reverse().limit(limit).toArray();
      if (rows.length > 0) {
        return rows;
      }
    } catch {
      // Fallback
    }
  }
  return [...memoryStore.errorLogs]
    .sort((a, b) => b.timestampUtcIso.localeCompare(a.timestampUtcIso))
    .slice(0, limit);
}

export async function clearErrorLogs(): Promise<void> {
  memoryStore.errorLogs = [];
  if (hasNativeIndexedDb()) {
    try {
      await db.errorLogs.clear();
    } catch {
      // Ignora
    }
  }
}
