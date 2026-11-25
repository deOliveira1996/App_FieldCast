import * as SunCalc from 'suncalc';
import { computeModelScalarStat } from './ensembleMath';
import { formatLocalYMD, getLocalDateParts } from './localTimeHour';
import {
  DEFAULT_SAFE_WINDOW_THRESHOLDS,
  type EnsembleHour,
  type EphemerisData,
  type OperationalAlert,
  type SafeWindowStatus,
  type SafeWindowThresholds,
  type StratifiedCloudCover,
  type WeatherModelId,
} from '../types/weather';

export const BAROMETRIC_SQUALL_DROP_THRESHOLD_HPA = 4;
export const FOG_VISIBILITY_THRESHOLD_M = 1000;
export const FOG_DEW_POINT_SPREAD_THRESHOLD_C = 2;
export const SAFE_WINDOW_AMBER_RATIO = 0.75;

/**
 * Avalia o Semáforo de Janela Segura (`green` | `amber` | `red`) para uma hora
 * com base nos limites configuráveis pelo usuário (`SafeWindowThresholds`).
 */
export function evaluateSafeWindow(
  input: {
    windSpeed10mKmh: number | null | undefined;
    windGusts10mKmh: number | null | undefined;
    waveHeightM?: number | null | undefined;
    precipProbPct: number | null | undefined;
  },
  thresholds: SafeWindowThresholds = DEFAULT_SAFE_WINDOW_THRESHOLDS,
): { status: SafeWindowStatus; reasons: string[] } {
  const redReasons: string[] = [];
  const amberReasons: string[] = [];

  const checkMetric = (
    val: number | null | undefined,
    maxLimit: number,
    label: string,
    unit: string,
    decimals = 1,
  ) => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return;
    if (val >= maxLimit) {
      redReasons.push(
        `${label} (${val.toFixed(decimals)} ${unit}) acima do limite (${maxLimit} ${unit})`,
      );
    } else if (val >= maxLimit * SAFE_WINDOW_AMBER_RATIO) {
      amberReasons.push(
        `${label} (${val.toFixed(decimals)} ${unit}) próximo ao limite (${maxLimit} ${unit})`,
      );
    }
  };

  const isEnabled = thresholds.enabled;
  if (isEnabled?.maxWindKmh !== false) {
    checkMetric(input.windSpeed10mKmh, thresholds.maxWindKmh, 'Vento 10m', 'km/h', 1);
  }
  if (isEnabled?.maxGustKmh !== false) {
    checkMetric(input.windGusts10mKmh, thresholds.maxGustKmh, 'Rajada 10m', 'km/h', 1);
  }
  if (isEnabled?.maxWaveM !== false) {
    checkMetric(input.waveHeightM, thresholds.maxWaveM, 'Altura de onda', 'm', 2);
  }
  if (isEnabled?.maxPrecipProbPct !== false) {
    checkMetric(input.precipProbPct, thresholds.maxPrecipProbPct, 'Prob. de chuva', '%', 0);
  }

  const anyEnabled =
    isEnabled?.maxWindKmh !== false ||
    isEnabled?.maxGustKmh !== false ||
    isEnabled?.maxWaveM !== false ||
    isEnabled?.maxPrecipProbPct !== false;

  if (!anyEnabled) {
    return {
      status: 'green',
      reasons: ['Monitoramento de limites da janela segura desativado pelo usuário'],
    };
  }

  if (redReasons.length > 0) {
    return { status: 'red', reasons: redReasons };
  }
  if (amberReasons.length > 0) {
    return { status: 'amber', reasons: amberReasons };
  }
  return { status: 'green', reasons: ['Condições dentro da janela operacional segura'] };
}

/**
 * Calcula a variação barométrica de 3 horas (`Delta P / 3h = P(t) - P(t - 3h)`).
 * Valores negativos indicam queda de pressão atmosférica.
 */
export function computePressureDelta3h(
  pressuresHpa: readonly (number | null | undefined)[],
  index: number,
): number | null {
  if (index < 3 || index >= pressuresHpa.length) {
    return null;
  }
  const current = pressuresHpa[index];
  const prev3h = pressuresHpa[index - 3];
  if (
    typeof current !== 'number' ||
    !Number.isFinite(current) ||
    typeof prev3h !== 'number' ||
    !Number.isFinite(prev3h)
  ) {
    return null;
  }
  return Number((current - prev3h).toFixed(2));
}

/**
 * Verifica se a variação barométrica de 3h (`Delta P / 3h`) configura risco de frente/rajadas
 * (queda > 4 hPa em 3h, ou seja, `delta3hHpa < -4`).
 */
export function isBarometricSquallRisk(delta3hHpa: number | null | undefined): boolean {
  if (typeof delta3hHpa !== 'number' || !Number.isFinite(delta3hHpa)) {
    return false;
  }
  return delta3hHpa < -BAROMETRIC_SQUALL_DROP_THRESHOLD_HPA;
}

