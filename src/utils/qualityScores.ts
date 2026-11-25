import type {
  ActivityQualityAssessment,
  ActivityQualityThresholds,
} from '../types/v4';
import type { EnsembleHour, SafeWindowStatus } from '../types/weather';
import { decomposeMeteorologicalVector } from './ensembleMath';

export const ACTIVITY_QUALITY_THRESHOLDS_STORAGE_KEY =
  'fieldcast_activity_quality_thresholds_v4';

const KMH_TO_KNOTS = 1 / 1.852;
const METERS_TO_FEET = 3.28084;

export const DEFAULT_ACTIVITY_QUALITY_THRESHOLDS: ActivityQualityThresholds = {
  dailyField: {
    idealMinTempC: 15,
    idealMaxTempC: 31,
    maxWindKmh: 30,
    maxGustKmh: 45,
    maxPrecipProbPct: 60,
    maxCapeJkg: 1000,
  },
  coastalNavigation: {
    maxWindKmh: 28,
    maxGustKmh: 42,
    maxWaveM: 2.0,
    maxCurrentKmh: 3.5,
    minVisibilityKm: 3.0,
  },
};

let memoryQualityThresholds: ActivityQualityThresholds = structuredCloneFallback(
  DEFAULT_ACTIVITY_QUALITY_THRESHOLDS,
);

