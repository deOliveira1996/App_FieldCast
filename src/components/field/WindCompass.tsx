import React, { useCallback, useEffect, useState } from 'react';
import { Compass, Navigation, ShieldCheck, Waves, Wind } from 'lucide-react';
import type { CompassReading } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import { safeAction } from '../../utils/safeAction';

export interface DeviceOrientationEventWithWebkit extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

export interface DeviceOrientationConstructorWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

/**
 * Normaliza qualquer ângulo em graus para o intervalo `[0, 360)`.
 */
export function normalizeCompassDeg(angleDeg: number): number {
  const mod = angleDeg % 360;
  return mod < 0 ? mod + 360 : mod === 0 ? 0 : mod;
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
 * Extrai a proa magnética/verdadeira (`headingDeg`) a partir de um evento `DeviceOrientationEvent`:
 * - iOS: `webkitCompassHeading`
 * - Android/Web: `360 - alpha` (`deviceorientationabsolute` / `deviceorientation`)
 */
export function extractHeadingFromOrientationEvent(event: {
  alpha: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
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
    return {
      headingDeg: normalizeCompassDeg(360 - event.alpha),
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
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

/**
 * Bússola de Vento e Onda Relativa (Seção 4.6 de `docs/SPEC.md`):
 * - iOS: Botão explícito chamando `DeviceOrientationEvent.requestPermission()` + `webkitCompassHeading`.
 * - Android/Web: `deviceorientationabsolute` (`360 - alpha`).
 * - Desktop / Sem sensor: Oculta automaticamente (`return null`).
 */
export const WindCompass: React.FC<WindCompassProps> = ({
  windDirection10mDeg,
  windSpeed10mKmh,
  waveDirectionDeg,
  waveHeightM,
  marineAvailable,
  simulatedHeadingDeg,
  onToast,
  onErrorLog,
}) => {
  const isIosPermissionRequired = requiresIosOrientationPermission();

  const [iosPermissionState, setIosPermissionState] = useState<
    'prompt' | 'granted' | 'denied'
  >(() => (isIosPermissionRequired ? 'prompt' : 'granted'));

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

  const handleOrientationEvent = useCallback(
    (rawEvent: Event) => {
      const event = rawEvent as DeviceOrientationEventWithWebkit;
      const extracted = extractHeadingFromOrientationEvent({
        alpha: event.alpha,
        absolute: event.absolute,
        webkitCompassHeading: event.webkitCompassHeading,
      });

      if (!extracted) {
        return;
      }

      setSensorUnavailable(false);
      setReading({
        headingDeg: extracted.headingDeg,
        relativeWindDeg: computeRelativeBearingDeg(windDirection10mDeg, extracted.headingDeg),
        relativeWaveDeg: marineAvailable
          ? computeRelativeBearingDeg(waveDirectionDeg, extracted.headingDeg)
          : null,
        source: extracted.source,
        timestampMs: Date.now(),
      });
    },
    [marineAvailable, waveDirectionDeg, windDirection10mDeg],
  );

  useEffect(() => {
    if (typeof simulatedHeadingDeg === 'number' && Number.isFinite(simulatedHeadingDeg)) {
      const h = normalizeCompassDeg(simulatedHeadingDeg);
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

    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      setSensorUnavailable(true);
      return;
    }

    if (isIosPermissionRequired && iosPermissionState !== 'granted') {
      return;
    }

    const win = window as Window;
    win.addEventListener('deviceorientationabsolute', handleOrientationEvent, true);
    win.addEventListener('deviceorientation', handleOrientationEvent, true);

    const timer = setTimeout(() => {
      setReading((current) => {
        if (!current) {
          setSensorUnavailable(true);
        }
        return current;
      });
    }, 1500);

    return () => {
      clearTimeout(timer);
      win.removeEventListener('deviceorientationabsolute', handleOrientationEvent, true);
      win.removeEventListener('deviceorientation', handleOrientationEvent, true);
    };
  }, [
    handleOrientationEvent,
    iosPermissionState,
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

  // Seção 4.6 de docs/SPEC.md: "Desktop/Sem sensor: Oculta automaticamente."
  if (!isIosPermissionRequired && (sensorUnavailable || !reading)) {
    return null;
  }

  if (isIosPermissionRequired && iosPermissionState === 'denied') {
    return null;
  }

  const headingDeg = reading?.headingDeg ?? 0;
  const relWindDeg = reading
    ? computeRelativeBearingDeg(windDirection10mDeg, reading.headingDeg)
    : null;
  const relWaveDeg =
    reading && marineAvailable
      ? computeRelativeBearingDeg(waveDirectionDeg, reading.headingDeg)
      : null;

  return (
    <section
      aria-label="Bússola de Vento e Onda Relativa"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4"
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
              Orientação em tempo real via magnetômetro ({reading?.source ?? 'iOS Sensor'})
            </p>
          </div>
        </div>

        {reading && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
            <Navigation className="w-3.5 h-3.5 text-sky-500" aria-hidden="true" />
            Proa: {Math.round(headingDeg)}°
          </span>
        )}
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
                className="absolute inset-2 rounded-full transition-transform duration-150"
                style={{ transform: `rotate(${-headingDeg}deg)` }}
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
              {relWindDeg !== null && (
                <div
                  className="absolute inset-4 pointer-events-none transition-transform duration-150"
                  style={{ transform: `rotate(${relWindDeg}deg)` }}
                  title={`Vento relativo: ${Math.round(relWindDeg)}°`}
                >
                  <div className="mx-auto w-1.5 h-16 bg-sky-500 rounded-full shadow" />
                </div>
              )}

              {/* Vetor Relativo de Onda */}
              {relWaveDeg !== null && (
                <div
                  className="absolute inset-6 pointer-events-none transition-transform duration-150"
                  style={{ transform: `rotate(${relWaveDeg}deg)` }}
                  title={`Onda relativa: ${Math.round(relWaveDeg)}°`}
                >
                  <div className="mx-auto w-1.5 h-12 bg-teal-500 rounded-full opacity-85" />
                </div>
              )}

              <div className="z-10 px-2.5 py-1 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700 text-center">
                <div className="text-sm font-black font-mono text-slate-900 dark:text-white">
                  {Math.round(headingDeg)}°
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
