import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  Eye,
  EyeOff,
  Navigation,
  RotateCcw,
  ShieldCheck,
  Waves,
  Wind,
} from 'lucide-react';
import type { CompassPreference, CompassReading } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import { safeAction } from '../../utils/safeAction';

export const COMPASS_PREF_STORAGE_KEY = 'fieldcast_compass_pref_v1';

export interface DeviceOrientationEventWithWebkit extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

export interface DeviceOrientationConstructorWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

interface AbsoluteOrientationSensorLike extends EventTarget {
  quaternion?: readonly number[] | null;
  start?: () => void;
  stop?: () => void;
}

type AbsoluteOrientationSensorConstructor = new (options?: {
  frequency?: number;
  referenceFrame?: 'device' | 'screen';
}) => AbsoluteOrientationSensorLike;

/**
 * Normaliza qualquer ângulo em graus para o intervalo `[0, 360)`.
 */
export function normalizeCompassDeg(angleDeg: number): number {
  const mod = angleDeg % 360;
  return mod < 0 ? mod + 360 : mod === 0 ? 0 : mod;
}

function shortestAngularDeltaDeg(a: number, b: number): number {
  const diff = Math.abs(normalizeCompassDeg(a) - normalizeCompassDeg(b));
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Desdobra um ângulo alvo (`nextTargetDeg`) de forma contínua em relação ao ângulo acumulado anterior
 * (`prevUnwrappedDeg`), utilizando o menor delta angular assinado em `[-180°, +180°)`.
 * Evita o giro reverso de 358° no CSS `transform: rotate(...)` ao cruzar o Norte (`359° <-> 1°`).
 */
export function unwrapContinuousAngleDeg(
  prevUnwrappedDeg: number | null,
  nextTargetDeg: number,
): number {
  if (!Number.isFinite(nextTargetDeg)) {
    return prevUnwrappedDeg !== null && Number.isFinite(prevUnwrappedDeg)
      ? prevUnwrappedDeg
      : 0;
  }
  if (prevUnwrappedDeg === null || !Number.isFinite(prevUnwrappedDeg)) {
    return normalizeCompassDeg(nextTargetDeg);
  }
  const delta = ((((nextTargetDeg - prevUnwrappedDeg) % 360) + 540) % 360) - 180;
  return prevUnwrappedDeg + delta;
}

/**
 * Suavização exponencial circular (EMA sobre o vetor unitário `(sin, cos)` via `Math.atan2`)
 * com zona morta (deadband) de `1.0°` após a primeira leitura válida.
 * Garante que ruído de sensor entre `359°` e `1°` converja suavemente para `0°` sem saltos.
 */
export function smoothCircularHeadingDeg(
  prevSin: number | null,
  prevCos: number | null,
  sampleDeg: number,
  alpha = 0.3,
): { headingDeg: number; sin: number; cos: number } {
  const normalizedSample = normalizeCompassDeg(sampleDeg);
  const sampleRad = (normalizedSample * Math.PI) / 180;
  const sampleSin = Math.sin(sampleRad);
  const sampleCos = Math.cos(sampleRad);

  if (
    prevSin === null ||
    prevCos === null ||
    !Number.isFinite(prevSin) ||
    !Number.isFinite(prevCos) ||
    prevSin * prevSin + prevCos * prevCos < 1e-6
  ) {
    return {
      headingDeg: normalizedSample,
      sin: sampleSin,
      cos: sampleCos,
    };
  }

  const prevHeadingDeg = normalizeCompassDeg((Math.atan2(prevSin, prevCos) * 180) / Math.PI);
  if (shortestAngularDeltaDeg(prevHeadingDeg, normalizedSample) < 1.0) {
    return {
      headingDeg: prevHeadingDeg,
      sin: prevSin,
      cos: prevCos,
    };
  }

  const clampedAlpha = Math.max(0.01, Math.min(1, Number.isFinite(alpha) ? alpha : 0.3));
  const blendedSin = (1 - clampedAlpha) * prevSin + clampedAlpha * sampleSin;
  const blendedCos = (1 - clampedAlpha) * prevCos + clampedAlpha * sampleCos;
  const norm = Math.hypot(blendedSin, blendedCos);

  if (norm < 1e-6) {
    return {
      headingDeg: normalizedSample,
      sin: sampleSin,
      cos: sampleCos,
    };
  }

  const nextSin = blendedSin / norm;
  const nextCos = blendedCos / norm;
  const headingDeg = normalizeCompassDeg((Math.atan2(nextSin, nextCos) * 180) / Math.PI);

  return {
    headingDeg,
    sin: nextSin,
    cos: nextCos,
  };
}

/**
 * Calcula o ângulo relativo do vento ou onda em relação à proa (heading) do dispositivo.
 */
export function computeRelativeBearingDeg(
  targetDirectionDeg: number | null | undefined,
  deviceHeadingDeg: number,
): number | null {
  if (typeof targetDirectionDeg !== 'number' || !Number.isFinite(targetDirectionDeg)) {
    return null;
  }
  return normalizeCompassDeg(targetDirectionDeg - deviceHeadingDeg);
}

/**
 * Obtém o ângulo de rotação da tela atual (`0, 90, 180, 270`).
 */
export function getScreenOrientationAngle(): number {
  if (typeof window === 'undefined') {
    return 0;
  }
  try {
    const screenAngle = window.screen?.orientation?.angle;
    if (typeof screenAngle === 'number' && Number.isFinite(screenAngle)) {
      return screenAngle;
    }
    const legacyAngle = (window as unknown as { orientation?: number }).orientation;
    if (typeof legacyAngle === 'number' && Number.isFinite(legacyAngle)) {
      return legacyAngle;
    }
  } catch {
    // Ignora
  }
  return 0;
}

/**
 * Calcula a proa magnética compensada por inclinação 3D (pitch `beta` e roll `gamma`)
 * a partir da matriz de rotação W3C Z-X'-Y'' (`R = Rz(alpha) * Rx(beta) * Ry(gamma)`),
 * evitando que inclinar o celular misture os eixos X/Z no Android (ex.: Moto G35).
 * Quando `beta` e `gamma` são 0 ou omitidos, reduz exatamente a `normalizeCompassDeg(360 - alpha)`.
 */
export function computeTiltCompensatedHeadingDeg(
  alphaDeg: number,
  betaDeg?: number | null,
  gammaDeg?: number | null,
  screenOrientationAngleDeg?: number | null,
): number {
  const screenAngle =
    typeof screenOrientationAngleDeg === 'number' && Number.isFinite(screenOrientationAngleDeg)
      ? screenOrientationAngleDeg
      : 0;

  const hasBeta = typeof betaDeg === 'number' && Number.isFinite(betaDeg);
  const hasGamma = typeof gammaDeg === 'number' && Number.isFinite(gammaDeg);

  if (!hasBeta || !hasGamma || (Math.abs(betaDeg!) < 1e-3 && Math.abs(gammaDeg!) < 1e-3)) {
    return normalizeCompassDeg(360 - alphaDeg + screenAngle);
  }

  const toRad = Math.PI / 180;
  const a = alphaDeg * toRad;
  const b = betaDeg! * toRad;
  const g = gammaDeg! * toRad;

  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const sB = Math.sin(b);
  const cG = Math.cos(g);
  const sG = Math.sin(g);

  // Horizontal forward vector F = Up x X_device in East-North-Up (ENU) world coordinates
  const east = -(sA * cG + cA * sB * sG);
  const north = cA * cG - sA * sB * sG;

  if (east * east + north * north < 1e-6) {
    return normalizeCompassDeg(360 - alphaDeg + screenAngle);
  }

  const headingRad = Math.atan2(east, north);
  const headingDeg = (headingRad * 180) / Math.PI;
  return normalizeCompassDeg(headingDeg + screenAngle);
}

/**
 * Calcula a proa verdadeira/magnética 3D a partir do quaternion `[x, y, z, w]`
 * fornecido pelo W3C `AbsoluteOrientationSensor`.
 */
export function computeHeadingFromQuaternion(
  quaternion: readonly number[] | null | undefined,
  screenOrientationAngleDeg?: number | null,
): number | null {
  if (!quaternion || quaternion.length < 4) {
    return null;
  }
  const [qx, qy, qz, qw] = quaternion;
  if (
    typeof qx !== 'number' ||
    typeof qy !== 'number' ||
    typeof qz !== 'number' ||
    typeof qw !== 'number' ||
    !Number.isFinite(qx) ||
    !Number.isFinite(qy) ||
    !Number.isFinite(qz) ||
    !Number.isFinite(qw)
  ) {
    return null;
  }

  // First column of rotation matrix R(q) is X_device in ENU frame:
  // X_E = 1 - 2*(qy^2 + qz^2), X_N = 2*(qx*qy + qw*qz)
  // Horizontal forward F = Up x X_device = [-X_N, X_E, 0]
  const east = -2 * (qx * qy + qw * qz);
  const north = 1 - 2 * (qy * qy + qz * qz);

  if (east * east + north * north < 1e-6) {
    return null;
  }

  const screenAngle =
    typeof screenOrientationAngleDeg === 'number' && Number.isFinite(screenOrientationAngleDeg)
      ? screenOrientationAngleDeg
      : 0;

  const headingDeg = (Math.atan2(east, north) * 180) / Math.PI;
  return normalizeCompassDeg(headingDeg + screenAngle);
}

/**
 * Extrai a proa magnética/verdadeira (`headingDeg`) a partir de um evento `DeviceOrientationEvent`:
 * - iOS: `webkitCompassHeading`
 * - Android/Web: compensação de inclinação 3D (`alpha, beta, gamma` -> `360 - alpha` quando plano)
 */
export function extractHeadingFromOrientationEvent(event: {
  alpha: number | null;
  beta?: number | null;
  gamma?: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
  screenOrientationAngle?: number | null;
}): { headingDeg: number; source: CompassReading['source'] } | null {
  if (
    typeof event.webkitCompassHeading === 'number' &&
    Number.isFinite(event.webkitCompassHeading)
  ) {
    return {
      headingDeg: normalizeCompassDeg(event.webkitCompassHeading),
      source: 'ios_webkit',
    };
  }

  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    const headingDeg = computeTiltCompensatedHeadingDeg(
      event.alpha,
      event.beta,
      event.gamma,
      event.screenOrientationAngle,
    );
    return {
      headingDeg,
      source: event.absolute ? 'android_absolute' : 'standard',
    };
  }

  return null;
}

