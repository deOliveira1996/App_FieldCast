import { beforeEach, describe, expect, it } from 'vitest';
import openMeteoCoastal from './fixtures/openMeteoCoastal.json';
import marineCoastal from './fixtures/marineCoastal.json';
import {
  getTrackSessions,
  resetDatabaseForTests,
  saveForecastCache,
} from '../db/database';
import {
  extractConditionSnapshotFromForecast,
  computeRelativeBearingDeg,
  extractHeadingFromOrientationEvent,
  normalizeCompassDeg,
} from '../components/field';
import {
  GPS_TIMEOUT_MS,
  resolveCascadingLocation,
  resolveDexieCachedCoordinates,
} from '../hooks/useSmartLocation';
import { normalizeOpenMeteoForecast } from '../services/openMeteoService';
import {
  ANDROID_FOREGROUND_NOTIFICATION_TITLE,
  applyReadingToTrackSession,
  buildExportArtifact,
  computeScaledDimensions,
  compressImageDataUrl,
  estimateDataUrlSizeKb,
  exportAndDeliverFile,
  isTrackAccuracyAcceptable,
  LocationTrackerService,
  MAX_TRACK_ACCURACY_M,
  shareBulletinViaWhatsApp,
  TARGET_PHOTO_MAX_KB,
  WEB_WAKE_LOCK_WARNING_MESSAGE,
} from '../services/platform';
import type { TrackSession, Waypoint } from '../types/field';
import { UTF8_BOM } from '../utils/exporters';

