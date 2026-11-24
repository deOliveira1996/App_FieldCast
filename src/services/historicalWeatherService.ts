import {
  getHistoricalRecurrenceRules,
  logErrorToDb,
  saveHistoricalLogEntry,
  saveHistoricalRecurrenceRule,
} from '../db/database';
import type {
  ExportFormat,
  HistoricalHourRecord,
  HistoricalLogEntry,
  HistoricalModelSelection,
  HistoricalSeriesRequest,
  HistoricalSeriesResult,
} from '../types/field';
import {
  OpenMeteoArchiveResponseSchema,
  OpenMeteoForecastResponseSchema,
  OpenMeteoMarineResponseSchema,
  type OpenMeteoArchiveResponse,
  type OpenMeteoForecastResponse,
  type OpenMeteoMarineResponse,
} from '../types/schemas';
import { WEATHER_MODELS, type WeatherModelId } from '../types/weather';
import { computeCircularStat, computeScalarStat } from '../utils/ensembleMath';
import {
  exportToGeoJson,
  exportToGpx,
  exportToKml,
  exportToKmz,
  UTF8_BOM,
} from '../utils/exporters';
import { formatLocalHourBadge, formatLocalYMD } from '../utils/localTimeHour';

export const OPEN_METEO_HISTORICAL_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
export const OPEN_METEO_HISTORICAL_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_HISTORICAL_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

export const HISTORICAL_HOURLY_VARIABLES = [
  'temperature_2m',
  'dew_point_2m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'precipitation',
  'surface_pressure',
] as const;

export const HISTORICAL_MARINE_VARIABLES = ['wave_height', 'sea_level_height_msl'] as const;
export const RECENT_NWP_MAX_PAST_DAYS = 60;

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseBareYmdToNoonUtcMs(dateIso: string): number {
  if (!DATE_ISO_RE.test(dateIso)) {
    throw new Error(`Data inválida '${dateIso}'. Use o formato YYYY-MM-DD.`);
  }
  const [yStr, mStr, dStr] = dateIso.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  const check = new Date(ms);
  if (
    Number.isNaN(ms) ||
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== m ||
    check.getUTCDate() !== d
  ) {
    throw new Error(`Data calendário inexistente '${dateIso}'.`);
  }
  return ms;
}

function getSelectedNwpModels(models: readonly HistoricalModelSelection[]): WeatherModelId[] {
  if (models.includes('fieldcast')) {
    return [...WEATHER_MODELS];
  }
  return models.filter((m): m is WeatherModelId =>
    (WEATHER_MODELS as readonly string[]).includes(m),
  );
}

export function buildHistoricalForecastUrl(params: {
  latitude: number;
  longitude: number;
  pastDays: number;
  models: readonly WeatherModelId[];
}): string {
  const modelsParam =
    params.models.length > 0 ? params.models.join(',') : WEATHER_MODELS.join(',');
  const search = new URLSearchParams({
    latitude: params.latitude.toFixed(4),
    longitude: params.longitude.toFixed(4),
    hourly: HISTORICAL_HOURLY_VARIABLES.join(','),
    models: modelsParam,
    past_days: String(Math.max(1, Math.min(92, Math.trunc(params.pastDays)))),
    forecast_days: '1',
    timeformat: 'unixtime',
    timezone: 'auto',
  });
  return `${OPEN_METEO_HISTORICAL_FORECAST_URL}?${search.toString()}`;
}

export function buildHistoricalMarineUrl(params: {
  latitude: number;
  longitude: number;
  pastDays: number;
}): string {
  const search = new URLSearchParams({
    latitude: params.latitude.toFixed(4),
    longitude: params.longitude.toFixed(4),
    hourly: HISTORICAL_MARINE_VARIABLES.join(','),
    past_days: String(Math.max(1, Math.min(92, Math.trunc(params.pastDays)))),
    forecast_days: '1',
    timeformat: 'unixtime',
    timezone: 'auto',
  });
  return `${OPEN_METEO_HISTORICAL_MARINE_URL}?${search.toString()}`;
}

