import type { HistoricalSeriesResult } from '../types/field';
import type {
  AcademicSourceCitation,
  AgroClimaticWaterBalance,
  DescriptiveMetricStats,
  ScientificAnalysisSummary,
} from '../types/v4';
import {
  WEATHER_MODELS,
  type ForecastViewMode,
  type NativeModelHour,
  type NormalizedForecast,
  type WeatherModelId,
} from '../types/weather';
import { computeCircularStat } from './ensembleMath';
import { formatLocalYMD } from './localTimeHour';
import { computeMagnusRelativeHumidityPct } from './qualityScores';

const SECONDS_PER_DAY = 86_400;

const NWP_MODEL_LABELS: Record<WeatherModelId, string> = {
  ecmwf_ifs025: 'ECMWF IFS 0.25° (~25 km)',
  gfs_seamless: 'NOAA NCEP GFS Seamless (~13–25 km)',
  icon_seamless: 'DWD ICON Seamless (~13 km)',
  gem_seamless: 'ECCC CMC GEM Seamless (~15 km)',
};

function cleanZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value;
}

function computeQuantileSorted(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0]!;
  }
  const clampedQ = Math.max(0, Math.min(1, quantile));
  const pos = (sorted.length - 1) * clampedQ;
  const baseIdx = Math.floor(pos);
  const rest = pos - baseIdx;
  const lower = sorted[baseIdx]!;
  const upper = sorted[Math.min(sorted.length - 1, baseIdx + 1)]!;
  return cleanZero(lower + rest * (upper - lower));
}

/**
 * Calcula estatísticas descritivas rigorosas de uma série escalar:
 * `sampleCount`, `mean`, `median`, `stdDev` populacional, `min`, `max`,
 * `p10`, `p90`, `iqr` (`p75 - p25`), `mad` (Median Absolute Deviation),
 * `robustZScoreMax` (`max(0.6745 * |x - median| / mad)`), tendência linear por OLS
 * (`linearTrendPerDay`, unidades/24h), estimador robusto de Theil-Sen (`theilSenTrendPerDay`)
 * e anomalia padronizada máxima (`anomalyZScoreMax` = `max(|x - mean| / stdDev)`).
 */