describe('Sprint 3B — Field Operations, Hybrid Platform Adapters, Cascading Location & Compass', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  describe('1. Adaptive GPS Tracker & Strict Accuracy Filter (<= 20m)', () => {
    it('accepts GPS readings with accuracy <= 20m and rejects readings with accuracy > 20m or invalid', () => {
      expect(MAX_TRACK_ACCURACY_M).toBe(20);
      expect(isTrackAccuracyAcceptable(4.5)).toBe(true);
      expect(isTrackAccuracyAcceptable(12)).toBe(true);
      expect(isTrackAccuracyAcceptable(20)).toBe(true);

      // Strictly rejected (> 20m or <= 0 or NaN)
      expect(isTrackAccuracyAcceptable(20.01)).toBe(false);
      expect(isTrackAccuracyAcceptable(25)).toBe(false);
      expect(isTrackAccuracyAcceptable(150)).toBe(false);
      expect(isTrackAccuracyAcceptable(0)).toBe(false);
      expect(isTrackAccuracyAcceptable(-5)).toBe(false);
      expect(isTrackAccuracyAcceptable(Number.NaN)).toBe(false);
      expect(isTrackAccuracyAcceptable(null)).toBe(false);
    });

    it('filters low-accuracy points (> 20m), increments discardedLowAccuracyCount, and computes Haversine distance across accepted points', async () => {
      const tracker = new LocationTrackerService({
        isNativePlatformFn: () => false,
        getPlatformFn: () => 'web',
      });

      const started = await tracker.startTracking('Patrulha Costeira Ilha SC');
      expect(started.status).toBe('recording');
      expect(tracker.getState().keepScreenOnWarning).toBe(true);
      expect(tracker.getState().wakeLockBannerMessage).toBe(WEB_WAKE_LOCK_WARNING_MESSAGE);

      // 1st point: accuracy 8m (ACCEPTED)
      const r1 = await tracker.ingestPositionReading({
        latitude: -27.5954,
        longitude: -48.548,
        accuracyM: 8,
        timestampUtcIso: '2026-11-22T12:00:00.000Z',
      });
      expect(r1.accepted).toBe(true);
      expect(r1.session?.points).toHaveLength(1);
      expect(r1.session?.discardedLowAccuracyCount).toBe(0);

      // 2nd point: accuracy 34m > 20m (REJECTED)
      const r2 = await tracker.ingestPositionReading({
        latitude: -27.5,
        longitude: -48.4,
        accuracyM: 34,
        timestampUtcIso: '2026-11-22T12:01:00.000Z',
      });
      expect(r2.accepted).toBe(false);
      expect(r2.session?.points).toHaveLength(1);
      expect(r2.session?.discardedLowAccuracyCount).toBe(1);
      expect(tracker.getState().lastReadingWasDiscarded).toBe(true);

      // 3rd point: accuracy 20.1m > 20m (REJECTED)
      const r3 = await tracker.ingestPositionReading({
        latitude: -27.55,
        longitude: -48.45,
        accuracyM: 20.1,
        timestampUtcIso: '2026-11-22T12:02:00.000Z',
      });
      expect(r3.accepted).toBe(false);
      expect(r3.session?.points).toHaveLength(1);
      expect(r3.session?.discardedLowAccuracyCount).toBe(2);

      // 4th point: accuracy 20.0m <= 20m (ACCEPTED)
      const r4 = await tracker.ingestPositionReading({
        latitude: -27.6054,
        longitude: -48.538,
        accuracyM: 20.0,
        timestampUtcIso: '2026-11-22T12:05:00.000Z',
      });
      expect(r4.accepted).toBe(true);
      expect(r4.session?.points).toHaveLength(2);
      expect(r4.session?.discardedLowAccuracyCount).toBe(2);
      expect(r4.session?.totalDistanceKm).toBeGreaterThan(1.4);
      expect(r4.session?.totalDistanceKm).toBeLessThan(1.6);

      // Pause, resume, and stop
      const paused = await tracker.pauseTracking();
      expect(paused?.status).toBe('paused');

      // Reading while paused should be ignored
      const rPaused = await tracker.ingestPositionReading({
        latitude: -27.61,
        longitude: -48.53,
        accuracyM: 5,
      });
      expect(rPaused.accepted).toBe(false);

      const resumed = await tracker.resumeTracking();
      expect(resumed?.status).toBe('recording');

      const completed = await tracker.stopTracking();
      expect(completed?.status).toBe('completed');
      expect(completed?.endedAtIso).toBeDefined();
      expect(tracker.getState().keepScreenOnWarning).toBe(false);

      // Persisted in Dexie
      const storedTracks = await getTrackSessions();
      expect(storedTracks).toHaveLength(1);
      expect(storedTracks[0]?.name).toBe('Patrulha Costeira Ilha SC');
      expect(storedTracks[0]?.points).toHaveLength(2);
      expect(storedTracks[0]?.discardedLowAccuracyCount).toBe(2);
    });

    it('configures Android Foreground Service notification title when running on native Capacitor platform', async () => {
      const androidTracker = new LocationTrackerService({
        isNativePlatformFn: () => true,
        getPlatformFn: () => 'android',
      });

      await androidTracker.startTracking('Missão Android Nativa');
      const state = androidTracker.getState();

      expect(state.platform).toBe('android');
      expect(state.foregroundServiceActive).toBe(true);
      expect(state.foregroundNotificationTitle).toBe(ANDROID_FOREGROUND_NOTIFICATION_TITLE);
      expect(state.keepScreenOnWarning).toBe(false);

      await androidTracker.stopTracking();
      expect(androidTracker.getState().foregroundServiceActive).toBe(false);
    });

    it('applyReadingToTrackSession works as a deterministic pure reducer', () => {
      const baseSession: TrackSession = {
        id: 'trk-pure',
        name: 'Teste Puro',
        startedAtIso: '2026-11-22T10:00:00.000Z',
        status: 'recording',
        totalDistanceKm: 0,
        points: [],
        discardedLowAccuracyCount: 0,
        platform: 'web',
      };

      const step1 = applyReadingToTrackSession(baseSession, {
        latitude: -27.5954,
        longitude: -48.548,
        accuracyM: 15,
      });
      expect(step1.accepted).toBe(true);
      expect(step1.session.points).toHaveLength(1);

      const step2 = applyReadingToTrackSession(step1.session, {
        latitude: -27.6,
        longitude: -48.55,
        accuracyM: 22,
      });
      expect(step2.accepted).toBe(false);
      expect(step2.session.points).toHaveLength(1);
      expect(step2.session.discardedLowAccuracyCount).toBe(1);
    });
  });

  describe('2. Cascading Geolocation Fallback (GPS 8s -> ipwho.is -> Dexie Cache)', () => {
    it('resolves Tier 1 (GPS) when high-accuracy device GPS responds within 8000ms', async () => {
      expect(GPS_TIMEOUT_MS).toBe(8000);

      const res = await resolveCascadingLocation({
        getGpsPositionFn: async () => ({
          latitude: -27.5954,
          longitude: -48.548,
          accuracyM: 7.2,
        }),
        fetchIpLocationFn: async () => {
          throw new Error('Should not call IP fallback when GPS succeeds');
        },
      });

      expect(res.tierResolved).toBe(1);
      expect(res.gpsStatus).toBe('granted');
      expect(res.coordinates.origin).toBe('gps');
      expect(res.coordinates.isApproximateIp).toBe(false);
      expect(res.coordinates.latitude).toBeCloseTo(-27.5954, 4);
      expect(res.coordinates.accuracyM).toBe(7.2);
    });

    it('falls back to Tier 2 (ipwho.is flagged as "Aproximado via IP") when GPS times out or is denied', async () => {
      const res = await resolveCascadingLocation({
        getGpsPositionFn: async () => {
          throw new Error('Timeout de GPS excedido (8000ms).');
        },
        fetchIpLocationFn: async () => ({
          latitude: -27.5954,
          longitude: -48.548,
          accuracyM: 5000,
          name: 'Florianópolis, Santa Catarina (Aproximado via IP)',
          origin: 'ip',
          isApproximateIp: true,
          updatedAtIso: '2026-11-22T12:00:00.000Z',
        }),
      });

      expect(res.tierResolved).toBe(2);
      expect(res.gpsStatus).toBe('fallback_ip');
      expect(res.coordinates.origin).toBe('ip');
      expect(res.coordinates.isApproximateIp).toBe(true);
      expect(res.coordinates.name).toContain('Aproximado via IP');
    });

    it('falls back to Tier 3 (last cached coordinate in Dexie) when both GPS and ipwho.is fail (100% offline)', async () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });
      await saveForecastCache(forecast);

      const res = await resolveCascadingLocation({
        getGpsPositionFn: async () => {
          throw new Error('GPS Permission Denied');
        },
        fetchIpLocationFn: async () => {
          throw new Error('ERR_INTERNET_DISCONNECTED');
        },
        getCachedLocationFn: resolveDexieCachedCoordinates,
      });

      expect(res.tierResolved).toBe(3);
      expect(res.gpsStatus).toBe('offline_cache');
      expect(res.coordinates.origin).toBe('cached');
      expect(res.coordinates.isApproximateIp).toBe(false);
      expect(res.coordinates.latitude).toBeCloseTo(forecast.latitude, 2);
      expect(res.coordinates.longitude).toBeCloseTo(forecast.longitude, 2);
    });
  });

  describe('3. Georeferenced Waypoints, Automatic ConditionSnapshot & Photo Compression (~200 KB)', () => {
    it('extracts automatic meteorological/oceanographic ConditionSnapshot from NormalizedForecast', () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });
      const firstHourDate = new Date(forecast.hours[0]!.timestampUnix * 1000);
      const snapshot = extractConditionSnapshotFromForecast(forecast, firstHourDate);

      expect(snapshot.timestampUnix).toBe(forecast.hours[0]!.timestampUnix);
      expect(snapshot.windSpeed10mKmh).not.toBeNull();
      expect(snapshot.windDirection10mDeg).not.toBeNull();
      expect(snapshot.windGusts10mKmh).not.toBeNull();
      expect(snapshot.temperature2mC).not.toBeNull();
      expect(snapshot.surfacePressureHpa).not.toBeNull();
      expect(snapshot.waveHeightM).not.toBeNull();
      expect(snapshot.confidenceTotal).toBe(forecast.hours[0]!.confidence.total);
      expect(snapshot.safeWindow).toBe(forecast.hours[0]!.safeWindow);
    });

    it('computes scaled dimensions and estimates base64 Data URL size in KB accurately (< 200 KB target)', async () => {
      expect(TARGET_PHOTO_MAX_KB).toBe(200);

      const scaled = computeScaledDimensions(4000, 3000, 1280);
      expect(scaled.width).toBe(1280);
      expect(scaled.height).toBe(960);

      // 40 KB synthetic base64 payload
      const rawBytes = 40 * 1024;
      const base64Chars = Math.ceil((rawBytes * 4) / 3);
      const fakeDataUrl = `data:image/jpeg;base64,${'A'.repeat(base64Chars)}`;
      const estimatedKb = estimateDataUrlSizeKb(fakeDataUrl);

      expect(estimatedKb).toBeGreaterThan(39);
      expect(estimatedKb).toBeLessThan(41);

      const compressed = await compressImageDataUrl(fakeDataUrl, {
        targetMaxKb: TARGET_PHOTO_MAX_KB,
      });
      expect(compressed.sizeKb).toBeLessThanOrEqual(TARGET_PHOTO_MAX_KB);
    });
  });

  describe('4. Relative Wind & Wave Compass Math (iOS webkitCompassHeading & Android 360 - alpha)', () => {
    it('extracts heading from iOS webkitCompassHeading and Android deviceorientationabsolute', () => {
      const iosHeading = extractHeadingFromOrientationEvent({
        alpha: 40,
        webkitCompassHeading: 135,
      });
      expect(iosHeading).toEqual({
        headingDeg: 135,
        source: 'ios_webkit',
      });

      const androidHeading = extractHeadingFromOrientationEvent({
        alpha: 90,
        absolute: true,
      });
      expect(androidHeading).toEqual({
        headingDeg: 270, // 360 - 90
        source: 'android_absolute',
      });

      const noSensor = extractHeadingFromOrientationEvent({
        alpha: null,
      });
      expect(noSensor).toBeNull();
    });

    it('computes relative wind and wave bearings normalized to [0, 360)', () => {
      expect(normalizeCompassDeg(-45)).toBe(315);
      expect(normalizeCompassDeg(360)).toBe(0);
      expect(computeRelativeBearingDeg(145, 90)).toBe(55);
      expect(computeRelativeBearingDeg(30, 120)).toBe(270);
      expect(computeRelativeBearingDeg(null, 120)).toBeNull();
    });
  });

  describe('5. Export & Share Hub (CSV UTF-8 BOM, JSON, GPX, GeoJSON & WhatsApp wa.me)', () => {
    const sampleWaypoint: Waypoint = {
      id: 'wpt-test-1',
      name: 'Ilha do Campeche',
      latitude: -27.6961,
      longitude: -48.4653,
      timestampUtcIso: '2026-11-22T14:00:00.000Z',
      note: 'Fundeio abrigado de quadrante Sul',
      conditions: {
        timestampUnix: 1795356000,
        timestampIso: '2026-11-22T14:00:00.000Z',
        windSpeed10mKmh: 16.2,
        windDirection10mDeg: 160,
        windGusts10mKmh: 22.8,
        temperature2mC: 24.0,
        surfacePressureHpa: 1016.2,
        precipitationMm: 0,
        waveHeightM: 1.3,
        wavePeriodS: 9.5,
        waveDirectionDeg: 150,
        confidenceTotal: 90,
        safeWindow: 'green',
      },
    };

    const sampleTrack: TrackSession = {
      id: 'trk-test-1',
      name: 'Travessia Campeche',
      startedAtIso: '2026-11-22T13:00:00.000Z',
      endedAtIso: '2026-11-22T13:45:00.000Z',
      status: 'completed',
      totalDistanceKm: 1.85,
      discardedLowAccuracyCount: 1,
      platform: 'android',
      points: [
        {
          latitude: -27.685,
          longitude: -48.48,
          accuracyM: 6,
          speedMs: 2.5,
          headingDeg: 110,
          timestampUtcIso: '2026-11-22T13:00:00.000Z',
        },
        {
          latitude: -27.6961,
          longitude: -48.4653,
          accuracyM: 5,
          speedMs: 2.4,
          headingDeg: 115,
          timestampUtcIso: '2026-11-22T13:45:00.000Z',
        },
      ],
    };

    it('builds CSV (with UTF-8 BOM \\uFEFF), JSON, GPX and GeoJSON artifacts and delivers via ShareService', async () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      const csvArtifact = buildExportArtifact({
        dataset: 'forecast',
        format: 'csv',
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
      });
      expect(csvArtifact.content.startsWith(UTF8_BOM)).toBe(true);
      expect(csvArtifact.filename).toContain('.csv');

      const gpxArtifact = buildExportArtifact({
        dataset: 'mission_bundle',
        format: 'gpx',
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
        locationName: 'Florianópolis',
      });
      expect(gpxArtifact.content).toContain('<gpx version="1.1"');
      expect(gpxArtifact.content).toContain('Ilha do Campeche');
      expect(gpxArtifact.content).toContain('Travessia Campeche');

      const geoJsonArtifact = buildExportArtifact({
        dataset: 'mission_bundle',
        format: 'geojson',
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
      });
      const parsedGeo = JSON.parse(geoJsonArtifact.content);
      expect(parsedGeo.type).toBe('FeatureCollection');
      expect(parsedGeo.features).toHaveLength(3);

      const jsonArtifact = buildExportArtifact({
        dataset: 'mission_bundle',
        format: 'json',
        forecast,
        waypoints: [sampleWaypoint],
        tracks: [sampleTrack],
      });
      const parsedJson = JSON.parse(jsonArtifact.content);
      expect(parsedJson.application).toBe('FieldCast');
      expect(parsedJson.waypoints).toHaveLength(1);
      expect(parsedJson.tracks).toHaveLength(1);

      const delivery = await exportAndDeliverFile({
        filename: csvArtifact.filename,
        content: csvArtifact.content,
        format: 'csv',
        isNativePlatformFn: () => false,
      });
      expect(delivery.deliveredVia).toBe('browser_download');
      expect(delivery.byteLength).toBeGreaterThan(100);
    });

    it('generates formatted WhatsApp (https://wa.me/?text=...) bulletin link with weather and field summary', () => {
      const forecast = normalizeOpenMeteoForecast({
        forecastRaw: openMeteoCoastal,
        marineRaw: marineCoastal,
      });

      const wa = shareBulletinViaWhatsApp({
        forecast,
        locationName: 'Florianópolis — SC',
        waypointsCount: 3,
        tracksCount: 2,
        openWindow: false,
      });

      expect(wa.url.startsWith('https://wa.me/?text=')).toBe(true);
      expect(wa.text).toContain('*FieldCast — Boletim Operacional*');
      expect(wa.text).toContain('Florianópolis — SC');
      expect(wa.text).toContain('Altitude DEM: 23 m');
      expect(wa.text).toContain('Campo: 3 waypoint(s) | 2 rota(s) GPS');

      const decodedUrlText = decodeURIComponent(wa.url.replace('https://wa.me/?text=', ''));
      expect(decodedUrlText).toBe(wa.text);
    });
  });
});
