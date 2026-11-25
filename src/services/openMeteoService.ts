import {
  buildLocationKey,
  getCachedForecast,
  getLatestCachedForecast,
  saveForecastCache,
} from '../db/database';
import {
  hasValidMarineGrid,
  OpenMeteoForecastResponseSchema,
  OpenMeteoMarineResponseSchema,
  type OpenMeteoForecastResponse,
  type OpenMeteoMarineResponse,
} from '../types/schemas';
import {
  DEFAULT_SAFE_WINDOW_THRESHOLDS,
  WEATHER_MODELS,
  type EnsembleHour,
  type MarineHour,
  type NativeModelHour,
  type NormalizedForecast,
  type SafeWindowThresholds,
  type WeatherModelId,
} from '../types/weather';
import {
  computeHourlyConfidence,
  computeOverallConfidence,
} from '../utils/confidenceIndex';
import {
  buildVerticalWindProfile,
  computeModelCircularStat,
  computeModelScalarStat,
  extractNativeModelSeries,
} from '../utils/ensembleMath';
import {
  buildStratifiedCloudCover,
  computeDewPointSpread,
  computeEphemerisRange,
  computePressureDelta3h,
  evaluateFogRisk,
  evaluateSafeWindow,
  generateOperationalAlerts,
  isBarometricSquallRisk,
} from '../utils/operationalAlerts';
import { detectGlobalExtremeEvents } from '../utils/extremeEvents';
import {
  computeApparentTemperatureFallbackC,
  computeMagnusRelativeHumidityPct,
  computeVerticalWindShearKtPer100ft,
} from '../utils/qualityScores';
import type { ThunderstormRiskLevel } from '../types/v4';
import { fetchWithCircuitBreaker } from './httpClient';

export const OPEN_METEO_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_MARINE_ENDPOINT = 'https://marine-api.open-meteo.com/v1/marine';

export const FORECAST_HOURLY_VARIABLES = [
  'wind_speed_10m',
  'wind_speed_80m',
  'wind_speed_100m',
  'wind_speed_120m',
  'wind_direction_10m',
  'wind_direction_80m',
  'wind_direction_100m',
  'wind_direction_120m',
  'wind_gusts_10m',
  'precipitation',
  'precipitation_probability',
  'temperature_2m',
  'dew_point_2m',
  'visibility',
  'surface_pressure',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'relative_humidity_2m',
  'apparent_temperature',
  'cape',
  'weather_code',
  'et0_fao_evapotranspiration',
] as const;

export const MARINE_HOURLY_VARIABLES = [
  'wave_height',
  'wave_period',
  'wave_direction',
  'swell_wave_height',
  'swell_wave_period',
  'swell_wave_direction',
  'ocean_current_velocity',
  'ocean_current_direction',
  'sea_level_height_msl',
] as const;

/**
 * Monta a URL padronizada da Open-Meteo Forecast API multi-modelo
 * com `timeformat=unixtime&timezone=auto&forecast_days=7` (168h).
 */
export function buildOpenMeteoForecastUrl(
  latitude: number,
  longitude: number,
  forecastDays = 7,
): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: FORECAST_HOURLY_VARIABLES.join(','),
    models: WEATHER_MODELS.join(','),
    timeformat: 'unixtime',
    timezone: 'auto',
    forecast_days: String(forecastDays),
  });
  return `${OPEN_METEO_FORECAST_ENDPOINT}?${params.toString()}`;
}

/**
 * Monta a URL padronizada da Open-Meteo Marine API
 * com `timeformat=unixtime&timezone=auto&forecast_days=7` (168h).
 */
export function buildOpenMeteoMarineUrl(
  latitude: number,
  longitude: number,
  forecastDays = 7,
): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: MARINE_HOURLY_VARIABLES.join(','),
    timeformat: 'unixtime',
    timezone: 'auto',
    forecast_days: String(forecastDays),
  });
  return `${OPEN_METEO_MARINE_ENDPOINT}?${params.toString()}`;
}

export interface NormalizeForecastParams {
  forecastRaw: unknown;
  marineRaw?: unknown | null;
  /**
   * Indica se a coordenada é continental (sem grade oceânica esperada).
   * Se não informado, é inferido automaticamente como `!marineAvailable && !marineApiError`.
   */
  isContinental?: boolean;
  /**
   * Indica se a chamada à Marine API falhou por erro de rede/HTTP em ponto costeiro.
   */
  marineApiError?: boolean;
  thresholds?: SafeWindowThresholds;
  fetchedAtIso?: string;
  fromCache?: boolean;
  cacheAgeMinutes?: number | null;
  interpolationActive?: boolean;
}