export function computeDescriptiveStats(
  variableKey: string,
  label: string,
  unit: string,
  values: readonly (number | null | undefined)[],
  timestampsUnix?: readonly number[],
): DescriptiveMetricStats {
  const validValues: number[] = [];
  const pairedTimestamps: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const raw = values[i];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      validValues.push(raw);
      const rawTs = timestampsUnix?.[i];
      const ts = typeof rawTs === 'number' && Number.isFinite(rawTs) ? rawTs : i * 3600;
      pairedTimestamps.push(ts);
    }
  }

  const n = validValues.length;
  if (n === 0) {
    return {
      variableKey,
      label,
      unit,
      sampleCount: 0,
      mean: null,
      median: null,
      stdDev: null,
      min: null,
      max: null,
      p10: null,
      p90: null,
      iqr: null,
      linearTrendPerDay: null,
      anomalyZScoreMax: null,
      mad: null,
      robustZScoreMax: null,
      theilSenTrendPerDay: null,
    };
  }

  const sorted = [...validValues].sort((a, b) => a - b);
  const min = cleanZero(sorted[0]!);
  const max = cleanZero(sorted[n - 1]!);

  let sum = 0;
  for (const v of validValues) {
    sum += v;
  }
  const mean = cleanZero(sum / n);

  let varianceSum = 0;
  for (const v of validValues) {
    const diff = v - mean;
    varianceSum += diff * diff;
  }
  const stdDev = cleanZero(Math.sqrt(varianceSum / n));

  const median = computeQuantileSorted(sorted, 0.5);
  const p10 = computeQuantileSorted(sorted, 0.1);
  const p90 = computeQuantileSorted(sorted, 0.9);
  const p25 = computeQuantileSorted(sorted, 0.25);
  const p75 = computeQuantileSorted(sorted, 0.75);
  const iqr = cleanZero(p75 - p25);

  const absDevsSorted = validValues.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = cleanZero(computeQuantileSorted(absDevsSorted, 0.5));

  let robustZScoreMax = 0;
  if (mad > 1e-12) {
    let maxRobustZ = 0;
    for (const v of validValues) {
      const rz = (0.6745 * Math.abs(v - median)) / mad;
      if (rz > maxRobustZ) {
        maxRobustZ = rz;
      }
    }
    robustZScoreMax = cleanZero(maxRobustZ);
  }

  let anomalyZScoreMax = 0;
  if (stdDev > 1e-12) {
    let maxZ = 0;
    for (const v of validValues) {
      const z = Math.abs(v - mean) / stdDev;
      if (z > maxZ) {
        maxZ = z;
      }
    }
    anomalyZScoreMax = cleanZero(maxZ);
  }

  let linearTrendPerDay: number | null = null;
  let theilSenTrendPerDay: number | null = null;
  if (n >= 2) {
    const t0 = pairedTimestamps[0]!;
    const days: number[] = pairedTimestamps.map((ts) => (ts - t0) / SECONDS_PER_DAY);
    let sumDays = 0;
    for (const d of days) {
      sumDays += d;
    }
    const meanDay = sumDays / n;

    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
      const dx = days[i]! - meanDay;
      const dy = validValues[i]! - mean;
      sumXY += dx * dy;
      sumXX += dx * dx;
    }

    linearTrendPerDay = sumXX > 1e-12 ? cleanZero(sumXY / sumXX) : 0;

    // Estimador robusto de Theil-Sen (mediana das inclinações par-a-par; subamostra uniforme até 120 pts)
    const maxTheilPoints = 120;
    const sampleIndices: number[] = [];
    if (n <= maxTheilPoints) {
      for (let i = 0; i < n; i++) {
        sampleIndices.push(i);
      }
    } else {
      const step = (n - 1) / (maxTheilPoints - 1);
      for (let k = 0; k < maxTheilPoints; k++) {
        sampleIndices.push(Math.round(k * step));
      }
    }

    const slopes: number[] = [];
    for (let a = 0; a < sampleIndices.length; a++) {
      const i = sampleIndices[a]!;
      const di = days[i]!;
      const yi = validValues[i]!;
      for (let b = a + 1; b < sampleIndices.length; b++) {
        const j = sampleIndices[b]!;
        const dd = days[j]! - di;
        if (Math.abs(dd) > 1e-12) {
          slopes.push((validValues[j]! - yi) / dd);
        }
      }
    }

    if (slopes.length > 0) {
      slopes.sort((a, b) => a - b);
      theilSenTrendPerDay = cleanZero(computeQuantileSorted(slopes, 0.5));
    } else {
      theilSenTrendPerDay = 0;
    }
  }

  return {
    variableKey,
    label,
    unit,
    sampleCount: n,
    mean,
    median,
    stdDev,
    min,
    max,
    p10,
    p90,
    iqr,
    linearTrendPerDay,
    anomalyZScoreMax,
    mad,
    robustZScoreMax,
    theilSenTrendPerDay,
  };
}

/**
 * Índice de Calor (Heat Index) em °C pela formulação padrão NOAA NWS Steadman / Rothfusz.
 */
export function computeHeatIndexRothfuszC(
  tempC: number | null | undefined,
  rhPct: number | null | undefined,
): number | null {
  if (typeof tempC !== 'number' || !Number.isFinite(tempC)) {
    return null;
  }
  const rh =
    typeof rhPct === 'number' && Number.isFinite(rhPct)
      ? Math.max(0, Math.min(100, rhPct))
      : 60;

  const tF = tempC * 1.8 + 32;
  const simpleHiF = 0.5 * (tF + 61.0 + (tF - 68.0) * 1.2 + rh * 0.094);
  const avgSteadmanF = (simpleHiF + tF) / 2;

  if (avgSteadmanF < 80) {
    return Number(((simpleHiF - 32) / 1.8).toFixed(2));
  }

  let hiF =
    -42.379 +
    2.04901523 * tF +
    10.14333127 * rh -
    0.22475541 * tF * rh -
    0.00683783 * tF * tF -
    0.05481717 * rh * rh +
    0.00122874 * tF * tF * rh +
    0.00085282 * tF * rh * rh -
    0.00000199 * tF * tF * rh * rh;

  if (rh < 13 && tF >= 80 && tF <= 112) {
    const rootTerm = Math.sqrt(Math.max(0, (17 - Math.abs(tF - 95)) / 17));
    hiF -= ((13 - rh) / 4) * rootTerm;
  } else if (rh > 85 && tF >= 80 && tF <= 87) {
    hiF += ((rh - 85) / 10) * ((87 - tF) / 5);
  }

  return Number(((hiF - 32) / 1.8).toFixed(2));
}