/**
 * Verifica se o navegador exige chamada explícita a `DeviceOrientationEvent.requestPermission()` (iOS 13+).
 */
export function requiresIosOrientationPermission(): boolean {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
    return false;
  }
  const ctor =
    DeviceOrientationEvent as unknown as DeviceOrientationConstructorWithPermission;
  if (typeof ctor.requestPermission !== 'function') {
    return false;
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (ua.includes('jsdom')) {
    return true;
  }
  return (
    /iPad|iPhone|iPod/i.test(ua) ||
    (typeof navigator !== 'undefined' &&
      navigator.platform === 'MacIntel' &&
      navigator.maxTouchPoints > 1)
  );
}

function readStoredCompassPreference(): CompassPreference {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return { enabled: true, disabledReason: null };
  }
  try {
    const raw = window.localStorage.getItem(COMPASS_PREF_STORAGE_KEY);
    if (!raw) {
      return { enabled: true, disabledReason: null };
    }
    const parsed = JSON.parse(raw) as Partial<CompassPreference>;
    if (typeof parsed.enabled === 'boolean') {
      return {
        enabled: parsed.enabled,
        disabledReason: parsed.disabledReason ?? null,
      };
    }
  } catch {
    // Ignora erro de parse/storage
  }
  return { enabled: true, disabledReason: null };
}

