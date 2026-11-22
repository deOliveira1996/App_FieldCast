import {
  WEATHER_MODELS,
  type CircularStat,
  type NativeModelHour,
  type ScalarStat,
  type VerticalWindLevel,
  type VerticalWindProfile,
  type WeatherModelId,
} from '../types/weather';

export const NATIVE_WIND_HEIGHTS_M = [10, 80, 100, 120] as const;
export const INTERPOLATED_WIND_HEIGHTS_M = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
] as const;

export const MIN_NORMAL_SHEAR_ALPHA = 0.05;
export const MAX_NORMAL_SHEAR_ALPHA = 0.4;
export const ATYPICAL_SHEAR_MESSAGE =
  'Cisalhamento Atípico — Baixa Confiança na Interpolação';

/**
 * Filtra apenas números finitos válidos, ignorando `null`, `undefined` e `NaN`.
 */
export function filterValidNumbers(values: readonly (number | null | undefined)[]): number[] {
  const result: number[] = [];
  for (const val of values) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      result.push(val);
    }
  }
  return result;
}

/**
 * Calcula estatísticas escalares (média, mínimo, máximo e desvio padrão populacional)
 * ignorando valores `null` ou `undefined`.
 */
export function computeScalarStat(
  values: readonly (number | null | undefined)[],
  valuesByModel?: Partial<Record<WeatherModelId, number | null>>,
): ScalarStat {
  const valid = filterValidNumbers(values);
  const n = valid.length;

  if (n === 0) {
    return {
      mean: null,
      min: null,
      max: null,
      stdDev: null,
      sampleCount: 0,
      ...(valuesByModel ? { valuesByModel } : {}),
    };
  }

  let sum = 0;
  let min = valid[0]!;
  let max = valid[0]!;

  for (const v of valid) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const mean = sum / n;

  let varianceSum = 0;
  for (const v of valid) {
    const diff = v - mean;
    varianceSum += diff * diff;
  }
  const stdDev = Math.sqrt(varianceSum / n);

  return {
    mean,
    min,
    max,
    stdDev,
    sampleCount: n,
    ...(valuesByModel ? { valuesByModel } : {}),
  };
}

/**
 * Calcula `ScalarStat` diretamente a partir de um mapa de valores por modelo.
 */
export function computeModelScalarStat(
  valuesByModel: Partial<Record<WeatherModelId, number | null>>,
): ScalarStat {
  const values = WEATHER_MODELS.map((m) => valuesByModel[m] ?? null);
  return computeScalarStat(values, valuesByModel);
}

/**
 * Normaliza um ângulo em graus para o intervalo `[0, 360)`.
 */
export function normalizeAngleDeg(angleDeg: number): number {
  let normalized = ((angleDeg % 360) + 360) % 360;
  if (Math.abs(normalized - 360) < 1e-7 || Math.abs(normalized) < 1e-7) {
    normalized = 0;
  }
  return normalized;
}

/**
 * Decompõe um vetor meteorológico (direção de onde vem o vento/onda em graus e velocidade)
 * nas componentes zonais `u` e meridionais `v`:
 *   u = -speed * sin(theta * pi / 180)
 *   v = -speed * cos(theta * pi / 180)
 */
export function decomposeMeteorologicalVector(
  directionDeg: number,
  speed = 1,
): { u: number; v: number } {
  const rad = (directionDeg * Math.PI) / 180;
  const effectiveSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const u = -effectiveSpeed * Math.sin(rad);
  const v = -effectiveSpeed * Math.cos(rad);
  return { u, v };
}

/**
 * Reconstrói a direção meteorológica em graus `[0, 360)` a partir das médias `uMean` e `vMean`
 * usando `atan2(-u_mean, -v_mean)`.
 */
export function reconstructDirectionFromUV(uMean: number, vMean: number): number | null {
  const magnitude = Math.hypot(uMean, vMean);
  if (magnitude < 1e-9) {
    return null;
  }
  const rad = Math.atan2(-uMean, -vMean);
  const deg = (rad * 180) / Math.PI;
  return normalizeAngleDeg(deg);
}

