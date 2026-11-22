import { describe, expect, it } from 'vitest';
import { DEFAULT_SAFE_WINDOW_THRESHOLDS } from '../types/weather';
import {
  buildStratifiedCloudCover,
  computeDewPointSpread,
  computeEphemerisForDate,
  computeEphemerisRange,
  computePressureDelta3h,
  evaluateBarometricTendency,
  evaluateFogRisk,
  evaluateSafeWindow,
  getMoonPhaseLabel,
  isBarometricSquallRisk,
} from '../utils/operationalAlerts';

describe('operationalAlerts — Safe Window Semaphore, Barometric Squall, Fog & Ephemeris', () => {
  describe('Configurable Safe Window Semaphore', () => {
    it('returns green when all metrics are comfortably below 75% of thresholds', () => {
      const res = evaluateSafeWindow(
        {
          windSpeed10mKmh: 12,
          windGusts10mKmh: 20,
          waveHeightM: 0.8,
          precipProbPct: 15,
        },
        DEFAULT_SAFE_WINDOW_THRESHOLDS,
      );
      expect(res.status).toBe('green');
    });

    it('returns amber when any metric enters the caution zone (>= 75% of threshold)', () => {
      const res = evaluateSafeWindow(
        {
          windSpeed10mKmh: 24, // 80% of 30 km/h
          windGusts10mKmh: 28,
          waveHeightM: 1.0,
          precipProbPct: 20,
        },
        DEFAULT_SAFE_WINDOW_THRESHOLDS,
      );
      expect(res.status).toBe('amber');
      expect(res.reasons.some((r) => r.includes('Vento 10m'))).toBe(true);
    });

    it('returns red when any metric reaches or exceeds the threshold', () => {
      const res = evaluateSafeWindow(
        {
          windSpeed10mKmh: 18,
          windGusts10mKmh: 50, // >= 45 km/h
          waveHeightM: 2.5, // >= 2.0 m
          precipProbPct: 10,
        },
        DEFAULT_SAFE_WINDOW_THRESHOLDS,
      );
      expect(res.status).toBe('red');
      expect(res.reasons).toHaveLength(2);
    });
  });

  describe('Barometric Tendency (Delta P / 3h > 4 hPa squall alert)', () => {
    it('detects pressure drop > 4 hPa in 3 hours and triggers squall risk', () => {
      const pressures = [1016.0, 1014.5, 1013.0, 1011.2];
      const delta3h = computePressureDelta3h(pressures, 3);
      expect(delta3h).toBeCloseTo(-4.8, 2);
      expect(isBarometricSquallRisk(delta3h)).toBe(true);

      const direct = evaluateBarometricTendency(1016.0, 1011.2);
      expect(direct.delta3hHpa).toBeCloseTo(-4.8, 2);
      expect(direct.dropHpa).toBeCloseTo(4.8, 2);
      expect(direct.isSquallRisk).toBe(true);
    });

    it('does not trigger squall risk when pressure drop is <= 4 hPa or pressure is rising', () => {
      const pressures = [1015.0, 1014.0, 1013.0, 1012.0, 1016.5];
      const mildDrop = computePressureDelta3h(pressures, 3); // -3.0 hPa
      expect(mildDrop).toBeCloseTo(-3.0, 2);
      expect(isBarometricSquallRisk(mildDrop)).toBe(false);

      const rising = computePressureDelta3h(pressures, 4); // 1016.5 - 1014.0 = +2.5 hPa
      expect(rising).toBeCloseTo(2.5, 2);
      expect(isBarometricSquallRisk(rising)).toBe(false);
    });
  });

  describe('Fog & Visibility Alert (visibility < 1000m AND dew point spread < 2 °C)', () => {
    it('triggers fog risk only when BOTH visibility < 1000m AND temperature - dew_point < 2 °C', () => {
      const spread = computeDewPointSpread(16.5, 15.3);
      expect(spread).toBeCloseTo(1.2, 2);

      // Both conditions met -> true
      expect(
        evaluateFogRisk({
          visibilityM: 650,
          temperature2mC: 16.5,
          dewPoint2mC: 15.3,
        }),
      ).toBe(true);

      // Low visibility (700m) but dry air (spread = 5 °C) -> false (e.g., dust/haze, not fog)
      expect(
        evaluateFogRisk({
          visibilityM: 700,
          temperature2mC: 22.0,
          dewPoint2mC: 17.0,
        }),
      ).toBe(false);

      // High humidity (spread = 0.8 °C) but good visibility (4500m) -> false
      expect(
        evaluateFogRisk({
          visibilityM: 4500,
          temperature2mC: 18.0,
          dewPoint2mC: 17.2,
        }),
      ).toBe(false);
    });
  });

  describe('Stratified Cloud Cover & Offline Ephemeris (SunCalc)', () => {
    it('separates low, mid and high cloud cover statistics', () => {
      const clouds = buildStratifiedCloudCover({
        lowByModel: { ecmwf_ifs025: 80, gfs_seamless: 70, icon_seamless: 90 },
        midByModel: { ecmwf_ifs025: 20, gfs_seamless: 30, icon_seamless: 25 },
        highByModel: { ecmwf_ifs025: 10, gfs_seamless: 0, icon_seamless: 5 },
      });

      expect(clouds.lowPct.mean).toBeCloseTo(80, 2);
      expect(clouds.midPct.mean).toBeCloseTo(25, 2);
      expect(clouds.highPct.mean).toBeCloseTo(5, 2);
    });

    it('computes offline solar and lunar ephemeris via suncalc', () => {
      const ephem = computeEphemerisForDate(
        new Date('2026-03-20T12:00:00Z'),
        -27.5954,
        -48.548,
      );

      expect(ephem.dateIso).toBe('2026-03-20');
      expect(ephem.sunriseIso).toBeTruthy();
      expect(ephem.sunsetIso).toBeTruthy();
      expect(ephem.civilDawnIso).toBeTruthy();
      expect(ephem.nauticalDawnIso).toBeTruthy();
      expect(ephem.moonPhaseValue).toBeGreaterThanOrEqual(0);
      expect(ephem.moonPhaseValue).toBeLessThanOrEqual(1);
      expect(ephem.moonIlluminationPct).toBeGreaterThanOrEqual(0);
      expect(ephem.moonIlluminationPct).toBeLessThanOrEqual(100);
      expect(getMoonPhaseLabel(0)).toBe('Lua Nova');
      expect(getMoonPhaseLabel(0.5)).toBe('Lua Cheia');

      const range = computeEphemerisRange(-27.5954, -48.548, [
        1795316400,
        1795316400 + 86400,
      ]);
      expect(range.length).toBeGreaterThanOrEqual(2);
    });
  });
});
