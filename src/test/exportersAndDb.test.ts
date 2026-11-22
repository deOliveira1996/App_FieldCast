import { beforeEach, describe, expect, it } from 'vitest';
import openMeteoCoastal from './fixtures/openMeteoCoastal.json';
import marineCoastal from './fixtures/marineCoastal.json';
import {
  deleteSavedLocation,
  deleteTrackSession,
  deleteWaypoint,
  ensureDefaultSavedLocations,
  getCachedForecast,
  getRecentErrorLogs,
  getSavedLocations,
  getTrackSessions,
  getWaypoints,
  logErrorToDb,
  renameSavedLocation,
  resetDatabaseForTests,
  saveForecastCache,
  saveTrackSession,
  saveWaypoint,
  toggleFavoriteLocation,
  upsertSavedLocation,
} from '../db/database';
import { normalizeOpenMeteoForecast } from '../services/openMeteoService';
import type { TrackSession, Waypoint } from '../types/field';
import {
  buildWhatsAppShareUrl,
  computeTrackDistanceKm,
  exportForecastToCsv,
  exportToGeoJson,
  exportToGpx,
  exportToJson,
  exportTracksToCsv,
  exportWaypointsToCsv,
  haversineDistanceKm,
  haversineDistanceM,
  UTF8_BOM,
} from '../utils/exporters';

