import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import openMeteoCoastal from './fixtures/openMeteoCoastal.json';
import openMeteoInland from './fixtures/openMeteoInland.json';
import marineCoastal from './fixtures/marineCoastal.json';
import marineInland from './fixtures/marineInland.json';
import { normalizeOpenMeteoForecast } from '../services/openMeteoService';
import type { ActiveCoordinates } from '../types/field';
import type { HealthCheckSnapshot } from '../types/health';
import type { NormalizedForecast } from '../types/weather';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function createCoastalTestForecast(
  fetchedAtIso = '2026-11-22T18:08:00-03:00',
): NormalizedForecast {
  return normalizeOpenMeteoForecast({
    forecastRaw: openMeteoCoastal,
    marineRaw: marineCoastal,
    fetchedAtIso,
  });
}

export function createInlandTestForecast(
  fetchedAtIso = '2026-11-22T18:08:00-03:00',
): NormalizedForecast {
  return normalizeOpenMeteoForecast({
    forecastRaw: openMeteoInland,
    marineRaw: marineInland,
    fetchedAtIso,
  });
}

export function createTestHealthSnapshot(): HealthCheckSnapshot {
  const endpoint = (service: HealthCheckSnapshot['endpoints'][keyof HealthCheckSnapshot['endpoints']]['service'], label: string) => ({
    service,
    label,
    status: 'healthy' as const,
    latencyMs: 120,
    lastCheckedIso: '2026-11-22T18:08:00-03:00',
    circuitOpen: false,
    consecutiveFailures: 0,
  });

  return {
    overall: 'healthy',
    platform: 'web',
    gpsStatus: 'granted',
    indexedDbOk: true,
    usingCachedForecast: false,
    cacheAgeMinutes: 0,
    endpoints: {
      open_meteo_forecast: endpoint('open_meteo_forecast', 'Open-Meteo Forecast'),
      open_meteo_marine: endpoint('open_meteo_marine', 'Open-Meteo Marine'),
      rainviewer: endpoint('rainviewer', 'RainViewer Radar'),
      nominatim: endpoint('nominatim', 'Nominatim Geocoding'),
      ipwhois: endpoint('ipwhois', 'ipwho.is Geolocation'),
    },
    recentErrors: [],
    checkedAtIso: '2026-11-22T18:08:00-03:00',
  };
}

export const TEST_COASTAL_LOCATION: ActiveCoordinates = {
  latitude: -27.5954,
  longitude: -48.548,
  name: 'Florianópolis — SC (Costeiro)',
  origin: 'saved',
  updatedAtIso: '2026-11-22T18:08:00-03:00',
  isApproximateIp: false,
};

export interface MountedComponent {
  container: HTMLDivElement;
  rerender: (element: React.ReactElement) => void;
  unmount: () => void;
}

export function mountReactComponent(element: React.ReactElement): MountedComponent {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    rerender: (nextElement: React.ReactElement) => {
      act(() => {
        root.render(nextElement);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export function setViewportSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  window.dispatchEvent(new Event('resize'));
}
