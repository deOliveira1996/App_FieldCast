import {
  MIN_NORMAL_SHEAR_ALPHA,
  MAX_NORMAL_SHEAR_ALPHA,
} from './ensembleMath';
import type {
  CircularStat,
  ConfidenceBadgeColor,
  ConfidenceScore,
  EnsembleHour,
  ScalarStat,
} from '../types/weather';

export const SHEAR_PENALTY_POINTS = 10;

export interface HourlyConfidenceInput {
  hourIndex: number;
  windSpeed10m: ScalarStat;
  windDirection10m: CircularStat;
  temperature2mC?: ScalarStat;
  precipitationMm?: ScalarStat;
  surfacePressureHpa?: ScalarStat;
  activeAtmosphericModels?: number;
  marineAvailable: boolean;
  /**
   * Indica se a coordenada é continental (sem grade marinha esperada).
   * Se omitido, assume `true` quando `marineAvailable === false` e `marineApiError !== true`.
   */
  isContinental?: boolean;
  /**
   * Indica erro real na chamada da Marine API em área costeira.
   */
  marineApiError?: boolean;
  /**
   * Idade do cache em minutos (`0` ou `null` quando os dados são ao vivo).
   */
  cacheAgeMinutes?: number | null;
  /**
   * Expoente de cisalhamento vertical `alpha` da hora.
   */
  alpha?: number | null;
  /**
   * Flag de cisalhamento atípico do perfil vertical.
   */
  atypicalShearWarning?: boolean;
  /**
   * Indica se a camada interpolada do perfil vertical está ativa para desconto de cisalhamento.
   * Padrão: `true`.
   */
  interpolationActive?: boolean;
}

/**
 * Determina a cor do badge do Índice de Confiabilidade:
 * - Verde: 80–100
 * - Âmbar: 50–79
 * - Vermelho: 0–49
 */
export function getConfidenceBadgeColor(total: number): ConfidenceBadgeColor {
  if (total >= 80) return 'green';
  if (total >= 50) return 'amber';
  return 'red';
}

/**
 * Calcula a pontuação do Horizonte Temporal (0 a 20 pts):
 * - 0–24h: 20 pts (cheio)
 * - 24–72h: decaimento leve (20 -> 14 pts)
 * - > 72h: decaimento acentuado (14 -> 4 pts até 168h)
 */
export function computeTimeHorizonPoints(hourIndex: number): number {
  const h = Math.max(0, hourIndex);
  if (h <= 24) {
    return 20;
  }
  if (h <= 72) {
    const progress = (h - 24) / 48;
    return Number((20 - progress * 6).toFixed(2));
  }
  const progress = Math.min(1, (h - 72) / 96);
  return Number(Math.max(4, 14 - progress * 10).toFixed(2));
}

/**
 * Calcula a Concordância entre Modelos (0 a 50 pts) combinando:
 * - Dispersão relativa do vento a 10m (até 15 pts)
 * - Coerência direcional circular R in [0, 1] (até 15 pts)
 * - Dispersão de temperatura, precipitação e pressão (até 20 pts)
 */
export function computeModelAgreementPoints(input: {
  windSpeed10m: ScalarStat;
  windDirection10m: CircularStat;
  temperature2mC?: ScalarStat;
  precipitationMm?: ScalarStat;
  surfacePressureHpa?: ScalarStat;
}): { points: number; reasons: string[] } {
  const reasons: string[] = [];

  // 1. Vento 10m (15 pts)
  let windPts = 15;
  if (
    input.windSpeed10m.mean !== null &&
    input.windSpeed10m.stdDev !== null &&
    input.windSpeed10m.sampleCount > 1
  ) {
    const scale = Math.max(Math.abs(input.windSpeed10m.mean), 10);
    const relDisp = input.windSpeed10m.stdDev / scale;
    windPts = 15 * Math.max(0, 1 - relDisp * 1.4);
    if (relDisp > 0.3) {
      reasons.push(
        `Divergência moderada/alta na velocidade do vento (σ = ${input.windSpeed10m.stdDev.toFixed(1)} km/h)`,
      );
    }
  } else if (input.windSpeed10m.sampleCount === 0) {
    windPts = 0;
  }

  // 2. Coerência direcional R (15 pts)
  const r = input.windDirection10m.resultantLengthR;
  let dirPts = 15;
  if (typeof r === 'number' && Number.isFinite(r)) {
    dirPts = 15 * Math.max(0, Math.min(1, r));
    if (r < 0.75) {
      reasons.push(`Baixa coerência direcional entre modelos (R = ${r.toFixed(2)})`);
    }
  } else if (input.windDirection10m.sampleCount === 0) {
    dirPts = 0;
  }

  // 3. Temperatura (7 pts), Precipitação (7 pts) e Pressão (6 pts) = 20 pts
  let tempPts = 7;
  if (input.temperature2mC?.stdDev !== null && input.temperature2mC?.stdDev !== undefined) {
    tempPts = 7 * Math.max(0, 1 - input.temperature2mC.stdDev / 5);
  }

  let precipPts = 7;
  if (input.precipitationMm?.stdDev !== null && input.precipitationMm?.stdDev !== undefined) {
    precipPts = 7 * Math.max(0, 1 - input.precipitationMm.stdDev / 4);
    if (input.precipitationMm.stdDev > 1.5) {
      reasons.push(
        `Dispersão de precipitação entre modelos (σ = ${input.precipitationMm.stdDev.toFixed(1)} mm)`,
      );
    }
  }

  let pressurePts = 6;
  if (
    input.surfacePressureHpa?.stdDev !== null &&
    input.surfacePressureHpa?.stdDev !== undefined
  ) {
    pressurePts = 6 * Math.max(0, 1 - input.surfacePressureHpa.stdDev / 4);
  }

  const totalAgreement = Math.max(
    0,
    Math.min(50, Number((windPts + dirPts + tempPts + precipPts + pressurePts).toFixed(2))),
  );

  return { points: totalAgreement, reasons };
}

