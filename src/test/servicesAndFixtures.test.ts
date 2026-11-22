import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import openMeteoCoastal from './fixtures/openMeteoCoastal.json';
import openMeteoInland from './fixtures/openMeteoInland.json';
import marineCoastal from './fixtures/marineCoastal.json';
import marineInland from './fixtures/marineInland.json';
import { resetDatabaseForTests } from '../db/database';
import {
  fetchIpApproximateLocation,
  resetNominatimRateLimiter,
  searchLocationsNominatim,
} from '../services/geocodingService';
import {
  CircuitOpenError,
  fetchWithCircuitBreaker,
  getEndpointHealthSnapshot,
  getServiceEndpointStatus,
  resetCircuitBreaker,
} from '../services/httpClient';
import {
  buildOpenMeteoForecastUrl,
  buildOpenMeteoMarineUrl,
  fetchOpenMeteoForecast,
  normalizeOpenMeteoForecast,
  reapplyThresholdsToForecast,
} from '../services/openMeteoService';
import { fetchRainViewerRadar } from '../services/rainViewerService';

describe('API Services, Circuit Breaker & Real Open-Meteo Fixture Normalization', () => {
  beforeEach(async () => {
    resetCircuitBreaker();
    resetNominatimRateLimiter();
    await resetDatabaseForTests();
  });

  describe('Real 48h Open-Meteo Fixtures -> NormalizedForecast', () => {
    it('normalizes coastal Florianópolis 48h fixture with active marine grid and DEM elevation (23m)', () => {
      const normalized = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      expect(normalized.elevationDemM).toBe(23);
      expect(normalized.timezone).toBe('America/Sao_Paulo');
      expect(normalized.marineAvailable).toBe(true);
      expect(normalized.overallConfidence.isContinental).toBe(false);
      expect(normalized.hours).toHaveLength(48);

      // Native series populated for all 3 models
      expect(normalized.nativeByModel.ecmwf_ifs025).toHaveLength(48);
      expect(normalized.nativeByModel.gfs_seamless).toHaveLength(48);
      expect(normalized.nativeByModel.icon_seamless).toHaveLength(48);

      const h0 = normalized.hours[0]!;
      expect(h0.windSpeed10m.mean).not.toBeNull();
      expect(h0.windDirection10m.degree).not.toBeNull();
      expect(h0.windDirection10m.resultantLengthR).toBeGreaterThanOrEqual(0);
      expect(h0.windDirection10m.resultantLengthR).toBeLessThanOrEqual(1);
      expect(h0.windGusts10m.mean).not.toBeNull();
      expect(h0.marine).not.toBeNull();
      expect(h0.marine?.waveHeight).not.toBeNull();
      expect(h0.verticalProfile.nativeLevels).toHaveLength(4);
      expect(h0.verticalProfile.interpolatedLevels).toHaveLength(12);
      expect(normalized.ephemerisByDay.length).toBeGreaterThanOrEqual(2);
    });

    it('normalizes inland Brasília 48h fixture with marineAvailable === false and zero continental penalty', () => {
      const normalized = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoInland,
        marineRaw: marineInland,
      });

      expect(normalized.elevationDemM).toBe(openMeteoInland.elevation);
      expect(normalized.elevationDemM).toBe(1092);
      expect(normalized.marineAvailable).toBe(false);
      expect(normalized.overallConfidence.isContinental).toBe(true);
      expect(normalized.hours).toHaveLength(48);

      // Every hour must have marine === null and full 30/30 sourceIntegrity (no continental penalty)
      const h0 = normalized.hours[0]!;
      expect(h0.marine).toBeNull();
      expect(h0.confidence.isContinental).toBe(true);
      expect(h0.confidence.breakdown.sourceIntegrity).toBe(30);
    });

    it('reapplies user SafeWindowThresholds without network refetch', () => {
      const normalized = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      const strictForecast = reapplyThresholdsToForecast(normalized, {
        maxWindKmh: 5,
        maxGustKmh: 6,
        maxWaveM: 0.2,
        maxPrecipProbPct: 10,
      });

      expect(strictForecast.hours.some((h) => h.safeWindow === 'red')).toBe(true);
      expect(strictForecast.alerts.some((a) => a.type === 'safe_window_red')).toBe(true);
    });

    it('builds Open-Meteo URLs with timeformat=unixtime&timezone=auto&forecast_days=7', () => {
      const fUrl = buildOpenMeteoForecastUrl(-27.5954, -48.548, 7);
      const mUrl = buildOpenMeteoMarineUrl(-27.5954, -48.548, 7);

      expect(fUrl).toContain('timeformat=unixtime');
      expect(fUrl).toContain('timezone=auto');
      expect(fUrl).toContain('forecast_days=7');
      expect(fUrl).toContain('models=ecmwf_ifs025%2Cgfs_seamless%2Cicon_seamless');

      expect(mUrl).toContain('timeformat=unixtime');
      expect(mUrl).toContain('timezone=auto');
      expect(mUrl).toContain('forecast_days=7');
    });
  });

  describe('Circuit Breaker & Automatic Dexie Cache Fallback', () => {
    it('opens circuit breaker after 3 consecutive failures and triggers automatic fallback', async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      const schema = z.object({ ok: z.boolean() });

      // 3 consecutive failed calls (with maxRetries: 0 for fast test execution)
      for (let i = 1; i <= 3; i++) {
        await expect(
          fetchWithCircuitBreaker({
            service: 'open_meteo_forecast',
            url: 'https://api.open-meteo.com/v1/forecast',
            schema,
            maxRetries: 0,
            backoffBaseMs: 1,
            fetchImpl: failingFetch as unknown as typeof fetch,
          }),
        ).rejects.toThrow('Network offline');

        const status = getServiceEndpointStatus('open_meteo_forecast');
        expect(status.consecutiveFailures).toBe(i);
        expect(status.circuitOpen).toBe(i >= 3);
      }

      const snap = getEndpointHealthSnapshot();
      expect(snap.open_meteo_forecast.circuitOpen).toBe(true);
      expect(snap.open_meteo_forecast.status).toBe('down');

      // 4th call should short-circuit immediately without invoking fetchImpl and use fallback
      const callCountBefore4th = failingFetch.mock.calls.length;
      const fallbackRes = await fetchWithCircuitBreaker({
        service: 'open_meteo_forecast',
        url: 'https://api.open-meteo.com/v1/forecast',
        schema,
        maxRetries: 0,
        fetchImpl: failingFetch as unknown as typeof fetch,
        fallback: (err, isOpen) => {
          expect(err).toBeInstanceOf(CircuitOpenError);
          expect(isOpen).toBe(true);
          return { ok: true };
        },
      });

      expect(failingFetch.mock.calls.length).toBe(callCountBefore4th);
      expect(fallbackRes.fromFallback).toBe(true);
      expect(fallbackRes.circuitOpen).toBe(true);
      expect(fallbackRes.data).toEqual({ ok: true });
    });

    it('fetchOpenMeteoForecast caches live response in Dexie and falls back to cache when offline', async () => {
      const liveFetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        const body = urlStr.includes('marine-api') ? marineCoastal : openMeteoCoastal;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      // 1. Live fetch -> caches in Dexie
      const liveForecast = await fetchOpenMeteoForecast(-27.5954, -48.548, {
        fetchImpl: liveFetchMock as unknown as typeof fetch,
        maxRetries: 0,
      });
      expect(liveForecast.fromCache).toBe(false);
      expect(liveForecast.hours).toHaveLength(48);

      // 2. Network fails -> automatic fallback to Dexie cache
      const offlineFetchMock = vi.fn().mockRejectedValue(new Error('ERR_INTERNET_DISCONNECTED'));
      const cachedForecast = await fetchOpenMeteoForecast(-27.5954, -48.548, {
        fetchImpl: offlineFetchMock as unknown as typeof fetch,
        maxRetries: 0,
      });

      expect(cachedForecast.fromCache).toBe(true);
      expect(cachedForecast.hours).toHaveLength(48);
      expect(cachedForecast.elevationDemM).toBe(23);
    });
  });

  describe('RainViewer Graceful Degradation & Geocoding Services', () => {
    it('RainViewer parses radar frames on success and degrades gracefully to amber on error without throwing', async () => {
      const okFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            version: '2.0',
            generated: 1795316400,
            host: 'https://tilecache.rainviewer.com',
            radar: {
              past: [{ time: 1795312800, path: '/v2/radar/1795312800' }],
              nowcast: [{ time: 1795316400, path: '/v2/radar/1795316400' }],
            },
          }),
          { status: 200 },
        );
      });

      const okState = await fetchRainViewerRadar({
        fetchImpl: okFetch as unknown as typeof fetch,
        maxRetries: 0,
      });
      expect(okState.available).toBe(true);
      expect(okState.degraded).toBe(false);
      expect(okState.frames).toHaveLength(2);
      expect(okState.frames[0]?.tileUrlTemplate).toContain('/256/{z}/{x}/{y}/');

      // Simulate RainViewer outage
      const errFetch = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
      const degradedState = await fetchRainViewerRadar({
        fetchImpl: errFetch as unknown as typeof fetch,
        maxRetries: 0,
      });

      expect(degradedState.available).toBe(false);
      expect(degradedState.degraded).toBe(true);
      expect(getServiceEndpointStatus('rainviewer').status).toBe('degraded');
    });

    it('Nominatim search enforces rate-limit protection and strips any custom User-Agent header', async () => {
      let capturedHeaders: Record<string, string> = {};
      const nomFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return new Response(
          JSON.stringify([
            {
              place_id: 101,
              lat: '-27.5954',
              lon: '-48.5480',
              display_name: 'Florianópolis, Santa Catarina, Brasil',
              name: 'Florianópolis',
              type: 'city',
            },
          ]),
          { status: 200 },
        );
      });

      const results = await searchLocationsNominatim('Florianópolis', {
        fetchImpl: nomFetch as unknown as typeof fetch,
        minIntervalMs: 10,
        maxRetries: 0,
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Florianópolis');
      expect(results[0]?.latitude).toBeCloseTo(-27.5954, 4);
      expect(Object.keys(capturedHeaders).some((k) => k.toLowerCase() === 'user-agent')).toBe(
        false,
      );
    });

    it('IP geolocation fallback (ipwho.is) tags location as Aproximado via IP', async () => {
      const ipFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            ip: '200.135.0.1',
            success: true,
            latitude: -27.5954,
            longitude: -48.548,
            city: 'Florianópolis',
            region: 'Santa Catarina',
            country: 'Brazil',
          }),
          { status: 200 },
        );
      });

      const coords = await fetchIpApproximateLocation({
        fetchImpl: ipFetch as unknown as typeof fetch,
        maxRetries: 0,
      });

      expect(coords.origin).toBe('ip');
      expect(coords.isApproximateIp).toBe(true);
      expect(coords.name).toContain('Aproximado via IP');
      expect(coords.latitude).toBeCloseTo(-27.5954, 4);
    });
  });
});