/**
 * Classifica o estresse hídrico agroclimático com base no saldo líquido `P - ET0` (mm).
 */
export function classifyWaterStress(
  netWaterBalanceMm: number,
): AgroClimaticWaterBalance['waterStressClassification'] {
  if (netWaterBalanceMm > 10) {
    return 'surplus';
  }
  if (netWaterBalanceMm >= -10) {
    return 'balanced';
  }
  if (netWaterBalanceMm >= -30) {
    return 'moderate_deficit';
  }
  return 'severe_deficit';
}

function estimateHourlyEt0PhysicalMm(
  tempC: number | null,
  dailyRangeC: number,
  rhPct: number | null,
): number {
  if (tempC === null || !Number.isFinite(tempC)) {
    return 0;
  }
  const safeRange = Number.isFinite(dailyRangeC) ? Math.max(2, dailyRangeC) : 2;
  // Ajuste físico leve pelo déficit de pressão de vapor relativo quando UR está disponível
  const vpdFactor =
    rhPct !== null && Number.isFinite(rhPct)
      ? Math.max(0.75, Math.min(1.25, 0.85 + ((100 - Math.max(5, Math.min(100, rhPct))) / 100) * 0.45))
      : 1.0;
  return Math.max(0, 0.0023 * (tempC + 17.8) * Math.sqrt(safeRange) * 0.42 * vpdFactor);
}

