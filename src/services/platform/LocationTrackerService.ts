import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { saveTrackSession } from '../../db/database';
import type { TrackPoint, TrackSession } from '../../types/field';
import type { PlatformKind } from '../../types/health';
import { computeTrackDistanceKm, haversineDistanceKm } from '../../utils/exporters';

export const MAX_TRACK_ACCURACY_M = 20;

export const ANDROID_FOREGROUND_NOTIFICATION_TITLE = 'FieldCast: Gravando rota...';
export const ANDROID_FOREGROUND_NOTIFICATION_BODY =
  'Rastreamento GPS ativo em segundo plano (filtro de acurácia <= 20m)';

export const ANDROID_REQUIRED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
] as const;

export const WEB_WAKE_LOCK_WARNING_MESSAGE =
  'Mantenha a tela ligada durante a gravação no navegador';

export interface RawGpsReading {
  latitude: number;
  longitude: number;
  accuracyM: number;
  speedMs?: number | null;
  headingDeg?: number | null;
  timestampUtcIso?: string;
}

export interface LocationTrackerState {
  activeSession: TrackSession | null;
  isRecording: boolean;
  isPaused: boolean;
  lastAccuracyM: number | null;
  lastAcceptedPoint: TrackPoint | null;
  lastReadingWasDiscarded: boolean;
  wakeLockActive: boolean;
  keepScreenOnWarning: boolean;
  wakeLockBannerMessage: string | null;
  foregroundServiceActive: boolean;
  foregroundNotificationTitle: string | null;
  platform: PlatformKind;
  errorMessage: string | null;
}

interface NativeBackgroundLocationReading {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number | null;
  bearing?: number | null;
  time?: number | null;
}

