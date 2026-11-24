import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { AeronauticsTab } from '../components/aeronautics';
import { FieldDataTab } from '../components/field';
import { AppShell } from '../components/layout/AppShell';
import { NavigationTab } from '../components/navigation';
import {
  classifyKpScale,
  fetchNoaaKpIndex,
  type KpIndexDataset,
  loadManualKpOverride,
  saveManualKpOverride,
} from '../services/kpIndexService';
import type { EnsembleHour } from '../types/weather';
import {
  computeDroneFlightAssessment,
  DEFAULT_DRONE_FLIGHT_LIMITS,
  extractTideExtrema,
} from '../utils/droneFlightIndex';
import {
  createCoastalTestForecast,
  createInlandTestForecast,
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

function setReactInputValue(input: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeCalmEnsembleHour(base: EnsembleHour, overrides?: Partial<EnsembleHour>): EnsembleHour {
  return {
    ...base,
    windSpeed10m: { ...base.windSpeed10m, mean: 10 },
    windSpeed80m: { ...base.windSpeed80m, mean: 14 },
    windSpeed100m: { ...base.windSpeed100m, mean: 16 },
    windSpeed120m: { ...base.windSpeed120m, mean: 18 },
    windGusts10m: { ...base.windGusts10m, mean: 16 },
    precipitationMm: { ...base.precipitationMm, mean: 0 },
    precipitationProbabilityPct: { ...base.precipitationProbabilityPct, mean: 5 },
    visibilityM: { ...base.visibilityM, mean: 15000 },
    fogRisk: false,
    barometricSquallRisk: false,
    verticalProfile: {
      ...base.verticalProfile,
      atypicalShearWarning: false,
      interpolatedLevels: [
        { heightM: 10, speedKmh: 10, directionDeg: 90, isInterpolated: false },
        { heightM: 30, speedKmh: 12, directionDeg: 90, isInterpolated: true },
        { heightM: 50, speedKmh: 13, directionDeg: 90, isInterpolated: true },
        { heightM: 80, speedKmh: 14, directionDeg: 90, isInterpolated: false },
        { heightM: 100, speedKmh: 16, directionDeg: 90, isInterpolated: false },
        { heightM: 120, speedKmh: 18, directionDeg: 90, isInterpolated: false },
      ],
    },
    ...overrides,
  };
}

describe('FieldCast Modular 5-Tab UI, Kp Index, Drone Conditions & Tides (V3)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('kpIndexService & droneFlightIndex domain logic', () => {
    it('classifies geomagnetic scales G0 through G5 accurately', () => {
      expect(classifyKpScale(2.0).scale).toBe('G0');
      expect(classifyKpScale(2.0).severity).toBe('green');
      expect(classifyKpScale(5.0).scale).toBe('G1');
      expect(classifyKpScale(5.0).severity).toBe('amber');
      expect(classifyKpScale(7.0).scale).toBe('G3');
      expect(classifyKpScale(7.0).severity).toBe('red');
      expect(classifyKpScale(9.0).scale).toBe('G5');
      expect(classifyKpScale(9.0).severity).toBe('red');
    });

    it('parses NOAA SWPC Kp feed, handles HTTP fallback, and persists manual overrides', async () => {
      const mockSwpc = [
        { time_tag: '2026-11-24T12:00:00', kp: 1.67, observed: 'observed', noaa_scale: null },
        { time_tag: '2026-11-24T15:00:00', kp: 5.33, observed: 'estimated', noaa_scale: 'G1' },
        { time_tag: '2026-11-24T18:00:00', kp: 3.0, observed: 'predicted', noaa_scale: null },
      ];

      const dataset = await fetchNoaaKpIndex({
        fetchImpl: vi.fn(async () => new Response(JSON.stringify(mockSwpc), { status: 200 })) as unknown as typeof fetch,
      });

      expect(dataset.fromCache).toBe(false);
      expect(dataset.entries).toHaveLength(3);
      expect(dataset.currentKp).toBe(5.33);
      expect(dataset.classification.scale).toBe('G1');

      const offlineFallback = await fetchNoaaKpIndex({
        fetchImpl: vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
      });
      expect(offlineFallback.fromCache).toBe(true);
      expect(offlineFallback.currentKp).toBe(5.33);

      saveManualKpOverride({
        enabled: true,
        kpValue: 7.4,
        updatedAtIso: '2026-11-24T15:00:00Z',
      });
      const loaded = loadManualKpOverride();
      expect(loaded.enabled).toBe(true);
      expect(loaded.kpValue).toBe(7.4);
    });

    it('computes Drone Flight Score cleanly and penalizes high Kp, storm winds, and fog', () => {
      const baseHour = makeCalmEnsembleHour(createCoastalTestForecast().hours[0]!);

      const green = computeDroneFlightAssessment(baseHour, 1.5, DEFAULT_DRONE_FLIGHT_LIMITS);
      expect(green.status).toBe('green');
      expect(green.score).toBeGreaterThanOrEqual(85);

      const kpStorm = computeDroneFlightAssessment(baseHour, 7.5, DEFAULT_DRONE_FLIGHT_LIMITS);
      expect(kpStorm.score).toBeLessThan(green.score);
      expect(kpStorm.status).toBe('amber');

      const criticalWeather = computeDroneFlightAssessment(
        makeCalmEnsembleHour(baseHour, {
          windSpeed80m: { ...baseHour.windSpeed80m, mean: 55 },
          windGusts10m: { ...baseHour.windGusts10m, mean: 68 },
          fogRisk: true,
          verticalProfile: {
            ...baseHour.verticalProfile,
            interpolatedLevels: [
              { heightM: 80, speedKmh: 55, directionDeg: 180, isInterpolated: false },
            ],
          },
        }),
        7.5,
        DEFAULT_DRONE_FLIGHT_LIMITS,
      );
      expect(criticalWeather.status).toBe('red');
      expect(criticalWeather.score).toBeLessThan(20);
    });

    it('extracts local high (Preia-mar) and low (Baixa-mar) tide extrema from MSL curve', () => {
      const baseHours = createCoastalTestForecast().hours.slice(0, 8);
      const levels = [0.2, 0.8, 1.25, 0.7, 0.1, -0.35, 0.25, 0.9];
      const waveHours = baseHours.map((h, i) => ({
        ...h,
        marine: h.marine ? { ...h.marine, seaLevelHeightMsl: levels[i]! } : null,
      }));

      const extrema = extractTideExtrema(waveHours, 'America/Sao_Paulo');
      expect(extrema).toHaveLength(2);
      expect(extrema[0]!.type).toBe('high');
      expect(extrema[0]!.label).toBe('Preia-mar (Alta)');
      expect(extrema[0]!.seaLevelHeightMsl).toBe(1.25);
      expect(extrema[1]!.type).toBe('low');
      expect(extrema[1]!.label).toBe('Baixa-mar (Baixa)');
      expect(extrema[1]!.seaLevelHeightMsl).toBe(-0.35);
    });
  });

  describe('Modular 5-Tab AppShell & Tab Modules', () => {
    it('renders all 5 modular tabs (Principal, Navegação, Aeronáutica, Mapa, Armazenamento) and triggers switches', () => {
      setViewportSize(1280, 800);
      const onTabChange = vi.fn();
      const mounted = mountReactComponent(
        <AppShell
          activeTab="forecast"
          onTabChange={onTabChange}
          theme="light"
          onToggleTheme={vi.fn()}
          activeLocation={TEST_COASTAL_LOCATION}
          savedLocations={[]}
          healthSnapshot={createTestHealthSnapshot()}
          onSelectLocation={vi.fn()}
        >
          <div>Conteúdo</div>
        </AppShell>,
      );

      const desktopNav = mounted.container.querySelector(
        'nav[aria-label="Navegação Principal Desktop"]',
      );
      const mobileNav = mounted.container.querySelector(
        'nav[aria-label="Navegação Principal Mobile"] > div',
      );
      expect(desktopNav?.querySelectorAll('button')).toHaveLength(5);
      expect(mobileNav?.className).toContain('grid-cols-5');
      expect(mobileNav?.querySelectorAll('button')).toHaveLength(5);

      const navButtons = Array.from(desktopNav!.querySelectorAll('button'));
      expect(navButtons.map((b) => b.textContent?.trim())).toEqual([
        'Principal',
        'Navegação',
        'Aeronáutica',
        'Mapa',
        'Armazenamento',
      ]);

      act(() => {
        navButtons[1]!.click();
        navButtons[2]!.click();
        navButtons[4]!.click();
      });

      expect(onTabChange).toHaveBeenNthCalledWith(1, 'navigation');
      expect(onTabChange).toHaveBeenNthCalledWith(2, 'aeronautics');
      expect(onTabChange).toHaveBeenNthCalledWith(3, 'field');
    });

    it('NavigationTab renders coastal tide extrema, mandatory DHN notice, and continental fallback safely', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-22T18:08:00-03:00'));

      const coastalForecast = createCoastalTestForecast();
      const customHours = coastalForecast.hours.map((h, i) => ({
        ...h,
        marine: h.marine ? { ...h.marine, seaLevelHeightMsl: Math.sin(i / 2) * 0.9 } : null,
      }));
      const mounted = mountReactComponent(
        <NavigationTab
          forecast={{ ...coastalForecast, hours: customHours }}
          activeLocation={TEST_COASTAL_LOCATION}
        />,
      );

      expect(mounted.container.querySelector('[data-testid="navigation-tab"]')).not.toBeNull();
      const dhn = mounted.container.querySelector('[data-testid="dhn-tide-disclaimer"]');
      expect(dhn?.textContent).toContain('DHN / Marinha do Brasil');
      expect(mounted.container.textContent).toContain('Preia-mar (Alta)');
      expect(mounted.container.textContent).toContain('Baixa-mar (Baixa)');

      // Continental fallback
      const inlandForecast = createInlandTestForecast();
      mounted.rerender(
        <NavigationTab forecast={inlandForecast} activeLocation={TEST_COASTAL_LOCATION} />,
      );
      expect(mounted.container.textContent).toContain('Coordenada continental sem grade oceânica');
    });

    it('AeronauticsTab accepts manual Kp index input and recalculates Drone Flight Score reactively', () => {
      const base = createCoastalTestForecast();
      const calmHours = base.hours.map((h) => makeCalmEnsembleHour(h));
      const calmForecast = { ...base, hours: calmHours };

      const initialKp: KpIndexDataset = {
        currentKp: 1.5,
        currentStatus: 'observed',
        classification: classifyKpScale(1.5),
        entries: [
          {
            timeTagUtc: '2026-11-24T12:00:00',
            timestampUnix: 1795521600,
            kp: 1.5,
            status: 'observed',
            noaaScale: null,
          },
        ],
        fetchedAtIso: '2026-11-24T12:00:00Z',
        fromCache: false,
      };

      const mounted = mountReactComponent(
        <AeronauticsTab
          forecast={calmForecast}
          activeLocation={TEST_COASTAL_LOCATION}
          initialKpDataset={initialKp}
        />,
      );

      const scoreBeforeText =
        mounted.container.querySelector('[data-testid="drone-flight-score"]')?.textContent ?? '';
      expect(scoreBeforeText).toContain('100/100');
      expect(mounted.container.textContent).toContain('Escala G0');

      const kpInput = mounted.container.querySelector(
        '[data-testid="kp-manual-input"]',
      ) as HTMLInputElement;
      expect(kpInput).not.toBeNull();

      act(() => {
        setReactInputValue(kpInput, '8.0');
      });

      const scoreAfterText =
        mounted.container.querySelector('[data-testid="drone-flight-score"]')?.textContent ?? '';
      expect(scoreAfterText).toContain('64/100');
      expect(mounted.container.textContent).toContain('Escala G4');
      expect(mounted.container.textContent).toContain('Modo Override Manual Ativo');
    });

    it('FieldDataTab displays Storage Overview panel with live entity counts and primary location', async () => {
      const coastalForecast = createCoastalTestForecast();
      let mounted!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        mounted = mountReactComponent(
          <FieldDataTab
            forecast={coastalForecast}
            activeLocation={TEST_COASTAL_LOCATION}
            primaryLocationName="Praia do Campeche"
            savedLocations={[
              {
                id: 'loc-1',
                name: 'Florianópolis',
                latitude: -27.59,
                longitude: -48.54,
                isFavorite: true,
                createdAtIso: '2026-11-24T10:00:00Z',
                lastUsedAtIso: '2026-11-24T10:00:00Z',
              },
            ]}
            waypoints={[]}
            tracks={[]}
          />,
        );
        await Promise.resolve();
      });

      const panel = mounted.container.querySelector('[data-testid="storage-overview-panel"]');
      expect(panel).not.toBeNull();
      expect(panel?.textContent).toContain('Praia do Campeche');
      expect(panel?.textContent).toContain('Locais Salvos');
      expect(panel?.textContent).toContain('Waypoints');
      expect(panel?.textContent).toContain('Rotas GPX');
      expect(panel?.textContent).toContain('Tiles Offline');
    });
  });
});
