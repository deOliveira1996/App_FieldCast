import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { HelpPopover } from '../components/common/HelpPopover';
import { CurrentSummaryCard } from '../components/forecast/CurrentSummaryCard';
import { ForecastCharts } from '../components/forecast/ForecastCharts';
import { ForecastTab } from '../components/forecast/ForecastTab';
import { ModelSelectorBar } from '../components/forecast/ModelSelectorBar';
import { WindguruTable } from '../components/forecast/WindguruTable';
import {
  COMPLETE_VISIBLE_PARAMS,
  VISIBLE_PARAMS_STORAGE_KEY,
} from '../components/forecast/forecastParamsVisibility';
import { AppShell } from '../components/layout/AppShell';
import {
  COMPARABLE_VARIABLES,
  detectSharedComparableVariables,
} from '../utils/modelComparison';
import {
  createCoastalTestForecast,
  createTestHealthSnapshot,
  mountReactComponent,
  setViewportSize,
  TEST_COASTAL_LOCATION,
} from './testUtils';

// Capture ECharts options cleanly in jsdom without needing canvas rendering
vi.mock('echarts-for-react', () => {
  return {
    default: ({ option }: { option: EChartsOption }) => (
      <div data-testid="echarts-mock" data-option={JSON.stringify(option)} />
    ),
  };
});

// Lightweight react-leaflet stub so ForecastTab mounts ForecastPinMiniMap cleanly in jsdom
vi.mock('react-leaflet', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="leaflet-stub">{children}</div>
  );
  return {
    MapContainer: Stub,
    TileLayer: () => null,
    Marker: () => null,
    Circle: () => null,
    useMap: () => ({
      invalidateSize: vi.fn(),
      getCenter: () => ({ lat: -27.5954, lng: -48.548 }),
      getZoom: () => 10,
      setView: vi.fn(),
    }),
    useMapEvents: () => null,
  };
});

function readChartOption(container: HTMLElement, chartId: string): EChartsOption {
  const card = container.querySelector(`[data-chart-id="${chartId}"]`);
  expect(card).not.toBeNull();
  const mockEl = card!.querySelector('[data-testid="echarts-mock"]');
  expect(mockEl).not.toBeNull();
  const raw = mockEl!.getAttribute('data-option');
  expect(raw).toBeTruthy();
  return JSON.parse(raw!) as EChartsOption;
}

function getAllSeriesMarkLines(option: EChartsOption): Array<{
  seriesName: string;
  markLine: {
    lineStyle?: { type?: string };
    label?: { formatter?: string };
    data?: Array<{ xAxis?: string }>;
  };
}> {
  const series = (Array.isArray(option.series) ? option.series : []) as Array<{
    name?: string;
    markLine?: {
      lineStyle?: { type?: string };
      label?: { formatter?: string };
      data?: Array<{ xAxis?: string }>;
    };
  }>;
  return series
    .filter((s) => Boolean(s.markLine))
    .map((s) => ({
      seriesName: s.name ?? '',
      markLine: s.markLine!,
    }));
}

