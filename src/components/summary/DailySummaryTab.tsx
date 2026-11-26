import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  CloudRain,
  CloudSun,
  Droplets,
  Eye,
  Gauge,
  GitCompare,
  Layers,
  MapPin,
  Moon,
  Mountain,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Sun,
  Thermometer,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import type { GlobalExtremeEventAlert, ThunderstormRiskLevel } from '../../types/v4';
import type {
  EnsembleHour,
  ForecastViewMode,
  NativeModelHour,
  NormalizedForecast,
  SafeWindowStatus,
  SafeWindowThresholds,
  WeatherModelId,
} from '../../types/weather';
import {
  formatLocalHourBadge,
  formatLocalYMD,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { MODEL_DISPLAY_LABELS } from '../../utils/modelComparison';
import { safeAction } from '../../utils/safeAction';
import {
  convertPressure,
  convertTemperature,
  convertWaveHeight,
  convertWindSpeed,
  formatPrecip,
  formatTemp,
  formatWave,
  formatWind,
  getPressureUnitLabel,
  getTempUnitLabel,
  type UnitPreferences,
} from '../../utils/units';
import { CollapsibleModule } from '../common/CollapsibleModule';
import { HelpPopover } from '../common/HelpPopover';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { ForecastSkeleton } from '../common/SkeletonLoaders';
import { degreesToCardinalShort } from '../forecast/CurrentSummaryCard';
import type { ForecastTabProps } from '../forecast/ForecastTab';
import { ThresholdSettingsModal } from '../forecast/ThresholdSettingsModal';
import { useAppLocationContext } from '../layout/AppShell';

export interface DailySummaryTabProps extends ForecastTabProps {
  onNavigateTab?: (
    tab: 'comparison' | 'navigation' | 'aeronautics' | 'map' | 'field' | 'settings',
  ) => void;
}

type SummarySelectableModel = 'fieldcast' | WeatherModelId;

const SUMMARY_MODEL_OPTIONS: ReadonlyArray<{
  id: SummarySelectableModel;
  label: string;
  sublabelPt: string;
  sublabelEn: string;
}> = [
  { id: 'fieldcast', label: 'FieldCast Ensemble', sublabelPt: 'Consenso', sublabelEn: 'Consensus' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', sublabelPt: '0.25°', sublabelEn: '0.25°' },
  { id: 'gfs_seamless', label: 'NOAA GFS', sublabelPt: '13 km', sublabelEn: '13 km' },
  { id: 'icon_seamless', label: 'DWD ICON', sublabelPt: '13 km', sublabelEn: '13 km' },
  { id: 'gem_seamless', label: 'CMC GEM', sublabelPt: '15 km', sublabelEn: '15 km' },
];

const OFFICIAL_MULTI_MODEL_SOURCE_PT =
  'Fonte Oficial: Open-Meteo Multi-Model (ECMWF IFS 0.25° / NOAA GFS / DWD ICON / ECCC GEM)';
const OFFICIAL_MULTI_MODEL_SOURCE_EN =
  'Official Source: Open-Meteo Multi-Model (ECMWF IFS 0.25° / NOAA GFS / DWD ICON / ECCC GEM)';

interface ResolvedSummaryHourMetrics {
  tempC: number | null;
  dewPointC: number | null;
  apparentTempC: number | null;
  relativeHumidityPct: number | null;
  precipMm: number | null;
  precipProbPct: number | null;
  windSpeed10mKmh: number | null;
  windDir10mDeg: number | null;
  windGusts10mKmh: number | null;
  pressureHpa: number | null;
  visibilityM: number | null;
  cloudCoverPct: number | null;
  capeJkg: number | null;
  thunderstormRisk: ThunderstormRiskLevel;
}

function isSingleWeatherModel(mode: ForecastViewMode): mode is WeatherModelId {
  return (
    mode === 'ecmwf_ifs025' ||
    mode === 'gfs_seamless' ||
    mode === 'icon_seamless' ||
    mode === 'gem_seamless'
  );
}

/**
 * Magnus-Tetens Relative Humidity (%) from 2m Air Temperature and 2m Dew Point (°C):
 * RH = 100 * exp((17.625 * Td)/(243.04 + Td)) / exp((17.625 * T)/(243.04 + T))
 */
export function computeMagnusRelativeHumidityPct(
  tempC: number | null | undefined,
  dewPointC: number | null | undefined,
): number | null {
  if (
    tempC === null ||
    tempC === undefined ||
    dewPointC === null ||
    dewPointC === undefined ||
    !Number.isFinite(tempC) ||
    !Number.isFinite(dewPointC)
  ) {
    return null;
  }
  const esTd = Math.exp((17.625 * dewPointC) / (243.04 + dewPointC));
  const esT = Math.exp((17.625 * tempC) / (243.04 + tempC));
  if (!Number.isFinite(esTd) || !Number.isFinite(esT) || esT <= 0) {
    return null;
  }
  const rh = (100 * esTd) / esT;
  return Math.max(0, Math.min(100, Math.round(rh)));
}

/**
 * Steadman Apparent Temperature (°C) fallback when native/ensemble apparentTemperature is absent.
 */
function computeApparentTemperatureFallbackC(
  tempC: number | null,
  rhPct: number | null,
  windSpeed10mKmh: number | null,
): number | null {
  if (tempC === null || !Number.isFinite(tempC)) {
    return null;
  }
  const rh = rhPct !== null && Number.isFinite(rhPct) ? rhPct : 65;
  const windMs =
    windSpeed10mKmh !== null && Number.isFinite(windSpeed10mKmh)
      ? Math.max(0, windSpeed10mKmh) / 3.6
      : 0;
  const vaporPressureHpa = (rh / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  const apparent = tempC + 0.33 * vaporPressureHpa - 0.7 * windMs - 4.0;
  return Math.round(apparent * 10) / 10;
}

function deriveThunderstormRisk(
  ensembleHour: EnsembleHour,
  nativeHour: NativeModelHour | undefined,
  tempC: number | null,
  rhPct: number | null,
  precipMm: number | null,
  precipProbPct: number | null,
): ThunderstormRiskLevel {
  if (ensembleHour.thunderstormRisk === 'high') {
    return 'high';
  }
  const weatherCode = nativeHour?.weatherCode ?? ensembleHour.weatherCodeDominant ?? null;
  if (weatherCode !== null && weatherCode >= 95) {
    return weatherCode >= 96 ? 'high' : 'moderate';
  }
  const cape = nativeHour?.cape ?? ensembleHour.capeJkg?.mean ?? null;
  if (cape !== null && Number.isFinite(cape)) {
    if (cape >= 1400 && ((precipProbPct ?? 0) >= 40 || (precipMm ?? 0) >= 1.5)) {
      return 'high';
    }
    if (cape >= 650 && ((precipProbPct ?? 0) >= 35 || (precipMm ?? 0) >= 0.8)) {
      return 'moderate';
    }
  }
  if (ensembleHour.thunderstormRisk === 'moderate') {
    return 'moderate';
  }
  const pDelta = ensembleHour.pressureDelta3hHpa ?? 0;
  const rain = precipMm ?? 0;
  const prob = precipProbPct ?? 0;
  const t = tempC ?? 20;
  const rh = rhPct ?? 60;

  if (rain >= 8 && t >= 23 && rh >= 78 && pDelta <= -2.5) {
    return 'high';
  }
  if (
    (rain >= 2.5 && t >= 22 && rh >= 74 && pDelta <= -1.5) ||
    (prob >= 70 && rain >= 1.5 && t >= 24 && rh >= 75)
  ) {
    return 'moderate';
  }
  return 'none';
}

function resolveHourMetrics(
  forecast: NormalizedForecast,
  hourIndex: number,
  viewMode: ForecastViewMode,
): ResolvedSummaryHourMetrics | null {
  const ensembleHour = forecast.hours[hourIndex];
  if (!ensembleHour) {
    return null;
  }

  const singleModel = isSingleWeatherModel(viewMode) ? viewMode : null;
  const nativeHour: NativeModelHour | undefined = singleModel
    ? forecast.nativeByModel[singleModel]?.[hourIndex]
    : undefined;

  const tempC = singleModel
    ? (nativeHour?.temperature2m ?? ensembleHour.temperature2mC.mean)
    : ensembleHour.temperature2mC.mean;

  const dewPointC = singleModel
    ? (nativeHour?.dewPoint2m ?? ensembleHour.dewPoint2mC.mean)
    : ensembleHour.dewPoint2mC.mean;

  const relativeHumidityPct = singleModel
    ? (nativeHour?.relativeHumidity2m ?? computeMagnusRelativeHumidityPct(tempC, dewPointC))
    : (ensembleHour.relativeHumidity2mPct?.mean !== null &&
        ensembleHour.relativeHumidity2mPct?.mean !== undefined
        ? Math.round(ensembleHour.relativeHumidity2mPct.mean)
        : computeMagnusRelativeHumidityPct(tempC, dewPointC));

  const windSpeed10mKmh = singleModel
    ? (nativeHour?.windSpeed10m ?? ensembleHour.windSpeed10m.mean)
    : ensembleHour.windSpeed10m.mean;

  const windDir10mDeg = singleModel
    ? (nativeHour?.windDirection10m ?? ensembleHour.windDirection10m.degree)
    : ensembleHour.windDirection10m.degree;

  const windGusts10mKmh = singleModel
    ? (nativeHour?.windGusts10m ?? ensembleHour.windGusts10m.mean)
    : ensembleHour.windGusts10m.mean;

  const rawApparent = singleModel
    ? (nativeHour?.apparentTemperature ?? null)
    : (ensembleHour.apparentTemperatureC?.mean ?? null);

  const apparentTempC =
    rawApparent !== null && Number.isFinite(rawApparent)
      ? Math.round(rawApparent * 10) / 10
      : computeApparentTemperatureFallbackC(tempC, relativeHumidityPct, windSpeed10mKmh);

  const precipMm = singleModel
    ? (nativeHour?.precipitation ?? ensembleHour.precipitationMm.mean)
    : ensembleHour.precipitationMm.mean;

  const precipProbPct = singleModel
    ? (nativeHour?.precipitationProbability ?? ensembleHour.precipitationProbabilityPct.mean)
    : ensembleHour.precipitationProbabilityPct.mean;

  const pressureHpa = singleModel
    ? (nativeHour?.surfacePressure ?? ensembleHour.surfacePressureHpa.mean)
    : ensembleHour.surfacePressureHpa.mean;

  const visibilityM = singleModel
    ? (nativeHour?.visibility ?? ensembleHour.visibilityM.mean)
    : ensembleHour.visibilityM.mean;

  const lowCloud = singleModel
    ? (nativeHour?.cloudCoverLow ?? ensembleHour.cloudCover.lowPct.mean)
    : ensembleHour.cloudCover.lowPct.mean;
  const midCloud = singleModel
    ? (nativeHour?.cloudCoverMid ?? ensembleHour.cloudCover.midPct.mean)
    : ensembleHour.cloudCover.midPct.mean;
  const highCloud = singleModel
    ? (nativeHour?.cloudCoverHigh ?? ensembleHour.cloudCover.highPct.mean)
    : ensembleHour.cloudCover.highPct.mean;

  const cloudCandidates = [lowCloud, midCloud, highCloud].filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  const cloudCoverPct =
    cloudCandidates.length > 0 ? Math.round(Math.max(...cloudCandidates)) : null;

  const capeJkg = singleModel
    ? (nativeHour?.cape ?? ensembleHour.capeJkg?.mean ?? null)
    : (ensembleHour.capeJkg?.mean ?? null);

  const thunderstormRisk = deriveThunderstormRisk(
    ensembleHour,
    nativeHour,
    tempC,
    relativeHumidityPct,
    precipMm,
    precipProbPct,
  );

  return {
    tempC,
    dewPointC,
    apparentTempC,
    relativeHumidityPct,
    precipMm,
    precipProbPct,
    windSpeed10mKmh,
    windDir10mDeg,
    windGusts10mKmh,
    pressureHpa,
    visibilityM,
    cloudCoverPct,
    capeJkg,
    thunderstormRisk,
  };
}

function computeFieldQualityScore(
  metrics: ResolvedSummaryHourMetrics | null,
  ensembleHour: EnsembleHour | undefined,
  thresholds: SafeWindowThresholds,
  tr: (pt: string, en: string) => string,
): { score: number; label: string; badgeClass: string } {
  if (!metrics || !ensembleHour) {
    return {
      score: 75,
      label: tr('Bom para Campo', 'Good for Field'),
      badgeClass:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/70',
    };
  }

  let penalty = 0;

  const wind = metrics.windSpeed10mKmh ?? 0;
  if (wind > thresholds.maxWindKmh) {
    penalty += Math.min(32, 16 + (wind - thresholds.maxWindKmh) * 0.9);
  } else if (wind > thresholds.maxWindKmh * 0.75) {
    penalty += 8;
  }

  const gust = metrics.windGusts10mKmh ?? 0;
  if (gust > thresholds.maxGustKmh) {
    penalty += Math.min(28, 14 + (gust - thresholds.maxGustKmh) * 0.65);
  } else if (gust > thresholds.maxGustKmh * 0.8) {
    penalty += 7;
  }

  const rainMm = metrics.precipMm ?? 0;
  const rainProb = metrics.precipProbPct ?? 0;
  if (rainMm >= 8) {
    penalty += 28;
  } else if (rainMm >= 1.5) {
    penalty += 15;
  } else if (rainMm >= 0.2) {
    penalty += 6;
  }
  if (rainProb > thresholds.maxPrecipProbPct) {
    penalty += 12;
  } else if (rainProb >= 40) {
    penalty += 5;
  }

  if (metrics.thunderstormRisk === 'high') {
    penalty += 30;
  } else if (metrics.thunderstormRisk === 'moderate') {
    penalty += 14;
  }

  const temp = metrics.tempC;
  if (temp !== null) {
    if (temp < 8 || temp > 35) {
      penalty += 12;
    } else if (temp < 13 || temp > 31) {
      penalty += 5;
    }
  }

  if (ensembleHour.fogRisk) {
    penalty += 12;
  }
  if (ensembleHour.barometricSquallRisk) {
    penalty += 15;
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (score >= 78) {
    return {
      score,
      label: tr('Excelente', 'Excellent'),
      badgeClass:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/70',
    };
  }
  if (score >= 52) {
    return {
      score,
      label: tr('Atenção Moderada', 'Moderate Caution'),
      badgeClass:
        'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/70',
    };
  }
  return {
    score,
    label: tr('Condição Restrita', 'Restricted Condition'),
    badgeClass:
      'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700/70',
  };
}

function evaluateDynamicSafeWindow(
  metrics: ResolvedSummaryHourMetrics | null,
  ensembleHour: EnsembleHour | undefined,
  thresholds: SafeWindowThresholds,
  marineAvailable: boolean,
): SafeWindowStatus {
  if (!metrics || !ensembleHour) {
    return 'green';
  }
  const wind = metrics.windSpeed10mKmh ?? 0;
  const gust = metrics.windGusts10mKmh ?? 0;
  const rainProb = metrics.precipProbPct ?? 0;
  const wave = marineAvailable ? (ensembleHour.marine?.waveHeight ?? 0) : 0;

  if (
    wind > thresholds.maxWindKmh ||
    gust > thresholds.maxGustKmh ||
    rainProb > thresholds.maxPrecipProbPct ||
    (marineAvailable && wave > thresholds.maxWaveM) ||
    metrics.thunderstormRisk === 'high'
  ) {
    return 'red';
  }

  if (
    wind >= thresholds.maxWindKmh * 0.8 ||
    gust >= thresholds.maxGustKmh * 0.8 ||
    rainProb >= thresholds.maxPrecipProbPct * 0.8 ||
    (marineAvailable && wave >= thresholds.maxWaveM * 0.8) ||
    metrics.thunderstormRisk === 'moderate'
  ) {
    return 'amber';
  }

  return 'green';
}

function convertAlertTextUnits(text: string, units: UnitPreferences): string {
  let out = text;
  if (units.wind !== 'kmh') {
    out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*km\/h/gi, (_m, numStr: string) => {
      const n = Number(numStr.replace(',', '.'));
      return Number.isFinite(n) ? formatWind(n, units.wind, 0) : _m;
    });
  }
  if (units.precipitation !== 'mm') {
    out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*mm\/h/gi, (_m, numStr: string) => {
      const n = Number(numStr.replace(',', '.'));
      return Number.isFinite(n) ? `${formatPrecip(n, units.precipitation, 1)}/h` : _m;
    });
    out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*mm\b/gi, (_m, numStr: string) => {
      const n = Number(numStr.replace(',', '.'));
      return Number.isFinite(n) ? formatPrecip(n, units.precipitation, 1) : _m;
    });
  }
  if (units.pressure !== 'hpa') {
    out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*hPa/g, (_m, numStr: string) => {
      const n = Number(numStr.replace(',', '.'));
      if (!Number.isFinite(n)) return _m;
      const converted = convertPressure(n, units.pressure) ?? n;
      return `${converted.toFixed(2)} ${getPressureUnitLabel(units.pressure)}`;
    });
  }
  if (units.temperature !== 'c') {
    out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*°C/g, (_m, numStr: string) => {
      const n = Number(numStr.replace(',', '.'));
      return Number.isFinite(n) ? formatTemp(n, units.temperature, 1) : _m;
    });
  }
  if (units.wave !== 'm') {
    out = out.replace(/(-?\d+(?:[.,]\d+)?)\s*m\b(?!\/s)/g, (_m, numStr: string) => {
      const n = Number(numStr.replace(',', '.'));
      return Number.isFinite(n) ? formatWave(n, units.wave, 1) : _m;
    });
  }
  return out;
}