describe('exporters & Dexie database — Haversine, CSV BOM, GPX, GeoJSON & Offline Storage', () => {
  const sampleWaypoint: Waypoint = {
    id: 'wp-1',
    name: 'Praia da Joaquina',
    latitude: -27.6295,
    longitude: -48.4485,
    timestampUtcIso: '2026-11-22T12:00:00.000Z',
    note: 'Swell de Sudeste entrando limpo',
    conditions: {
      timestampUnix: 1795348800,
      timestampIso: '2026-11-22T12:00:00.000Z',
      windSpeed10mKmh: 18.4,
      windDirection10mDeg: 145,
      windGusts10mKmh: 25.2,
      temperature2mC: 23.1,
      surfacePressureHpa: 1015.4,
      precipitationMm: 0,
      waveHeightM: 1.65,
      wavePeriodS: 10.2,
      waveDirectionDeg: 135,
      confidenceTotal: 88,
      safeWindow: 'green',
    },
  };

  const sampleTrack: TrackSession = {
    id: 'trk-1',
    name: 'Trilha Costeira Leste',
    startedAtIso: '2026-11-22T10:00:00.000Z',
    endedAtIso: '2026-11-22T11:30:00.000Z',
    status: 'completed',
    totalDistanceKm: 1.24,
    discardedLowAccuracyCount: 2,
    platform: 'web',
    points: [
      {
        latitude: -27.5954,
        longitude: -48.548,
        accuracyM: 6,
        speedMs: 1.4,
        headingDeg: 90,
        timestampUtcIso: '2026-11-22T10:00:00.000Z',
      },
      {
        latitude: -27.6054,
        longitude: -48.538,
        accuracyM: 8,
        speedMs: 1.5,
        headingDeg: 120,
        timestampUtcIso: '2026-11-22T10:30:00.000Z',
      },
    ],
  };

  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  describe('Haversine geodesic distance', () => {
    it('computes accurate geodesic distance between Florianópolis and Brasília (~1315 km)', () => {
      const distKm = haversineDistanceKm(-27.5954, -48.548, -15.7939, -47.8828);
      expect(distKm).toBeGreaterThan(1300);
      expect(distKm).toBeLessThan(1330);

      expect(haversineDistanceM(-27.5954, -48.548, -27.5954, -48.548)).toBe(0);
    });

    it('computes cumulative track distance across multiple GPS points', () => {
      const dist = computeTrackDistanceKm(sampleTrack.points);
      expect(dist).toBeGreaterThan(1.4);
      expect(dist).toBeLessThan(1.6);
    });
  });

  describe('Pure Exporters (CSV UTF-8 BOM, JSON, GPX 1.1, GeoJSON RFC 7946)', () => {
    it('exports Forecast, Waypoints and Tracks to CSV prefixed with UTF-8 BOM (\\uFEFF)', () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      const forecastCsv = exportForecastToCsv(forecast);
      expect(forecastCsv.startsWith(UTF8_BOM)).toBe(true);
      expect(forecastCsv).toContain('wind_speed_10m_kmh');
      expect(forecastCsv.split('\r\n')).toHaveLength(49); // 1 header + 48 hourly rows

      const wpCsv = exportWaypointsToCsv([sampleWaypoint]);
      expect(wpCsv.startsWith(UTF8_BOM)).toBe(true);
      expect(wpCsv).toContain('Praia da Joaquina');

      const trkCsv = exportTracksToCsv([sampleTrack]);
      expect(trkCsv.startsWith(UTF8_BOM)).toBe(true);
      expect(trkCsv).toContain('Trilha Costeira Leste');
    });

    it('exports valid GPX 1.1 XML with waypoints and track segments', () => {
      const gpx = exportToGpx({
        name: 'Missão Ilha de SC',
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
      });

      expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(gpx).toContain('<gpx version="1.1"');
      expect(gpx).toContain('<wpt lat="-27.629500" lon="-48.448500">');
      expect(gpx).toContain('<name>Praia da Joaquina</name>');
      expect(gpx).toContain('<trk>');
      expect(gpx).toContain('<trkpt lat="-27.595400" lon="-48.548000">');
    });

    it('exports valid GeoJSON FeatureCollection with [lon, lat] coordinates and JSON/WhatsApp helpers', () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      const geojsonRaw = exportToGeoJson({
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
      });
      const parsed = JSON.parse(geojsonRaw);

      expect(parsed.type).toBe('FeatureCollection');
      expect(parsed.features).toHaveLength(3);
      expect(parsed.features[1].geometry.type).toBe('Point');
      expect(parsed.features[1].geometry.coordinates).toEqual([-48.4485, -27.6295]);
      expect(parsed.features[2].geometry.type).toBe('LineString');

      const jsonStr = exportToJson({ ok: true });
      expect(JSON.parse(jsonStr)).toEqual({ ok: true });

      const share = buildWhatsAppShareUrl(forecast, 'Florianópolis');
      expect(share.url.startsWith('https://wa.me/?text=')).toBe(true);
      expect(share.text).toContain('Florianópolis');
    });
  });

  describe('Dexie IndexedDB Offline Persistence & Fallback Store', () => {
    it('seeds default saved locations and supports full CRUD (save, rename, toggle favorite, delete)', async () => {
      const defaults = await ensureDefaultSavedLocations();
      expect(defaults.length).toBeGreaterThanOrEqual(2);

      await upsertSavedLocation({
        id: 'loc-garopaba',
        name: 'Garopaba',
        latitude: -28.0225,
        longitude: -48.6138,
        isFavorite: false,
        createdAtIso: '2026-11-22T00:00:00.000Z',
        lastUsedAtIso: '2026-11-22T00:00:00.000Z',
      });

      await renameSavedLocation('loc-garopaba', 'Garopaba — Praia Central');
      await toggleFavoriteLocation('loc-garopaba');

      const list = await getSavedLocations();
      const garopaba = list.find((l) => l.id === 'loc-garopaba');
      expect(garopaba?.name).toBe('Garopaba — Praia Central');
      expect(garopaba?.isFavorite).toBe(true);

      await deleteSavedLocation('loc-garopaba');
      const afterDelete = await getSavedLocations();
      expect(afterDelete.find((l) => l.id === 'loc-garopaba')).toBeUndefined();
    });

    it('caches and retrieves NormalizedForecast, Waypoints, Tracks and ErrorLogs', async () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      await saveForecastCache(forecast);
      const cached = await getCachedForecast(forecast.latitude, forecast.longitude);
      expect(cached).not.toBeNull();
      expect(cached?.forecast.elevationDemM).toBe(23);

      await saveWaypoint(sampleWaypoint);
      expect(await getWaypoints()).toHaveLength(1);
      await deleteWaypoint(sampleWaypoint.id);
      expect(await getWaypoints()).toHaveLength(0);

      await saveTrackSession(sampleTrack);
      expect(await getTrackSessions()).toHaveLength(1);
      await deleteTrackSession(sampleTrack.id);
      expect(await getTrackSessions()).toHaveLength(0);

      await logErrorToDb({
        timestampUtcIso: '2026-11-22T12:00:00.000Z',
        module: 'UnitTest',
        action: 'test-log',
        message: 'Erro simulado de diagnóstico',
      });
      const logs = await getRecentErrorLogs(10);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.message).toBe('Erro simulado de diagnóstico');
    });
  });
});
