import { buildLocationKey } from '../db/database';
import type { ActiveCoordinates } from '../types/field';
import { GroundTruthExportPackageSchema } from '../types/schemas';
import type {
  GroundTruthExportPackage,
  GroundTruthModelPrediction,
  GroundTruthObservation,
  GroundTruthRainClass,
  GroundTruthWindFeel,
  ModelSkillMetrics,
  RegionalCalibrationResult,
} from '../types/v4';
import {
  WEATHER_MODELS,
  type EnsembleHour,
  type NormalizedForecast,
  type ScalarStat,
  type WeatherModelId,
} from '../types/weather';
import { computeWeightedModelScalarStat } from './ensembleMath';
import { haversineDistanceKm } from './exporters';
import { findCurrentLocalHourIndex } from './localTimeHour';

export const MIN_CALIBRATION_SAMPLES = 10;
export const GROUND_TRUTH_SCHEMA_VERSION = 'fieldcast-gt-v1' as const;
export const CALIBRATION_PREF_STORAGE_KEY = 'fieldcast_use_calibrated_model_v43';

const UNIFORM_MODEL_WEIGHT = 1 / WEATHER_MODELS.length;
const MIN_CALIBRATED_WEIGHT = 0.1;
const MAX_CALIBRATED_WEIGHT = 0.5;
const LIVE_DIVERGENCE_MAX_AGE_MINUTES = 90;
const LIVE_DIVERGENCE_MAX_DISTANCE_KM = 20;

const WIND_FEEL_ESTIMATED_KMH: Record<GroundTruthWindFeel, number> = {
  calm: 3,
  light: 12,
  moderate: 25,
  strong: 42,
  gale: 62,
};

const RAIN_CLASS_LABEL_PT: Record<GroundTruthRainClass, string> = {
  none: 'Sem chuva (tempo seco)',
  light: 'Chuva fraca / garoa',
  moderate: 'Chuva moderada',
  heavy: 'Chuva forte / pancada intensa',
};

const RAIN_CLASS_LABEL_EN: Record<GroundTruthRainClass, string> = {
  none: 'No rain (dry)',
  light: 'Light rain / drizzle',
  moderate: 'Moderate rain',
  heavy: 'Heavy rain / downpour',
};

const WIND_FEEL_LABEL_PT: Record<GroundTruthWindFeel, string> = {
  calm: 'Calmo (< 6 km/h)',
  light: 'Brisa fraca (~12 km/h)',
  moderate: 'Vento moderado (~25 km/h)',
  strong: 'Vento forte (~42 km/h)',
  gale: 'Ventania (> 55 km/h)',
};

const WIND_FEEL_LABEL_EN: Record<GroundTruthWindFeel, string> = {
  calm: 'Calm (< 6 km/h)',
  light: 'Light breeze (~12 km/h)',
  moderate: 'Moderate wind (~25 km/h)',
  strong: 'Strong wind (~42 km/h)',
  gale: 'Gale (> 55 km/h)',
};

let memoryCalibratedModelPref = false;

/**
 * Carrega a preferência persistida do usuário para o modo de ensemble calibrado por Ground-Truth.
 */
export function loadUseCalibratedModelPref(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(CALIBRATION_PREF_STORAGE_KEY);
      if (raw !== null) {
        memoryCalibratedModelPref = raw === 'true';
        return memoryCalibratedModelPref;
      }
    }
  } catch {
    // Fallback em memória em ambientes privados/headless
  }
  return memoryCalibratedModelPref;
}

/**
 * Persiste a preferência do usuário para ativação do modo de ensemble calibrado.
 */
export function saveUseCalibratedModelPref(enabled: boolean): boolean {
  const normalized = Boolean(enabled);
  memoryCalibratedModelPref = normalized;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CALIBRATION_PREF_STORAGE_KEY, String(normalized));
    }
  } catch {
    // Mantém fallback em memória
  }
  return normalized;
}

/**
 * Gera chave de macro-região (~0.5° ≈ 55 km) para indexação eficiente no IndexedDB.
 */
