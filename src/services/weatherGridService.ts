import {
  WEATHER_MODELS,
  type EnsembleHour,
  type NativeModelHour,
  type NormalizedForecast,
  type WeatherModelId,
} from '../types/weather';
import { computeCircularStat, computeScalarStat } from '../utils/ensembleMath';

export type WeatherMapLayerId = 'wind' | 'rain' | 'temperature' | 'waves' | 'none';
export type MapModelMode = 'fieldcast' | WeatherModelId;

export interface MapBoundsBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface WeatherGridPoint {
  latitude: number;
  longitude: number;
  windSpeed10m: number | null;
  windDirection10m: number | null;
  precipitationMm: number | null;
  temperature2mC: number | null;
  waveHeightM: number | null;
}

export interface SpatialGridHourSlice {
  timestampUnix: number;
  points: WeatherGridPoint[];
}

export interface SpatialGridForecast {
  source: 'live_grid' | 'forecast_anchor';
  fetchedAtIso: string;
  bounds: MapBoundsBox;
  byModel: Record<MapModelMode, SpatialGridHourSlice[]>;
}

export interface LayerLegendSpec {
  layerId: Exclude<WeatherMapLayerId, 'none'>;
  title: string;
  unit: string;
  stops: ReadonlyArray<{ valueLabel: string; color: string }>;
}

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const LAYER_LEGENDS: Record<Exclude<WeatherMapLayerId, 'none'>, LayerLegendSpec> = {
  wind: {
    layerId: 'wind',
    title: 'Vento 10m',
    unit: 'km/h',
    stops: [
      { valueLabel: '0', color: '#bae6fd' },
      { valueLabel: '15', color: '#2dd4bf' },
      { valueLabel: '30', color: '#22c55e' },
      { valueLabel: '50', color: '#eab308' },
      { valueLabel: '75+', color: '#ef4444' },
    ],
  },
  rain: {
    layerId: 'rain',
    title: 'Precipitação',
    unit: 'mm/h',
    stops: [
      { valueLabel: '0', color: '#e0f2fe' },
      { valueLabel: '0.5', color: '#38bdf8' },
      { valueLabel: '2', color: '#0284c7' },
      { valueLabel: '8', color: '#6366f1' },
      { valueLabel: '20+', color: '#db2777' },
    ],
  },
  temperature: {
    layerId: 'temperature',
    title: 'Temperatura 2m',
    unit: '°C',
    stops: [
      { valueLabel: '5°', color: '#3b82f6' },
      { valueLabel: '15°', color: '#06b6d4' },
      { valueLabel: '23°', color: '#22c55e' },
      { valueLabel: '30°', color: '#f59e0b' },
      { valueLabel: '38°+', color: '#ef4444' },
    ],
  },
  waves: {
    layerId: 'waves',
    title: 'Altura de Onda',
    unit: 'm',
    stops: [
      { valueLabel: '0.2m', color: '#bae6fd' },
      { valueLabel: '1.0m', color: '#0ea5e9' },
      { valueLabel: '2.0m', color: '#2563eb' },
      { valueLabel: '3.0m', color: '#7c3aed' },
      { valueLabel: '4.5m+', color: '#e11d48' },
    ],
  },
};

export function getLayerLegendSpec(
  layerId: WeatherMapLayerId,
): LayerLegendSpec | null {
  if (layerId === 'none') return null;
  return LAYER_LEGENDS[layerId];
}

export function getModelModeDisplayName(mode: MapModelMode): string {
  switch (mode) {
    case 'ecmwf_ifs025':
      return 'ECMWF IFS 0.25°';
    case 'gfs_seamless':
      return 'NOAA GFS 13km';
    case 'icon_seamless':
      return 'DWD ICON 13km';
    case 'gem_seamless':
      return 'CMC GEM 15km';
    default:
      return 'FieldCast (Ensemble)';
  }
}

export function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

export function clampLon(lon: number): number {
  return Math.max(-180, Math.min(180, lon));
}

