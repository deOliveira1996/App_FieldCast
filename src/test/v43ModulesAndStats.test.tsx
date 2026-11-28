import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { GroundTruthModal } from '../components/common/GroundTruthModal';
import { ModelComparisonTab } from '../components/comparison/ModelComparisonTab';
import { MapRadarTab } from '../components/map/MapRadarTab';
import { RoutePlanningTab } from '../components/planner/RoutePlanningTab';
import { SettingsTab } from '../components/settings/SettingsTab';
import { DailySummaryTab } from '../components/summary/DailySummaryTab';
import { APP_EDITION, ENABLED_TABS, IS_MINIMAL_EDITION, isTabEnabled } from '../config/appEdition';
import {
  deleteGroundTruthObservation,
  getGroundTruthObservations,
  mergeGroundTruthObservations,
  resetDatabaseForTests,
  saveGroundTruthObservation,
} from '../db/database';
import {
  buildUpcomingBackgroundAlertPayloads,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DHN_TIDE_DISCLAIMER_PT,
  evaluateForecastNotificationTriggers,
  getNativeBackgroundAlertStatus,
} from '../services/notificationService';
import {
  fetch4DRouteForecast,
  formatRouteBriefingCsv,
  formatRouteBriefingHtml,
  formatRouteBriefingMarkdown,
  generateRouteBriefingDocxBytes,
  generateRouteBriefingPdfBytes,
  interpolateAerialWindSpeedKmh,
  type RouteForecast4DResult,
} from '../services/routeForecastService';
import type { GroundTruthObservation, UserNotificationPreferences } from '../types/v4';
import { computeModelScalarStat } from '../utils/ensembleMath';
import {
  checkGroundTruthCooldown,
  computeRegionalCalibration,
  createGroundTruthObservation,
  MIN_CALIBRATION_SAMPLES,
  parseAndValidateGroundTruthPackage,
  serializeGroundTruthPackage,
} from '../utils/groundTruthCalibration';
import {
  buildCheckpointsFromPoints,
  parseRouteFileContent,
} from '../utils/routeImporter';
import { computeDescriptiveStats } from '../utils/scientificAnalytics';
import {
  createCoastalTestForecast,
  mountReactComponent,
  setViewportSize,
  TEST_COASTAL_LOCATION,
} from './testUtils';

vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: EChartsOption }) => (
    <div data-testid="echarts-mock" data-option={JSON.stringify(option)} />
  ),
}));

const stableMockBounds = {
  getNorth: () => -27.4,
  getSouth: () => -27.8,
  getEast: () => -48.3,
  getWest: () => -48.7,
};
const stableMockContainer = document.createElement('div');
const stableMockSize = { x: 640, y: 400 };
const stableMockMap = {
  invalidateSize: vi.fn(),
  getCenter: () => ({ lat: -27.5954, lng: -48.548 }),
  getBounds: () => stableMockBounds,
  getZoom: () => 12,
  setView: vi.fn(),
  fitBounds: vi.fn(),
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  getContainer: () => stableMockContainer,
  getSize: () => stableMockSize,
  getPane: () => stableMockContainer,
  createPane: () => stableMockContainer,
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('react-leaflet', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="leaflet-stub">{children}</div>
  );
  return {
    MapContainer: Stub,
    TileLayer: () => <div data-testid="leaflet-tile-layer" />,
    Marker: Stub,
    Popup: Stub,
    Polyline: Stub,
    Polygon: Stub,
    Rectangle: Stub,
    Circle: Stub,
    CircleMarker: Stub,
    ScaleControl: Stub,
    Tooltip: Stub,
    useMap: () => stableMockMap,
    useMapEvents: () => stableMockMap,
  };
});