export function buildRegionKey(latitude: number, longitude: number): string {
  const latBucket = (Math.round(latitude * 2) / 2).toFixed(1);
  const lonBucket = (Math.round(longitude * 2) / 2).toFixed(1);
  return `${latBucket},${lonBucket}`;
}

export interface CreateGroundTruthObservationInput {
  id?: string;
  latitude: number;
  longitude: number;
  locationName: string;
  rainClass: GroundTruthRainClass;
  windFeel: GroundTruthWindFeel;
  measuredWindKmh?: number | null;
  measuredTempC?: number | null;
  measuredWaveM?: number | null;
  note?: string;
  photoDataUrl?: string;
  photoMimeType?: 'image/webp' | 'image/jpeg';
  photoSizeKb?: number;
  forecast?: NormalizedForecast | null;
  now?: Date;
  sourceDeviceLabel?: string;
}

function sanitizeFiniteOrNull(val: number | null | undefined): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

/**
 * Cria um registro pareado de Ground-Truth capturando a observação de campo
 * junto às previsões dos 4 modelos NWP (`ecmwf_ifs025`, `gfs_seamless`, `icon_seamless`, `gem_seamless`)
 * na hora local atual `t0` — mantendo foto estritamente opcional.
 */
export function createGroundTruthObservation(
  input: CreateGroundTruthObservationInput,
): GroundTruthObservation {
  const now = input.now ?? new Date();
  const timestampUtcIso = now.toISOString();
  const timestampUnix = Math.floor(now.getTime() / 1000);
  const id =
    input.id?.trim() ||
    `gt-${timestampUnix}-${Math.random().toString(36).slice(2, 8)}`;

  const modelPredictions: Partial<Record<WeatherModelId, GroundTruthModelPrediction>> = {};
  let ensembleWindKmh: number | null = null;
  let ensembleTempC: number | null = null;
  let ensemblePrecipMm: number | null = null;
  let ensemblePrecipProbPct: number | null = null;

  const forecast = input.forecast;
  if (forecast && forecast.hours.length > 0) {
    const t0Idx = findCurrentLocalHourIndex(forecast.hours, forecast.timezone, now);
    const hour = forecast.hours[t0Idx] ?? forecast.hours[0]!;

    ensembleWindKmh = sanitizeFiniteOrNull(hour.windSpeed10m.mean);
    ensembleTempC = sanitizeFiniteOrNull(hour.temperature2mC.mean);
    ensemblePrecipMm = sanitizeFiniteOrNull(hour.precipitationMm.mean);
    ensemblePrecipProbPct = sanitizeFiniteOrNull(hour.precipitationProbabilityPct.mean);

    for (const model of WEATHER_MODELS) {
      const nativeSeries = forecast.nativeByModel[model];
      const nativeHour =
        nativeSeries?.find((h) => h.timestampUnix === hour.timestampUnix) ??
        nativeSeries?.[t0Idx];

      const windSpeed10mKmh = sanitizeFiniteOrNull(
        nativeHour?.windSpeed10m ?? hour.windSpeed10m.valuesByModel?.[model],
      );
      const windGusts10mKmh = sanitizeFiniteOrNull(
        nativeHour?.windGusts10m ?? hour.windGusts10m.valuesByModel?.[model],
      );
      const temperature2mC = sanitizeFiniteOrNull(
        nativeHour?.temperature2m ?? hour.temperature2mC.valuesByModel?.[model],
      );
      const precipitationMm = sanitizeFiniteOrNull(
        nativeHour?.precipitation ?? hour.precipitationMm.valuesByModel?.[model],
      );
      const precipitationProbPct = sanitizeFiniteOrNull(
        nativeHour?.precipitationProbability ??
          hour.precipitationProbabilityPct.valuesByModel?.[model],
      );

      if (
        windSpeed10mKmh !== null ||
        temperature2mC !== null ||
        precipitationMm !== null ||
        precipitationProbPct !== null
      ) {
        modelPredictions[model] = {
          windSpeed10mKmh,
          windGusts10mKmh,
          temperature2mC,
          precipitationMm,
          precipitationProbPct,
        };
      }
    }
  }

  const measuredWind = sanitizeFiniteOrNull(input.measuredWindKmh);
  const measuredTemp = sanitizeFiniteOrNull(input.measuredTempC);
  const measuredWave = sanitizeFiniteOrNull(input.measuredWaveM);
  const cleanNote = input.note?.trim();

  const obs: GroundTruthObservation = {
    id,
    timestampUtcIso,
    timestampUnix,
    latitude: input.latitude,
    longitude: input.longitude,
    locationKey: buildLocationKey(input.latitude, input.longitude),
    regionKey: buildRegionKey(input.latitude, input.longitude),
    locationName: input.locationName.trim() || 'Ponto de Campo',
    rainClass: input.rainClass,
    windFeel: input.windFeel,
    ...(measuredWind !== null ? { measuredWindKmh: measuredWind } : {}),
    ...(measuredTemp !== null ? { measuredTempC: measuredTemp } : {}),
    ...(measuredWave !== null ? { measuredWaveM: measuredWave } : {}),
    ...(cleanNote ? { note: cleanNote } : {}),
    ...(input.photoDataUrl ? { photoDataUrl: input.photoDataUrl } : {}),
    ...(input.photoMimeType ? { photoMimeType: input.photoMimeType } : {}),
    ...(typeof input.photoSizeKb === 'number' && Number.isFinite(input.photoSizeKb)
      ? { photoSizeKb: input.photoSizeKb }
      : {}),
    modelPredictions,
    ensembleWindKmh,
    ensembleTempC,
    ensemblePrecipMm,
    ensemblePrecipProbPct,
    ...(input.sourceDeviceLabel?.trim()
      ? { sourceDeviceLabel: input.sourceDeviceLabel.trim() }
      : {}),
  };

  return obs;
}