/**
 * Calcula estatística circular vetorial para direções em graus (vento, onda, corrente).
 * - Decomposição vetorial: `u = -speed * sin(theta * pi / 180)`, `v = -speed * cos(theta * pi / 180)`.
 * - Reconstrução angular via `atan2(-u_mean, -v_mean)` normalizada para `[0, 360)`.
 * - Comprimento do vetor resultante médio unitário `R in [0, 1]` medindo a coerência direcional pura.
 */
export function computeCircularStat(
  anglesDeg: readonly (number | null | undefined)[],
  speeds?: readonly (number | null | undefined)[],
  valuesByModel?: Partial<Record<WeatherModelId, number | null>>,
): CircularStat {
  const validEntries: { angle: number; speed: number }[] = [];

  for (let i = 0; i < anglesDeg.length; i++) {
    const angle = anglesDeg[i];
    if (typeof angle === 'number' && Number.isFinite(angle)) {
      const rawSpeed = speeds?.[i];
      const speed =
        typeof rawSpeed === 'number' && Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1;
      validEntries.push({ angle, speed });
    }
  }

  const n = validEntries.length;
  if (n === 0) {
    return {
      degree: null,
      uMean: null,
      vMean: null,
      resultantLengthR: null,
      sampleCount: 0,
      ...(valuesByModel ? { valuesByModel } : {}),
    };
  }

  let uWeightedSum = 0;
  let vWeightedSum = 0;
  let uUnitSum = 0;
  let vUnitSum = 0;

  for (const entry of validEntries) {
    const weighted = decomposeMeteorologicalVector(entry.angle, entry.speed);
    uWeightedSum += weighted.u;
    vWeightedSum += weighted.v;

    const unit = decomposeMeteorologicalVector(entry.angle, 1);
    uUnitSum += unit.u;
    vUnitSum += unit.v;
  }

  const uMean = uWeightedSum / n;
  const vMean = vWeightedSum / n;
  const uUnitMean = uUnitSum / n;
  const vUnitMean = vUnitSum / n;

  const rawR = Math.hypot(uUnitMean, vUnitMean);
  const resultantLengthR = Math.max(0, Math.min(1, rawR));

  // Reconstrói direção a partir de uMean/vMean; se cancelarem perfeitamente (R ~ 0),
  // retorna 0° como convenção numérica ou reconstrói do vetor unitário.
  let degree = reconstructDirectionFromUV(uMean, vMean);
  if (degree === null) {
    degree = reconstructDirectionFromUV(uUnitMean, vUnitMean) ?? 0;
  }

  return {
    degree,
    uMean,
    vMean,
    resultantLengthR,
    sampleCount: n,
    ...(valuesByModel ? { valuesByModel } : {}),
  };
}

/**
 * Calcula `CircularStat` diretamente a partir de mapas de direção e velocidade por modelo.
 */
export function computeModelCircularStat(
  directionsByModel: Partial<Record<WeatherModelId, number | null>>,
  speedsByModel?: Partial<Record<WeatherModelId, number | null>>,
): CircularStat {
  const angles = WEATHER_MODELS.map((m) => directionsByModel[m] ?? null);
  const speeds = speedsByModel ? WEATHER_MODELS.map((m) => speedsByModel[m] ?? null) : undefined;
  return computeCircularStat(angles, speeds, directionsByModel);
}

/**
 * Ajusta dinamicamente o expoente de cisalhamento `alpha` da Lei de Potência:
 *   v(z) = v_ref * (z / z_ref)^alpha
 * a partir dos níveis nativos válidos disponíveis na hora.
 */