describe('FieldCast V4.3 — Modules, Statistics, Ground-Truth, 4D Route & Dual Editions', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await resetDatabaseForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('Module 1: DailySummaryTab (Ephemeris + Moon Phase + Condensed Risk Box) & ModelComparisonTab', () => {
    it('renders EphemerisCard with solar noon & moon phase inside ephemeris-summary-module and condensed risk box that expands on click', async () => {
      setViewportSize(1280, 800);
      const forecast = createCoastalTestForecast();

      let mounted!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        mounted = mountReactComponent(
          <DailySummaryTab forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />,
        );
        await Promise.resolve();
      });

      const ephemerisModule = mounted.container.querySelector('[data-testid="ephemeris-summary-module"]');
      expect(ephemerisModule).not.toBeNull();
      expect(ephemerisModule?.querySelector('[data-testid="ephemeris-solar-noon"]')).not.toBeNull();
      expect(ephemerisModule?.querySelector('[data-testid="moon-phase-status"]')).not.toBeNull();

      // Condensed risk box starts collapsed (details panel hidden until clicked)
      const riskSpan = mounted.container.querySelector('[data-testid="global-extreme-events-span"]');
      expect(riskSpan).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="extreme-events-details-panel"]')).toBeNull();

      const detailsToggle = mounted.container.querySelector(
        '[data-testid="extreme-events-details-toggle"]',
      ) as HTMLButtonElement;
      expect(detailsToggle).not.toBeNull();

      act(() => {
        detailsToggle.click();
      });

      const detailsPanel = mounted.container.querySelector('[data-testid="extreme-events-details-panel"]');
      expect(detailsPanel).not.toBeNull();
    });

    it('renders ModelComparisonTab with collapsible model bar & analytical plot toggles preserving master + per-plot toggles', async () => {
      setViewportSize(1280, 800);
      const forecast = createCoastalTestForecast();

      let mounted!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        mounted = mountReactComponent(
          <ModelComparisonTab forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />,
        );
        await Promise.resolve();
      });

      expect(mounted.container.querySelector('[data-testid="comparison-model-bar-module"]')).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="comparison-plots-module"]')).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="bessel-spread-badge"]')).not.toBeNull();

      const masterBtn = mounted.container.querySelector(
        '[data-testid="master-plots-toggle"]',
      ) as HTMLButtonElement;
      expect(masterBtn).not.toBeNull();
      expect(masterBtn.getAttribute('aria-pressed')).toBe('false');

      // All 4 per-plot toggles present
      const plotKeys = ['windAndVertical', 'rainAndPressure', 'wavesAndMsl', 'stratifiedClouds'];
      for (const k of plotKeys) {
        expect(mounted.container.querySelector(`[data-testid="plot-toggle-${k}"]`)).not.toBeNull();
      }

      // Clicking master toggle activates charts on demand
      act(() => {
        masterBtn.click();
      });
      expect(masterBtn.getAttribute('aria-pressed')).toBe('true');
      expect(mounted.container.querySelectorAll('[data-testid="echarts-mock"]').length).toBeGreaterThan(0);
    });
  });

  describe('Module 2: MapRadarTab internal slide-over drawer, GOES-East GeoColor & isolated offline block', () => {
    it('opens map-windy-drawer inside map viewport, toggles GOES-East satellite, and isolates offline-maps-module below', async () => {
      setViewportSize(1280, 800);
      const forecast = createCoastalTestForecast();

      let mounted!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        mounted = mountReactComponent(
          <MapRadarTab
            activeLocation={TEST_COASTAL_LOCATION}
            forecast={forecast}
            onSelectLocation={vi.fn()}
          />,
        );
        await Promise.resolve();
      });

      const drawerToggle = mounted.container.querySelector(
        '[data-testid="map-layers-drawer-toggle"]',
      ) as HTMLButtonElement;
      expect(drawerToggle).not.toBeNull();

      act(() => {
        drawerToggle.click();
      });

      const drawer = mounted.container.querySelector('[data-testid="map-windy-drawer"]');
      expect(drawer).not.toBeNull();

      const goesToggle = mounted.container.querySelector(
        '[data-testid="toggle-goes-satellite"]',
      ) as HTMLButtonElement;
      expect(goesToggle).not.toBeNull();
      expect(goesToggle.getAttribute('aria-pressed')).toBe('false');

      act(() => {
        goesToggle.click();
      });
      expect(goesToggle.getAttribute('aria-pressed')).toBe('true');

      // Offline maps module is isolated below the map
      const offlineModule = mounted.container.querySelector('[data-testid="offline-maps-module"]');
      expect(offlineModule).not.toBeNull();
    });
  });

  describe('Module 3: 4D Route Importer, Forecast Engine & RoutePlanningTab', () => {
    it('parses GPX, KML, GeoJSON, and CSV routes and resamples long tracks to <= 18 checkpoints', async () => {
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1"><trk><name>Travessia Ilha</name><trkseg>
          <trkpt lat="-27.5900" lon="-48.5500"><ele>5</ele></trkpt>
          <trkpt lat="-27.6200" lon="-48.5100"><ele>2</ele></trkpt>
          <trkpt lat="-27.6800" lon="-48.4700"><ele>0</ele></trkpt>
        </trkseg></trk></gpx>`;
      const parsedGpx = await parseRouteFileContent('travessia.gpx', gpx);
      expect(parsedGpx.format).toBe('gpx');
      expect(parsedGpx.points).toHaveLength(3);
      expect(parsedGpx.totalDistanceKm).toBeGreaterThan(5);

      const kml = `<?xml version="1.0" encoding="UTF-8"?>
        <kml><Document><Placemark><name>Rota KML</name><LineString><coordinates>
          -48.55,-27.59,0 -48.50,-27.64,0 -48.45,-27.70,0
        </coordinates></LineString></Placemark></Document></kml>`;
      const parsedKml = await parseRouteFileContent('rota.kml', kml);
      expect(parsedKml.format).toBe('kml');
      expect(parsedKml.points).toHaveLength(3);

      const geojson = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Rota GeoJSON' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [-48.55, -27.59],
                [-48.51, -27.63],
                [-48.46, -27.69],
              ],
            },
          },
        ],
      });
      const parsedGeo = await parseRouteFileContent('rota.geojson', geojson);
      expect(parsedGeo.format).toBe('geojson');
      expect(parsedGeo.points).toHaveLength(3);

      const csv = 'name,latitude,longitude\nP1,-27.59,-48.55\nP2,-27.62,-48.51\nP3,-27.68,-48.47\n';
      const parsedCsv = await parseRouteFileContent('rota.csv', csv);
      expect(parsedCsv.format).toBe('csv');
      expect(parsedCsv.points).toHaveLength(3);

      // Resample 40 points down to <= 18 preserving exact P1 and Pn
      const densePoints = Array.from({ length: 40 }, (_, i) => ({
        latitude: -27.5 - i * 0.01,
        longitude: -48.5 - i * 0.01,
        name: `PT-${i + 1}`,
      }));
      const checkpoints = buildCheckpointsFromPoints(densePoints, 18);
      expect(checkpoints.length).toBeLessThanOrEqual(18);
      expect(checkpoints[0]!.latitude).toBeCloseTo(densePoints[0]!.latitude, 5);
      expect(checkpoints[checkpoints.length - 1]!.latitude).toBeCloseTo(
        densePoints[densePoints.length - 1]!.latitude,
        5,
      );
    });

    it('computes 4D ETA route forecast (Navigation & Aerial 10-120m/1000m) and generates all 5 export formats', async () => {
      const checkpoints = buildCheckpointsFromPoints([
        { latitude: -27.59, longitude: -48.55, name: 'Partida' },
        { latitude: -27.68, longitude: -48.47, name: 'Destino' },
      ]);
      const baseUnix = 1795500000;
      const hourlyTimes = Array.from({ length: 24 }, (_, i) => baseUnix + i * 3600);

      const mockForecastPoint = (lat: number, lon: number) => ({
        latitude: lat,
        longitude: lon,
        elevation: 12,
        timezone: 'America/Sao_Paulo',
        utc_offset_seconds: -10800,
        hourly: {
          time: hourlyTimes,
          temperature_2m: hourlyTimes.map(() => 24),
          precipitation: hourlyTimes.map(() => 0.2),
          precipitation_probability: hourlyTimes.map(() => 15),
          wind_speed_10m: hourlyTimes.map(() => 16),
          wind_direction_10m: hourlyTimes.map(() => 135),
          wind_gusts_10m: hourlyTimes.map(() => 24),
          wind_speed_80m: hourlyTimes.map(() => 22),
          wind_speed_120m: hourlyTimes.map(() => 26),
          wind_speed_925hPa: hourlyTimes.map(() => 34),
          wind_direction_925hPa: hourlyTimes.map(() => 145),
          cloud_cover_low: hourlyTimes.map(() => 20),
          cloud_cover_mid: hourlyTimes.map(() => 10),
          cloud_cover_high: hourlyTimes.map(() => 15),
          visibility: hourlyTimes.map(() => 18000),
          cape: hourlyTimes.map(() => 180),
        },
      });

      const mockMarinePoint = (lat: number, lon: number) => ({
        latitude: lat,
        longitude: lon,
        timezone: 'America/Sao_Paulo',
        hourly: {
          time: hourlyTimes,
          wave_height: hourlyTimes.map(() => 1.1),
          wave_period: hourlyTimes.map(() => 8.5),
          wave_direction: hourlyTimes.map(() => 150),
          ocean_current_velocity: hourlyTimes.map(() => 1.4),
          ocean_current_direction: hourlyTimes.map(() => 180),
          sea_level_height_msl: hourlyTimes.map(() => 0.45),
        },
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('marine-api.open-meteo.com')) {
          return new Response(
            JSON.stringify([
              mockMarinePoint(-27.59, -48.55),
              mockMarinePoint(-27.68, -48.47),
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify([
            mockForecastPoint(-27.59, -48.55),
            mockForecastPoint(-27.68, -48.47),
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const navResult: RouteForecast4DResult = await fetch4DRouteForecast({
        routeName: 'Travessia Floripa',
        category: 'navigation',
        checkpoints,
        departureUnix: baseUnix,
        avgSpeedKmh: 15,
      });

      expect(navResult.checkpoints).toHaveLength(2);
      expect(navResult.checkpoints[1]!.etaUnix).toBeGreaterThan(navResult.checkpoints[0]!.etaUnix);
      expect(navResult.hasMarineTideData).toBe(true);
      expect(navResult.disclaimers.some((d) => d.includes('DHN'))).toBe(true);

      // Aerial altitude interpolation 10m -> 50m -> 120m -> 600m
      const levels = { w10: 16, w80: 22, w120: 26, w925: 34 };
      const w50 = interpolateAerialWindSpeedKmh(50, levels);
      const w600 = interpolateAerialWindSpeedKmh(600, levels);
      expect(w50).not.toBeNull();
      expect(w50!).toBeGreaterThan(16);
      expect(w50!).toBeLessThan(22);
      expect(w600).not.toBeNull();
      expect(w600!).toBeGreaterThan(26);

      // All 5 export formats
      const html = formatRouteBriefingHtml(navResult, 'pt');
      const md = formatRouteBriefingMarkdown(navResult, 'pt');
      const csv = formatRouteBriefingCsv(navResult);
      const pdfBytes = generateRouteBriefingPdfBytes(navResult, 'pt');
      const docxBytes = generateRouteBriefingDocxBytes(navResult, 'pt');

      expect(html).toContain('Travessia Floripa');
      expect(md).toContain('Travessia Floripa');
      expect(csv).toContain('Partida');
      expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-');
      expect(docxBytes[0]).toBe(0x50); // PK zip header
      expect(docxBytes[1]).toBe(0x4b);
    });

    it('renders RoutePlanningTab with Navigation & Aerial modes and quick example route', async () => {
      setViewportSize(1280, 800);
      let mounted!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        mounted = mountReactComponent(
          <RoutePlanningTab activeLocation={TEST_COASTAL_LOCATION} />,
        );
        await Promise.resolve();
      });

      expect(mounted.container.querySelector('[data-testid="route-planning-tab"]')).not.toBeNull();
      const navBtn = mounted.container.querySelector(
        '[data-testid="planner-mode-navigation"]',
      ) as HTMLButtonElement;
      const aerialBtn = mounted.container.querySelector(
        '[data-testid="planner-mode-aerial"]',
      ) as HTMLButtonElement;
      expect(navBtn).not.toBeNull();
      expect(aerialBtn).not.toBeNull();

      act(() => {
        aerialBtn.click();
      });
      expect(aerialBtn.getAttribute('aria-pressed')).toBe('true');
      expect(mounted.container.querySelector('[data-testid="aerial-alt-preset-80"]')).not.toBeNull();
    });
  });

  describe('Module 4: Tide Alerts (MSL), Mandatory DHN Notice, Recurrence & Android Background Bridge', () => {
    it('evaluates MSL tide thresholds with mandatory DHN disclaimer and builds background payloads', async () => {
      const forecast = createCoastalTestForecast();
      const tideForecast = {
        ...forecast,
        hours: forecast.hours.map((h, i) => ({
          ...h,
          marine: h.marine
            ? { ...h.marine, seaLevelHeightMsl: i === 2 ? 1.45 : 0.25 }
            : null,
        })),
      };

      const prefs: UserNotificationPreferences = {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        masterEnabled: true,
        extremeEventsAutoEnabled: false,
        rules: [
          {
            id: 'rule-tide-high',
            name: 'Alerta Maré Alta MSL',
            enabled: true,
            conditions: { maxTideMslM: 1.2 },
            timeWindow: { startHHMM: '00:00', endHHMM: '23:59', notifyFromHHMM: null },
            recurrence: { mode: 'interval_hours', intervalHours: 3, maxTriggersPerWindow: 4 },
            customTitle: 'Maré Alta',
            customMessage: 'Maré estimada acima do limiar.',
            createdAtIso: new Date().toISOString(),
          },
        ],
      };

      const now = new Date(tideForecast.hours[0]!.timestampUnix * 1000);
      const triggers = evaluateForecastNotificationTriggers({
        forecast: tideForecast,
        prefs,
        now,
      });

      expect(triggers.length).toBeGreaterThanOrEqual(1);
      expect(triggers[0]!.message).toContain('DHN');
      expect(DHN_TIDE_DISCLAIMER_PT).toContain('DHN / Marinha do Brasil');

      const upcoming = buildUpcomingBackgroundAlertPayloads(
        prefs,
        tideForecast,
        TEST_COASTAL_LOCATION.name,
        now,
      );
      expect(upcoming.length).toBeGreaterThanOrEqual(1);
      expect(upcoming[0]!.body).toContain('DHN');

      const bgStatus = await getNativeBackgroundAlertStatus();
      expect(bgStatus.supported).toBe(false); // jsdom web fallback
    });

    it('renders SettingsTab with MSL tide inputs, DHN disclaimer, recurrence selector & background alerts panel', async () => {
      setViewportSize(1280, 800);
      let mounted!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        mounted = mountReactComponent(
          <SettingsTab
            forecast={createCoastalTestForecast()}
            onNotificationPreferencesChange={vi.fn()}
          />,
        );
        await Promise.resolve();
      });

      expect(mounted.container.querySelector('[data-testid="rule-min-tide-input"]')).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="rule-max-tide-input"]')).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="rule-recurrence-mode"]')).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="background-alerts-panel"]')).not.toBeNull();
      expect(mounted.container.textContent).toContain('DHN');
    });
  });

  describe('Module 5: Bessel (n-1) Spread, Robust MAD/Theil-Sen Stats & Ground-Truth Calibration/Storage', () => {
    it('computes Bessel (n-1) sample stdDev in computeModelScalarStat and MAD + Theil-Sen in computeDescriptiveStats', () => {
      // Values: 10, 14, 18, 22 -> mean = 16, sumSq = 36+4+4+36 = 80
      // Sample variance (n-1 = 3) = 80 / 3 = 26.6667 -> stdDev = sqrt(80/3) ≈ 5.16398
      const stat = computeModelScalarStat({
        ecmwf_ifs025: 10,
        gfs_seamless: 14,
        icon_seamless: 18,
        gem_seamless: 22,
      });
      expect(stat.mean).toBeCloseTo(16, 4);
      expect(stat.stdDev).toBeCloseTo(Math.sqrt(80 / 3), 2);

      // Robust MAD & Theil-Sen trend with a massive outlier spike
      const baseTs = 1795500000;
      const values = [10, 11, 12, 13, 14, 15, 100, 17, 18, 19]; // +1 per hour = +24/day, outlier at idx 6
      const timestamps = values.map((_, i) => baseTs + i * 3600);
      const stats = computeDescriptiveStats('temp', 'Temperatura', '°C', values, timestamps);
      expect(stats.mad).not.toBeNull();
      expect(stats.mad!).toBeGreaterThan(0);
      expect(stats.robustZScoreMax).not.toBeNull();
      expect(stats.robustZScoreMax!).toBeGreaterThan(3.5);
      expect(stats.theilSenTrendPerDay).not.toBeNull();
      expect(stats.theilSenTrendPerDay!).toBeCloseTo(24, 0);
    });

    it('enforces photo-optional Ground-Truth, 30-min cooldown, n>=10 Bayesian shrinkage gate, JSON export/merge & storage cleanup UI', async () => {
      const forecast = createCoastalTestForecast();
      const baseUnix = Math.floor(Date.now() / 1000) - 3600 * 24;

      // Create observation without photo, with anchored -2..+2 ordinal & sky cover
      const obs1 = createGroundTruthObservation({
        latitude: TEST_COASTAL_LOCATION.latitude,
        longitude: TEST_COASTAL_LOCATION.longitude,
        locationName: TEST_COASTAL_LOCATION.name,
        rainClass: 'none',
        skyCoverClass: 'clear',
        tempRelativeRating: 1,
        windRelativeRating: -1,
        forecast,
        now: new Date(baseUnix * 1000),
      });
      expect(obs1.photoDataUrl).toBeUndefined();
      expect(obs1.skyCoverClass).toBe('clear');
      expect(obs1.tempRelativeRating).toBe(1);
      expect(obs1.windRelativeRating).toBe(-1);

      // 30-min cooldown triggers 10 minutes later at same coordinate, clears after 35 minutes
      const cdActive = checkGroundTruthCooldown(
        [obs1],
        TEST_COASTAL_LOCATION.latitude,
        TEST_COASTAL_LOCATION.longitude,
        baseUnix + 10 * 60,
      );
      expect(cdActive.isCoolingDown).toBe(true);
      expect(cdActive.remainingMinutes).toBeGreaterThanOrEqual(19);

      const cdExpired = checkGroundTruthCooldown(
        [obs1],
        TEST_COASTAL_LOCATION.latitude,
        TEST_COASTAL_LOCATION.longitude,
        baseUnix + 35 * 60,
      );
      expect(cdExpired.isCoolingDown).toBe(false);

      // Build 11 observations spaced 45 minutes apart -> passes n >= 10 Bayesian gate
      const batchObs: GroundTruthObservation[] = Array.from({ length: 11 }, (_, idx) =>
        createGroundTruthObservation({
          id: `gt-batch-${idx}`,
          latitude: TEST_COASTAL_LOCATION.latitude,
          longitude: TEST_COASTAL_LOCATION.longitude,
          locationName: TEST_COASTAL_LOCATION.name,
          rainClass: idx % 2 === 0 ? 'none' : 'light',
          skyCoverClass: 'partly_cloudy',
          tempRelativeRating: 0,
          windRelativeRating: 0,
          measuredTempC: 24 + (idx % 2) * 0.2,
          measuredWindKmh: 15,
          forecast,
          now: new Date((baseUnix + idx * 45 * 60) * 1000),
        }),
      );

      // Under gate (9 samples) -> ineligible
      const calUnder = computeRegionalCalibration(
        batchObs.slice(0, MIN_CALIBRATION_SAMPLES - 1),
        TEST_COASTAL_LOCATION.latitude,
        TEST_COASTAL_LOCATION.longitude,
      );
      expect(calUnder.calibrationEligible).toBe(false);

      // At/above gate (11 samples) -> eligible with weights clamped in [0.10, 0.50]
      const calEligible = computeRegionalCalibration(
        batchObs,
        TEST_COASTAL_LOCATION.latitude,
        TEST_COASTAL_LOCATION.longitude,
      );
      expect(calEligible.calibrationEligible).toBe(true);
      const weights = Object.values(calEligible.weightsByModel);
      for (const w of weights) {
        expect(w).toBeGreaterThanOrEqual(0.1 - 1e-6);
        expect(w).toBeLessThanOrEqual(0.5 + 1e-6);
      }

      // JSON export + Zod validation + IndexedDB merge & per-item delete
      const exportedJson = serializeGroundTruthPackage(batchObs.slice(0, 3), 'FieldCast QA');
      const parsedPkg = parseAndValidateGroundTruthPackage(exportedJson);
      expect(parsedPkg.observationCount).toBe(3);

      await saveGroundTruthObservation(batchObs[0]!);
      const mergeStats = await mergeGroundTruthObservations(parsedPkg.observations);
      expect(mergeStats.added).toBe(2);
      expect(mergeStats.skipped).toBe(1);

      await deleteGroundTruthObservation(batchObs[0]!.id);
      const remaining = await getGroundTruthObservations();
      expect(remaining).toHaveLength(2);

      // GroundTruthModal renders storage usage panel & clear button
      let mounted!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        mounted = mountReactComponent(
          <GroundTruthModal
            isOpen={true}
            onClose={vi.fn()}
            activeLocation={TEST_COASTAL_LOCATION}
            forecast={forecast}
          />,
        );
        await Promise.resolve();
      });

      expect(mounted.container.querySelector('[data-testid="ground-truth-storage-panel"]')).not.toBeNull();
      expect(mounted.container.querySelector('[data-testid="ground-truth-storage-count"]')?.textContent).toContain('2');
      expect(mounted.container.querySelector('[data-testid="clear-ground-truth-btn"]')).not.toBeNull();
    });
  });

  describe('Module 6: Dual Build Editions (appEdition.ts)', () => {
    it('exports Full edition tabs cleanly in default test runtime', () => {
      expect(APP_EDITION).toBe('full');
      expect(IS_MINIMAL_EDITION).toBe(false);
      expect(ENABLED_TABS).toHaveLength(8);
      expect(isTabEnabled('forecast')).toBe(true);
      expect(isTabEnabled('planner')).toBe(true);
      expect(isTabEnabled('comparison')).toBe(true);
      expect(isTabEnabled('settings')).toBe(true);
    });
  });
});