/**
 * Generates an evenly spaced NxN coordinate grid spanning the given map bounds.
 * Ensures a minimum span (~0.16°) so zoomed-in coastal maps still sample regional gradients.
 */
export function buildSpatialSampleCoordinates(
  bounds: MapBoundsBox,
  gridSize = 3,
): Array<{ latitude: number; longitude: number }> {
  const n = Math.max(2, Math.min(5, Math.round(gridSize)));
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLon = (bounds.east + bounds.west) / 2;

  const latSpan = Math.max(0.18, Math.min(20, Math.abs(bounds.north - bounds.south)));
  const lonSpan = Math.max(0.18, Math.min(20, Math.abs(bounds.east - bounds.west)));

  const minLat = clampLat(centerLat - latSpan / 2);
  const maxLat = clampLat(centerLat + latSpan / 2);
  const minLon = clampLon(centerLon - lonSpan / 2);
  const maxLon = clampLon(centerLon + lonSpan / 2);

  const coords: Array<{ latitude: number; longitude: number }> = [];
  for (let row = 0; row < n; row++) {
    const latFrac = n === 1 ? 0.5 : row / (n - 1);
    const lat = Number((minLat + (maxLat - minLat) * latFrac).toFixed(4));
    for (let col = 0; col < n; col++) {
      const lonFrac = n === 1 ? 0.5 : col / (n - 1);
      const lon = Number((minLon + (maxLon - minLon) * lonFrac).toFixed(4));
      coords.push({ latitude: lat, longitude: lon });
    }
  }
  return coords;
}

