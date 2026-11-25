import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { CollapsibleModule } from '../components/common';
import { ModelComparisonTab } from '../components/comparison';
import { WindguruTable } from '../components/forecast/WindguruTable';
import { AppShell } from '../components/layout';
import { MapRadarTab } from '../components/map/MapRadarTab';
import { TechnicalReportsPanel } from '../components/reports';
import { SettingsTab } from '../components/settings';
import { DailySummaryTab } from '../components/summary';
import { UnitsProvider, useUnits } from '../context/UnitsContext';
import {
  fetchExtended16DayForecastSeries,
  fetchHybridPast15DaysSeries,
} from '../services/historicalWeatherService';
import { DEFAULT_ACTIVITY_QUALITY_THRESHOLDS, computeCoastalNavigationQuality, computeDailyFieldQuality } from '../utils/qualityScores';
import { computeDroneFlightAssessment, DEFAULT_DRONE_FLIGHT_LIMITS } from '../utils/droneFlightIndex';
import { evaluateSafeWindow } from '../utils/operationalAlerts';
import {
  computeForecastPeriodSummary,
  computeHistoricalPeriodSummary,
  extractSingleDayPointLog,
} from '../utils/periodReportAnalytics';
import {
  convertPrecipitation,
  convertPressure,
  convertTemperature,
  convertWaveHeight,
  convertWindSpeed,
  DEFAULT_UNIT_PREFERENCES,
  formatTemp,
  formatWind,
  precipitationToMm,
  pressureToHpa,
  saveUnitPreferences,
  temperatureToC,
  waveHeightToM,
  windSpeedToKmh,
} from '../utils/units';
import {
  createCoastalTestForecast,
  createTestHealthSnapshot,
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
  getNorth: () => -22.7,
  getSouth: () => -23.1,
  getEast: () => -42.9,
  getWest: () => -43.5,
};
const stableMockContainer = document.createElement('div');
const stableMockSize = { x: 640, y: 400 };
const stableMockMap = {
  invalidateSize: vi.fn(),
  getCenter: () => ({ lat: -22.9, lng: -43.2 }),
  getBounds: () => stableMockBounds,
  getZoom: () => 9,
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

describe('FieldCast V4.1 — Units, Collapsible UI, Stepper, Map Streamlines, Checkboxes & 15d Period Reports', () => {
  const clickEl = (el: Element | null) => {
    if (!el) throw new Error('Expected element to exist for click');
    (el as HTMLElement).click();
  };

  const setInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  beforeEach(() => {
    localStorage.clear();
    saveUnitPreferences(DEFAULT_UNIT_PREFERENCES);
    setViewportSize(1280, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    saveUnitPreferences(DEFAULT_UNIT_PREFERENCES);
  });

  it('converts wind, temperature, wave, pressure, and precipitation units accurately with inverse roundtrips', () => {
    expect(convertWindSpeed(36, 'ms')).toBeCloseTo(10, 4);
    expect(windSpeedToKmh(10, 'ms')).toBeCloseTo(36, 4);
    expect(convertWindSpeed(18.52, 'kt')).toBeCloseTo(10, 4);
    expect(windSpeedToKmh(10, 'kt')).toBeCloseTo(18.52, 4);
    expect(convertWindSpeed(16.09344, 'mph')).toBeCloseTo(10, 4);
    expect(windSpeedToKmh(10, 'mph')).toBeCloseTo(16.09344, 4);

    expect(convertTemperature(25, 'f')).toBeCloseTo(77, 4);
    expect(temperatureToC(77, 'f')).toBeCloseTo(25, 4);

    expect(convertWaveHeight(2, 'ft')).toBeCloseTo(6.56168, 3);
    expect(waveHeightToM(6.56168, 'ft')).toBeCloseTo(2, 3);

    expect(convertPressure(1013.25, 'inhg')).toBeCloseTo(29.9212, 3);
    expect(pressureToHpa(29.9212, 'inhg')).toBeCloseTo(1013.25, 1);

    expect(convertPrecipitation(25.4, 'in')).toBeCloseTo(1, 4);
    expect(precipitationToMm(1, 'in')).toBeCloseTo(25.4, 4);

    expect(formatWind(36, 'ms', 1)).toBe('10.0 m/s');
    expect(formatTemp(25, 'f', 1)).toBe('77.0°F');
  });

  it('syncs standalone useUnits() listeners and UnitsProvider reactively', async () => {
    function Probe(): React.ReactElement {
      const { units, setWindUnit, setTemperatureUnit } = useUnits();
      return (
        <div>
          <span data-testid="probe-units">
            {units.wind}|{units.temperature}
          </span>
          <button type="button" data-testid="probe-kt" onClick={() => setWindUnit('kt')}>
            kt
          </button>
          <button type="button" data-testid="probe-f" onClick={() => setTemperatureUnit('f')}>
            F
          </button>
        </div>
      );
    }

    const mounted = await mountReactComponent(
      <UnitsProvider>
        <Probe />
      </UnitsProvider>,
    );

    expect(mounted.container.querySelector('[data-testid="probe-units"]')?.textContent).toBe('kmh|c');
    await act(async () => {
      clickEl(mounted.container.querySelector('[data-testid="probe-kt"]'));
      clickEl(mounted.container.querySelector('[data-testid="probe-f"]'));
    });
    expect(mounted.container.querySelector('[data-testid="probe-units"]')?.textContent).toBe('kt|f');
    mounted.unmount();
  });

  it('renders CollapsibleModule with keepMounted DOM preservation and eye toggle', async () => {
    const mounted = await mountReactComponent(
      <CollapsibleModule title="Módulo Teste" defaultOpen={false} keepMounted={true} testId="cm-test">
        <button type="button" data-testid="cm-inner-btn">
          Interno
        </button>
      </CollapsibleModule>,
    );

    const toggle = mounted.container.querySelector('[data-testid="cm-test-toggle"]')!;
    const body = mounted.container.querySelector('[data-testid="cm-inner-btn"]')!.parentElement!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.className).toContain('hidden');
    expect(mounted.container.querySelector('[data-testid="cm-inner-btn"]')).not.toBeNull();

    await act(async () => {
      clickEl(toggle);
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.className).not.toContain('hidden');
    mounted.unmount();
  });

  it('retracts desktop AppShell sidebar cleanly to 0px while keeping arrow expand toggle', async () => {
    const mounted = await mountReactComponent(
      <AppShell
        activeTab="forecast"
        onTabChange={() => {}}
        theme="light"
        onToggleTheme={() => {}}
        activeLocation={TEST_COASTAL_LOCATION}
        savedLocations={[]}
        healthSnapshot={createTestHealthSnapshot()}
        onSelectLocation={() => {}}
      >
        <div>Conteúdo</div>
      </AppShell>,
    );

    const aside = mounted.container.querySelector('aside')!;
    expect(aside.className).toContain('w-56');

    const collapseBtn = mounted.container.querySelector('[data-testid="sidebar-collapse-toggle"]')!;
    await act(async () => {
      clickEl(collapseBtn);
    });

    expect(aside.className).toContain('w-0');
    // O botão flutuante para reabrir permanece disponível
    const reopenBtn = mounted.container.querySelector('[data-testid="sidebar-collapse-toggle"]')!;
    expect(reopenBtn).not.toBeNull();
    mounted.unmount();
  });

  it('removes ForecastPinMiniMap from DailySummaryTab and preserves collapsible modules', async () => {
    const forecast = createCoastalTestForecast();
    const mounted = await mountReactComponent(
      <DailySummaryTab
        forecast={forecast}
        activeLocation={TEST_COASTAL_LOCATION}
        onNavigateTab={() => {}}
      />,
    );

    expect(mounted.container.querySelector('[data-testid="forecast-pin-minimap"]')).toBeNull();
    expect(mounted.container.querySelector('[data-testid="hourly-24h-strip"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="daily-7d-list"]')).not.toBeNull();
    mounted.unmount();
  });

  it('scrolls WindguruTable horizontally via scrollLeft without scrollIntoView and syncs ModelComparisonTab stepper', async () => {
    const forecast = createCoastalTestForecast();
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    const wg = await mountReactComponent(
      <WindguruTable
        forecast={forecast}
        viewMode="fieldcast"
        showInterpolatedProfile={false}
        selectedHourIndex={0}
        onSelectHourIndex={() => {}}
      />,
    );
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(wg.container.querySelector('[data-testid="windguru-hud-toggle"]')).not.toBeNull();
    wg.unmount();

    const cmp = await mountReactComponent(
      <ModelComparisonTab forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />,
    );
    const activeBtn = cmp.container.querySelector('[data-testid="matrix-stepper-active-time"]')!;
    const initialText = activeBtn.textContent ?? '';
    expect(initialText).toContain('Agora');

    const nextHourBtn = cmp.container.querySelector('button[aria-label="Próxima hora na matriz"]')!;
    await act(async () => {
      clickEl(nextHourBtn);
    });
    const steppedText = activeBtn.textContent ?? '';
    expect(steppedText).toContain('↺ Agora');
    expect(steppedText).not.toBe(initialText);

    await act(async () => {
      clickEl(activeBtn);
    });
    expect(activeBtn.textContent).toContain('Agora (');
    cmp.unmount();
  });

  it('defaults MapRadarTab drawer closed, adds HUD visibility toggle and wind streamline toggle', async () => {
    const forecast = createCoastalTestForecast();
    const mounted = await mountReactComponent(
      <MapRadarTab
        forecast={forecast}
        activeLocation={TEST_COASTAL_LOCATION}
        isDark={false}
      />,
    );

    const drawer = mounted.container.querySelector('[data-testid="map-windy-drawer"]')!;
    expect(drawer.className).toContain('hidden');

    const hudToggle = mounted.container.querySelector('[data-testid="map-hud-toggle-btn"]')!;
    const hudEl = mounted.container.querySelector('[data-testid="map-weather-hud"]')!;
    expect(hudEl.className).not.toContain('hidden');
    await act(async () => {
      clickEl(hudToggle);
    });
    expect(mounted.container.querySelector('[data-testid="map-weather-hud"]')?.className).toContain('hidden');

    const windToggle = mounted.container.querySelector('[data-testid="map-wind-flow-toggle"]')!;
    expect(windToggle.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      clickEl(windToggle);
    });
    expect(windToggle.getAttribute('aria-pressed')).toBe('false');
    mounted.unmount();
  });

  it('respects optional threshold checkboxes with zero penalty when disabled and exposes unit/checkbox UI in SettingsTab', async () => {
    const forecast = createCoastalTestForecast();
    const hour = {
      ...forecast.hours[0]!,
      thunderstormRisk: 'none' as const,
      barometricSquallRisk: false,
      fogRisk: false,
    };
    hour.windSpeed10m = { ...hour.windSpeed10m, mean: 80 };
    hour.windGusts10m = { ...hour.windGusts10m, mean: 95 };
    hour.precipitationProbabilityPct = { ...hour.precipitationProbabilityPct, mean: 95 };
    hour.precipitationMm = { ...hour.precipitationMm, mean: 0 };
    hour.temperature2mC = { ...hour.temperature2mC, mean: 42 };
    hour.capeJkg = { mean: 2200, min: 2200, max: 2200, stdDev: 0, sampleCount: 1 };
    hour.visibilityM = { ...hour.visibilityM, mean: 500 };
    if (hour.marine) {
      hour.marine = { ...hour.marine, waveHeight: 4.5, swellWaveHeight: 4.0, oceanCurrentVelocity: 8 };
    }

    const safeAllOff = evaluateSafeWindow(
      {
        windSpeed10mKmh: 80,
        windGusts10mKmh: 95,
        waveHeightM: 4.5,
        precipProbPct: 95,
      },
      {
        maxWindKmh: 28,
        maxGustKmh: 45,
        maxWaveM: 1.5,
        maxPrecipProbPct: 40,
        enabled: {
          maxWindKmh: false,
          maxGustKmh: false,
          maxWaveM: false,
          maxPrecipProbPct: false,
        },
      },
    );
    expect(safeAllOff.status).toBe('green');

    const dailyAllOff = computeDailyFieldQuality(hour, {
      ...DEFAULT_ACTIVITY_QUALITY_THRESHOLDS,
      enabledDailyField: {
        idealMinTempC: false,
        idealMaxTempC: false,
        maxWindKmh: false,
        maxGustKmh: false,
        maxPrecipProbPct: false,
        maxCapeJkg: false,
      },
    });
    expect(dailyAllOff.score).toBe(100);

    const coastalAllOff = computeCoastalNavigationQuality(hour, true, {
      ...DEFAULT_ACTIVITY_QUALITY_THRESHOLDS,
      enabledCoastalNavigation: {
        maxWindKmh: false,
        maxGustKmh: false,
        maxWaveM: false,
        maxCurrentKmh: false,
        minVisibilityKm: false,
      },
    });
    expect(coastalAllOff.score).toBe(100);

    const droneAllOff = computeDroneFlightAssessment(
      hour,
      8,
      {
        ...DEFAULT_DRONE_FLIGHT_LIMITS,
        enabled: {
          maxWindKmh: false,
          maxGustKmh: false,
          maxKpIndex: false,
          maxPrecipMm: false,
          minVisibilityKm: false,
        },
      },
    );
    expect(droneAllOff.score).toBeGreaterThanOrEqual(85);

    const mounted = await mountReactComponent(
      <UnitsProvider>
        <SettingsTab forecast={forecast} />
      </UnitsProvider>,
    );
    expect(mounted.container.querySelector('[data-testid="settings-units-module"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="settings-permissions-module"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="enable-rule-max-wind"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="toggle-daily-maxWindKmh"]')).not.toBeNull();

    await act(async () => {
      clickEl(mounted.container.querySelector('[data-testid="unit-wind-kt"]'));
      clickEl(mounted.container.querySelector('[data-testid="unit-temp-f"]'));
    });
    expect(mounted.container.textContent).toContain('kt');
    expect(mounted.container.textContent).toContain('°F');
    mounted.unmount();
  });

  it('computes 4 daily periods and single-day lookup and fuses hybrid 15d past / extended 16d future services', async () => {
    const forecast = createCoastalTestForecast();
    const futureReport = computeForecastPeriodSummary(forecast.hours, forecast.timezone);
    expect(futureReport.periods.map((p) => p.periodId)).toEqual([
      'madrugada',
      'manha',
      'tarde',
      'noite',
    ]);

    const baseUnix = Math.floor(Date.UTC(2026, 4, 1, 0, 0, 0) / 1000);
    const mockHours = Array.from({ length: 48 }, (_, i) => ({
      timestampUnix: baseUnix + i * 3600,
      timestampIso: new Date((baseUnix + i * 3600) * 1000).toISOString(),
      source: i < 24 ? 'Open-Meteo ERA5 Reanálise' : 'Open-Meteo NWP Multi-Modelo',
      temperature2mC: 20 + (i % 24 >= 6 && i % 24 <= 17 ? 5 : 0),
      dewPoint2mC: 16,
      relativeHumidity2mPct: 75,
      windSpeed10mKmh: i % 24 === 14 ? 28 : 12,
      windGusts10mKmh: 34,
      windDirection10mDeg: 135,
      precipitationMm: i % 24 === 9 ? 2.5 : 0,
      surfacePressureHpa: 1014,
    }));

    const pastSummary = computeHistoricalPeriodSummary(mockHours, 'UTC');
    expect(pastSummary.totalDays).toBe(2);
    expect(pastSummary.periods.find((p) => p.periodId === 'manha')?.totalPrecipMm).toBeCloseTo(5, 2);

    const pointLog = extractSingleDayPointLog(mockHours, '2026-05-01', 'UTC');
    expect(pointLog.found).toBe(true);
    expect(pointLog.hoursCount).toBe(24);
    expect(pointLog.totalPrecipMm).toBeCloseTo(2.5, 2);

    // Testa fetchHybridPast15DaysSeries e fetchExtended16DayForecastSeries com mock fetch
    const now = new Date('2026-05-20T12:00:00Z');
    const era5Unix = Math.floor(new Date('2026-05-06T12:00:00Z').getTime() / 1000);
    const nwpUnix = Math.floor(new Date('2026-05-18T12:00:00Z').getTime() / 1000);
    const futUnix = Array.from({ length: 16 }, (_, d) =>
      Math.floor(new Date('2026-05-20T12:00:00Z').getTime() / 1000) + d * 86_400,
    );

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('archive-api.open-meteo.com')) {
        return new Response(
          JSON.stringify({
            latitude: -22.9,
            longitude: -43.2,
            elevation: 15,
            timezone: 'UTC',
            hourly: {
              time: [era5Unix],
              temperature_2m: [24.2],
              dew_point_2m: [18.0],
              wind_speed_10m: [14],
              wind_gusts_10m: [21],
              wind_direction_10m: [120],
              precipitation: [0.5],
              surface_pressure: [1015],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('forecast_days=16')) {
        return new Response(
          JSON.stringify({
            latitude: -22.9,
            longitude: -43.2,
            elevation: 15,
            utc_offset_seconds: 0,
            timezone: 'UTC',
            hourly: {
              time: futUnix,
              temperature_2m_ecmwf_ifs025: futUnix.map(() => 25),
              temperature_2m_gfs_seamless: futUnix.map(() => 26),
              wind_speed_10m_gfs_seamless: futUnix.map(() => 18),
              precipitation_gfs_seamless: futUnix.map((_, i) => (i === 10 ? 3.2 : 0)),
              surface_pressure_gfs_seamless: futUnix.map(() => 1013),
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          latitude: -22.9,
          longitude: -43.2,
          elevation: 15,
          utc_offset_seconds: 0,
          timezone: 'UTC',
          hourly: {
            time: [nwpUnix],
            temperature_2m_ecmwf_ifs025: [26.4],
            wind_speed_10m_ecmwf_ifs025: [16],
            wind_gusts_10m_ecmwf_ifs025: [24],
            wind_direction_10m_ecmwf_ifs025: [110],
            precipitation_ecmwf_ifs025: [0],
            surface_pressure_ecmwf_ifs025: [1014],
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const hybrid = await fetchHybridPast15DaysSeries(
      { locationName: 'Rio Teste', latitude: -22.9, longitude: -43.2 },
      { fetchImpl: mockFetch, now },
    );
    expect(hybrid.series.hours.length).toBe(2);
    expect(hybrid.provenanceByDate['2026-05-06']).toContain('ERA5');
    expect(hybrid.provenanceByDate['2026-05-18']).toContain('NWP');

    const ext16 = await fetchExtended16DayForecastSeries(
      { locationName: 'Rio Teste', latitude: -22.9, longitude: -43.2 },
      { fetchImpl: mockFetch, now },
    );
    expect(ext16.hours.length).toBe(16);
    expect(ext16.provenanceByDate['2026-05-20']).toContain('Multi-Modelo');
    expect(ext16.provenanceByDate['2026-05-30']).toContain('NOAA GFS');

    const reportsMounted = await mountReactComponent(
      <UnitsProvider>
        <TechnicalReportsPanel
          forecast={forecast}
          activeLocation={TEST_COASTAL_LOCATION}
          onFetchHistoricalSeries={async () => ({
            locationName: TEST_COASTAL_LOCATION.name,
            latitude: TEST_COASTAL_LOCATION.latitude,
            longitude: TEST_COASTAL_LOCATION.longitude,
            elevationDemM: 12,
            timezone: 'UTC',
            startDateIso: '2026-05-01',
            endDateIso: '2026-05-02',
            modelsIncluded: ['fieldcast'],
            sourceLabel: 'Open-Meteo ERA5 Mock',
            fetchedAtIso: new Date().toISOString(),
            hours: mockHours,
          })}
        />
      </UnitsProvider>,
    );

    expect(reportsMounted.container.querySelector('[data-testid="report-past-15d-module"]')).not.toBeNull();
    expect(reportsMounted.container.querySelector('[data-testid="report-future-16d-module"]')).not.toBeNull();
    await act(async () => {
      clickEl(reportsMounted.container.querySelector('[data-testid="report-past-15d-btn"]'));
    });
    expect(reportsMounted.container.querySelector('[data-testid="report-past-periods-grid"]')).not.toBeNull();

    const dateInput = reportsMounted.container.querySelector('[data-testid="report-point-date-input"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(dateInput, '2026-05-01');
    });
    await act(async () => {
      clickEl(reportsMounted.container.querySelector('[data-testid="report-point-date-btn"]'));
    });
    const pointResult = reportsMounted.container.querySelector('[data-testid="report-point-date-result"]');
    expect(pointResult?.textContent).toContain('2026-05-01');
    reportsMounted.unmount();
  });
});