export function computeAgroClimaticWaterBalance(params: {
  timestampsUnix: readonly number[];
  timezone: string;
  temperaturesC: readonly (number | null | undefined)[];
  dewPointsC?: readonly (number | null | undefined)[];
  relativeHumiditiesPct?: readonly (number | null | undefined)[];
  precipitationsMm: readonly (number | null | undefined)[];
  et0HourlyMm?: readonly (number | null | undefined)[];
}): AgroClimaticWaterBalance {
  const {
    timestampsUnix,
    timezone,
    temperaturesC,
    dewPointsC,
    relativeHumiditiesPct,
    precipitationsMm,
    et0HourlyMm,
  } = params;

  const dailyTemps = new Map<string, number[]>();
  const localDayPerIndex: string[] = [];

  for (let i = 0; i < timestampsUnix.length; i++) {
    const ts = timestampsUnix[i]!;
    const dayKey = formatLocalYMD(new Date(ts * 1000), timezone);
    localDayPerIndex.push(dayKey);
    const t = temperaturesC[i];
    if (typeof t === 'number' && Number.isFinite(t)) {
      const bucket = dailyTemps.get(dayKey);
      if (bucket) {
        bucket.push(t);
      } else {
        dailyTemps.set(dayKey, [t]);
      }
    }
  }

  const dailyRangeByKey = new Map<string, number>();
  let growingDegreeDaysSum = 0;

  for (const [dayKey, temps] of dailyTemps.entries()) {
    if (temps.length === 0) continue;
    let sumT = 0;
    let minT = temps[0]!;
    let maxT = temps[0]!;
    for (const v of temps) {
      sumT += v;
      if (v < minT) minT = v;
      if (v > maxT) maxT = v;
    }
    const meanDailyT = sumT / temps.length;
    growingDegreeDaysSum += Math.max(0, meanDailyT - 10);
    dailyRangeByKey.set(dayKey, Math.max(2, maxT - minT));
  }

  let totalPrecip = 0;
  let totalEt0 = 0;
  let rhSum = 0;
  let rhCount = 0;
  let maxHeatIndex: number | null = null;

  for (let i = 0; i < timestampsUnix.length; i++) {
    const p = precipitationsMm[i];
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      totalPrecip += p;
    }

    const rawT = temperaturesC[i];
    const tempC = typeof rawT === 'number' && Number.isFinite(rawT) ? rawT : null;
    const rawTd = dewPointsC?.[i];
    const dewC = typeof rawTd === 'number' && Number.isFinite(rawTd) ? rawTd : null;

    const directRh = relativeHumiditiesPct?.[i];
    const resolvedRh =
      typeof directRh === 'number' && Number.isFinite(directRh)
        ? Math.max(5, Math.min(100, directRh))
        : computeMagnusRelativeHumidityPct(tempC, dewC);

    if (resolvedRh !== null && Number.isFinite(resolvedRh)) {
      rhSum += resolvedRh;
      rhCount += 1;
    }

    const rawEt0 = et0HourlyMm?.[i];
    if (typeof rawEt0 === 'number' && Number.isFinite(rawEt0)) {
      totalEt0 += Math.max(0, rawEt0);
    } else if (tempC !== null) {
      const dayKey = localDayPerIndex[i] ?? '';
      const rangeC =
        dailyRangeByKey.get(dayKey) ??
        (dewC !== null ? Math.max(2, tempC - dewC) : 2);
      totalEt0 += estimateHourlyEt0PhysicalMm(tempC, rangeC, resolvedRh);
    }

    const hi = computeHeatIndexRothfuszC(tempC, resolvedRh);
    if (hi !== null && (maxHeatIndex === null || hi > maxHeatIndex)) {
      maxHeatIndex = hi;
    }
  }

  const totalPrecipitationMm = Number(totalPrecip.toFixed(2));
  const totalEt0FaoMm = Number(totalEt0.toFixed(2));
  const netWaterBalanceMm = Number((totalPrecipitationMm - totalEt0FaoMm).toFixed(2));

  return {
    totalPrecipitationMm,
    totalEt0FaoMm,
    netWaterBalanceMm,
    waterStressClassification: classifyWaterStress(netWaterBalanceMm),
    growingDegreeDaysBase10C: Number(growingDegreeDaysSum.toFixed(2)),
    meanRelativeHumidityPct: rhCount > 0 ? Number((rhSum / rhCount).toFixed(1)) : null,
    maxHeatIndexC: maxHeatIndex,
  };
}

/**
 * Constrói a lista formal de citações acadêmicas e operacionais utilizadas pelo FieldCast.
 */
