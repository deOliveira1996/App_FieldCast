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
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
] as const;

export const BACKGROUND_GPS_CONSENT_KEY = 'fieldcast_bg_gps_consent_v4';

const DEDUP_WINDOW_MS = 500;

const backgroundConsentListeners = new Set<(enabled: boolean) => void>();

/**
 * Lê o consentimento explícito do usuário para operação de GPS em segundo plano.
 * Padrão `true` quando o modo de segundo plano não foi desativado pelo usuário.
 */
export function getBackgroundTrackingConsent(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return true;
    }
    const stored = localStorage.getItem(BACKGROUND_GPS_CONSENT_KEY);
    if (stored === null) {
      return true;
    }
    return stored !== 'false' && stored !== '0';
  } catch {
    return true;
  }
}

/**
 * Define e persiste o consentimento explícito do usuário para rastreamento GPS em segundo plano.
 */
export function setBackgroundTrackingConsent(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BACKGROUND_GPS_CONSENT_KEY, enabled ? 'true' : 'false');
    }
  } catch {
    // Preserva Zero-Crash em contextos sem armazenamento
  }
  for (const listener of backgroundConsentListeners) {
    try {
      listener(enabled);
    } catch {
      // Preserva Zero-Crash
    }
  }
}

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
  backgroundConsentGranted: boolean;
  platform: PlatformKind;
  errorMessage: string | null;
}

export interface NativeBackgroundLocationReading {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number | null;
  bearing?: number | null;
  time?: number | null;
}

export interface BackgroundGeolocationPluginBridge {
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
  drainBufferedLocations?: () => Promise<{ locations: NativeBackgroundLocationReading[] }>;
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
  backgroundConsentGranted?: boolean;
  backgroundBridge?: BackgroundGeolocationPluginBridge;
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
  private readonly backgroundBridge: BackgroundGeolocationPluginBridge;
  private readonly hasCustomBackgroundBridge: boolean;
  private explicitConsentOverride: boolean | undefined;

  private state: LocationTrackerState;
  private listeners = new Set<(state: LocationTrackerState) => void>();