export interface LiveGroundTruthDivergence {
  hasDivergence: boolean;
  severity: 'info' | 'warning';
  headlinePt: string;
  headlineEn: string;
  detailPt: string;
  detailEn: string;
  distanceKm: number;
  ageMinutes: number;
  observation: GroundTruthObservation;
}

/**
 * Detecta divergência imediata em `t0` entre relatos locais recentes (`<= 90 min`, `<= 20 km`)
 * e a previsão horária ativa, retornando aviso visual sem jamais mutar as horas futuras da previsão.
 */
export function detectLiveDivergence(
  observations: readonly GroundTruthObservation[],
  activeLocation: Pick<ActiveCoordinates, 'latitude' | 'longitude'>,
  forecast: NormalizedForecast | null | undefined,
  nowUnix?: number,
): LiveGroundTruthDivergence | null {
  if (!forecast || forecast.hours.length === 0 || observations.length === 0) {
    return null;
  }

  const resolvedNowUnix = nowUnix ?? Math.floor(Date.now() / 1000);

  const recentLocal = observations
    .map((obs) => {
      const ageMinutes = (resolvedNowUnix - obs.timestampUnix) / 60;
      const distanceKm = haversineDistanceKm(
        activeLocation.latitude,
        activeLocation.longitude,
        obs.latitude,
        obs.longitude,
      );
      return { obs, ageMinutes, distanceKm };
    })
    .filter(
      (item) =>
        item.ageMinutes >= -15 &&
        item.ageMinutes <= LIVE_DIVERGENCE_MAX_AGE_MINUTES &&
        item.distanceKm <= LIVE_DIVERGENCE_MAX_DISTANCE_KM,
    )
    .sort((a, b) => b.obs.timestampUnix - a.obs.timestampUnix);

  const latest = recentLocal[0];
  if (!latest) {
    return null;
  }

  const { obs, ageMinutes, distanceKm } = latest;
  const t0Idx = findCurrentLocalHourIndex(
    forecast.hours,
    forecast.timezone,
    new Date(resolvedNowUnix * 1000),
  );
  const hour = forecast.hours[t0Idx] ?? forecast.hours[0]!;

  const reasonsPt: string[] = [];
  const reasonsEn: string[] = [];
  let isSevere = false;

  // 1. Divergência de Precipitação em t0
  const predPrecipMm = hour.precipitationMm.mean ?? 0;
  const predPrecipProb = hour.precipitationProbabilityPct.mean ?? null;
  const obsIsRaining = obs.rainClass !== 'none';

  if (obsIsRaining && predPrecipMm < 0.2 && (predPrecipProb === null || predPrecipProb < 35)) {
    reasonsPt.push(
      `Campo relata ${RAIN_CLASS_LABEL_PT[obs.rainClass].toLowerCase()}, mas o ensemble indica tempo seco (${predPrecipMm.toFixed(1)} mm/h).`,
    );
    reasonsEn.push(
      `Field reports ${RAIN_CLASS_LABEL_EN[obs.rainClass].toLowerCase()}, while ensemble forecasts dry conditions (${predPrecipMm.toFixed(1)} mm/h).`,
    );
    if (obs.rainClass === 'moderate' || obs.rainClass === 'heavy') {
      isSevere = true;
    }
  } else if (
    !obsIsRaining &&
    (predPrecipMm >= 1.0 || (predPrecipProb !== null && predPrecipProb >= 70))
  ) {
    reasonsPt.push(
      `Campo relata tempo seco, enquanto o ensemble prevê chuva ativa (${predPrecipMm.toFixed(1)} mm/h${predPrecipProb !== null ? `, ${Math.round(predPrecipProb)}%` : ''}).`,
    );
    reasonsEn.push(
      `Field reports dry weather, while ensemble forecasts active rain (${predPrecipMm.toFixed(1)} mm/h${predPrecipProb !== null ? `, ${Math.round(predPrecipProb)}%` : ''}).`,
    );
  }

  // 2. Divergência de Vento em t0
  const predWind = hour.windSpeed10m.mean;
  const obsWind =
    typeof obs.measuredWindKmh === 'number' && Number.isFinite(obs.measuredWindKmh)
      ? obs.measuredWindKmh
      : WIND_FEEL_ESTIMATED_KMH[obs.windFeel];

  if (predWind !== null && Number.isFinite(predWind)) {
    const windDiff = Math.abs(obsWind - predWind);
    const qualitativeMismatch =
      ((obs.windFeel === 'strong' || obs.windFeel === 'gale') && predWind < 18) ||
      (obs.windFeel === 'calm' && predWind >= 30);

    if (windDiff >= 15 || qualitativeMismatch) {
      const obsWindDescPt =
        obs.measuredWindKmh != null
          ? `${obs.measuredWindKmh.toFixed(1)} km/h (medido)`
          : WIND_FEEL_LABEL_PT[obs.windFeel];
      const obsWindDescEn =
        obs.measuredWindKmh != null
          ? `${obs.measuredWindKmh.toFixed(1)} km/h (measured)`
          : WIND_FEEL_LABEL_EN[obs.windFeel];

      reasonsPt.push(
        `Vento observado (${obsWindDescPt}) diverge da previsão atual (${predWind.toFixed(1)} km/h).`,
      );
      reasonsEn.push(
        `Observed wind (${obsWindDescEn}) diverges from current forecast (${predWind.toFixed(1)} km/h).`,
      );
      if (windDiff >= 20 || obs.windFeel === 'gale') {
        isSevere = true;
      }
    }
  }

  // 3. Divergência de Temperatura em t0 (quando medida)
  const predTemp = hour.temperature2mC.mean;
  if (
    typeof obs.measuredTempC === 'number' &&
    Number.isFinite(obs.measuredTempC) &&
    predTemp !== null &&
    Number.isFinite(predTemp)
  ) {
    const tempDiff = Math.abs(obs.measuredTempC - predTemp);
    if (tempDiff >= 4.0) {
      reasonsPt.push(
        `Temperatura medida (${obs.measuredTempC.toFixed(1)} °C) difere em ${tempDiff.toFixed(1)} °C da grade (${predTemp.toFixed(1)} °C).`,
      );
      reasonsEn.push(
        `Measured temperature (${obs.measuredTempC.toFixed(1)} °C) differs by ${tempDiff.toFixed(1)} °C from grid (${predTemp.toFixed(1)} °C).`,
      );
    }
  }

  if (reasonsPt.length === 0) {
    return null;
  }

  const roundedAge = Math.max(0, Math.round(ageMinutes));
  const roundedDist = Number(distanceKm.toFixed(1));

  return {
    hasDivergence: true,
    severity: isSevere ? 'warning' : 'info',
    headlinePt: `Divergência local detectada há ${roundedAge} min (${roundedDist} km)`,
    headlineEn: `Local observation divergence ${roundedAge} min ago (${roundedDist} km)`,
    detailPt: `${reasonsPt.join(' ')} (Aviso visual restrito à hora atual; horas futuras preservadas.)`,
    detailEn: `${reasonsEn.join(' ')} (Visual notice for current hour only; future hours preserved.)`,
    distanceKm: roundedDist,
    ageMinutes: roundedAge,
    observation: obs,
  };
}