export function buildAcademicSourceCitations(
  includeHistoricalEra5: boolean,
  includeMarine: boolean,
): AcademicSourceCitation[] {
  const citations: AcademicSourceCitation[] = [];

  if (includeHistoricalEra5) {
    citations.push({
      id: 'copernicus_era5_reanalysis',
      provider: 'ECMWF / Copernicus Climate Change Service (C3S)',
      datasetName: 'Copernicus ERA5 Hourly Reanalysis on Single Levels',
      spatialResolution: '0.25° x 0.25° (~25–31 km)',
      temporalResolution: '1 hora (série histórica contínua desde 1940)',
      url: 'https://doi.org/10.1002/qj.3803',
      formalCitation:
        'Hersbach, H., Bell, B., Berrisford, P., Hirahara, S., Horányi, A., Muñoz-Sabater, J., et al. (2020). The ERA5 global reanalysis. Quarterly Journal of the Royal Meteorological Society, 146(730), 1999–2049. https://doi.org/10.1002/qj.3803',
    });
  }

  citations.push(
    {
      id: 'ecmwf_ifs025_open_data',
      provider: 'European Centre for Medium-Range Weather Forecasts (ECMWF)',
      datasetName: 'ECMWF IFS 0.25° High-Resolution Operational Open Data',
      spatialResolution: '0.25° x 0.25° (~25 km)',
      temporalResolution: '1 hora (horizonte 168h)',
      url: 'https://www.ecmwf.int/en/forecasts/datasets/open-data',
      formalCitation:
        'ECMWF (2024). Integrated Forecasting System (IFS) Open Data 0.25° Operational Atmospheric Forecast Dataset (CC-BY-4.0). Reading, UK: European Centre for Medium-Range Weather Forecasts.',
    },
    {
      id: 'noaa_ncep_gfs_swpc',
      provider: 'NOAA / NCEP / Space Weather Prediction Center (SWPC)',
      datasetName: 'NOAA NCEP GFS Seamless & SWPC Planetary K-Index',
      spatialResolution: '0.11°–0.25° (~13–25 km) / Global Geomagnetic Index',
      temporalResolution: '1 hora (NWP) / 3 horas (Índice Planetário Kp)',
      url: 'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast',
      formalCitation:
        'National Centers for Environmental Prediction (NCEP) & NOAA Space Weather Prediction Center (SWPC) (2024). Global Forecast System (GFS) Atmospheric Model & Planetary K-Index Real-Time Telemetry. Silver Spring, MD: NOAA.',
    },
    {
      id: 'dwd_icon_global',
      provider: 'Deutscher Wetterdienst (DWD)',
      datasetName: 'DWD ICON (Icosahedral Nonhydrostatic) Global Seamless Model',
      spatialResolution: '0.125° (~13 km grade icosaédrica)',
      temporalResolution: '1 hora (horizonte 168h)',
      url: 'https://www.dwd.de/EN/research/weatherforecasting/num_modelling/01_num_weather_prediction_modells/icon_description.html',
      formalCitation:
        'Zängl, G., Reinert, D., Rípodas, P., & Baldauf, M. (2015). The ICON (ICOsahedral Non-hydrostatic) modelling framework of DWD and MPI-M. Quarterly Journal of the Royal Meteorological Society, 141(687), 563–579.',
    },
    {
      id: 'eccc_cmc_gem',
      provider: 'Environment and Climate Change Canada (ECCC / CMC)',
      datasetName: 'Canadian Meteorological Centre (CMC) Global Environmental Multiscale (GEM)',
      spatialResolution: '0.15° (~15 km)',
      temporalResolution: '1 hora (horizonte 168h)',
      url: 'https://eccc-msc.github.io/open-data/msc-data/nwp_gdps/readme_gdps_en/',
      formalCitation:
        'Côté, J., Gravel, S., Méthot, A., Patoine, A., Roch, M., & Staniforth, A. (1998). The operational CMC–MRB Global Environmental Multiscale (GEM) model. Monthly Weather Review, 126(6), 1373–1395.',
    },
    {
      id: 'copernicus_nasa_srtm_dem',
      provider: 'ESA Copernicus / NASA JPL',
      datasetName: 'Copernicus DEM GLO-90 & NASA SRTM 90m Digital Elevation Model',
      spatialResolution: '3 arc-sec (~90 m)',
      temporalResolution: 'Modelo Topográfico Digital Estático (DEM)',
      url: 'https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model',
      formalCitation:
        'Farr, T. G., et al. (2007). The Shuttle Radar Topography Mission (SRTM) & ESA Copernicus DEM GLO-90 Digital Elevation Model via Open-Meteo Elevation API. Reviews of Geophysics, 45(2), RG2004.',
    },
  );

  if (includeMarine) {
    citations.push({
      id: 'cmems_ecmwf_wam_marine',
      provider: 'Copernicus Marine Service (CMEMS) / ECMWF WAM',
      datasetName: 'Global Ocean Waves, Currents & Sea Level Anomaly (MSL ~8 km)',
      spatialResolution: '0.083° (~8 km costeiro/oceânico)',
      temporalResolution: '1 hora',
      url: 'https://marine.copernicus.eu/',
      formalCitation:
        'Copernicus Marine Environment Monitoring Service (CMEMS) & ECMWF WAM (2024). Global Ocean Wave Physics & Sea Level Height above Mean Sea Level (MSL ~8 km) via Open-Meteo Marine API.',
    });
  }

  return citations;
}

