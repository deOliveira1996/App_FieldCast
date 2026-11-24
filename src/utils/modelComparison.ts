import {
  WEATHER_MODELS,
  type NativeModelHour,
  type NormalizedForecast,
  type WeatherModelId,
} from '../types/weather';

export type ComparableVariableId =
  | 'windSpeed10m'
  | 'windGusts10m'
  | 'windDirection10m'
  | 'windSpeed80m'
  | 'windDirection80m'
  | 'windSpeed100m'
  | 'windDirection100m'
  | 'windSpeed120m'
  | 'windDirection120m'
  | 'temperature2m'
  | 'dewPoint2m'
  | 'visibility'
  | 'precipitation'
  | 'precipitationProbability'
  | 'surfacePressure'
  | 'cloudCoverHigh'
  | 'cloudCoverMid'
  | 'cloudCoverLow';

export type ComparableVariableGroup =
  | 'wind10m'
  | 'verticalProfile'
  | 'tempVisibility'
  | 'rainPressure'
  | 'clouds';

export interface ComparableVariableDefinition {
  id: ComparableVariableId;
  field: Exclude<keyof NativeModelHour, 'timestampUnix' | 'timestampIso' | 'model'>;
  label: string;
  shortLabel: string;
  unit: string;
  group: ComparableVariableGroup;
  isDirection?: boolean;
}

export const MODEL_SHORT_LABELS: Record<WeatherModelId, string> = {
  ecmwf_ifs025: 'ECMWF 9 km',
  gfs_seamless: 'GFS 13 km',
  icon_seamless: 'ICON 13 km',
  gem_seamless: 'GEM 15 km',
};

export const MODEL_DISPLAY_LABELS: Record<WeatherModelId, string> = {
  ecmwf_ifs025: 'ECMWF IFS 0.25°',
  gfs_seamless: 'NOAA GFS',
  icon_seamless: 'DWD ICON',
  gem_seamless: 'CMC GEM',
};

export const MODEL_COLORS: Record<WeatherModelId, string> = {
  ecmwf_ifs025: '#0080cd',
  gfs_seamless: '#10b981',
  icon_seamless: '#6366f1',
  gem_seamless: '#f59e0b',
};

export const COMPARABLE_VARIABLES: ReadonlyArray<ComparableVariableDefinition> = [
  {
    id: 'windSpeed10m',
    field: 'windSpeed10m',
    label: 'Vento (km/h)',
    shortLabel: 'Vento 10m',
    unit: 'km/h',
    group: 'wind10m',
  },
  {
    id: 'windGusts10m',
    field: 'windGusts10m',
    label: 'Rajadas (km/h)',
    shortLabel: 'Rajadas 10m',
    unit: 'km/h',
    group: 'wind10m',
  },
  {
    id: 'windDirection10m',
    field: 'windDirection10m',
    label: 'Direção do vento',
    shortLabel: 'Dir. 10m',
    unit: '°',
    group: 'wind10m',
    isDirection: true,
  },
  {
    id: 'windSpeed80m',
    field: 'windSpeed80m',
    label: 'Vento 80m (km/h)',
    shortLabel: 'Vento 80m',
    unit: 'km/h',
    group: 'verticalProfile',
  },
  {
    id: 'windDirection80m',
    field: 'windDirection80m',
    label: 'Direção 80m',
    shortLabel: 'Dir. 80m',
    unit: '°',
    group: 'verticalProfile',
    isDirection: true,
  },
  {
    id: 'windSpeed100m',
    field: 'windSpeed100m',
    label: 'Vento 100m (km/h)',
    shortLabel: 'Vento 100m',
    unit: 'km/h',
    group: 'verticalProfile',
  },
  {
    id: 'windDirection100m',
    field: 'windDirection100m',
    label: 'Direção 100m',
    shortLabel: 'Dir. 100m',
    unit: '°',
    group: 'verticalProfile',
    isDirection: true,
  },
  {
    id: 'windSpeed120m',
    field: 'windSpeed120m',
    label: 'Vento 120m (km/h)',
    shortLabel: 'Vento 120m',
    unit: 'km/h',
    group: 'verticalProfile',
  },
  {
    id: 'windDirection120m',
    field: 'windDirection120m',
    label: 'Direção 120m',
    shortLabel: 'Dir. 120m',
    unit: '°',
    group: 'verticalProfile',
    isDirection: true,
  },
  {
    id: 'temperature2m',
    field: 'temperature2m',
    label: 'Temperatura (°C)',
    shortLabel: 'Temp 2m',
    unit: '°C',
    group: 'tempVisibility',
  },
  {
    id: 'dewPoint2m',
    field: 'dewPoint2m',
    label: 'Ponto de Orvalho (°C)',
    shortLabel: 'Orvalho 2m',
    unit: '°C',
    group: 'tempVisibility',
  },
  {
    id: 'visibility',
    field: 'visibility',
    label: 'Visibilidade (km)',
    shortLabel: 'Visibilidade',
    unit: 'km',
    group: 'tempVisibility',
  },
  {
    id: 'precipitation',
    field: 'precipitation',
    label: 'Precipitação (mm/h)',
    shortLabel: 'Chuva',
    unit: 'mm/h',
    group: 'rainPressure',
  },
  {
    id: 'precipitationProbability',
    field: 'precipitationProbability',
    label: 'Prob. Chuva (%)',
    shortLabel: 'Prob. Chuva',
    unit: '%',
    group: 'rainPressure',
  },
  {
    id: 'surfacePressure',
    field: 'surfacePressure',
    label: 'Pressão (hPa)',
    shortLabel: 'Pressão',
    unit: 'hPa',
    group: 'rainPressure',
  },
  {
    id: 'cloudCoverHigh',
    field: 'cloudCoverHigh',
    label: 'Nuvens Altas (%)',
    shortLabel: 'Nuvens Altas',
    unit: '%',
    group: 'clouds',
  },
  {
    id: 'cloudCoverMid',
    field: 'cloudCoverMid',
    label: 'Nuvens Médias (%)',
    shortLabel: 'Nuvens Médias',
    unit: '%',
    group: 'clouds',
  },
  {
    id: 'cloudCoverLow',
    field: 'cloudCoverLow',
    label: 'Nuvens Baixas (%)',
    shortLabel: 'Nuvens Baixas',
    unit: '%',
    group: 'clouds',
  },
];

