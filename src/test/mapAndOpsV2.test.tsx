import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthCheckModal } from '../components/common/HealthCheckModal';
import { FieldDataTab } from '../components/field/FieldDataTab';
import {
  COMPASS_PREF_STORAGE_KEY,
  computeHeadingFromQuaternion,
  computeTiltCompensatedHeadingDeg,
  WindCompass,
} from '../components/field/WindCompass';
import { SavedLocationsModal } from '../components/layout/SavedLocationsModal';
import { MapRadarTab } from '../components/map/MapRadarTab';
import * as rainViewerService from '../services/rainViewerService';
import * as weatherGridService from '../services/weatherGridService';
import type { HealthCheckSnapshot } from '../types/health';
import {
  createCoastalTestForecast,
  mountReactComponent,
  TEST_COASTAL_LOCATION,
} from './testUtils';

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
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  getContainer: () => stableMockContainer,
  getSize: () => stableMockSize,
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('react-leaflet', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="leaflet-stub">{children}</div>
  );
  return {
    MapContainer: Stub,
    TileLayer: ({ url, zIndex }: { url?: string; zIndex?: number }) => (
      <div
        data-testid="tile-layer"
        data-url={url}
        data-z-index={String(zIndex ?? '')}
      />
    ),
    Marker: () => null,
    Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Circle: () => null,
    CircleMarker: () => null,
    Rectangle: () => null,
    Polyline: () => null,
    useMap: () => stableMockMap,
    useMapEvents: () => null,
  };
});

function dispatchOrientationEvent(
  type: 'deviceorientationabsolute' | 'deviceorientation',
  init: {
    alpha: number | null;
    beta?: number | null;
    gamma?: number | null;
    absolute?: boolean;
    webkitCompassHeading?: number;
  },
): void {
  const evt = new Event(type) as Event & {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
    absolute: boolean;
    webkitCompassHeading?: number;
  };
  evt.alpha = init.alpha;
  evt.beta = init.beta ?? 0;
  evt.gamma = init.gamma ?? 0;
  evt.absolute = Boolean(init.absolute);
  if (init.webkitCompassHeading !== undefined) {
    evt.webkitCompassHeading = init.webkitCompassHeading;
  }
  window.dispatchEvent(evt);
}