/**
 * Calcula Integridade e Frescor das Fontes (0 a 30 pts).
 * Regra Continental Obrigatória: Quando `isContinental === true` (coordenada em terra firme sem grade marinha),
 * redistribui o peso marinho para os modelos atmosféricos com ZERO penalidade.
 */
export function computeSourceIntegrityPoints(input: {
  activeAtmosphericModels: number;
  marineAvailable: boolean;
  isContinental: boolean;
  marineApiError?: boolean;
  cacheAgeMinutes?: number | null;
}): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const clampedModels = Math.max(0, Math.min(3, input.activeAtmosphericModels));

  let dataSourcesPts = 0;

  if (input.isContinental) {
    // Regra Continental: peso de 20 pts distribuído 100% nos 3 modelos atmosféricos
    dataSourcesPts = 20 * (clampedModels / 3);
    reasons.push('Coordenada continental: peso oceânico redistribuído sem penalidade');
  } else {
    // Coordenada costeira: 15 pts atmosféricos + 5 pts marinhos
    const atmoPts = 15 * (clampedModels / 3);
    const marineOk = input.marineAvailable && !input.marineApiError;
    const marinePts = marineOk ? 5 : 0;
    dataSourcesPts = atmoPts + marinePts;

    if (!marineOk) {
      reasons.push('Grade marinha indisponível em ponto costeiro (-5 pts)');
    }
  }

  if (clampedModels < 3) {
    reasons.push(`Apenas ${clampedModels}/3 modelos atmosféricos ativos na hora`);
  }

  // Frescor dos dados (10 pts): penaliza cache > 30 min
  let freshnessPts = 10;
  const age = input.cacheAgeMinutes ?? 0;
  if (age > 30) {
    if (age <= 120) {
      freshnessPts = 5;
      reasons.push(`Dados em cache com ${Math.round(age)} min (> 30 min: -5 pts)`);
    } else if (age <= 360) {
      freshnessPts = 2;
      reasons.push(`Cache antigo com ${Math.round(age)} min (-8 pts)`);
    } else {
      freshnessPts = 0;
      reasons.push(`Cache expirado com ${Math.round(age)} min (-10 pts)`);
    }
  }

  const points = Math.max(0, Math.min(30, Number((dataSourcesPts + freshnessPts).toFixed(2))));
  return { points, reasons };
}

/**
 * Calcula o Índice de Confiabilidade horário (0 a 100).
 */