/**
 * Avalia tendência barométrica diretamente entre dois valores de pressão separados por 3h.
 */
export function evaluateBarometricTendency(
  pressurePrev3hHpa: number | null | undefined,
  pressureCurrentHpa: number | null | undefined,
): { delta3hHpa: number | null; dropHpa: number | null; isSquallRisk: boolean } {
  if (
    typeof pressurePrev3hHpa !== 'number' ||
    !Number.isFinite(pressurePrev3hHpa) ||
    typeof pressureCurrentHpa !== 'number' ||
    !Number.isFinite(pressureCurrentHpa)
  ) {
    return { delta3hHpa: null, dropHpa: null, isSquallRisk: false };
  }
  const delta3hHpa = Number((pressureCurrentHpa - pressurePrev3hHpa).toFixed(2));
  const dropHpa = Number((pressurePrev3hHpa - pressureCurrentHpa).toFixed(2));
  return {
    delta3hHpa,
    dropHpa,
    isSquallRisk: dropHpa > BAROMETRIC_SQUALL_DROP_THRESHOLD_HPA,
  };
}

/**
 * Calcula o *dew point spread* (`temperature_2m - dew_point_2m` em °C).
 */
export function computeDewPointSpread(
  temperature2mC: number | null | undefined,
  dewPoint2mC: number | null | undefined,
): number | null {
  if (
    typeof temperature2mC !== 'number' ||
    !Number.isFinite(temperature2mC) ||
    typeof dewPoint2mC !== 'number' ||
    !Number.isFinite(dewPoint2mC)
  ) {
    return null;
  }
  return Number((temperature2mC - dewPoint2mC).toFixed(2));
}

/**
 * Avalia risco de nevoeiro cruzando `visibility < 1000m` com
 * *dew point spread* (`temperature_2m - dew_point_2m < 2 °C`).
 */
export function evaluateFogRisk(input: {
  visibilityM: number | null | undefined;
  temperature2mC?: number | null | undefined;
  dewPoint2mC?: number | null | undefined;
  dewPointSpreadC?: number | null | undefined;
}): boolean {
  const { visibilityM } = input;
  if (typeof visibilityM !== 'number' || !Number.isFinite(visibilityM)) {
    return false;
  }
  if (visibilityM >= FOG_VISIBILITY_THRESHOLD_M) {
    return false;
  }

  const spread =
    input.dewPointSpreadC !== undefined
      ? input.dewPointSpreadC
      : computeDewPointSpread(input.temperature2mC, input.dewPoint2mC);

  if (typeof spread !== 'number' || !Number.isFinite(spread)) {
    return false;
  }

  return spread < FOG_DEW_POINT_SPREAD_THRESHOLD_C;
}

/**
 * Consolida a nebulosidade estratificada (Baixa, Média e Alta separadas).
 */
export function buildStratifiedCloudCover(input: {
  lowByModel: Partial<Record<WeatherModelId, number | null>>;
  midByModel: Partial<Record<WeatherModelId, number | null>>;
  highByModel: Partial<Record<WeatherModelId, number | null>>;
}): StratifiedCloudCover {
  return {
    lowPct: computeModelScalarStat(input.lowByModel),
    midPct: computeModelScalarStat(input.midByModel),
    highPct: computeModelScalarStat(input.highByModel),
  };
}

/**
 * Gera lista de alertas operacionais consolidados a partir das horas normalizadas.
 */