interface BackgroundGeolocationPluginBridge {
  addWatcher(
    options: {
      backgroundTitle: string;
      backgroundMessage: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: NativeBackgroundLocationReading, error?: Error) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

const BackgroundGeolocationBridge = registerPlugin<BackgroundGeolocationPluginBridge>(
  'BackgroundGeolocation',
);

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

/**
 * Detecta a plataforma em tempo de execução via `Capacitor.isNativePlatform()`.
 */
export function detectRuntimePlatform(): PlatformKind {
  try {
    if (Capacitor.isNativePlatform()) {
      const p = Capacitor.getPlatform();
      if (p === 'android') return 'android';
      if (p === 'ios') return 'ios';
    }
  } catch {
    // Fallback web
  }
  return 'web';
}

/**
 * Verifica se uma leitura de GPS cumpre o filtro estrito de acurácia (`<= 20m`).
 * Leituras com `accuracyM > 20` ou inválidas (`<= 0`, `NaN`) são descartadas.
 */
export function isTrackAccuracyAcceptable(
  accuracyM: number | null | undefined,
  maxAccuracyM = MAX_TRACK_ACCURACY_M,
): boolean {
  return (
    typeof accuracyM === 'number' &&
    Number.isFinite(accuracyM) &&
    accuracyM > 0 &&
    accuracyM <= maxAccuracyM
  );
}

/**
 * Aplica uma leitura de GPS a uma `TrackSession` seguindo o filtro de acurácia (`<= 20m`)
 * e recalculando a distância acumulada via Haversine (`computeTrackDistanceKm`).
 */
export function applyReadingToTrackSession(
  session: TrackSession,
  reading: RawGpsReading,
  maxAccuracyM = MAX_TRACK_ACCURACY_M,
): {
  accepted: boolean;
  point?: TrackPoint;
  deltaDistanceKm: number;
  session: TrackSession;
} {
  if (
    !Number.isFinite(reading.latitude) ||
    !Number.isFinite(reading.longitude) ||
    !isTrackAccuracyAcceptable(reading.accuracyM, maxAccuracyM)
  ) {
    const updated: TrackSession = {
      ...session,
      discardedLowAccuracyCount: session.discardedLowAccuracyCount + 1,
    };
    return {
      accepted: false,
      deltaDistanceKm: 0,
      session: updated,
    };
  }

  const point: TrackPoint = {
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracyM: reading.accuracyM,
    speedMs: reading.speedMs ?? null,
    headingDeg: reading.headingDeg ?? null,
    timestampUtcIso: reading.timestampUtcIso ?? new Date().toISOString(),
  };

  const prevPoint = session.points[session.points.length - 1];
  const deltaDistanceKm = prevPoint
    ? haversineDistanceKm(
        prevPoint.latitude,
        prevPoint.longitude,
        point.latitude,
        point.longitude,
      )
    : 0;

  const nextPoints = [...session.points, point];
  const totalDistanceKm = computeTrackDistanceKm(nextPoints);

  const updated: TrackSession = {
    ...session,
    points: nextPoints,
    totalDistanceKm,
  };

  return {
    accepted: true,
    point,
    deltaDistanceKm,
    session: updated,
  };
}

export interface LocationTrackerServiceOptions {
  maxAccuracyM?: number;
  isNativePlatformFn?: () => boolean;
  getPlatformFn?: () => PlatformKind;
  saveSessionFn?: (session: TrackSession) => Promise<void>;
}

/**
 * Serviço híbrido de rastreamento de rota GPS (Capacitor Android Foreground Service + Web PWA Wake Lock).
 * Filtra estritamente leituras com `accuracy > 20m` (`MAX_TRACK_ACCURACY_M = 20`).
 */
export class LocationTrackerService {
  private readonly maxAccuracyM: number;
  private readonly isNativePlatformFn: () => boolean;
  private readonly getPlatformFn: () => PlatformKind;
  private readonly saveSessionFn: (session: TrackSession) => Promise<void>;

  private state: LocationTrackerState;
  private listeners = new Set<(state: LocationTrackerState) => void>();

  private webWatchId: number | null = null;
  private capacitorWatchId: string | null = null;
  private backgroundWatcherId: string | null = null;
  private wakeLockSentinel: WakeLockSentinelLike | null = null;

  constructor(options?: LocationTrackerServiceOptions) {
    this.maxAccuracyM = options?.maxAccuracyM ?? MAX_TRACK_ACCURACY_M;
    this.isNativePlatformFn =
      options?.isNativePlatformFn ??
      (() => {
        try {
          return Capacitor.isNativePlatform();
        } catch {
          return false;
        }
      });
    this.getPlatformFn = options?.getPlatformFn ?? detectRuntimePlatform;
    this.saveSessionFn = options?.saveSessionFn ?? saveTrackSession;

    this.state = {
      activeSession: null,
      isRecording: false,
      isPaused: false,
      lastAccuracyM: null,
      lastAcceptedPoint: null,
      lastReadingWasDiscarded: false,
      wakeLockActive: false,
      keepScreenOnWarning: false,
      wakeLockBannerMessage: null,
      foregroundServiceActive: false,
      foregroundNotificationTitle: null,
      platform: this.getPlatformFn(),
      errorMessage: null,
    };
  }

  getState(): LocationTrackerState {
    return {
      ...this.state,
      activeSession: this.state.activeSession
        ? {
            ...this.state.activeSession,
            points: [...this.state.activeSession.points],
          }
        : null,
    };
  }

  subscribe(listener: (state: LocationTrackerState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitState(patch: Partial<LocationTrackerState>): void {
    this.state = {
      ...this.state,
      ...patch,
    };
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Preserva Zero-Crash
      }
    }
  }

  private async requestWebWakeLock(): Promise<boolean> {
    if (typeof navigator === 'undefined') {
      return false;
    }
    const nav = navigator as unknown as NavigatorWithWakeLock;
    if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
      return false;
    }
    try {
      this.wakeLockSentinel = await nav.wakeLock.request('screen');
      return true;
    } catch {
      this.wakeLockSentinel = null;
      return false;
    }
  }

  private async releaseWebWakeLock(): Promise<void> {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {
        // Ignora erro ao liberar wakeLock
      }
      this.wakeLockSentinel = null;
    }
  }

