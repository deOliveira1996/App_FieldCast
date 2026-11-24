import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import openMeteoCoastal from './fixtures/openMeteoCoastal.json';
import marineCoastal from './fixtures/marineCoastal.json';
import openMeteoInland from './fixtures/openMeteoInland.json';
import marineInland from './fixtures/marineInland.json';
import {
  clearPrimaryLocationPreference,
  deleteHistoricalLogEntry,
  deleteHistoricalRecurrenceRule,
  getHistoricalLogs,
  getHistoricalRecurrenceRules,
  loadCompassPreference,
  loadPrimaryLocationPreference,
  resetDatabaseForTests,
  saveCompassPreference,
  saveHistoricalLogEntry,
  saveHistoricalRecurrenceRule,
  savePrimaryLocationPreference,
} from '../db/database';
import {
  probeIpWhoisHealth,
  probeNominatimHealth,
  resetNominatimRateLimiter,
} from '../services/geocodingService';
import {
  evaluateDueRecurrenceRules,
  exportHistoricalSeriesArtifact,
  fetchHistoricalTimeSeries,
} from '../services/historicalWeatherService';
import {
  getEndpointHealthSnapshot,
  getOverallEndpointsHealthLevel,
  getServiceEndpointStatus,
  markServiceDegraded,
  recordServiceFailure,
  resetCircuitBreaker,
} from '../services/httpClient';
import { normalizeOpenMeteoForecast } from '../services/openMeteoService';
import {
  buildExportArtifact,
  exportAndDeliverFile,
} from '../services/platform/ShareService';
import { probeRainViewerHealth } from '../services/rainViewerService';
import type {
  HistoricalLogEntry,
  HistoricalRecurrenceRule,
  TrackSession,
  Waypoint,
} from '../types/field';
import {
  buildWhatsAppShareUrl,
  computeCrc32,
  exportToGpx,
  exportToKml,
  exportToKmz,
  formatCardinalDirection,
  UTF8_BOM,
} from '../utils/exporters';
import { findCurrentLocalDayIndex } from '../utils/localTimeHour';
import {
  computeEphemerisForDate,
  computeEphemerisRange,
} from '../utils/operationalAlerts';