export function generateOperationalAlerts(hours: readonly EnsembleHour[]): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  const seenTypes = new Set<string>();

  for (const hour of hours) {
    if (hour.barometricSquallRisk && !seenTypes.has('pressure_drop')) {
      seenTypes.add('pressure_drop');
      const dropVal =
        hour.pressureDelta3hHpa !== null ? Math.abs(hour.pressureDelta3hHpa) : null;
      alerts.push({
        id: `pressure_drop_${hour.timestampUnix}`,
        type: 'pressure_drop',
        severity: 'critical',
        title: 'Queda Barométrica Brusca (Risco de Frente/Squall)',
        description: `Queda de ${dropVal !== null ? dropVal.toFixed(1) : '> 4.0'} hPa em 3h detectada para ${hour.timestampIso}. Risco de entrada frontal e rajadas súbitas.`,
        timestampUnix: hour.timestampUnix,
        timestampIso: hour.timestampIso,
        value: hour.pressureDelta3hHpa,
        unit: 'hPa/3h',
      });
    }

    if (hour.fogRisk && !seenTypes.has('fog_risk')) {
      seenTypes.add('fog_risk');
      alerts.push({
        id: `fog_risk_${hour.timestampUnix}`,
        type: 'fog_risk',
        severity: 'warning',
        title: 'Alerta de Nevoeiro Denso e Baixa Visibilidade',
        description: `Visibilidade reduzida (${hour.visibilityM.mean !== null ? Math.round(hour.visibilityM.mean) : '< 1000'} m) combinada com spread T-Td de ${hour.dewPointSpreadC !== null ? hour.dewPointSpreadC.toFixed(1) : '< 2.0'} °C.`,
        timestampUnix: hour.timestampUnix,
        timestampIso: hour.timestampIso,
        value: hour.visibilityM.mean,
        unit: 'm',
      });
    }

    if (hour.verticalProfile.atypicalShearWarning && !seenTypes.has('atypical_shear')) {
      seenTypes.add('atypical_shear');
      alerts.push({
        id: `atypical_shear_${hour.timestampUnix}`,
        type: 'atypical_shear',
        severity: 'warning',
        title: 'Cisalhamento Vertical Atípico',
        description:
          hour.verticalProfile.shearWarningMessage ??
          'Cisalhamento Atípico — Baixa Confiança na Interpolação',
        timestampUnix: hour.timestampUnix,
        timestampIso: hour.timestampIso,
        value: hour.verticalProfile.alpha,
        unit: 'α',
      });
    }

    if (hour.safeWindow === 'red' && !seenTypes.has('safe_window_red')) {
      seenTypes.add('safe_window_red');
      alerts.push({
        id: `safe_window_red_${hour.timestampUnix}`,
        type: 'safe_window_red',
        severity: 'critical',
        title: 'Janela Operacional Crítica (Semáforo Vermelho)',
        description: hour.safeWindowReasons.join(' • '),
        timestampUnix: hour.timestampUnix,
        timestampIso: hour.timestampIso,
        value: hour.windGusts10m.mean ?? hour.windSpeed10m.mean,
        unit: 'km/h',
      });
    }
  }

  return alerts;
}

/**
 * Retorna o rótulo em português para a fase da lua (`0.0` a `1.0`).
 */
export function getMoonPhaseLabel(phase: number): string {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.0625 || p >= 0.9375) return 'Lua Nova';
  if (p < 0.1875) return 'Lua Crescente';
  if (p < 0.3125) return 'Quarto Crescente';
  if (p < 0.4375) return 'Gibosa Crescente';
  if (p < 0.5625) return 'Lua Cheia';
  if (p < 0.6875) return 'Gibosa Minguante';
  if (p < 0.8125) return 'Quarto Minguante';
  return 'Lua Minguante';
}

function safeDateToIso(d: Date | undefined | null): string | null {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

/**
 * Calcula efemérides solares e lunares 100% offline usando `suncalc` para uma data e coordenada.
 * Quando `timezone` é informado (ou via fuso local), ancora `dateIso` ao dia civil local
 * e calcula o SunCalc ao meio-dia UTC desse dia civil para evitar desvios de meia-noite UTC.
 */
export function computeEphemerisForDate(
  date: Date,
  latitude: number,
  longitude: number,
  timezone?: string,
): EphemerisData {
  const { year, month, day } = getLocalDateParts(date, timezone);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dateIso = formatLocalYMD(date, timezone);

  const times = SunCalc.getTimes(noonUtc, latitude, longitude);
  const moon = SunCalc.getMoonIllumination(noonUtc);

  return {
    dateIso,
    sunriseIso: safeDateToIso(times.sunrise),
    sunsetIso: safeDateToIso(times.sunset),
    civilDawnIso: safeDateToIso(times.dawn),
    civilDuskIso: safeDateToIso(times.dusk),
    nauticalDawnIso: safeDateToIso(times.nauticalDawn),
    nauticalDuskIso: safeDateToIso(times.nauticalDusk),
    moonPhaseValue: Number(moon.phase.toFixed(4)),
    moonPhaseLabel: getMoonPhaseLabel(moon.phase),
    moonIlluminationPct: Math.round(moon.fraction * 100),
  };
}

/**
 * Calcula efemérides diárias para o intervalo de timestamps UNIX do horizonte de previsão,
 * agrupando os dias pelo calendário local em `timezone`.
 */
export function computeEphemerisRange(
  latitude: number,
  longitude: number,
  timestampsUnix: readonly number[],
  timezone?: string,
): EphemerisData[] {
  const uniqueDays = new Map<string, Date>();

  for (const ts of timestampsUnix) {
    const d = new Date(ts * 1000);
    const key = formatLocalYMD(d, timezone);
    if (!uniqueDays.has(key)) {
      uniqueDays.set(key, d);
    }
  }

  if (uniqueDays.size === 0) {
    const now = new Date();
    uniqueDays.set(formatLocalYMD(now, timezone), now);
  }

  const results: EphemerisData[] = [];
  for (const d of uniqueDays.values()) {
    results.push(computeEphemerisForDate(d, latitude, longitude, timezone));
  }
  return results;
}