function deriveDeterministicExtremeEvents(
  forecast: NormalizedForecast,
  startIndex: number,
  units: UnitPreferences,
  tr: (pt: string, en: string) => string,
): GlobalExtremeEventAlert[] {
  if (forecast.extremeEvents && forecast.extremeEvents.length > 0) {
    return forecast.extremeEvents.map((ev) => ({
      ...ev,
      title: convertAlertTextUnits(ev.title, units),
      summary: convertAlertTextUnits(ev.summary, units),
      metricBadge: convertAlertTextUnits(ev.metricBadge, units),
      methodologyNote: convertAlertTextUnits(ev.methodologyNote, units),
    }));
  }

  const scanHours = forecast.hours.slice(Math.max(0, startIndex));
  const derived: GlobalExtremeEventAlert[] = [];

  // 1. High Thunderstorm Risk
  const stormHours = scanHours.filter((h) => h.thunderstormRisk === 'high');
  if (stormHours.length > 0) {
    const peak = stormHours[0]!;
    derived.push({
      id: `ext_storm_${peak.timestampUnix}`,
      category: 'thunderstorm',
      severity: 'severe',
      title: tr(
        'Risco Elevado de Tempestade Convectiva e Raios',
        'High Convective Thunderstorm & Lightning Risk',
      ),
      summary: tr(
        `${stormHours.length}h com instabilidade convectiva severa detectada nos modelos globais.`,
        `${stormHours.length}h with severe convective instability detected in global models.`,
      ),
      potentialDamages: tr(
        'Descargas elétricas em áreas abertas, pancadas bruscas de chuva e rajadas convectivas localizadas.',
        'Lightning in exposed areas, sudden downpours, and localized convective gusts.',
      ),
      recommendedAction: tr(
        'Evite exposição em topos, praias, espelhos d’água e estruturas metálicas durante a janela crítica.',
        'Avoid ridges, beaches, open water, and metallic structures during the critical window.',
      ),
      metricBadge: peak.capeJkg?.mean
        ? `CAPE ${Math.round(peak.capeJkg.mean)} J/kg`
        : tr('Convecção Alta', 'High Convection'),
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: stormHours[0]!.timestampUnix,
      windowEndUnix: stormHours[stormHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote: tr(
        'Derivado deterministicamente dos indicadores convectivos (CAPE, código sinótico WMO e queda barométrica).',
        'Deterministically derived from convective indicators (CAPE, WMO synoptic code, and pressure drop).',
      ),
    });
  }

  // 2. Severe Wind Gusts >= 55 km/h
  const gustHours = scanHours.filter(
    (h) => (h.windGusts10m.max ?? h.windGusts10m.mean ?? 0) >= 55,
  );
  if (gustHours.length > 0) {
    const peak = gustHours.reduce((best, cur) =>
      (cur.windGusts10m.max ?? cur.windGusts10m.mean ?? 0) >
      (best.windGusts10m.max ?? best.windGusts10m.mean ?? 0)
        ? cur
        : best,
    );
    const maxGustKmh = Math.round(peak.windGusts10m.max ?? peak.windGusts10m.mean ?? 55);
    const maxGustFormatted = formatWind(maxGustKmh, units.wind, 0);
    const thresholdGustFormatted = formatWind(55, units.wind, 0);
    derived.push({
      id: `ext_gust_${peak.timestampUnix}`,
      category: 'extreme_wind',
      severity: maxGustKmh >= 75 ? 'extreme' : 'severe',
      title: tr(
        `Rajadas Severas de Vento (até ${maxGustFormatted})`,
        `Severe Wind Gusts (up to ${maxGustFormatted})`,
      ),
      summary: tr(
        `Pico previsto de ${maxGustFormatted} a 10m da superfície ao longo de ${gustHours.length}h.`,
        `Forecast peak of ${maxGustFormatted} at 10m AGL across ${gustHours.length}h.`,
      ),
      potentialDamages: tr(
        'Queda de galhos, deslocamento de tendas/equipamentos leves, dificuldade em navegação costeira e voo de drones inviável.',
        'Falling branches, shifting tents/light gear, rough coastal navigation, and unsafe UAV/drone flight.',
      ),
      recommendedAction: tr(
        'Reforce amarrações, suspenda voos de VANT e antecipe abrigo de embarcações miúdas.',
        'Secure tie-downs, suspend UAV flights, and shelter small craft early.',
      ),
      metricBadge: tr(`Rajada ${maxGustFormatted}`, `Gust ${maxGustFormatted}`),
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: gustHours[0]!.timestampUnix,
      windowEndUnix: gustHours[gustHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote: tr(
        `Limiar fixo de segurança para rajadas de superfície >= ${thresholdGustFormatted}.`,
        `Fixed safety threshold for surface gusts >= ${thresholdGustFormatted}.`,
      ),
    });
  }

  // 3. Heavy Rain >= 15 mm/h
  const rainHours = scanHours.filter(
    (h) => (h.precipitationMm.max ?? h.precipitationMm.mean ?? 0) >= 15,
  );
  if (rainHours.length > 0) {
    const peak = rainHours.reduce((best, cur) =>
      (cur.precipitationMm.max ?? cur.precipitationMm.mean ?? 0) >
      (best.precipitationMm.max ?? best.precipitationMm.mean ?? 0)
        ? cur
        : best,
    );
    const maxRainMm = peak.precipitationMm.max ?? peak.precipitationMm.mean ?? 15;
    const maxRainRate = `${formatPrecip(maxRainMm, units.precipitation, 1)}/h`;
    const thresholdRainRate = `${formatPrecip(15, units.precipitation, 0)}/h`;
    derived.push({
      id: `ext_rain_${peak.timestampUnix}`,
      category: 'heavy_rain',
      severity: maxRainMm >= 30 ? 'extreme' : 'severe',
      title: tr(
        `Chuva Intensa Horária (${maxRainRate})`,
        `Heavy Hourly Rainfall (${maxRainRate})`,
      ),
      summary: tr(
        `Taxa horária elevada prevista em ${rainHours.length} janela(s) do horizonte de 7 dias.`,
        `High hourly rainfall rate forecast across ${rainHours.length} window(s) in the 7-day horizon.`,
      ),
      potentialDamages: tr(
        'Alagamentos rápidos em vias urbanas/trilhas, enxurradas em encostas e perda severa de visibilidade horizontal.',
        'Flash flooding on roads/trails, slope runoff, and severe horizontal visibility drop.',
      ),
      recommendedAction: tr(
        'Evite travessia de áreas alagáveis, vales estreitos e estradas não pavimentadas sob chuva forte.',
        'Avoid flood-prone crossings, narrow valleys, and unpaved roads during heavy rain.',
      ),
      metricBadge: maxRainRate,
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: rainHours[0]!.timestampUnix,
      windowEndUnix: rainHours[rainHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote: tr(
        `Alerta automático para precipitação horária >= ${thresholdRainRate}.`,
        `Automatic alert for hourly precipitation >= ${thresholdRainRate}.`,
      ),
    });
  }

  // 4. Barometric Squall (pressureDelta3hHpa <= -4)
  const squallHours = scanHours.filter(
    (h) => (h.pressureDelta3hHpa !== null && h.pressureDelta3hHpa <= -4) || h.barometricSquallRisk,
  );
  if (squallHours.length > 0) {
    const peak = squallHours.reduce((best, cur) =>
      (cur.pressureDelta3hHpa ?? -4) < (best.pressureDelta3hHpa ?? -4) ? cur : best,
    );
    const deltaHpa = peak.pressureDelta3hHpa ?? -4;
    const deltaConv = convertPressure(deltaHpa, units.pressure) ?? deltaHpa;
    const deltaStr = `${deltaConv.toFixed(units.pressure === 'inhg' ? 2 : 1)} ${getPressureUnitLabel(units.pressure)}`;
    const threshConv = convertPressure(-4, units.pressure) ?? -4;
    const threshStr = `${threshConv.toFixed(units.pressure === 'inhg' ? 2 : 1)} ${getPressureUnitLabel(units.pressure)}`;
    derived.push({
      id: `ext_squall_${peak.timestampUnix}`,
      category: 'pressure_squall',
      severity: 'severe',
      title: tr(
        `Queda Barométrica Brusca / Linha de Instabilidade (${deltaStr}/3h)`,
        `Rapid Barometric Drop / Squall Line (${deltaStr}/3h)`,
      ),
      summary: tr(
        'Despressurização rápida na superfície sinalizando passagem frontal ou squall.',
        'Rapid surface pressure drop signaling frontal passage or squall line.',
      ),
      potentialDamages: tr(
        'Mudança repentina na direção do vento (rondada brusca), entrada súbita de rajadas e agitação marítima rápida.',
        'Sudden wind shift, abrupt gust onset, and rapid sea-state build-up.',
      ),
      recommendedAction: tr(
        'Antecipe recolhimento de equipamentos sensíveis antes da virada do tempo.',
        'Secure sensitive equipment before weather deterioration.',
      ),
      metricBadge: `ΔP ${deltaStr}/3h`,
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: squallHours[0]!.timestampUnix,
      windowEndUnix: squallHours[squallHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote: tr(
        `Gatilho físico ΔP/3h <= ${threshStr}.`,
        `Physical trigger ΔP/3h <= ${threshStr}.`,
      ),
    });
  }

  // 5. Coastal Swell >= 3.0 m
  if (forecast.marineAvailable) {
    const swellHours = scanHours.filter((h) => (h.marine?.waveHeight ?? 0) >= 3.0);
    if (swellHours.length > 0) {
      const peak = swellHours.reduce((best, cur) =>
        (cur.marine?.waveHeight ?? 0) > (best.marine?.waveHeight ?? 0) ? cur : best,
      );
      const maxWaveM = peak.marine?.waveHeight ?? 3.0;
      const maxWaveStr = formatWave(maxWaveM, units.wave, 1);
      const threshWaveStr = formatWave(3.0, units.wave, 1);
      derived.push({
        id: `ext_wave_${peak.timestampUnix}`,
        category: 'coastal_swell',
        severity: maxWaveM >= 4.5 ? 'extreme' : 'severe',
        title: tr(
          `Ressaca / Mar Grosso Costeiro (Ondas de ${maxWaveStr})`,
          `Rough Coastal Seas / Swell (${maxWaveStr} Waves)`,
        ),
        summary: tr(
          `${swellHours.length}h com altura significativa de onda igual ou superior a ${threshWaveStr}.`,
          `${swellHours.length}h with significant wave height >= ${threshWaveStr}.`,
        ),
        potentialDamages: tr(
          'Arrebentação forte em costões e praias, risco à navegação de pequeno porte e sobrelevação costeira.',
          'Heavy shorebreak on headlands/beaches, small-craft navigation hazard, and coastal run-up.',
        ),
        recommendedAction: tr(
          'Evite costões rochosos, barras de entrada expostas e consulte avisos de mau tempo da Marinha (DHN).',
          'Avoid rocky shores and exposed harbor bars; consult official navy marine warnings.',
        ),
        metricBadge: tr(`Ondas ${maxWaveStr}`, `Waves ${maxWaveStr}`),
        peakTimestampUnix: peak.timestampUnix,
        windowStartUnix: swellHours[0]!.timestampUnix,
        windowEndUnix: swellHours[swellHours.length - 1]!.timestampUnix,
        sourceName: 'Open-Meteo Marine + Multi-Model Atmosférico',
        sourceUrl: 'https://open-meteo.com/en/docs/marine-weather-api',
        methodologyNote: tr(
          `Altura significativa de onda (Hs) >= ${threshWaveStr} na grade costeira.`,
          `Significant wave height (Hs) >= ${threshWaveStr} on coastal grid.`,
        ),
      });
    }
  }

  return derived;
}

/**
 * Formats a `YYYY-MM-DD` local date key safely anchored at noon UTC (`12:00:00Z`)
 * so UTC-negative timezones NEVER shift the calendar day backward.
 */
function formatLocalCalendarRowLabel(
  ymd: string,
  todayYmd: string,
  intlLocale = 'pt-BR',
  todayLabel = 'Hoje',
): string {
  if (ymd === todayYmd) {
    return todayLabel;
  }
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(noonUtc.getTime())) {
    return ymd;
  }
  const formatted = noonUtc.toLocaleDateString(intlLocale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
  return formatted.replace('.', '');
}

function formatAlertWindowBadge(
  timestampUnix: number,
  timezone: string,
  intlLocale = 'pt-BR',
): string {
  try {
    const d = new Date(timestampUnix * 1000);
    return d.toLocaleString(intlLocale, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || undefined,
    });
  } catch {
    return formatLocalHourBadge(timestampUnix, timezone);
  }
}

function formatTimeIsoHHMM(
  iso: string | null | undefined,
  timezone?: string,
  intlLocale = 'pt-BR',
): string {
  if (!iso) {
    return '—';
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso.slice(11, 16) || '—';
    }
    return d.toLocaleTimeString(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || undefined,
    });
  } catch {
    return iso.slice(11, 16) || '—';
  }
}

const WeatherConditionIcon: React.FC<{
  thunderstormRisk: ThunderstormRiskLevel;
  precipMm: number | null;
  precipProbPct: number | null;
  cloudPct: number | null;
  className?: string;
}> = ({ thunderstormRisk, precipMm, precipProbPct, cloudPct, className = 'w-5 h-5' }) => {
  if (thunderstormRisk === 'high' || thunderstormRisk === 'moderate') {
    return <Zap className={`${className} text-amber-500`} aria-hidden="true" />;
  }
  if ((precipMm ?? 0) >= 0.3 || (precipProbPct ?? 0) >= 55) {
    return <CloudRain className={`${className} text-[#0080cd] dark:text-sky-400`} aria-hidden="true" />;
  }
  if ((cloudPct ?? 0) >= 65) {
    return <Cloud className={`${className} text-slate-500 dark:text-sky-300`} aria-hidden="true" />;
  }
  if ((cloudPct ?? 0) >= 25) {
    return <CloudSun className={`${className} text-amber-500`} aria-hidden="true" />;
  }
  return <Sun className={`${className} text-amber-500`} aria-hidden="true" />;
};

export const DailySummaryTab: React.FC<DailySummaryTabProps> = ({
  forecast,
  activeLocation,
  isLoading = false,
  viewMode: propViewMode,
  onViewModeChange: propOnViewModeChange,
  thresholds,
  onSaveThresholds,
  onOpenLocationsModal,
  onReloadForecast,
  onToast,
  onErrorLog,
  isPrimaryLocation = false,
  onSetPrimaryLocation,
  onNavigateTab,
}) => {
  const locationCtx = useAppLocationContext();
  const {
    units,
    windLabel,
    waveLabel,
    pressureLabel,
    formatTempValue,
    formatWindValue,
    formatWaveValue,
    formatPressureValue,
    formatPrecipValue,
  } = useUnits();
  const { locale, tr } = useLocale();
  const intlLocale = locale === 'en' ? 'en-US' : 'pt-BR';
  const resolvedOpenLocationsModal = onOpenLocationsModal ?? locationCtx?.openLocationsModal;

  const [internalViewMode, setInternalViewMode] = useState<ForecastViewMode>('fieldcast');
  const rawViewMode = propViewMode ?? internalViewMode;
  const activeSummaryModel: SummarySelectableModel = isSingleWeatherModel(rawViewMode)
    ? rawViewMode
    : 'fieldcast';

  const handleModelSelect = useCallback(
    (nextModel: SummarySelectableModel) => {
      setInternalViewMode(nextModel);
      propOnViewModeChange?.(nextModel);
    },
    [propOnViewModeChange],
  );

  const currentLocalHourIndex = useCurrentLocalHourIndex(forecast?.hours, forecast?.timezone);
  const [manualHourIndex, setManualHourIndex] = useState<number | null>(null);
  const [isExtremeDetailsOpen, setIsExtremeDetailsOpen] = useState<boolean>(false);
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState<boolean>(false);
  const [isSettingPrimary, setIsSettingPrimary] = useState<boolean>(false);

  const forecastKey = forecast
    ? `${forecast.locationKey}_${forecast.hours[0]?.timestampUnix ?? 0}`
    : '';

  useEffect(() => {
    setManualHourIndex(null);
  }, [forecastKey]);

  const safeHourIndex = forecast
    ? Math.min(
        Math.max(0, manualHourIndex ?? currentLocalHourIndex),
        Math.max(0, forecast.hours.length - 1),
      )
    : 0;

  const activeMetrics = useMemo(
    () => (forecast ? resolveHourMetrics(forecast, safeHourIndex, activeSummaryModel) : null),
    [forecast, safeHourIndex, activeSummaryModel],
  );

  const extremeAlerts = useMemo(
    () =>
      forecast
        ? deriveDeterministicExtremeEvents(forecast, currentLocalHourIndex, units, tr)
        : [],
    [forecast, currentLocalHourIndex, units, tr],
  );

  const todayLocalYmd = useMemo(() => {
    if (!forecast) {
      return formatLocalYMD(new Date());
    }
    const refHour = forecast.hours[safeHourIndex] ?? forecast.hours[currentLocalHourIndex];
    return refHour
      ? formatLocalYMD(new Date(refHour.timestampUnix * 1000), forecast.timezone)
      : formatLocalYMD(new Date(), forecast.timezone);
  }, [forecast, safeHourIndex, currentLocalHourIndex]);

  const realNowLocalYmd = useMemo(
    () => formatLocalYMD(new Date(), forecast?.timezone),
    [forecast?.timezone],
  );

  // Group all forecast hours strictly by local YYYY-MM-DD (NEVER UTC midnight!)
  const dailySummaries = useMemo(() => {
    if (!forecast) {
      return [];
    }
    const groups = new Map<
      string,
      {
        ymd: string;
        temps: number[];
        rainMmTotal: number;
        maxRainProb: number;
        maxWindKmh: number;
        maxCloudPct: number;
        worstStorm: ThunderstormRiskLevel;
      }
    >();

    for (let idx = 0; idx < forecast.hours.length; idx++) {
      const h = forecast.hours[idx]!;
      const ymd = formatLocalYMD(new Date(h.timestampUnix * 1000), forecast.timezone);
      const m = resolveHourMetrics(forecast, idx, activeSummaryModel);
      if (!m) {
        continue;
      }
      let bucket = groups.get(ymd);
      if (!bucket) {
        bucket = {
          ymd,
          temps: [],
          rainMmTotal: 0,
          maxRainProb: 0,
          maxWindKmh: 0,
          maxCloudPct: 0,
          worstStorm: 'none',
        };
        groups.set(ymd, bucket);
      }
      if (m.tempC !== null && Number.isFinite(m.tempC)) {
        bucket.temps.push(m.tempC);
      }
      if (m.precipMm !== null && Number.isFinite(m.precipMm) && m.precipMm > 0) {
        bucket.rainMmTotal += m.precipMm;
      }
      if (m.precipProbPct !== null && Number.isFinite(m.precipProbPct)) {
        bucket.maxRainProb = Math.max(bucket.maxRainProb, m.precipProbPct);
      }
      if (m.windSpeed10mKmh !== null && Number.isFinite(m.windSpeed10mKmh)) {
        bucket.maxWindKmh = Math.max(bucket.maxWindKmh, m.windSpeed10mKmh);
      }
      if (m.cloudCoverPct !== null && Number.isFinite(m.cloudCoverPct)) {
        bucket.maxCloudPct = Math.max(bucket.maxCloudPct, m.cloudCoverPct);
      }
      if (m.thunderstormRisk === 'high') {
        bucket.worstStorm = 'high';
      } else if (m.thunderstormRisk === 'moderate' && bucket.worstStorm === 'none') {
        bucket.worstStorm = 'moderate';
      }
    }

    const todayText = tr('Hoje', 'Today');
    return Array.from(groups.values())
      .slice(0, 7)
      .map((g) => ({
        ymd: g.ymd,
        label: formatLocalCalendarRowLabel(g.ymd, realNowLocalYmd, intlLocale, todayText),
        minTempC: g.temps.length > 0 ? Math.round(Math.min(...g.temps)) : null,
        maxTempC: g.temps.length > 0 ? Math.round(Math.max(...g.temps)) : null,
        rainMmTotal: Math.round(g.rainMmTotal * 10) / 10,
        maxRainProbPct: Math.round(g.maxRainProb),
        maxWindKmh: Math.round(g.maxWindKmh),
        maxCloudPct: Math.round(g.maxCloudPct),
        thunderstormRisk: g.worstStorm,
      }));
  }, [forecast, activeSummaryModel, realNowLocalYmd, intlLocale, tr]);

  const activeDayMinMax = useMemo(() => {
    const matchedDay =
      dailySummaries.find((d) => d.ymd === todayLocalYmd) ?? dailySummaries[0] ?? null;
    return {
      min: matchedDay?.minTempC ?? null,
      max: matchedDay?.maxTempC ?? null,
    };
  }, [dailySummaries, todayLocalYmd]);

  const sevenDayTempBounds = useMemo(() => {
    const mins = dailySummaries
      .map((d) => d.minTempC)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const maxs = dailySummaries
      .map((d) => d.maxTempC)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const globalMin = mins.length > 0 ? Math.min(...mins) : 15;
    const globalMax = maxs.length > 0 ? Math.max(...maxs) : 30;
    return {
      min: globalMin,
      span: Math.max(1, globalMax - globalMin),
    };
  }, [dailySummaries]);

  const next24Hours = useMemo(() => {
    if (!forecast || forecast.hours.length === 0) {
      return [];
    }
    const startIdx = Math.min(
      Math.max(0, currentLocalHourIndex),
      Math.max(0, forecast.hours.length - 1),
    );
    const slice = forecast.hours.slice(startIdx, startIdx + 24);
    const baseIndex = slice.length > 0 ? startIdx : 0;
    const targetList = slice.length > 0 ? slice : forecast.hours.slice(0, 24);

    return targetList.map((h, offset) => {
      const absoluteIndex = baseIndex + offset;
      const metrics = resolveHourMetrics(forecast, absoluteIndex, activeSummaryModel);
      return {
        absoluteIndex,
        timestampUnix: h.timestampUnix,
        hourLabel: formatLocalHourBadge(h.timestampUnix, forecast.timezone),
        isCurrentHour: absoluteIndex === currentLocalHourIndex,
        isSelectedHour: absoluteIndex === safeHourIndex,
        metrics,
      };
    });
  }, [forecast, currentLocalHourIndex, safeHourIndex, activeSummaryModel]);

  const activeEphemeris = useMemo(() => {
    if (!forecast || forecast.ephemerisByDay.length === 0) {
      return null;
    }
    const matched = forecast.ephemerisByDay.find((day) => {
      const raw = day.dateIso.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw === todayLocalYmd;
      }
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime())
        ? raw.slice(0, 10) === todayLocalYmd
        : formatLocalYMD(parsed, forecast.timezone) === todayLocalYmd;
    });
    return matched ?? forecast.ephemerisByDay[0] ?? null;
  }, [forecast, todayLocalYmd]);

  if (isLoading && !forecast) {
    return <ForecastSkeleton />;
  }

  if (!forecast) {
    return (
      <div
        data-testid="daily-summary-tab"
        className="rounded-2xl border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#132a47] p-8 text-center space-y-3 shadow-sm"
      >
        <p className="text-base font-bold text-slate-900 dark:text-white">
          {tr(
            `Nenhuma previsão carregada para ${activeLocation.name}`,
            `No forecast loaded for ${activeLocation.name}`,
          )}
        </p>
        <p className="text-xs text-slate-600 dark:text-sky-200">
          {tr(
            'Verifique sua conexão ou selecione uma localidade salva no mapa.',
            'Check your connection or pick a saved coordinate on the map.',
          )}
        </p>
        {onReloadForecast && (
          <button
            type="button"
            onClick={() => void onReloadForecast()}
            className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-full text-xs font-bold bg-[#0080cd] hover:bg-[#006bb3] text-white transition-colors"
          >
            {tr('Tentar Novamente', 'Try Again')}
          </button>
        )}
      </div>
    );
  }

  const selectedEnsembleHour = forecast.hours[safeHourIndex];
  const activeThresholds = thresholds ?? forecast.thresholdsUsed;
  const activeModelDisplayLabel =
    activeSummaryModel === 'fieldcast'
      ? 'FieldCast Ensemble'
      : MODEL_DISPLAY_LABELS[activeSummaryModel];

  const quality = computeFieldQualityScore(
    activeMetrics,
    selectedEnsembleHour,
    activeThresholds,
    tr,
  );

  const safeWindowStatus = evaluateDynamicSafeWindow(
    activeMetrics,
    selectedEnsembleHour,
    activeThresholds,
    forecast.marineAvailable,
  );

  const safeWindowMeta: Record<
    SafeWindowStatus,
    { label: string; dot: string; box: string }
  > = {
    green: {
      label: tr('Janela Segura', 'Safe Window'),
      dot: 'bg-emerald-500',
      box: 'border-emerald-200 bg-emerald-50/85 text-emerald-900 dark:border-emerald-700/70 dark:bg-emerald-950/55 dark:text-emerald-100',
    },
    amber: {
      label: tr('Atenção Moderada', 'Moderate Caution'),
      dot: 'bg-amber-500',
      box: 'border-amber-200 bg-amber-50/85 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/55 dark:text-amber-100',
    },
    red: {
      label: tr('Fora dos Limites', 'Out of Limits'),
      dot: 'bg-rose-500',
      box: 'border-rose-200 bg-rose-50/85 text-rose-900 dark:border-rose-700/70 dark:bg-rose-950/55 dark:text-rose-100',
    },
  };

  const stormBadgeMeta: Record<
    ThunderstormRiskLevel,
    { label: string; className: string }
  > = {
    none: {
      label: tr('Baixo', 'Low'),
      className:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/70',
    },
    moderate: {
      label: tr('Moderado', 'Moderate'),
      className:
        'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/70',
    },
    high: {
      label: tr('Alto', 'High'),
      className:
        'bg-rose-50 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700/70',
    },
  };

  const currentStormMeta = stormBadgeMeta[activeMetrics?.thunderstormRisk ?? 'none'];
  const currentSafeMeta = safeWindowMeta[safeWindowStatus];
  const confidence = selectedEnsembleHour?.confidence ?? forecast.overallConfidence;
  const isInspectingOtherHour = safeHourIndex !== currentLocalHourIndex;
  const displayedHourHHMM = selectedEnsembleHour
    ? formatLocalHourBadge(selectedEnsembleHour.timestampUnix, forecast.timezone)
    : '00:00';
  const currentNowHHMM = forecast.hours[currentLocalHourIndex]
    ? formatLocalHourBadge(forecast.hours[currentLocalHourIndex]!.timestampUnix, forecast.timezone)
    : displayedHourHHMM;

  const hasExtremeAlerts = extremeAlerts.length > 0;
  const primaryExtremeAlert = extremeAlerts[0] ?? null;

  const demElevConverted = convertWaveHeight(forecast.elevationDemM, units.wave);
  const demElevText = `${Math.round(demElevConverted ?? forecast.elevationDemM)} ${waveLabel}`;
  const noExtremeGustThresh = formatWind(55, units.wind, 0);
  const noExtremeRainThresh = `${formatPrecip(15, units.precipitation, 0)}/h`;
  const noExtremeWaveThresh = formatWave(3.0, units.wave, 1);

  return (
    <ModuleErrorBoundary
      moduleName={tr('Resumo Diário (FieldCast V4)', 'Daily Summary (FieldCast V4)')}
      onReset={onReloadForecast}
      onErrorLog={onErrorLog}
    >
      <div data-testid="daily-summary-tab" className="space-y-3.5 sm:space-y-4">
        {/* 1. Model Selector Pill Bar (CollapsibleModule) */}
        <CollapsibleModule
          testId="summary-model-selector"
          title={tr('Modelo Ativo no Resumo', 'Active Summary Model')}
          icon={<Layers className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
          defaultOpen={true}
          keepMounted={true}
          headerActions={<HelpPopover topic="ensemble_vs_native" />}
        >
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-0.5 min-w-0">
            {SUMMARY_MODEL_OPTIONS.map((opt) => {
              const isSelected = activeSummaryModel === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`summary-model-pill-${opt.id}`}
                  onClick={() => handleModelSelect(opt.id)}
                  aria-pressed={isSelected}
                  className={`min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-xl text-left inline-flex items-center gap-1.5 shrink-0 border transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isSelected
                      ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                      : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                  }`}
                >
                  {opt.id === 'fieldcast' ? (
                    <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <div>
                    <span className="block text-[11px] font-bold leading-tight">{opt.label}</span>
                    <span
                      className={`block text-[10px] leading-tight ${
                        isSelected ? 'text-sky-100' : 'text-slate-500 dark:text-sky-300/75'
                      }`}
                    >
                      {tr(opt.sublabelPt, opt.sublabelEn)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </CollapsibleModule>

        {/* 2. Global Extreme Events Span (CollapsibleModule, always visible regardless of custom thresholds) */}
        <CollapsibleModule
          testId="global-extreme-events-module"
          title={tr('Eventos Extremos Globais', 'Global Extreme Events')}
          icon={
            hasExtremeAlerts ? (
              <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />
            )
          }
          defaultOpen={true}
          keepMounted={true}
          headerActions={<HelpPopover topic="barometric_trend" />}
        >
          <section
            data-testid="global-extreme-events-span"
            aria-label={tr(
              'Monitoramento Global de Eventos Extremos',
              'Global Extreme Events Monitoring',
            )}
            className={`rounded-xl border p-3 sm:p-3.5 space-y-2.5 transition-colors ${
              hasExtremeAlerts
                ? primaryExtremeAlert?.severity === 'extreme'
                  ? 'border-rose-300 bg-rose-50/95 dark:border-rose-700 dark:bg-rose-950/55 text-rose-950 dark:text-rose-100'
                  : 'border-amber-300 bg-amber-50/95 dark:border-amber-700 dark:bg-amber-950/55 text-amber-950 dark:text-amber-100'
                : 'border-emerald-200 bg-emerald-50/85 dark:border-emerald-800/80 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className={`p-2 rounded-xl shrink-0 border ${
                    hasExtremeAlerts
                      ? primaryExtremeAlert?.severity === 'extreme'
                        ? 'bg-rose-500 text-white border-rose-600'
                        : 'bg-amber-500 text-slate-950 border-amber-600'
                      : 'bg-emerald-500 text-white border-emerald-600'
                  }`}
                >
                  {hasExtremeAlerts ? (
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  )}
                </div>

                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs sm:text-sm font-extrabold">
                      {hasExtremeAlerts && primaryExtremeAlert
                        ? primaryExtremeAlert.title
                        : tr(
                            'Sem Eventos Extremos Severos Previstos',
                            'No Severe Extreme Events Forecast',
                          )}
                    </span>
                    {hasExtremeAlerts && primaryExtremeAlert && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-white/85 dark:bg-slate-900/75 border border-current/20">
                        {primaryExtremeAlert.metricBadge}
                      </span>
                    )}
                    {extremeAlerts.length > 1 && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/80 dark:bg-slate-900/70">
                        +{extremeAlerts.length - 1} {tr('alerta(s)', 'alert(s)')}
                      </span>
                    )}
                  </div>

                  <p className="text-xs leading-relaxed opacity-90">
                    {hasExtremeAlerts && primaryExtremeAlert ? (
                      <>
                        <strong>{tr('Danos potenciais:', 'Potential impacts:')}</strong>{' '}
                        {primaryExtremeAlert.potentialDamages}{' '}
                        <span className="font-semibold">
                          ({tr('Pico:', 'Peak:')}{' '}
                          {formatAlertWindowBadge(
                            primaryExtremeAlert.peakTimestampUnix,
                            forecast.timezone,
                            intlLocale,
                          )}
                          )
                        </span>
                      </>
                    ) : (
                      tr(
                        `Sem gatilho de tempestade, rajada ≥ ${noExtremeGustThresh}, chuva ≥ ${noExtremeRainThresh} ou ressaca ≥ ${noExtremeWaveThresh}.`,
                        `No severe storm, gust ≥ ${noExtremeGustThresh}, rain ≥ ${noExtremeRainThresh}, or swell ≥ ${noExtremeWaveThresh} trigger.`,
                      )
                    )}
                  </p>

                  <p className="text-[11px] font-semibold opacity-80">
                    {primaryExtremeAlert?.sourceName
                      ? `${tr('Fonte Oficial:', 'Official Source:')} ${primaryExtremeAlert.sourceName}`
                      : tr(OFFICIAL_MULTI_MODEL_SOURCE_PT, OFFICIAL_MULTI_MODEL_SOURCE_EN)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                data-testid="extreme-events-details-toggle"
                onClick={() => setIsExtremeDetailsOpen((prev) => !prev)}
                aria-expanded={isExtremeDetailsOpen}
                className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 shrink-0 bg-white/90 hover:bg-white dark:bg-[#0d1f36]/90 dark:hover:bg-[#0d1f36] text-slate-900 dark:text-sky-100 border border-slate-200/90 dark:border-sky-700/80 shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <span>
                  {isExtremeDetailsOpen
                    ? tr('Ocultar Detalhes', 'Hide Details')
                    : tr('Mais Detalhes', 'More Details')}
                </span>
                {isExtremeDetailsOpen ? (
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* Expandable Atmospheric Diagnostics & Extreme Alert Details */}
            {isExtremeDetailsOpen && (
              <div
                data-testid="extreme-events-details-panel"
                className="pt-3 border-t border-current/15 space-y-3 text-slate-800 dark:text-sky-100"
              >
                {extremeAlerts.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {extremeAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-slate-900 dark:text-white">{alert.title}</strong>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-900/70 dark:text-amber-100">
                            {alert.metricBadge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-sky-200/85">
                          {alert.summary}
                        </p>
                        <p className="text-[11px]">
                          <strong>{tr('Impactos / Danos:', 'Impacts / Hazards:')}</strong>{' '}
                          {alert.potentialDamages}
                        </p>
                        <p className="text-[11px]">
                          <strong>{tr('Recomendação:', 'Recommendation:')}</strong>{' '}
                          {alert.recommendedAction}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-sky-300/75">
                          {tr('Fonte:', 'Source:')} {alert.sourceName} • {alert.methodologyNote}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                  <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                      {tr('Tendência Barométrica (ΔP / 3h)', 'Barometric Trend (ΔP / 3h)')}
                    </span>
                    <p className="font-extrabold text-slate-900 dark:text-white">
                      {formatPressureValue(activeMetrics?.pressureHpa)} •{' '}
                      <span>
                        Δ3h:{' '}
                        {selectedEnsembleHour?.pressureDelta3hHpa !== null &&
                        selectedEnsembleHour?.pressureDelta3hHpa !== undefined
                          ? (() => {
                              const conv =
                                convertPressure(
                                  selectedEnsembleHour.pressureDelta3hHpa,
                                  units.pressure,
                                ) ?? selectedEnsembleHour.pressureDelta3hHpa;
                              return `${conv >= 0 ? '+' : ''}${conv.toFixed(units.pressure === 'inhg' ? 2 : 1)} ${pressureLabel}`;
                            })()
                          : tr('Estável', 'Stable')}
                      </span>
                    </p>
                  </div>

                  <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                      {tr('Convecção / CAPE & Trovoada', 'Convection / CAPE & Thunderstorms')}
                    </span>
                    <p className="font-extrabold text-slate-900 dark:text-white">
                      {tr('Risco', 'Risk')} {currentStormMeta.label}
                      {activeMetrics?.capeJkg !== null && activeMetrics?.capeJkg !== undefined
                        ? ` • CAPE ${Math.round(activeMetrics.capeJkg)} J/kg`
                        : ''}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                      {tr('Visibilidade & Nevoeiro', 'Visibility & Fog')}
                    </span>
                    <p className="font-extrabold text-slate-900 dark:text-white">
                      {activeMetrics?.visibilityM !== null && activeMetrics?.visibilityM !== undefined
                        ? `${(activeMetrics.visibilityM / 1000).toFixed(1)} km`
                        : tr('Boa', 'Good')}{' '}
                      •{' '}
                      {selectedEnsembleHour?.fogRisk
                        ? tr('Risco de Nevoeiro', 'Fog Risk')
                        : tr('Sem Nevoeiro', 'No Fog')}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      {tr('Confiabilidade', 'Confidence')} ({Math.round(confidence.total)}/100)
                    </span>
                    <p className="text-[11px] font-semibold text-slate-700 dark:text-sky-200">
                      {tr('Acordo', 'Agreement')} {confidence.breakdown.modelAgreement.toFixed(0)}/50 •{' '}
                      {tr('Fontes', 'Sources')} {confidence.breakdown.sourceIntegrity.toFixed(0)}/30 •{' '}
                      {tr('Prazo', 'Lead')} {confidence.breakdown.timeHorizon.toFixed(0)}/20
                    </p>
                  </div>

                  <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                      <Mountain className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                      {tr('Altitude Oficial DEM', 'Official DEM Elevation')}
                    </span>
                    <p className="font-extrabold text-slate-900 dark:text-white">
                      {demElevText} ({tr('Modelo Digital Open-Meteo', 'Open-Meteo DEM')})
                    </p>
                  </div>

                  <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                      <Moon className="w-3.5 h-3.5 text-sky-500" aria-hidden="true" />
                      {tr('Efemérides do Dia', 'Daily Ephemeris')}
                    </span>
                    <p className="font-extrabold text-slate-900 dark:text-white">
                      {activeEphemeris
                        ? `${tr('Sol', 'Sun')} ${formatTimeIsoHHMM(activeEphemeris.sunriseIso, forecast.timezone, intlLocale)}–${formatTimeIsoHHMM(activeEphemeris.sunsetIso, forecast.timezone, intlLocale)} • ${activeEphemeris.moonPhaseLabel} (${Math.round(activeEphemeris.moonIlluminationPct)}%)`
                        : tr('Efemérides locais indisponíveis', 'Local ephemeris unavailable')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </CollapsibleModule>

        {/* 3. Hero Daily Card (CollapsibleModule: Condições Atuais) */}
        <CollapsibleModule
          testId="current-conditions-module"
          title={tr('Condições Atuais', 'Current Conditions')}
          subtitle={activeLocation.name}
          icon={<Sun className="w-4 h-4 text-amber-500" aria-hidden="true" />}
          defaultOpen={true}
          keepMounted={true}
          headerActions={<HelpPopover topic="summary_overview" />}
        >
          <div
            data-testid="hero-daily-card"
            aria-label={tr('Resumo Principal do Dia', 'Main Daily Summary')}
            className="rounded-2xl border border-sky-100 dark:border-sky-800/75 bg-gradient-to-br from-white via-[#f8fbff] to-sky-50/75 dark:from-[#132a47] dark:via-[#10243e] dark:to-[#0d1f36] p-3.5 sm:p-5 space-y-4"
          >
            {/* Header Row: Location + Pin Primary + Field Quality Score + Safe Window */}
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {resolvedOpenLocationsModal ? (
                    <button
                      type="button"
                      onClick={resolvedOpenLocationsModal}
                      className="min-h-[44px] inline-flex items-center gap-1.5 text-left rounded-xl hover:text-[#0080cd] transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <MapPin className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                      <h1 className="text-base sm:text-xl font-extrabold text-slate-900 dark:text-white leading-tight">
                        {activeLocation.name}
                      </h1>
                    </button>
                  ) : (
                    <h1 className="text-base sm:text-xl font-extrabold text-slate-900 dark:text-white leading-tight">
                      {activeLocation.name}
                    </h1>
                  )}

                  {isPrimaryLocation ? (
                    <span
                      data-testid="primary-location-badge"
                      className="min-h-[44px] px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold inline-flex items-center gap-1 border bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700/70"
                    >
                      <Star
                        className="w-3.5 h-3.5 fill-emerald-500 text-emerald-600 dark:text-emerald-300"
                        aria-hidden="true"
                      />
                      <span>{tr('Local Principal', 'Primary Area')}</span>
                    </span>
                  ) : (
                    onSetPrimaryLocation && (
                      <button
                        type="button"
                        data-testid="set-primary-location-btn"
                        disabled={isSettingPrimary}
                        onClick={() => {
                          void safeAction(
                            async () => {
                              await onSetPrimaryLocation({
                                latitude: activeLocation.latitude,
                                longitude: activeLocation.longitude,
                                name: activeLocation.name,
                                origin: activeLocation.origin,
                              });
                            },
                            {
                              actionKey: 'daily_summary_set_primary',
                              moduleName: 'DailySummaryTab',
                              errorTitle: tr(
                                'Não foi possível salvar o local principal',
                                'Could not save primary area',
                              ),
                              onLoadingChange: setIsSettingPrimary,
                              onToast,
                            },
                          );
                        }}
                        className="min-h-[44px] min-w-[44px] px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold inline-flex items-center gap-1 border bg-white dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-[#0070b8] dark:text-sky-200 border-sky-200 dark:border-sky-700 disabled:opacity-60 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        <Star className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                        <span>{tr('Fixar Principal', 'Set Primary')}</span>
                      </button>
                    )
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/70">
                    <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    <span>
                      {isInspectingOtherHour
                        ? `${tr('Horário', 'Time')} ${displayedHourHHMM}`
                        : `${tr('Agora', 'Now')} • ${displayedHourHHMM}`}
                    </span>
                  </span>

                  {isInspectingOtherHour && (
                    <button
                      type="button"
                      onClick={() => setManualHourIndex(null)}
                      className="min-h-[44px] px-3 py-1 rounded-full text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors"
                    >
                      {tr(`Voltar para Agora (${currentNowHHMM})`, `Back to Now (${currentNowHHMM})`)}
                    </button>
                  )}

                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 dark:bg-[#0d1f36] text-[#0070b8] dark:text-sky-200 border border-sky-200/80 dark:border-sky-800">
                    {activeModelDisplayLabel}
                  </span>

                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-[#0d1f36] text-slate-600 dark:text-sky-200">
                    DEM {demElevText}
                  </span>
                </div>
              </div>

              {/* Right Status Badges: Compact Field Quality Score (0-100) + Safe Window + Thresholds Button */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div
                  data-testid="field-quality-score"
                  className={`min-h-[44px] px-3 py-1.5 rounded-xl border inline-flex items-center gap-1.5 ${quality.badgeClass}`}
                >
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <div className="text-left leading-tight">
                    <span className="block text-[10px] font-semibold opacity-80">
                      {tr('Qualidade de Campo', 'Field Quality')}
                    </span>
                    <span className="block text-xs font-extrabold">
                      {quality.score}/100 • {quality.label}
                    </span>
                  </div>
                </div>

                <div
                  className={`min-h-[44px] px-2 py-1 rounded-xl border inline-flex items-center gap-1.5 ${currentSafeMeta.box}`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${currentSafeMeta.dot}`} />
                  <span className="text-xs font-extrabold">{currentSafeMeta.label}</span>
                  <button
                    type="button"
                    data-testid="open-thresholds-btn"
                    onClick={() => setIsThresholdModalOpen(true)}
                    aria-label={tr(
                      'Personalizar limites da Janela Segura',
                      'Customize Safe Window thresholds',
                    )}
                    className="min-h-[34px] min-w-[34px] px-2.5 py-1 rounded-lg bg-white dark:bg-[#132a47] hover:bg-sky-50 text-slate-700 dark:text-sky-100 border border-slate-200 dark:border-sky-700 text-xs font-bold inline-flex items-center gap-1 transition-colors"
                  >
                    <Sliders className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                    <span>{tr('Limites', 'Limits')}</span>
                  </button>
                  <HelpPopover topic="safe_window" />
                </div>
              </div>
            </div>

            {/* Center Hero Temperature + Everyday Metrics Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
              {/* Large Current Temperature + Min/Max + Apparent */}
              <div className="lg:col-span-5 rounded-2xl border border-sky-100 dark:border-sky-800/80 bg-white dark:bg-[#0d1f36]/90 p-3.5 sm:p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <WeatherConditionIcon
                      thunderstormRisk={activeMetrics?.thunderstormRisk ?? 'none'}
                      precipMm={activeMetrics?.precipMm ?? null}
                      precipProbPct={activeMetrics?.precipProbPct ?? null}
                      cloudPct={activeMetrics?.cloudCoverPct ?? null}
                      className="w-7 h-7"
                    />
                    <span
                      data-testid="hero-current-temp"
                      className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white"
                    >
                      {activeMetrics?.tempC !== null && activeMetrics?.tempC !== undefined
                        ? `${Math.round(convertTemperature(activeMetrics.tempC, units.temperature) ?? activeMetrics.tempC)}${getTempUnitLabel(units.temperature)}`
                        : '—'}
                    </span>
                  </div>

                  <p className="text-xs font-semibold text-slate-600 dark:text-sky-200">
                    {tr('Sensação térmica:', 'Feels like:')}{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {formatTempValue(activeMetrics?.apparentTempC, 1)}
                    </strong>
                  </p>
                </div>

                <div className="text-right space-y-1 shrink-0">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-sky-300/80 block">
                    {tr('Hoje (Mín / Máx)', 'Today (Low / High)')}
                  </span>
                  <div className="flex items-center justify-end gap-2 text-sm sm:text-base font-extrabold">
                    <span className="inline-flex items-center gap-0.5 text-[#0080cd] dark:text-sky-400">
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                      {activeDayMinMax.min !== null
                        ? `${Math.round(convertTemperature(activeDayMinMax.min, units.temperature) ?? activeDayMinMax.min)}°`
                        : '—'}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-orange-500 dark:text-orange-400">
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                      {activeDayMinMax.max !== null
                        ? `${Math.round(convertTemperature(activeDayMinMax.max, units.temperature) ?? activeDayMinMax.max)}°`
                        : '—'}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                    {tr('Nuvens:', 'Clouds:')}{' '}
                    {activeMetrics?.cloudCoverPct !== null &&
                    activeMetrics?.cloudCoverPct !== undefined
                      ? `${activeMetrics.cloudCoverPct}%`
                      : '—'}
                  </span>
                </div>
              </div>

              {/* 4 Clean Everyday Cards: Humidity, Rain, Thunderstorm Risk, Wind & Gusts */}
              <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Relative Humidity */}
                <div
                  data-testid="hero-humidity-card"
                  className="rounded-2xl border border-slate-200/85 dark:border-sky-800/75 bg-white dark:bg-[#0d1f36]/90 p-3.5 flex flex-col justify-between gap-2"
                >
                  <span className="text-xs font-bold text-slate-600 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <Droplets className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <span>{tr('Umidade', 'Humidity')}</span>
                  </span>
                  <div>
                    <span className="text-xl font-extrabold text-slate-900 dark:text-white block">
                      {activeMetrics?.relativeHumidityPct !== null &&
                      activeMetrics?.relativeHumidityPct !== undefined
                        ? `${activeMetrics.relativeHumidityPct}%`
                        : '—'}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                      {tr('Orvalho', 'Dew')} {formatTempValue(activeMetrics?.dewPointC, 0)}
                    </span>
                  </div>
                </div>

                {/* Rain Prob & Rate */}
                <div
                  data-testid="hero-rain-card"
                  className="rounded-2xl border border-slate-200/85 dark:border-sky-800/75 bg-white dark:bg-[#0d1f36]/90 p-3.5 flex flex-col justify-between gap-2"
                >
                  <span className="text-xs font-bold text-slate-600 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <CloudRain className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <span>{tr('Chuva', 'Rain')}</span>
                  </span>
                  <div>
                    <span className="text-xl font-extrabold text-slate-900 dark:text-white block">
                      {activeMetrics?.precipProbPct !== null &&
                      activeMetrics?.precipProbPct !== undefined
                        ? `${Math.round(activeMetrics.precipProbPct)}%`
                        : '0%'}
                    </span>
                    <span className="text-[11px] font-semibold text-[#0070b8] dark:text-sky-300 block">
                      {tr('Taxa:', 'Rate:')}{' '}
                      {activeMetrics?.precipMm !== null && activeMetrics?.precipMm !== undefined
                        ? `${formatPrecipValue(activeMetrics.precipMm, 1)}/h`
                        : `${formatPrecipValue(0, 1)}/h`}
                    </span>
                  </div>
                </div>

                {/* Thunderstorm Risk Badge */}
                <div
                  data-testid="hero-thunderstorm-card"
                  className="rounded-2xl border border-slate-200/85 dark:border-sky-800/75 bg-white dark:bg-[#0d1f36]/90 p-3.5 flex flex-col justify-between gap-2"
                >
                  <span className="text-xs font-bold text-slate-600 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
                    <span>{tr('Trovoada', 'Storms')}</span>
                  </span>
                  <div className="space-y-1">
                    <span
                      data-testid="thunderstorm-risk-badge"
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${currentStormMeta.className}`}
                    >
                      {currentStormMeta.label}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                      {tr('Pressão', 'Pressure')} {formatPressureValue(activeMetrics?.pressureHpa)}
                    </span>
                  </div>
                </div>

                {/* Wind 10m + Gusts */}
                <div
                  data-testid="hero-wind-card"
                  className="rounded-2xl border border-slate-200/85 dark:border-sky-800/75 bg-white dark:bg-[#0d1f36]/90 p-3 flex flex-col justify-between gap-1.5"
                >
                  <span className="text-xs font-bold text-slate-600 dark:text-sky-200 inline-flex items-center gap-1.5">
                    <Wind className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <span>{tr('Vento 10m', 'Wind 10m')}</span>
                  </span>
                  <div>
                    <span className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white block">
                      {formatWindValue(activeMetrics?.windSpeed10mKmh, 0)}{' '}
                      <span className="text-xs font-bold text-[#0070b8] dark:text-sky-300">
                        {degreesToCardinalShort(activeMetrics?.windDir10mDeg)}
                      </span>
                    </span>
                    <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-300 block">
                      {tr('Rajadas:', 'Gusts:')} {formatWindValue(activeMetrics?.windGusts10mKmh, 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {forecast.marineAvailable && selectedEnsembleHour?.marine && (
              <div className="rounded-2xl border border-sky-100 dark:border-sky-800/75 bg-sky-50/70 dark:bg-[#0d1f36]/75 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Waves className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                  <span className="font-bold text-slate-800 dark:text-white">
                    {tr('Condição Costeira: Ondas', 'Coastal Sea State: Waves')}{' '}
                    {formatWaveValue(selectedEnsembleHour.marine.waveHeight, 1)}{' '}
                    ({selectedEnsembleHour.marine.wavePeriod !== null
                      ? `${Math.round(selectedEnsembleHour.marine.wavePeriod)}s`
                      : '—'}{' '}
                    • {degreesToCardinalShort(selectedEnsembleHour.marine.waveDirection)})
                  </span>
                  <HelpPopover topic="waves_swell" align="left" />
                  {typeof selectedEnsembleHour.marine.seaLevelHeightMsl === 'number' &&
                    Number.isFinite(selectedEnsembleHour.marine.seaLevelHeightMsl) && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800">
                        {tr('Maré Est. MSL:', 'Est. Tide MSL:')}{' '}
                        {(() => {
                          const mslConv =
                            convertWaveHeight(
                              selectedEnsembleHour.marine.seaLevelHeightMsl,
                              units.wave,
                            ) ?? selectedEnsembleHour.marine.seaLevelHeightMsl;
                          return `${mslConv >= 0 ? '+' : ''}${mslConv.toFixed(units.wave === 'ft' ? 1 : 2)} ${waveLabel}`;
                        })()}
                      </span>
                    )}
                </div>
                {typeof selectedEnsembleHour.marine.seaLevelHeightMsl === 'number' &&
                  Number.isFinite(selectedEnsembleHour.marine.seaLevelHeightMsl) && (
                    <span className="text-[11px] text-slate-500 dark:text-sky-200/80">
                      {tr(
                        'Estimativa MSL (~8 km) não substitui tábua oficial da DHN / Marinha.',
                        'MSL estimate (~8 km) does NOT replace official DHN / Marinha port tide tables.',
                      )}
                    </span>
                  )}
              </div>
            )}
          </div>
        </CollapsibleModule>

        {/* 4. 24-Hour Horizontal Forecast Strip (Collapsible) */}
        <CollapsibleModule
          testId="hourly-24h-strip"
          title={tr('Próximas 24 Horas', 'Next 24 Hours')}
          icon={<Clock className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
          defaultOpen={true}
          keepMounted={true}
          headerActions={<HelpPopover topic="summary_overview" />}
        >
          <div className="min-w-0 overflow-x-auto scrollbar-thin pb-1">
            <div className="flex items-stretch gap-2 min-w-max">
              {next24Hours.map((item) => {
                const m = item.metrics;
                const convertedTemp = convertTemperature(m?.tempC, units.temperature);
                const convertedWind = convertWindSpeed(m?.windSpeed10mKmh, units.wind);
                return (
                  <button
                    key={item.timestampUnix}
                    type="button"
                    onClick={() =>
                      setManualHourIndex(item.isCurrentHour ? null : item.absoluteIndex)
                    }
                    aria-pressed={item.isSelectedHour}
                    className={`min-h-[44px] min-w-[76px] p-2.5 rounded-2xl border text-center flex flex-col items-center justify-between gap-1 transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      item.isSelectedHour
                        ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-md'
                        : item.isCurrentHour
                          ? 'bg-amber-50/90 dark:bg-amber-950/45 text-slate-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                          : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-800 dark:text-sky-100 border-slate-200/80 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                    }`}
                  >
                    <span className="text-[11px] font-extrabold leading-none">
                      {item.isCurrentHour ? tr('Agora', 'Now') : item.hourLabel}
                    </span>

                    <WeatherConditionIcon
                      thunderstormRisk={m?.thunderstormRisk ?? 'none'}
                      precipMm={m?.precipMm ?? null}
                      precipProbPct={m?.precipProbPct ?? null}
                      cloudPct={m?.cloudCoverPct ?? null}
                      className={`w-4 h-4 ${item.isSelectedHour ? '!text-white' : ''}`}
                    />

                    <span className="text-sm font-extrabold">
                      {convertedTemp !== null ? `${Math.round(convertedTemp)}°` : '—'}
                    </span>

                    <span
                      className={`text-[10px] font-bold leading-tight ${
                        item.isSelectedHour
                          ? 'text-sky-100'
                          : 'text-[#0070b8] dark:text-sky-300'
                      }`}
                    >
                      {m?.precipProbPct !== null && m?.precipProbPct !== undefined
                        ? `${Math.round(m.precipProbPct)}%`
                        : '0%'}{' '}
                      •{' '}
                      {m?.precipMm !== null && m?.precipMm !== undefined && m.precipMm >= 0.1
                        ? formatPrecipValue(m.precipMm, 1)
                        : formatPrecipValue(0, 0)}
                    </span>

                    <span
                      className={`text-[10px] font-semibold leading-tight ${
                        item.isSelectedHour
                          ? 'text-white/90'
                          : 'text-slate-600 dark:text-sky-200/80'
                      }`}
                    >
                      {convertedWind !== null
                        ? `${units.wind === 'ms' ? convertedWind.toFixed(1) : Math.round(convertedWind)}${windLabel} ${degreesToCardinalShort(m?.windDir10mDeg)}`
                        : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </CollapsibleModule>

        {/* 5. 7-Day Daily Forecast List (Collapsible) */}
        <CollapsibleModule
          testId="daily-7d-list"
          title={tr(
            `Próximos 7 Dias (${activeModelDisplayLabel})`,
            `Next 7 Days (${activeModelDisplayLabel})`,
          )}
          subtitle={forecast.timezone}
          icon={<Calendar className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />}
          defaultOpen={true}
          keepMounted={true}
          headerActions={<HelpPopover topic="summary_overview" />}
        >
          <div className="divide-y divide-slate-100 dark:divide-sky-800/60">
            {dailySummaries.map((day) => {
              const leftPct =
                day.minTempC !== null
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        ((day.minTempC - sevenDayTempBounds.min) / sevenDayTempBounds.span) * 100,
                      ),
                    )
                  : 0;
              const widthPct =
                day.minTempC !== null && day.maxTempC !== null
                  ? Math.max(
                      8,
                      Math.min(
                        100 - leftPct,
                        ((day.maxTempC - day.minTempC) / sevenDayTempBounds.span) * 100,
                      ),
                    )
                  : 20;

              return (
                <div
                  key={day.ymd}
                  data-testid={`daily-row-${day.ymd}`}
                  className="py-3 grid grid-cols-12 items-center gap-2 sm:gap-3 text-xs"
                >
                  {/* Day Label + Weather/Thunderstorm Icon */}
                  <div className="col-span-4 sm:col-span-3 flex items-center gap-2 min-w-0">
                    <WeatherConditionIcon
                      thunderstormRisk={day.thunderstormRisk}
                      precipMm={day.rainMmTotal}
                      precipProbPct={day.maxRainProbPct}
                      cloudPct={day.maxCloudPct}
                      className="w-4 h-4 shrink-0"
                    />
                    <span className="font-bold text-slate-900 dark:text-white capitalize truncate">
                      {day.label}
                    </span>
                    {day.thunderstormRisk !== 'none' && (
                      <span
                        title={tr(
                          `Risco de trovoada: ${day.thunderstormRisk === 'high' ? 'Alto' : 'Moderado'}`,
                          `Thunderstorm risk: ${day.thunderstormRisk === 'high' ? 'High' : 'Moderate'}`,
                        )}
                        className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 shrink-0"
                      >
                        ⚡
                      </span>
                    )}
                  </div>

                  {/* Max Rain Prob % + Total Rain mm/in */}
                  <div className="col-span-3 sm:col-span-3 flex items-center gap-1.5 text-slate-700 dark:text-sky-200">
                    <Droplets className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <span className="font-bold text-[#0070b8] dark:text-sky-300">
                      {day.maxRainProbPct}%
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75">
                      ({formatPrecipValue(day.rainMmTotal, 1)})
                    </span>
                  </div>

                  {/* Max Wind */}
                  <div className="hidden sm:flex sm:col-span-2 items-center gap-1 text-slate-600 dark:text-sky-200">
                    <Wind className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    <span className="font-semibold">{formatWindValue(day.maxWindKmh, 0)}</span>
                  </div>

                  {/* Min / Max Temp Range Bar */}
                  <div className="col-span-5 sm:col-span-4 flex items-center gap-2">
                    <span className="w-7 text-right font-bold text-[#0080cd] dark:text-sky-300 shrink-0">
                      {day.minTempC !== null
                        ? `${Math.round(convertTemperature(day.minTempC, units.temperature) ?? day.minTempC)}°`
                        : '—'}
                    </span>
                    <div className="relative flex-1 h-2 rounded-full bg-slate-200/90 dark:bg-[#0d1f36] overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-[#0080cd] via-amber-400 to-orange-500"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="w-7 text-left font-extrabold text-orange-600 dark:text-orange-300 shrink-0">
                      {day.maxTempC !== null
                        ? `${Math.round(convertTemperature(day.maxTempC, units.temperature) ?? day.maxTempC)}°`
                        : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleModule>

        {/* 6. Quick CTA to Model Comparison & Interactive Map Tab */}
        <section className="space-y-3">
          <div className="rounded-2xl border border-sky-200/90 dark:border-sky-800/80 bg-gradient-to-r from-sky-50 via-white to-sky-50 dark:from-[#0d1f36] dark:via-[#132a47] dark:to-[#0d1f36] p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#0080cd] text-white shrink-0">
                <GitCompare className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                  {tr('Análise Multi-Modelo & Mapa Interativo', 'Multi-Model Analysis & Interactive Map')}
                </h3>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="goto-comparison-btn"
                onClick={() => onNavigateTab?.('comparison')}
                className="min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-full text-xs font-extrabold inline-flex items-center justify-center gap-1.5 bg-[#0080cd] hover:bg-[#006bb3] text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <Thermometer className="w-3.5 h-3.5 hidden sm:inline" aria-hidden="true" />
                <span>{tr('Modelos & Tabela', 'Models & Table')}</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                data-testid="goto-map-btn"
                onClick={() => onNavigateTab?.('map')}
                className="min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-full text-xs font-bold inline-flex items-center justify-center gap-1.5 border border-sky-200 dark:border-sky-700 bg-white dark:bg-[#0d1f36] hover:bg-sky-50 text-[#0070b8] dark:text-sky-200 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <span>{tr('Abrir Mapa', 'Open Map')}</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        {/* Safe Window Thresholds Customization Modal */}
        <ThresholdSettingsModal
          isOpen={isThresholdModalOpen}
          onClose={() => setIsThresholdModalOpen(false)}
          thresholds={activeThresholds}
          onSaveThresholds={async (next) => {
            if (onSaveThresholds) {
              await onSaveThresholds(next);
            }
          }}
          onToast={onToast}
        />
      </div>
    </ModuleErrorBoundary>
  );
};
