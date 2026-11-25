import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import { ModelComparisonTab } from '../components/comparison';
import { FieldDataTab } from '../components/field';
import {
  smoothCircularHeadingDeg,
  unwrapContinuousAngleDeg,
} from '../components/field/WindCompass';
import { AppShell } from '../components/layout';
import { TechnicalReportsPanel } from '../components/reports';
import { SettingsTab } from '../components/settings';
import { DailySummaryTab } from '../components/summary';
import {
  clearNotificationLedger,
  DEFAULT_NOTIFICATION_PREFERENCES,
  evaluateForecastNotificationTriggers,
  isMinuteWithinTimeWindow,
  NOTIFICATION_RULE_TEMPLATES,
} from '../services/notificationService';
import type { UserNotificationPreferences } from '../types/v4';
import { UTF8_BOM } from '../utils/exporters';
import { detectGlobalExtremeEvents } from '../utils/extremeEvents';
import {
  computeCoastalNavigationQuality,
  computeDailyFieldQuality,
  computeMagnusRelativeHumidityPct,
  computeVerticalWindShearKtPer100ft,
} from '../utils/qualityScores';
import {
  analyzeForecastScientifically,
  buildAcademicSourceCitations,
  computeDescriptiveStats,
} from '../utils/scientificAnalytics';
import {
  formatScientificStatsCsvBom,
  formatTechnicalReportHtml,
  formatTechnicalReportJson,
  formatTechnicalReportMarkdown,
  generateTechnicalReportDocument,
} from '../utils/technicalReportGenerator';
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

vi.mock('../components/forecast/ForecastPinMiniMap', () => ({
  ForecastPinMiniMap: () => (
    <div data-testid="minimap-mock">
      <button type="button" data-testid="minimap-pin-lock-btn">
        Pin Fixado
      </button>
    </div>
  ),
}));