function clampAndNormalizeWeights(
  rawWeights: Record<WeatherModelId, number>,
): Record<WeatherModelId, number> {
  const weights: Record<WeatherModelId, number> = { ...rawWeights };

  // Re-normalização iterativa com clamping exato em [0.10, 0.50] preservando soma = 1.0
  for (let iter = 0; iter < 10; iter++) {
    let fixedSum = 0;
    let freeSum = 0;
    const clampedFlags: Partial<Record<WeatherModelId, boolean>> = {};

    for (const m of WEATHER_MODELS) {
      if (weights[m] <= MIN_CALIBRATED_WEIGHT) {
        weights[m] = MIN_CALIBRATED_WEIGHT;
        fixedSum += MIN_CALIBRATED_WEIGHT;
        clampedFlags[m] = true;
      } else if (weights[m] >= MAX_CALIBRATED_WEIGHT) {
        weights[m] = MAX_CALIBRATED_WEIGHT;
        fixedSum += MAX_CALIBRATED_WEIGHT;
        clampedFlags[m] = true;
      } else {
        freeSum += weights[m];
      }
    }

    const targetFreeSum = 1 - fixedSum;
    if (Math.abs(freeSum - targetFreeSum) < 1e-9 || freeSum <= 0) {
      break;
    }

    const scale = targetFreeSum / freeSum;
    let anyOut = false;
    for (const m of WEATHER_MODELS) {
      if (!clampedFlags[m]) {
        weights[m] = weights[m] * scale;
        if (weights[m] < MIN_CALIBRATED_WEIGHT || weights[m] > MAX_CALIBRATED_WEIGHT) {
          anyOut = true;
        }
      }
    }

    if (!anyOut) {
      break;
    }
  }

  // Normalização final defensiva para garantir soma exata = 1.0
  const finalSum = WEATHER_MODELS.reduce((acc, m) => acc + weights[m], 0);
  if (finalSum > 0) {
    for (const m of WEATHER_MODELS) {
      weights[m] = Number((weights[m] / finalSum).toFixed(6));
    }
  }

  // Corrige eventual erro de arredondamento de 1e-6 no modelo dominante
  const roundedSum = WEATHER_MODELS.reduce((acc, m) => acc + weights[m], 0);
  const residual = Number((1 - roundedSum).toFixed(6));
  if (Math.abs(residual) > 0) {
    const adjustable =
      WEATHER_MODELS.find(
        (m) =>
          weights[m] + residual >= MIN_CALIBRATED_WEIGHT &&
          weights[m] + residual <= MAX_CALIBRATED_WEIGHT,
      ) ?? WEATHER_MODELS[0];
    weights[adjustable] = Number((weights[adjustable] + residual).toFixed(6));
  }

  return weights;
}

