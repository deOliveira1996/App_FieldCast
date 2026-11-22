import type { SafeWindowStatus } from './weather';

export type LocationOrigin = 'gps' | 'ip' | 'cached' | 'saved' | 'search';

export interface ActiveCoordinates {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  name: string;
  origin: LocationOrigin;
  isApproximateIp: boolean;
  updatedAtIso: string;
}

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationM?: number | null;
  region?: string;
  isFavorite: boolean;
  createdAtIso: string;
  lastUsedAtIso: string;
}

export interface ConditionSnapshot {
  timestampUnix: number;
  timestampIso: string;
  windSpeed10mKmh: number | null;
  windDirection10mDeg: number | null;
  windGusts10mKmh: number | null;
  temperature2mC: number | null;
  surfacePressureHpa: number | null;
  precipitationMm: number | null;
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveDirectionDeg: number | null;
  confidenceTotal: number | null;
  safeWindow: SafeWindowStatus | null;
}

export interface Waypoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timestampUtcIso: string;
  note: string;
  photoDataUrl?: string;
  photoMimeType?: 'image/webp' | 'image/jpeg';
  photoSizeKb?: number;
  conditions: ConditionSnapshot;
  trackId?: string;
}

export interface TrackPoint {
  latitude: number;
  longitude: number;
  accuracyM: number;
  speedMs: number | null;
  headingDeg: number | null;
  timestampUtcIso: string;
}

export type TrackSessionStatus = 'recording' | 'paused' | 'completed';

export interface TrackSession {
  id: string;
  name: string;
  startedAtIso: string;
  endedAtIso?: string;
  status: TrackSessionStatus;
  totalDistanceKm: number;
  points: TrackPoint[];
  discardedLowAccuracyCount: number;
  platform: 'web' | 'android' | 'ios';
}

export interface OfflineMissionBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  minZoom: number;
  maxZoom: number;
}

export interface OfflineTileRecord {
  key: string;
  missionId: string;
  missionName?: string;
  z: number;
  x: number;
  y: number;
  theme: 'light' | 'dark';
  blob: Blob;
  sizeBytes: number;
  cachedAtIso: string;
}

export interface OfflineMissionProgress {
  missionId: string;
  totalTiles: number;
  completedTiles: number;
  failedTiles: number;
  status: 'idle' | 'downloading' | 'completed' | 'cancelled' | 'error';
  errorMessage?: string;
}

export type ExportFormat = 'csv' | 'json' | 'gpx' | 'geojson';

export interface CompassReading {
  headingDeg: number;
  relativeWindDeg: number | null;
  relativeWaveDeg: number | null;
  source: 'ios_webkit' | 'android_absolute' | 'standard' | 'unavailable';
  timestampMs: number;
}