  private async startPlatformWatcher(): Promise<void> {
    const isNative = this.isNativePlatformFn();

    if (isNative) {
      this.emitState({
        foregroundServiceActive: true,
        foregroundNotificationTitle: ANDROID_FOREGROUND_NOTIFICATION_TITLE,
        keepScreenOnWarning: false,
        wakeLockBannerMessage: null,
      });

      // Tenta adaptador Foreground Service (@capacitor-community/background-geolocation) se disponível
      let bgStarted = false;
      try {
        if (
          BackgroundGeolocationBridge &&
          typeof BackgroundGeolocationBridge.addWatcher === 'function' &&
          Capacitor.isPluginAvailable('BackgroundGeolocation')
        ) {
          this.backgroundWatcherId = await BackgroundGeolocationBridge.addWatcher(
            {
              backgroundTitle: ANDROID_FOREGROUND_NOTIFICATION_TITLE,
              backgroundMessage: ANDROID_FOREGROUND_NOTIFICATION_BODY,
              requestPermissions: true,
              stale: false,
              distanceFilter: 5,
            },
            (position, err) => {
              if (err) {
                this.emitState({ errorMessage: err.message });
                return;
              }
              if (position) {
                void this.ingestPositionReading({
                  latitude: position.latitude,
                  longitude: position.longitude,
                  accuracyM: position.accuracy,
                  speedMs: position.speed ?? null,
                  headingDeg: position.bearing ?? null,
                  timestampUtcIso: position.time
                    ? new Date(position.time).toISOString()
                    : new Date().toISOString(),
                });
              }
            },
          );
          bgStarted = true;
        }
      } catch {
        bgStarted = false;
      }

      if (!bgStarted) {
        try {
          try {
            await Geolocation.requestPermissions();
          } catch {
            // Prossegue caso permissão já esteja concedida
          }
          this.capacitorWatchId = await Geolocation.watchPosition(
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0,
              minimumUpdateInterval: 3000,
            },
            (position, err) => {
              if (err) {
                this.emitState({
                  errorMessage:
                    err instanceof Error ? err.message : 'Aviso do receptor GPS nativo.',
                });
                return;
              }
              if (position) {
                void this.ingestPositionReading({
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  accuracyM: position.coords.accuracy,
                  speedMs: position.coords.speed ?? null,
                  headingDeg: position.coords.heading ?? null,
                  timestampUtcIso: new Date(position.timestamp).toISOString(),
                });
              }
            },
          );
        } catch (err) {
          this.emitState({
            errorMessage:
              err instanceof Error
                ? err.message
                : 'Não foi possível iniciar o receptor GPS nativo.',
          });
        }
      }
      return;
    }