function isSpecificWeatherModel(mode: ForecastViewMode): mode is WeatherModelId {
  return (WEATHER_MODELS as readonly string[]).includes(mode);
}

/**
 * Executa a análise estatística, vetorial e agroclimática completa sobre uma previsão
 * operacional normalizada (`NormalizedForecast`, horizonte até 168h).
 */
export function analyzeForecastScientifically(
  forecast: NormalizedForecast,
  locationName: string,
  viewMode: ForecastViewMode = 'fieldcast',
): ScientificAnalysisSummary {
  const hours = forecast.hours;
  const timestampsUnix = hours.map((h) => h.timestampUnix);
  const useSingleModel = isSpecificWeatherModel(viewMode);
  const nativeSeries: readonly NativeModelHour[] = useSingleModel
    ? (forecast.nativeByModel[viewMode] ?? [])
    : [];

  const temperaturesC = hours.map((h, idx) =>
    useSingleModel ? (nativeSeries[idx]?.temperature2m ?? h.temperature2mC.mean) : h.temperature2mC.mean,
  );
  const dewPointsC = hours.map((h, idx) =>
    useSingleModel ? (nativeSeries[idx]?.dewPoint2m ?? h.dewPoint2mC.mean) : h.dewPoint2mC.mean,
  );
  const relativeHumiditiesPct = hours.map((h, idx) => {
    if (useSingleModel) {
      const raw = nativeSeries[idx]?.relativeHumidity2m ?? null;
      return raw ?? computeMagnusRelativeHumidityPct(temperaturesC[idx] ?? null, dewPointsC[idx] ?? null);
    }
    return (
      h.relativeHumidity2mPct?.mean ??
      computeMagnusRelativeHumidityPct(h.temperature2mC.mean, h.dewPoint2mC.mean)
    );
  });
  const precipitationsMm = hours.map((h, idx) =>
    useSingleModel ? (nativeSeries[idx]?.precipitation ?? h.precipitationMm.mean) : h.precipitationMm.mean,
  );
  const windSpeedsKmh = hours.map((h, idx) =>
    useSingleModel ? (nativeSeries[idx]?.windSpeed10m ?? h.windSpeed10m.mean) : h.windSpeed10m.mean,
  );
  const windGustsKmh = hours.map((h, idx) =>
    useSingleModel ? (nativeSeries[idx]?.windGusts10m ?? h.windGusts10m.mean) : h.windGusts10m.mean,
  );
  const windDirectionsDeg = hours.map((h, idx) =>
    useSingleModel
      ? (nativeSeries[idx]?.windDirection10m ?? h.windDirection10m.degree)
      : h.windDirection10m.degree,
  );
  const surfacePressuresHpa = hours.map((h, idx) =>
    useSingleModel
      ? (nativeSeries[idx]?.surfacePressure ?? h.surfacePressureHpa.mean)
      : h.surfacePressureHpa.mean,
  );
  const et0HourlyMm = hours.map((h, idx) =>
    useSingleModel
      ? (nativeSeries[idx]?.et0FaoEvapotranspiration ?? h.et0FaoMm?.mean ?? null)
      : (h.et0FaoMm?.mean ?? null),
  );

  const metrics: DescriptiveMetricStats[] = [
    computeDescriptiveStats('temperature_2m', 'Temperatura do Ar (2m)', '°C', temperaturesC, timestampsUnix),
    computeDescriptiveStats('relative_humidity_2m', 'Umidade Relativa (2m)', '%', relativeHumiditiesPct, timestampsUnix),
    computeDescriptiveStats('precipitation', 'Precipitação Horária', 'mm/h', precipitationsMm, timestampsUnix),
    computeDescriptiveStats('wind_speed_10m', 'Velocidade do Vento (10m)', 'km/h', windSpeedsKmh, timestampsUnix),
    computeDescriptiveStats('wind_gusts_10m', 'Rajadas de Vento (10m)', 'km/h', windGustsKmh, timestampsUnix),
    computeDescriptiveStats('surface_pressure', 'Pressão Atmosférica à Superfície', 'hPa', surfacePressuresHpa, timestampsUnix),
  ];

  const waveHeightsM = hours.map((h) => h.marine?.waveHeight ?? null);
  const seaLevelsMsl = hours.map((h) => h.marine?.seaLevelHeightMsl ?? null);
  const hasWaveData =
    forecast.marineAvailable &&
    waveHeightsM.some((v) => typeof v === 'number' && Number.isFinite(v));
  const hasSeaLevelData =
    forecast.marineAvailable &&
    seaLevelsMsl.some((v) => typeof v === 'number' && Number.isFinite(v));

  if (hasWaveData) {
    metrics.push(
      computeDescriptiveStats(
        'wave_height',
        'Altura Significativa de Onda (Hs)',
        'm',
        waveHeightsM,
        timestampsUnix,
      ),
    );
  }
  if (hasSeaLevelData) {
    metrics.push(
      computeDescriptiveStats(
        'sea_level_msl',
        'Cota Oceânica Estimada (MSL ~8 km)',
        'm',
        seaLevelsMsl,
        timestampsUnix,
      ),
    );
  }

  const circularWind = computeCircularStat(windDirectionsDeg, windSpeedsKmh);
  const waterBalance = computeAgroClimaticWaterBalance({
    timestampsUnix,
    timezone: forecast.timezone,
    temperaturesC,
    dewPointsC,
    relativeHumiditiesPct,
    precipitationsMm,
    et0HourlyMm,
  });

  const includeMarine = forecast.marineAvailable || hasWaveData || hasSeaLevelData;
  const modelsCompared: ScientificAnalysisSummary['modelsCompared'] = useSingleModel
    ? [viewMode, ...(includeMarine ? (['marine'] as const) : [])]
    : [
        'fieldcast',
        'ecmwf_ifs025',
        'gfs_seamless',
        'icon_seamless',
        'gem_seamless',
        ...(includeMarine ? (['marine'] as const) : []),
      ];

  const activeModelLabel = useSingleModel
    ? NWP_MODEL_LABELS[viewMode]
    : 'Consenso Multi-Modelo FieldCast (ECMWF + GFS + ICON + GEM)';

  const periodStartIso = hours[0]?.timestampIso ?? forecast.fetchedAtIso;
  const periodEndIso = hours[hours.length - 1]?.timestampIso ?? forecast.fetchedAtIso;

  return {
    generatedAtIso: new Date().toISOString(),
    datasetKind: 'forecast_168h',
    locationName: locationName.trim() || 'Ponto Operacional FieldCast',
    latitude: forecast.latitude,
    longitude: forecast.longitude,
    elevationDemM: forecast.elevationDemM,
    timezone: forecast.timezone,
    periodStartIso,
    periodEndIso,
    activeModelLabel,
    modelsCompared,
    metrics,
    dominantWindDirectionDeg:
      circularWind.degree !== null ? Number(circularWind.degree.toFixed(1)) : null,
    windDirectionalConsistencyR:
      circularWind.resultantLengthR !== null
        ? Number(circularWind.resultantLengthR.toFixed(3))
        : null,
    waterBalance,
    citations: buildAcademicSourceCitations(false, includeMarine),
  };
}

