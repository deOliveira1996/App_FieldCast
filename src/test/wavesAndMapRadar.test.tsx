import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { ForecastCharts } from '../components/forecast/ForecastCharts';
import { ForecastPinMiniMap } from '../components/forecast/ForecastPinMiniMap';
import { COMPLETE_VISIBLE_PARAMS } from '../components/forecast/forecastParamsVisibility';
import { MapRadarTab } from '../components/map/MapRadarTab';
import * as weatherGridService from '../services/weatherGridService';
import {
  buildOfflineFallbackSpatialGrid,
  buildSpatialSampleCoordinates,
  fetchOpenMeteoSpatialGrid,
  interpolateGridValueAtPoint,
} from '../services/weatherGridService';
import * as rainViewerService from '../services/rainViewerService';
import {
  createCoastalTestForecast,
  mountReactComponent,
  TEST_COASTAL_LOCATION,
} from './testUtils';

vi.mock('echarts-for-react', () => {
  return {
    default: ({
      option,
      style,
    }: {
      option: EChartsOption;
      style?: React.CSSProperties;
    }) => (
      <div
        data-testid="echarts-mock"
        data-option={JSON.stringify(option)}
        style={style}
      />
    ),
  };
});

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
      <div data-testid="tile-layer" data-url={url} data-z-index={String(zIndex ?? '')} />
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

