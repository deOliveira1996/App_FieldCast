export type HealthLevel = 'healthy' | 'degraded' | 'down' | 'unverified';

export type MonitoredServiceId =
  | 'open_meteo_forecast'
  | 'open_meteo_marine'
  | 'rainviewer'
  | 'nominatim'
  | 'ipwhois';

export interface ServiceEndpointStatus {
  service: MonitoredServiceId;
  label: string;
  status: HealthLevel;
  latencyMs: number | null;
  lastCheckedIso: string | null;
  circuitOpen: boolean;
  consecutiveFailures: number;
  message?: string;
}

export interface ErrorLogRecord {
  id?: number;
  timestampUtcIso: string;
  module: string;
  action: string;
  message: string;
  stack?: string;
}

export type PlatformKind = 'web' | 'android' | 'ios';

export type GpsHealthStatus =
  | 'granted'
  | 'fallback_ip'
  | 'offline_cache'
  | 'denied'
  | 'unavailable';

export interface HealthCheckSnapshot {
  overall: HealthLevel;
  platform: PlatformKind;
  gpsStatus: GpsHealthStatus;
  indexedDbOk: boolean;
  usingCachedForecast: boolean;
  cacheAgeMinutes: number | null;
  endpoints: Record<MonitoredServiceId, ServiceEndpointStatus>;
  recentErrors: ErrorLogRecord[];
  checkedAtIso: string;
}

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  durationMs?: number;
}
