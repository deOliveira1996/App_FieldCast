import { describe, expect, it } from 'vitest';
import { createCoastalTestForecast } from './testUtils';
import {
  COMPARABLE_VARIABLES,
  detectSharedComparableVariables,
  getSharedModelsForVariable,
  isVariableComparable,
} from '../utils/modelComparison';

describe('modelComparison — R2 Dynamic Shared Parameter Detection', () => {
  it('catalogs all 18 NativeModelHour atmospheric variables', () => {
    expect(COMPARABLE_VARIABLES).toHaveLength(18);
  });

  it('detects 17 shared atmospheric parameters in openMeteoCoastal fixture and excludes 1-model visibility', () => {
    const forecast = createCoastalTestForecast();

    // In real Open-Meteo coastal fixture, visibility is only populated on gfs_seamless
    expect(getSharedModelsForVariable(forecast, 'visibility')).toEqual(['gfs_seamless']);
    expect(isVariableComparable(forecast, 'visibility')).toBe(false);

    // Wind, gusts, temperature, dew point, precip, precip prob, pressure, clouds, altitude levels all have 3 models
    expect(getSharedModelsForVariable(forecast, 'windSpeed10m')).toEqual([
      'ecmwf_ifs025',
      'gfs_seamless',
      'icon_seamless',
    ]);
    expect(getSharedModelsForVariable(forecast, 'windGusts10m')).toHaveLength(3);
    expect(getSharedModelsForVariable(forecast, 'temperature2m')).toHaveLength(3);
    expect(getSharedModelsForVariable(forecast, 'dewPoint2m')).toHaveLength(3);
    expect(getSharedModelsForVariable(forecast, 'precipitation')).toHaveLength(3);
    expect(getSharedModelsForVariable(forecast, 'precipitationProbability')).toHaveLength(3);
    expect(getSharedModelsForVariable(forecast, 'surfacePressure')).toHaveLength(3);
    expect(getSharedModelsForVariable(forecast, 'cloudCoverLow')).toHaveLength(3);

    const statuses = detectSharedComparableVariables(forecast);
    const comparable = statuses.filter((s) => s.isComparable);
    const nonComparable = statuses.filter((s) => !s.isComparable);

    expect(comparable).toHaveLength(17);
    expect(nonComparable.map((s) => s.id)).toEqual(['visibility']);
  });

  it('dynamically handles partial-model availability (>= 2 active models) and hourLimit slices', () => {
    const forecast = createCoastalTestForecast();

    // Remove 80m wind from ECMWF -> still comparable via GFS + ICON (2 models)
    for (const h of forecast.nativeByModel.ecmwf_ifs025) {
      h.windSpeed80m = null;
    }
    expect(getSharedModelsForVariable(forecast, 'windSpeed80m')).toEqual([
      'gfs_seamless',
      'icon_seamless',
    ]);
    expect(isVariableComparable(forecast, 'windSpeed80m')).toBe(true);

    // Remove 100m wind from GFS and ICON -> only ECMWF remains -> NOT comparable
    for (const h of forecast.nativeByModel.gfs_seamless) {
      h.windSpeed100m = null;
    }
    for (const h of forecast.nativeByModel.icon_seamless) {
      h.windSpeed100m = null;
    }
    expect(getSharedModelsForVariable(forecast, 'windSpeed100m')).toEqual(['ecmwf_ifs025']);
    expect(isVariableComparable(forecast, 'windSpeed100m')).toBe(false);

    // Populate visibility on a 2nd model only at hour 30 -> not comparable in 24h slice, comparable in 48h slice
    forecast.nativeByModel.ecmwf_ifs025[30]!.visibility = 18000;
    expect(isVariableComparable(forecast, 'visibility', 24)).toBe(false);
    expect(isVariableComparable(forecast, 'visibility', 48)).toBe(true);
    expect(getSharedModelsForVariable(forecast, 'visibility', 48)).toEqual([
      'ecmwf_ifs025',
      'gfs_seamless',
    ]);
  });

  it('returns zero comparable variables when only a single model has data', () => {
    const forecast = createCoastalTestForecast();
    forecast.nativeByModel.gfs_seamless = [];
    forecast.nativeByModel.icon_seamless = [];

    const statuses = detectSharedComparableVariables(forecast);
    expect(statuses.every((s) => !s.isComparable)).toBe(true);
  });
});