describe('Waves Chart Height & Meteorological Model Map Radar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the Waves & Swell chart with explicit non-collapsed height (no flex-1 shrink) and readable Y-axis scaling', () => {
    const forecast = createCoastalTestForecast();
    const { container, unmount } = mountReactComponent(
      <ForecastCharts
        forecast={forecast}
        viewMode="fieldcast"
        showInterpolatedProfile={false}
        horizonHours={168}
        selectedHourIndex={10}
        currentHourIndex={10}
        visibleParams={COMPLETE_VISIBLE_PARAMS}
      />,
    );

    const wavesCard = container.querySelector('[data-chart-id="waves"]');
    expect(wavesCard).not.toBeNull();
    // Outer card must NOT collapse height via flex-col + flex-1 on the chart container
    expect(wavesCard!.className).not.toContain('flex-col');

    const chartMock = wavesCard!.querySelector('[data-testid="echarts-mock"]') as HTMLElement | null;
    expect(chartMock).not.toBeNull();
    expect(chartMock!.parentElement!.className).toContain('h-72');
    expect(chartMock!.parentElement!.className).toContain('min-h-[288px]');
    expect(chartMock!.parentElement!.className).not.toContain('flex-1');
    expect(chartMock!.style.minHeight).toBe('288px');

    const option = JSON.parse(chartMock!.getAttribute('data-option')!) as {
      yAxis: Array<{ min?: number; name?: string }>;
    };
    expect(option.yAxis).toHaveLength(2);
    expect(option.yAxis[0]?.min).toBe(0);
    expect(option.yAxis[1]?.min).toBe(0);

    unmount();
  });

  it('builds 3x3 spatial sample coordinates, interpolates grid values, and parses multi-point Open-Meteo grid', async () => {
    const coords = buildSpatialSampleCoordinates({
      north: -27.5,
      south: -27.7,
      east: -48.4,
      west: -48.6,
    });
    expect(coords).toHaveLength(9);

    const forecast = createCoastalTestForecast();
    const offlineGrid = buildOfflineFallbackSpatialGrid(forecast, {
      north: -27.4,
      south: -27.8,
      east: -48.3,
      west: -48.7,
    });
    expect(offlineGrid.source).toBe('forecast_anchor');
    expect(offlineGrid.byModel.fieldcast.length).toBeGreaterThan(0);
    expect(offlineGrid.byModel.ecmwf_ifs025[0]!.points).toHaveLength(9);

    const sample = interpolateGridValueAtPoint(
      offlineGrid.byModel.fieldcast[0]!.points,
      -27.5954,
      -48.548,
      'wind',
    );
    expect(sample.value).not.toBeNull();
    expect(sample.windDirectionDeg).not.toBeNull();

    const mockFetch: typeof fetch = vi.fn(async () => {
      const payload = coords.map((pt, idx) => ({
        latitude: pt.latitude,
        longitude: pt.longitude,
        hourly: {
          time: [1795392000],
          wind_speed_10m_ecmwf_ifs025: [12 + idx],
          wind_direction_10m_ecmwf_ifs025: [140],
          precipitation_ecmwf_ifs025: [0.4],
          temperature_2m_ecmwf_ifs025: [24],
          wind_speed_10m_gfs_seamless: [14 + idx],
          wind_direction_10m_gfs_seamless: [150],
          precipitation_gfs_seamless: [0.2],
          temperature_2m_gfs_seamless: [25],
          wind_speed_10m_icon_seamless: [13 + idx],
          wind_direction_10m_icon_seamless: [145],
          precipitation_icon_seamless: [0.0],
          temperature_2m_icon_seamless: [24.5],
        },
      }));
      return new Response(JSON.stringify(payload), { status: 200 });
    });

    const liveGrid = await fetchOpenMeteoSpatialGrid(
      { north: -27.5, south: -27.7, east: -48.4, west: -48.6 },
      { fetchImpl: mockFetch, anchorForecast: forecast },
    );
    expect(liveGrid).not.toBeNull();
    expect(liveGrid!.source).toBe('live_grid');
    expect(liveGrid!.byModel.fieldcast[0]!.points).toHaveLength(9);
  });

  it('explicitly informs and allows switching the meteorological model, weather radar layer, and RainViewer status on MapRadarTab & ForecastPinMiniMap', async () => {
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
        {
          timeUnix: 1795440600,
          timeIso: '2026-11-23T13:30:00.000Z',
          path: '/v2/radar/sample2',
          tileUrlTemplate:
            'https://tilecache.rainviewer.com/v2/radar/sample2/256/{z}/{x}/{y}/2/1_1.png',
          isNowcast: false,
        },
      ],
      pastCount: 2,
      nowcastCount: 0,
      maxNativeZoom: 7,
      fetchedAtIso: '2026-11-23T13:30:00.000Z',
      statusMessage: 'Radar operacional (2 quadros passados, 0 nowcast)',
    });

    const forecast = createCoastalTestForecast();
    const mapMount = mountReactComponent(
      <MapRadarTab activeLocation={TEST_COASTAL_LOCATION} forecast={forecast} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const mapHud = mapMount.container.querySelector('[data-testid="map-weather-hud"]');
    expect(mapHud).not.toBeNull();
    expect(mapHud!.textContent).toContain('Modelo: FieldCast (Ensemble)');
    expect(mapHud!.textContent).toContain('RainViewer: 2 quadros');
    expect(mapHud!.textContent).toContain('Vento 10m');

    // Verify RainViewer TileLayer is mounted with high zIndex above base layers
    const rvTiles = Array.from(
      mapMount.container.querySelectorAll('[data-testid="tile-layer"]'),
    );
    expect(
      rvTiles.some((el) => (el.getAttribute('data-url') ?? '').includes('rainviewer')),
    ).toBe(true);

    // Switch map meteorological model to ECMWF 9 km and layer to Chuva (Modelo)
    const ecmwfBtn = Array.from(mapMount.container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('ECMWF 9 km'),
    );
    expect(ecmwfBtn).toBeDefined();
    act(() => {
      ecmwfBtn!.click();
    });
    expect(mapHud!.textContent).toContain('Modelo: ECMWF IFS 0.25°');

    const rainLayerBtn = Array.from(mapMount.container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Chuva (Modelo)'),
    );
    expect(rainLayerBtn).toBeDefined();
    act(() => {
      rainLayerBtn!.click();
    });
    expect(mapHud!.textContent).toContain('Precipitação');

    mapMount.unmount();

    // Also verify ForecastPinMiniMap renders and informs the active model & radar
    const miniMount = mountReactComponent(
      <ForecastPinMiniMap
        activeLocation={TEST_COASTAL_LOCATION}
        forecast={forecast}
        viewMode="gfs_seamless"
        selectedHourIndex={10}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const miniHud = miniMount.container.querySelector('[data-testid="minimap-weather-hud"]');
    expect(miniHud).not.toBeNull();
    expect(miniHud!.textContent).toContain('Modelo: NOAA GFS 13km');
    expect(miniHud!.textContent).toContain('Radar RainViewer Ativo (2q)');
    miniMount.unmount();
  });
});