function structuredCloneFallback(
  source: ActivityQualityThresholds,
): ActivityQualityThresholds {
  return {
    dailyField: { ...source.dailyField },
    coastalNavigation: { ...source.coastalNavigation },
  };
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function sanitizeActivityQualityThresholds(
  raw: Partial<ActivityQualityThresholds> | null | undefined,
): ActivityQualityThresholds {
  const df = raw?.dailyField;
  const cn = raw?.coastalNavigation;

  const idealMinTempC = clampNumber(
    df?.idealMinTempC,
    DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.dailyField.idealMinTempC,
    -25,
    38,
  );
  const rawMaxTemp = clampNumber(
    df?.idealMaxTempC,
    DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.dailyField.idealMaxTempC,
    -15,
    50,
  );
  const idealMaxTempC = Math.max(idealMinTempC + 2, rawMaxTemp);

  return {
    dailyField: {
      idealMinTempC,
      idealMaxTempC,
      maxWindKmh: clampNumber(
        df?.maxWindKmh,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.dailyField.maxWindKmh,
        5,
        150,
      ),
      maxGustKmh: clampNumber(
        df?.maxGustKmh,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.dailyField.maxGustKmh,
        5,
        200,
      ),
      maxPrecipProbPct: clampNumber(
        df?.maxPrecipProbPct,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.dailyField.maxPrecipProbPct,
        0,
        100,
      ),
      maxCapeJkg: clampNumber(
        df?.maxCapeJkg,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.dailyField.maxCapeJkg,
        100,
        5000,
      ),
    },
    coastalNavigation: {
      maxWindKmh: clampNumber(
        cn?.maxWindKmh,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.coastalNavigation.maxWindKmh,
        5,
        150,
      ),
      maxGustKmh: clampNumber(
        cn?.maxGustKmh,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.coastalNavigation.maxGustKmh,
        5,
        200,
      ),
      maxWaveM: clampNumber(
        cn?.maxWaveM,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.coastalNavigation.maxWaveM,
        0.2,
        20,
      ),
      maxCurrentKmh: clampNumber(
        cn?.maxCurrentKmh,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.coastalNavigation.maxCurrentKmh,
        0.2,
        25,
      ),
      minVisibilityKm: clampNumber(
        cn?.minVisibilityKm,
        DEFAULT_ACTIVITY_QUALITY_THRESHOLDS.coastalNavigation.minVisibilityKm,
        0.2,
        30,
      ),
    },
  };
}

/**
 * Calcula a umidade relativa do ar a 2m (%) pela aproximação de Magnus-Tetens
 * a partir de `tempC` e `dewPointC`, limitada ao intervalo físico operacional `[5, 100]`.
 */
export function computeMagnusRelativeHumidityPct(
  tempC: number | null,
  dewPointC: number | null,
): number | null {
  if (
    tempC === null ||
    dewPointC === null ||
    typeof tempC !== 'number' ||
    typeof dewPointC !== 'number' ||
    !Number.isFinite(tempC) ||
    !Number.isFinite(dewPointC) ||
    243.04 + tempC <= 0 ||
    243.04 + dewPointC <= 0
  ) {
    return null;
  }

  const esTd = Math.exp((17.625 * dewPointC) / (243.04 + dewPointC));
  const esT = Math.exp((17.625 * tempC) / (243.04 + tempC));
  if (!Number.isFinite(esTd) || !Number.isFinite(esT) || esT <= 0) {
    return null;
  }

  const rawRh = (100 * esTd) / esT;
  const clamped = Math.max(5, Math.min(100, rawRh));
  return Number(clamped.toFixed(1));
}

/**
 * Aproximação de Temperatura Aparente de Steadman (°C) combinando temperatura do ar,
 * pressão parcial de vapor d'água (via umidade relativa) e resfriamento convectivo pelo vento a 10m.
 */
export function computeApparentTemperatureFallbackC(
  tempC: number | null,
  rhPct: number | null,
  windKmh: number | null,
): number | null {
  if (tempC === null || typeof tempC !== 'number' || !Number.isFinite(tempC)) {
    return null;
  }
  if (237.7 + tempC <= 0) {
    return null;
  }

  const effectiveRh =
    rhPct !== null && typeof rhPct === 'number' && Number.isFinite(rhPct)
      ? Math.max(5, Math.min(100, rhPct))
      : 65;
  const windMs =
    windKmh !== null && typeof windKmh === 'number' && Number.isFinite(windKmh)
      ? Math.max(0, windKmh) / 3.6
      : 0;

  const vaporPressureHpa =
    (effectiveRh / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  const apparentC = tempC + 0.33 * vaporPressureHpa - 0.7 * windMs - 4.0;
  return Number(apparentC.toFixed(1));
}

/**
 * Calcula o cisalhamento vertical de vento em nós por 100 pés (`kt/100ft`):
 * `|V_upper - V_10m|` (em nós) dividido por `(z_upper_m - 10) * 3.28084 / 100`,
 * utilizando o nível superior nativo disponível (`80m` ou `100m`).
 */
export function computeVerticalWindShearKtPer100ft(
  hour: Pick<
    EnsembleHour,
    | 'windSpeed10m'
    | 'windSpeed80m'
    | 'windSpeed100m'
    | 'windDirection10m'
    | 'windDirection80m'
    | 'windDirection100m'
  >,
): number | null {
  const speed10Kmh = hour.windSpeed10m.mean;
  if (
    speed10Kmh === null ||
    typeof speed10Kmh !== 'number' ||
    !Number.isFinite(speed10Kmh) ||
    speed10Kmh < 0
  ) {
    return null;
  }

  let zUpperM: number | null = null;
  let speedUpperKmh: number | null = null;
  let dirUpperDeg: number | null = null;

  if (
    hour.windSpeed80m.mean !== null &&
    typeof hour.windSpeed80m.mean === 'number' &&
    Number.isFinite(hour.windSpeed80m.mean) &&
    hour.windSpeed80m.mean >= 0
  ) {
    zUpperM = 80;
    speedUpperKmh = hour.windSpeed80m.mean;
    dirUpperDeg = hour.windDirection80m.degree;
  } else if (
    hour.windSpeed100m.mean !== null &&
    typeof hour.windSpeed100m.mean === 'number' &&
    Number.isFinite(hour.windSpeed100m.mean) &&
    hour.windSpeed100m.mean >= 0
  ) {
    zUpperM = 100;
    speedUpperKmh = hour.windSpeed100m.mean;
    dirUpperDeg = hour.windDirection100m.degree;
  }

  if (zUpperM === null || speedUpperKmh === null) {
    return null;
  }

  const speed10Kt = speed10Kmh * KMH_TO_KNOTS;
  const speedUpperKt = speedUpperKmh * KMH_TO_KNOTS;
  const dir10Deg = hour.windDirection10m.degree;

  let vectorDiffKt: number;
  if (
    dir10Deg !== null &&
    dirUpperDeg !== null &&
    Number.isFinite(dir10Deg) &&
    Number.isFinite(dirUpperDeg)
  ) {
    const v10 =
      speed10Kt > 0
        ? decomposeMeteorologicalVector(dir10Deg, speed10Kt)
        : { u: 0, v: 0 };
    const vUp =
      speedUpperKt > 0
        ? decomposeMeteorologicalVector(dirUpperDeg, speedUpperKt)
        : { u: 0, v: 0 };
    vectorDiffKt = Math.hypot(vUp.u - v10.u, vUp.v - v10.v);
  } else {
    vectorDiffKt = Math.abs(speedUpperKt - speed10Kt);
  }

  const thickness100Ft = ((zUpperM - 10) * METERS_TO_FEET) / 100;
  if (thickness100Ft <= 0) {
    return null;
  }

  return Number((vectorDiffKt / thickness100Ft).toFixed(2));
}

/**
 * Carrega os limites customizáveis de qualidade operacional por atividade (`localStorage` + fallback em memória).
 */
export function loadActivityQualityThresholds(): ActivityQualityThresholds {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(ACTIVITY_QUALITY_THRESHOLDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ActivityQualityThresholds>;
        const sanitized = sanitizeActivityQualityThresholds(parsed);
        memoryQualityThresholds = sanitized;
        return structuredCloneFallback(sanitized);
      }
    }
  } catch {
    // Usa fallback em memória se localStorage estiver bloqueado ou corrompido
  }
  return structuredCloneFallback(memoryQualityThresholds);
}