describe('Core Data V2 — Ephemeris Local Date, Persistence, Probes, Historical Series & KML/KMZ/WhatsApp', () => {
  beforeEach(async () => {
    resetCircuitBreaker();
    resetNominatimRateLimiter();
    await resetDatabaseForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('1. Ephemeris Local Calendar Date & findCurrentLocalDayIndex', () => {
    it('anchors computeEphemerisForDate and computeEphemerisRange to local calendar date in timezone (avoiding UTC off-by-one)', () => {
      // 2026-11-24T01:30:00Z is 2026-11-23 22:30 in America/Sao_Paulo (UTC-3)
      const lateEveningBrt = new Date('2026-11-24T01:30:00Z');
      const ephem = computeEphemerisForDate(
        lateEveningBrt,
        -27.5954,
        -48.548,
        'America/Sao_Paulo',
      );
      expect(ephem.dateIso).toBe('2026-11-23');
      expect(ephem.sunriseIso).toBeTruthy();

      const tsDay23Late = Math.floor(new Date('2026-11-24T01:30:00Z').getTime() / 1000); // 2026-11-23 22:30 BRT
      const tsDay24Morning = Math.floor(new Date('2026-11-24T12:00:00Z').getTime() / 1000); // 2026-11-24 09:00 BRT
      const tsDay24Late = Math.floor(new Date('2026-11-25T01:30:00Z').getTime() / 1000); // 2026-11-24 22:30 BRT

      const range = computeEphemerisRange(
        -27.5954,
        -48.548,
        [tsDay23Late, tsDay24Morning, tsDay24Late],
        'America/Sao_Paulo',
      );
      expect(range.map((d) => d.dateIso)).toEqual(['2026-11-23', '2026-11-24']);
    });

    it('findCurrentLocalDayIndex parses bare YYYY-MM-DD at noon UTC instead of midnight UTC (preventing UTC-3 shift)', () => {
      const days = [
        { dateIso: '2026-11-23' },
        { dateIso: '2026-11-24' },
        { dateIso: '2026-11-25' },
      ];

      // 2026-11-24 22:30-03:00 (already 2026-11-25T01:30:00Z in UTC!) -> must match index 1 (2026-11-24)
      const idxLate = findCurrentLocalDayIndex(
        days,
        'America/Sao_Paulo',
        new Date('2026-11-24T22:30:00-03:00'),
      );
      expect(idxLate).toBe(1);

      // 2026-11-24 00:30-03:00 -> must match index 1 (2026-11-24)
      const idxEarly = findCurrentLocalDayIndex(
        days,
        'America/Sao_Paulo',
        new Date('2026-11-24T00:30:00-03:00'),
      );
      expect(idxEarly).toBe(1);
    });
  });

  describe('2. Primary Location, Compass Preference & Historical Logs Persistence', () => {
    it('saves, loads and clears PrimaryLocationPreference and CompassPreference', () => {
      expect(loadPrimaryLocationPreference()).toBeNull();
      expect(loadCompassPreference()).toEqual({ enabled: true, disabledReason: null });

      const saved = savePrimaryLocationPreference({
        savedLocationId: 'loc-florianopolis-sc',
        name: 'Florianópolis — SC',
        latitude: -27.5954,
        longitude: -48.548,
        origin: 'saved',
        updatedAtIso: '2026-11-24T12:00:00.000Z',
      });
      expect(saved.name).toBe('Florianópolis — SC');
      expect(loadPrimaryLocationPreference()?.latitude).toBeCloseTo(-27.5954, 4);

      clearPrimaryLocationPreference();
      expect(loadPrimaryLocationPreference()).toBeNull();

      saveCompassPreference({
        enabled: false,
        disabledReason: 'Sensor IMU instável no dispositivo',
      });
      expect(loadCompassPreference()).toEqual({
        enabled: false,
        disabledReason: 'Sensor IMU instável no dispositivo',
      });
    });

    it('persists HistoricalRecurrenceRules and HistoricalLogs in Dexie v2 / fallback store', async () => {
      const rule: HistoricalRecurrenceRule = {
        id: 'rule-weekly-fln',
        enabled: true,
        intervalDays: 7,
        locationName: 'Florianópolis',
        latitude: -27.5954,
        longitude: -48.548,
        models: ['fieldcast', 'ecmwf_ifs025'],
        format: 'csv',
        lastRunIso: null,
        nextDueIso: '2026-11-24T00:00:00.000Z',
      };
      await saveHistoricalRecurrenceRule(rule);
      const rules = await getHistoricalRecurrenceRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe('rule-weekly-fln');

      const log: HistoricalLogEntry = {
        id: 'hlog-1',
        ruleId: 'rule-weekly-fln',
        createdAtIso: '2026-11-24T10:00:00.000Z',
        locationName: 'Florianópolis',
        startDateIso: '2026-11-17',
        endDateIso: '2026-11-23',
        modelsIncluded: ['fieldcast'],
        recordCount: 1,
        format: 'csv',
        result: {
          locationName: 'Florianópolis',
          latitude: -27.5954,
          longitude: -48.548,
          elevationDemM: 23,
          timezone: 'America/Sao_Paulo',
          startDateIso: '2026-11-17',
          endDateIso: '2026-11-23',
          modelsIncluded: ['fieldcast'],
          sourceLabel: 'Open-Meteo NWP Multi-Modelo',
          fetchedAtIso: '2026-11-24T10:00:00.000Z',
          hours: [],
        },
      };
      await saveHistoricalLogEntry(log);
      expect(await getHistoricalLogs()).toHaveLength(1);

      await deleteHistoricalLogEntry('hlog-1');
      expect(await getHistoricalLogs()).toHaveLength(0);

      await deleteHistoricalRecurrenceRule('rule-weekly-fln');
      expect(await getHistoricalRecurrenceRules()).toHaveLength(0);
    });
  });

  describe('3. Initial Unverified Health Status & Real Probes', () => {
    it('starts all endpoints as unverified without falsely reporting degraded/down overall', () => {
      const snap = getEndpointHealthSnapshot();
      for (const endpoint of Object.values(snap)) {
        expect(endpoint.status).toBe('unverified');
        expect(endpoint.lastCheckedIso).toBeNull();
        expect(endpoint.message).toBe('Aguardando verificação (sob demanda)');
      }
      expect(getOverallEndpointsHealthLevel()).toBe('healthy');

      markServiceDegraded('rainviewer', 'Sem quadros');
      expect(getOverallEndpointsHealthLevel()).toBe('degraded');

      recordServiceFailure('open_meteo_forecast', 'Timeout', { failureThreshold: 1 });
      expect(getOverallEndpointsHealthLevel()).toBe('down');
    });

    it('runs probeNominatimHealth, probeIpWhoisHealth and probeRainViewerHealth safely without throwing', async () => {
      const okNomFetch = vi.fn(async () =>
        new Response(
          JSON.stringify([
            {
              place_id: 1,
              lat: '-27.5954',
              lon: '-48.5480',
              display_name: 'Florianópolis, SC, Brasil',
              name: 'Florianópolis',
            },
          ]),
          { status: 200 },
        ),
      );
      const nomOk = await probeNominatimHealth({
        fetchImpl: okNomFetch as unknown as typeof fetch,
        minIntervalMs: 0,
      });
      expect(nomOk.status).toBe('healthy');
      expect(nomOk.lastCheckedIso).toBeTruthy();

      const failFetch = vi.fn().mockRejectedValue(new Error('Offline'));
      const ipFail = await probeIpWhoisHealth({
        fetchImpl: failFetch as unknown as typeof fetch,
      });
      expect(['degraded', 'down']).toContain(ipFail.status);
      expect(getServiceEndpointStatus('ipwhois').consecutiveFailures).toBeGreaterThanOrEqual(1);

      const rvFail = await probeRainViewerHealth({
        fetchImpl: failFetch as unknown as typeof fetch,
      });
      expect(rvFail.status).toBe('degraded');
    });
  });

  describe('4. Historical Time-Series & Weekly Recurrence Evaluation', () => {
    it('routes <= 60-day queries with NWP + marine models to forecast & marine endpoints and filters strictly to [startDateIso, endDateIso]', async () => {
      const now = new Date('2026-11-24T15:00:00Z');
      // 2026-11-21T23:00 BRT (excluded), 2026-11-22T12:00 BRT (included), 2026-11-23T15:00 BRT (included), 2026-11-24T10:00 BRT (excluded)
      const tsOutBefore = Math.floor(new Date('2026-11-22T02:00:00Z').getTime() / 1000);
      const tsIn1 = Math.floor(new Date('2026-11-22T15:00:00Z').getTime() / 1000);
      const tsIn2 = Math.floor(new Date('2026-11-23T18:00:00Z').getTime() / 1000);
      const tsOutAfter = Math.floor(new Date('2026-11-24T13:00:00Z').getTime() / 1000);

      const capturedUrls: string[] = [];
      const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        capturedUrls.push(url);

        if (url.includes('marine-api.open-meteo.com')) {
          return new Response(
            JSON.stringify({
              latitude: -27.5954,
              longitude: -48.548,
              utc_offset_seconds: -10800,
              timezone: 'America/Sao_Paulo',
              hourly: {
                time: [tsOutBefore, tsIn1, tsIn2, tsOutAfter],
                wave_height: [1.1, 1.4, 1.6, 1.9],
                sea_level_height_msl: [0.1, 0.25, -0.15, 0.3],
              },
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({
            latitude: -27.5954,
            longitude: -48.548,
            utc_offset_seconds: -10800,
            timezone: 'America/Sao_Paulo',
            elevation: 23,
            hourly: {
              time: [tsOutBefore, tsIn1, tsIn2, tsOutAfter],
              temperature_2m_ecmwf_ifs025: [20, 24, 26, 22],
              temperature_2m_gem_seamless: [21, 22, 24, 23],
              dew_point_2m_ecmwf_ifs025: [17, 18, 19, 18],
              dew_point_2m_gem_seamless: [17, 18, 18, 18],
              wind_speed_10m_ecmwf_ifs025: [12, 18, 20, 14],
              wind_speed_10m_gem_seamless: [14, 22, 24, 16],
              wind_gusts_10m_ecmwf_ifs025: [20, 28, 30, 22],
              wind_gusts_10m_gem_seamless: [22, 32, 34, 24],
              wind_direction_10m_ecmwf_ifs025: [170, 180, 190, 200],
              wind_direction_10m_gem_seamless: [175, 180, 190, 205],
              precipitation_ecmwf_ifs025: [0, 0.2, 0.4, 0],
              precipitation_gem_seamless: [0, 0.4, 0.6, 0],
              surface_pressure_ecmwf_ifs025: [1014, 1015, 1013, 1012],
              surface_pressure_gem_seamless: [1015, 1017, 1015, 1013],
            },
          }),
          { status: 200 },
        );
      });

      const result = await fetchHistoricalTimeSeries(
        {
          locationName: 'Florianópolis',
          latitude: -27.5954,
          longitude: -48.548,
          startDateIso: '2026-11-22',
          endDateIso: '2026-11-23',
          models: ['ecmwf_ifs025', 'gem_seamless', 'marine'],
        },
        { fetchImpl: mockFetch as unknown as typeof fetch, now },
      );

      expect(capturedUrls.some((u) => u.includes('api.open-meteo.com/v1/forecast'))).toBe(true);
      expect(capturedUrls.some((u) => u.includes('models=ecmwf_ifs025%2Cgem_seamless'))).toBe(true);
      expect(capturedUrls.some((u) => u.includes('marine-api.open-meteo.com/v1/marine'))).toBe(true);
      expect(result.hours).toHaveLength(2);
      expect(result.hours[0]?.temperature2mC).toBeCloseTo(23, 2);
      expect(result.hours[0]?.waveHeightM).toBeCloseTo(1.4, 2);
      expect(result.hours[0]?.seaLevelHeightMsl).toBeCloseTo(0.25, 2);
      expect(result.hours[0]?.byModel?.ecmwf_ifs025?.windSpeed10mKmh).toBe(18);
      expect(result.hours[0]?.byModel?.gem_seamless?.windSpeed10mKmh).toBe(22);

      const csvOut = exportHistoricalSeriesArtifact(result, 'csv');
      expect(typeof csvOut.content).toBe('string');
      expect((csvOut.content as string).startsWith(UTF8_BOM)).toBe(true);
      expect(csvOut.content as string).toContain('ecmwf_ifs025_wind_speed_10m_kmh');
      expect(csvOut.content as string).toContain('gem_seamless_wind_speed_10m_kmh');
      expect(csvOut.content as string).toContain('marine_sea_level_height_msl');

      const kmzOut = exportHistoricalSeriesArtifact(result, 'kmz');
      expect(kmzOut.content).toBeInstanceOf(Uint8Array);
      const kmzBytes = kmzOut.content as Uint8Array;
      expect(String.fromCharCode(kmzBytes[0]!, kmzBytes[1]!)).toBe('PK');
    });

    it('routes > 60-day queries to Open-Meteo ERA5 Archive validated by Zod', async () => {
      const now = new Date('2026-11-24T12:00:00Z');
      const archiveTs = Math.floor(new Date('2026-06-10T15:00:00Z').getTime() / 1000);
      let requestedUrl = '';

      const archiveFetch = vi.fn(async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            latitude: -15.7939,
            longitude: -47.8828,
            utc_offset_seconds: -10800,
            timezone: 'America/Sao_Paulo',
            elevation: 1092,
            hourly: {
              time: [archiveTs],
              temperature_2m: [25.4],
              dew_point_2m: [14.2],
              wind_speed_10m: [11.5],
              wind_gusts_10m: [18.9],
              wind_direction_10m: [95],
              precipitation: [0],
              surface_pressure: [898.5],
            },
          }),
          { status: 200 },
        );
      });

      const res = await fetchHistoricalTimeSeries(
        {
          locationName: 'Brasília',
          latitude: -15.7939,
          longitude: -47.8828,
          startDateIso: '2026-06-10',
          endDateIso: '2026-06-10',
          models: ['fieldcast'],
        },
        { fetchImpl: archiveFetch as unknown as typeof fetch, now },
      );

      expect(requestedUrl).toContain('https://archive-api.open-meteo.com/v1/archive');
      expect(res.hours).toHaveLength(1);
      expect(res.hours[0]?.source).toBe('Open-Meteo ERA5 Archive');
      expect(res.hours[0]?.temperature2mC).toBeCloseTo(25.4, 2);
    });

    it('evaluates due recurrence rules, persists HistoricalLogEntry, advances nextDueIso, and handles offline errors gracefully', async () => {
      const now = new Date('2026-11-24T12:00:00.000Z');
      const sampleTs = Math.floor(new Date('2026-11-20T15:00:00Z').getTime() / 1000);

      await saveHistoricalRecurrenceRule({
        id: 'due-rule',
        enabled: true,
        intervalDays: 7,
        locationName: 'Florianópolis',
        latitude: -27.5954,
        longitude: -48.548,
        models: ['fieldcast'],
        format: 'json',
        lastRunIso: null,
        nextDueIso: '2026-11-24T08:00:00.000Z',
      });

      await saveHistoricalRecurrenceRule({
        id: 'future-rule',
        enabled: true,
        intervalDays: 14,
        locationName: 'Brasília',
        latitude: -15.7939,
        longitude: -47.8828,
        models: ['fieldcast'],
        format: 'csv',
        lastRunIso: null,
        nextDueIso: '2026-12-01T00:00:00.000Z',
      });

      const mockFetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            latitude: -27.5954,
            longitude: -48.548,
            utc_offset_seconds: -10800,
            timezone: 'America/Sao_Paulo',
            elevation: 23,
            hourly: {
              time: [sampleTs],
              temperature_2m_ecmwf_ifs025: [22.5],
              dew_point_2m_ecmwf_ifs025: [18.0],
              wind_speed_10m_ecmwf_ifs025: [14.0],
              wind_gusts_10m_ecmwf_ifs025: [21.0],
              wind_direction_10m_ecmwf_ifs025: [135],
              precipitation_ecmwf_ifs025: [0],
              surface_pressure_ecmwf_ifs025: [1016],
            },
          }),
          { status: 200 },
        ),
      );

      const summary = await evaluateDueRecurrenceRules(now, {
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(summary.dueCount).toBe(1);
      expect(summary.generatedLogs).toHaveLength(1);
      expect(summary.generatedLogs[0]?.ruleId).toBe('due-rule');
      expect(summary.generatedLogs[0]?.recordCount).toBe(1);

      const savedLogs = await getHistoricalLogs();
      expect(savedLogs).toHaveLength(1);

      const updatedRules = await getHistoricalRecurrenceRules();
      const dueRuleAfter = updatedRules.find((r) => r.id === 'due-rule');
      expect(dueRuleAfter?.lastRunIso).toBe(now.toISOString());
      expect(new Date(dueRuleAfter!.nextDueIso).getTime()).toBeGreaterThan(now.getTime());

      // Offline failure on a due rule must NOT throw
      await saveHistoricalRecurrenceRule({
        ...dueRuleAfter!,
        nextDueIso: '2026-11-24T00:00:00.000Z',
      });
      const failingFetch = vi.fn().mockRejectedValue(new Error('ERR_INTERNET_DISCONNECTED'));
      const offlineSummary = await evaluateDueRecurrenceRules(now, {
        fetchImpl: failingFetch as unknown as typeof fetch,
      });
      expect(offlineSummary.dueCount).toBe(1);
      expect(offlineSummary.generatedLogs).toHaveLength(0);
    });
  });

  describe('5. KML, KMZ (PKZIP + CRC32), GPX, CSV Mission Bundle & Local-Hour WhatsApp Bulletin', () => {
    const sampleWaypoint: Waypoint = {
      id: 'wpt-kml-1',
      name: 'Canal da Barra',
      latitude: -27.5731,
      longitude: -48.4239,
      timestampUtcIso: '2026-11-24T15:00:00.000Z',
      note: 'Corrente vazante moderada',
      conditions: {
        timestampUnix: 1795532400,
        timestampIso: '2026-11-24T15:00:00.000Z',
        windSpeed10mKmh: 19.5,
        windDirection10mDeg: 135,
        windGusts10mKmh: 28.4,
        temperature2mC: 24.2,
        surfacePressureHpa: 1015.8,
        precipitationMm: 0.4,
        waveHeightM: 1.45,
        wavePeriodS: 9.0,
        waveDirectionDeg: 130,
        confidenceTotal: 89,
        safeWindow: 'green',
      },
    };

    const sampleTrack: TrackSession = {
      id: 'trk-kml-1',
      name: 'Saída Barra da Lagoa',
      startedAtIso: '2026-11-24T14:00:00.000Z',
      endedAtIso: '2026-11-24T14:40:00.000Z',
      status: 'completed',
      totalDistanceKm: 2.1,
      discardedLowAccuracyCount: 0,
      platform: 'android',
      points: [
        {
          latitude: -27.5731,
          longitude: -48.4239,
          accuracyM: 5,
          speedMs: 3.1,
          headingDeg: 90,
          timestampUtcIso: '2026-11-24T14:00:00.000Z',
        },
        {
          latitude: -27.5751,
          longitude: -48.4119,
          accuracyM: 6,
          speedMs: 3.2,
          headingDeg: 95,
          timestampUtcIso: '2026-11-24T14:40:00.000Z',
        },
      ],
    };

    it('generates valid KML 2.2 XML and valid PKZIP KMZ with real IEEE CRC32 and PK header', () => {
      // Standard IEEE 802.3 CRC-32 check vector
      expect(computeCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
      expect(formatCardinalDirection(135)).toBe('SE');

      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      const kml = exportToKml({
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
        name: 'Operação Ilha SC',
      });

      expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
      expect(kml).toContain('<Placemark>');
      expect(kml).toContain('Canal da Barra');
      expect(kml).toContain('<LineString>');
      expect(kml).toContain('Vento Médio 10m: 19.5 km/h (135° SE) | Rajadas 10m: 28.4 km/h');

      const kmz = exportToKmz({
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
        name: 'Operação Ilha SC',
      });

      expect(kmz).toBeInstanceOf(Uint8Array);
      // PKZIP Local File Header signature: 0x50 0x4B 0x03 0x04 ('PK\x03\x04')
      expect(kmz[0]).toBe(0x50);
      expect(kmz[1]).toBe(0x4b);
      expect(kmz[2]).toBe(0x03);
      expect(kmz[3]).toBe(0x04);

      const kmzText = new TextDecoder().decode(kmz);
      expect(kmzText).toContain('doc.kml');
      expect(kmzText).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');

      const gpx = exportToGpx({
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
      });
      expect(gpx).toContain('135° SE');
      expect(gpx).toContain('Chuva: 0.4 mm');
    });

    it('builds WhatsApp bulletin for the current local hour with paired wind/direction/gusts, temp, rain, and MSL notice', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:15:00-03:00'));

      const coastal = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });
      // Inject seaLevelHeightMsl on hour 18 to verify tide estimate notice
      coastal.hours[18]!.marine = {
        ...coastal.hours[18]!.marine!,
        seaLevelHeightMsl: 0.42,
      };

      const bulletin = buildWhatsAppShareUrl(coastal, 'Florianópolis — SC');
      expect(bulletin.text).toContain('Horário Local: 2026-11-22 18:00');
      expect(bulletin.text).toContain('Temperatura:');
      expect(bulletin.text).toContain('Precipitação:');
      expect(bulletin.text).toContain('Vento Médio 10m:');
      expect(bulletin.text).toContain('Rajadas 10m:');
      expect(bulletin.text).toContain('Maré Est. (MSL ~8 km): +0.42 m (não substitui DHN)');
      expect(bulletin.text).toContain('Altitude DEM: 23 m');
      expect(bulletin.text).toContain('Confiabilidade:');
      expect(bulletin.text).toContain('Semáforo Operacional:');

      const inland = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoInland,
        marineRaw: marineInland,
      });
      const inlandBulletin = buildWhatsAppShareUrl(inland, 'Brasília — DF');
      expect(inlandBulletin.text).toContain('Continental / Sem grade marinha');
    });

    it('supports mission_bundle CSV (forecast + waypoints + tracks) and KML/KMZ artifacts via ShareService', async () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      const bundleCsv = buildExportArtifact({
        dataset: 'mission_bundle',
        format: 'csv',
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
      });
      expect(bundleCsv.content.startsWith(UTF8_BOM)).toBe(true);
      expect(bundleCsv.content).toContain('# PREVISAO_HORARIA_168H');
      expect(bundleCsv.content).toContain('# WAYPOINTS_DE_CAMPO');
      expect(bundleCsv.content).toContain('# ROTAS_GPS_TRACKS');
      expect(bundleCsv.content).toContain('Canal da Barra');
      expect(bundleCsv.content).toContain('Saída Barra da Lagoa');

      const kmlArtifact = buildExportArtifact({
        dataset: 'mission_bundle',
        format: 'kml',
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
        locationName: 'Ilha SC',
      });
      expect(kmlArtifact.content).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');

      const kmzArtifact = buildExportArtifact({
        dataset: 'mission_bundle',
        format: 'kmz',
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
        locationName: 'Ilha SC',
      });
      expect(kmzArtifact.content).toBeInstanceOf(Uint8Array);
      expect(kmzArtifact.content[0]).toBe(0x50);
      expect(kmzArtifact.content[1]).toBe(0x4b);

      const delivery = await exportAndDeliverFile({
        filename: kmzArtifact.filename,
        content: kmzArtifact.content,
        format: 'kmz',
        isNativePlatformFn: () => false,
      });
      expect(delivery.byteLength).toBe(kmzArtifact.content.byteLength);
      expect(delivery.mimeType).toBe('application/vnd.google-earth.kmz');
    });
  });
});