export function buildHistoricalArchiveUrl(params: {
  latitude: number;
  longitude: number;
  startDateIso: string;
  endDateIso: string;
}): string {
  const search = new URLSearchParams({
    latitude: params.latitude.toFixed(4),
    longitude: params.longitude.toFixed(4),
    start_date: params.startDateIso,
    end_date: params.endDateIso,
    hourly: HISTORICAL_HOURLY_VARIABLES.join(','),
    timeformat: 'unixtime',
    timezone: 'auto',
  });
  return `${OPEN_METEO_HISTORICAL_ARCHIVE_URL}?${search.toString()}`;
}

async function fetchJsonWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = 12_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ao consultar série histórica`);
    }
    return await response.json();
  } finally {
    clearTimeout(timerId);
  }
}

function pickFiniteNumber(
  arr: readonly (number | null)[] | undefined,
  idx: number,
): number | null {
  if (!arr || idx < 0 || idx >= arr.length) return null;
  const val = arr[idx];
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function normalizeRecentNwpSeries(params: {
  req: HistoricalSeriesRequest;
  nwpModels: readonly WeatherModelId[];
  wantsMarine: boolean;
  forecastPayload: OpenMeteoForecastResponse;
  marinePayload: OpenMeteoMarineResponse | null;
}): HistoricalSeriesResult {
  const { req, nwpModels, wantsMarine, forecastPayload, marinePayload } = params;
  const timezone = forecastPayload.timezone || 'America/Sao_Paulo';
  const times = forecastPayload.hourly.time;
  const hourlyRecord = forecastPayload.hourly as unknown as Record<
    string,
    readonly (number | null)[] | undefined
  >;

  const marineIndexByUnix = new Map<number, number>();
  if (marinePayload) {
    marinePayload.hourly.time.forEach((ts, idx) => {
      marineIndexByUnix.set(ts, idx);
    });
  }

  const effectiveNwp: WeatherModelId[] =
    nwpModels.length > 0 ? [...nwpModels] : [...WEATHER_MODELS];
  const hours: HistoricalHourRecord[] = [];

  for (let idx = 0; idx < times.length; idx++) {
    const ts = times[idx]!;
    const localYmd = formatLocalYMD(new Date(ts * 1000), timezone);
    if (localYmd < req.startDateIso || localYmd > req.endDateIso) {
      continue;
    }

    const temps: Array<number | null> = [];
    const dewPoints: Array<number | null> = [];
    const winds: Array<number | null> = [];
    const gusts: Array<number | null> = [];
    const dirs: Array<number | null> = [];
    const precips: Array<number | null> = [];
    const pressures: Array<number | null> = [];

    const byModel: NonNullable<HistoricalHourRecord['byModel']> = {};

    for (const modelId of effectiveNwp) {
      const readVar = (prefix: string): number | null => {
        const suffixed = pickFiniteNumber(hourlyRecord[`${prefix}_${modelId}`], idx);
        if (suffixed !== null) return suffixed;
        if (effectiveNwp.length === 1) {
          return pickFiniteNumber(hourlyRecord[prefix], idx);
        }
        return null;
      };

      const t = readVar('temperature_2m');
      const dp = readVar('dew_point_2m');
      const ws = readVar('wind_speed_10m');
      const wg = readVar('wind_gusts_10m');
      const wd = readVar('wind_direction_10m');
      const pr = readVar('precipitation');
      const sp = readVar('surface_pressure');

      temps.push(t);
      dewPoints.push(dp);
      winds.push(ws);
      gusts.push(wg);
      dirs.push(wd);
      precips.push(pr);
      pressures.push(sp);

      if (req.models.includes(modelId)) {
        byModel[modelId] = {
          temperature2mC: t,
          windSpeed10mKmh: ws,
          windGusts10mKmh: wg,
          windDirection10mDeg: wd,
          precipitationMm: pr,
          surfacePressureHpa: sp,
        };
      }
    }

    const tempMean = computeScalarStat(temps).mean;
    const dewMean = computeScalarStat(dewPoints).mean;
    const windMean = computeScalarStat(winds).mean;
    const gustMean = computeScalarStat(gusts).mean;
    const dirMean = computeCircularStat(dirs, winds).degree;
    const precipMean = computeScalarStat(precips).mean;
    const pressureMean = computeScalarStat(pressures).mean;

    if (req.models.includes('fieldcast')) {
      byModel.fieldcast = {
        temperature2mC: tempMean,
        windSpeed10mKmh: windMean,
        windGusts10mKmh: gustMean,
        windDirection10mDeg: dirMean,
        precipitationMm: precipMean,
        surfacePressureHpa: pressureMean,
      };
    }

    let waveHeightM: number | null = null;
    let seaLevelHeightMsl: number | null = null;
    if (wantsMarine && marinePayload) {
      const mIdx = marineIndexByUnix.get(ts);
      if (mIdx !== undefined) {
        waveHeightM = pickFiniteNumber(marinePayload.hourly.wave_height, mIdx);
        seaLevelHeightMsl = pickFiniteNumber(marinePayload.hourly.sea_level_height_msl, mIdx);
        byModel.marine = {
          waveHeightM,
          seaLevelHeightMsl,
        };
      }
    }

    hours.push({
      timestampUnix: ts,
      timestampIso: new Date(ts * 1000).toISOString(),
      source:
        effectiveNwp.length === 1
          ? `Open-Meteo NWP (${effectiveNwp[0]})`
          : 'Open-Meteo NWP Multi-Modelo',
      temperature2mC: tempMean,
      dewPoint2mC: dewMean,
      windSpeed10mKmh: windMean,
      windGusts10mKmh: gustMean,
      windDirection10mDeg: dirMean,
      precipitationMm: precipMean,
      surfacePressureHpa: pressureMean,
      ...(wantsMarine ? { waveHeightM, seaLevelHeightMsl } : {}),
      ...(Object.keys(byModel).length > 0 ? { byModel } : {}),
    });
  }

  return {
    locationName: req.locationName,
    latitude: forecastPayload.latitude,
    longitude: forecastPayload.longitude,
    elevationDemM: forecastPayload.elevation,
    timezone,
    startDateIso: req.startDateIso,
    endDateIso: req.endDateIso,
    modelsIncluded: [...req.models],
    sourceLabel:
      effectiveNwp.length > 1
        ? `Open-Meteo Forecast NWP (${effectiveNwp.join(', ')})`
        : `Open-Meteo Forecast NWP (${effectiveNwp[0]})`,
    fetchedAtIso: new Date().toISOString(),
    hours,
  };
}

function normalizeArchiveSeries(
  req: HistoricalSeriesRequest,
  archivePayload: OpenMeteoArchiveResponse,
): HistoricalSeriesResult {
  const timezone = archivePayload.timezone || 'America/Sao_Paulo';
  const times = archivePayload.hourly.time;
  const h = archivePayload.hourly;
  const hours: HistoricalHourRecord[] = [];

  for (let idx = 0; idx < times.length; idx++) {
    const ts = times[idx]!;
    const localYmd = formatLocalYMD(new Date(ts * 1000), timezone);
    if (localYmd < req.startDateIso || localYmd > req.endDateIso) {
      continue;
    }

    hours.push({
      timestampUnix: ts,
      timestampIso: new Date(ts * 1000).toISOString(),
      source: 'Open-Meteo ERA5 Archive',
      temperature2mC: pickFiniteNumber(h.temperature_2m, idx),
      dewPoint2mC: pickFiniteNumber(h.dew_point_2m, idx),
      windSpeed10mKmh: pickFiniteNumber(h.wind_speed_10m, idx),
      windGusts10mKmh: pickFiniteNumber(h.wind_gusts_10m, idx),
      windDirection10mDeg: pickFiniteNumber(h.wind_direction_10m, idx),
      precipitationMm: pickFiniteNumber(h.precipitation, idx),
      surfacePressureHpa: pickFiniteNumber(h.surface_pressure, idx),
    });
  }

  return {
    locationName: req.locationName,
    latitude: archivePayload.latitude,
    longitude: archivePayload.longitude,
    elevationDemM: archivePayload.elevation,
    timezone,
    startDateIso: req.startDateIso,
    endDateIso: req.endDateIso,
    modelsIncluded: [...req.models],
    sourceLabel: 'Open-Meteo ERA5 Reanálise Histórica (Archive)',
    fetchedAtIso: new Date().toISOString(),
    hours,
  };
}

export interface FetchHistoricalOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
}

/**
 * Consulta séries históricas horárias sob demanda na Open-Meteo:
 * - Intervalo recente (<= 60 dias e até hoje) com modelos NWP individuais/ensemble ou marinho: usa `/v1/forecast` (`past_days`) + `/v1/marine`.
 * - Intervalo > 60 dias ou fallback automático: usa `archive-api.open-meteo.com/v1/archive` validado por `OpenMeteoArchiveResponseSchema`.
 */
export async function fetchHistoricalTimeSeries(
  req: HistoricalSeriesRequest,
  options?: FetchHistoricalOptions,
): Promise<HistoricalSeriesResult> {
  const startMs = parseBareYmdToNoonUtcMs(req.startDateIso);
  const endMs = parseBareYmdToNoonUtcMs(req.endDateIso);

  if (req.startDateIso > req.endDateIso || startMs > endMs) {
    throw new Error(
      `Intervalo histórico inválido: data inicial (${req.startDateIso}) é posterior à final (${req.endDateIso}).`,
    );
  }

  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('Cliente HTTP (fetch) indisponível neste ambiente.');
  }

  const now = options?.now ?? new Date();
  const todayYmd = formatLocalYMD(now);
  const todayNoonMs = parseBareYmdToNoonUtcMs(todayYmd);
  const daysAgoStart = Math.round((todayNoonMs - startMs) / 86_400_000);

  const normalizedReq: HistoricalSeriesRequest = {
    ...req,
    models: req.models.length > 0 ? req.models : ['fieldcast'],
  };
  const nwpModels = getSelectedNwpModels(normalizedReq.models);
  const wantsMarine = normalizedReq.models.includes('marine');
  const canUseRecentNwp =
    daysAgoStart >= 0 &&
    daysAgoStart <= RECENT_NWP_MAX_PAST_DAYS &&
    normalizedReq.endDateIso <= todayYmd &&
    (nwpModels.length > 0 || wantsMarine);

  let recentNwpError: Error | null = null;
  if (canUseRecentNwp) {
    const pastDays = Math.max(1, Math.min(92, daysAgoStart + 1));
    const forecastUrl = buildHistoricalForecastUrl({
      latitude: normalizedReq.latitude,
      longitude: normalizedReq.longitude,
      pastDays,
      models: nwpModels,
    });
    const marineUrl = wantsMarine
      ? buildHistoricalMarineUrl({
          latitude: normalizedReq.latitude,
          longitude: normalizedReq.longitude,
          pastDays,
        })
      : null;

    try {
      const [rawForecast, rawMarine] = await Promise.all([
        fetchJsonWithTimeout(forecastUrl, fetchImpl, options?.timeoutMs),
        marineUrl
          ? fetchJsonWithTimeout(marineUrl, fetchImpl, options?.timeoutMs).catch(() => null)
          : Promise.resolve(null),
      ]);

      const parsedForecast = OpenMeteoForecastResponseSchema.parse(rawForecast);
      const parsedMarine = rawMarine
        ? OpenMeteoMarineResponseSchema.safeParse(rawMarine)
        : null;

      const result = normalizeRecentNwpSeries({
        req: normalizedReq,
        nwpModels,
        wantsMarine,
        forecastPayload: parsedForecast,
        marinePayload: parsedMarine?.success ? parsedMarine.data : null,
      });

      if (result.hours.length > 0) {
        return result;
      }
    } catch (err) {
      recentNwpError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Archive API (> 60 dias ou fallback quando NWP recente falhar / retornar vazio)
  const archiveUrl = buildHistoricalArchiveUrl({
    latitude: normalizedReq.latitude,
    longitude: normalizedReq.longitude,
    startDateIso: normalizedReq.startDateIso,
    endDateIso: normalizedReq.endDateIso,
  });

  try {
    const rawArchive = await fetchJsonWithTimeout(archiveUrl, fetchImpl, options?.timeoutMs);
    const parsedArchive = OpenMeteoArchiveResponseSchema.parse(rawArchive);
    return normalizeArchiveSeries(normalizedReq, parsedArchive);
  } catch (archiveErr) {
    if (recentNwpError) {
      throw recentNwpError;
    }
    throw archiveErr instanceof Error ? archiveErr : new Error(String(archiveErr));
  }
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function fmtNum(val: number | null | undefined, decimals = 2): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '';
  return val.toFixed(decimals);
}

function slugifyLocationName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'local';
}

/**
 * Exporta o resultado de uma série histórica (`HistoricalSeriesResult`) para CSV (BOM UTF-8),
 * JSON, KML ou KMZ (Google Earth).
 */
export function exportHistoricalSeriesArtifact(
  result: HistoricalSeriesResult,
  format: ExportFormat,
): { filename: string; content: string | Uint8Array; format: ExportFormat } {
  const slug = slugifyLocationName(result.locationName);
  const baseName = `fieldcast-historico-${slug}-${result.startDateIso}_a_${result.endDateIso}`;

  if (format === 'json') {
    return {
      filename: `${baseName}.json`,
      content: JSON.stringify(result, null, 2),
      format,
    };
  }

  if (format === 'kml') {
    return {
      filename: `${baseName}.kml`,
      content: exportToKml({
        historical: result,
        name: `FieldCast Histórico — ${result.locationName} (${result.startDateIso} a ${result.endDateIso})`,
      }),
      format,
    };
  }

  if (format === 'kmz') {
    return {
      filename: `${baseName}.kmz`,
      content: exportToKmz({
        historical: result,
        name: `FieldCast Histórico — ${result.locationName} (${result.startDateIso} a ${result.endDateIso})`,
      }),
      format,
    };
  }

  if (format === 'geojson') {
    return {
      filename: `${baseName}.geojson`,
      content: exportToGeoJson({}),
      format,
    };
  }

  if (format === 'gpx') {
    return {
      filename: `${baseName}.gpx`,
      content: exportToGpx({
        name: `FieldCast Histórico — ${result.locationName}`,
      }),
      format,
    };
  }

  // format === 'csv'
  const modelCols = result.modelsIncluded.filter((m) =>
    result.hours.some((h) => h.byModel && h.byModel[m] !== undefined),
  );

  const headers = [
    'timestamp_unix',
    'timestamp_iso',
    'local_date',
    'local_hour',
    'source',
    'latitude',
    'longitude',
    'elevation_dem_m',
    'temperature_2m_c',
    'dew_point_2m_c',
    'wind_speed_10m_kmh',
    'wind_gusts_10m_kmh',
    'wind_direction_10m_deg',
    'precipitation_mm',
    'surface_pressure_hpa',
    'wave_height_m',
    'sea_level_height_msl',
  ];

  for (const m of modelCols) {
    if (m === 'marine') {
      headers.push('marine_wave_height_m', 'marine_sea_level_height_msl');
    } else {
      headers.push(
        `${m}_temp_2m_c`,
        `${m}_wind_speed_10m_kmh`,
        `${m}_wind_gusts_10m_kmh`,
        `${m}_wind_direction_10m_deg`,
        `${m}_precipitation_mm`,
        `${m}_surface_pressure_hpa`,
      );
    }
  }

  const rows: string[] = [headers.join(',')];

  for (const hr of result.hours) {
    const localDate = formatLocalYMD(new Date(hr.timestampUnix * 1000), result.timezone);
    const localHour = formatLocalHourBadge(hr.timestampUnix, result.timezone);

    const row: unknown[] = [
      hr.timestampUnix,
      hr.timestampIso,
      localDate,
      localHour,
      hr.source,
      fmtNum(result.latitude, 4),
      fmtNum(result.longitude, 4),
      fmtNum(result.elevationDemM, 1),
      fmtNum(hr.temperature2mC, 1),
      fmtNum(hr.dewPoint2mC, 1),
      fmtNum(hr.windSpeed10mKmh, 1),
      fmtNum(hr.windGusts10mKmh, 1),
      fmtNum(hr.windDirection10mDeg, 0),
      fmtNum(hr.precipitationMm, 2),
      fmtNum(hr.surfacePressureHpa, 1),
      fmtNum(hr.waveHeightM, 2),
      fmtNum(hr.seaLevelHeightMsl, 3),
    ];

    for (const m of modelCols) {
      const mData = hr.byModel?.[m];
      if (m === 'marine') {
        row.push(fmtNum(mData?.waveHeightM, 2), fmtNum(mData?.seaLevelHeightMsl, 3));
      } else {
        row.push(
          fmtNum(mData?.temperature2mC, 1),
          fmtNum(mData?.windSpeed10mKmh, 1),
          fmtNum(mData?.windGusts10mKmh, 1),
          fmtNum(mData?.windDirection10mDeg, 0),
          fmtNum(mData?.precipitationMm, 2),
          fmtNum(mData?.surfacePressureHpa, 1),
        );
      }
    }

    rows.push(row.map(escapeCsvCell).join(','));
  }

  return {
    filename: `${baseName}.csv`,
    content: UTF8_BOM + rows.join('\r\n'),
    format,
  };
}

/**
 * Avalia regras de recorrência histórica habilitadas no Dexie (`nextDueIso <= now`),
 * consulta o intervalo fechado recém-concluído, salva o `HistoricalLogEntry` e avança `nextDueIso`.
 * Falhas de rede são capturadas graciosamente sem interromper o app.
 */
export async function evaluateDueRecurrenceRules(
  now: Date = new Date(),
  options?: { fetchImpl?: typeof fetch },
): Promise<{ dueCount: number; generatedLogs: HistoricalLogEntry[] }> {
  const rules = await getHistoricalRecurrenceRules();
  const dueRules = rules.filter((r) => {
    if (!r.enabled) return false;
    const dueMs = new Date(r.nextDueIso).getTime();
    return Number.isFinite(dueMs) && now.getTime() >= dueMs;
  });

  const generatedLogs: HistoricalLogEntry[] = [];

  for (const rule of dueRules) {
    const endDateAnchor = new Date(now.getTime() - 86_400_000);
    const startDateAnchor = new Date(now.getTime() - rule.intervalDays * 86_400_000);
    const startDateIso = formatLocalYMD(startDateAnchor);
    const endDateIso = formatLocalYMD(endDateAnchor);

    try {
      const result = await fetchHistoricalTimeSeries(
        {
          locationName: rule.locationName,
          latitude: rule.latitude,
          longitude: rule.longitude,
          startDateIso,
          endDateIso,
          models: rule.models,
        },
        {
          fetchImpl: options?.fetchImpl,
          now,
        },
      );

      const entry: HistoricalLogEntry = {
        id: `hlog-${rule.id}-${now.getTime()}`,
        ruleId: rule.id,
        createdAtIso: now.toISOString(),
        locationName: rule.locationName,
        startDateIso,
        endDateIso,
        modelsIncluded: result.modelsIncluded,
        recordCount: result.hours.length,
        format: rule.format,
        result,
      };

      await saveHistoricalLogEntry(entry);
      generatedLogs.push(entry);

      const nextDueMs = Math.max(
        now.getTime() + rule.intervalDays * 86_400_000,
        new Date(rule.nextDueIso).getTime() + rule.intervalDays * 86_400_000,
      );

      await saveHistoricalRecurrenceRule({
        ...rule,
        lastRunIso: now.toISOString(),
        nextDueIso: new Date(nextDueMs).toISOString(),
      });
    } catch (err) {
      await logErrorToDb({
        timestampUtcIso: now.toISOString(),
        module: 'historicalWeatherService',
        action: `evaluateDueRecurrenceRules:${rule.id}`,
        message:
          err instanceof Error ? err.message : 'Falha ao executar log histórico recorrente',
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  return {
    dueCount: dueRules.length,
    generatedLogs,
  };
}