function extractMarineHourAt(
  marine: OpenMeteoMarineResponse,
  idx: number,
  timestampUnix: number,
): MarineHour {
  const h = marine.hourly;
  const pick = (arr: readonly (number | null)[] | undefined): number | null => {
    if (!arr || idx >= arr.length) return null;
    const v = arr[idx];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  return {
    timestampUnix,
    timestampIso: new Date(timestampUnix * 1000).toISOString(),
    waveHeight: pick(h.wave_height),
    wavePeriod: pick(h.wave_period),
    waveDirection: pick(h.wave_direction),
    swellWaveHeight: pick(h.swell_wave_height),
    swellWavePeriod: pick(h.swell_wave_period),
    swellWaveDirection: pick(h.swell_wave_direction),
    oceanCurrentVelocity: pick(h.ocean_current_velocity),
    oceanCurrentDirection: pick(h.ocean_current_direction),
    seaLevelHeightMsl: pick(h.sea_level_height_msl),
  };
}

function computeDominantWeatherCode(
  codes: readonly (number | null | undefined)[],
): number | null {
  const valid: number[] = [];
  for (const c of codes) {
    if (typeof c === 'number' && Number.isFinite(c)) {
      valid.push(Math.round(c));
    }
  }
  if (valid.length === 0) {
    return null;
  }

  const counts = new Map<number, number>();
  for (const code of valid) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  let bestCode = valid[0]!;
  let bestCount = -1;
  for (const [code, count] of counts.entries()) {
    if (count > bestCount || (count === bestCount && code > bestCode)) {
      bestCount = count;
      bestCode = code;
    }
  }
  return bestCode;
}

function evaluateHourlyThunderstormRisk(params: {
  weatherCodeDominant: number | null;
  capeMeanJkg: number | null;
  precipMeanMm: number | null;
  pressureDelta3hHpa: number | null;
}): ThunderstormRiskLevel {
  const { weatherCodeDominant, capeMeanJkg, precipMeanMm, pressureDelta3hHpa } = params;
  if (
    (weatherCodeDominant !== null &&
      weatherCodeDominant >= 95 &&
      weatherCodeDominant <= 99) ||
    (capeMeanJkg !== null && Number.isFinite(capeMeanJkg) && capeMeanJkg >= 1500)
  ) {
    return 'high';
  }
  if (
    (capeMeanJkg !== null && Number.isFinite(capeMeanJkg) && capeMeanJkg >= 700) ||
    (precipMeanMm !== null &&
      Number.isFinite(precipMeanMm) &&
      precipMeanMm >= 4 &&
      pressureDelta3hHpa !== null &&
      Number.isFinite(pressureDelta3hHpa) &&
      pressureDelta3hHpa <= -2.5)
  ) {
    return 'moderate';
  }
  return 'none';
}

/**
 * Normaliza os payloads brutos da Open-Meteo Forecast (multi-modelo) e Marine API
 * no contrato interno único `NormalizedForecast`.
 *
 * Regras aplicadas:
 * - Validação estrita via `zod`.
 * - Altitude exclusivamente do DEM (`forecast.elevation`).
 * - Estatísticas escalares e circulares ($u/v$, $R \in [0, 1]$) hora a hora.
 * - Perfil vertical (10m–120m) com Lei de Potência e Double-Check de cisalhamento ($\alpha \notin [0.05, 0.40]$).
 * - Regra Continental: coordenadas sem grade marinha (`marineAvailable === false`) não sofrem penalidade no Índice de Confiabilidade.
 */
export function normalizeOpenMeteoForecast(params: NormalizeForecastParams): NormalizedForecast {
  const parsedForecast: OpenMeteoForecastResponse = OpenMeteoForecastResponseSchema.parse(
    params.forecastRaw,
  );
  const parsedMarine: OpenMeteoMarineResponse | null =
    params.marineRaw !== undefined && params.marineRaw !== null
      ? OpenMeteoMarineResponseSchema.parse(params.marineRaw)
      : null;

  const marineAvailable = hasValidMarineGrid(parsedMarine);
  const marineApiError = params.marineApiError ?? false;
  const isContinental =
    params.isContinental !== undefined
      ? params.isContinental
      : !marineAvailable && !marineApiError;

  const thresholds = params.thresholds ?? DEFAULT_SAFE_WINDOW_THRESHOLDS;
  const fetchedAtIso = params.fetchedAtIso ?? new Date().toISOString();
  const fromCache = params.fromCache ?? false;
  const cacheAgeMinutes = params.cacheAgeMinutes ?? 0;
  const interpolationActive = params.interpolationActive ?? true;

  const timesUnix = parsedForecast.hourly.time;
  const hourlyRecord = parsedForecast.hourly as unknown as Record<
    string,
    readonly (number | null)[] | undefined
  >;

  const nativeByModel: Record<WeatherModelId, NativeModelHour[]> = {
    ecmwf_ifs025: extractNativeModelSeries(timesUnix, 'ecmwf_ifs025', hourlyRecord),
    gfs_seamless: extractNativeModelSeries(timesUnix, 'gfs_seamless', hourlyRecord),
    icon_seamless: extractNativeModelSeries(timesUnix, 'icon_seamless', hourlyRecord),
    gem_seamless: extractNativeModelSeries(timesUnix, 'gem_seamless', hourlyRecord),
  };

  // Mapeia índice de timestamps marinhos para sincronizar pelo timestampUnix
  const marineIndexByTimestamp = new Map<number, number>();
  if (parsedMarine && marineAvailable) {
    parsedMarine.hourly.time.forEach((t, idx) => {
      marineIndexByTimestamp.set(t, idx);
    });
  }

  // Pré-calcula a série de pressão média para variação barométrica de 3h (Delta P / 3h)
  const surfacePressureStats = timesUnix.map((_, idx) =>
    computeModelScalarStat({
      ecmwf_ifs025: nativeByModel.ecmwf_ifs025[idx]?.surfacePressure ?? null,
      gfs_seamless: nativeByModel.gfs_seamless[idx]?.surfacePressure ?? null,
      icon_seamless: nativeByModel.icon_seamless[idx]?.surfacePressure ?? null,
      gem_seamless: nativeByModel.gem_seamless[idx]?.surfacePressure ?? null,
    }),
  );
  const meanPressureSeries = surfacePressureStats.map((s) => s.mean);

  const hours: EnsembleHour[] = timesUnix.map((timestampUnix, idx) => {
    const timestampIso = new Date(timestampUnix * 1000).toISOString();
    const ecmwf = nativeByModel.ecmwf_ifs025[idx]!;
    const gfs = nativeByModel.gfs_seamless[idx]!;
    const icon = nativeByModel.icon_seamless[idx]!;
    const gem = nativeByModel.gem_seamless[idx]!;

    const windSpeed10m = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.windSpeed10m,
      gfs_seamless: gfs.windSpeed10m,
      icon_seamless: icon.windSpeed10m,
      gem_seamless: gem.windSpeed10m,
    });
    const windSpeed80m = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.windSpeed80m,
      gfs_seamless: gfs.windSpeed80m,
      icon_seamless: icon.windSpeed80m,
      gem_seamless: gem.windSpeed80m,
    });
    const windSpeed100m = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.windSpeed100m,
      gfs_seamless: gfs.windSpeed100m,
      icon_seamless: icon.windSpeed100m,
      gem_seamless: gem.windSpeed100m,
    });
    const windSpeed120m = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.windSpeed120m,
      gfs_seamless: gfs.windSpeed120m,
      icon_seamless: icon.windSpeed120m,
      gem_seamless: gem.windSpeed120m,
    });

    const windDirection10m = computeModelCircularStat(
      {
        ecmwf_ifs025: ecmwf.windDirection10m,
        gfs_seamless: gfs.windDirection10m,
        icon_seamless: icon.windDirection10m,
        gem_seamless: gem.windDirection10m,
      },
      {
        ecmwf_ifs025: ecmwf.windSpeed10m,
        gfs_seamless: gfs.windSpeed10m,
        icon_seamless: icon.windSpeed10m,
        gem_seamless: gem.windSpeed10m,
      },
    );
    const windDirection80m = computeModelCircularStat(
      {
        ecmwf_ifs025: ecmwf.windDirection80m,
        gfs_seamless: gfs.windDirection80m,
        icon_seamless: icon.windDirection80m,
        gem_seamless: gem.windDirection80m,
      },
      {
        ecmwf_ifs025: ecmwf.windSpeed80m,
        gfs_seamless: gfs.windSpeed80m,
        icon_seamless: icon.windSpeed80m,
        gem_seamless: gem.windSpeed80m,
      },
    );
    const windDirection100m = computeModelCircularStat(
      {
        ecmwf_ifs025: ecmwf.windDirection100m,
        gfs_seamless: gfs.windDirection100m,
        icon_seamless: icon.windDirection100m,
        gem_seamless: gem.windDirection100m,
      },
      {
        ecmwf_ifs025: ecmwf.windSpeed100m,
        gfs_seamless: gfs.windSpeed100m,
        icon_seamless: icon.windSpeed100m,
        gem_seamless: gem.windSpeed100m,
      },
    );
    const windDirection120m = computeModelCircularStat(
      {
        ecmwf_ifs025: ecmwf.windDirection120m,
        gfs_seamless: gfs.windDirection120m,
        icon_seamless: icon.windDirection120m,
        gem_seamless: gem.windDirection120m,
      },
      {
        ecmwf_ifs025: ecmwf.windSpeed120m,
        gfs_seamless: gfs.windSpeed120m,
        icon_seamless: icon.windSpeed120m,
        gem_seamless: gem.windSpeed120m,
      },
    );

    // Rajadas estritamente em 10m
    const windGusts10m = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.windGusts10m,
      gfs_seamless: gfs.windGusts10m,
      icon_seamless: icon.windGusts10m,
      gem_seamless: gem.windGusts10m,
    });

    const precipitationMm = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.precipitation,
      gfs_seamless: gfs.precipitation,
      icon_seamless: icon.precipitation,
      gem_seamless: gem.precipitation,
    });

    const precipitationProbabilityPct = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.precipitationProbability,
      gfs_seamless: gfs.precipitationProbability,
      icon_seamless: icon.precipitationProbability,
      gem_seamless: gem.precipitationProbability,
    });

    const temperature2mC = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.temperature2m,
      gfs_seamless: gfs.temperature2m,
      icon_seamless: icon.temperature2m,
      gem_seamless: gem.temperature2m,
    });

    const dewPoint2mC = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.dewPoint2m,
      gfs_seamless: gfs.dewPoint2m,
      icon_seamless: icon.dewPoint2m,
      gem_seamless: gem.dewPoint2m,
    });

    const dewPointSpreadC = computeDewPointSpread(temperature2mC.mean, dewPoint2mC.mean);

    const visibilityM = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.visibility,
      gfs_seamless: gfs.visibility,
      icon_seamless: icon.visibility,
      gem_seamless: gem.visibility,
    });

    const surfacePressureHpa = surfacePressureStats[idx]!;
    const pressureDelta3hHpa = computePressureDelta3h(meanPressureSeries, idx);
    const barometricSquallRisk = isBarometricSquallRisk(pressureDelta3hHpa);

    const cloudCover = buildStratifiedCloudCover({
      lowByModel: {
        ecmwf_ifs025: ecmwf.cloudCoverLow,
        gfs_seamless: gfs.cloudCoverLow,
        icon_seamless: icon.cloudCoverLow,
        gem_seamless: gem.cloudCoverLow,
      },
      midByModel: {
        ecmwf_ifs025: ecmwf.cloudCoverMid,
        gfs_seamless: gfs.cloudCoverMid,
        icon_seamless: icon.cloudCoverMid,
        gem_seamless: gem.cloudCoverMid,
      },
      highByModel: {
        ecmwf_ifs025: ecmwf.cloudCoverHigh,
        gfs_seamless: gfs.cloudCoverHigh,
        icon_seamless: icon.cloudCoverHigh,
        gem_seamless: gem.cloudCoverHigh,
      },
    });

    const verticalProfile = buildVerticalWindProfile({
      speed10m: windSpeed10m.mean,
      speed80m: windSpeed80m.mean,
      speed100m: windSpeed100m.mean,
      speed120m: windSpeed120m.mean,
      direction10m: windDirection10m.degree,
      direction80m: windDirection80m.degree,
      direction100m: windDirection100m.degree,
      direction120m: windDirection120m.degree,
    });

    let marine: MarineHour | null = null;
    if (parsedMarine && marineAvailable) {
      const mIdx = marineIndexByTimestamp.get(timestampUnix) ?? idx;
      if (mIdx < parsedMarine.hourly.time.length) {
        marine = extractMarineHourAt(parsedMarine, mIdx, timestampUnix);
      }
    }

    const activeAtmosphericModels = [ecmwf, gfs, icon, gem].filter(
      (m) => m.windSpeed10m !== null || m.temperature2m !== null || m.surfacePressure !== null,
    ).length;

    const confidence = computeHourlyConfidence({
      hourIndex: idx,
      windSpeed10m,
      windDirection10m,
      temperature2mC,
      precipitationMm,
      surfacePressureHpa,
      activeAtmosphericModels,
      marineAvailable,
      isContinental,
      marineApiError,
      cacheAgeMinutes,
      alpha: verticalProfile.alpha,
      atypicalShearWarning: verticalProfile.atypicalShearWarning,
      interpolationActive,
    });

    const safeWindowEval = evaluateSafeWindow(
      {
        windSpeed10mKmh: windSpeed10m.mean,
        windGusts10mKmh: windGusts10m.mean,
        waveHeightM: marine?.waveHeight ?? null,
        precipProbPct: precipitationProbabilityPct.mean,
      },
      thresholds,
    );

    const fogRisk = evaluateFogRisk({
      visibilityM: visibilityM.mean,
      dewPointSpreadC,
    });

    const rhEcmwf =
      ecmwf.relativeHumidity2m ??
      computeMagnusRelativeHumidityPct(ecmwf.temperature2m, ecmwf.dewPoint2m);
    const rhGfs =
      gfs.relativeHumidity2m ??
      computeMagnusRelativeHumidityPct(gfs.temperature2m, gfs.dewPoint2m);
    const rhIcon =
      icon.relativeHumidity2m ??
      computeMagnusRelativeHumidityPct(icon.temperature2m, icon.dewPoint2m);
    const rhGem =
      gem.relativeHumidity2m ??
      computeMagnusRelativeHumidityPct(gem.temperature2m, gem.dewPoint2m);

    const rhModelStat = computeModelScalarStat({
      ecmwf_ifs025: rhEcmwf,
      gfs_seamless: rhGfs,
      icon_seamless: rhIcon,
      gem_seamless: rhGem,
    });
    const fallbackEnsembleRh =
      rhModelStat.mean === null
        ? computeMagnusRelativeHumidityPct(temperature2mC.mean, dewPoint2mC.mean)
        : null;
    const relativeHumidity2mPct =
      rhModelStat.mean !== null || fallbackEnsembleRh === null
        ? rhModelStat
        : {
            mean: fallbackEnsembleRh,
            min: fallbackEnsembleRh,
            max: fallbackEnsembleRh,
            stdDev: 0,
            sampleCount: 1,
            ...(rhModelStat.valuesByModel ? { valuesByModel: rhModelStat.valuesByModel } : {}),
          };

    const appEcmwf =
      ecmwf.apparentTemperature ??
      computeApparentTemperatureFallbackC(ecmwf.temperature2m, rhEcmwf, ecmwf.windSpeed10m);
    const appGfs =
      gfs.apparentTemperature ??
      computeApparentTemperatureFallbackC(gfs.temperature2m, rhGfs, gfs.windSpeed10m);
    const appIcon =
      icon.apparentTemperature ??
      computeApparentTemperatureFallbackC(icon.temperature2m, rhIcon, icon.windSpeed10m);
    const appGem =
      gem.apparentTemperature ??
      computeApparentTemperatureFallbackC(gem.temperature2m, rhGem, gem.windSpeed10m);

    const apparentModelStat = computeModelScalarStat({
      ecmwf_ifs025: appEcmwf,
      gfs_seamless: appGfs,
      icon_seamless: appIcon,
      gem_seamless: appGem,
    });
    const fallbackEnsembleApparent =
      apparentModelStat.mean === null
        ? computeApparentTemperatureFallbackC(
            temperature2mC.mean,
            relativeHumidity2mPct.mean,
            windSpeed10m.mean,
          )
        : null;
    const apparentTemperatureC =
      apparentModelStat.mean !== null || fallbackEnsembleApparent === null
        ? apparentModelStat
        : {
            mean: fallbackEnsembleApparent,
            min: fallbackEnsembleApparent,
            max: fallbackEnsembleApparent,
            stdDev: 0,
            sampleCount: 1,
            ...(apparentModelStat.valuesByModel
              ? { valuesByModel: apparentModelStat.valuesByModel }
              : {}),
          };

    const capeJkg = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.cape ?? null,
      gfs_seamless: gfs.cape ?? null,
      icon_seamless: icon.cape ?? null,
      gem_seamless: gem.cape ?? null,
    });

    const weatherCodeDominant = computeDominantWeatherCode([
      ecmwf.weatherCode,
      gfs.weatherCode,
      icon.weatherCode,
      gem.weatherCode,
    ]);

    const thunderstormRisk = evaluateHourlyThunderstormRisk({
      weatherCodeDominant,
      capeMeanJkg: capeJkg.mean,
      precipMeanMm: precipitationMm.mean,
      pressureDelta3hHpa,
    });

    const windShearKtPer100ft = computeVerticalWindShearKtPer100ft({
      windSpeed10m,
      windSpeed80m,
      windSpeed100m,
      windDirection10m,
      windDirection80m,
      windDirection100m,
    });

    const et0FaoMm = computeModelScalarStat({
      ecmwf_ifs025: ecmwf.et0FaoEvapotranspiration ?? null,
      gfs_seamless: gfs.et0FaoEvapotranspiration ?? null,
      icon_seamless: icon.et0FaoEvapotranspiration ?? null,
      gem_seamless: gem.et0FaoEvapotranspiration ?? null,
    });

    return {
      timestampUnix,
      timestampIso,
      hourIndex: idx,
      windSpeed10m,
      windSpeed80m,
      windSpeed100m,
      windSpeed120m,
      windDirection10m,
      windDirection80m,
      windDirection100m,
      windDirection120m,
      windGusts10m,
      precipitationMm,
      precipitationProbabilityPct,
      temperature2mC,
      dewPoint2mC,
      dewPointSpreadC,
      visibilityM,
      surfacePressureHpa,
      pressureDelta3hHpa,
      cloudCover,
      verticalProfile,
      marine,
      confidence,
      safeWindow: safeWindowEval.status,
      safeWindowReasons: safeWindowEval.reasons,
      fogRisk,
      barometricSquallRisk,
      relativeHumidity2mPct,
      apparentTemperatureC,
      capeJkg,
      weatherCodeDominant,
      thunderstormRisk,
      windShearKtPer100ft,
      et0FaoMm,
    };
  });

  const overallConfidence = computeOverallConfidence(hours, { isContinental });
  const alerts = generateOperationalAlerts(hours);
  const extremeEvents = detectGlobalExtremeEvents(hours, parsedForecast.timezone);
  const ephemerisByDay = computeEphemerisRange(
    parsedForecast.latitude,
    parsedForecast.longitude,
    timesUnix,
    parsedForecast.timezone,
  );

  return {
    locationKey: buildLocationKey(parsedForecast.latitude, parsedForecast.longitude),
    latitude: parsedForecast.latitude,
    longitude: parsedForecast.longitude,
    elevationDemM: parsedForecast.elevation,
    timezone: parsedForecast.timezone,
    utcOffsetSeconds: parsedForecast.utc_offset_seconds,
    fetchedAtIso,
    fromCache,
    marineAvailable,
    hours,
    nativeByModel,
    overallConfidence,
    alerts,
    ephemerisByDay,
    thresholdsUsed: thresholds,
    extremeEvents,
  };
}

