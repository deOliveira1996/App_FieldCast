import type { EnsembleHour, SafeWindowStatus } from '../types/weather';
import { formatLocalHourBadge, formatLocalYMD } from './localTimeHour';

export type DroneFlightLimitKey =
  | 'maxWindKmh'
  | 'maxGustKmh'
  | 'maxKpIndex'
  | 'maxPrecipMm'
  | 'minVisibilityKm';

export interface DroneFlightLimits {
  targetAltitudeM: 30 | 50 | 80 | 100 | 120;
  maxWindKmh: number;
  maxGustKmh: number;
  maxKpIndex: number;
  maxPrecipMm: number;
  minVisibilityKm: number;
  enabled?: Partial<Record<DroneFlightLimitKey, boolean>>;
}

export const DEFAULT_DRONE_FLIGHT_LIMITS: DroneFlightLimits = {
  targetAltitudeM: 80,
  maxWindKmh: 36,
  maxGustKmh: 48,
  maxKpIndex: 4.5,
  maxPrecipMm: 0.2,
  minVisibilityKm: 3.0,
};

export interface DroneFlightAssessment {
  score: number;
  status: SafeWindowStatus;
  label: string;
  altitudeWindKmh: number | null;
  surfaceWindKmh: number | null;
  gust10mKmh: number | null;
  visibilityKm: number | null;
  effectiveKp: number;
  reasons: string[];
}

export function getWindSpeedAtAltitude(
  hour: EnsembleHour | undefined,
  altitudeM: number,
): number | null {
  if (!hour) return null;
  const levels = hour.verticalProfile.interpolatedLevels;
  const exactInterp = levels.find((l) => l.heightM === altitudeM && l.speedKmh !== null);
  if (exactInterp && exactInterp.speedKmh !== null) {
    return exactInterp.speedKmh;
  }
  if (altitudeM <= 10) return hour.windSpeed10m.mean;
  if (altitudeM === 80) return hour.windSpeed80m.mean ?? hour.windSpeed10m.mean;
  if (altitudeM === 100) return hour.windSpeed100m.mean ?? hour.windSpeed80m.mean ?? hour.windSpeed10m.mean;
  if (altitudeM >= 120) return hour.windSpeed120m.mean ?? hour.windSpeed100m.mean ?? hour.windSpeed10m.mean;
  return hour.windSpeed10m.mean;
}

/**
 * Calcula Índice de Condições de Voo para Drone (0–100) combinando:
 * vento em altitude (30–120m), rajada 10m, cisalhamento atípico, chuva,
 * nevoeiro/visibilidade, queda barométrica e Índice Kp geomagnético.
 */
