import { describe, expect, it } from 'vitest';
import openMeteoCoastal from './fixtures/openMeteoCoastal.json';
import openMeteoInland from './fixtures/openMeteoInland.json';
import marineCoastal from './fixtures/marineCoastal.json';
import marineInland from './fixtures/marineInland.json';
import {
  hasValidMarineGrid,
  OpenMeteoForecastResponseSchema,
  OpenMeteoMarineResponseSchema,
  SafeWindowThresholdsSchema,
} from '../types/schemas';
import { DEFAULT_SAFE_WINDOW_THRESHOLDS } from '../types/weather';

describe('Open-Meteo Real API Probe Fixtures & Zod Schemas', () => {
  it('validates coastal multi-model forecast fixture (Florianópolis 48h)', () => {
    const parsed = OpenMeteoForecastResponseSchema.parse(openMeteoCoastal);
    expect(parsed.hourly.time).toHaveLength(48);
    expect(typeof parsed.elevation).toBe('number');
    expect(parsed.timezone).toBe('America/Sao_Paulo');

    // Verify all 3 models return 48h wind series and handle model-specific null series (e.g. visibility in ECMWF/ICON)
    expect(parsed.hourly.wind_speed_10m_ecmwf_ifs025?.some((v) => v !== null)).toBe(true);
    expect(parsed.hourly.wind_speed_100m_ecmwf_ifs025?.some((v) => v !== null)).toBe(true);
    expect(parsed.hourly.wind_speed_10m_gfs_seamless?.some((v) => v !== null)).toBe(true);
    expect(parsed.hourly.wind_speed_80m_gfs_seamless?.some((v) => v !== null)).toBe(true);
    expect(parsed.hourly.wind_speed_120m_gfs_seamless?.some((v) => v !== null)).toBe(true);
    expect(parsed.hourly.wind_speed_10m_icon_seamless?.some((v) => v !== null)).toBe(true);

    // Real probe discovery: visibility is 100% null on ecmwf_ifs025 & icon_seamless, and populated on gfs_seamless
    expect(parsed.hourly.visibility_ecmwf_ifs025?.every((v) => v === null)).toBe(true);
    expect(parsed.hourly.visibility_icon_seamless?.every((v) => v === null)).toBe(true);
    expect(parsed.hourly.visibility_gfs_seamless?.some((v) => v !== null)).toBe(true);
  });

  it('accepts partial or null vertical wind levels when a model omits 80m/100m/120m', () => {
    const syntheticPayload = {
      latitude: -27.5954,
      longitude: -48.548,
      utc_offset_seconds: -10800,
      timezone: 'America/Sao_Paulo',
      elevation: 23,
      hourly: {
        time: [1795316400, 1795320000],
        wind_speed_10m_ecmwf_ifs025: [12.5, 14.0],
        wind_speed_100m_ecmwf_ifs025: [18.2, 20.1],
        // 80m and 120m omitted or null for ECMWF
        wind_speed_80m_ecmwf_ifs025: [null, null],
      },
    };

    const parsed = OpenMeteoForecastResponseSchema.parse(syntheticPayload);
    expect(parsed.hourly.wind_speed_10m_ecmwf_ifs025).toEqual([12.5, 14.0]);
    expect(parsed.hourly.wind_speed_80m_ecmwf_ifs025).toEqual([null, null]);
    expect(parsed.hourly.wind_speed_120m_ecmwf_ifs025).toBeUndefined();
  });

  it('validates inland multi-model forecast fixture (Brasília 48h)', () => {
    const parsed = OpenMeteoForecastResponseSchema.parse(openMeteoInland);
    expect(parsed.hourly.time).toHaveLength(48);
    expect(parsed.elevation).toBeGreaterThan(900);
    expect(parsed.hourly.surface_pressure_ecmwf_ifs025?.some((v) => v !== null)).toBe(true);
  });

  it('validates coastal marine fixture (Florianópolis 48h) and detects active marine grid', () => {
    const parsed = OpenMeteoMarineResponseSchema.parse(marineCoastal);
    expect(parsed.hourly.time).toHaveLength(48);
    expect(hasValidMarineGrid(parsed)).toBe(true);
    expect(parsed.hourly.wave_height?.some((v) => v !== null)).toBe(true);
    expect(parsed.hourly.swell_wave_height?.some((v) => v !== null)).toBe(true);
    expect(parsed.hourly.ocean_current_velocity?.some((v) => v !== null)).toBe(true);
  });

  it('validates inland marine fixture (Brasília 48h) and detects continental null marine grid without error', () => {
    const parsed = OpenMeteoMarineResponseSchema.parse(marineInland);
    expect(parsed.hourly.time).toHaveLength(48);
    expect(hasValidMarineGrid(parsed)).toBe(false);
    expect(parsed.hourly.wave_height?.every((v) => v === null)).toBe(true);
  });

  it('validates default SafeWindowThresholds', () => {
    const parsed = SafeWindowThresholdsSchema.parse(DEFAULT_SAFE_WINDOW_THRESHOLDS);
    expect(parsed.maxWindKmh).toBe(30);
  });
});