const COMPARABLE_VAR_BY_ID: Record<ComparableVariableId, ComparableVariableDefinition> =
  COMPARABLE_VARIABLES.reduce(
    (acc, def) => {
      acc[def.id] = def;
      return acc;
    },
    {} as Record<ComparableVariableId, ComparableVariableDefinition>,
  );

export function getComparableVariableDefinition(
  varId: ComparableVariableId,
): ComparableVariableDefinition {
  return COMPARABLE_VAR_BY_ID[varId];
}

/**
 * Dynamically returns active weather models (`WEATHER_MODELS`) having at least
 * one finite numeric value for `varId` in `forecast.nativeByModel[model]`
 * within the optional `hourLimit` slice.
 *
 * A variable is comparable iff `getSharedModelsForVariable(...).length >= 2`.
 */
export function getSharedModelsForVariable(
  forecast: NormalizedForecast,
  varId: ComparableVariableId,
  hourLimit?: number,
): WeatherModelId[] {
  const def = COMPARABLE_VAR_BY_ID[varId];
  const field = def.field;
  const activeModels: WeatherModelId[] = [];

  for (const modelId of WEATHER_MODELS) {
    const rawSeries = forecast.nativeByModel?.[modelId] ?? [];
    const series = hourLimit !== undefined ? rawSeries.slice(0, hourLimit) : rawSeries;
    const hasValue = series.some((hour) => {
      const val = hour?.[field];
      return typeof val === 'number' && Number.isFinite(val);
    });
    if (hasValue) {
      activeModels.push(modelId);
    }
  }

  return activeModels;
}

export function isVariableComparable(
  forecast: NormalizedForecast,
  varId: ComparableVariableId,
  hourLimit?: number,
): boolean {
  return getSharedModelsForVariable(forecast, varId, hourLimit).length >= 2;
}

export interface SharedComparableVariableStatus {
  id: ComparableVariableId;
  definition: ComparableVariableDefinition;
  activeModels: WeatherModelId[];
  isComparable: boolean;
}

export function detectSharedComparableVariables(
  forecast: NormalizedForecast,
  hourLimit?: number,
): SharedComparableVariableStatus[] {
  return COMPARABLE_VARIABLES.map((definition) => {
    const activeModels = getSharedModelsForVariable(forecast, definition.id, hourLimit);
    return {
      id: definition.id,
      definition,
      activeModels,
      isComparable: activeModels.length >= 2,
    };
  });
}

export function getSharedModelsMap(
  forecast: NormalizedForecast,
  hourLimit?: number,
): Record<ComparableVariableId, WeatherModelId[]> {
  const result = {} as Record<ComparableVariableId, WeatherModelId[]>;
  for (const def of COMPARABLE_VARIABLES) {
    result[def.id] = getSharedModelsForVariable(forecast, def.id, hourLimit);
  }
  return result;
}