export function fitPowerLawAlpha(
  levels: readonly { heightM: number; speedKmh: number | null }[],
): number | null {
  const valid = levels
    .filter(
      (l): l is { heightM: number; speedKmh: number } =>
        l.heightM > 0 &&
        typeof l.speedKmh === 'number' &&
        Number.isFinite(l.speedKmh) &&
        l.speedKmh > 0.1,
    )
    .sort((a, b) => a.heightM - b.heightM);

  if (valid.length < 2) {
    return null;
  }

  const ref = valid[0]!;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 1; i < valid.length; i++) {
    const item = valid[i]!;
    const x = Math.log(item.heightM / ref.heightM);
    const y = Math.log(item.speedKmh / ref.speedKmh);
    sumXY += x * y;
    sumXX += x * x;
  }

  if (sumXX < 1e-12) {
    return null;
  }

  return sumXY / sumXX;
}

/**
 * Interpola a direção circularmente entre níveis nativos adjacentes.
 */
function interpolateDirectionAtHeight(
  heightM: number,
  nativeLevels: readonly VerticalWindLevel[],
): number | null {
  const validDirs = nativeLevels
    .filter(
      (l): l is VerticalWindLevel & { directionDeg: number } =>
        typeof l.directionDeg === 'number' && Number.isFinite(l.directionDeg),
    )
    .sort((a, b) => a.heightM - b.heightM);

  if (validDirs.length === 0) {
    return null;
  }
  if (validDirs.length === 1) {
    return normalizeAngleDeg(validDirs[0]!.directionDeg);
  }

  const exact = validDirs.find((l) => l.heightM === heightM);
  if (exact) {
    return normalizeAngleDeg(exact.directionDeg);
  }

  let lower = validDirs[0]!;
  let upper = validDirs[validDirs.length - 1]!;

  for (let i = 0; i < validDirs.length - 1; i++) {
    const curr = validDirs[i]!;
    const next = validDirs[i + 1]!;
    if (heightM >= curr.heightM && heightM <= next.heightM) {
      lower = curr;
      upper = next;
      break;
    }
  }

  if (lower.heightM === upper.heightM) {
    return normalizeAngleDeg(lower.directionDeg);
  }

  const t = Math.max(0, Math.min(1, (heightM - lower.heightM) / (upper.heightM - lower.heightM)));
  const vLow = decomposeMeteorologicalVector(lower.directionDeg, 1);
  const vHigh = decomposeMeteorologicalVector(upper.directionDeg, 1);
  const uInterp = (1 - t) * vLow.u + t * vHigh.u;
  const vInterp = (1 - t) * vLow.v + t * vHigh.v;
  return reconstructDirectionFromUV(uInterp, vInterp) ?? normalizeAngleDeg(lower.directionDeg);
}

/**
 * Constrói o perfil vertical de vento (0m a 120m):
 * - Níveis nativos (`10m`, `80m`, `100m`, `120m`) como dados primários (`isInterpolated: false`).
 * - Camada interpolada de 10 em 10m (`10m` a `120m`) usando a Lei de Potência `v(z) = v_ref * (z / z_ref)^alpha`.
 * - Double-Check Obrigatório: marca níveis interpolados com `isInterpolated: true` e `label: "Estimado"`.
 *   Se `alpha < 0.05` ou `alpha > 0.40`, ativa `atypicalShearWarning: true` com a mensagem
 *   `"Cisalhamento Atípico — Baixa Confiança na Interpolação"`.
 */