export function computeHourlyConfidence(input: HourlyConfidenceInput): ConfidenceScore {
  const isContinental =
    input.isContinental !== undefined
      ? input.isContinental
      : !input.marineAvailable && !input.marineApiError;

  const activeModels =
    input.activeAtmosphericModels ?? Math.max(input.windSpeed10m.sampleCount, 0);

  const agreement = computeModelAgreementPoints({
    windSpeed10m: input.windSpeed10m,
    windDirection10m: input.windDirection10m,
    temperature2mC: input.temperature2mC,
    precipitationMm: input.precipitationMm,
    surfacePressureHpa: input.surfacePressureHpa,
  });

  const integrity = computeSourceIntegrityPoints({
    activeAtmosphericModels: activeModels,
    marineAvailable: input.marineAvailable,
    isContinental,
    marineApiError: input.marineApiError,
    cacheAgeMinutes: input.cacheAgeMinutes,
  });

  const timeHorizon = computeTimeHorizonPoints(input.hourIndex);

  const interpolationActive = input.interpolationActive ?? true;
  const isAtypicalAlpha =
    input.atypicalShearWarning === true ||
    (typeof input.alpha === 'number' &&
      Number.isFinite(input.alpha) &&
      (input.alpha < MIN_NORMAL_SHEAR_ALPHA || input.alpha > MAX_NORMAL_SHEAR_ALPHA));

  const shearPenalty = interpolationActive && isAtypicalAlpha ? SHEAR_PENALTY_POINTS : 0;

  const reasons: string[] = [...agreement.reasons, ...integrity.reasons];
  if (input.hourIndex > 72) {
    reasons.push(`Horizonte estendido (+${input.hourIndex}h)`);
  } else if (input.hourIndex > 24) {
    reasons.push(`Horizonte médio (+${input.hourIndex}h)`);
  }
  if (shearPenalty > 0) {
    reasons.push(
      `Penalidade de cisalhamento atípico (-${shearPenalty} pts, α = ${
        typeof input.alpha === 'number' ? input.alpha.toFixed(3) : 'atípico'
      })`,
    );
  }
  if (reasons.length === 0) {
    reasons.push('Alta concordância multi-modelo e fontes íntegras');
  }

  const rawTotal = agreement.points + integrity.points + timeHorizon - shearPenalty;
  const total = Math.round(Math.max(0, Math.min(100, rawTotal)));

  return {
    total,
    badge: getConfidenceBadgeColor(total),
    breakdown: {
      modelAgreement: agreement.points,
      sourceIntegrity: integrity.points,
      timeHorizon,
      shearPenalty,
    },
    isContinental,
    reasons,
  };
}

/**
 * Calcula o Índice de Confiabilidade Geral do período (dando maior peso às primeiras 72h operacionais).
 */
export function computeOverallConfidence(
  hours: readonly Pick<EnsembleHour, 'hourIndex' | 'confidence'>[],
  options?: { isContinental?: boolean },
): ConfidenceScore {
  if (hours.length === 0) {
    const isContinental = options?.isContinental ?? false;
    return {
      total: 0,
      badge: 'red',
      breakdown: {
        modelAgreement: 0,
        sourceIntegrity: 0,
        timeHorizon: 0,
        shearPenalty: 0,
      },
      isContinental,
      reasons: ['Sem horas disponíveis para cálculo de confiabilidade'],
    };
  }

  // Pondera as primeiras 48-72h operacionais com peso 2x e o restante com peso 1x
  let weightSum = 0;
  let agreementSum = 0;
  let integritySum = 0;
  let horizonSum = 0;
  let shearPenaltySum = 0;

  for (const h of hours) {
    const w = h.hourIndex < 48 ? 2 : 1;
    weightSum += w;
    agreementSum += h.confidence.breakdown.modelAgreement * w;
    integritySum += h.confidence.breakdown.sourceIntegrity * w;
    horizonSum += h.confidence.breakdown.timeHorizon * w;
    shearPenaltySum += h.confidence.breakdown.shearPenalty * w;
  }

  const modelAgreement = Number((agreementSum / weightSum).toFixed(2));
  const sourceIntegrity = Number((integritySum / weightSum).toFixed(2));
  const timeHorizon = Number((horizonSum / weightSum).toFixed(2));
  const shearPenalty = Number((shearPenaltySum / weightSum).toFixed(2));

  const total = Math.round(
    Math.max(0, Math.min(100, modelAgreement + sourceIntegrity + timeHorizon - shearPenalty)),
  );
  const isContinental = options?.isContinental ?? hours[0]!.confidence.isContinental;

  const reasons: string[] = [];
  if (isContinental) {
    reasons.push('Coordenada continental: peso oceânico redistribuído sem penalidade');
  }
  if (shearPenalty > 0) {
    reasons.push(`Média de penalidade por cisalhamento atípico: -${shearPenalty.toFixed(1)} pts`);
  }
  if (total >= 80) {
    reasons.push('Alta confiabilidade operacional no período');
  } else if (total >= 50) {
    reasons.push('Confiabilidade moderada — verifique bandas de incerteza');
  } else {
    reasons.push('Baixa confiabilidade — forte divergência ou dados degradados');
  }

  return {
    total,
    badge: getConfidenceBadgeColor(total),
    breakdown: {
      modelAgreement,
      sourceIntegrity,
      timeHorizon,
      shearPenalty,
    },
    isContinental,
    reasons,
  };
}