function writeStoredCompassPreference(pref: CompassPreference): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(COMPASS_PREF_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Ignora erro de quota/storage
  }
}

export interface WindCompassProps {
  windDirection10mDeg: number | null;
  windSpeed10mKmh: number | null;
  waveDirectionDeg: number | null;
  waveHeightM: number | null;
  marineAvailable: boolean;
  /**
   * Proa simulada opcional (útil para testes automatizados).
   */
  simulatedHeadingDeg?: number | null;
  compassEnabled?: boolean;
  onCompassPreferenceChange?: (pref: CompassPreference) => void;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

/**
 * Bússola de Vento e Onda Relativa (Seção 4.6 de `docs/SPEC.md`):
 * - Prioriza W3C `AbsoluteOrientationSensor` ou `deviceorientationabsolute` exclusivo (`event.absolute === true`)
 *   com compensação 3D de inclinação (`alpha, beta, gamma` + `screen.orientation.angle`).
 * - NUNCA permite que eventos relativos `deviceorientation` (`event.absolute !== true` sem `webkitCompassHeading`)
 *   sobrescrevam a proa magnética absoluta.
 * - Aplica filtro circular EMA `(sin, cos)` + desdobramento contínuo `unwrapContinuousAngleDeg` para eliminar
 *   definitivamente o giro reverso de 358° ao cruzar `360° <-> 0°`.
 * - Oculta automaticamente se apenas eventos relativos/instáveis existirem, ou manualmente via botão "Ocultar Bússola".
 */
export const WindCompass: React.FC<WindCompassProps> = ({
  windDirection10mDeg,
  windSpeed10mKmh,
  waveDirectionDeg,
  waveHeightM,
  marineAvailable,
  simulatedHeadingDeg,
  compassEnabled: compassEnabledProp,
  onCompassPreferenceChange,
  onToast,
  onErrorLog,
}) => {
  const isIosPermissionRequired = requiresIosOrientationPermission();

  const [iosPermissionState, setIosPermissionState] = useState<
    'prompt' | 'granted' | 'denied'
  >(() => (isIosPermissionRequired ? 'prompt' : 'granted'));

  const [internalCompassPref, setInternalCompassPref] = useState<CompassPreference>(() =>
    readStoredCompassPreference(),
  );

  const isCompassEnabled =
    typeof compassEnabledProp === 'boolean' ? compassEnabledProp : internalCompassPref.enabled;

  const [reading, setReading] = useState<CompassReading | null>(() => {
    if (
      typeof simulatedHeadingDeg === 'number' &&
      Number.isFinite(simulatedHeadingDeg)
    ) {
      const h = normalizeCompassDeg(simulatedHeadingDeg);
      return {
        headingDeg: h,
        relativeWindDeg: computeRelativeBearingDeg(windDirection10mDeg, h),
        relativeWaveDeg: marineAvailable
          ? computeRelativeBearingDeg(waveDirectionDeg, h)
          : null,
        source: 'android_absolute',
        timestampMs: Date.now(),
      };
    }
    return null;
  });

  const [sensorUnavailable, setSensorUnavailable] = useState<boolean>(false);

  // Refs para travar exclusivamente em fonte absoluta, suavizar circularmente e detectar oscilação errática
  const hasAbsoluteSourceRef = useRef<boolean>(false);
  const hasW3cSensorActiveRef = useRef<boolean>(false);
  const relativeOnlyCountRef = useRef<number>(0);
  const wildJumpCountRef = useRef<number>(0);
  const lastHeadingSampleRef = useRef<{ headingDeg: number; timestampMs: number } | null>(
    null,
  );
  const smoothSinRef = useRef<number | null>(null);
  const smoothCosRef = useRef<number | null>(null);

  // Refs de rotação acumulada contínua (sem wraparound 360° <-> 0°) para o CSS transform
  const unwrappedHeadingRef = useRef<number | null>(null);
  const unwrappedRelWindRef = useRef<number | null>(null);
  const unwrappedRelWaveRef = useRef<number | null>(null);

  const applyVerifiedHeading = useCallback(
    (rawHeadingDeg: number, source: CompassReading['source']) => {
      const nowMs = Date.now();
      const normalizedRaw = normalizeCompassDeg(rawHeadingDeg);
      const prev = lastHeadingSampleRef.current;

      if (prev && nowMs - prev.timestampMs < 180) {
        const delta = shortestAngularDeltaDeg(prev.headingDeg, normalizedRaw);
        if (delta > 145) {
          wildJumpCountRef.current += 1;
        } else {
          wildJumpCountRef.current = 0;
        }

        if (wildJumpCountRef.current >= 8) {
          setSensorUnavailable(true);
          setReading(null);
          return;
        }
      } else if (prev) {
        wildJumpCountRef.current = 0;
      }

      lastHeadingSampleRef.current = { headingDeg: normalizedRaw, timestampMs: nowMs };

      const smoothed = smoothCircularHeadingDeg(
        smoothSinRef.current,
        smoothCosRef.current,
        normalizedRaw,
      );
      smoothSinRef.current = smoothed.sin;
      smoothCosRef.current = smoothed.cos;
      const smoothedHeadingDeg = smoothed.headingDeg;

      setSensorUnavailable(false);
      setReading({
        headingDeg: smoothedHeadingDeg,
        relativeWindDeg: computeRelativeBearingDeg(windDirection10mDeg, smoothedHeadingDeg),
        relativeWaveDeg: marineAvailable
          ? computeRelativeBearingDeg(waveDirectionDeg, smoothedHeadingDeg)
          : null,
        source,
        timestampMs: nowMs,
      });
    },
    [marineAvailable, waveDirectionDeg, windDirection10mDeg],
  );

  const handleRecalibrateCompass = useCallback(() => {
    smoothSinRef.current = null;
    smoothCosRef.current = null;
    unwrappedHeadingRef.current = null;
    unwrappedRelWindRef.current = null;
    unwrappedRelWaveRef.current = null;
    wildJumpCountRef.current = 0;
    relativeOnlyCountRef.current = 0;
    lastHeadingSampleRef.current = null;
    setSensorUnavailable(false);

    setReading((prev) => {
      if (!prev) {
        return null;
      }
      const normalized = normalizeCompassDeg(prev.headingDeg);
      return {
        ...prev,
        headingDeg: normalized,
        relativeWindDeg: computeRelativeBearingDeg(windDirection10mDeg, normalized),
        relativeWaveDeg: marineAvailable
          ? computeRelativeBearingDeg(waveDirectionDeg, normalized)
          : null,
        timestampMs: Date.now(),
      };
    });

    onToast?.({
      type: 'info',
      title: 'Bússola recalibrada',
      message: 'Eixo contínuo e filtro circular reiniciados.',
    });
  }, [marineAvailable, onToast, waveDirectionDeg, windDirection10mDeg]);

  const handleToggleCompassPref = (nextEnabled: boolean, reason: string | null = null) => {
    const nextPref: CompassPreference = {
      enabled: nextEnabled,
      disabledReason: nextEnabled ? null : reason,
    };
    setInternalCompassPref(nextPref);
    writeStoredCompassPreference(nextPref);
    onCompassPreferenceChange?.(nextPref);
  };

  useEffect(() => {
    if (!isCompassEnabled) {
      return;
    }

    // Quando `simulatedHeadingDeg` é fornecido em testes, ignora EMA para manter determinismo exato
    if (typeof simulatedHeadingDeg === 'number' && Number.isFinite(simulatedHeadingDeg)) {
      const h = normalizeCompassDeg(simulatedHeadingDeg);
      hasAbsoluteSourceRef.current = true;
      smoothSinRef.current = null;
      smoothCosRef.current = null;
      setSensorUnavailable(false);
      setReading({
        headingDeg: h,
        relativeWindDeg: computeRelativeBearingDeg(windDirection10mDeg, h),
        relativeWaveDeg: marineAvailable
          ? computeRelativeBearingDeg(waveDirectionDeg, h)
          : null,
        source: 'android_absolute',
        timestampMs: Date.now(),
      });
      return;
    }

    if (typeof window === 'undefined') {
      setSensorUnavailable(true);
      return;
    }

    if (isIosPermissionRequired && iosPermissionState !== 'granted') {
      return;
    }

    const win = window as Window & {
      AbsoluteOrientationSensor?: AbsoluteOrientationSensorConstructor;
    };

    hasAbsoluteSourceRef.current = false;
    hasW3cSensorActiveRef.current = false;
    relativeOnlyCountRef.current = 0;
    wildJumpCountRef.current = 0;
    lastHeadingSampleRef.current = null;
    smoothSinRef.current = null;
    smoothCosRef.current = null;

    // 1. Tenta inicializar W3C AbsoluteOrientationSensor (quando suportado pelo navegador/WebView)
    let w3cSensor: AbsoluteOrientationSensorLike | null = null;
    if (typeof win.AbsoluteOrientationSensor === 'function') {
      try {
        w3cSensor = new win.AbsoluteOrientationSensor({
          frequency: 15,
          referenceFrame: 'device',
        });
        const onSensorReading = () => {
          const heading = computeHeadingFromQuaternion(
            w3cSensor?.quaternion,
            getScreenOrientationAngle(),
          );
          if (heading !== null) {
            hasAbsoluteSourceRef.current = true;
            hasW3cSensorActiveRef.current = true;
            applyVerifiedHeading(heading, 'sensor_absolute');
          }
        };
        const onSensorError = () => {
          hasW3cSensorActiveRef.current = false;
        };
        w3cSensor.addEventListener('reading', onSensorReading);
        w3cSensor.addEventListener('error', onSensorError);
        w3cSensor.start?.();
      } catch {
        w3cSensor = null;
      }
    }

    if (typeof win.addEventListener !== 'function' && !w3cSensor) {
      setSensorUnavailable(true);
      return;
    }

    // 2. Listener exclusivo para `deviceorientationabsolute`
    const handleAbsoluteOrientation = (rawEvent: Event) => {
      if (hasW3cSensorActiveRef.current) {
        return;
      }
      const event = rawEvent as DeviceOrientationEventWithWebkit;
      if (typeof event.alpha !== 'number' || !Number.isFinite(event.alpha)) {
        return;
      }
      hasAbsoluteSourceRef.current = true;
      const extracted = extractHeadingFromOrientationEvent({
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma,
        absolute: true,
        webkitCompassHeading: event.webkitCompassHeading,
        screenOrientationAngle: getScreenOrientationAngle(),
      });
      if (extracted) {
        applyVerifiedHeading(extracted.headingDeg, extracted.source);
      }
    };

    // 3. Listener de fallback para `deviceorientation`:
    //    CRÍTICO: NUNCA permite que `deviceorientation` relativo (`event.absolute !== true` sem `webkitCompassHeading`)
    //    sobrescreva `deviceorientationabsolute` ou `sensor_absolute`, nem finja ser bússola magnética no Android!
    const handleFallbackOrientation = (rawEvent: Event) => {
      if (hasW3cSensorActiveRef.current) {
        return;
      }
      const event = rawEvent as DeviceOrientationEventWithWebkit;
      const hasWebkitHeading =
        typeof event.webkitCompassHeading === 'number' &&
        Number.isFinite(event.webkitCompassHeading);
      const isTrulyAbsolute = event.absolute === true || hasWebkitHeading;

      if (!isTrulyAbsolute) {
        if (hasAbsoluteSourceRef.current) {
          return;
        }
        if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
          relativeOnlyCountRef.current += 1;
          if (relativeOnlyCountRef.current >= 2) {
            setSensorUnavailable(true);
            setReading(null);
          }
        }
        return;
      }

      hasAbsoluteSourceRef.current = true;
      const extracted = extractHeadingFromOrientationEvent({
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma,
        absolute: true,
        webkitCompassHeading: event.webkitCompassHeading,
        screenOrientationAngle: getScreenOrientationAngle(),
      });

      if (extracted) {
        applyVerifiedHeading(extracted.headingDeg, extracted.source);
      }
    };

    win.addEventListener('deviceorientationabsolute', handleAbsoluteOrientation, true);
    win.addEventListener('deviceorientation', handleFallbackOrientation, true);

    const timer = setTimeout(() => {
      setReading((current) => {
        if (!current || !hasAbsoluteSourceRef.current) {
          setSensorUnavailable(true);
          return null;
        }
        return current;
      });
    }, 1500);

    return () => {
      clearTimeout(timer);
      try {
        w3cSensor?.stop?.();
      } catch {
        // Ignora
      }
      win.removeEventListener('deviceorientationabsolute', handleAbsoluteOrientation, true);
      win.removeEventListener('deviceorientation', handleFallbackOrientation, true);
    };
  }, [
    applyVerifiedHeading,
    iosPermissionState,
    isCompassEnabled,
    isIosPermissionRequired,
    marineAvailable,
    simulatedHeadingDeg,
    waveDirectionDeg,
    windDirection10mDeg,
  ]);

