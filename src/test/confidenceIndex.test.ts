import { describe, expect, it } from 'vitest';
import {
  computeHourlyConfidence,
  computeOverallConfidence,
  computeTimeHorizonPoints,
  getConfidenceBadgeColor,
  SHEAR_PENALTY_POINTS,
} from '../utils/confidenceIndex';
import { computeCircularStat, computeScalarStat } from '../utils/ensembleMath';

describe('confidenceIndex — 0–100 Reliability Score & Continental Rule', () => {
  const agreedWind = computeScalarStat([18, 18.5, 17.8]);
  const agreedDir = computeCircularStat([90, 92, 88]);
  const agreedTemp = computeScalarStat([24, 24.2, 23.9]);
  const agreedPrecip = computeScalarStat([0, 0, 0]);
  const agreedPressure = computeScalarStat([1015, 1015.2, 1014.9]);

  it('applies Continental Rule: inland coordinates without marine grid suffer ZERO penalty compared to coastal coordinates', () => {
    const coastalScore = computeHourlyConfidence({
      hourIndex: 6,
      windSpeed10m: agreedWind,
      windDirection10m: agreedDir,
      temperature2mC: agreedTemp,
      precipitationMm: agreedPrecip,
      surfacePressureHpa: agreedPressure,
      activeAtmosphericModels: 3,
      marineAvailable: true,
      isContinental: false,
      cacheAgeMinutes: 0,
      alpha: 0.14,
      atypicalShearWarning: false,
    });

    const continentalScore = computeHourlyConfidence({
      hourIndex: 6,
      windSpeed10m: agreedWind,
      windDirection10m: agreedDir,
      temperature2mC: agreedTemp,
      precipitationMm: agreedPrecip,
      surfacePressureHpa: agreedPressure,
      activeAtmosphericModels: 3,
      marineAvailable: false,
      // When marineAvailable === false and no marineApiError, isContinental is inferred true
      cacheAgeMinutes: 0,
      alpha: 0.14,
      atypicalShearWarning: false,
    });

    expect(continentalScore.isContinental).toBe(true);
    expect(coastalScore.isContinental).toBe(false);
    expect(continentalScore.breakdown.sourceIntegrity).toBe(30);
    expect(coastalScore.breakdown.sourceIntegrity).toBe(30);
    expect(continentalScore.total).toBe(coastalScore.total);
    expect(continentalScore.badge).toBe('green');
  });

  it('penalizes coastal marine API failure when isContinental is false and marineAvailable is false', () => {
    const coastalMarineFailed = computeHourlyConfidence({
      hourIndex: 6,
      windSpeed10m: agreedWind,
      windDirection10m: agreedDir,
      temperature2mC: agreedTemp,
      precipitationMm: agreedPrecip,
      surfacePressureHpa: agreedPressure,
      activeAtmosphericModels: 3,
      marineAvailable: false,
      isContinental: false,
      marineApiError: true,
      cacheAgeMinutes: 0,
      alpha: 0.14,
    });

    expect(coastalMarineFailed.breakdown.sourceIntegrity).toBe(25);
  });

  it('deducts explicit shear penalty when alpha is outside [0.05, 0.40] with interpolation active', () => {
    const normalShear = computeHourlyConfidence({
      hourIndex: 10,
      windSpeed10m: agreedWind,
      windDirection10m: agreedDir,
      marineAvailable: false,
      alpha: 0.15,
      atypicalShearWarning: false,
      interpolationActive: true,
    });

    const atypicalShear = computeHourlyConfidence({
      hourIndex: 10,
      windSpeed10m: agreedWind,
      windDirection10m: agreedDir,
      marineAvailable: false,
      alpha: 0.52,
      atypicalShearWarning: true,
      interpolationActive: true,
    });

    expect(normalShear.breakdown.shearPenalty).toBe(0);
    expect(atypicalShear.breakdown.shearPenalty).toBe(SHEAR_PENALTY_POINTS);
    expect(atypicalShear.total).toBe(normalShear.total - SHEAR_PENALTY_POINTS);
  });

  it('decays time horizon points across 0-24h, 24-72h and > 72h', () => {
    const h12 = computeTimeHorizonPoints(12);
    const h48 = computeTimeHorizonPoints(48);
    const h120 = computeTimeHorizonPoints(120);

    expect(h12).toBe(20);
    expect(h48).toBeLessThan(20);
    expect(h48).toBeGreaterThanOrEqual(14);
    expect(h120).toBeLessThan(14);
  });

  it('penalizes high model divergence, stale cache > 30 min, and maps badge colors properly', () => {
    const divergentWind = computeScalarStat([5, 25, 48]);
    const opposingDir = computeCircularStat([0, 120, 240]);

    const degradedScore = computeHourlyConfidence({
      hourIndex: 140,
      windSpeed10m: divergentWind,
      windDirection10m: opposingDir,
      activeAtmosphericModels: 1,
      marineAvailable: false,
      isContinental: false,
      marineApiError: true,
      cacheAgeMinutes: 240,
      alpha: 0.01,
      atypicalShearWarning: true,
      interpolationActive: true,
    });

    expect(degradedScore.total).toBeLessThan(50);
    expect(degradedScore.badge).toBe('red');
    expect(getConfidenceBadgeColor(85)).toBe('green');
    expect(getConfidenceBadgeColor(65)).toBe('amber');
    expect(getConfidenceBadgeColor(30)).toBe('red');

    const overall = computeOverallConfidence([
      { hourIndex: 0, confidence: degradedScore },
      { hourIndex: 1, confidence: degradedScore },
    ]);
    expect(overall.total).toBe(degradedScore.total);
    expect(overall.badge).toBe('red');
  });
});
