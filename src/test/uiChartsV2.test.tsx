import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { HelpPopover, HELP_TOPICS } from '../components/common/HelpPopover';
import { CurrentSummaryCard } from '../components/forecast/CurrentSummaryCard';
import { EphemerisCard } from '../components/forecast/EphemerisCard';
import { ForecastCharts } from '../components/forecast/ForecastCharts';
import { ForecastPinMiniMap } from '../components/forecast/ForecastPinMiniMap';
import { ForecastTab } from '../components/forecast/ForecastTab';
import { ModelSelectorBar } from '../components/forecast/ModelSelectorBar';
import { WindguruTable } from '../components/forecast/WindguruTable';
import { COMPLETE_VISIBLE_PARAMS } from '../components/forecast/forecastParamsVisibility';
import * as rainViewerService from '../services/rainViewerService';
import type { EphemerisData, NativeModelHour, NormalizedForecast } from '../types/weather';
import {
  createCoastalTestForecast,
  mountReactComponent,
  setViewportSize,
  TEST_COASTAL_LOCATION,
} from './testUtils';

const capturedChartEvents: Record<string, Record<string, (params: unknown) => void> | undefined> =
  {};

vi.mock('echarts-for-react', () => {
  return {
    default: ({
      option,
      style,
      onEvents,
    }: {
      option: EChartsOption;
      style?: React.CSSProperties;
      onEvents?: Record<string, (params: unknown) => void>;
    }) => {
      const seriesList = Array.isArray(option.series) ? option.series : [];
      const firstSeriesName = (seriesList[0] as { name?: string } | undefined)?.name ?? 'chart';
      capturedChartEvents[firstSeriesName] = onEvents;
      return (
        <div
          data-testid="echarts-mock"
          data-option={JSON.stringify(option)}
          style={style}
        />
      );
    },
  };
});

const mockMapSetView = vi.fn();
const mockMapContainer = document.createElement('div');
const mockMapObj = {
  invalidateSize: vi.fn(),
  getCenter: () => ({ lat: -27.5954, lng: -48.548 }),
  getZoom: () => 10,
  setView: mockMapSetView,
  getContainer: () => mockMapContainer,
  getSize: () => ({ x: 640, y: 320 }),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('react-leaflet', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="leaflet-stub">{children}</div>
  );
  return {
    MapContainer: Stub,
    TileLayer: () => null,
    Marker: () => null,
    Circle: () => null,
    useMap: () => mockMapObj,
    useMapEvents: () => null,
  };
});

function createForecastWithGemAndMsl(): NormalizedForecast {
  const base = createCoastalTestForecast();
  const gemHours: NativeModelHour[] = base.nativeByModel.ecmwf_ifs025.map((h, idx) => ({
    ...h,
    model: 'gem_seamless',
    windSpeed10m: 26 + (idx % 5),
    windGusts10m: 38 + (idx % 4),
    temperature2m: 23.5 + (idx % 3),
    surfacePressure: 1014.5,
  }));

  const hoursWithMsl = base.hours.map((h, idx) => ({
    ...h,
    marine: h.marine
      ? {
          ...h.marine,
          seaLevelHeightMsl: Number((0.42 * Math.sin((idx / 12) * Math.PI) + 0.15).toFixed(2)),
        }
      : null,
  }));

  return {
    ...base,
    hours: hoursWithMsl,
    nativeByModel: {
      ...base.nativeByModel,
      gem_seamless: gemHours,
    },
  };
}