function estimateRainProbabilityFromPrediction(pred: GroundTruthModelPrediction): number | null {
  if (
    typeof pred.precipitationProbPct === 'number' &&
    Number.isFinite(pred.precipitationProbPct)
  ) {
    return Math.max(0, Math.min(1, pred.precipitationProbPct / 100));
  }
  if (typeof pred.precipitationMm === 'number' && Number.isFinite(pred.precipitationMm)) {
    const mm = Math.max(0, pred.precipitationMm);
    return 1 - Math.exp(-mm / 1.5);
  }
  return null;
}

/**
 * Calcula métricas regionais de skill (MAE vento/temp, bias, Brier Score de chuva)
 * e pesos calibrados por encolhimento Bayesiano (`shrinkage = n / (n + 10)`)
 * em direção ao prior uniforme `0.25`, limitados ao intervalo seguro `[0.10, 0.50]`.
 */
export function computeRegionalCalibration(
  observations: readonly GroundTruthObservation[],
  latitude: number,
  longitude: number,
  radiusKm = 35,
): RegionalCalibrationResult {
  const safeRadius = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 35;

  const regionalObs = observations.filter((obs) => {
    const dist = haversineDistanceKm(latitude, longitude, obs.latitude, obs.longitude);
    return dist <= safeRadius && Object.keys(obs.modelPredictions ?? {}).length > 0;
  });

  const sampleCount = regionalObs.length;
  const calibrationEligible = sampleCount >= MIN_CALIBRATION_SAMPLES;
  const shrinkageFactor = Number((sampleCount / (sampleCount + MIN_CALIBRATION_SAMPLES)).toFixed(4));

  const rawLikelihood: Record<WeatherModelId, number> = {
    ecmwf_ifs025: 1,
    gfs_seamless: 1,
    icon_seamless: 1,
    gem_seamless: 1,
  };

  const metricsDraft: Record<WeatherModelId, ModelSkillMetrics> = {} as Record<
    WeatherModelId,
    ModelSkillMetrics
  >;

  for (const model of WEATHER_MODELS) {
    let pairedCount = 0;
    let windAbsErrSum = 0;
    let windSignedErrSum = 0;
    let windCount = 0;

    let tempAbsErrSum = 0;
    let tempSignedErrSum = 0;
    let tempCount = 0;

    let brierSum = 0;
    let rainCount = 0;

    for (const obs of regionalObs) {
      const pred = obs.modelPredictions?.[model];
      if (!pred) continue;
      pairedCount += 1;

      const obsWind =
        typeof obs.measuredWindKmh === 'number' && Number.isFinite(obs.measuredWindKmh)
          ? obs.measuredWindKmh
          : WIND_FEEL_ESTIMATED_KMH[obs.windFeel];

      if (typeof pred.windSpeed10mKmh === 'number' && Number.isFinite(pred.windSpeed10mKmh)) {
        const err = pred.windSpeed10mKmh - obsWind;
        windAbsErrSum += Math.abs(err);
        windSignedErrSum += err;
        windCount += 1;
      }

      if (
        typeof obs.measuredTempC === 'number' &&
        Number.isFinite(obs.measuredTempC) &&
        typeof pred.temperature2mC === 'number' &&
        Number.isFinite(pred.temperature2mC)
      ) {
        const err = pred.temperature2mC - obs.measuredTempC;
        tempAbsErrSum += Math.abs(err);
        tempSignedErrSum += err;
        tempCount += 1;
      }

      const predRainProb = estimateRainProbabilityFromPrediction(pred);
      if (predRainProb !== null) {
        const obsRainBinary = obs.rainClass === 'none' ? 0 : 1;
        const diff = predRainProb - obsRainBinary;
        brierSum += diff * diff;
        rainCount += 1;
      }
    }

    const windMaeKmh = windCount > 0 ? Number((windAbsErrSum / windCount).toFixed(2)) : null;
    const windBiasKmh = windCount > 0 ? Number((windSignedErrSum / windCount).toFixed(2)) : null;
    const tempMaeC = tempCount > 0 ? Number((tempAbsErrSum / tempCount).toFixed(2)) : null;
    const tempBiasC = tempCount > 0 ? Number((tempSignedErrSum / tempCount).toFixed(2)) : null;
    const rainBrierScore = rainCount > 0 ? Number((brierSum / rainCount).toFixed(4)) : null;

    const normalizedLosses: number[] = [];
    if (windMaeKmh !== null) normalizedLosses.push(windMaeKmh / 15);
    if (tempMaeC !== null) normalizedLosses.push(tempMaeC / 3);
    if (rainBrierScore !== null) normalizedLosses.push(rainBrierScore / 0.25);

    const meanLoss =
      normalizedLosses.length > 0
        ? normalizedLosses.reduce((acc, v) => acc + v, 0) / normalizedLosses.length
        : 1;

    const compositeSkillScore =
      pairedCount > 0 ? Math.max(0, Math.min(100, Math.round(100 / (1 + meanLoss)))) : 50;

    rawLikelihood[model] = pairedCount > 0 ? 1 / (0.2 + meanLoss) : 1;

    metricsDraft[model] = {
      model,
      sampleCount: pairedCount,
      windMaeKmh,
      windBiasKmh,
      tempMaeC,
      tempBiasC,
      rainBrierScore,
      compositeSkillScore,
      weight: UNIFORM_MODEL_WEIGHT,
    };
  }

  let weightsByModel: Record<WeatherModelId, number> = {
    ecmwf_ifs025: UNIFORM_MODEL_WEIGHT,
    gfs_seamless: UNIFORM_MODEL_WEIGHT,
    icon_seamless: UNIFORM_MODEL_WEIGHT,
    gem_seamless: UNIFORM_MODEL_WEIGHT,
  };

  if (calibrationEligible) {
    const likelihoodSum = WEATHER_MODELS.reduce((acc, m) => acc + rawLikelihood[m], 0);
    const shrunk: Record<WeatherModelId, number> = {
      ecmwf_ifs025: UNIFORM_MODEL_WEIGHT,
      gfs_seamless: UNIFORM_MODEL_WEIGHT,
      icon_seamless: UNIFORM_MODEL_WEIGHT,
      gem_seamless: UNIFORM_MODEL_WEIGHT,
    };

    for (const m of WEATHER_MODELS) {
      const empiricalWeight = likelihoodSum > 0 ? rawLikelihood[m] / likelihoodSum : UNIFORM_MODEL_WEIGHT;
      shrunk[m] = (1 - shrinkageFactor) * UNIFORM_MODEL_WEIGHT + shrinkageFactor * empiricalWeight;
    }

    weightsByModel = clampAndNormalizeWeights(shrunk);
  }

  let bestModel: WeatherModelId | null = null;
  let bestScore = -1;

  for (const m of WEATHER_MODELS) {
    metricsDraft[m].weight = weightsByModel[m];
    if (metricsDraft[m].sampleCount > 0) {
      const rankMetric = calibrationEligible
        ? weightsByModel[m] * 1000 + metricsDraft[m].compositeSkillScore
        : metricsDraft[m].compositeSkillScore;
      if (rankMetric > bestScore) {
        bestScore = rankMetric;
        bestModel = m;
      }
    }
  }

  return {
    latitude,
    longitude,
    radiusKm: safeRadius,
    sampleCount,
    minRequiredSamples: MIN_CALIBRATION_SAMPLES,
    calibrationEligible,
    shrinkageFactor,
    weightsByModel,
    metricsByModel: metricsDraft,
    bestModel,
    computedAtIso: new Date().toISOString(),
  };
}