function getNativeNumericValue(
  hour: NativeModelHour | undefined,
  field: 'windSpeed10m' | 'windDirection10m' | 'precipitation' | 'temperature2m',
): number | null {
  if (!hour) return null;
  const val = hour[field];
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

/**
 * Builds an instant zero-network spatial grid anchored to the active `NormalizedForecast`.
 * Keeps map meteorological overlays 100% functional offline or before live spatial grid resolves.
 */
export function buildOfflineFallbackSpatialGrid(
  forecast: NormalizedForecast | null | undefined,
  bounds: MapBoundsBox,
): SpatialGridForecast {
  const sampleCoords = buildSpatialSampleCoordinates(bounds, 3);
  const emptyByModel: Record<MapModelMode, SpatialGridHourSlice[]> = {
    fieldcast: [],
    ecmwf_ifs025: [],
    gfs_seamless: [],
    icon_seamless: [],
    gem_seamless: [],
  };

  if (!forecast || forecast.hours.length === 0) {
    return {
      source: 'forecast_anchor',
      fetchedAtIso: new Date().toISOString(),
      bounds,
      byModel: emptyByModel,
    };
  }

  const maxHours = Math.min(48, forecast.hours.length);

  for (let i = 0; i < maxHours; i++) {
    const ensHour: EnsembleHour = forecast.hours[i]!;
    const fcPoints: WeatherGridPoint[] = sampleCoords.map((pt, idx) => {
      // Gentle spatial variance around the anchor point so isolines/arrows look continuous
      const offsetFactor = ((idx % 3) - 1) * 0.04;
      const baseWind = ensHour.windSpeed10m.mean;
      const baseTemp = ensHour.temperature2mC.mean;
      return {
        latitude: pt.latitude,
        longitude: pt.longitude,
        windSpeed10m:
          baseWind !== null ? Math.max(0, Number((baseWind * (1 + offsetFactor)).toFixed(1))) : null,
        windDirection10m: ensHour.windDirection10m.degree,
        precipitationMm: ensHour.precipitationMm.mean,
        temperature2mC:
          baseTemp !== null ? Number((baseTemp - offsetFactor * 4).toFixed(1)) : null,
        waveHeightM: ensHour.marine?.waveHeight ?? null,
      };
    });
    emptyByModel.fieldcast.push({
      timestampUnix: ensHour.timestampUnix,
      points: fcPoints,
    });

    for (const modelId of WEATHER_MODELS) {
      const nativeHour = forecast.nativeByModel[modelId]?.[i];
      const mWind = getNativeNumericValue(nativeHour, 'windSpeed10m');
      const mDir = getNativeNumericValue(nativeHour, 'windDirection10m');
      const mPrecip = getNativeNumericValue(nativeHour, 'precipitation');
      const mTemp = getNativeNumericValue(nativeHour, 'temperature2m');
      const waveHeightM = ensHour.marine?.waveHeight ?? null;

      emptyByModel[modelId].push({
        timestampUnix: nativeHour?.timestampUnix ?? ensHour.timestampUnix,
        points: sampleCoords.map((pt, idx) => {
          const offsetFactor = ((idx % 3) - 1) * 0.04;
          return {
            latitude: pt.latitude,
            longitude: pt.longitude,
            windSpeed10m:
              mWind !== null ? Math.max(0, Number((mWind * (1 + offsetFactor)).toFixed(1))) : null,
            windDirection10m: mDir,
            precipitationMm: mPrecip,
            temperature2mC:
              mTemp !== null ? Number((mTemp - offsetFactor * 4).toFixed(1)) : null,
            waveHeightM,
          };
        }),
      });
    }
  }

  return {
    source: 'forecast_anchor',
    fetchedAtIso: forecast.fetchedAtIso,
    bounds,
    byModel: emptyByModel,
  };
}

interface RawMultiPointOpenMeteoItem {
  latitude: number;
  longitude: number;
  hourly?: Record<string, Array<number | null> | undefined> & {
    time?: number[];
  };
}

/**
 * Fetches a genuine 3x3 spatial multi-model grid from Open-Meteo in a single free request.
 * Never throws; returns `null` when offline or blocked so callers fall back gracefully.
 */
export async function fetchOpenMeteoSpatialGrid(
  bounds: MapBoundsBox,
  options?: {
    forecastDays?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    anchorForecast?: NormalizedForecast | null;
  },
): Promise<SpatialGridForecast | null> {
  const fetchFn = options?.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) {
    return null;
  }

  const coords = buildSpatialSampleCoordinates(bounds, 3);
  const latParam = coords.map((c) => c.latitude.toFixed(4)).join(',');
  const lonParam = coords.map((c) => c.longitude.toFixed(4)).join(',');
  const forecastDays = options?.forecastDays ?? 2;

  const url =
    `${OPEN_METEO_FORECAST_URL}?latitude=${latParam}&longitude=${lonParam}` +
    `&hourly=wind_speed_10m,wind_direction_10m,precipitation,temperature_2m` +
    `&models=${WEATHER_MODELS.join(',')}&forecast_days=${forecastDays}&timeformat=unixtime`;

  try {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 9000);
    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        return null;
      }
      options.signal.addEventListener('abort', () => timeoutController.abort(), {
        once: true,
      });
    }

    const res = await fetchFn(url, { signal: timeoutController.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return null;
    }

    const rawJson: unknown = await res.json();
    const items: RawMultiPointOpenMeteoItem[] = Array.isArray(rawJson)
      ? (rawJson as RawMultiPointOpenMeteoItem[])
      : [rawJson as RawMultiPointOpenMeteoItem];

    if (items.length === 0 || !items[0]?.hourly?.time?.length) {
      return null;
    }

    const times = items[0].hourly.time;
    const byModel: Record<MapModelMode, SpatialGridHourSlice[]> = {
      fieldcast: [],
      ecmwf_ifs025: [],
      gfs_seamless: [],
      icon_seamless: [],
      gem_seamless: [],
    };

    const maxHours = Math.min(48, times.length);
    for (let hIdx = 0; hIdx < maxHours; hIdx++) {
      const timestampUnix = times[hIdx]!;
      const anchorWave = options?.anchorForecast?.hours[hIdx]?.marine?.waveHeight ?? null;

      const fcPoints: WeatherGridPoint[] = [];
      const modelPointBuckets: Record<WeatherModelId, WeatherGridPoint[]> = {
        ecmwf_ifs025: [],
        gfs_seamless: [],
        icon_seamless: [],
        gem_seamless: [],
      };

      for (let pIdx = 0; pIdx < items.length; pIdx++) {
        const item = items[pIdx]!;
        const hourly = item.hourly ?? {};
        const lat = item.latitude;
        const lon = item.longitude;

        const windsForEnsemble: Array<number | null> = [];
        const dirsForEnsemble: Array<number | null> = [];
        const precipForEnsemble: Array<number | null> = [];
        const tempForEnsemble: Array<number | null> = [];

        for (const modelId of WEATHER_MODELS) {
          const w = hourly[`wind_speed_10m_${modelId}`]?.[hIdx] ?? null;
          const d = hourly[`wind_direction_10m_${modelId}`]?.[hIdx] ?? null;
          const p = hourly[`precipitation_${modelId}`]?.[hIdx] ?? null;
          const t = hourly[`temperature_2m_${modelId}`]?.[hIdx] ?? null;

          windsForEnsemble.push(w);
          dirsForEnsemble.push(d);
          precipForEnsemble.push(p);
          tempForEnsemble.push(t);

          modelPointBuckets[modelId].push({
            latitude: lat,
            longitude: lon,
            windSpeed10m: w,
            windDirection10m: d,
            precipitationMm: p,
            temperature2mC: t,
            waveHeightM: anchorWave,
          });
        }

        const wStat = computeScalarStat(windsForEnsemble);
        const dStat = computeCircularStat(dirsForEnsemble, windsForEnsemble);
        const pStat = computeScalarStat(precipForEnsemble);
        const tStat = computeScalarStat(tempForEnsemble);

        fcPoints.push({
          latitude: lat,
          longitude: lon,
          windSpeed10m: wStat.mean,
          windDirection10m: dStat.degree,
          precipitationMm: pStat.mean,
          temperature2mC: tStat.mean,
          waveHeightM: anchorWave,
        });
      }

      byModel.fieldcast.push({ timestampUnix, points: fcPoints });
      for (const modelId of WEATHER_MODELS) {
        byModel[modelId].push({ timestampUnix, points: modelPointBuckets[modelId] });
      }
    }

    return {
      source: 'live_grid',
      fetchedAtIso: new Date().toISOString(),
      bounds,
      byModel,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts spatial grid points for the requested model & hour timestamp.
 */
export function extractGridSnapshotAtHour(
  grid: SpatialGridForecast | null,
  modelMode: MapModelMode,
  hourIndex: number,
  targetTimestampUnix?: number,
): SpatialGridHourSlice | null {
  if (!grid) return null;
  const list = grid.byModel[modelMode];
  if (!list || list.length === 0) return null;

  if (targetTimestampUnix !== undefined) {
    let best = list[0]!;
    let bestDiff = Math.abs(best.timestampUnix - targetTimestampUnix);
    for (const slice of list) {
      const diff = Math.abs(slice.timestampUnix - targetTimestampUnix);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = slice;
      }
    }
    if (bestDiff <= 7200) {
      return best;
    }
  }

  const clamped = Math.max(0, Math.min(list.length - 1, hourIndex));
  return list[clamped] ?? list[0] ?? null;
}

/**
 * Inverse-distance weighted interpolation across spatial grid points at `(lat, lon)`.
 */
export function interpolateGridValueAtPoint(
  points: ReadonlyArray<WeatherGridPoint>,
  latitude: number,
  longitude: number,
  layerId: Exclude<WeatherMapLayerId, 'none'>,
): { value: number | null; windDirectionDeg: number | null } {
  if (points.length === 0) {
    return { value: null, windDirectionDeg: null };
  }

  let weightSum = 0;
  let valueSum = 0;
  let uSum = 0;
  let vSum = 0;
  let dirWeightSum = 0;

  for (const pt of points) {
    const rawVal =
      layerId === 'wind'
        ? pt.windSpeed10m
        : layerId === 'rain'
          ? pt.precipitationMm
          : layerId === 'temperature'
            ? pt.temperature2mC
            : pt.waveHeightM;

    const dLat = pt.latitude - latitude;
    const dLon = pt.longitude - longitude;
    const distSq = dLat * dLat + dLon * dLon;
    const weight = distSq < 1e-8 ? 1e8 : 1 / distSq;

    if (rawVal !== null && Number.isFinite(rawVal)) {
      valueSum += rawVal * weight;
      weightSum += weight;
    }

    if (pt.windDirection10m !== null && Number.isFinite(pt.windDirection10m)) {
      const rad = (pt.windDirection10m * Math.PI) / 180;
      uSum += -Math.sin(rad) * weight;
      vSum += -Math.cos(rad) * weight;
      dirWeightSum += weight;
    }
  }

  const value = weightSum > 0 ? valueSum / weightSum : null;
  let windDirectionDeg: number | null = null;
  if (dirWeightSum > 0 && (Math.abs(uSum) > 1e-6 || Math.abs(vSum) > 1e-6)) {
    windDirectionDeg =
      ((Math.atan2(-uSum, -vSum) * 180) / Math.PI + 360) % 360;
  }

  return { value, windDirectionDeg };
}

function lerpColor(
  c1: [number, number, number, number],
  c2: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  const f = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * f),
    Math.round(c1[1] + (c2[1] - c1[1]) * f),
    Math.round(c1[2] + (c2[2] - c1[2]) * f),
    Math.round(c1[3] + (c2[3] - c1[3]) * f),
  ];
}