    // Web (PWA): Screen Wake Lock API + watchPosition + banner de aviso
    const wakeLockGranted = await this.requestWebWakeLock();
    this.emitState({
      wakeLockActive: wakeLockGranted,
      keepScreenOnWarning: true,
      wakeLockBannerMessage: WEB_WAKE_LOCK_WARNING_MESSAGE,
      foregroundServiceActive: false,
      foregroundNotificationTitle: null,
    });

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        this.webWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            void this.ingestPositionReading({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracyM: pos.coords.accuracy,
              speedMs: pos.coords.speed ?? null,
              headingDeg: pos.coords.heading ?? null,
              timestampUtcIso: new Date(pos.timestamp).toISOString(),
            });
          },
          (err) => {
            this.emitState({
              errorMessage: err.message || 'Sinal de GPS indisponível no navegador.',
            });
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          },
        );
      } catch (err) {
        this.emitState({
          errorMessage:
            err instanceof Error ? err.message : 'Falha ao iniciar watchPosition no navegador.',
        });
      }
    }
  }

  private async stopPlatformWatcher(): Promise<void> {
    if (this.backgroundWatcherId) {
      try {
        await BackgroundGeolocationBridge.removeWatcher({ id: this.backgroundWatcherId });
      } catch {
        // Ignora
      }
      this.backgroundWatcherId = null;
    }

    if (this.capacitorWatchId) {
      try {
        await Geolocation.clearWatch({ id: this.capacitorWatchId });
      } catch {
        // Ignora
      }
      this.capacitorWatchId = null;
    }

    if (this.webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(this.webWatchId);
      } catch {
        // Ignora
      }
      this.webWatchId = null;
    }

    await this.releaseWebWakeLock();
  }

  /**
   * Inicia uma nova sessão de gravação de rota GPS.
   */
  async startTracking(customName?: string): Promise<TrackSession> {
    await this.stopPlatformWatcher();

    const now = new Date();
    const nowIso = now.toISOString();
    const defaultName = `Rota ${nowIso.slice(0, 10)} ${nowIso.slice(11, 16)} UTC`;
    const platform = this.getPlatformFn();

    const newSession: TrackSession = {
      id: `trk-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      name: customName?.trim() || defaultName,
      startedAtIso: nowIso,
      status: 'recording',
      totalDistanceKm: 0,
      points: [],
      discardedLowAccuracyCount: 0,
      platform,
    };

    await this.saveSessionFn(newSession);

    this.emitState({
      activeSession: newSession,
      isRecording: true,
      isPaused: false,
      lastAccuracyM: null,
      lastAcceptedPoint: null,
      lastReadingWasDiscarded: false,
      platform,
      errorMessage: null,
    });

    await this.startPlatformWatcher();
    return newSession;
  }

  /**
   * Pausa a sessão de gravação ativa.
   */
  async pauseTracking(): Promise<TrackSession | null> {
    const current = this.state.activeSession;
    if (!current || current.status !== 'recording') {
      return current;
    }

    await this.stopPlatformWatcher();

    const pausedSession: TrackSession = {
      ...current,
      status: 'paused',
    };

    await this.saveSessionFn(pausedSession);

    this.emitState({
      activeSession: pausedSession,
      isRecording: false,
      isPaused: true,
      wakeLockActive: false,
      foregroundServiceActive: false,
    });

    return pausedSession;
  }

  /**
   * Retoma uma sessão de gravação pausada.
   */
  async resumeTracking(): Promise<TrackSession | null> {
    const current = this.state.activeSession;
    if (!current || current.status !== 'paused') {
      return current;
    }

    const resumedSession: TrackSession = {
      ...current,
      status: 'recording',
    };

    await this.saveSessionFn(resumedSession);

    this.emitState({
      activeSession: resumedSession,
      isRecording: true,
      isPaused: false,
      errorMessage: null,
    });

    await this.startPlatformWatcher();
    return resumedSession;
  }

  /**
   * Encerra a sessão de gravação, libera Wake Lock / Foreground Service e salva no Dexie.
   */
  async stopTracking(): Promise<TrackSession | null> {
    const current = this.state.activeSession;
    await this.stopPlatformWatcher();

    if (!current) {
      this.emitState({
        isRecording: false,
        isPaused: false,
        wakeLockActive: false,
        keepScreenOnWarning: false,
        wakeLockBannerMessage: null,
        foregroundServiceActive: false,
        foregroundNotificationTitle: null,
      });
      return null;
    }

    const completedSession: TrackSession = {
      ...current,
      status: 'completed',
      endedAtIso: new Date().toISOString(),
    };

    await this.saveSessionFn(completedSession);

    this.emitState({
      activeSession: null,
      isRecording: false,
      isPaused: false,
      wakeLockActive: false,
      keepScreenOnWarning: false,
      wakeLockBannerMessage: null,
      foregroundServiceActive: false,
      foregroundNotificationTitle: null,
    });

    return completedSession;
  }

  /**
   * Processa uma leitura de GPS aplicando o filtro estrito de acurácia (`<= 20m`).
   * Leituras com `accuracyM > 20` incrementam `discardedLowAccuracyCount` e são rejeitadas.
   * Leituras válidas atualizam a distância Haversine acumulada e persistem no Dexie.
   */
  async ingestPositionReading(reading: RawGpsReading): Promise<{
    accepted: boolean;
    point?: TrackPoint;
    session: TrackSession | null;
  }> {
    const current = this.state.activeSession;
    if (!current || current.status !== 'recording') {
      return {
        accepted: false,
        session: current,
      };
    }

    const result = applyReadingToTrackSession(current, reading, this.maxAccuracyM);
    await this.saveSessionFn(result.session);

    this.emitState({
      activeSession: result.session,
      lastAccuracyM: Number.isFinite(reading.accuracyM) ? reading.accuracyM : null,
      lastAcceptedPoint: result.point ?? this.state.lastAcceptedPoint,
      lastReadingWasDiscarded: !result.accepted,
    });

    return {
      accepted: result.accepted,
      point: result.point,
      session: result.session,
    };
  }
}

export const locationTrackerService = new LocationTrackerService();