  const handleRequestIosPermission = (): void => {
    void safeAction(
      async () => {
        const ctor =
          DeviceOrientationEvent as unknown as DeviceOrientationConstructorWithPermission;
        if (typeof ctor.requestPermission !== 'function') {
          setIosPermissionState('granted');
          return;
        }
        const status = await ctor.requestPermission();
        if (status === 'granted') {
          setIosPermissionState('granted');
          onToast?.({
            type: 'success',
            title: 'Bússola iOS ativada',
            message: 'Sensor magnetômetro (webkitCompassHeading) liberado.',
          });
        } else {
          setIosPermissionState('denied');
          setSensorUnavailable(true);
          throw new Error('Permissão do sensor de orientação negada no iOS.');
        }
      },
      {
        actionKey: 'ios_compass_permission',
        moduleName: 'WindCompass',
        errorTitle: 'Permissão de Bússola Negada',
        onToast,
        onErrorLog,
      },
    );
  };

  // Se o usuário ocultou manualmente a bússola, exibe apenas uma barra compacta discreta para eventual reativação
  if (!isCompassEnabled) {
    return (
      <div
        data-testid="compass-hidden-bar"
        className="rounded-2xl border border-slate-200/80 dark:border-sky-800/60 bg-white/90 dark:bg-[#132a47]/80 px-4 py-2.5 flex items-center justify-between gap-3 shadow-sm"
      >
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <EyeOff className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <span>Bússola ocultada pelo usuário (modo campo limpo).</span>
        </div>
        <button
          type="button"
          onClick={() => handleToggleCompassPref(true, null)}
          className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-sky-50 dark:bg-sky-900/50 hover:bg-sky-100 text-sky-700 dark:text-sky-200 border border-sky-200 dark:border-sky-700 transition-colors"
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Mostrar Bússola</span>
        </button>
      </div>
    );
  }