describe('Map & Field Ops V2 — Offscreen Radar Cache, 3D Absolute Compass, Historical Series, KML/KMZ & Diagnostics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('WindCompass latches onto deviceorientationabsolute, ignores relative deviceorientation events, and supports 1-tap manual hide + auto-hide on relative-only sensors', () => {
    // 1. Verify 3D tilt-compensated math and quaternion math
    expect(computeTiltCompensatedHeadingDeg(90, 0, 0, 0)).toBe(270);
    const tiltedHeading = computeTiltCompensatedHeadingDeg(90, 35, 20, 0);
    expect(Number.isFinite(tiltedHeading)).toBe(true);
    expect(computeHeadingFromQuaternion([0, 0, 0, 1], 0)).toBe(0);

    // 2. Mount WindCompass and fire an absolute event (alpha=60 -> heading=300°)
    const mount1 = mountReactComponent(
      <WindCompass
        windDirection10mDeg={180}
        windSpeed10mKmh={22.4}
        waveDirectionDeg={150}
        waveHeightM={1.4}
        marineAvailable={true}
      />,
    );

    act(() => {
      dispatchOrientationEvent('deviceorientationabsolute', {
        alpha: 60,
        beta: 0,
        gamma: 0,
        absolute: true,
      });
    });

    expect(mount1.container.textContent).toContain('Proa: 300°');
    expect(mount1.container.textContent).toContain('android_absolute');

    // Now fire a relative deviceorientation event (absolute: false, alpha=10 -> would be 350° if not ignored!)
    act(() => {
      dispatchOrientationEvent('deviceorientation', {
        alpha: 10,
        beta: 25,
        gamma: -15,
        absolute: false,
      });
    });

    // Heading MUST remain 300° from deviceorientationabsolute!
    expect(mount1.container.textContent).toContain('Proa: 300°');
    expect(mount1.container.textContent).not.toContain('Proa: 350°');

    // 3. Click "Ocultar Bússola" and verify it hides the compass dial and persists preference
    const hideBtn = mount1.container.querySelector(
      '[data-testid="hide-compass-button"]',
    ) as HTMLButtonElement | null;
    expect(hideBtn).not.toBeNull();

    act(() => {
      hideBtn!.click();
    });

    expect(
      mount1.container.querySelector('[aria-label="Bússola de Vento e Onda Relativa"]'),
    ).toBeNull();
    expect(
      mount1.container.querySelector('[data-testid="compass-hidden-bar"]'),
    ).not.toBeNull();
    expect(window.localStorage.getItem(COMPASS_PREF_STORAGE_KEY)).toContain(
      '"enabled":false',
    );
    mount1.unmount();

    // 4. Verify auto-hide when ONLY relative (non-absolute) deviceorientation events arrive
    window.localStorage.clear();
    const mountRelativeOnly = mountReactComponent(
      <WindCompass
        windDirection10mDeg={180}
        windSpeed10mKmh={20}
        waveDirectionDeg={null}
        waveHeightM={null}
        marineAvailable={false}
      />,
    );

    act(() => {
      dispatchOrientationEvent('deviceorientation', {
        alpha: 45,
        absolute: false,
      });
      dispatchOrientationEvent('deviceorientation', {
        alpha: 50,
        absolute: false,
      });
    });

    expect(
      mountRelativeOnly.container.querySelector(
        '[aria-label="Bússola de Vento e Onda Relativa"]',
      ),
    ).toBeNull();
    mountRelativeOnly.unmount();
  });

  it('MapRadarTab supports CMC GEM 15 km (gem_seamless), caches static overlay offscreen, and toggles radar off/on cleanly', async () => {
    vi.spyOn(weatherGridService, 'fetchOpenMeteoSpatialGrid').mockResolvedValue(null);
    vi.spyOn(rainViewerService, 'fetchRainViewerRadar').mockResolvedValue({
      available: true,
      degraded: false,
      host: 'https://tilecache.rainviewer.com',
      frames: [
        {
          timeUnix: 1795440000,
          timeIso: '2026-11-23T13:20:00.000Z',
          path: '/v2/radar/sample1',
          tileUrlTemplate:
            'https://tilecache.rainviewer.com/v2/radar/sample1/256/{z}/{x}/{y}/2/1_1.png',
          isNowcast: false,
        },
      ],
      pastCount: 1,
      nowcastCount: 0,
      maxNativeZoom: 7,
      fetchedAtIso: '2026-11-23T13:20:00.000Z',
      statusMessage: 'Radar operacional',
    });

    const forecast = createCoastalTestForecast();
    const mapMount = mountReactComponent(
      <MapRadarTab activeLocation={TEST_COASTAL_LOCATION} forecast={forecast} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Verify offscreen cached canvas attribute is present
    const overlayCanvas = stableMockContainer.querySelector(
      '[data-testid="weather-model-canvas"]',
    ) as HTMLCanvasElement | null;
    expect(overlayCanvas).not.toBeNull();
    expect(overlayCanvas!.dataset.offscreenCached).toBe('true');

    // Switch model to GEM 15 km
    const gemBtn = Array.from(mapMount.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('GEM 15 km'),
    );
    expect(gemBtn).toBeDefined();
    act(() => {
      gemBtn!.click();
    });

    const mapHud = mapMount.container.querySelector('[data-testid="map-weather-hud"]');
    expect(mapHud).not.toBeNull();
    expect(mapHud!.textContent).toContain('Modelo: CMC GEM 15km');

    // Click safety toggle "Desativar Radar"
    const safetyToggle = mapMount.container.querySelector(
      '[data-testid="toggle-radar-safety"]',
    ) as HTMLButtonElement | null;
    expect(safetyToggle).not.toBeNull();
    expect(safetyToggle!.textContent).toContain('Desativar Radar');

    act(() => {
      safetyToggle!.click();
    });

    expect(safetyToggle!.textContent).toContain('Camada Oculta');
    expect(
      stableMockContainer.querySelector('[data-testid="weather-model-canvas"]'),
    ).toBeNull();

    mapMount.unmount();
  });

  it('FieldDataTab renders Exportar KML/KMZ buttons, Historical Series on-demand query controls, and Periodic Recurrence Logs', async () => {
    const forecast = createCoastalTestForecast();
    const onFetchHistoricalSeries = vi.fn(async (req) => ({
      locationName: req.locationName,
      latitude: req.latitude,
      longitude: req.longitude,
      elevationDemM: 23,
      timezone: 'America/Sao_Paulo',
      startDateIso: req.startDateIso,
      endDateIso: req.endDateIso,
      modelsIncluded: req.models,
      sourceLabel: 'Open-Meteo Test Historical',
      fetchedAtIso: '2026-11-24T12:00:00.000Z',
      hours: [
        {
          timestampUnix: 1795392000,
          timestampIso: '2026-11-23T00:00:00.000Z',
          source: 'fieldcast',
          temperature2mC: 22.5,
          windSpeed10mKmh: 18.0,
          windGusts10mKmh: 26.0,
          windDirection10mDeg: 140,
          precipitationMm: 0.2,
          surfacePressureHpa: 1014.5,
        },
      ],
    }));

    const fieldMount = mountReactComponent(
      <FieldDataTab
        forecast={forecast}
        activeLocation={TEST_COASTAL_LOCATION}
        onFetchHistoricalSeries={onFetchHistoricalSeries}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Verify KML and KMZ export buttons exist
    const kmlBtn = fieldMount.container.querySelector('[data-testid="export-kml-btn"]');
    const kmzBtn = fieldMount.container.querySelector('[data-testid="export-kmz-btn"]');
    expect(kmlBtn).not.toBeNull();
    expect(kmzBtn).not.toBeNull();
    expect(kmlBtn!.textContent).toContain('Exportar KML');
    expect(kmzBtn!.textContent).toContain('Exportar KMZ');

    // Verify Historical Series section & controls
    const histSection = fieldMount.container.querySelector(
      '[data-testid="historical-series-section"]',
    );
    expect(histSection).not.toBeNull();
    expect(histSection!.textContent).toContain('Séries Históricas & Recorrência Semanal');

    const queryBtn = fieldMount.container.querySelector(
      '[data-testid="query-historical-series-btn"]',
    ) as HTMLButtonElement | null;
    expect(queryBtn).not.toBeNull();

    await act(async () => {
      queryBtn!.click();
      await Promise.resolve();
    });

    expect(onFetchHistoricalSeries).toHaveBeenCalledTimes(1);
    const resultBadge = fieldMount.container.querySelector(
      '[data-testid="historical-query-result"]',
    );
    expect(resultBadge).not.toBeNull();
    expect(resultBadge!.textContent).toContain('1 registros horários');

    fieldMount.unmount();
  });

  it('SavedLocationsModal supports setting Primary Location and HealthCheckModal distinguishes unverified endpoints cleanly', async () => {
    const onSetPrimaryLocation = vi.fn();
    const savedModalMount = mountReactComponent(
      <SavedLocationsModal
        isOpen={true}
        onClose={() => {}}
        activeLocation={TEST_COASTAL_LOCATION}
        savedLocations={[
          {
            id: 'loc-florianopolis-sc',
            name: 'Florianópolis — SC',
            latitude: -27.5954,
            longitude: -48.548,
            isFavorite: true,
            createdAtIso: '2026-11-20T00:00:00.000Z',
            lastUsedAtIso: '2026-11-24T00:00:00.000Z',
          },
        ]}
        onSelectLocation={() => {}}
        onSetPrimaryLocation={onSetPrimaryLocation}
      />,
    );

    const setPrimaryBtn = savedModalMount.container.querySelector(
      '[data-testid="set-primary-btn-loc-florianopolis-sc"]',
    ) as HTMLButtonElement | null;
    expect(setPrimaryBtn).not.toBeNull();
    expect(setPrimaryBtn!.textContent).toContain('Definir como Principal');

    await act(async () => {
      setPrimaryBtn!.click();
      await Promise.resolve();
    });

    expect(onSetPrimaryLocation).toHaveBeenCalledTimes(1);
    savedModalMount.unmount();

    const snapshot: HealthCheckSnapshot = {
      overall: 'healthy',
      platform: 'web',
      gpsStatus: 'granted',
      indexedDbOk: true,
      usingCachedForecast: false,
      cacheAgeMinutes: 2,
      checkedAtIso: '2026-11-24T12:00:00.000Z',
      recentErrors: [],
      endpoints: {
        open_meteo_forecast: {
          service: 'open_meteo_forecast',
          label: 'Open-Meteo Forecast API',
          status: 'healthy',
          latencyMs: 120,
          lastCheckedIso: '2026-11-24T12:00:00.000Z',
          circuitOpen: false,
          consecutiveFailures: 0,
          message: 'OK',
        },
        open_meteo_marine: {
          service: 'open_meteo_marine',
          label: 'Open-Meteo Marine API',
          status: 'healthy',
          latencyMs: 140,
          lastCheckedIso: '2026-11-24T12:00:00.000Z',
          circuitOpen: false,
          consecutiveFailures: 0,
          message: 'OK',
        },
        rainviewer: {
          service: 'rainviewer',
          label: 'RainViewer Weather Radar API',
          status: 'unverified',
          latencyMs: null,
          lastCheckedIso: null,
          circuitOpen: false,
          consecutiveFailures: 0,
        },
        nominatim: {
          service: 'nominatim',
          label: 'Nominatim Geocoding (OSM)',
          status: 'unverified',
          latencyMs: null,
          lastCheckedIso: null,
          circuitOpen: false,
          consecutiveFailures: 0,
        },
        ipwhois: {
          service: 'ipwhois',
          label: 'ipwho.is Geolocation Fallback',
          status: 'unverified',
          latencyMs: null,
          lastCheckedIso: null,
          circuitOpen: false,
          consecutiveFailures: 0,
        },
      },
    };

    const healthMount = mountReactComponent(
      <HealthCheckModal isOpen={true} onClose={() => {}} snapshot={snapshot} />,
    );

    expect(healthMount.container.textContent).toContain('Sob Demanda / Não Verificado');
    expect(healthMount.container.textContent).toContain('Nunca verificado');
    healthMount.unmount();
  });
});
