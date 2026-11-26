import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { AUTO_REFRESH_INTERVAL_MS } from '../App';
import { NumericInput } from '../components/common';
import { ForecastCharts } from '../components/forecast/ForecastCharts';
import { AppShell } from '../components/layout';
import { MapRadarTab } from '../components/map/MapRadarTab';
import { WeatherModelOverlayLayer } from '../components/map/WeatherModelOverlayLayer';
import { SettingsTab } from '../components/settings';
import { LocaleProvider, saveLocalePreference } from '../context/LocaleContext';
import { UnitsProvider, useUnits } from '../context/UnitsContext';
import { useSmartLocation } from '../hooks/useSmartLocation';
import {
  clearReverseGeocodeCache,
  resetNominatimRateLimiter,
  reverseGeocodeNominatim,
} from '../services/geocodingService';
import {
  clearNotificationLedger,
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '../services/notificationService';
import { exportAndDeliverFile } from '../services/platform/ShareService';
import type { WeatherGridPoint } from '../services/weatherGridService';
import { analyzeForecastScientifically } from '../utils/scientificAnalytics';
import {
  generateTechnicalReportDocument,
  generateTechnicalReportDocxBytes,
  generateTechnicalReportPdfBytes,
} from '../utils/technicalReportGenerator';
import { DEFAULT_UNIT_PREFERENCES, saveUnitPreferences } from '../utils/units';
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

const createdPanes: Record<string, HTMLElement> = {};
const stableMockContainer = document.createElement('div');
const stableMockBounds = {
  getNorth: () => -27.4,
  getSouth: () => -27.8,
  getEast: () => -48.3,
  getWest: () => -48.7,
};
const stableMockSize = { x: 640, y: 400 };
const stableMockMap = {
  invalidateSize: vi.fn(),
  getCenter: () => ({ lat: -27.5954, lng: -48.548 }),
  getBounds: () => stableMockBounds,
  getZoom: () => 10,
  setView: vi.fn(),
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  getContainer: () => stableMockContainer,
  getSize: () => stableMockSize,
  getPane: (name: string) => createdPanes[name],
  createPane: (name: string) => {
    const el = document.createElement('div');
    el.className = `leaflet-pane leaflet-${name}-pane`;
    createdPanes[name] = el;
    stableMockContainer.appendChild(el);
    return el;
  },
  containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
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
    Marker: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="leaflet-marker">{children}</div>
    ),
    Popup: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="leaflet-popup">{children}</div>
    ),
    Circle: () => null,
    CircleMarker: () => null,
    Rectangle: () => null,
    Polyline: () => null,
    useMap: () => stableMockMap,
    useMapEvents: () => null,
  };
});

function setControlledInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('FieldCast V4.2 — Polish, In-Place Edit, GPS Startup, NumericInput, PDF/DOCX, i18n, Units & Map Pane', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearNotificationLedger();
    clearReverseGeocodeCache();
    resetNominatimRateLimiter();
    saveLocalePreference('pt');
    saveUnitPreferences(DEFAULT_UNIT_PREFERENCES);
    setViewportSize(1280, 800);
    for (const key of Object.keys(createdPanes)) {
      delete createdPanes[key];
    }
    stableMockContainer.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    saveLocalePreference('pt');
    saveUnitPreferences(DEFAULT_UNIT_PREFERENCES);
  });

  it('edits custom alert rules in-place in SettingsTab while preserving rule id and count', () => {
    const forecast = createCoastalTestForecast();
    const initialPrefs = saveNotificationPreferences({
      masterEnabled: true,
      extremeEventsAutoEnabled: true,
      globalActiveWindow: { enabled: false, startHHMM: '06:00', endHHMM: '21:00' },
      updatedAtIso: '2026-11-26T10:00:00.000Z',
      rules: [
        {
          id: 'rule-fixed-id-1',
          name: 'Operação Costa',
          enabled: true,
          conditions: { maxWindKmh: 28 },
          timeWindow: { startHHMM: '06:00', endHHMM: '18:00', notifyFromHHMM: '06:30' },
          customTitle: 'Vento Alto ({hour})',
          customMessage: 'Vento {wind} km/h',
          createdAtIso: '2026-11-26T09:00:00.000Z',
        },
      ],
    });
    expect(initialPrefs.rules).toHaveLength(1);

    const mounted = mountReactComponent(<SettingsTab forecast={forecast} />);
    const editBtn = mounted.container.querySelector(
      '[data-testid="edit-rule-rule-fixed-id-1"]',
    ) as HTMLButtonElement;
    expect(editBtn).not.toBeNull();

    act(() => {
      editBtn.click();
    });

    const nameInput = mounted.container.querySelector(
      '[data-testid="rule-name-input"]',
    ) as HTMLInputElement;
    const windInput = mounted.container.querySelector(
      '[data-testid="rule-max-wind"]',
    ) as HTMLInputElement;
    const windCheck = mounted.container.querySelector(
      '[data-testid="enable-rule-max-wind"]',
    ) as HTMLInputElement;

    expect(nameInput.value).toBe('Operação Costa');
    expect(windInput.value).toBe('28');
    expect(windCheck.checked).toBe(true);
    expect(
      mounted.container.querySelector('[data-testid="cancel-edit-rule-btn"]'),
    ).not.toBeNull();

    act(() => {
      setControlledInputValue(nameInput, 'Operação Costa Atualizada');
      setControlledInputValue(windInput, '35');
    });

    const form = mounted.container.querySelector(
      '[data-testid="custom-alert-form"]',
    ) as HTMLFormElement;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const updatedPrefs = loadNotificationPreferences();
    expect(updatedPrefs.rules).toHaveLength(1);
    expect(updatedPrefs.rules[0]!.id).toBe('rule-fixed-id-1');
    expect(updatedPrefs.rules[0]!.name).toBe('Operação Costa Atualizada');
    expect(updatedPrefs.rules[0]!.conditions.maxWindKmh).toBe(35);
    expect(
      mounted.container.querySelector('[data-testid="saved-rule-rule-fixed-id-1"]')?.textContent,
    ).toContain('Operação Costa Atualizada');

    mounted.unmount();
  });

  it('auto-resolves GPS on mount (Tier 1) and preserves 1-hour interval + manual refresh button', async () => {
    expect(AUTO_REFRESH_INTERVAL_MS).toBe(3_600_000);

    const getGpsPositionFn = vi.fn().mockResolvedValue({
      latitude: -27.5954,
      longitude: -48.548,
      accuracyM: 12,
    });
    const reverseGeocodeFn = vi.fn().mockResolvedValue({
      friendlyLabel: 'Centro, Florianópolis',
    });

    function GpsProbe() {
      const { activeLocation, gpsStatus } = useSmartLocation({
        autoResolveOnMount: true,
        getGpsPositionFn,
        reverseGeocodeFn,
      });
      return (
        <div>
          <span data-testid="gps-probe-name">{activeLocation.name}</span>
          <span data-testid="gps-probe-origin">{activeLocation.origin}</span>
          <span data-testid="gps-probe-status">{gpsStatus}</span>
        </div>
      );
    }

    const probeMount = mountReactComponent(<GpsProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getGpsPositionFn).toHaveBeenCalledTimes(1);
    expect(reverseGeocodeFn).toHaveBeenCalledWith(-27.5954, -48.548);
    expect(probeMount.container.querySelector('[data-testid="gps-probe-origin"]')?.textContent).toBe(
      'gps',
    );
    expect(probeMount.container.querySelector('[data-testid="gps-probe-name"]')?.textContent).toBe(
      'Centro, Florianópolis',
    );
    expect(probeMount.container.querySelector('[data-testid="gps-probe-status"]')?.textContent).toBe(
      'granted',
    );
    probeMount.unmount();

    const onRefreshForecast = vi.fn();
    const shellMount = mountReactComponent(
      <AppShell
        activeTab="forecast"
        onTabChange={vi.fn()}
        theme="light"
        onToggleTheme={vi.fn()}
        activeLocation={TEST_COASTAL_LOCATION}
        savedLocations={[]}
        healthSnapshot={createTestHealthSnapshot()}
        onSelectLocation={vi.fn()}
        onRefreshForecast={onRefreshForecast}
      >
        <div>Conteúdo</div>
      </AppShell>,
    );

    const refreshBtn = shellMount.container.querySelector(
      '[data-testid="refresh-forecast-btn"]',
    ) as HTMLButtonElement;
    expect(refreshBtn).not.toBeNull();
    act(() => {
      refreshBtn.click();
    });
    expect(onRefreshForecast).toHaveBeenCalledTimes(1);
    shellMount.unmount();
  });

  it('allows NumericInput to clear to empty while focused, blocks e/+/letters, and clamps on blur', () => {
    const onValueChange = vi.fn();
    const onCommit = vi.fn();

    const mounted = mountReactComponent(
      <NumericInput
        data-testid="numeric-test-input"
        value={25}
        min={10}
        max={50}
        onValueChange={onValueChange}
        onCommit={onCommit}
      />,
    );

    const input = mounted.container.querySelector(
      '[data-testid="numeric-test-input"]',
    ) as HTMLInputElement;
    expect(input.value).toBe('25');

    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    const eEvent = new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true });
    const plusEvent = new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(eEvent);
      input.dispatchEvent(plusEvent);
    });
    expect(eEvent.defaultPrevented).toBe(true);
    expect(plusEvent.defaultPrevented).toBe(true);

    // Letters get stripped without snapping back to 25 while focused
    act(() => {
      setControlledInputValue(input, 'abc');
    });
    expect(input.value).toBe('');
    expect(onValueChange).toHaveBeenLastCalledWith('', null);

    // Below min clamps to 10 on blur
    act(() => {
      setControlledInputValue(input, '4');
    });
    expect(input.value).toBe('4');

    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value).toBe('10');
    expect(onCommit).toHaveBeenLastCalledWith(10);

    // Above max clamps to 50 on blur
    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      setControlledInputValue(input, '99');
    });
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value).toBe('50');
    expect(onCommit).toHaveBeenLastCalledWith(50);

    mounted.unmount();
  });

  it('formats Bairro, Município in reverseGeocodeNominatim, caches hits, and returns null offline', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          place_id: 4242,
          lat: '-27.5954',
          lon: '-48.5480',
          display_name: 'Centro, Florianópolis, Santa Catarina, Brasil',
          address: {
            suburb: 'Centro',
            city: 'Florianópolis',
            state: 'Santa Catarina',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const first = await reverseGeocodeNominatim(-27.5954, -48.548, {
      minIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(first).not.toBeNull();
    expect(first?.friendlyLabel).toBe('Centro, Florianópolis');
    expect(first?.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await reverseGeocodeNominatim(-27.5954, -48.548, {
      minIntervalMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(second).not.toBeNull();
    expect(second?.friendlyLabel).toBe('Centro, Florianópolis');
    expect(second?.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const offlineFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    const offlineResult = await reverseGeocodeNominatim(-15.7939, -47.8828, {
      minIntervalMs: 0,
      maxRetries: 0,
      fetchImpl: offlineFetch as unknown as typeof fetch,
    });
    expect(offlineResult).toBeNull();
  });

  it('generates valid PDF 1.4 and DOCX ZIP bytes and delivers with savedPathDisplay', async () => {
    const forecast = createCoastalTestForecast();
    const analysis = analyzeForecastScientifically(forecast, 'Florianópolis — SC', 'fieldcast');
    const doc = generateTechnicalReportDocument(analysis);

    const pdfBytes = generateTechnicalReportPdfBytes(doc);
    const pdfLatin1 = new TextDecoder('latin1').decode(pdfBytes);
    expect(pdfLatin1.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfLatin1.trimEnd().endsWith('%%EOF')).toBe(true);

    const docxBytes = generateTechnicalReportDocxBytes(doc);
    expect(docxBytes[0]).toBe(0x50); // 'P'
    expect(docxBytes[1]).toBe(0x4b); // 'K'
    const docxAscii = new TextDecoder('latin1').decode(docxBytes);
    expect(docxAscii).toContain('word/document.xml');
    expect(docxAscii).toContain('[Content_Types].xml');

    const createObjectUrlSpy = vi.fn(() => 'blob:mock-report');
    const revokeObjectUrlSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectUrlSpy,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectUrlSpy,
    });
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const delivery = await exportAndDeliverFile({
      format: 'pdf',
      filename: 'fieldcast-relatorio.pdf',
      content: pdfBytes,
      isNativePlatformFn: () => false,
    });

    expect(delivery.deliveredVia).toBe('browser_download');
    expect(delivery.savedPathDisplay).toBe('Downloads/fieldcast-relatorio.pdf');
    expect(delivery.byteLength).toBe(pdfBytes.byteLength);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
  });

  it('switches PT / EN via locale-toggle-btn and updates ForecastCharts and MapRadarTab popup with useUnits()', () => {
    const forecast = createCoastalTestForecast();

    function UnitsAndLocaleHarness() {
      const { setWindUnit, setTemperatureUnit } = useUnits();
      return (
        <div>
          <button
            type="button"
            data-testid="switch-kt-f-btn"
            onClick={() => {
              setWindUnit('kt');
              setTemperatureUnit('f');
            }}
          >
            kt/F
          </button>
          <AppShell
            activeTab="forecast"
            onTabChange={vi.fn()}
            theme="light"
            onToggleTheme={vi.fn()}
            activeLocation={TEST_COASTAL_LOCATION}
            savedLocations={[]}
            healthSnapshot={createTestHealthSnapshot()}
            onSelectLocation={vi.fn()}
          >
            <ForecastCharts
              forecast={forecast}
              viewMode="fieldcast"
              showInterpolatedProfile={false}
              horizonHours={24}
              selectedHourIndex={0}
            />
            <MapRadarTab
              forecast={forecast}
              activeLocation={TEST_COASTAL_LOCATION}
              isDark={false}
            />
          </AppShell>
        </div>
      );
    }

    const mounted = mountReactComponent(
      <LocaleProvider initialLocale="pt">
        <UnitsProvider>
          <UnitsAndLocaleHarness />
        </UnitsProvider>
      </LocaleProvider>,
    );

    const localeBtn = mounted.container.querySelector(
      '[data-testid="locale-toggle-btn"]',
    ) as HTMLButtonElement;
    expect(localeBtn).not.toBeNull();
    expect(localeBtn.textContent).toContain('PT');
    expect(mounted.container.textContent).toContain('Resumo');

    act(() => {
      localeBtn.click();
    });
    expect(localeBtn.textContent).toContain('EN');
    expect(mounted.container.textContent).toContain('Summary');

    const switchUnitsBtn = mounted.container.querySelector(
      '[data-testid="switch-kt-f-btn"]',
    ) as HTMLButtonElement;
    act(() => {
      switchUnitsBtn.click();
    });

    const chartOptions = Array.from(
      mounted.container.querySelectorAll('[data-testid="echarts-mock"]'),
    )
      .map((el) => el.getAttribute('data-option') ?? '')
      .join('\n');
    expect(chartOptions).toContain('kt');
    expect(chartOptions).toContain('°F');

    const popupText =
      mounted.container.querySelector('[data-testid="leaflet-popup"]')?.textContent ?? '';
    expect(popupText).toContain('kt');
    expect(popupText).toContain('°F');

    mounted.unmount();
  });

  it('mounts WeatherModelOverlayLayer canvas inside Leaflet weatherGridPane with zIndex 465 above RainViewer 460', () => {
    const gridPoints: WeatherGridPoint[] = [
      {
        latitude: -27.5,
        longitude: -48.6,
        windSpeed10m: 22,
        windDirection10m: 135,
        precipitationMm: 0.2,
        temperature2mC: 24,
        waveHeightM: 1.1,
      },
      {
        latitude: -27.7,
        longitude: -48.4,
        windSpeed10m: 26,
        windDirection10m: 150,
        precipitationMm: 0.4,
        temperature2mC: 23,
        waveHeightM: 1.3,
      },
    ];

    const mounted = mountReactComponent(
      <WeatherModelOverlayLayer
        layerId="wind"
        modelMode="fieldcast"
        points={gridPoints}
        animateFlow={false}
      />,
    );

    const pane = createdPanes['weatherGridPane'];
    expect(pane).toBeDefined();
    expect(pane!.style.zIndex).toBe('465');

    const canvas = pane!.querySelector(
      'canvas[data-testid="weather-model-canvas"]',
    ) as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas!.dataset.paneZindex).toBe('465');
    expect(canvas!.style.zIndex).toBe('465');

    mounted.unmount();
  });
});