  // Seção 4.6 de docs/SPEC.md: "Desktop/Sem sensor: Oculta automaticamente."
  if (!isIosPermissionRequired && (sensorUnavailable || !reading)) {
    return null;
  }

  if (isIosPermissionRequired && iosPermissionState === 'denied') {
    return null;
  }

  const normalizedHeadingDeg = normalizeCompassDeg(reading?.headingDeg ?? 0);
  const relWindDeg = reading
    ? computeRelativeBearingDeg(windDirection10mDeg, normalizedHeadingDeg)
    : null;
  const relWaveDeg =
    reading && marineAvailable
      ? computeRelativeBearingDeg(waveDirectionDeg, normalizedHeadingDeg)
      : null;

  const unwrappedHeadingDeg = reading
    ? unwrapContinuousAngleDeg(unwrappedHeadingRef.current, normalizedHeadingDeg)
    : 0;
  if (reading) {
    unwrappedHeadingRef.current = unwrappedHeadingDeg;
  } else {
    unwrappedHeadingRef.current = null;
  }

  const unwrappedRelWindDeg =
    relWindDeg !== null
      ? unwrapContinuousAngleDeg(unwrappedRelWindRef.current, relWindDeg)
      : null;
  unwrappedRelWindRef.current = unwrappedRelWindDeg;