/**
 * Reaplica limites configuráveis (`SafeWindowThresholds`) sobre uma previsão já carregada,
 * atualizando o Semáforo de Janela Segura e os Alertas Operacionais sem nova requisição de rede.
 */
export function reapplyThresholdsToForecast(
  forecast: NormalizedForecast,
  thresholds: SafeWindowThresholds,
): NormalizedForecast {
  const updatedHours: EnsembleHour[] = forecast.hours.map((h) => {
    const evalResult = evaluateSafeWindow(
      {
        windSpeed10mKmh: h.windSpeed10m.mean,
        windGusts10mKmh: h.windGusts10m.mean,
        waveHeightM: h.marine?.waveHeight ?? null,
        precipProbPct: h.precipitationProbabilityPct.mean,
      },
      thresholds,
    );
    return {
      ...h,
      safeWindow: evalResult.status,
      safeWindowReasons: evalResult.reasons,
    };
  });

  return {
    ...forecast,
    hours: updatedHours,
    alerts: generateOperationalAlerts(updatedHours),
    thresholdsUsed: thresholds,
  };
}

export interface FetchForecastOptions {
  thresholds?: SafeWindowThresholds;
  forecastDays?: number;
  interpolationActive?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
}

/**
 * Busca previsão multi-modelo + oceanográfica da Open-Meteo com Circuit Breaker,
 * salva em cache IndexedDB (Dexie) e faz fallback automático para o cache caso offline.
 */