/**
 * Persiste os limites customizáveis de qualidade operacional por atividade (`localStorage` + fallback em memória).
 */
export function saveActivityQualityThresholds(
  thresholds: ActivityQualityThresholds,
): ActivityQualityThresholds {
  const sanitized = sanitizeActivityQualityThresholds(thresholds);
  memoryQualityThresholds = sanitized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        ACTIVITY_QUALITY_THRESHOLDS_STORAGE_KEY,
        JSON.stringify(sanitized),
      );
    }
  } catch {
    // Mantém em memória caso o armazenamento local esteja indisponível
  }
  return structuredCloneFallback(sanitized);
}

function scoreToStatus(score: number): SafeWindowStatus {
  if (score >= 75) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

/**
 * Calcula o score `0–100` e diagnóstico de qualidade para Operações Diárias & Campo (`daily_field`).
 */
export function computeDailyFieldQuality(
  hour: EnsembleHour | undefined,
  thresholds: ActivityQualityThresholds = DEFAULT_ACTIVITY_QUALITY_THRESHOLDS,
): ActivityQualityAssessment {
  if (!hour) {
    return {
      domain: 'daily_field',
      score: 0,
      status: 'amber',
      label: 'Dados Indisponíveis',
      summary: 'Aguardando carregamento da grade horária para avaliar condições de campo.',
      factors: ['Sem hora meteorológica selecionada'],
    };
  }

  const cfg = sanitizeActivityQualityThresholds(thresholds).dailyField;
  let penalty = 0;
  const factors: string[] = [];

  const tempC = hour.temperature2mC.mean;
  if (tempC !== null && Number.isFinite(tempC)) {
    if (tempC < cfg.idealMinTempC) {
      const diff = cfg.idealMinTempC - tempC;
      penalty += Math.min(22, 6 + diff * 1.8);
      factors.push(`Temperatura abaixo da faixa ideal (${tempC.toFixed(1)} °C)`);
    } else if (tempC > cfg.idealMaxTempC) {
      const diff = tempC - cfg.idealMaxTempC;
      penalty += Math.min(24, 7 + diff * 2.2);
      factors.push(`Calor acima da faixa ideal (${tempC.toFixed(1)} °C)`);
    }
  }

  const windKmh = hour.windSpeed10m.mean;
  if (windKmh !== null && Number.isFinite(windKmh)) {
    if (windKmh >= cfg.maxWindKmh) {
      penalty += Math.min(32, 18 + (windKmh - cfg.maxWindKmh) * 0.9);
      factors.push(`Vento 10m acima do limite (${windKmh.toFixed(1)} km/h)`);
    } else if (windKmh >= cfg.maxWindKmh * 0.75) {
      penalty += 9;
      factors.push(`Vento 10m moderado (${windKmh.toFixed(1)} km/h)`);
    }
  }

  const gustKmh = hour.windGusts10m.mean;
  if (gustKmh !== null && Number.isFinite(gustKmh)) {
    if (gustKmh >= cfg.maxGustKmh) {
      penalty += Math.min(28, 15 + (gustKmh - cfg.maxGustKmh) * 0.65);
      factors.push(`Rajadas fortes a 10m (${gustKmh.toFixed(1)} km/h)`);
    } else if (gustKmh >= cfg.maxGustKmh * 0.75) {
      penalty += 8;
      factors.push(`Rajadas em atenção (${gustKmh.toFixed(1)} km/h)`);
    }
  }

  const precipMm = hour.precipitationMm.mean ?? 0;
  const precipProb = hour.precipitationProbabilityPct.mean ?? 0;
  if (precipMm >= 10) {
    penalty += 28;
    factors.push(`Chuva forte prevista (${precipMm.toFixed(1)} mm/h)`);
  } else if (precipMm >= 1.5) {
    penalty += 15;
    factors.push(`Chuva moderada prevista (${precipMm.toFixed(1)} mm/h)`);
  } else if (precipMm >= 0.2) {
    penalty += 6;
    factors.push(`Precipitação leve (${precipMm.toFixed(1)} mm/h)`);
  }

  if (precipProb >= cfg.maxPrecipProbPct) {
    penalty += 14;
    factors.push(`Probabilidade de chuva elevada (${Math.round(precipProb)}%)`);
  } else if (precipProb >= cfg.maxPrecipProbPct * 0.75) {
    penalty += 6;
    factors.push(`Chances moderadas de chuva (${Math.round(precipProb)}%)`);
  }

  const cape = hour.capeJkg?.mean ?? null;
  if (
    hour.thunderstormRisk === 'high' ||
    (cape !== null && Number.isFinite(cape) && cape >= Math.max(1500, cfg.maxCapeJkg * 1.3))
  ) {
    penalty += 32;
    factors.push('Risco elevado de tempestade convectiva e raios');
  } else if (
    hour.thunderstormRisk === 'moderate' ||
    (cape !== null && Number.isFinite(cape) && cape >= cfg.maxCapeJkg)
  ) {
    penalty += 15;
    factors.push(
      cape !== null
        ? `Instabilidade convectiva moderada (CAPE ${Math.round(cape)} J/kg)`
        : 'Instabilidade convectiva moderada',
    );
  }

  if (hour.fogRisk) {
    penalty += 12;
    factors.push('Risco de nevoeiro denso e visibilidade reduzida');
  }

  if (hour.barometricSquallRisk) {
    penalty += 15;
    factors.push('Queda barométrica brusca (> 4 hPa/3h)');
  }

  let score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (hour.thunderstormRisk === 'high' && score > 45) {
    score = 45;
  }

  const status = scoreToStatus(score);
  const label =
    status === 'green'
      ? 'Excelente para Campo'
      : status === 'amber'
        ? 'Atenção Moderada'
        : 'Condição Restrita';

  if (factors.length === 0) {
    factors.push('Vento, temperatura e precipitação dentro da janela ideal configurada');
  }

  const summary =
    status === 'green'
      ? `Índice ${score}/100: janela favorável para atividades externas e operações de campo.`
      : status === 'amber'
        ? `Índice ${score}/100: operação viável com monitoramento (${factors[0]}).`
        : `Índice ${score}/100: restrição recomendada devido a ${factors.slice(0, 2).join(' e ').toLowerCase()}.`;

  return {
    domain: 'daily_field',
    score,
    status,
    label,
    summary,
    factors,
  };
}

/**
 * Calcula o score `0–100` e diagnóstico de qualidade para Navegação Costeira (`coastal_navigation`).
 * Aplica penalidade zero por ausência de grade marinha em pontos continentais e explicita
 * o aviso de que a cota MSL (~8 km) não substitui tábuas oficiais da DHN / Marinha.
 */
export function computeCoastalNavigationQuality(
  hour: EnsembleHour | undefined,
  marineAvailable: boolean,
  thresholds: ActivityQualityThresholds = DEFAULT_ACTIVITY_QUALITY_THRESHOLDS,
): ActivityQualityAssessment {
  if (!hour) {
    return {
      domain: 'coastal_navigation',
      score: 0,
      status: 'amber',
      label: 'Dados Indisponíveis',
      summary: 'Aguardando carregamento horário para avaliação de navegação costeira.',
      factors: ['Sem hora oceanográfica/atmosférica selecionada'],
    };
  }

  const cfg = sanitizeActivityQualityThresholds(thresholds).coastalNavigation;
  let penalty = 0;
  const factors: string[] = [];

  const hasMarineHour = marineAvailable && hour.marine !== null;
  if (hasMarineHour && hour.marine) {
    const waveM = hour.marine.waveHeight;
    if (waveM !== null && Number.isFinite(waveM)) {
      if (waveM >= cfg.maxWaveM) {
        penalty += Math.min(38, 22 + (waveM - cfg.maxWaveM) * 12);
        factors.push(`Ondas significativas acima do limite (${waveM.toFixed(2)} m)`);
      } else if (waveM >= cfg.maxWaveM * 0.75) {
        penalty += 12;
        factors.push(`Mar moderadamente agitado (${waveM.toFixed(2)} m)`);
      }
    }

    const swellM = hour.marine.swellWaveHeight;
    if (swellM !== null && Number.isFinite(swellM) && swellM >= cfg.maxWaveM * 0.9) {
      penalty += 10;
      factors.push(`Swell energético de fundo (${swellM.toFixed(2)} m)`);
    }

    const currentKmh = hour.marine.oceanCurrentVelocity;
    if (currentKmh !== null && Number.isFinite(currentKmh)) {
      if (currentKmh >= cfg.maxCurrentKmh) {
        penalty += Math.min(20, 12 + (currentKmh - cfg.maxCurrentKmh) * 4);
        factors.push(`Corrente costeira intensa (${currentKmh.toFixed(1)} km/h)`);
      } else if (currentKmh >= cfg.maxCurrentKmh * 0.75) {
        penalty += 6;
        factors.push(`Corrente costeira moderada (${currentKmh.toFixed(1)} km/h)`);
      }
    }

    if (
      hour.marine.seaLevelHeightMsl !== null &&
      hour.marine.seaLevelHeightMsl !== undefined &&
      Number.isFinite(hour.marine.seaLevelHeightMsl)
    ) {
      factors.push(
        `Cota oceânica MSL (${hour.marine.seaLevelHeightMsl >= 0 ? '+' : ''}${hour.marine.seaLevelHeightMsl.toFixed(2)} m, grade ~8 km — não substitui tábua oficial DHN/Marinha)`,
      );
    }
  } else {
    factors.push(
      'Coordenada continental sem grade oceânica costeira (sem penalidade marinha; avaliação por vento e visibilidade)',
    );
  }

  const windKmh = hour.windSpeed10m.mean;
  if (windKmh !== null && Number.isFinite(windKmh)) {
    if (windKmh >= cfg.maxWindKmh) {
      penalty += Math.min(30, 18 + (windKmh - cfg.maxWindKmh) * 0.85);
      factors.push(`Vento de superfície acima do limite (${windKmh.toFixed(1)} km/h)`);
    } else if (windKmh >= cfg.maxWindKmh * 0.75) {
      penalty += 9;
      factors.push(`Vento fresco em atenção (${windKmh.toFixed(1)} km/h)`);
    }
  }

  const gustKmh = hour.windGusts10m.mean;
  if (gustKmh !== null && Number.isFinite(gustKmh)) {
    if (gustKmh >= cfg.maxGustKmh) {
      penalty += Math.min(26, 15 + (gustKmh - cfg.maxGustKmh) * 0.6);
      factors.push(`Rajadas acima do limite náutico (${gustKmh.toFixed(1)} km/h)`);
    } else if (gustKmh >= cfg.maxGustKmh * 0.75) {
      penalty += 8;
      factors.push(`Rajadas moderadas (${gustKmh.toFixed(1)} km/h)`);
    }
  }

  const visibilityM = hour.visibilityM.mean;
  if (visibilityM !== null && Number.isFinite(visibilityM)) {
    const visibilityKm = visibilityM / 1000;
    if (visibilityKm < cfg.minVisibilityKm) {
      penalty += visibilityKm < 1 ? 24 : 14;
      factors.push(`Visibilidade horizontal restrita (${visibilityKm.toFixed(1)} km)`);
    }
  }

  if (hour.thunderstormRisk === 'high') {
    penalty += 32;
    factors.push('Risco elevado de tempestade elétrica sobre lâmina d’água');
  } else if (hour.thunderstormRisk === 'moderate') {
    penalty += 14;
    factors.push('Instabilidade convectiva moderada');
  }

  if (hour.barometricSquallRisk) {
    penalty += 16;
    factors.push('Queda barométrica brusca (> 4 hPa/3h) — risco de rondada súbita');
  }

  let score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (
    (hour.thunderstormRisk === 'high' ||
      (hasMarineHour && (hour.marine?.waveHeight ?? 0) >= cfg.maxWaveM * 1.4)) &&
    score > 45
  ) {
    score = 45;
  }

  const status = scoreToStatus(score);
  const label =
    status === 'green'
      ? 'Navegação Favorável'
      : status === 'amber'
        ? 'Navegação com Cautela'
        : 'Navegação Restrita';

  if (penalty === 0 && hasMarineHour) {
    factors.unshift('Ondas, correntes, vento e visibilidade dentro dos limites operacionais');
  }

  const summary = !hasMarineHour
    ? `Índice ${score}/100 (ponto continental sem grade costeira): condições avaliadas por vento e visibilidade.`
    : status === 'green'
      ? `Índice ${score}/100: mar e vento favoráveis à navegação costeira (consulte sempre a tábua oficial DHN/Marinha).`
      : status === 'amber'
        ? `Índice ${score}/100: atenção costeira recomendada para embarcações miúdas (MSL ~8 km não substitui DHN/Marinha).`
        : `Índice ${score}/100: condição marítima adversa — ${factors[0] ?? 'acima dos limites seguros'}.`;

  return {
    domain: 'coastal_navigation',
    score,
    status,
    label,
    summary,
    factors,
  };
}