  const unwrappedRelWaveDeg =
    relWaveDeg !== null
      ? unwrapContinuousAngleDeg(unwrappedRelWaveRef.current, relWaveDeg)
      : null;
  unwrappedRelWaveRef.current = unwrappedRelWaveDeg;

  const dialRotationDeg = unwrappedHeadingDeg === 0 ? 0 : -unwrappedHeadingDeg;

  return (
    <section
      aria-label="Bússola de Vento e Onda Relativa"
      className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
            <Compass className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Bússola de Vento &amp; Onda Relativa
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Orientação 3D compensada via magnetômetro ({reading?.source ?? 'iOS Sensor'})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {reading && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
              <Navigation className="w-3.5 h-3.5 text-sky-500" aria-hidden="true" />
              Proa: {Math.round(normalizedHeadingDeg)}°
            </span>
          )}

          <button
            type="button"
            data-testid="recalibrate-compass-btn"
            onClick={handleRecalibrateCompass}
            className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border border-sky-200 dark:border-sky-700 bg-sky-50/80 dark:bg-sky-900/40 hover:bg-sky-100 dark:hover:bg-sky-800/60 text-sky-800 dark:text-sky-200 transition-colors"
            title="Resetar eixo acumulado e filtro circular da bússola"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" aria-hidden="true" />
            <span>Recalibrar / Resetar Eixo</span>
          </button>