  private webWatchId: number | null = null;
  private capacitorWatchId: string | null = null;
  private backgroundWatcherId: string | null = null;
  private wakeLockSentinel: WakeLockSentinelLike | null = null;
  private visibilityListenerAttached = false;
  private isDrainingBuffer = false;

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.drainAndIngestBufferedLocations();
    }
  };

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
    this.backgroundBridge = options?.backgroundBridge ?? BackgroundGeolocationBridge;
    this.hasCustomBackgroundBridge = Boolean(options?.backgroundBridge);
    this.explicitConsentOverride = options?.backgroundConsentGranted;

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
      backgroundConsentGranted: this.resolveBackgroundConsent(),
      platform: this.getPlatformFn(),
      errorMessage: null,
    };
  }

  private resolveBackgroundConsent(): boolean {
    if (typeof this.explicitConsentOverride === 'boolean') {
      return this.explicitConsentOverride;
    }
    return getBackgroundTrackingConsent();
  }

  getBackgroundConsent(): boolean {
    return this.resolveBackgroundConsent();
  }

  async setBackgroundConsent(enabled: boolean): Promise<void> {
    this.explicitConsentOverride = undefined;
    setBackgroundTrackingConsent(enabled);
    this.emitState({ backgroundConsentGranted: enabled });

    if (this.state.isRecording && this.isNativePlatformFn()) {
      await this.stopPlatformWatcher();
      await this.startPlatformWatcher();
    }
  }

  syncExternalConsentChange(enabled: boolean): void {
    if (typeof this.explicitConsentOverride === 'boolean') {
      return;
    }
    this.emitState({ backgroundConsentGranted: enabled });
    if (this.state.isRecording && this.isNativePlatformFn()) {
      void (async () => {
        await this.stopPlatformWatcher();
        if (this.state.isRecording) {
          await this.startPlatformWatcher();
        }
      })();
    }
  }

  getState(): LocationTrackerState {
    return {
      ...this.state,
      backgroundConsentGranted: this.resolveBackgroundConsent(),
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

  private attachVisibilityListener(): void {
    if (this.visibilityListenerAttached || typeof document === 'undefined') {
      return;
    }
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.visibilityListenerAttached = true;
  }

  private detachVisibilityListener(): void {
    if (!this.visibilityListenerAttached || typeof document === 'undefined') {
      return;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.visibilityListenerAttached = false;
  }

  private isDuplicateOfLastAccepted(readingTimeMs: number): boolean {
    const lastIso = this.state.lastAcceptedPoint?.timestampUtcIso;
    if (!lastIso) {
      return false;
    }
    const lastMs = Date.parse(lastIso);
    if (!Number.isFinite(lastMs)) {
      return false;
    }
    return readingTimeMs <= lastMs + DEDUP_WINDOW_MS;
  }

  /**
   * Drena pontos gravados em memória nativa (`FieldCastLocationForegroundService`) enquanto
   * a tela estava desligada/no bolso e ingere pontos com timestamp mais recente que
   * `lastAcceptedPoint` (deduplicando dentro de `500ms`).
   */
  async drainAndIngestBufferedLocations(): Promise<number> {
    if (this.isDrainingBuffer) {
      return 0;
    }
    const current = this.state.activeSession;
    if (
      !current ||
      current.status !== 'recording' ||
      !this.state.isRecording ||
      !this.isNativePlatformFn() ||
      this.getPlatformFn() !== 'android' ||
      !this.state.foregroundServiceActive
    ) {
      return 0;
    }

    const drainFn = this.backgroundBridge?.drainBufferedLocations;
    if (typeof drainFn !== 'function') {
      return 0;
    }
    if (
      !this.hasCustomBackgroundBridge &&
      !Capacitor.isPluginAvailable('BackgroundGeolocation')
    ) {
      return 0;
    }

    this.isDrainingBuffer = true;
    try {
      const response = await drainFn.call(this.backgroundBridge);
      const rawLocations = Array.isArray(response?.locations) ? response.locations : [];
      if (rawLocations.length === 0) {
        return 0;
      }

      const sortedLocations = [...rawLocations].sort((a, b) => {
        const ta = typeof a.time === 'number' && Number.isFinite(a.time) ? a.time : 0;
        const tb = typeof b.time === 'number' && Number.isFinite(b.time) ? b.time : 0;
        return ta - tb;
      });

      let acceptedCount = 0;
      let lastRejectedMs: number | null = null;

      for (const item of sortedLocations) {
        if (!this.state.activeSession || this.state.activeSession.status !== 'recording') {
          break;
        }

        const itemTimeMs =
          typeof item.time === 'number' && Number.isFinite(item.time) ? item.time : Date.now();

        if (this.isDuplicateOfLastAccepted(itemTimeMs)) {
          continue;
        }

        const candidateAcceptable = isTrackAccuracyAcceptable(item.accuracy, this.maxAccuracyM);
        if (
          !candidateAcceptable &&
          lastRejectedMs !== null &&
          Math.abs(itemTimeMs - lastRejectedMs) <= DEDUP_WINDOW_MS
        ) {
          continue;
        }

        const res = await this.ingestPositionReading({
          latitude: item.latitude,
          longitude: item.longitude,
          accuracyM: item.accuracy,
          speedMs: item.speed ?? null,
          headingDeg: item.bearing ?? null,
          timestampUtcIso: new Date(itemTimeMs).toISOString(),
        });

        if (res.accepted) {
          acceptedCount += 1;
        } else {
          lastRejectedMs = itemTimeMs;
        }
      }

      return acceptedCount;
    } catch {
      return 0;
    } finally {
      this.isDrainingBuffer = false;
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
    const consentGranted = this.resolveBackgroundConsent();

    if (isNative) {
      if (consentGranted !== false) {
        this.emitState({
          foregroundServiceActive: true,
          foregroundNotificationTitle: ANDROID_FOREGROUND_NOTIFICATION_TITLE,
          backgroundConsentGranted: true,
          keepScreenOnWarning: false,
          wakeLockBannerMessage: null,
        });

        this.attachVisibilityListener();

        // Inicia Foreground Service nativo (BackgroundGeolocationPlugin -> FieldCastLocationForegroundService)
        let bgStarted = false;
        try {
          if (
            this.backgroundBridge &&
            typeof this.backgroundBridge.addWatcher === 'function' &&
            (this.hasCustomBackgroundBridge ||
              Capacitor.isPluginAvailable('BackgroundGeolocation'))
          ) {
            this.backgroundWatcherId = await this.backgroundBridge.addWatcher(
              {
                backgroundTitle: ANDROID_FOREGROUND_NOTIFICATION_TITLE,
                backgroundMessage: ANDROID_FOREGROUND_NOTIFICATION_BODY,
                requestPermissions: true,
                stale: false,
                distanceFilter: 3,
              },
              (position, err) => {
                if (err) {
                  this.emitState({ errorMessage: err.message });
                  return;
                }
                if (position) {
                  const fixTimeMs =
                    typeof position.time === 'number' && Number.isFinite(position.time)
                      ? position.time
                      : Date.now();
                  if (this.isDuplicateOfLastAccepted(fixTimeMs)) {
                    return;
                  }
                  void this.ingestPositionReading({
                    latitude: position.latitude,
                    longitude: position.longitude,
                    accuracyM: position.accuracy,
                    speedMs: position.speed ?? null,
                    headingDeg: position.bearing ?? null,
                    timestampUtcIso: new Date(fixTimeMs).toISOString(),
                  });
                }
              },
            );
            bgStarted = true;
          }
        } catch {
          bgStarted = false;
        }

        if (bgStarted) {
          return;
        }
      } else {
        this.emitState({
          foregroundServiceActive: false,
          foregroundNotificationTitle: null,
          backgroundConsentGranted: false,
          keepScreenOnWarning: true,
          wakeLockBannerMessage: WEB_WAKE_LOCK_WARNING_MESSAGE,
        });
      }

      // Fallback para receptor GPS em primeiro plano (@capacitor/geolocation)
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
      backgroundConsentGranted: consentGranted,
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
    this.detachVisibilityListener();

    if (this.backgroundWatcherId) {
      try {
        await this.backgroundBridge.removeWatcher({ id: this.backgroundWatcherId });
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
      backgroundConsentGranted: this.resolveBackgroundConsent(),
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
    const initial = this.state.activeSession;
    if (!initial || initial.status !== 'recording') {
      return initial;
    }

    await this.drainAndIngestBufferedLocations();
    await this.stopPlatformWatcher();

    const current = this.state.activeSession ?? initial;
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
      backgroundConsentGranted: this.resolveBackgroundConsent(),
      errorMessage: null,
    });

    await this.startPlatformWatcher();
    return resumedSession;
  }

  /**
   * Encerra a sessão de gravação, libera Wake Lock / Foreground Service e salva no Dexie.
   */
  async stopTracking(): Promise<TrackSession | null> {
    if (this.state.activeSession && this.state.activeSession.status === 'recording') {
      await this.drainAndIngestBufferedLocations();
    }
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
backgroundConsentListeners.add((enabled) => {
  locationTrackerService.syncExternalConsentChange(enabled);
});