describe('UI Charts V2 — Ephemeris Date Fix, No Auto-Scroll, Charts Summary, MSL, GEM & Primary Location', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockMapSetView.mockClear();
    Object.keys(capturedChartEvents).forEach((k) => delete capturedChartEvents[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders bare YYYY-MM-DD Ephemeris dates without 1-day rollback in America/Sao_Paulo and highlights Hoje', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T10:30:00-03:00'));

    const ephemerisDays: EphemerisData[] = [
      {
        dateIso: '2026-11-24',
        sunriseIso: '2026-11-24T08:15:00Z',
        sunsetIso: '2026-11-24T21:48:00Z',
        civilDawnIso: '2026-11-24T07:49:00Z',
        civilDuskIso: '2026-11-24T22:14:00Z',
        nauticalDawnIso: '2026-11-24T07:18:00Z',
        nauticalDuskIso: '2026-11-24T22:45:00Z',
        moonPhaseValue: 0.5,
        moonPhaseLabel: 'Lua Cheia',
        moonIlluminationPct: 99,
      },
      {
        dateIso: '2026-11-25',
        sunriseIso: '2026-11-25T08:15:00Z',
        sunsetIso: '2026-11-25T21:49:00Z',
        civilDawnIso: '2026-11-25T07:49:00Z',
        civilDuskIso: '2026-11-25T22:15:00Z',
        nauticalDawnIso: '2026-11-25T07:18:00Z',
        nauticalDuskIso: '2026-11-25T22:46:00Z',
        moonPhaseValue: 0.53,
        moonPhaseLabel: 'Gibosa Minguante',
        moonIlluminationPct: 96,
      },
    ];

    const mounted = mountReactComponent(
      <EphemerisCard ephemerisByDay={ephemerisDays} timezone="America/Sao_Paulo" />,
    );

    const pills = Array.from(mounted.container.querySelectorAll('button[aria-pressed]'));
    expect(pills).toHaveLength(2);
    expect(pills[0]!.textContent).toContain('24/11');
    expect(pills[0]!.textContent).not.toContain('23/11');
    expect(pills[0]!.textContent).toContain('Hoje');
    expect(pills[0]!.getAttribute('data-today')).toBe('true');
    expect(pills[0]!.getAttribute('aria-pressed')).toBe('true');

    expect(pills[1]!.textContent).toContain('25/11');
    expect(pills[1]!.getAttribute('data-today')).toBeNull();

    mounted.unmount();
  });

  it('never calls scrollIntoView on WindguruTable mount/updates or Agora click, scrolling only the horizontal container, and supports gem_seamless', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

    const scrollIntoViewSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoViewSpy,
    });

    const forecast = createForecastWithGemAndMsl();
    const onSelectHourIndex = vi.fn();

    const mounted = mountReactComponent(
      <WindguruTable
        forecast={forecast}
        viewMode="gem_seamless"
        showInterpolatedProfile={false}
        horizonHours={48}
        selectedHourIndex={18}
        currentHourIndex={18}
        onSelectHourIndex={onSelectHourIndex}
        visibleParams={COMPLETE_VISIBLE_PARAMS}
      />,
    );

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    // Rerender with different currentHourIndex & locationKey — still zero scrollIntoView calls
    mounted.rerender(
      <WindguruTable
        forecast={{ ...forecast, locationKey: 'moved_loc_key' }}
        viewMode="gem_seamless"
        showInterpolatedProfile={false}
        horizonHours={48}
        selectedHourIndex={19}
        currentHourIndex={19}
        onSelectHourIndex={onSelectHourIndex}
        visibleParams={COMPLETE_VISIBLE_PARAMS}
      />,
    );
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    // Verify native GEM wind speed cell renders (26 + (0 % 5) = 26)
    const firstRowCells = mounted.container.querySelectorAll('tbody tr:first-child td');
    expect(firstRowCells[0]?.textContent).toBe('26');

    // Attach scrollTo spy on horizontal scroll container and click "Agora: HH:MM"
    const scrollWrapper = mounted.container.querySelector('.overflow-x-auto') as HTMLDivElement;
    expect(scrollWrapper).not.toBeNull();
    const scrollToSpy = vi.fn();
    scrollWrapper.scrollTo = scrollToSpy;

    const agoraBtn = Array.from(mounted.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Agora:'),
    );
    expect(agoraBtn).toBeDefined();

    act(() => {
      agoraBtn!.click();
    });

    expect(onSelectHourIndex).toHaveBeenCalledWith(19);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it('displays active-hour metrics permanently in charts-hour-summary, includes MSL series + DHN disclaimer, and supports all 4 models in ForecastCharts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

    const forecast = createForecastWithGemAndMsl();
    const onSelectHourIndex = vi.fn();

    setViewportSize(390, 844);
    const mounted = mountReactComponent(
      <ForecastCharts
        forecast={forecast}
        viewMode="spaghetti"
        showInterpolatedProfile={false}
        horizonHours={48}
        selectedHourIndex={18}
        currentHourIndex={18}
        onSelectHourIndex={onSelectHourIndex}
        visibleParams={COMPLETE_VISIBLE_PARAMS}
      />,
    );

    const summary = mounted.container.querySelector('[data-testid="charts-hour-summary"]');
    expect(summary).not.toBeNull();
    const summaryText = summary!.textContent ?? '';
    expect(summaryText).toContain('Resumo da Janela Horária');
    expect(summaryText).toContain('18:00');
    expect(summaryText).toContain('km/h');
    expect(summaryText).toContain('°C');
    expect(summaryText).toContain('mm');
    expect(summaryText).toContain('hPa');
    expect(summaryText).toContain('Nível do Mar Est. (MSL)');

    // Waves card preserves minHeight 288px, includes MSL series, and shows explicit DHN/Marinha disclaimer
    const wavesCard = mounted.container.querySelector('[data-chart-id="waves"]');
    expect(wavesCard).not.toBeNull();
    const wavesMock = wavesCard!.querySelector('[data-testid="echarts-mock"]') as HTMLElement;
    expect(wavesMock.style.minHeight).toBe('288px');
    const wavesOption = JSON.parse(wavesMock.getAttribute('data-option')!) as EChartsOption;
    const wavesSeriesNames = ((wavesOption.series ?? []) as Array<{ name?: string }>).map(
      (s) => s.name,
    );
    expect(wavesSeriesNames).toContain('Nível do Mar Est. (MSL m)');

    const disclaimer = wavesCard!.querySelector('[data-testid="waves-msl-disclaimer"]');
    expect(disclaimer).not.toBeNull();
    expect(disclaimer!.textContent).toContain(
      'Nível do Mar (MSL ~8 km): estimativa barométrica/maré indicativa; não substitui Tábua de Marés oficial da DHN/Marinha.',
    );

    // Spaghetti mode includes all 4 models dynamically (ECMWF, GFS, ICON, GEM)
    const windCard = mounted.container.querySelector('[data-chart-id="wind"]');
    const windMock = windCard!.querySelector('[data-testid="echarts-mock"]') as HTMLElement;
    const windOption = JSON.parse(windMock.getAttribute('data-option')!) as EChartsOption;
    const windSeriesNames = ((windOption.series ?? []) as Array<{ name?: string }>).map(
      (s) => s.name,
    );
    expect(windSeriesNames).toContain('ECMWF 9 km Vento 10m');
    expect(windSeriesNames).toContain('GFS 13 km Vento 10m');
    expect(windSeriesNames).toContain('ICON 13 km Vento 10m');
    expect(windSeriesNames).toContain('GEM 15 km Vento 10m');

    // Clicking on a chart point invokes onSelectHourIndex
    const windClickHandler = capturedChartEvents['ECMWF 9 km Vento 10m']?.click;
    expect(windClickHandler).toBeDefined();
    act(() => {
      windClickHandler?.({ dataIndex: 22 });
    });
    expect(onSelectHourIndex).toHaveBeenCalledWith(22);

    // Native GEM mode plots CMC GEM series directly
    mounted.rerender(
      <ForecastCharts
        forecast={forecast}
        viewMode="gem_seamless"
        showInterpolatedProfile={false}
        horizonHours={48}
        selectedHourIndex={18}
        currentHourIndex={18}
        onSelectHourIndex={onSelectHourIndex}
        visibleParams={COMPLETE_VISIBLE_PARAMS}
      />,
    );
    const nativeWindMock = mounted.container.querySelector(
      '[data-chart-id="wind"] [data-testid="echarts-mock"]',
    ) as HTMLElement;
    const nativeWindOption = JSON.parse(
      nativeWindMock.getAttribute('data-option')!,
    ) as EChartsOption;
    const nativeNames = ((nativeWindOption.series ?? []) as Array<{ name?: string }>).map(
      (s) => s.name,
    );
    expect(nativeNames).toContain('CMC GEM Vento 10m');
    expect(nativeNames).toContain('CMC GEM Rajadas 10m');

    mounted.unmount();
  });

  it('renders CMC GEM in ModelSelectorBar and updated 4-model copy in HelpPopover', () => {
    const onViewModeChange = vi.fn();
    const mounted = mountReactComponent(
      <div>
        <ModelSelectorBar
          viewMode="fieldcast"
          onViewModeChange={onViewModeChange}
          showInterpolatedProfile={false}
          onToggleInterpolatedProfile={vi.fn()}
          horizonHours={168}
          onHorizonHoursChange={vi.fn()}
        />
        <HelpPopover topic="confidence" />
      </div>,
    );

    expect(mounted.container.textContent).toContain('Consenso Multi-Modelo');
    expect(mounted.container.textContent).toContain('CMC GEM');
    expect(mounted.container.textContent).toContain('Global Canadense');

    const gemBtn = Array.from(mounted.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('CMC GEM'),
    );
    expect(gemBtn).toBeDefined();
    act(() => {
      gemBtn!.click();
    });
    expect(onViewModeChange).toHaveBeenCalledWith('gem_seamless');

    expect(HELP_TOPICS.confidence.summary).toContain('4 modelos globais (ECMWF, GFS, ICON e GEM)');
    expect(HELP_TOPICS.confidence.summary).not.toContain('3 modelos');
    expect(HELP_TOPICS.ensemble_vs_native.details.join(' ')).toContain(
      '4 modelos globais (ECMWF, GFS, ICON e GEM)',
    );

    mounted.unmount();
  });

  it('supports "Definir como Área Principal" action and "Área Principal Salva" badge in CurrentSummaryCard & ForecastTab', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

    const forecast = createCoastalTestForecast();
    const onSetPrimaryLocation = vi.fn().mockResolvedValue(undefined);

    const mounted = mountReactComponent(
      <ForecastTab
        forecast={forecast}
        activeLocation={TEST_COASTAL_LOCATION}
        isPrimaryLocation={false}
        onSetPrimaryLocation={onSetPrimaryLocation}
      />,
    );

    const setPrimaryBtn = mounted.container.querySelector(
      '[data-testid="set-primary-location-btn"]',
    ) as HTMLButtonElement | null;
    expect(setPrimaryBtn).not.toBeNull();
    expect(setPrimaryBtn!.textContent).toContain('Definir como Área Principal');
    expect(setPrimaryBtn!.className).toContain('min-h-[44px]');

    await act(async () => {
      setPrimaryBtn!.click();
      await Promise.resolve();
    });

    expect(onSetPrimaryLocation).toHaveBeenCalledWith({
      latitude: TEST_COASTAL_LOCATION.latitude,
      longitude: TEST_COASTAL_LOCATION.longitude,
      name: TEST_COASTAL_LOCATION.name,
      origin: TEST_COASTAL_LOCATION.origin,
    });

    mounted.rerender(
      <CurrentSummaryCard
        forecast={forecast}
        activeLocation={TEST_COASTAL_LOCATION}
        onOpenThresholdModal={vi.fn()}
        isPrimaryLocation={true}
        onSetPrimaryLocation={onSetPrimaryLocation}
      />,
    );

    expect(mounted.container.querySelector('[data-testid="set-primary-location-btn"]')).toBeNull();
    const primaryBadge = mounted.container.querySelector('[data-testid="primary-location-badge"]');
    expect(primaryBadge).not.toBeNull();
    expect(primaryBadge!.textContent).toContain('Área Principal Salva');

    mounted.unmount();
  });

  it('supports gem_seamless, safe overlay toggle, and jitter-free map sync in ForecastPinMiniMap', async () => {
    vi.spyOn(rainViewerService, 'fetchRainViewerRadar').mockResolvedValue({
      available: false,
      degraded: true,
      host: 'https://tilecache.rainviewer.com',
      frames: [],
      pastCount: 0,
      nowcastCount: 0,
      maxNativeZoom: 7,
      fetchedAtIso: '2026-11-24T12:00:00Z',
      statusMessage: 'Offline',
    });

    const forecast = createForecastWithGemAndMsl();
    const mounted = mountReactComponent(
      <ForecastPinMiniMap
        activeLocation={TEST_COASTAL_LOCATION}
        forecast={forecast}
        viewMode="gem_seamless"
        selectedHourIndex={4}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const hud = mounted.container.querySelector('[data-testid="minimap-weather-hud"]');
    expect(hud?.textContent).toContain('Modelo: CMC GEM 15km');
    // No jitter setView on initial mount or sub-threshold shift
    expect(mockMapSetView).not.toHaveBeenCalled();

    mounted.rerender(
      <ForecastPinMiniMap
        activeLocation={{
          ...TEST_COASTAL_LOCATION,
          latitude: TEST_COASTAL_LOCATION.latitude + 0.0002,
        }}
        forecast={forecast}
        viewMode="gem_seamless"
        selectedHourIndex={4}
      />,
    );
    expect(mockMapSetView).not.toHaveBeenCalled();

    // Toggle "Mapa Limpo" turns off weather + radar overlays safely
    const safeToggle = mounted.container.querySelector(
      '[data-testid="minimap-safe-layers-toggle"]',
    ) as HTMLButtonElement;
    expect(safeToggle).not.toBeNull();
    act(() => {
      safeToggle.click();
    });
    expect(safeToggle.getAttribute('aria-pressed')).toBe('true');
    expect(hud?.textContent).toContain('Radar RainViewer oculto');

    mounted.unmount();
  });
});
