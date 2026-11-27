import { z } from 'zod';
import type { AppLocale } from '../i18n/translations';
import { NullableNumberArraySchema } from '../types/schemas';
import type { SafeWindowStatus } from '../types/weather';
import {
  decomposeMeteorologicalVector,
  normalizeAngleDeg,
  reconstructDirectionFromUV,
} from '../utils/ensembleMath';
import {
  buildPureZipArchiveBytes,
  formatCardinalDirection,
  UTF8_BOM,
} from '../utils/exporters';
import { formatLocalHourBadge, formatLocalYMD } from '../utils/localTimeHour';
import {
  computeRelativeWindAngleDeg,
  type RelativeWindAnalysis,
  type RouteCheckpoint,
} from '../utils/routeImporter';
import { fetchWithCircuitBreaker } from './httpClient';

export type RouteMissionCategory = 'navigation' | 'aerial';

export interface RouteForecastLimits {
  maxWindKmh?: number;
  maxGustKmh?: number;
  maxWaveM?: number;
  maxPrecipProbPct?: number;
  maxCapeJkg?: number;
  minVisibilityKm?: number;
}

export interface RouteForecastRequest {
  routeName: string;
  category: RouteMissionCategory;
  checkpoints: readonly RouteCheckpoint[];
  departureUnix: number;
  avgSpeedKmh: number;
  /** Altitude operacional em metros AGL (10..1000 m; foco principal 10..120 m para drones/VANTs). */
  altitudeM?: number;
  limits?: RouteForecastLimits;
}

export interface RouteCheckpointForecast {
  checkpoint: RouteCheckpoint;
  etaUnix: number;
  etaIso: string;
  matchedHourUnix: number;
  matchedHourIso: string;
  timezone: string;
  elevationDemM: number;
  temperature2mC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  windSpeed10mKmh: number | null;
  windDirection10mDeg: number | null;
  windGusts10mKmh: number | null;
  windSpeed80mKmh: number | null;
  windSpeed120mKmh: number | null;
  windSpeed925hPaKmh: number | null;
  windDirection925hPaDeg: number | null;
  operationalWindKmh: number | null;
  operationalWindDirDeg: number | null;
  operationalAltitudeM: number;
  windShearKtPer100ft: number | null;
  cloudCoverLowPct: number | null;
  cloudCoverMidPct: number | null;
  cloudCoverHighPct: number | null;
  visibilityM: number | null;
  capeJkg: number | null;
  relativeWind: RelativeWindAnalysis | null;
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveDirectionDeg: number | null;
  oceanCurrentVelocityKmh: number | null;
  oceanCurrentDirectionDeg: number | null;
  seaLevelHeightMslM: number | null;
  marineAvailable: boolean;
  status: SafeWindowStatus;
  reasons: string[];
}

export interface RouteForecast4DResult {
  routeName: string;
  category: RouteMissionCategory;
  generatedAtIso: string;
  departureUnix: number;
  departureIso: string;
  arrivalUnix: number;
  arrivalIso: string;
  avgSpeedKmh: number;
  operationalAltitudeM: number;
  totalDistanceKm: number;
  estimatedDurationHours: number;
  overallStatus: SafeWindowStatus;
  marineCoveredCount: number;
  hasMarineTideData: boolean;
  worstCheckpointIndex: number;
  checkpoints: RouteCheckpointForecast[];
  disclaimers: string[];
}

const OPEN_METEO_FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';

const ROUTE_FORECAST_HOURLY_VARS = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'wind_speed_80m',
  'wind_speed_120m',
  'wind_speed_925hPa',
  'wind_direction_925hPa',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'visibility',
  'cape',
].join(',');

const ROUTE_MARINE_HOURLY_VARS = [
  'wave_height',
  'wave_period',
  'wave_direction',
  'ocean_current_velocity',
  'ocean_current_direction',
  'sea_level_height_msl',
].join(',');

const RouteBatchForecastPointSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    elevation: z.number().optional().default(0),
    timezone: z.string().optional().default('UTC'),
    utc_offset_seconds: z.number().optional().default(0),
    hourly: z
      .object({
        time: z.array(z.number()),
        temperature_2m: NullableNumberArraySchema.optional(),
        precipitation: NullableNumberArraySchema.optional(),
        precipitation_probability: NullableNumberArraySchema.optional(),
        wind_speed_10m: NullableNumberArraySchema.optional(),
        wind_direction_10m: NullableNumberArraySchema.optional(),
        wind_gusts_10m: NullableNumberArraySchema.optional(),
        wind_speed_80m: NullableNumberArraySchema.optional(),
        wind_speed_120m: NullableNumberArraySchema.optional(),
        wind_speed_925hPa: NullableNumberArraySchema.optional(),
        wind_direction_925hPa: NullableNumberArraySchema.optional(),
        cloud_cover_low: NullableNumberArraySchema.optional(),
        cloud_cover_mid: NullableNumberArraySchema.optional(),
        cloud_cover_high: NullableNumberArraySchema.optional(),
        visibility: NullableNumberArraySchema.optional(),
        cape: NullableNumberArraySchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

const RouteBatchForecastResponseSchema = z.union([
  z.array(RouteBatchForecastPointSchema),
  RouteBatchForecastPointSchema,
]);

const RouteBatchMarinePointSchema = z
  .object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    hourly: z
      .object({
        time: z.array(z.number()),
        wave_height: NullableNumberArraySchema.optional(),
        wave_period: NullableNumberArraySchema.optional(),
        wave_direction: NullableNumberArraySchema.optional(),
        ocean_current_velocity: NullableNumberArraySchema.optional(),
        ocean_current_direction: NullableNumberArraySchema.optional(),
        sea_level_height_msl: NullableNumberArraySchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

const RouteBatchMarineResponseSchema = z.union([
  z.array(RouteBatchMarinePointSchema),
  RouteBatchMarinePointSchema,
]);

type RouteBatchForecastPoint = z.infer<typeof RouteBatchForecastPointSchema>;
type RouteBatchMarinePoint = z.infer<typeof RouteBatchMarinePointSchema>;

const KMH_TO_KNOTS = 1 / 1.852;
const METERS_TO_FEET = 3.28084;
const PRESSURE_925HPA_APPROX_M = 800;

export const ROUTE_DHN_DISCLAIMER_PT =
  'Aviso Hidrográfico Obrigatório: A cota oceânica estimada (sea_level_height_msl, grade ~8 km) e os vetores marinhos são referências hidrodinâmicas e NÃO substituem as tábuas de marés oficiais da DHN / Marinha do Brasil nem cartas náuticas homologadas.';
export const ROUTE_DHN_DISCLAIMER_EN =
  'Mandatory Hydrographic Notice: Estimated MSL sea level (sea_level_height_msl, ~8 km grid) and marine vectors are hydrodynamic references and do NOT replace official DHN / Brazilian Navy tide tables or approved nautical charts.';

export const ROUTE_AERIAL_DISCLAIMER_PT =
  'Aviso Aeronáutico (REDEMET / DECEA): Esta previsão 4D é apoio auxiliar de planejamento operacional e NÃO substitui briefings oficiais METAR/TAF/SIGMET da REDEMET/DECEA, NOTAMs nem autorizações SARPAS/DECEA.';
export const ROUTE_AERIAL_DISCLAIMER_EN =
  'Aviation Advisory (REDEMET / DECEA): This 4D forecast is a planning aid only and does NOT replace official REDEMET/DECEA METAR/TAF/SIGMET briefings, NOTAMs, or SARPAS/DECEA flight authorizations.';

function pickAt(arr: readonly (number | null)[] | undefined, idx: number): number | null {
  if (!arr || idx < 0 || idx >= arr.length) return null;
  const v = arr[idx];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function findNearestTimeIndex(times: readonly number[], targetUnix: number): number {
  if (times.length === 0) return 0;
  let bestIdx = 0;
  let bestDiff = Math.abs(times[0]! - targetUnix);
  for (let i = 1; i < times.length; i++) {
    const diff = Math.abs(times[i]! - targetUnix);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Interpola suavemente a velocidade do vento para uma altitude alvo (10m..1000m)
 * através dos níveis nativos `10m -> 80m -> 120m -> 925 hPa (~800m)`.
 */
export function interpolateAerialWindSpeedKmh(
  altitudeM: number,
  levels: {
    w10: number | null;
    w80: number | null;
    w120: number | null;
    w925: number | null;
  },
): number | null {
  const clampedAlt = Math.max(10, Math.min(1000, altitudeM));
  const anchors: Array<{ h: number; v: number }> = [];
  if (levels.w10 !== null) anchors.push({ h: 10, v: levels.w10 });
  if (levels.w80 !== null) anchors.push({ h: 80, v: levels.w80 });
  if (levels.w120 !== null) anchors.push({ h: 120, v: levels.w120 });
  if (levels.w925 !== null) anchors.push({ h: PRESSURE_925HPA_APPROX_M, v: levels.w925 });

  if (anchors.length === 0) return null;
  if (anchors.length === 1) return Number(anchors[0]!.v.toFixed(1));

  if (clampedAlt <= anchors[0]!.h) {
    return Number(anchors[0]!.v.toFixed(1));
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const low = anchors[i]!;
    const high = anchors[i + 1]!;
    if (clampedAlt >= low.h && clampedAlt <= high.h) {
      const frac = (clampedAlt - low.h) / (high.h - low.h);
      return Number((low.v + (high.v - low.v) * frac).toFixed(1));
    }
  }

  // Acima do último nível nativo (ex.: 800..1000m): aplica ajuste conservador ou retém 925 hPa
  const last = anchors[anchors.length - 1]!;
  const prev = anchors[anchors.length - 2]!;
  if (clampedAlt > last.h && last.h >= PRESSURE_925HPA_APPROX_M) {
    const slope = (last.v - prev.v) / Math.max(1, last.h - prev.h);
    const dampedExtrap = last.v + slope * (clampedAlt - last.h) * 0.5;
    return Number(Math.max(0, dampedExtrap).toFixed(1));
  }

  return Number(last.v.toFixed(1));
}

function interpolateAerialWindDirectionDeg(
  altitudeM: number,
  dir10: number | null,
  dir925: number | null,
): number | null {
  if (dir10 === null && dir925 === null) return null;
  if (dir10 !== null && dir925 === null) return Number(normalizeAngleDeg(dir10).toFixed(1));
  if (dir10 === null && dir925 !== null) return Number(normalizeAngleDeg(dir925).toFixed(1));

  const t = Math.max(
    0,
    Math.min(1, (altitudeM - 10) / (PRESSURE_925HPA_APPROX_M - 10)),
  );
  const vLow = decomposeMeteorologicalVector(dir10!, 1);
  const vHigh = decomposeMeteorologicalVector(dir925!, 1);
  const u = (1 - t) * vLow.u + t * vHigh.u;
  const v = (1 - t) * vLow.v + t * vHigh.v;
  const reconstructed = reconstructDirectionFromUV(u, v);
  return Number((reconstructed ?? normalizeAngleDeg(dir10!)).toFixed(1));
}

function computeCheckpointShearKtPer100ft(params: {
  w10: number | null;
  dir10: number | null;
  w80: number | null;
  w120: number | null;
  w925: number | null;
  dir925: number | null;
  targetAltM: number;
}): number | null {
  const { w10, dir10, w80, w120, w925, dir925, targetAltM } = params;
  if (w10 === null || w10 < 0) return null;

  let zUpper: number | null = null;
  let wUpper: number | null = null;
  let dirUpper: number | null = dir10;

  if (targetAltM > 150 && w925 !== null) {
    zUpper = PRESSURE_925HPA_APPROX_M;
    wUpper = w925;
    dirUpper = dir925 ?? dir10;
  } else if (w120 !== null && targetAltM >= 100) {
    zUpper = 120;
    wUpper = w120;
    dirUpper = interpolateAerialWindDirectionDeg(120, dir10, dir925);
  } else if (w80 !== null) {
    zUpper = 80;
    wUpper = w80;
    dirUpper = interpolateAerialWindDirectionDeg(80, dir10, dir925);
  } else if (w120 !== null) {
    zUpper = 120;
    wUpper = w120;
    dirUpper = interpolateAerialWindDirectionDeg(120, dir10, dir925);
  } else if (w925 !== null) {
    zUpper = PRESSURE_925HPA_APPROX_M;
    wUpper = w925;
    dirUpper = dir925 ?? dir10;
  }

  if (zUpper === null || wUpper === null) return null;

  const s10Kt = w10 * KMH_TO_KNOTS;
  const sUpKt = wUpper * KMH_TO_KNOTS;

  let vectorDiffKt: number;
  if (dir10 !== null && dirUpper !== null) {
    const v10 = s10Kt > 0 ? decomposeMeteorologicalVector(dir10, s10Kt) : { u: 0, v: 0 };
    const vUp = sUpKt > 0 ? decomposeMeteorologicalVector(dirUpper, sUpKt) : { u: 0, v: 0 };
    vectorDiffKt = Math.hypot(vUp.u - v10.u, vUp.v - v10.v);
  } else {
    vectorDiffKt = Math.abs(sUpKt - s10Kt);
  }

  const thickness100Ft = ((zUpper - 10) * METERS_TO_FEET) / 100;
  if (thickness100Ft <= 0) return null;

  return Number((vectorDiffKt / thickness100Ft).toFixed(2));
}

function gradeCheckpointStatus(params: {
  category: RouteMissionCategory;
  operationalWindKmh: number | null;
  gustKmh: number | null;
  precipProbPct: number | null;
  precipMm: number | null;
  waveHeightM: number | null;
  visibilityM: number | null;
  capeJkg: number | null;
  cloudLowPct: number | null;
  windShearKtPer100ft: number | null;
  limits?: RouteForecastLimits;
}): { status: SafeWindowStatus; reasons: string[] } {
  const isAerial = params.category === 'aerial';
  const maxWind = params.limits?.maxWindKmh ?? (isAerial ? 35 : 30);
  const maxGust = params.limits?.maxGustKmh ?? (isAerial ? 48 : 45);
  const maxWave = params.limits?.maxWaveM ?? 2.0;
  const maxPrecipProb = params.limits?.maxPrecipProbPct ?? (isAerial ? 50 : 60);
  const maxCape = params.limits?.maxCapeJkg ?? 1000;
  const minVisKm = params.limits?.minVisibilityKm ?? (isAerial ? 5.0 : 3.0);

  let status: SafeWindowStatus = 'green';
  const reasons: string[] = [];

  const escalate = (next: SafeWindowStatus, reason: string) => {
    reasons.push(reason);
    if (next === 'red') {
      status = 'red';
    } else if (next === 'amber' && status === 'green') {
      status = 'amber';
    }
  };

  if (params.operationalWindKmh !== null) {
    if (params.operationalWindKmh >= maxWind) {
      escalate('red', `Vento ${params.operationalWindKmh.toFixed(1)} km/h >= ${maxWind} km/h`);
    } else if (params.operationalWindKmh >= maxWind * 0.8) {
      escalate('amber', `Vento em atenção (${params.operationalWindKmh.toFixed(1)} km/h)`);
    }
  }

  if (params.gustKmh !== null) {
    if (params.gustKmh >= maxGust) {
      escalate('red', `Rajadas ${params.gustKmh.toFixed(1)} km/h >= ${maxGust} km/h`);
    } else if (params.gustKmh >= maxGust * 0.8) {
      escalate('amber', `Rajadas elevadas (${params.gustKmh.toFixed(1)} km/h)`);
    }
  }

  if (!isAerial && params.waveHeightM !== null) {
    if (params.waveHeightM >= maxWave) {
      escalate('red', `Ondas Hs ${params.waveHeightM.toFixed(2)} m >= ${maxWave} m`);
    } else if (params.waveHeightM >= maxWave * 0.8) {
      escalate('amber', `Mar moderado (${params.waveHeightM.toFixed(2)} m)`);
    }
  }

  if (params.precipProbPct !== null) {
    if (params.precipProbPct >= maxPrecipProb) {
      escalate('red', `Prob. chuva ${Math.round(params.precipProbPct)}% >= ${maxPrecipProb}%`);
    } else if (params.precipProbPct >= maxPrecipProb * 0.8) {
      escalate('amber', `Chuva possível (${Math.round(params.precipProbPct)}%)`);
    }
  }

  if (params.precipMm !== null && params.precipMm >= 5) {
    escalate('red', `Precipitação forte (${params.precipMm.toFixed(1)} mm/h)`);
  } else if (params.precipMm !== null && params.precipMm >= 1.5) {
    escalate('amber', `Precipitação moderada (${params.precipMm.toFixed(1)} mm/h)`);
  }

  if (params.capeJkg !== null) {
    if (params.capeJkg >= Math.max(1500, maxCape * 1.4)) {
      escalate('red', `Instabilidade severa (CAPE ${Math.round(params.capeJkg)} J/kg)`);
    } else if (params.capeJkg >= maxCape) {
      escalate('amber', `Instabilidade convectiva (CAPE ${Math.round(params.capeJkg)} J/kg)`);
    }
  }

  if (params.visibilityM !== null) {
    const visKm = params.visibilityM / 1000;
    if (visKm < minVisKm * 0.5) {
      escalate('red', `Visibilidade crítica (${visKm.toFixed(1)} km)`);
    } else if (visKm < minVisKm) {
      escalate('amber', `Visibilidade restrita (${visKm.toFixed(1)} km)`);
    }
  }

  if (isAerial && params.windShearKtPer100ft !== null) {
    if (params.windShearKtPer100ft >= 10) {
      escalate('red', `Wind shear severo (${params.windShearKtPer100ft.toFixed(1)} kt/100ft)`);
    } else if (params.windShearKtPer100ft >= 6) {
      escalate('amber', `Wind shear moderado (${params.windShearKtPer100ft.toFixed(1)} kt/100ft)`);
    }
  }

  if (isAerial && params.cloudLowPct !== null && params.cloudLowPct >= 85) {
    escalate('amber', `Teto baixo / nuvens baixas ${Math.round(params.cloudLowPct)}%`);
  }

  if (reasons.length === 0) {
    reasons.push('Condições operacionais dentro dos limites configurados');
  }

  return { status, reasons };
}

/**
 * Executa previsão 4D espaço-temporal ao longo de 2..20 checkpoints em UMA única chamada
 * batch na Open-Meteo Forecast API (e UMA chamada batch na Marine API quando `category === 'navigation'`),
 * casando cada ponto com o horário exato de chegada (ETA).
 */
export async function fetch4DRouteForecast(
  req: RouteForecastRequest,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<RouteForecast4DResult> {
  if (!Array.isArray(req.checkpoints) || req.checkpoints.length < 2) {
    throw new Error('A rota 4D exige pelo menos 2 checkpoints válidos.');
  }
  if (req.checkpoints.length > 20) {
    throw new Error('A rota 4D aceita no máximo 20 checkpoints por consulta batch.');
  }
  if (!Number.isFinite(req.avgSpeedKmh) || req.avgSpeedKmh <= 0) {
    throw new Error('Velocidade média de deslocamento deve ser maior que zero.');
  }
  if (!Number.isFinite(req.departureUnix)) {
    throw new Error('Horário de partida inválido.');
  }

  const checkpoints = req.checkpoints;
  const operationalAltitudeM =
    req.category === 'aerial'
      ? Math.max(10, Math.min(1000, Math.round(req.altitudeM ?? 100)))
      : 10;

  const lats = checkpoints.map((c) => c.latitude.toFixed(5)).join(',');
  const lons = checkpoints.map((c) => c.longitude.toFixed(5)).join(',');

  const forecastUrl = `${OPEN_METEO_FORECAST_BASE}?latitude=${lats}&longitude=${lons}&hourly=${ROUTE_FORECAST_HOURLY_VARS}&timeformat=unixtime&timezone=auto&forecast_days=7`;
  const marineUrl = `${OPEN_METEO_MARINE_BASE}?latitude=${lats}&longitude=${lons}&hourly=${ROUTE_MARINE_HOURLY_VARS}&timeformat=unixtime&timezone=auto&forecast_days=7`;

  const forecastPromise = fetchWithCircuitBreaker({
    service: 'open_meteo_forecast',
    url: forecastUrl,
    schema: RouteBatchForecastResponseSchema,
    timeoutMs: options?.timeoutMs ?? 12_000,
    fetchImpl: options?.fetchImpl,
  });

  const marinePromise =
    req.category === 'navigation'
      ? fetchWithCircuitBreaker({
          service: 'open_meteo_marine',
          url: marineUrl,
          schema: RouteBatchMarineResponseSchema,
          timeoutMs: options?.timeoutMs ?? 12_000,
          degradedOnOpen: true,
          fetchImpl: options?.fetchImpl,
          fallback: () => [],
        }).catch(() => ({ data: [] as RouteBatchMarinePoint[], fromFallback: true }))
      : Promise.resolve(null);

  const [forecastRes, marineRes] = await Promise.all([forecastPromise, marinePromise]);

  const forecastList: RouteBatchForecastPoint[] = Array.isArray(forecastRes.data)
    ? forecastRes.data
    : [forecastRes.data];

  const marineList: RouteBatchMarinePoint[] =
    marineRes === null
      ? []
      : Array.isArray(marineRes.data)
        ? marineRes.data
        : [marineRes.data];

  const results: RouteCheckpointForecast[] = [];
  let marineCoveredCount = 0;
  let hasMarineTideData = false;
  let overallStatus: SafeWindowStatus = 'green';
  let worstCheckpointIndex = 0;
  const severityRank: Record<SafeWindowStatus, number> = { green: 0, amber: 1, red: 2 };

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i]!;
    const etaUnix = Math.round(
      req.departureUnix + (cp.cumulativeDistanceKm / req.avgSpeedKmh) * 3600,
    );
    const etaIso = new Date(etaUnix * 1000).toISOString();

    const ptForecast = forecastList[i] ?? forecastList[forecastList.length - 1]!;
    const fTimes = ptForecast.hourly.time;
    const fIdx = findNearestTimeIndex(fTimes, etaUnix);
    const matchedHourUnix = fTimes[fIdx] ?? etaUnix;
    const matchedHourIso = new Date(matchedHourUnix * 1000).toISOString();

    const h = ptForecast.hourly;
    const temperature2mC = pickAt(h.temperature_2m, fIdx);
    const precipitationMm = pickAt(h.precipitation, fIdx);
    const precipitationProbabilityPct = pickAt(h.precipitation_probability, fIdx);
    const windSpeed10mKmh = pickAt(h.wind_speed_10m, fIdx);
    const windDirection10mDeg = pickAt(h.wind_direction_10m, fIdx);
    const windGusts10mKmh = pickAt(h.wind_gusts_10m, fIdx);
    const windSpeed80mKmh = pickAt(h.wind_speed_80m, fIdx);
    const windSpeed120mKmh = pickAt(h.wind_speed_120m, fIdx);
    const windSpeed925hPaKmh = pickAt(h.wind_speed_925hPa, fIdx);
    const windDirection925hPaDeg = pickAt(h.wind_direction_925hPa, fIdx);
    const cloudCoverLowPct = pickAt(h.cloud_cover_low, fIdx);
    const cloudCoverMidPct = pickAt(h.cloud_cover_mid, fIdx);
    const cloudCoverHighPct = pickAt(h.cloud_cover_high, fIdx);
    const visibilityM = pickAt(h.visibility, fIdx);
    const capeJkg = pickAt(h.cape, fIdx);

    const operationalWindKmh =
      req.category === 'aerial'
        ? interpolateAerialWindSpeedKmh(operationalAltitudeM, {
            w10: windSpeed10mKmh,
            w80: windSpeed80mKmh,
            w120: windSpeed120mKmh,
            w925: windSpeed925hPaKmh,
          })
        : windSpeed10mKmh;

    const operationalWindDirDeg =
      req.category === 'aerial'
        ? interpolateAerialWindDirectionDeg(
            operationalAltitudeM,
            windDirection10mDeg,
            windDirection925hPaDeg,
          )
        : windDirection10mDeg;

    const windShearKtPer100ft = computeCheckpointShearKtPer100ft({
      w10: windSpeed10mKmh,
      dir10: windDirection10mDeg,
      w80: windSpeed80mKmh,
      w120: windSpeed120mKmh,
      w925: windSpeed925hPaKmh,
      dir925: windDirection925hPaDeg,
      targetAltM: operationalAltitudeM,
    });

    const relativeWind =
      operationalWindDirDeg !== null && cp.bearingDeg !== null
        ? computeRelativeWindAngleDeg(operationalWindDirDeg, cp.bearingDeg)
        : null;

    let waveHeightM: number | null = null;
    let wavePeriodS: number | null = null;
    let waveDirectionDeg: number | null = null;
    let oceanCurrentVelocityKmh: number | null = null;
    let oceanCurrentDirectionDeg: number | null = null;
    let seaLevelHeightMslM: number | null = null;
    let marineAvailable = false;

    const ptMarine = req.category === 'navigation' ? marineList[i] : undefined;
    if (ptMarine && Array.isArray(ptMarine.hourly?.time) && ptMarine.hourly.time.length > 0) {
      const mIdx = findNearestTimeIndex(ptMarine.hourly.time, etaUnix);
      waveHeightM = pickAt(ptMarine.hourly.wave_height, mIdx);
      wavePeriodS = pickAt(ptMarine.hourly.wave_period, mIdx);
      waveDirectionDeg = pickAt(ptMarine.hourly.wave_direction, mIdx);
      oceanCurrentVelocityKmh = pickAt(ptMarine.hourly.ocean_current_velocity, mIdx);
      oceanCurrentDirectionDeg = pickAt(ptMarine.hourly.ocean_current_direction, mIdx);
      seaLevelHeightMslM = pickAt(ptMarine.hourly.sea_level_height_msl, mIdx);

      marineAvailable =
        waveHeightM !== null ||
        oceanCurrentVelocityKmh !== null ||
        seaLevelHeightMslM !== null;

      if (marineAvailable) marineCoveredCount += 1;
      if (seaLevelHeightMslM !== null) hasMarineTideData = true;
    }

    const grade = gradeCheckpointStatus({
      category: req.category,
      operationalWindKmh,
      gustKmh: windGusts10mKmh,
      precipProbPct: precipitationProbabilityPct,
      precipMm: precipitationMm,
      waveHeightM,
      visibilityM,
      capeJkg,
      cloudLowPct: cloudCoverLowPct,
      windShearKtPer100ft,
      limits: req.limits,
    });

    if (severityRank[grade.status] > severityRank[overallStatus]) {
      overallStatus = grade.status;
      worstCheckpointIndex = i;
    }

    results.push({
      checkpoint: cp,
      etaUnix,
      etaIso,
      matchedHourUnix,
      matchedHourIso,
      timezone: ptForecast.timezone || 'UTC',
      elevationDemM: Number.isFinite(ptForecast.elevation) ? ptForecast.elevation : 0,
      temperature2mC,
      precipitationMm,
      precipitationProbabilityPct,
      windSpeed10mKmh,
      windDirection10mDeg,
      windGusts10mKmh,
      windSpeed80mKmh,
      windSpeed120mKmh,
      windSpeed925hPaKmh,
      windDirection925hPaDeg,
      operationalWindKmh,
      operationalWindDirDeg,
      operationalAltitudeM,
      windShearKtPer100ft,
      cloudCoverLowPct,
      cloudCoverMidPct,
      cloudCoverHighPct,
      visibilityM,
      capeJkg,
      relativeWind,
      waveHeightM,
      wavePeriodS,
      waveDirectionDeg,
      oceanCurrentVelocityKmh,
      oceanCurrentDirectionDeg,
      seaLevelHeightMslM,
      marineAvailable,
      status: grade.status,
      reasons: grade.reasons,
    });
  }

  const totalDistanceKm = checkpoints[checkpoints.length - 1]!.cumulativeDistanceKm;
  const estimatedDurationHours = Number((totalDistanceKm / req.avgSpeedKmh).toFixed(2));
  const arrivalUnix =
    results[results.length - 1]?.etaUnix ??
    Math.round(req.departureUnix + estimatedDurationHours * 3600);

  const disclaimers: string[] = [];
  if (req.category === 'navigation' || hasMarineTideData) {
    disclaimers.push(ROUTE_DHN_DISCLAIMER_PT);
  }
  if (req.category === 'aerial') {
    disclaimers.push(ROUTE_AERIAL_DISCLAIMER_PT);
  }
  disclaimers.push(
    'Grade Open-Meteo Forecast/Marine processada 100% no cliente (altitude exclusivamente via DEM Open-Meteo). Revalide a rota antes da partida.',
  );

  return {
    routeName: req.routeName.trim() || 'Rota Operacional 4D',
    category: req.category,
    generatedAtIso: new Date().toISOString(),
    departureUnix: req.departureUnix,
    departureIso: new Date(req.departureUnix * 1000).toISOString(),
    arrivalUnix,
    arrivalIso: new Date(arrivalUnix * 1000).toISOString(),
    avgSpeedKmh: req.avgSpeedKmh,
    operationalAltitudeM,
    totalDistanceKm,
    estimatedDurationHours,
    overallStatus,
    marineCoveredCount,
    hasMarineTideData,
    worstCheckpointIndex,
    checkpoints: results,
    disclaimers,
  };
}

// ============================================================================
// Route Briefing Formatters (HTML, Markdown, CSV, PDF 1.4, DOCX)
// ============================================================================

function fmtVal(v: number | null | undefined, dec = 1): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dec) : 'N/D';
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function formatStatusLabel(status: SafeWindowStatus, isEn: boolean): string {
  if (status === 'green') return isEn ? 'GO (Green)' : 'FAVORÁVEL (Verde)';
  if (status === 'amber') return isEn ? 'CAUTION (Amber)' : 'ATENÇÃO (Âmbar)';
  return isEn ? 'NO-GO (Red)' : 'RESTRITO (Vermelho)';
}

function formatRelWindLabel(rel: RelativeWindAnalysis | null, isEn: boolean): string {
  if (!rel) return 'N/D';
  if (rel.classification === 'headwind') {
    return isEn ? `Headwind (${rel.relativeAngleDeg}°)` : `Proa (${rel.relativeAngleDeg}°)`;
  }
  if (rel.classification === 'tailwind') {
    return isEn ? `Tailwind (${rel.relativeAngleDeg}°)` : `Popa (${rel.relativeAngleDeg}°)`;
  }
  return isEn ? `Crosswind (${rel.relativeAngleDeg}°)` : `Través (${rel.relativeAngleDeg}°)`;
}

function getLocalizedBriefingDisclaimers(
  result: RouteForecast4DResult,
  isEn: boolean,
): string[] {
  const list: string[] = [];
  if (result.category === 'navigation' || result.hasMarineTideData) {
    list.push(isEn ? ROUTE_DHN_DISCLAIMER_EN : ROUTE_DHN_DISCLAIMER_PT);
  }
  if (result.category === 'aerial') {
    list.push(isEn ? ROUTE_AERIAL_DISCLAIMER_EN : ROUTE_AERIAL_DISCLAIMER_PT);
  }
  list.push(
    isEn
      ? 'Client-side Open-Meteo Forecast/Marine 4D batch forecast (terrain elevation strictly from Open-Meteo DEM). Revalidate close to departure.'
      : 'Previsão 4D batch Open-Meteo Forecast/Marine processada 100% no cliente (altitude estritamente via DEM Open-Meteo). Revalide próximo à partida.',
  );
  return list;
}

export function formatRouteBriefingHtml(
  result: RouteForecast4DResult,
  locale: AppLocale = 'pt',
): string {
  const isEn = locale === 'en';
  const isNav = result.category === 'navigation';
  const disclaimers = getLocalizedBriefingDisclaimers(result, isEn);

  const rowsHtml = result.checkpoints
    .map((cp) => {
      const localDay = formatLocalYMD(new Date(cp.etaUnix * 1000), cp.timezone);
      const localHour = formatLocalHourBadge(cp.etaUnix, cp.timezone);
      const windDirLabel =
        cp.operationalWindDirDeg !== null
          ? `${Math.round(cp.operationalWindDirDeg)}° ${formatCardinalDirection(cp.operationalWindDirDeg)}`
          : 'N/D';
      const marineCols = isNav
        ? `<td class="num">${fmtVal(cp.waveHeightM, 2)} m</td><td class="num">${fmtVal(cp.seaLevelHeightMslM, 2)} m</td>`
        : `<td class="num">${fmtVal(cp.windShearKtPer100ft, 2)} kt/100ft</td><td class="num">${fmtVal(cp.cloudCoverLowPct, 0)}%</td>`;

      return `<tr>
        <td><strong>${escapeHtml(cp.checkpoint.label)}</strong></td>
        <td class="num">${cp.checkpoint.latitude.toFixed(4)}, ${cp.checkpoint.longitude.toFixed(4)}</td>
        <td class="num">${cp.checkpoint.cumulativeDistanceKm.toFixed(1)} km</td>
        <td>${escapeHtml(localDay)} ${escapeHtml(localHour)}</td>
        <td class="num">${fmtVal(cp.operationalWindKmh, 1)} km/h (${escapeHtml(windDirLabel)})</td>
        <td class="num">${fmtVal(cp.windGusts10mKmh, 1)} km/h</td>
        <td>${escapeHtml(formatRelWindLabel(cp.relativeWind, isEn))}</td>
        <td class="num">${fmtVal(cp.precipitationMm, 1)} mm (${fmtVal(cp.precipitationProbabilityPct, 0)}%)</td>
        <td class="num">${fmtVal(cp.temperature2mC, 1)} °C</td>
        ${marineCols}
        <td><span class="badge badge-${cp.status}">${escapeHtml(formatStatusLabel(cp.status, isEn))}</span></td>
      </tr>`;
    })
    .join('\n');

  const extraHeaders = isNav
    ? `<th class="num">${isEn ? 'Wave Hs' : 'Onda Hs'}</th><th class="num">${isEn ? 'Tide MSL' : 'Maré MSL'}</th>`
    : `<th class="num">Shear</th><th class="num">${isEn ? 'Low Cloud' : 'Nuv. Baixa'}</th>`;

  const title = isEn
    ? `4D Route Meteorological Briefing — ${result.routeName}`
    : `Briefing Meteorológico de Rota 4D — ${result.routeName}`;

  return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'pt-BR'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 0; padding: 24px; line-height: 1.5; font-size: 13px; }
    .wrap { max-width: 1120px; margin: 0 auto; }
    header { border-bottom: 2px solid #0369a1; padding-bottom: 12px; margin-bottom: 16px; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #f8fafc; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 11.5px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #e2e8f0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .badge { padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 10.5px; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-amber { background: #fef3c7; color: #92400e; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .notice { border-left: 4px solid #d97706; background: #fffbeb; padding: 10px 14px; margin-top: 16px; }
    @media print { body { padding: 0; font-size: 11px; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div>${isEn ? 'Mode' : 'Categoria'}: <strong>${isNav ? (isEn ? 'Coastal / Marine Navigation' : 'Navegação Costeira / Náutica') : isEn ? `Aerial / UAV (${result.operationalAltitudeM}m AGL)` : `Aéreo / VANT (${result.operationalAltitudeM}m AGL)`}</strong> • ${isEn ? 'Generated' : 'Emitido'}: ${escapeHtml(result.generatedAtIso)}</div>
    </header>
    <section class="meta">
      <div class="card"><div>${isEn ? 'Overall Status' : 'Status Geral'}</div><strong>${escapeHtml(formatStatusLabel(result.overallStatus, isEn))}</strong></div>
      <div class="card"><div>${isEn ? 'Total Distance' : 'Distância Total'}</div><strong>${result.totalDistanceKm.toFixed(1)} km</strong></div>
      <div class="card"><div>${isEn ? 'Speed / Duration' : 'Velocidade / Duração'}</div><strong>${result.avgSpeedKmh.toFixed(1)} km/h • ${result.estimatedDurationHours.toFixed(1)} h</strong></div>
      <div class="card"><div>${isEn ? 'Checkpoints' : 'Checkpoints'}</div><strong>${result.checkpoints.length}</strong></div>
    </section>
    <table>
      <thead>
        <tr>
          <th>${isEn ? 'Point' : 'Ponto'}</th>
          <th class="num">Lat, Lon</th>
          <th class="num">Dist</th>
          <th>ETA</th>
          <th class="num">${isEn ? 'Wind' : 'Vento'} (${result.operationalAltitudeM}m)</th>
          <th class="num">${isEn ? 'Gust 10m' : 'Rajada 10m'}</th>
          <th>${isEn ? 'Rel. Wind' : 'Vento Rel.'}</th>
          <th class="num">${isEn ? 'Rain' : 'Chuva'}</th>
          <th class="num">Temp</th>
          ${extraHeaders}
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <section class="notice">
      <strong>${isEn ? 'Operational Disclaimers' : 'Avisos Operacionais Obrigatórios'}</strong>
      <ul>
        ${disclaimers.map((d) => `<li>${escapeHtml(d)}</li>`).join('\n')}
      </ul>
    </section>
  </div>
</body>
</html>`;
}

export function formatRouteBriefingMarkdown(
  result: RouteForecast4DResult,
  locale: AppLocale = 'pt',
): string {
  const isEn = locale === 'en';
  const isNav = result.category === 'navigation';
  const disclaimers = getLocalizedBriefingDisclaimers(result, isEn);

  const lines: string[] = [
    `# ${isEn ? '4D Route Meteorological Briefing' : 'Briefing Meteorológico de Rota 4D'} — ${result.routeName}`,
    '',
    `- **${isEn ? 'Category' : 'Categoria'}:** ${isNav ? (isEn ? 'Navigation' : 'Navegação') : isEn ? `Aerial / UAV (${result.operationalAltitudeM}m)` : `Aéreo / VANT (${result.operationalAltitudeM}m)`}`,
    `- **${isEn ? 'Overall Status' : 'Status Geral'}:** ${formatStatusLabel(result.overallStatus, isEn)}`,
    `- **${isEn ? 'Total Distance' : 'Distância Total'}:** ${result.totalDistanceKm.toFixed(2)} km`,
    `- **${isEn ? 'Average Speed / ETA Duration' : 'Velocidade Média / Duração'}:** ${result.avgSpeedKmh.toFixed(1)} km/h • ${result.estimatedDurationHours.toFixed(2)} h`,
    `- **${isEn ? 'Departure -> Arrival' : 'Partida -> Chegada'}:** ${result.departureIso} -> ${result.arrivalIso}`,
    '',
    isNav
      ? '| Ponto | Dist (km) | ETA | Vento 10m | Rajada | Vento Rel. | Chuva | Onda Hs | Maré MSL | Status |'
      : `| Ponto | Dist (km) | ETA | Vento ${result.operationalAltitudeM}m | Rajada 10m | Vento Rel. | Chuva | Shear | Nuv. Baixa | Status |`,
    '| :--- | ---: | :--- | ---: | ---: | :--- | ---: | ---: | ---: | :--- |',
  ];

  for (const cp of result.checkpoints) {
    const localDay = formatLocalYMD(new Date(cp.etaUnix * 1000), cp.timezone);
    const localHour = formatLocalHourBadge(cp.etaUnix, cp.timezone);
    const windText = `${fmtVal(cp.operationalWindKmh, 1)} km/h (${fmtVal(cp.operationalWindDirDeg, 0)}° ${formatCardinalDirection(cp.operationalWindDirDeg)})`;
    const rainText = `${fmtVal(cp.precipitationMm, 1)} mm (${fmtVal(cp.precipitationProbabilityPct, 0)}%)`;
    const extra = isNav
      ? `${fmtVal(cp.waveHeightM, 2)} m | ${fmtVal(cp.seaLevelHeightMslM, 2)} m`
      : `${fmtVal(cp.windShearKtPer100ft, 2)} kt/100ft | ${fmtVal(cp.cloudCoverLowPct, 0)}%`;

    lines.push(
      `| ${cp.checkpoint.label} | ${cp.checkpoint.cumulativeDistanceKm.toFixed(1)} | ${localDay} ${localHour} | ${windText} | ${fmtVal(cp.windGusts10mKmh, 1)} km/h | ${formatRelWindLabel(cp.relativeWind, isEn)} | ${rainText} | ${extra} | ${formatStatusLabel(cp.status, isEn)} |`,
    );
  }

  lines.push(
    '',
    `## ${isEn ? 'Mandatory Operational Disclaimers' : 'Avisos Operacionais Obrigatórios'}`,
    '',
    ...disclaimers.map((d) => `- ${d}`),
    '',
  );

  return lines.join('\n');
}

export function formatRouteBriefingCsv(result: RouteForecast4DResult): string {
  const headers = [
    'route_name',
    'category',
    'checkpoint_index',
    'label',
    'latitude',
    'longitude',
    'elevation_dem_m',
    'leg_distance_km',
    'cumulative_distance_km',
    'bearing_deg',
    'eta_iso',
    'matched_hour_iso',
    'operational_altitude_m',
    'operational_wind_kmh',
    'operational_wind_dir_deg',
    'wind_gusts_10m_kmh',
    'relative_wind_class',
    'relative_wind_deg',
    'temperature_2m_c',
    'precipitation_mm',
    'precipitation_prob_pct',
    'wind_shear_kt_per_100ft',
    'cloud_cover_low_pct',
    'visibility_m',
    'cape_jkg',
    'wave_height_m',
    'wave_period_s',
    'ocean_current_velocity_kmh',
    'sea_level_height_msl_m',
    'status',
    'reasons',
    'disclaimer',
  ];

  const disclaimerJoined = result.disclaimers.join(' | ');
  const rows: string[] = [headers.join(',')];

  for (const cp of result.checkpoints) {
    rows.push(
      [
        result.routeName,
        result.category,
        cp.checkpoint.index + 1,
        cp.checkpoint.label,
        cp.checkpoint.latitude.toFixed(6),
        cp.checkpoint.longitude.toFixed(6),
        cp.elevationDemM.toFixed(1),
        cp.checkpoint.legDistanceKm.toFixed(3),
        cp.checkpoint.cumulativeDistanceKm.toFixed(3),
        cp.checkpoint.bearingDeg !== null ? cp.checkpoint.bearingDeg.toFixed(1) : '',
        cp.etaIso,
        cp.matchedHourIso,
        cp.operationalAltitudeM,
        cp.operationalWindKmh !== null ? cp.operationalWindKmh.toFixed(1) : '',
        cp.operationalWindDirDeg !== null ? cp.operationalWindDirDeg.toFixed(1) : '',
        cp.windGusts10mKmh !== null ? cp.windGusts10mKmh.toFixed(1) : '',
        cp.relativeWind?.classification ?? '',
        cp.relativeWind !== null ? cp.relativeWind.relativeAngleDeg.toFixed(1) : '',
        cp.temperature2mC !== null ? cp.temperature2mC.toFixed(1) : '',
        cp.precipitationMm !== null ? cp.precipitationMm.toFixed(2) : '',
        cp.precipitationProbabilityPct !== null
          ? cp.precipitationProbabilityPct.toFixed(0)
          : '',
        cp.windShearKtPer100ft !== null ? cp.windShearKtPer100ft.toFixed(2) : '',
        cp.cloudCoverLowPct !== null ? cp.cloudCoverLowPct.toFixed(0) : '',
        cp.visibilityM !== null ? cp.visibilityM.toFixed(0) : '',
        cp.capeJkg !== null ? cp.capeJkg.toFixed(0) : '',
        cp.waveHeightM !== null ? cp.waveHeightM.toFixed(2) : '',
        cp.wavePeriodS !== null ? cp.wavePeriodS.toFixed(1) : '',
        cp.oceanCurrentVelocityKmh !== null ? cp.oceanCurrentVelocityKmh.toFixed(2) : '',
        cp.seaLevelHeightMslM !== null ? cp.seaLevelHeightMslM.toFixed(2) : '',
        cp.status,
        cp.reasons.join('; '),
        disclaimerJoined,
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }

  return UTF8_BOM + rows.join('\r\n');
}

// ============================================================================
// Pure Client-Side PDF 1.4 Generator for 4D Route Briefings
// ============================================================================

const PDF_WINANSI_MAP: Record<number, number> = {
  0x2013: 0x96,
  0x2014: 0x97,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2026: 0x85,
};

function encodeWinAnsiPdfString(raw: string): number[] {
  const bytes: number[] = [0x28];
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      bytes.push(0x5c, code);
    } else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
    } else if (PDF_WINANSI_MAP[code] !== undefined) {
      bytes.push(PDF_WINANSI_MAP[code]!);
    } else {
      const ascii = raw[i]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const chCode = ascii.length > 0 ? ascii.charCodeAt(0) : 0x3f;
      bytes.push(chCode >= 0x20 && chCode <= 0x7e ? chCode : 0x3f);
    }
  }
  bytes.push(0x29);
  return bytes;
}

function asciiBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let curr = '';
  for (const w of words) {
    if (!curr) {
      curr = w;
    } else if (curr.length + 1 + w.length <= maxChars) {
      curr += ` ${w}`;
    } else {
      lines.push(curr);
      curr = w;
    }
  }
  if (curr) lines.push(curr);
  return lines;
}

export function generateRouteBriefingPdfBytes(
  result: RouteForecast4DResult,
  locale: AppLocale = 'pt',
): Uint8Array {
  const isEn = locale === 'en';
  const isNav = result.category === 'navigation';
  const disclaimers = getLocalizedBriefingDisclaimers(result, isEn);

  const pageWidth = 595;
  const pageHeight = 842;
  const marginLeft = 42;
  const topY = 795;
  const bottomY = 50;

  type Cmd = { font: 'F1' | 'F2'; size: number; x: number; y: number; text: string };
  const pages: Cmd[][] = [[]];
  let cursorY = topY;

  const pushLine = (text: string, font: 'F1' | 'F2' = 'F1', size = 9) => {
    const lh = size * 1.4;
    if (cursorY - lh < bottomY) {
      pages.push([]);
      cursorY = topY;
    }
    pages[pages.length - 1]!.push({ font, size, x: marginLeft, y: cursorY, text });
    cursorY -= lh;
  };

  const pushWrapped = (text: string, font: 'F1' | 'F2' = 'F1', size = 9) => {
    const maxChars = Math.max(40, Math.floor(510 / (size * 0.52)));
    for (const line of wrapText(text, maxChars)) {
      pushLine(line, font, size);
    }
    cursorY -= 3;
  };

  pushWrapped(
    `${isEn ? 'FieldCast 4D Route Briefing' : 'Briefing de Rota 4D FieldCast'} - ${result.routeName}`,
    'F2',
    13,
  );
  pushWrapped(
    `${isEn ? 'Mode' : 'Categoria'}: ${isNav ? 'Navigation' : `Aerial (${result.operationalAltitudeM}m)`} | ${isEn ? 'Status' : 'Status'}: ${formatStatusLabel(result.overallStatus, isEn)} | ${result.totalDistanceKm.toFixed(1)} km | ${result.avgSpeedKmh.toFixed(1)} km/h (${result.estimatedDurationHours.toFixed(1)} h)`,
    'F1',
    9,
  );
  pushWrapped(
    `${isEn ? 'Departure' : 'Partida'}: ${result.departureIso} -> ${isEn ? 'Arrival' : 'Chegada'}: ${result.arrivalIso}`,
    'F1',
    8.5,
  );

  cursorY -= 4;
  pushLine(isEn ? 'Checkpoints 4D Matrix:' : 'Matriz 4D de Checkpoints:', 'F2', 10.5);
  for (const cp of result.checkpoints) {
    const localHour = `${formatLocalYMD(new Date(cp.etaUnix * 1000), cp.timezone)} ${formatLocalHourBadge(cp.etaUnix, cp.timezone)}`;
    const extra = isNav
      ? `Wave ${fmtVal(cp.waveHeightM, 2)}m | MSL ${fmtVal(cp.seaLevelHeightMslM, 2)}m`
      : `Shear ${fmtVal(cp.windShearKtPer100ft, 2)}kt/100ft | LowCld ${fmtVal(cp.cloudCoverLowPct, 0)}%`;
    const row = `${cp.checkpoint.label} (${cp.checkpoint.cumulativeDistanceKm.toFixed(1)} km @ ${localHour}) | Wind ${fmtVal(cp.operationalWindKmh, 1)} km/h ${formatCardinalDirection(cp.operationalWindDirDeg)} (${formatRelWindLabel(cp.relativeWind, isEn)}) | Gust ${fmtVal(cp.windGusts10mKmh, 1)} | Rain ${fmtVal(cp.precipitationMm, 1)}mm (${fmtVal(cp.precipitationProbabilityPct, 0)}%) | ${extra} | ${cp.status.toUpperCase()}`;
    pushWrapped(row, 'F1', 8);
  }

  cursorY -= 4;
  pushLine(
    isEn ? 'Mandatory Operational Disclaimers:' : 'Avisos Operacionais Obrigatorios:',
    'F2',
    10.5,
  );
  for (const d of disclaimers) {
    pushWrapped(`- ${d}`, 'F1', 8.5);
  }

  const objects: Array<{ id: number; body: Uint8Array }> = [
    { id: 1, body: asciiBytes('<< /Type /Catalog /Pages 2 0 R >>') },
    {
      id: 2,
      body: asciiBytes(
        `<< /Type /Pages /Kids [${pages.map((_, idx) => `${5 + idx * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
      ),
    },
    {
      id: 3,
      body: asciiBytes(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      ),
    },
    {
      id: 4,
      body: asciiBytes(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      ),
    },
  ];

  pages.forEach((cmds, idx) => {
    const pageObjId = 5 + idx * 2;
    const contentObjId = 6 + idx * 2;
    const streamParts: Uint8Array[] = [asciiBytes('BT\n')];
    for (const c of cmds) {
      streamParts.push(
        asciiBytes(`/${c.font} ${c.size.toFixed(1)} Tf 1 0 0 1 ${c.x.toFixed(1)} ${c.y.toFixed(1)} Tm `),
      );
      streamParts.push(new Uint8Array(encodeWinAnsiPdfString(c.text)));
      streamParts.push(asciiBytes(' Tj\n'));
    }
    streamParts.push(asciiBytes('ET\n'));
    const stream = concatBytes(streamParts);

    objects.push({
      id: pageObjId,
      body: asciiBytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
      ),
    });
    objects.push({
      id: contentObjId,
      body: concatBytes([
        asciiBytes(`<< /Length ${stream.byteLength} >>\nstream\n`),
        stream,
        asciiBytes('endstream'),
      ]),
    });
  });

  const chunks: Uint8Array[] = [
    new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  ];
  let byteOffset = chunks[0]!.byteLength;
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets[obj.id] = byteOffset;
    const h = asciiBytes(`${obj.id} 0 obj\n`);
    const f = asciiBytes('\nendobj\n');
    chunks.push(h, obj.body, f);
    byteOffset += h.byteLength + obj.body.byteLength + f.byteLength;
  }

  const xrefOffset = byteOffset;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (let id = 1; id <= objects.length; id++) {
    xrefLines.push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  xrefLines.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n`,
    '%%EOF\n',
  );
  chunks.push(asciiBytes(xrefLines.join('')));
  return concatBytes(chunks);
}

// ============================================================================
// Pure Client-Side OOXML (.docx) Generator reusing buildPureZipArchiveBytes
// ============================================================================

function docxParagraph(text: string, styleId?: string, bold = false): string {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
  const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function docxCell(text: string, isHeader = false): string {
  const shd = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/>' : '';
  const rPr = isHeader
    ? '<w:rPr><w:b/><w:sz w:val="18"/></w:rPr>'
    : '<w:rPr><w:sz w:val="18"/></w:rPr>';
  return `<w:tc><w:tcPr>${shd}</w:tcPr><w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
}

export function generateRouteBriefingDocxBytes(
  result: RouteForecast4DResult,
  locale: AppLocale = 'pt',
): Uint8Array {
  const isEn = locale === 'en';
  const isNav = result.category === 'navigation';
  const disclaimers = getLocalizedBriefingDisclaimers(result, isEn);

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '</Types>',
  ].join('\n');

  const relsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join('\n');

  const stylesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>',
    '  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>',
    '  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:color w:val="0369A1"/><w:sz w:val="24"/></w:rPr></w:style>',
    '</w:styles>',
  ].join('\n');

  const tableHeaders = isNav
    ? ['Ponto', 'Dist (km)', 'ETA', 'Vento 10m', 'Rajada', 'Vento Rel.', 'Chuva', 'Onda Hs', 'Maré MSL', 'Status']
    : ['Ponto', 'Dist (km)', 'ETA', `Vento ${result.operationalAltitudeM}m`, 'Rajada 10m', 'Vento Rel.', 'Chuva', 'Shear', 'Nuv. Baixa', 'Status'];

  const headerRow = `<w:tr>${tableHeaders.map((h) => docxCell(h, true)).join('')}</w:tr>`;
  const dataRows = result.checkpoints
    .map((cp) => {
      const etaLabel = `${formatLocalYMD(new Date(cp.etaUnix * 1000), cp.timezone)} ${formatLocalHourBadge(cp.etaUnix, cp.timezone)}`;
      const cells = [
        cp.checkpoint.label,
        cp.checkpoint.cumulativeDistanceKm.toFixed(1),
        etaLabel,
        `${fmtVal(cp.operationalWindKmh, 1)} km/h`,
        `${fmtVal(cp.windGusts10mKmh, 1)} km/h`,
        formatRelWindLabel(cp.relativeWind, isEn),
        `${fmtVal(cp.precipitationMm, 1)} mm (${fmtVal(cp.precipitationProbabilityPct, 0)}%)`,
        isNav ? `${fmtVal(cp.waveHeightM, 2)} m` : `${fmtVal(cp.windShearKtPer100ft, 2)} kt/100ft`,
        isNav ? `${fmtVal(cp.seaLevelHeightMslM, 2)} m` : `${fmtVal(cp.cloudCoverLowPct, 0)}%`,
        formatStatusLabel(cp.status, isEn),
      ];
      return `<w:tr>${cells.map((c) => docxCell(c, false)).join('')}</w:tr>`;
    })
    .join('');

  const tableXml = `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr>${headerRow}${dataRows}</w:tbl>`;

  const bodyParts = [
    docxParagraph(
      `${isEn ? '4D Route Meteorological Briefing' : 'Briefing Meteorológico de Rota 4D'} — ${result.routeName}`,
      'Title',
      true,
    ),
    docxParagraph(
      `${isEn ? 'Status' : 'Status Geral'}: ${formatStatusLabel(result.overallStatus, isEn)} | ${result.totalDistanceKm.toFixed(1)} km | ${result.avgSpeedKmh.toFixed(1)} km/h | ${result.estimatedDurationHours.toFixed(1)} h`,
    ),
    docxParagraph(
      `${isEn ? 'Departure' : 'Partida'}: ${result.departureIso} -> ${isEn ? 'Arrival' : 'Chegada'}: ${result.arrivalIso}`,
    ),
    docxParagraph(isEn ? '1. 4D Checkpoints Forecast' : '1. Previsão 4D por Checkpoint', 'Heading1', true),
    tableXml,
    docxParagraph(
      isEn ? '2. Mandatory Operational Disclaimers' : '2. Avisos Operacionais Obrigatórios',
      'Heading1',
      true,
    ),
    ...disclaimers.map((d) => docxParagraph(`• ${d}`)),
  ];

  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `  <w:body>${bodyParts.join('')}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body>`,
    '</w:document>',
  ].join('\n');

  return buildPureZipArchiveBytes([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/document.xml', data: documentXml },
  ]);
}