describe('R1–R5 Forecast Reactivity, Multi-Model Comparison & Responsive Layout', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('R1 — Responsive Layout, Clean Cards, Non-Clipping Popovers & Semantic Table Headers', () => {
    it('renders responsive AppShell + CurrentSummaryCard grid cards (no flattened border-b strips) at 1280x800 and 390x844', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();

      // Desktop 1280x800
      setViewportSize(1280, 800);
      const desktopMount = mountReactComponent(
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
          <ForecastTab forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />
        </AppShell>,
      );

      const desktopNav = desktopMount.container.querySelector(
        'nav[aria-label="Navegação Principal Desktop"]',
      );
      const mobileNav = desktopMount.container.querySelector(
        'nav[aria-label="Navegação Principal Mobile"]',
      );
      expect(desktopNav).not.toBeNull();
      expect(desktopNav!.className).toContain('hidden');
      expect(desktopNav!.className).toContain('md:flex');
      expect(desktopNav!.parentElement?.parentElement?.className).toContain('hidden md:block');
      expect(mobileNav).not.toBeNull();
      expect(mobileNav!.className).toContain('md:hidden');

      const summaryGrid = desktopMount.container.querySelector('[data-testid="summary-metrics-grid"]');
      expect(summaryGrid).not.toBeNull();
      expect(summaryGrid!.className).toContain('grid-cols-1');
      expect(summaryGrid!.className).toContain('sm:grid-cols-2');
      expect(summaryGrid!.className).toContain('xl:grid-cols-3');

      const cards = summaryGrid!.querySelectorAll('[data-testid^="summary-card-"]');
      expect(cards.length).toBeGreaterThanOrEqual(6);
      cards.forEach((card) => {
        expect(card.className).toContain('rounded-xl');
        expect(card.className).toContain('border');
        expect(card.className).toContain('min-h-[84px]');
        expect(card.className).not.toContain('border-b ');
      });

      const headerBadges = desktopMount.container.querySelector(
        '[data-testid="summary-header-badges"]',
      );
      expect(headerBadges).not.toBeNull();
      expect(headerBadges!.className).toContain('flex-wrap');

      // No <th> element in WindguruTable may have flex/inline-flex directly on <th>
      const allThs = desktopMount.container.querySelectorAll('table th');
      expect(allThs.length).toBeGreaterThan(0);
      allThs.forEach((th) => {
        const classes = th.className.split(/\s+/);
        expect(classes).not.toContain('flex');
        expect(classes).not.toContain('inline-flex');
      });

      desktopMount.unmount();

      // Mobile 390x844
      setViewportSize(390, 844);
      const mobileMount = mountReactComponent(
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
          <CurrentSummaryCard
            forecast={forecast}
            activeLocation={TEST_COASTAL_LOCATION}
            onOpenThresholdModal={vi.fn()}
          />
        </AppShell>,
      );

      const mobileSummaryGrid = mobileMount.container.querySelector(
        '[data-testid="summary-metrics-grid"]',
      );
      expect(mobileSummaryGrid!.className).toContain('grid-cols-1');
      mobileMount.unmount();
    });

    it('renders HelpPopover without clipping containers and supports mobile fixed / desktop absolute positioning', () => {
      const mounted = mountReactComponent(
        <div>
          <ModelSelectorBar
            viewMode="fieldcast"
            onViewModeChange={vi.fn()}
            showInterpolatedProfile={false}
            onToggleInterpolatedProfile={vi.fn()}
            horizonHours={48}
            onHorizonHoursChange={vi.fn()}
          />
          <HelpPopover topic="confidence" />
        </div>,
      );

      // Ensure HelpPopover inside ModelSelectorBar is NOT inside an overflow-x-auto or overflow-hidden parent
      const helpButtons = Array.from(
        mounted.container.querySelectorAll('button[aria-label^="Ajuda"]'),
      ) as HTMLButtonElement[];
      expect(helpButtons.length).toBeGreaterThanOrEqual(2);

      for (const btn of helpButtons) {
        const wrapperParent = btn.parentElement?.parentElement;
        expect(wrapperParent?.className ?? '').not.toContain('overflow-hidden');
        expect(wrapperParent?.className ?? '').not.toContain('overflow-x-auto');
      }

      // Open the confidence HelpPopover and verify non-clipping dialog classes + Escape dismissal
      act(() => {
        helpButtons[helpButtons.length - 1]!.click();
      });

      const dialog = mounted.container.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.className).toContain('fixed');
      expect(dialog!.className).toContain('sm:absolute');
      expect(dialog!.className).toContain('z-50');
      expect(dialog!.className).toContain('max-w-[calc(100vw-2rem)]');

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();

      mounted.unmount();
    });

    it('configures clean chart heights and readable grid margins in ForecastCharts', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();
      const mounted = mountReactComponent(
        <ForecastCharts
          forecast={forecast}
          viewMode="fieldcast"
          showInterpolatedProfile={false}
          horizonHours={48}
          selectedHourIndex={18}
          currentHourIndex={18}
          visibleParams={COMPLETE_VISIBLE_PARAMS}
        />,
      );

      for (const chartId of ['wind', 'temperature', 'rain', 'waves', 'clouds']) {
        const option = readChartOption(mounted.container, chartId);
        const grid = option.grid as { top?: number; containLabel?: boolean };
        expect(grid.containLabel).toBe(true);
        expect(grid.top).toBeGreaterThanOrEqual(48);

        const chartWrapper = mounted.container.querySelector(
          `[data-chart-id="${chartId}"] .h-72`,
        );
        expect(chartWrapper).not.toBeNull();
        expect(chartWrapper!.className).toContain('sm:h-80');
      }

      mounted.unmount();
    });
  });

  describe('R2 & R3 — Multi-Model Comparison Across All Shared Parameters + Per-Variable & Global Toggles', () => {
    it('renders comparison arrows for all 17 shared (>= 2 models) variables in WindguruTable and excludes 1-model visibility', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();
      const statuses = detectSharedComparableVariables(forecast, 48);
      const expectedComparable = statuses.filter((s) => s.isComparable).map((s) => s.id);
      expect(expectedComparable).toHaveLength(17);
      expect(expectedComparable).toContain('windGusts10m');
      expect(expectedComparable).toContain('temperature2m');
      expect(expectedComparable).toContain('dewPoint2m');
      expect(expectedComparable).toContain('precipitation');
      expect(expectedComparable).toContain('precipitationProbability');
      expect(expectedComparable).toContain('surfacePressure');
      expect(expectedComparable).toContain('cloudCoverLow');
      expect(expectedComparable).toContain('windSpeed80m');

      const mounted = mountReactComponent(
        <WindguruTable
          forecast={forecast}
          viewMode="fieldcast"
          showInterpolatedProfile={false}
          horizonHours={48}
          selectedHourIndex={18}
          currentHourIndex={18}
          onSelectHourIndex={vi.fn()}
          visibleParams={COMPLETE_VISIBLE_PARAMS}
        />,
      );

      for (const varDef of COMPARABLE_VARIABLES) {
        const toggle = mounted.container.querySelector(
          `[data-testid="compare-toggle-${varDef.id}"]`,
        );
        if (varDef.id === 'visibility') {
          expect(toggle).toBeNull();
        } else {
          expect(toggle).not.toBeNull();
          expect(toggle!.getAttribute('aria-expanded')).toBe('false');
        }
      }

      // Dynamically enabling visibility on a 2nd model adds its comparison arrow automatically
      const updatedForecast = createCoastalTestForecast();
      updatedForecast.nativeByModel.ecmwf_ifs025[0]!.visibility = 15000;

      mounted.rerender(
        <WindguruTable
          forecast={updatedForecast}
          viewMode="fieldcast"
          showInterpolatedProfile={false}
          horizonHours={48}
          selectedHourIndex={18}
          currentHourIndex={18}
          onSelectHourIndex={vi.fn()}
          visibleParams={COMPLETE_VISIBLE_PARAMS}
        />,
      );

      expect(
        mounted.container.querySelector('[data-testid="compare-toggle-visibility"]'),
      ).not.toBeNull();

      mounted.unmount();
    });

    it('toggles ONLY the clicked variable sub-rows per arrow and interoperates cleanly with global expand/collapse-all', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();
      const mounted = mountReactComponent(
        <WindguruTable
          forecast={forecast}
          viewMode="fieldcast"
          showInterpolatedProfile={false}
          horizonHours={48}
          selectedHourIndex={18}
          currentHourIndex={18}
          onSelectHourIndex={vi.fn()}
          visibleParams={COMPLETE_VISIBLE_PARAMS}
        />,
      );

      // Initially 0 comparison sub-rows
      expect(mounted.container.querySelectorAll('tr[data-compare-row]')).toHaveLength(0);
      const compareAllBtn = mounted.container.querySelector(
        '[data-testid="compare-all-toggle"]',
      ) as HTMLButtonElement;
      expect(compareAllBtn.textContent).toContain('Comparar Modelos (17)');

      // 1. Click ONLY temperature2m toggle -> ONLY temperature2m expands (3 models)
      const tempToggle = mounted.container.querySelector(
        '[data-testid="compare-toggle-temperature2m"]',
      ) as HTMLButtonElement;
      act(() => {
        tempToggle.click();
      });

      expect(tempToggle.getAttribute('aria-expanded')).toBe('true');
      const tempSubRows = mounted.container.querySelectorAll(
        'tr[data-compare-row^="temperature2m:"]',
      );
      expect(tempSubRows).toHaveLength(3);
      expect(mounted.container.querySelectorAll('tr[data-compare-row]')).toHaveLength(3);
      expect(
        mounted.container.querySelectorAll('tr[data-compare-row^="windSpeed10m:"]'),
      ).toHaveLength(0);
      expect(compareAllBtn.textContent).toContain('Expandir Todas (1/17)');
      expect(
        mounted.container.querySelector('[data-testid="collapse-all-compare"]'),
      ).not.toBeNull();

      // 2. Click surfacePressure toggle too -> now ONLY temperature2m + surfacePressure (6 sub-rows)
      const pressureToggle = mounted.container.querySelector(
        '[data-testid="compare-toggle-surfacePressure"]',
      ) as HTMLButtonElement;
      act(() => {
        pressureToggle.click();
      });
      expect(mounted.container.querySelectorAll('tr[data-compare-row]')).toHaveLength(6);
      expect(compareAllBtn.textContent).toContain('Expandir Todas (2/17)');

      // 3. Click global "Expandir Todas (2/17)" -> expands ALL 17 comparable parameters (17 * 3 = 51 sub-rows)
      act(() => {
        compareAllBtn.click();
      });
      expect(mounted.container.querySelectorAll('tr[data-compare-row]')).toHaveLength(51);
      expect(compareAllBtn.textContent).toContain('Recolher Todas (17/17)');

      // 4. Collapse ONLY precipitation via its per-variable arrow while others stay expanded (16 * 3 = 48 sub-rows)
      const precipToggle = mounted.container.querySelector(
        '[data-testid="compare-toggle-precipitation"]',
      ) as HTMLButtonElement;
      act(() => {
        precipToggle.click();
      });
      expect(precipToggle.getAttribute('aria-expanded')).toBe('false');
      expect(
        mounted.container.querySelectorAll('tr[data-compare-row^="precipitation:"]'),
      ).toHaveLength(0);
      expect(mounted.container.querySelectorAll('tr[data-compare-row]')).toHaveLength(48);
      expect(compareAllBtn.textContent).toContain('Expandir Todas (16/17)');

      // 5. Click "Recolher todas" -> collapses all remaining sub-rows back to 0
      const collapseAllBtn = mounted.container.querySelector(
        '[data-testid="collapse-all-compare"]',
      ) as HTMLButtonElement;
      act(() => {
        collapseAllBtn.click();
      });
      expect(mounted.container.querySelectorAll('tr[data-compare-row]')).toHaveLength(0);
      expect(compareAllBtn.textContent).toContain('Comparar Modelos (17)');

      // 6. Verify <th> cells in comparison sub-rows also do not place flex directly on <th>
      act(() => {
        tempToggle.click();
      });
      const subRowThs = mounted.container.querySelectorAll('tr[data-compare-row] th');
      expect(subRowThs).toHaveLength(3);
      subRowThs.forEach((th) => {
        expect(th.className.split(/\s+/)).not.toContain('flex');
      });

      mounted.unmount();
    });

    it('renders multi-model curves in ForecastCharts spaghetti/compare mode across wind, temperature, precip/pressure, and clouds', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();
      const mounted = mountReactComponent(
        <ForecastCharts
          forecast={forecast}
          viewMode="spaghetti"
          showInterpolatedProfile={false}
          horizonHours={48}
          selectedHourIndex={18}
          currentHourIndex={18}
          visibleParams={COMPLETE_VISIBLE_PARAMS}
        />,
      );

      const getSeriesNames = (chartId: string): string[] => {
        const opt = readChartOption(mounted.container, chartId);
        return ((opt.series ?? []) as Array<{ name?: string }>).map((s) => s.name ?? '');
      };

      const windSeries = getSeriesNames('wind');
      expect(windSeries).toContain('ECMWF 9 km Vento 10m');
      expect(windSeries).toContain('GFS 13 km Vento 10m');
      expect(windSeries).toContain('ICON 13 km Vento 10m');
      expect(windSeries).toContain('ECMWF 9 km Rajada 10m');
      expect(windSeries).toContain('GFS 13 km 80m');
      expect(windSeries).toContain('Consenso FieldCast 10m');

      const tempSeries = getSeriesNames('temperature');
      expect(tempSeries).toContain('ECMWF 9 km Temp 2m');
      expect(tempSeries).toContain('GFS 13 km Temp 2m');
      expect(tempSeries).toContain('ICON 13 km Temp 2m');
      expect(tempSeries).toContain('ECMWF 9 km Orvalho 2m');
      expect(tempSeries).toContain('Consenso Temp 2m (°C)');

      const rainSeries = getSeriesNames('rain');
      expect(rainSeries).toContain('ECMWF 9 km Chuva (mm/h)');
      expect(rainSeries).toContain('GFS 13 km Chuva (mm/h)');
      expect(rainSeries).toContain('ICON 13 km Chuva (mm/h)');
      expect(rainSeries).toContain('ECMWF 9 km Pressão (hPa)');
      expect(rainSeries).toContain('Consenso Pressão (hPa)');

      const cloudSeries = getSeriesNames('clouds');
      expect(cloudSeries).toContain('ECMWF 9 km Nuvens Baixas');
      expect(cloudSeries).toContain('GFS 13 km Nuvens Médias');
      expect(cloudSeries).toContain('ICON 13 km Nuvens Altas');

      mounted.unmount();
    });
  });

  describe('R4 — Automatic Current Local-Hour Synchronization & Rollover Reactivity', () => {
    it('opens CurrentSummaryCard and ForecastTab at 18:00 when clock is 18:08-03:00 and automatically rolls over to 19:00 after 52 minutes', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      window.localStorage.setItem(
        VISIBLE_PARAMS_STORAGE_KEY,
        JSON.stringify(COMPLETE_VISIBLE_PARAMS),
      );

      const forecast = createCoastalTestForecast();
      const hour18Temp = forecast.hours[18]!.temperature2mC.mean!.toFixed(1);
      const hour19Temp = forecast.hours[19]!.temperature2mC.mean!.toFixed(1);

      const mounted = mountReactComponent(
        <ForecastTab forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />,
      );

      // Initial render at 18:08 -> 18:00 window (never 00:00)
      const badge = mounted.container.querySelector('[data-testid="current-hour-badge"]');
      expect(badge?.textContent).toContain('Agora • 18:00');
      expect(badge?.textContent).not.toContain('00:00');

      const tempCard = mounted.container.querySelector('[data-testid="summary-card-temperature"]');
      expect(tempCard?.textContent).toContain(`${hour18Temp}°C`);

      const activeTableHeader = mounted.container.querySelector('th[data-current-hour="true"]');
      expect(activeTableHeader?.textContent).toContain('18:00');

      const windMarkLinesBefore = getAllSeriesMarkLines(
        readChartOption(mounted.container, 'wind'),
      );
      expect(windMarkLinesBefore[0]?.markLine.label?.formatter).toBe('18:00');

      // Advance 52 minutes -> 19:00:00-03:00
      act(() => {
        vi.advanceTimersByTime(52 * 60 * 1000);
      });

      const badgeAfter = mounted.container.querySelector('[data-testid="current-hour-badge"]');
      expect(badgeAfter?.textContent).toContain('Agora • 19:00');

      const tempCardAfter = mounted.container.querySelector(
        '[data-testid="summary-card-temperature"]',
      );
      expect(tempCardAfter?.textContent).toContain(`${hour19Temp}°C`);

      const activeTableHeaderAfter = mounted.container.querySelector(
        'th[data-current-hour="true"]',
      );
      expect(activeTableHeaderAfter?.textContent).toContain('19:00');

      const windMarkLinesAfter = getAllSeriesMarkLines(
        readChartOption(mounted.container, 'wind'),
      );
      expect(windMarkLinesAfter[0]?.markLine.label?.formatter).toBe('19:00');

      mounted.unmount();
    });

    it('keeps standalone CurrentSummaryCard synced to local hour-of-day even on stale cached dates and reacts to hour rollover', () => {
      vi.useFakeTimers();
      // Date outside the 48h fixture (stale offline cache scenario): still matches 18:00 -> 19:00
      vi.setSystemTime(new Date('2026-11-26T18:59:00-03:00'));

      const forecast = createCoastalTestForecast();
      const mounted = mountReactComponent(
        <CurrentSummaryCard
          forecast={forecast}
          activeLocation={TEST_COASTAL_LOCATION}
          onOpenThresholdModal={vi.fn()}
        />,
      );

      expect(
        mounted.container.querySelector('[data-testid="current-hour-badge"]')?.textContent,
      ).toContain('Agora • 18:00');

      act(() => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(
        mounted.container.querySelector('[data-testid="current-hour-badge"]')?.textContent,
      ).toContain('Agora • 19:00');

      mounted.unmount();
    });

    it('preserves manual hour inspection across hour rollover while updating the "Voltar para Agora" button to the new local hour', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();
      const mounted = mountReactComponent(
        <ForecastTab forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />,
      );

      // User clicks column 10 (10:00) in WindguruTable
      const hourHeaders = mounted.container.querySelectorAll('table thead tr:nth-child(2) th');
      act(() => {
        (hourHeaders[11] as HTMLElement).click(); // index 0 is "Horário (h)", index 11 is hour 10
      });

      expect(
        mounted.container.querySelector('[data-testid="current-hour-badge"]')?.textContent,
      ).toContain('Visualizando 10:00');
      expect(
        mounted.container.querySelector('[data-testid="reset-current-hour-btn"]')?.textContent,
      ).toContain('Voltar para Agora (18:00)');

      // Roll over to 19:00 while user is still inspecting 10:00
      act(() => {
        vi.advanceTimersByTime(52 * 60 * 1000);
      });

      expect(
        mounted.container.querySelector('[data-testid="current-hour-badge"]')?.textContent,
      ).toContain('Visualizando 10:00');
      expect(
        mounted.container.querySelector('[data-testid="reset-current-hour-btn"]')?.textContent,
      ).toContain('Voltar para Agora (19:00)');

      // Click reset -> snaps right to 19:00
      act(() => {
        (
          mounted.container.querySelector(
            '[data-testid="reset-current-hour-btn"]',
          ) as HTMLButtonElement
        ).click();
      });
      expect(
        mounted.container.querySelector('[data-testid="current-hour-badge"]')?.textContent,
      ).toContain('Agora • 19:00');

      mounted.unmount();
    });
  });

  describe('R5 — Vertical Dashed Current-Hour Line Across All Time-Series Charts & Full-Column Table Highlight', () => {
    it('adds dashed markLine with HH:00 badge to ALL time-series charts in ForecastCharts (fieldcast & spaghetti)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();

      for (const viewMode of ['fieldcast', 'spaghetti'] as const) {
        const mounted = mountReactComponent(
          <ForecastCharts
            forecast={forecast}
            viewMode={viewMode}
            showInterpolatedProfile={false}
            horizonHours={48}
            selectedHourIndex={18}
            currentHourIndex={18}
            visibleParams={COMPLETE_VISIBLE_PARAMS}
          />,
        );

        for (const chartId of ['wind', 'temperature', 'rain', 'waves', 'clouds']) {
          const option = readChartOption(mounted.container, chartId);
          const xLabels = (option.xAxis as { data?: string[] }).data ?? [];
          const markLines = getAllSeriesMarkLines(option);

          expect(markLines.length).toBeGreaterThanOrEqual(1);
          const ml = markLines[0]!.markLine;
          expect(ml.lineStyle?.type).toBe('dashed');
          expect(ml.label?.formatter).toBe('18:00');
          expect(ml.data?.[0]?.xAxis).toBe(xLabels[18]);
          expect(ml.data?.[0]?.xAxis).toContain('18:00');
        }

        // Vertical profile chart displays the current-hour badge as well
        expect(
          mounted.container.querySelector('[data-testid="vertical-profile-current-badge"]')
            ?.textContent,
        ).toContain('Agora: 18:00');

        mounted.unmount();
      }
    });

    it('highlights current-hour header and places dashed amber border across EVERY body row and expanded comparison sub-row in WindguruTable', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const forecast = createCoastalTestForecast();
      const mounted = mountReactComponent(
        <WindguruTable
          forecast={forecast}
          viewMode="fieldcast"
          showInterpolatedProfile={false}
          horizonHours={48}
          selectedHourIndex={18}
          currentHourIndex={18}
          onSelectHourIndex={vi.fn()}
          visibleParams={COMPLETE_VISIBLE_PARAMS}
        />,
      );

      // Expand ALL comparable variables so sub-rows are present too
      const compareAllBtn = mounted.container.querySelector(
        '[data-testid="compare-all-toggle"]',
      ) as HTMLButtonElement;
      act(() => {
        compareAllBtn.click();
      });

      const currentHeader = mounted.container.querySelector(
        'thead th[data-current-hour="true"]',
      );
      expect(currentHeader).not.toBeNull();
      expect(currentHeader!.textContent).toBe('18:00');
      expect(currentHeader!.className).toContain('border-l-amber-500');
      expect(currentHeader!.className).toContain('[border-left-style:dashed]');

      const bodyRows = Array.from(mounted.container.querySelectorAll('tbody tr'));
      // 22 base parameter/semaphore rows + 51 expanded model comparison sub-rows = 73 rows
      expect(bodyRows.length).toBeGreaterThanOrEqual(70);

      for (const row of bodyRows) {
        const cells = Array.from(row.querySelectorAll('td'));
        expect(cells.length).toBe(48);

        const currentCell = cells[18]!;
        expect(currentCell.getAttribute('data-current-hour-cell')).toBe('true');
        expect(currentCell.className).toContain('border-l-amber-500');
        expect(currentCell.className).toContain('[border-left-style:dashed]');

        // Other columns must NOT be marked as current-hour-cell
        expect(cells[0]!.getAttribute('data-current-hour-cell')).toBeNull();
        expect(cells[17]!.getAttribute('data-current-hour-cell')).toBeNull();
        expect(cells[19]!.getAttribute('data-current-hour-cell')).toBeNull();
      }

      mounted.unmount();
    });
  });
});
