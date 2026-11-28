import { buildLocationKey } from '../db/database';
import type { ActiveCoordinates } from '../types/field';
import { GroundTruthExportPackageSchema } from '../types/schemas';
import type {
  GroundTruthExportPackage,
  GroundTruthModelPrediction,
  GroundTruthObservation,
  GroundTruthRainClass,
  GroundTruthRelativeRating,
  GroundTruthSkyCoverClass,
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
export const GROUND_TRUTH_COOLDOWN_MINUTES = 30;
export const OBJECTIVE_EVIDENCE_WEIGHT = 1.0;
export const PERCEPTUAL_EVIDENCE_WEIGHT = 0.5;

const UNIFORM_MODEL_WEIGHT = 1 / WEATHER_MODELS.length;
const MIN_CALIBRATED_WEIGHT = 0.1;
const MAX_CALIBRATED_WEIGHT = 0.5;
const LIVE_DIVERGENCE_MAX_AGE_MINUTES = 90;
const LIVE_DIVERGENCE_MAX_DISTANCE_KM = 20;
const COOLDOWN_SAME_LOCATION_KM = 2.0;

const WIND_FEEL_ESTIMATED_KMH: Record<GroundTruthWindFeel, number> = {
  calm: 3,
  light: 12,
  moderate: 25,
  strong: 42,
  gale: 62,
};

const SKY_COVER_TARGET_FRACTION: Record<GroundTruthSkyCoverClass, number> = {
  clear: 0.1,
  partly_cloudy: 0.5,
  overcast: 0.9,
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

const SKY_COVER_LABEL_PT: Record<GroundTruthSkyCoverClass, string> = {
  clear: 'Ensolarado / Céu limpo',
  partly_cloudy: 'Parcialmente nublado',
  overcast: 'Nublado / Encoberto',
};

const SKY_COVER_LABEL_EN: Record<GroundTruthSkyCoverClass, string> = {
  clear: 'Clear / Sunny',
  partly_cloudy: 'Partly Cloudy',
  overcast: 'Overcast',
};

const RELATIVE_RATING_LABEL_PT: Record<GroundTruthRelativeRating, string> = {
  [-2]: 'muito abaixo do previsto (-2)',
  [-1]: 'abaixo do previsto (-1)',
  [0]: 'conforme previsto (0)',
  [1]: 'acima do previsto (+1)',
  [2]: 'muito acima do previsto (+2)',
};

const RELATIVE_RATING_LABEL_EN: Record<GroundTruthRelativeRating, string> = {
  [-2]: 'much lower than forecast (-2)',
  [-1]: 'lower than forecast (-1)',
  [0]: 'as forecast (0)',
  [1]: 'higher than forecast (+1)',
  [2]: 'much higher than forecast (+2)',
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

function sanitizeFiniteOrNull(val: number | null | undefined): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function computeCombinedCloudPct(
  low: number | null | undefined,
  mid: number | null | undefined,
  high: number | null | undefined,
): number | null {
  const vals = [low, mid, high].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  return Math.max(0, Math.min(100, Math.round(Math.max(...vals))));
}

/**
 * Classifica cobertura de nuvens (%) em classe visual objetiva de céu.
 */
export function classifySkyCoverFromCloudPct(
  cloudPct: number | null | undefined,
): GroundTruthSkyCoverClass {
  if (cloudPct === null || cloudPct === undefined || !Number.isFinite(cloudPct)) {
    return 'partly_cloudy';
  }
  if (cloudPct < 25) return 'clear';
  if (cloudPct < 70) return 'partly_cloudy';
  return 'overcast';
}

/**
 * Estima a sensação categórica de vento (`windFeel`) a partir da previsão em `t0`
 * combinada à classificação ordinal relativa (`-2..+2`), garantindo retrocompatibilidade.
 */
export function deriveWindFeelFromRelativeRating(
  predictedWindKmh: number | null | undefined,
  rating: GroundTruthRelativeRating,
): GroundTruthWindFeel {
  const base =
    typeof predictedWindKmh === 'number' && Number.isFinite(predictedWindKmh)
      ? predictedWindKmh
      : 15;
  const multipliers: Record<GroundTruthRelativeRating, number> = {
    [-2]: 0.35,
    [-1]: 0.7,
    [0]: 1.0,
    [1]: 1.4,
    [2]: 1.85,
  };
  const adjusted = Math.max(0, base * multipliers[rating] + (rating > 0 ? rating * 4 : rating * 3));
  if (adjusted < 7) return 'calm';
  if (adjusted < 18) return 'light';
  if (adjusted < 33) return 'moderate';
  if (adjusted < 52) return 'strong';
  return 'gale';
}

export interface T0ForecastReference {
  hourIndex: number;
  timestampUnix: number;
  temperature2mC: number | null;
  windSpeed10mKmh: number | null;
  windGusts10mKmh: number | null;
  precipitationMm: number | null;
  precipitationProbPct: number | null;
  cloudCoverPct: number | null;
  skyCoverClass: GroundTruthSkyCoverClass;
}

/**
 * Extrai a referência consolidada de `t0` (hora local atual) para o cartão âncora do modal
 * e pareamento com os modelos globais.
 */
export function extractT0ForecastReference(
  forecast: NormalizedForecast | null | undefined,
  now: Date = new Date(),
): T0ForecastReference | null {
  if (!forecast || forecast.hours.length === 0) {
    return null;
  }
  const t0Idx = findCurrentLocalHourIndex(forecast.hours, forecast.timezone, now);
  const hour = forecast.hours[t0Idx] ?? forecast.hours[0]!;
  const cloudCoverPct = computeCombinedCloudPct(
    hour.cloudCover?.lowPct?.mean,
    hour.cloudCover?.midPct?.mean,
    hour.cloudCover?.highPct?.mean,
  );

  return {
    hourIndex: t0Idx,
    timestampUnix: hour.timestampUnix,
    temperature2mC: sanitizeFiniteOrNull(hour.temperature2mC.mean),
    windSpeed10mKmh: sanitizeFiniteOrNull(hour.windSpeed10m.mean),
    windGusts10mKmh: sanitizeFiniteOrNull(hour.windGusts10m.mean),
    precipitationMm: sanitizeFiniteOrNull(hour.precipitationMm.mean),
    precipitationProbPct: sanitizeFiniteOrNull(hour.precipitationProbabilityPct.mean),
    cloudCoverPct,
    skyCoverClass: classifySkyCoverFromCloudPct(cloudCoverPct),
  };
}

export interface GroundTruthCooldownStatus {
  isCoolingDown: boolean;
  remainingMinutes: number;
  remainingSeconds: number;
  lastObservation: GroundTruthObservation | null;
}

function isSameCooldownLocation(
  latA: number,
  lonA: number,
  keyA: string,
  obs: GroundTruthObservation,
): boolean {
  if (obs.locationKey === keyA) return true;
  return haversineDistanceKm(latA, lonA, obs.latitude, obs.longitude) <= COOLDOWN_SAME_LOCATION_KM;
}

/**
 * Verifica guarda de cooldown por localidade (padrão 30 min) para impedir spam de duplicatas
 * que inflaria artificialmente `n` ou distorceria a calibração.
 */
export function checkGroundTruthCooldown(
  observations: readonly GroundTruthObservation[],
  latitude: number,
  longitude: number,
  nowUnix?: number,
  cooldownMinutes = GROUND_TRUTH_COOLDOWN_MINUTES,
): GroundTruthCooldownStatus {
  const safeCooldownMin =
    Number.isFinite(cooldownMinutes) && cooldownMinutes > 0
      ? cooldownMinutes
      : GROUND_TRUTH_COOLDOWN_MINUTES;
  const cooldownSec = safeCooldownMin * 60;
  const resolvedNowUnix = nowUnix ?? Math.floor(Date.now() / 1000);
  const targetKey = buildLocationKey(latitude, longitude);

  let latestSameLoc: GroundTruthObservation | null = null;
  for (const obs of observations) {
    if (!isSameCooldownLocation(latitude, longitude, targetKey, obs)) {
      continue;
    }
    const elapsedSec = resolvedNowUnix - obs.timestampUnix;
    if (elapsedSec >= 0 && elapsedSec < cooldownSec) {
      if (!latestSameLoc || obs.timestampUnix > latestSameLoc.timestampUnix) {
        latestSameLoc = obs;
      }
    }
  }

  if (!latestSameLoc) {
    return {
      isCoolingDown: false,
      remainingMinutes: 0,
      remainingSeconds: 0,
      lastObservation: null,
    };
  }

  const remainingSeconds = Math.max(0, Math.ceil(cooldownSec - (resolvedNowUnix - latestSameLoc.timestampUnix)));
  return {
    isCoolingDown: remainingSeconds > 0,
    remainingMinutes: Math.max(1, Math.ceil(remainingSeconds / 60)),
    remainingSeconds,
    lastObservation: latestSameLoc,
  };
}

export interface CreateGroundTruthObservationInput {
  id?: string;
  latitude: number;
  longitude: number;
  locationName: string;
  rainClass: GroundTruthRainClass;
  windFeel?: GroundTruthWindFeel;
  skyCoverClass?: GroundTruthSkyCoverClass;
  tempRelativeRating?: GroundTruthRelativeRating | null;
  windRelativeRating?: GroundTruthRelativeRating | null;
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

/**
 * Cria um registro pareado de Ground-Truth capturando a observação de campo
 * (classes visuais objetivas + classificação ordinal ancorada `-2..+2` + medições instrumentais opcionais)
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
  let ensembleCloudCoverPct: number | null = null;

  const forecast = input.forecast;
  if (forecast && forecast.hours.length > 0) {
    const t0Idx = findCurrentLocalHourIndex(forecast.hours, forecast.timezone, now);
    const hour = forecast.hours[t0Idx] ?? forecast.hours[0]!;

    ensembleWindKmh = sanitizeFiniteOrNull(hour.windSpeed10m.mean);
    ensembleTempC = sanitizeFiniteOrNull(hour.temperature2mC.mean);
    ensemblePrecipMm = sanitizeFiniteOrNull(hour.precipitationMm.mean);
    ensemblePrecipProbPct = sanitizeFiniteOrNull(hour.precipitationProbabilityPct.mean);
    ensembleCloudCoverPct = computeCombinedCloudPct(
      hour.cloudCover?.lowPct?.mean,
      hour.cloudCover?.midPct?.mean,
      hour.cloudCover?.highPct?.mean,
    );

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
      const cloudCoverPct = computeCombinedCloudPct(
        nativeHour?.cloudCoverLow ?? hour.cloudCover?.lowPct?.valuesByModel?.[model],
        nativeHour?.cloudCoverMid ?? hour.cloudCover?.midPct?.valuesByModel?.[model],
        nativeHour?.cloudCoverHigh ?? hour.cloudCover?.highPct?.valuesByModel?.[model],
      );

      if (
        windSpeed10mKmh !== null ||
        temperature2mC !== null ||
        precipitationMm !== null ||
        precipitationProbPct !== null ||
        cloudCoverPct !== null
      ) {
        modelPredictions[model] = {
          windSpeed10mKmh,
          windGusts10mKmh,
          temperature2mC,
          precipitationMm,
          precipitationProbPct,
          ...(cloudCoverPct !== null ? { cloudCoverPct } : {}),
        };
      }
    }
  }

  const measuredWind = sanitizeFiniteOrNull(input.measuredWindKmh);
  const measuredTemp = sanitizeFiniteOrNull(input.measuredTempC);
  const measuredWave = sanitizeFiniteOrNull(input.measuredWaveM);
  const cleanNote = input.note?.trim();

  const resolvedWindFeel: GroundTruthWindFeel =
    input.windFeel ??
    (input.windRelativeRating !== undefined && input.windRelativeRating !== null
      ? deriveWindFeelFromRelativeRating(ensembleWindKmh, input.windRelativeRating)
      : 'light');

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
    windFeel: resolvedWindFeel,
    ...(input.skyCoverClass ? { skyCoverClass: input.skyCoverClass } : {}),
    ...(input.tempRelativeRating !== undefined && input.tempRelativeRating !== null
      ? { tempRelativeRating: input.tempRelativeRating }
      : {}),
    ...(input.windRelativeRating !== undefined && input.windRelativeRating !== null
      ? { windRelativeRating: input.windRelativeRating }
      : {}),
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
    ...(ensembleCloudCoverPct !== null ? { ensembleCloudCoverPct } : {}),
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

  // 1. Divergência de Precipitação em t0 (classe visual objetiva)
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

  // 2. Divergência de Céu / Nuvens em t0 (classe visual objetiva)
  const predCloudPct = computeCombinedCloudPct(
    hour.cloudCover?.lowPct?.mean,
    hour.cloudCover?.midPct?.mean,
    hour.cloudCover?.highPct?.mean,
  );
  if (obs.skyCoverClass && predCloudPct !== null) {
    if (obs.skyCoverClass === 'clear' && predCloudPct >= 80) {
      reasonsPt.push(
        `Campo relata ${SKY_COVER_LABEL_PT.clear.toLowerCase()}, enquanto a grade indica céu encoberto (${predCloudPct}% nuvens).`,
      );
      reasonsEn.push(
        `Field reports ${SKY_COVER_LABEL_EN.clear.toLowerCase()}, while the grid indicates overcast skies (${predCloudPct}% clouds).`,
      );
    } else if (obs.skyCoverClass === 'overcast' && predCloudPct <= 15) {
      reasonsPt.push(
        `Campo relata ${SKY_COVER_LABEL_PT.overcast.toLowerCase()}, enquanto a grade prevê céu limpo (${predCloudPct}% nuvens).`,
      );
      reasonsEn.push(
        `Field reports ${SKY_COVER_LABEL_EN.overcast.toLowerCase()}, while the grid forecasts clear skies (${predCloudPct}% clouds).`,
      );
    }
  }

  // 3. Divergência de Vento em t0 (medição exata, rating ordinal extremo ou legado windFeel)
  const predWind = hour.windSpeed10m.mean;
  if (typeof obs.measuredWindKmh === 'number' && Number.isFinite(obs.measuredWindKmh)) {
    if (predWind !== null && Number.isFinite(predWind)) {
      const windDiff = Math.abs(obs.measuredWindKmh - predWind);
      if (windDiff >= 15) {
        reasonsPt.push(
          `Vento medido (${obs.measuredWindKmh.toFixed(1)} km/h) diverge da previsão atual (${predWind.toFixed(1)} km/h).`,
        );
        reasonsEn.push(
          `Measured wind (${obs.measuredWindKmh.toFixed(1)} km/h) diverges from current forecast (${predWind.toFixed(1)} km/h).`,
        );
        if (windDiff >= 20) isSevere = true;
      }
    }
  } else if (obs.windRelativeRating !== undefined && obs.windRelativeRating !== null) {
    if (Math.abs(obs.windRelativeRating) >= 2) {
      reasonsPt.push(
        `Observador indica vento ${RELATIVE_RATING_LABEL_PT[obs.windRelativeRating]}.`,
      );
      reasonsEn.push(
        `Observer reports wind ${RELATIVE_RATING_LABEL_EN[obs.windRelativeRating]}.`,
      );
      if (obs.windRelativeRating === 2) isSevere = true;
    }
  } else if (predWind !== null && Number.isFinite(predWind)) {
    const obsWind = WIND_FEEL_ESTIMATED_KMH[obs.windFeel];
    const windDiff = Math.abs(obsWind - predWind);
    const qualitativeMismatch =
      ((obs.windFeel === 'strong' || obs.windFeel === 'gale') && predWind < 18) ||
      (obs.windFeel === 'calm' && predWind >= 30);

    if (windDiff >= 15 || qualitativeMismatch) {
      reasonsPt.push(
        `Vento observado (${WIND_FEEL_LABEL_PT[obs.windFeel]}) diverge da previsão atual (${predWind.toFixed(1)} km/h).`,
      );
      reasonsEn.push(
        `Observed wind (${WIND_FEEL_LABEL_EN[obs.windFeel]}) diverges from current forecast (${predWind.toFixed(1)} km/h).`,
      );
      if (windDiff >= 20 || obs.windFeel === 'gale') {
        isSevere = true;
      }
    }
  }

  // 4. Divergência de Temperatura em t0 (medição exata ou rating ordinal extremo)
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
  } else if (
    obs.tempRelativeRating !== undefined &&
    obs.tempRelativeRating !== null &&
    Math.abs(obs.tempRelativeRating) >= 2
  ) {
    reasonsPt.push(
      `Observador indica temperatura ${RELATIVE_RATING_LABEL_PT[obs.tempRelativeRating]}.`,
    );
    reasonsEn.push(
      `Observer reports temperature ${RELATIVE_RATING_LABEL_EN[obs.tempRelativeRating]}.`,
    );
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
 * Deduplica observações dentro de janelas de `cooldownMinutes` (30 min) para uma mesma
 * localidade (`locationKey` ou distância <= 2 km), mantendo apenas o registro mais recente
 * de cada janela — impedindo spam de duplicatas que inflariam `n`.
 */
function deduplicateRegionalObservationsWithCooldown(
  regionalObs: readonly GroundTruthObservation[],
  cooldownMinutes: number,
): GroundTruthObservation[] {
  const cooldownSec = cooldownMinutes * 60;
  const sortedAsc = [...regionalObs].sort((a, b) => a.timestampUnix - b.timestampUnix);
  const kept: GroundTruthObservation[] = [];

  for (const obs of sortedAsc) {
    let replacedIdx = -1;
    for (let i = kept.length - 1; i >= 0; i--) {
      const prev = kept[i]!;
      if (obs.timestampUnix - prev.timestampUnix >= cooldownSec) {
        break;
      }
      if (isSameCooldownLocation(obs.latitude, obs.longitude, obs.locationKey, prev)) {
        replacedIdx = i;
        break;
      }
    }
    if (replacedIdx >= 0) {
      kept[replacedIdx] = obs;
    } else {
      kept.push(obs);
    }
  }

  return kept;
}

/**
 * Calcula perda ordinal direcional (`0.0` = melhor alinhamento com a direção informada,
 * `0.5` = neutro no consenso, `1.0` = direção oposta) comparando o modelo `predValue`
 * com o consenso (`ensembleRef`) e a dispersão entre os 4 modelos no instante `t0`.
 * Evita viés de escala absoluta entre observadores sem instrumento.
 */
function computeOrdinalDirectionalLoss(
  predValue: number,
  ensembleRef: number,
  peerValues: readonly number[],
  rating: GroundTruthRelativeRating,
  minScale: number,
): number {
  const maxAbsDev = peerValues.reduce(
    (maxDev, v) => Math.max(maxDev, Math.abs(v - ensembleRef)),
    0,
  );
  const scale = Math.max(minScale, maxAbsDev);
  const signedPos = Math.max(-1, Math.min(1, (predValue - ensembleRef) / scale));

  if (rating === 0) {
    // Conforme previsto: premia modelos próximos ao consenso exibido
    return Math.abs(signedPos);
  }

  // Direção real (+1/+2 = acima do previsto; -1/-2 = abaixo do previsto)
  const dir = rating > 0 ? 1 : -1;
  const directionalAlignment = Math.max(-1, Math.min(1, signedPos * dir));
  const baseLoss = (1 - directionalAlignment) / 2; // 0 (extremo na direção certa) .. 1 (direção oposta)

  // Para ±2 ("Muito acima / Muito abaixo"), acentua suavemente a penalidade de modelos na direção errada
  if (Math.abs(rating) === 2) {
    return Math.min(1, Math.pow(baseLoss, 0.85));
  }
  return baseLoss;
}

/**
 * Calcula métricas regionais de skill (MAE/Viés instrumental, Brier de chuva e céu,
 * alinhamento ordinal direcional com mitigação de viés do observador) e pesos calibrados
 * por encolhimento Bayesiano (`shrinkage = n / (n + 10)`) em direção ao prior uniforme `0.25`,
 * limitados ao intervalo seguro `[0.10, 0.50]` e protegidos por cooldown de 30 min por localidade.
 */
export function computeRegionalCalibration(
  observations: readonly GroundTruthObservation[],
  latitude: number,
  longitude: number,
  radiusKm = 35,
  cooldownMinutes = GROUND_TRUTH_COOLDOWN_MINUTES,
): RegionalCalibrationResult {
  const safeRadius = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 35;
  const safeCooldown =
    Number.isFinite(cooldownMinutes) && cooldownMinutes > 0
      ? cooldownMinutes
      : GROUND_TRUTH_COOLDOWN_MINUTES;

  const rawRegionalObs = observations.filter((obs) => {
    const dist = haversineDistanceKm(latitude, longitude, obs.latitude, obs.longitude);
    return dist <= safeRadius && Object.keys(obs.modelPredictions ?? {}).length > 0;
  });

  const regionalObs = deduplicateRegionalObservationsWithCooldown(rawRegionalObs, safeCooldown);

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

    let skyBrierSum = 0;
    let skyCount = 0;

    let ordinalLossSum = 0;
    let ordinalCount = 0;

    let weightedLossSum = 0;
    let totalEvidenceWeight = 0;

    for (const obs of regionalObs) {
      const pred = obs.modelPredictions?.[model];
      if (!pred) continue;
      pairedCount += 1;

      // 1. Precipitação (classe visual objetiva -> peso de evidência 1.0)
      const predRainProb = estimateRainProbabilityFromPrediction(pred);
      if (predRainProb !== null) {
        const obsRainBinary = obs.rainClass === 'none' ? 0 : 1;
        const diff = predRainProb - obsRainBinary;
        const brier = diff * diff;
        brierSum += brier;
        rainCount += 1;

        weightedLossSum += (brier / 0.25) * OBJECTIVE_EVIDENCE_WEIGHT;
        totalEvidenceWeight += OBJECTIVE_EVIDENCE_WEIGHT;
      }

      // 2. Cobertura de Nuvens / Céu (classe visual objetiva -> peso de evidência 1.0)
      if (
        obs.skyCoverClass &&
        typeof pred.cloudCoverPct === 'number' &&
        Number.isFinite(pred.cloudCoverPct)
      ) {
        const predCloudFrac = Math.max(0, Math.min(1, pred.cloudCoverPct / 100));
        const targetCloudFrac = SKY_COVER_TARGET_FRACTION[obs.skyCoverClass];
        const skyErr = (predCloudFrac - targetCloudFrac) ** 2;
        skyBrierSum += skyErr;
        skyCount += 1;

        weightedLossSum += (skyErr / 0.2) * OBJECTIVE_EVIDENCE_WEIGHT;
        totalEvidenceWeight += OBJECTIVE_EVIDENCE_WEIGHT;
      }

      // 3. Vento: instrumental exato (peso 1.0) OU ordinal direcional ancorado (peso 0.5) OU windFeel legado (peso 0.5)
      if (typeof pred.windSpeed10mKmh === 'number' && Number.isFinite(pred.windSpeed10mKmh)) {
        if (typeof obs.measuredWindKmh === 'number' && Number.isFinite(obs.measuredWindKmh)) {
          const err = pred.windSpeed10mKmh - obs.measuredWindKmh;
          windAbsErrSum += Math.abs(err);
          windSignedErrSum += err;
          windCount += 1;

          weightedLossSum += (Math.abs(err) / 15) * OBJECTIVE_EVIDENCE_WEIGHT;
          totalEvidenceWeight += OBJECTIVE_EVIDENCE_WEIGHT;
        } else if (obs.windRelativeRating !== undefined && obs.windRelativeRating !== null) {
          const peerWinds = WEATHER_MODELS.map(
            (mId) => obs.modelPredictions?.[mId]?.windSpeed10mKmh,
          ).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          const ensWindRef =
            typeof obs.ensembleWindKmh === 'number' && Number.isFinite(obs.ensembleWindKmh)
              ? obs.ensembleWindKmh
              : peerWinds.length > 0
                ? peerWinds.reduce((a, b) => a + b, 0) / peerWinds.length
                : pred.windSpeed10mKmh;

          const ordLoss = computeOrdinalDirectionalLoss(
            pred.windSpeed10mKmh,
            ensWindRef,
            peerWinds,
            obs.windRelativeRating,
            4.0,
          );
          ordinalLossSum += ordLoss;
          ordinalCount += 1;

          weightedLossSum += ordLoss * PERCEPTUAL_EVIDENCE_WEIGHT;
          totalEvidenceWeight += PERCEPTUAL_EVIDENCE_WEIGHT;
        } else {
          // Compatibilidade com observações legadas (windFeel qualitativo -> peso atenuado 0.5)
          const estWind = WIND_FEEL_ESTIMATED_KMH[obs.windFeel];
          const err = pred.windSpeed10mKmh - estWind;
          windAbsErrSum += Math.abs(err);
          windSignedErrSum += err;
          windCount += 1;

          weightedLossSum += (Math.abs(err) / 15) * PERCEPTUAL_EVIDENCE_WEIGHT;
          totalEvidenceWeight += PERCEPTUAL_EVIDENCE_WEIGHT;
        }
      }

      // 4. Temperatura: instrumental exato (peso 1.0) OU ordinal direcional ancorado (peso 0.5)
      if (typeof pred.temperature2mC === 'number' && Number.isFinite(pred.temperature2mC)) {
        if (typeof obs.measuredTempC === 'number' && Number.isFinite(obs.measuredTempC)) {
          const err = pred.temperature2mC - obs.measuredTempC;
          tempAbsErrSum += Math.abs(err);
          tempSignedErrSum += err;
          tempCount += 1;

          weightedLossSum += (Math.abs(err) / 3) * OBJECTIVE_EVIDENCE_WEIGHT;
          totalEvidenceWeight += OBJECTIVE_EVIDENCE_WEIGHT;
        } else if (obs.tempRelativeRating !== undefined && obs.tempRelativeRating !== null) {
          const peerTemps = WEATHER_MODELS.map(
            (mId) => obs.modelPredictions?.[mId]?.temperature2mC,
          ).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          const ensTempRef =
            typeof obs.ensembleTempC === 'number' && Number.isFinite(obs.ensembleTempC)
              ? obs.ensembleTempC
              : peerTemps.length > 0
                ? peerTemps.reduce((a, b) => a + b, 0) / peerTemps.length
                : pred.temperature2mC;

          const ordLoss = computeOrdinalDirectionalLoss(
            pred.temperature2mC,
            ensTempRef,
            peerTemps,
            obs.tempRelativeRating,
            1.0,
          );
          ordinalLossSum += ordLoss;
          ordinalCount += 1;

          weightedLossSum += ordLoss * PERCEPTUAL_EVIDENCE_WEIGHT;
          totalEvidenceWeight += PERCEPTUAL_EVIDENCE_WEIGHT;
        }
      }
    }

    const windMaeKmh = windCount > 0 ? Number((windAbsErrSum / windCount).toFixed(2)) : null;
    const windBiasKmh = windCount > 0 ? Number((windSignedErrSum / windCount).toFixed(2)) : null;
    const tempMaeC = tempCount > 0 ? Number((tempAbsErrSum / tempCount).toFixed(2)) : null;
    const tempBiasC = tempCount > 0 ? Number((tempSignedErrSum / tempCount).toFixed(2)) : null;
    const rainBrierScore = rainCount > 0 ? Number((brierSum / rainCount).toFixed(4)) : null;
    const skyCoverBrierScore = skyCount > 0 ? Number((skyBrierSum / skyCount).toFixed(4)) : null;
    const ordinalAlignmentPct =
      ordinalCount > 0
        ? Math.max(0, Math.min(100, Math.round((1 - ordinalLossSum / ordinalCount) * 100)))
        : null;

    const meanLoss = totalEvidenceWeight > 0 ? weightedLossSum / totalEvidenceWeight : 1;

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
      skyCoverBrierScore,
      ordinalAlignmentPct,
      effectiveEvidenceWeight: Number(totalEvidenceWeight.toFixed(2)),
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
    deduplicatedFromCount: rawRegionalObs.length,
    cooldownWindowMinutes: safeCooldown,
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