function interpolateStops(
  val: number,
  stops: ReadonlyArray<{ v: number; rgba: [number, number, number, number] }>,
): [number, number, number, number] {
  if (val <= stops[0]!.v) return stops[0]!.rgba;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (val <= b.v) {
      const t = (val - a.v) / Math.max(1e-6, b.v - a.v);
      return lerpColor(a.rgba, b.rgba, t);
    }
  }
  return stops[stops.length - 1]!.rgba;
}

export function getWeatherOverlayRgba(
  layerId: Exclude<WeatherMapLayerId, 'none'>,
  value: number | null,
): [number, number, number, number] {
  if (value === null || !Number.isFinite(value)) {
    return [0, 0, 0, 0];
  }

  if (layerId === 'wind') {
    return interpolateStops(value, [
      { v: 0, rgba: [56, 189, 248, 35] },
      { v: 12, rgba: [45, 212, 191, 65] },
      { v: 25, rgba: [34, 197, 94, 85] },
      { v: 40, rgba: [234, 179, 8, 105] },
      { v: 60, rgba: [249, 115, 22, 125] },
      { v: 85, rgba: [225, 29, 72, 145] },
    ]);
  }

  if (layerId === 'rain') {
    if (value < 0.05) return [186, 230, 253, 18];
    return interpolateStops(value, [
      { v: 0.1, rgba: [56, 189, 248, 65] },
      { v: 1.5, rgba: [2, 132, 199, 100] },
      { v: 6, rgba: [99, 102, 241, 130] },
      { v: 15, rgba: [219, 39, 119, 155] },
    ]);
  }

  if (layerId === 'temperature') {
    return interpolateStops(value, [
      { v: 5, rgba: [59, 130, 246, 95] },
      { v: 15, rgba: [6, 182, 212, 85] },
      { v: 23, rgba: [34, 197, 94, 80] },
      { v: 30, rgba: [245, 158, 11, 95] },
      { v: 38, rgba: [239, 68, 68, 115] },
    ]);
  }

  // waves
  return interpolateStops(value, [
    { v: 0.2, rgba: [186, 230, 253, 45] },
    { v: 1.0, rgba: [14, 165, 233, 85] },
    { v: 2.0, rgba: [37, 99, 235, 115] },
    { v: 3.5, rgba: [124, 58, 237, 135] },
    { v: 5.0, rgba: [225, 29, 72, 150] },
  ]);
}