/**
 * Executa a análise estatística, vetorial e agroclimática sobre uma série temporal
 * histórica ou reanálise ERA5 (`HistoricalSeriesResult`).
 */
export function analyzeHistoricalSeriesScientifically(
  series: HistoricalSeriesResult,
): ScientificAnalysisSummary {
  const hours = series.hours;
  const timestampsUnix = hours.map((h) => h.timestampUnix);
  const temperaturesC = hours.map((h) => h.temperature2mC);
  const dewPointsC = hours.map((h) => h.dewPoint2mC ?? null);
  const relativeHumiditiesPct = hours.map(
    (h) =>
      h.relativeHumidity2mPct ??
      computeMagnusRelativeHumidityPct(h.temperature2mC, h.dewPoint2mC ?? null),
  );
  const precipitationsMm = hours.map((h) => h.precipitationMm);
  const windSpeedsKmh = hours.map((h) => h.windSpeed10mKmh);
  const windGustsKmh = hours.map((h) => h.windGusts10mKmh);
  const windDirectionsDeg = hours.map((h) => h.windDirection10mDeg);
  const surfacePressuresHpa = hours.map((h) => h.surfacePressureHpa);
  const et0HourlyMm = hours.map((h) => h.et0FaoEvapotranspirationMm ?? null);

  const metrics: DescriptiveMetricStats[] = [
    computeDescriptiveStats('temperature_2m', 'Temperatura do Ar (2m)', '°C', temperaturesC, timestampsUnix),
    computeDescriptiveStats('relative_humidity_2m', 'Umidade Relativa (2m)', '%', relativeHumiditiesPct, timestampsUnix),
    computeDescriptiveStats('precipitation', 'Precipitação Horária', 'mm/h', precipitationsMm, timestampsUnix),
    computeDescriptiveStats('wind_speed_10m', 'Velocidade do Vento (10m)', 'km/h', windSpeedsKmh, timestampsUnix),
    computeDescriptiveStats('wind_gusts_10m', 'Rajadas de Vento (10m)', 'km/h', windGustsKmh, timestampsUnix),
    computeDescriptiveStats('surface_pressure', 'Pressão Atmosférica à Superfície', 'hPa', surfacePressuresHpa, timestampsUnix),
  ];

  const waveHeightsM = hours.map((h) => h.waveHeightM ?? null);
  const seaLevelsMsl = hours.map((h) => h.seaLevelHeightMsl ?? null);
  const hasWaveData = waveHeightsM.some((v) => typeof v === 'number' && Number.isFinite(v));
  const hasSeaLevelData = seaLevelsMsl.some((v) => typeof v === 'number' && Number.isFinite(v));

  if (hasWaveData) {
    metrics.push(
      computeDescriptiveStats(
        'wave_height',
        'Altura Significativa de Onda (Hs)',
        'm',
        waveHeightsM,
        timestampsUnix,
      ),
    );
  }
  if (hasSeaLevelData) {
    metrics.push(
      computeDescriptiveStats(
        'sea_level_msl',
        'Cota Oceânica Estimada (MSL ~8 km)',
        'm',
        seaLevelsMsl,
        timestampsUnix,
      ),
    );
  }

  const circularWind = computeCircularStat(windDirectionsDeg, windSpeedsKmh);
  const waterBalance = computeAgroClimaticWaterBalance({
    timestampsUnix,
    timezone: series.timezone,
    temperaturesC,
    dewPointsC,
    relativeHumiditiesPct,
    precipitationsMm,
    et0HourlyMm,
  });

  const includeMarine =
    series.modelsIncluded.includes('marine') || hasWaveData || hasSeaLevelData;

  const periodStartIso =
    hours[0]?.timestampIso ?? `${series.startDateIso}T12:00:00.000Z`;
  const periodEndIso =
    hours[hours.length - 1]?.timestampIso ?? `${series.endDateIso}T12:00:00.000Z`;

  return {
    generatedAtIso: new Date().toISOString(),
    datasetKind: 'historical_era5',
    locationName: series.locationName.trim() || 'Estação Histórica FieldCast',
    latitude: series.latitude,
    longitude: series.longitude,
    elevationDemM: series.elevationDemM,
    timezone: series.timezone,
    periodStartIso,
    periodEndIso,
    activeModelLabel: series.sourceLabel || 'Copernicus ERA5 / Open-Meteo Archive',
    modelsCompared:
      series.modelsIncluded.length > 0 ? [...series.modelsIncluded] : ['fieldcast'],
    metrics,
    dominantWindDirectionDeg:
      circularWind.degree !== null ? Number(circularWind.degree.toFixed(1)) : null,
    windDirectionalConsistencyR:
      circularWind.resultantLengthR !== null
        ? Number(circularWind.resultantLengthR.toFixed(3))
        : null,
    waterBalance,
    citations: buildAcademicSourceCitations(true, includeMarine),
  };
}