function reweightScalarStat(
  stat: ScalarStat | undefined,
  weights: Record<WeatherModelId, number>,
): ScalarStat | undefined {
  if (!stat) return undefined;
  if (!stat.valuesByModel) return { ...stat };
  return computeWeightedModelScalarStat(stat.valuesByModel, weights);
}

/**
 * Aplica os pesos regionais calibrados sobre uma cópia imutável de `NormalizedForecast`,
 * recalculando médias ponderadas horárias sem jamais alterar o objeto original.
 */
export function applyCalibratedWeightsToForecast(
  forecast: NormalizedForecast,
  calibration: RegionalCalibrationResult,
): NormalizedForecast {
  if (!calibration.calibrationEligible) {
    return {
      ...forecast,
      hours: forecast.hours.map((h) => ({ ...h })),
    };
  }

  const weights = calibration.weightsByModel;
  const reweightedHours: EnsembleHour[] = forecast.hours.map((hour) => {
    const windSpeed10m = reweightScalarStat(hour.windSpeed10m, weights) ?? hour.windSpeed10m;
    const windSpeed80m = reweightScalarStat(hour.windSpeed80m, weights) ?? hour.windSpeed80m;
    const windSpeed100m = reweightScalarStat(hour.windSpeed100m, weights) ?? hour.windSpeed100m;
    const windSpeed120m = reweightScalarStat(hour.windSpeed120m, weights) ?? hour.windSpeed120m;
    const windGusts10m = reweightScalarStat(hour.windGusts10m, weights) ?? hour.windGusts10m;
    const precipitationMm =
      reweightScalarStat(hour.precipitationMm, weights) ?? hour.precipitationMm;
    const precipitationProbabilityPct =
      reweightScalarStat(hour.precipitationProbabilityPct, weights) ??
      hour.precipitationProbabilityPct;
    const temperature2mC =
      reweightScalarStat(hour.temperature2mC, weights) ?? hour.temperature2mC;
    const dewPoint2mC = reweightScalarStat(hour.dewPoint2mC, weights) ?? hour.dewPoint2mC;
    const visibilityM = reweightScalarStat(hour.visibilityM, weights) ?? hour.visibilityM;
    const surfacePressureHpa =
      reweightScalarStat(hour.surfacePressureHpa, weights) ?? hour.surfacePressureHpa;

    const dewPointSpreadC =
      temperature2mC.mean !== null && dewPoint2mC.mean !== null
        ? Number((temperature2mC.mean - dewPoint2mC.mean).toFixed(2))
        : hour.dewPointSpreadC;

    return {
      ...hour,
      windSpeed10m,
      windSpeed80m,
      windSpeed100m,
      windSpeed120m,
      windGusts10m,
      precipitationMm,
      precipitationProbabilityPct,
      temperature2mC,
      dewPoint2mC,
      dewPointSpreadC,
      visibilityM,
      surfacePressureHpa,
      cloudCover: {
        lowPct: reweightScalarStat(hour.cloudCover.lowPct, weights) ?? hour.cloudCover.lowPct,
        midPct: reweightScalarStat(hour.cloudCover.midPct, weights) ?? hour.cloudCover.midPct,
        highPct: reweightScalarStat(hour.cloudCover.highPct, weights) ?? hour.cloudCover.highPct,
      },
      ...(hour.relativeHumidity2mPct
        ? { relativeHumidity2mPct: reweightScalarStat(hour.relativeHumidity2mPct, weights) }
        : {}),
      ...(hour.apparentTemperatureC
        ? { apparentTemperatureC: reweightScalarStat(hour.apparentTemperatureC, weights) }
        : {}),
      ...(hour.capeJkg ? { capeJkg: reweightScalarStat(hour.capeJkg, weights) } : {}),
      ...(hour.et0FaoMm ? { et0FaoMm: reweightScalarStat(hour.et0FaoMm, weights) } : {}),
    };
  });

  return {
    ...forecast,
    hours: reweightedHours,
  };
}