export function buildVerticalWindProfile(input: {
  speed10m: number | null;
  speed80m: number | null;
  speed100m: number | null;
  speed120m: number | null;
  direction10m?: number | null;
  direction80m?: number | null;
  direction100m?: number | null;
  direction120m?: number | null;
}): VerticalWindProfile {
  const nativeLevels: VerticalWindLevel[] = [
    {
      heightM: 10,
      speedKmh: input.speed10m ?? null,
      directionDeg: input.direction10m ?? null,
      isInterpolated: false,
      label: 'Nativo',
    },
    {
      heightM: 80,
      speedKmh: input.speed80m ?? null,
      directionDeg: input.direction80m ?? null,
      isInterpolated: false,
      label: 'Nativo',
    },
    {
      heightM: 100,
      speedKmh: input.speed100m ?? null,
      directionDeg: input.direction100m ?? null,
      isInterpolated: false,
      label: 'Nativo',
    },
    {
      heightM: 120,
      speedKmh: input.speed120m ?? null,
      directionDeg: input.direction120m ?? null,
      isInterpolated: false,
      label: 'Nativo',
    },
  ];

  const alpha = fitPowerLawAlpha(nativeLevels);
  const atypicalShearWarning =
    alpha !== null && (alpha < MIN_NORMAL_SHEAR_ALPHA || alpha > MAX_NORMAL_SHEAR_ALPHA);
  const shearWarningMessage = atypicalShearWarning ? ATYPICAL_SHEAR_MESSAGE : null;

  const refLevel = nativeLevels.find(
    (l) => typeof l.speedKmh === 'number' && Number.isFinite(l.speedKmh) && l.speedKmh > 0,
  );

  const interpolatedLevels: VerticalWindLevel[] = INTERPOLATED_WIND_HEIGHTS_M.map((heightM) => {
    let speedKmh: number | null = null;
    if (refLevel && refLevel.speedKmh !== null && alpha !== null) {
      speedKmh = refLevel.speedKmh * Math.pow(heightM / refLevel.heightM, alpha);
    } else if (refLevel && refLevel.speedKmh !== null && heightM === refLevel.heightM) {
      speedKmh = refLevel.speedKmh;
    }

    return {
      heightM,
      speedKmh,
      directionDeg: interpolateDirectionAtHeight(heightM, nativeLevels),
      isInterpolated: true,
      label: 'Estimado',
    };
  });

  return {
    nativeLevels,
    interpolatedLevels,
    alpha,
    atypicalShearWarning,
    shearWarningMessage,
  };
}

/**
 * Extrai a série horária individual de cada modelo nativo (`ecmwf_ifs025`, `gfs_seamless`, `icon_seamless`).
 * Nota: Rajadas são mantidas estritamente em `10m` (`windGusts10m`).
 */
export function extractNativeModelSeries(
  timesUnix: readonly number[],
  model: WeatherModelId,
  hourlyRaw: Record<string, readonly (number | null)[] | undefined>,
): NativeModelHour[] {
  const getAt = (prefix: string, idx: number): number | null => {
    const key = `${prefix}_${model}`;
    const arr = hourlyRaw[key];
    if (!arr || idx >= arr.length) return null;
    const val = arr[idx];
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  };

  return timesUnix.map((timestampUnix, idx) => ({
    timestampUnix,
    timestampIso: new Date(timestampUnix * 1000).toISOString(),
    model,
    windSpeed10m: getAt('wind_speed_10m', idx),
    windSpeed80m: getAt('wind_speed_80m', idx),
    windSpeed100m: getAt('wind_speed_100m', idx),
    windSpeed120m: getAt('wind_speed_120m', idx),
    windDirection10m: getAt('wind_direction_10m', idx),
    windDirection80m: getAt('wind_direction_80m', idx),
    windDirection100m: getAt('wind_direction_100m', idx),
    windDirection120m: getAt('wind_direction_120m', idx),
    windGusts10m: getAt('wind_gusts_10m', idx),
    precipitation: getAt('precipitation', idx),
    precipitationProbability: getAt('precipitation_probability', idx),
    temperature2m: getAt('temperature_2m', idx),
    dewPoint2m: getAt('dew_point_2m', idx),
    visibility: getAt('visibility', idx),
    surfacePressure: getAt('surface_pressure', idx),
    cloudCoverLow: getAt('cloud_cover_low', idx),
    cloudCoverMid: getAt('cloud_cover_mid', idx),
    cloudCoverHigh: getAt('cloud_cover_high', idx),
  }));
}