export function computeDroneFlightAssessment(
  hour: EnsembleHour | undefined,
  effectiveKp: number,
  limits: DroneFlightLimits = DEFAULT_DRONE_FLIGHT_LIMITS,
): DroneFlightAssessment {
  const safeKp = Math.max(0, Math.min(9, Number.isFinite(effectiveKp) ? effectiveKp : 0));

  if (!hour) {
    return {
      score: 0,
      status: 'red',
      label: 'Sem Dados Meteorológicos',
      altitudeWindKmh: null,
      surfaceWindKmh: null,
      gust10mKmh: null,
      visibilityKm: null,
      effectiveKp: safeKp,
      reasons: ['Nenhuma janela horária carregada'],
    };
  }

  let score = 100;
  const reasons: string[] = [];

  const altWind = getWindSpeedAtAltitude(hour, limits.targetAltitudeM);
  const surfaceWind = hour.windSpeed10m.mean;
  const gust10m = hour.windGusts10m.mean;
  const precipMm = hour.precipitationMm.mean ?? 0;
  const precipProb = hour.precipitationProbabilityPct.mean ?? 0;
  const visKm = hour.visibilityM.mean !== null ? hour.visibilityM.mean / 1000 : null;

  const enabled = limits.enabled;

  if (enabled?.maxWindKmh !== false && altWind !== null) {
    if (altWind > limits.maxWindKmh) {
      score -= 38;
      reasons.push(
        `Vento a ${limits.targetAltitudeM}m em ${altWind.toFixed(1)} km/h (acima de ${limits.maxWindKmh} km/h)`,
      );
    } else if (altWind > limits.maxWindKmh * 0.78) {
      score -= 16;
      reasons.push(`Vento em altitude moderado (${altWind.toFixed(1)} km/h a ${limits.targetAltitudeM}m)`);
    }
  }

  if (enabled?.maxGustKmh !== false && gust10m !== null) {
    if (gust10m > limits.maxGustKmh) {
      score -= 34;
      reasons.push(`Rajadas em ${gust10m.toFixed(1)} km/h (limite ${limits.maxGustKmh} km/h)`);
    } else if (gust10m > limits.maxGustKmh * 0.8) {
      score -= 14;
      reasons.push(`Rajadas próximas ao limite (${gust10m.toFixed(1)} km/h)`);
    }
  }

  if (enabled?.maxPrecipMm !== false && (precipMm > limits.maxPrecipMm || precipProb >= 70)) {
    score -= 28;
    reasons.push(`Risco de chuva (${precipMm.toFixed(1)} mm • ${Math.round(precipProb)}%)`);
  } else if (enabled?.maxPrecipMm !== false && precipProb >= 40) {
    score -= 10;
    reasons.push(`Probabilidade moderada de precipitação (${Math.round(precipProb)}%)`);
  }

  if (enabled?.minVisibilityKm !== false && (hour.fogRisk || (visKm !== null && visKm < limits.minVisibilityKm))) {
    score -= 24;
    reasons.push(
      visKm !== null
        ? `Baixa visibilidade / risco de nevoeiro (${visKm.toFixed(1)} km)`
        : 'Risco de nevoeiro em baixa altitude',
    );
  }

  if (hour.verticalProfile.atypicalShearWarning || hour.barometricSquallRisk) {
    score -= 14;
    reasons.push(
      hour.barometricSquallRisk
        ? 'Queda barométrica brusca (> 4 hPa/3h — risco de rajadas)'
        : 'Cisalhamento vertical atípico de vento',
    );
  }

  if (enabled?.maxKpIndex !== false) {
    if (safeKp >= 6) {
      score -= 36;
      reasons.push(`Tempestade geomagnética Kp ${safeKp.toFixed(1)} — risco severo de GNSS/bússola`);
    } else if (safeKp > limits.maxKpIndex) {
      score -= 22;
      reasons.push(`Índice Kp ${safeKp.toFixed(1)} acima do limite (${limits.maxKpIndex.toFixed(1)})`);
    } else if (safeKp >= 3.8) {
      score -= 8;
      reasons.push(`Atividade geomagnética moderada (Kp ${safeKp.toFixed(1)})`);
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const status: SafeWindowStatus =
    clampedScore >= 75 ? 'green' : clampedScore >= 50 ? 'amber' : 'red';
  const label =
    status === 'green'
      ? 'Favorável para Voo (VLOS / Drone)'
      : status === 'amber'
        ? 'Atenção Operacional (Restrições)'
        : 'Voo Não Recomendado (Crítico)';

  if (reasons.length === 0) {
    reasons.push('Vento, rajadas, visibilidade e Kp dentro dos parâmetros seguros');
  }

  return {
    score: clampedScore,
    status,
    label,
    altitudeWindKmh: altWind,
    surfaceWindKmh: surfaceWind,
    gust10mKmh: gust10m,
    visibilityKm: visKm,
    effectiveKp: safeKp,
    reasons,
  };
}

export interface TideExtremumEvent {
  type: 'high' | 'low';
  label: 'Preia-mar (Alta)' | 'Baixa-mar (Baixa)';
  timestampUnix: number;
  dayYmd: string;
  hourBadge: string;
  seaLevelHeightMsl: number;
}

/**
 * Extrai picos de Preia-mar (máximos locais) e Baixa-mar (mínimos locais)
 * a partir da série horária de `seaLevelHeightMsl` da Open-Meteo Marine API.
 */
export function extractTideExtrema(
  hours: readonly EnsembleHour[],
  timezone?: string,
): TideExtremumEvent[] {
  const valid = hours
    .map((h) => ({
      timestampUnix: h.timestampUnix,
      level: h.marine?.seaLevelHeightMsl ?? null,
    }))
    .filter((item): item is { timestampUnix: number; level: number } =>
      typeof item.level === 'number' && Number.isFinite(item.level),
    );

  if (valid.length < 3) {
    return [];
  }

  const events: TideExtremumEvent[] = [];
  for (let i = 1; i < valid.length - 1; i++) {
    const prev = valid[i - 1]!.level;
    const curr = valid[i]!.level;
    const next = valid[i + 1]!.level;

    const isHigh = curr >= prev && curr > next;
    const isLow = curr <= prev && curr < next;

    if (!isHigh && !isLow) {
      continue;
    }

    const d = new Date(valid[i]!.timestampUnix * 1000);
    events.push({
      type: isHigh ? 'high' : 'low',
      label: isHigh ? 'Preia-mar (Alta)' : 'Baixa-mar (Baixa)',
      timestampUnix: valid[i]!.timestampUnix,
      dayYmd: formatLocalYMD(d, timezone),
      hourBadge: formatLocalHourBadge(valid[i]!.timestampUnix, timezone),
      seaLevelHeightMsl: Number(curr.toFixed(2)),
    });
  }

  return events;
}