/**
 * Serializa observações Ground-Truth em pacote JSON versionado para troca peer-to-peer offline.
 */
export function serializeGroundTruthPackage(
  observations: readonly GroundTruthObservation[],
  sourceLabel?: string,
): string {
  const pkg: GroundTruthExportPackage = {
    schemaVersion: GROUND_TRUTH_SCHEMA_VERSION,
    exportedAtIso: new Date().toISOString(),
    ...(sourceLabel?.trim() ? { sourceLabel: sourceLabel.trim() } : {}),
    observationCount: observations.length,
    observations: observations.map((obs) => ({
      ...obs,
      modelPredictions: { ...obs.modelPredictions },
    })),
  };
  return JSON.stringify(pkg, null, 2);
}

/**
 * Faz o parse e validação estrita via Zod de um pacote JSON peer-to-peer de observações Ground-Truth.
 */
export function parseAndValidateGroundTruthPackage(rawJson: string): GroundTruthExportPackage {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch {
    throw new Error(
      'Arquivo JSON de Ground-Truth inválido ou corrompido (falha de sintaxe JSON).',
    );
  }

  const result = GroundTruthExportPackageSchema.safeParse(parsedJson);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const detail = firstIssue
      ? `${firstIssue.path.join('.') || 'root'}: ${firstIssue.message}`
      : 'estrutura incompatível';
    throw new Error(`Pacote Ground-Truth incompatível com schema fieldcast-gt-v1 (${detail}).`);
  }

  return {
    ...result.data,
    observationCount: result.data.observations.length,
  };
}