export async function fetchOpenMeteoForecast(
  latitude: number,
  longitude: number,
  options: FetchForecastOptions = {},
): Promise<NormalizedForecast> {
  const {
    thresholds = DEFAULT_SAFE_WINDOW_THRESHOLDS,
    forecastDays = 7,
    interpolationActive = true,
    fetchImpl,
    timeoutMs,
    maxRetries,
    backoffBaseMs,
  } = options;

  const forecastUrl = buildOpenMeteoForecastUrl(latitude, longitude, forecastDays);
  const marineUrl = buildOpenMeteoMarineUrl(latitude, longitude, forecastDays);

  try {
    // Dispara Forecast e Marine em paralelo; Marine não derruba a requisição caso falhe isoladamente
    const [forecastResult, marineOutcome] = await Promise.all([
      fetchWithCircuitBreaker({
        service: 'open_meteo_forecast',
        url: forecastUrl,
        schema: OpenMeteoForecastResponseSchema,
        fetchImpl,
        timeoutMs,
        maxRetries,
        backoffBaseMs,
      }),
      fetchWithCircuitBreaker({
        service: 'open_meteo_marine',
        url: marineUrl,
        schema: OpenMeteoMarineResponseSchema,
        fetchImpl,
        timeoutMs,
        maxRetries,
        backoffBaseMs,
      })
        .then((res) => ({ ok: true as const, data: res.data }))
        .catch(() => ({ ok: false as const, data: null })),
    ]);

    const normalized = normalizeOpenMeteoForecast({
      forecastRaw: forecastResult.data,
      marineRaw: marineOutcome.data,
      marineApiError: !marineOutcome.ok,
      thresholds,
      fetchedAtIso: new Date().toISOString(),
      fromCache: false,
      cacheAgeMinutes: 0,
      interpolationActive,
    });

    await saveForecastCache(normalized);
    return normalized;
  } catch (networkError) {
    // Fallback automático para cache IndexedDB (Dexie)
    const cachedRecord =
      (await getCachedForecast(latitude, longitude)) ?? (await getLatestCachedForecast());

    if (!cachedRecord) {
      throw networkError;
    }

    const ageMs = Math.max(0, Date.now() - new Date(cachedRecord.fetchedAtIso).getTime());
    const cacheAgeMinutes = Math.round(ageMs / 60_000);

    const updatedHours: EnsembleHour[] = cachedRecord.forecast.hours.map((h) => {
      const confidence = computeHourlyConfidence({
        hourIndex: h.hourIndex,
        windSpeed10m: h.windSpeed10m,
        windDirection10m: h.windDirection10m,
        temperature2mC: h.temperature2mC,
        precipitationMm: h.precipitationMm,
        surfacePressureHpa: h.surfacePressureHpa,
        marineAvailable: cachedRecord.forecast.marineAvailable,
        isContinental: h.confidence.isContinental,
        cacheAgeMinutes,
        alpha: h.verticalProfile.alpha,
        atypicalShearWarning: h.verticalProfile.atypicalShearWarning,
        interpolationActive,
      });

      const safeEval = evaluateSafeWindow(
        {
          windSpeed10mKmh: h.windSpeed10m.mean,
          windGusts10mKmh: h.windGusts10m.mean,
          waveHeightM: h.marine?.waveHeight ?? null,
          precipProbPct: h.precipitationProbabilityPct.mean,
        },
        thresholds,
      );

      return {
        ...h,
        confidence,
        safeWindow: safeEval.status,
        safeWindowReasons: safeEval.reasons,
      };
    });

    const overallConfidence = computeOverallConfidence(updatedHours, {
      isContinental: cachedRecord.forecast.overallConfidence.isContinental,
    });

    return {
      ...cachedRecord.forecast,
      fromCache: true,
      hours: updatedHours,
      overallConfidence,
      alerts: generateOperationalAlerts(updatedHours),
      thresholdsUsed: thresholds,
    };
  }
}