          <button
            type="button"
            data-testid="hide-compass-button"
            onClick={() => handleToggleCompassPref(false, 'manual_user_hide')}
            className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            title="Ocultar bússola caso o sensor do aparelho oscile"
          >
            <EyeOff className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>Ocultar Bússola</span>
          </button>
        </div>
      </div>

      {isIosPermissionRequired && iosPermissionState === 'prompt' ? (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200">
            No iOS (Safari/PWA), toque ao lado para autorizar o magnetômetro (
            <code className="font-mono text-xs">DeviceOrientationEvent.requestPermission()</code>).
          </p>
          <button
            type="button"
            onClick={handleRequestIosPermission}
            className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors shrink-0"
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>Ativar Bússola iOS</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          {/* Mostrador Circular SVG */}
          <div className="flex items-center justify-center py-2">
            <div className="relative w-44 h-44 rounded-full border-4 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 flex items-center justify-center shadow-inner">
              <div
                data-testid="compass-rose-dial"
                className="absolute inset-2 rounded-full transition-transform duration-150"
                style={{ transform: `rotate(${dialRotationDeg}deg)` }}
              >
                <span className="absolute top-1 left-1/2 -translate-x-1/2 text-xs font-black text-rose-600 dark:text-rose-400">
                  N
                </span>
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500">
                  S
                </span>
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                  L
                </span>
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                  O
                </span>
              </div>

              {/* Vetor Relativo de Vento */}
              {relWindDeg !== null && unwrappedRelWindDeg !== null && (
                <div
                  data-testid="compass-rel-wind-vector"
                  className="absolute inset-4 pointer-events-none transition-transform duration-150"
                  style={{ transform: `rotate(${unwrappedRelWindDeg}deg)` }}
                  title={`Vento relativo: ${Math.round(relWindDeg)}°`}
                >
                  <div className="mx-auto w-1.5 h-16 bg-sky-500 rounded-full shadow" />
                </div>
              )}

              {/* Vetor Relativo de Onda */}
              {relWaveDeg !== null && unwrappedRelWaveDeg !== null && (
                <div
                  data-testid="compass-rel-wave-vector"
                  className="absolute inset-6 pointer-events-none transition-transform duration-150"
                  style={{ transform: `rotate(${unwrappedRelWaveDeg}deg)` }}
                  title={`Onda relativa: ${Math.round(relWaveDeg)}°`}
                >
                  <div className="mx-auto w-1.5 h-12 bg-teal-500 rounded-full opacity-85" />
                </div>
              )}

              <div className="z-10 px-2.5 py-1 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700 text-center">
                <div className="text-sm font-black font-mono text-slate-900 dark:text-white">
                  {Math.round(normalizedHeadingDeg)}°
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Proa</div>
              </div>
            </div>
          </div>

          {/* Métricas de Vento e Onda Relativos */}
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Wind className="w-5 h-5 text-sky-500" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Vento 10m (Verdadeiro / Relativo)
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    {windDirection10mDeg !== null ? `${Math.round(windDirection10mDeg)}°` : 'N/D'}{' '}
                    {windSpeed10mKmh !== null ? `(${windSpeed10mKmh.toFixed(1)} km/h)` : ''}
                  </div>
                </div>
              </div>
              <span className="text-sm font-mono font-bold text-sky-600 dark:text-sky-400">
                {relWindDeg !== null ? `Rel ${Math.round(relWindDeg)}°` : 'N/D'}
              </span>
            </div>

            {marineAvailable && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Waves className="w-5 h-5 text-teal-500" aria-hidden="true" />
                  <div>
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Ondas (Verdadeiro / Relativo)
                    </div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {waveDirectionDeg !== null ? `${Math.round(waveDirectionDeg)}°` : 'N/D'}{' '}
                      {waveHeightM !== null ? `(${waveHeightM.toFixed(2)} m)` : ''}
                    </div>
                  </div>
                </div>
                <span className="text-sm font-mono font-bold text-teal-600 dark:text-teal-400">
                  {relWaveDeg !== null ? `Rel ${Math.round(relWaveDeg)}°` : 'N/D'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