describe('FieldCast V4.0 — Modular UI, Compass 360/0 Fix, Notifications & Scientific Reports', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearNotificationLedger();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('Compass 360° <-> 0° Continuous Unwrapping & Circular EMA', () => {
    it('unwraps North boundary crossings (359° -> 1° -> 359°) smoothly without 358° reverse jumps', () => {
      const start = unwrapContinuousAngleDeg(null, 359);
      expect(start).toBe(359);

      const stepForwardAcrossNorth = unwrapContinuousAngleDeg(start, 1);
      expect(stepForwardAcrossNorth).toBe(361);
      expect(Math.abs(stepForwardAcrossNorth - start)).toBe(2);

      const stepBackAcrossNorth = unwrapContinuousAngleDeg(stepForwardAcrossNorth, 359);
      expect(stepBackAcrossNorth).toBe(359);

      const multiTurn = unwrapContinuousAngleDeg(718, 2);
      expect(multiTurn).toBe(722);
    });

    it('averages circular sensor readings across 358° and 2° around North (~0°) instead of 180°', () => {
      const s1 = smoothCircularHeadingDeg(null, null, 358, 0.5);
      expect(s1.headingDeg).toBeCloseTo(358, 1);

      const s2 = smoothCircularHeadingDeg(s1.sin, s1.cos, 2, 0.5);
      const distFromNorth = Math.min(s2.headingDeg, 360 - s2.headingDeg);
      expect(distFromNorth).toBeLessThan(1.5);
    });
  });

  describe('Extreme Events, Wind Shear & Customizable Quality Scores', () => {
    it('detects global extreme events with mandatory official source attribution and potential damages', () => {
      const base = createCoastalTestForecast();
      const stormHours = base.hours.map((h, idx) =>
        idx < 3
          ? {
              ...h,
              windGusts10m: { ...h.windGusts10m, mean: 68 },
              precipitationMm: { ...h.precipitationMm, mean: 22 },
              capeJkg: { mean: 1850, min: 1500, max: 2100, stdDev: 120, sampleCount: 4 },
              weatherCodeDominant: 96,
              thunderstormRisk: 'high' as const,
            }
          : h,
      );

      const alerts = detectGlobalExtremeEvents(stormHours, base.timezone, 6.2);
      expect(alerts.length).toBeGreaterThanOrEqual(3);
      const categories = alerts.map((a) => a.category);
      expect(categories).toContain('thunderstorm');
      expect(categories).toContain('extreme_wind');
      expect(categories).toContain('geomagnetic_storm');

      for (const alert of alerts) {
        expect(alert.sourceName.length).toBeGreaterThan(5);
        expect(alert.sourceUrl).toMatch(/^https?:\/\//);
        expect(alert.potentialDamages.length).toBeGreaterThan(5);
      }
    });

    it('computes Magnus relative humidity, vertical wind shear (kt/100ft), and Field/Navigation quality scores', () => {
      const rh = computeMagnusRelativeHumidityPct(25, 20);
      expect(rh).not.toBeNull();
      expect(rh!).toBeGreaterThan(70);
      expect(rh!).toBeLessThan(80);

      const forecast = createCoastalTestForecast();
      const firstHour = forecast.hours[0]!;
      const shear = computeVerticalWindShearKtPer100ft(firstHour);
      expect(shear).not.toBeNull();
      expect(shear!).toBeGreaterThanOrEqual(0);

      const fieldScore = computeDailyFieldQuality(firstHour);
      expect(fieldScore.score).toBeGreaterThanOrEqual(0);
      expect(fieldScore.score).toBeLessThanOrEqual(100);

      const navScore = computeCoastalNavigationQuality(firstHour, true);
      expect(navScore.score).toBeGreaterThanOrEqual(0);
      expect(navScore.score).toBeLessThanOrEqual(100);
    });
  });

  describe('Notifications Engine, Time Windows (Daytime, Overnight & notifyFromHHMM) & 3 Templates', () => {
    it('exposes 3 non-active guide templates and enforces time windows accurately', () => {
      expect(NOTIFICATION_RULE_TEMPLATES).toHaveLength(3);

      // Standard daytime window 06:00 - 18:00 with notifyFromHHMM 07:00
      const morningWin = { startHHMM: '06:00', endHHMM: '18:00', notifyFromHHMM: '07:00' };
      expect(isMinuteWithinTimeWindow(8 * 60, morningWin, 6 * 60 + 30)).toBe(false); // before 07:00
      expect(isMinuteWithinTimeWindow(8 * 60, morningWin, 7 * 60 + 15)).toBe(true); // after 07:00
      expect(isMinuteWithinTimeWindow(20 * 60, morningWin, 7 * 60 + 15)).toBe(false); // outside 18:00

      // Overnight window 22:00 - 06:00
      const nightWin = { startHHMM: '22:00', endHHMM: '06:00', notifyFromHHMM: null };
      expect(isMinuteWithinTimeWindow(23 * 60 + 15, nightWin)).toBe(true);
      expect(isMinuteWithinTimeWindow(2 * 60, nightWin)).toBe(true);
      expect(isMinuteWithinTimeWindow(14 * 60, nightWin)).toBe(false);
    });

    it('respects master opt-in and evaluates custom rules only inside user-configured time windows', () => {
      const base = createCoastalTestForecast();
      const firstTs = base.hours[0]!.timestampUnix;
      const now = new Date((firstTs - 600) * 1000);

      const disabledPrefs: UserNotificationPreferences = {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        masterEnabled: false,
      };
      expect(
        evaluateForecastNotificationTriggers({ forecast: base, prefs: disabledPrefs, now }),
      ).toHaveLength(0);

      const activePrefs: UserNotificationPreferences = {
        masterEnabled: true,
        extremeEventsAutoEnabled: false,
        globalActiveWindow: { enabled: false, startHHMM: '00:00', endHHMM: '23:59' },
        updatedAtIso: now.toISOString(),
        rules: [
          {
            id: 'rule-wind-window',
            name: 'Vento Operacional',
            enabled: true,
            conditions: { maxWindKmh: 5 },
            timeWindow: { startHHMM: '00:00', endHHMM: '23:59', notifyFromHHMM: null },
            customTitle: 'Vento em {hour}',
            customMessage: 'Condição detectada na janela {window}: {wind} km/h',
            createdAtIso: now.toISOString(),
          },
        ],
      };

      const triggers = evaluateForecastNotificationTriggers({
        forecast: base,
        prefs: activePrefs,
        now,
      });
      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.kind).toBe('custom');
      expect(triggers[0]!.message).toContain('km/h');
    });
  });

  describe('Scientific Analytics & Formal Technical/Academic Report Generator', () => {
    it('computes percentiles, IQR, OLS trend, Z-score anomaly, FAO-56 water balance, and exports HTML/MD/CSV/JSON', () => {
      const stats = computeDescriptiveStats(
        'temp',
        'Temperatura 2m',
        '°C',
        [18, 20, 22, 24, 26, 28, 30],
        [0, 3600, 7200, 10800, 14400, 18000, 21600],
      );
      expect(stats.sampleCount).toBe(7);
      expect(stats.mean).toBeCloseTo(24, 2);
      expect(stats.median).toBeCloseTo(24, 2);
      expect(stats.p10!).toBeLessThan(stats.p90!);
      expect(stats.linearTrendPerDay!).toBeGreaterThan(0);
      expect(stats.anomalyZScoreMax!).toBeGreaterThan(1);

      const citations = buildAcademicSourceCitations(true, true);
      expect(citations.some((c) => c.datasetName.includes('ERA5'))).toBe(true);

      const forecast = createCoastalTestForecast();
      const analysis = analyzeForecastScientifically(forecast, 'Florianópolis — SC', 'fieldcast');
      const report = generateTechnicalReportDocument(analysis);

      expect(report.limitationsAndDisclaimers.join(' ')).toContain('DHN');

      const html = formatTechnicalReportHtml(report);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('@media print');
      expect(html).toContain('Florianópolis');

      const md = formatTechnicalReportMarkdown(report);
      expect(md).toContain('# ');
      expect(md).toContain('Metodologia');

      const csv = formatScientificStatsCsvBom(analysis);
      expect(csv.startsWith(UTF8_BOM)).toBe(true);

      const json = JSON.parse(formatTechnicalReportJson(report));
      expect(json.reportId).toBe(report.reportId);
    });
  });

  describe('V4 UI Modules: Retractable Sidebar, DailySummaryTab, ModelComparisonTab, SettingsTab & Reports', () => {
    it('toggles desktop retractable sidebar and switches between DailySummaryTab and ModelComparisonTab cleanly', () => {
      setViewportSize(1366, 820);
      const forecast = createCoastalTestForecast();

      const shell = mountReactComponent(
        <AppShell
          activeTab="forecast"
          onTabChange={vi.fn()}
          theme="dark"
          onToggleTheme={vi.fn()}
          activeLocation={TEST_COASTAL_LOCATION}
          savedLocations={[]}
          healthSnapshot={createTestHealthSnapshot()}
          onSelectLocation={vi.fn()}
        >
          <DailySummaryTab
            forecast={forecast}
            activeLocation={TEST_COASTAL_LOCATION}
            viewMode="fieldcast"
          />
        </AppShell>,
      );

      const sidebar = shell.container.querySelector('[data-testid="app-retractable-sidebar"]');
      const collapseBtn = shell.container.querySelector(
        '[data-testid="sidebar-collapse-toggle"]',
      ) as HTMLButtonElement;
      expect(sidebar).not.toBeNull();
      expect(collapseBtn).not.toBeNull();

      act(() => {
        collapseBtn.click();
      });
      expect(window.localStorage.getItem('fieldcast_sidebar_collapsed_v4')).toBe('true');

      expect(shell.container.querySelector('[data-testid="daily-summary-tab"]')).not.toBeNull();
      const extremeSpan = shell.container.querySelector(
        '[data-testid="global-extreme-events-span"]',
      );
      expect(extremeSpan).not.toBeNull();
      expect(extremeSpan?.textContent).toContain('Open-Meteo');

      const detailsBtn = shell.container.querySelector(
        '[data-testid="extreme-events-details-toggle"]',
      ) as HTMLButtonElement;
      expect(detailsBtn).not.toBeNull();
      act(() => {
        detailsBtn.click();
      });

      shell.unmount();

      const compMount = mountReactComponent(
        <ModelComparisonTab
          forecast={forecast}
          activeLocation={TEST_COASTAL_LOCATION}
          viewMode="fieldcast"
        />,
      );
      expect(
        compMount.container.querySelector('[data-testid="model-comparison-tab"]'),
      ).not.toBeNull();
      expect(
        compMount.container.querySelector('[data-testid="comparison-plots-toggles"]'),
      ).not.toBeNull();
      compMount.unmount();
    });

    it('renders SettingsTab with 3 templates and TechnicalReportsPanel inside FieldDataTab sub-views', async () => {
      const forecast = createCoastalTestForecast();

      const settingsMount = mountReactComponent(<SettingsTab forecast={forecast} />);
      expect(settingsMount.container.querySelector('[data-testid="settings-tab"]')).not.toBeNull();
      const tplBtn = settingsMount.container.querySelector(
        '[data-testid="use-template-tpl-morning-field"]',
      ) as HTMLButtonElement;
      expect(tplBtn).not.toBeNull();
      act(() => {
        tplBtn.click();
      });
      const startInput = settingsMount.container.querySelector(
        '[data-testid="rule-window-start"]',
      ) as HTMLInputElement;
      expect(startInput.value).toBe('06:00');
      settingsMount.unmount();

      const reportsMount = mountReactComponent(
        <TechnicalReportsPanel forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />,
      );
      expect(
        reportsMount.container.querySelector('[data-testid="technical-reports-panel"]'),
      ).not.toBeNull();
      expect(
        reportsMount.container.querySelector('[data-testid="download-report-html"]'),
      ).not.toBeNull();
      reportsMount.unmount();

      let fieldMount!: ReturnType<typeof mountReactComponent>;
      await act(async () => {
        fieldMount = mountReactComponent(
          <FieldDataTab forecast={forecast} activeLocation={TEST_COASTAL_LOCATION} />,
        );
        await Promise.resolve();
      });
      expect(
        fieldMount.container.querySelector('[data-testid="field-subview-nav"]'),
      ).not.toBeNull();
      fieldMount.unmount();
    });
  });
});
