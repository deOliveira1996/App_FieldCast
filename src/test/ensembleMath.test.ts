import { describe, expect, it } from 'vitest';
import {
  ATYPICAL_SHEAR_MESSAGE,
  buildVerticalWindProfile,
  computeCircularStat,
  computeModelCircularStat,
  computeModelScalarStat,
  computeScalarStat,
  decomposeMeteorologicalVector,
  fitPowerLawAlpha,
  normalizeAngleDeg,
  reconstructDirectionFromUV,
} from '../utils/ensembleMath';

describe('ensembleMath — Scalar, Circular Vector & Vertical Profile Engine', () => {
  describe('Scalar statistics (ignoring null/undefined)', () => {
    it('computes mean, min, max and population stdDev while ignoring null values', () => {
      const stat = computeScalarStat([10, null, 20, undefined, 30]);
      expect(stat.sampleCount).toBe(3);
      expect(stat.mean).toBeCloseTo(20, 5);
      expect(stat.min).toBe(10);
      expect(stat.max).toBe(30);
      // Population stdDev of [10, 20, 30] is sqrt(((100 + 0 + 100) / 3)) = sqrt(66.6667) ≈ 8.1649658
      expect(stat.stdDev).toBeCloseTo(Math.sqrt(200 / 3), 5);
    });

    it('returns null stats when all model values are null', () => {
      const stat = computeModelScalarStat({
        ecmwf_ifs025: null,
        gfs_seamless: null,
        icon_seamless: null,
      });
      expect(stat.sampleCount).toBe(0);
      expect(stat.mean).toBeNull();
      expect(stat.min).toBeNull();
      expect(stat.max).toBeNull();
      expect(stat.stdDev).toBeNull();
    });
  });

  describe('Circular vector statistics (u/v decomposition & unit resultant R)', () => {
    it('correctly computes circular mean across 0°/360° boundary: 350° and 10° -> 0° with R ≈ 1', () => {
      const stat = computeCircularStat([350, 10]);
      expect(stat.sampleCount).toBe(2);
      expect(stat.degree).not.toBeNull();
      expect(stat.degree!).toBeCloseTo(0, 5);
      expect(stat.resultantLengthR).not.toBeNull();
      // cos(10°) ≈ 0.9848077
      expect(stat.resultantLengthR!).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 4);
      expect(stat.resultantLengthR!).toBeGreaterThan(0.98);
    });

    it('detects opposing directions: 0° and 180° -> resultantLengthR ≈ 0', () => {
      const stat = computeCircularStat([0, 180]);
      expect(stat.sampleCount).toBe(2);
      expect(stat.resultantLengthR).not.toBeNull();
      expect(stat.resultantLengthR!).toBeCloseTo(0, 5);
    });

    it('decomposes and reconstructs meteorological directions accurately', () => {
      for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const { u, v } = decomposeMeteorologicalVector(angle, 15);
        const reconstructed = reconstructDirectionFromUV(u, v);
        expect(reconstructed).toBeCloseTo(angle, 5);
      }
      expect(normalizeAngleDeg(360)).toBe(0);
      expect(normalizeAngleDeg(-90)).toBe(270);
    });

    it('ignores null model directions in computeModelCircularStat', () => {
      const stat = computeModelCircularStat({
        ecmwf_ifs025: 355,
        gfs_seamless: null,
        icon_seamless: 5,
      });
      expect(stat.sampleCount).toBe(2);
      expect(stat.degree!).toBeCloseTo(0, 5);
      expect(stat.resultantLengthR!).toBeGreaterThan(0.99);
    });
  });

  describe('Vertical Wind Profile (Power Law & Double-Check Shear Alert)', () => {
    it('fits dynamic alpha inside normal range [0.05, 0.40] and marks interpolated 10m steps as Estimado', () => {
      // Using alpha = 0.14 (typical neutral stability): v(z) = 15 * (z / 10)^0.14
      const alphaTarget = 0.14;
      const v10 = 15;
      const v80 = v10 * Math.pow(80 / 10, alphaTarget);
      const v100 = v10 * Math.pow(100 / 10, alphaTarget);
      const v120 = v10 * Math.pow(120 / 10, alphaTarget);

      const profile = buildVerticalWindProfile({
        speed10m: v10,
        speed80m: v80,
        speed100m: v100,
        speed120m: v120,
        direction10m: 45,
        direction80m: 50,
        direction100m: 52,
        direction120m: 55,
      });

      expect(profile.alpha).not.toBeNull();
      expect(profile.alpha!).toBeCloseTo(alphaTarget, 4);
      expect(profile.atypicalShearWarning).toBe(false);
      expect(profile.shearWarningMessage).toBeNull();

      expect(profile.nativeLevels).toHaveLength(4);
      expect(profile.nativeLevels.every((l) => l.isInterpolated === false)).toBe(true);
      expect(profile.nativeLevels.every((l) => l.label === 'Nativo')).toBe(true);

      expect(profile.interpolatedLevels).toHaveLength(12); // 10m to 120m in 10m steps
      expect(profile.interpolatedLevels.every((l) => l.isInterpolated === true)).toBe(true);
      expect(profile.interpolatedLevels.every((l) => l.label === 'Estimado')).toBe(true);

      const level50m = profile.interpolatedLevels.find((l) => l.heightM === 50);
      expect(level50m?.speedKmh).toBeCloseTo(v10 * Math.pow(50 / 10, alphaTarget), 3);
    });

    it('triggers atypicalShearWarning when alpha < 0.05 (flat or negative shear)', () => {
      const profile = buildVerticalWindProfile({
        speed10m: 25,
        speed80m: 25.1,
        speed100m: 25.1,
        speed120m: 25.2,
      });

      expect(profile.alpha).not.toBeNull();
      expect(profile.alpha!).toBeLessThan(0.05);
      expect(profile.atypicalShearWarning).toBe(true);
      expect(profile.shearWarningMessage).toBe(ATYPICAL_SHEAR_MESSAGE);
    });

    it('triggers atypicalShearWarning when alpha > 0.40 (severe vertical wind shear)', () => {
      // v(100) = 10 * (100/10)^0.5 = 31.62 km/h -> alpha = 0.50 > 0.40
      const profile = buildVerticalWindProfile({
        speed10m: 10,
        speed80m: null,
        speed100m: 31.6228,
        speed120m: null,
      });

      expect(profile.alpha).not.toBeNull();
      expect(profile.alpha!).toBeCloseTo(0.5, 2);
      expect(profile.atypicalShearWarning).toBe(true);
      expect(profile.shearWarningMessage).toBe(ATYPICAL_SHEAR_MESSAGE);
    });

    it('returns null alpha when fewer than 2 native levels have positive wind speed', () => {
      const alpha = fitPowerLawAlpha([
        { heightM: 10, speedKmh: 12 },
        { heightM: 80, speedKmh: null },
        { heightM: 100, speedKmh: null },
      ]);
      expect(alpha).toBeNull();
    });
  });
});
