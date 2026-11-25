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
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { ForecastSkeleton } from '../common/SkeletonLoaders';
import { degreesToCardinalShort } from '../forecast/CurrentSummaryCard';
import { ForecastPinMiniMap } from '../forecast/ForecastPinMiniMap';
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
  sublabel: string;
}> = [
  { id: 'fieldcast', label: 'FieldCast Ensemble', sublabel: 'Consenso Multi-Modelo' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', sublabel: 'Europeu 0.25°' },
  { id: 'gfs_seamless', label: 'NOAA GFS', sublabel: 'Global 13 km' },
  { id: 'icon_seamless', label: 'DWD ICON', sublabel: 'Global 13 km' },
  { id: 'gem_seamless', label: 'CMC GEM', sublabel: 'Canadense 15 km' },
];

const OFFICIAL_MULTI_MODEL_SOURCE =
  'Fonte Oficial: Open-Meteo Multi-Model (ECMWF IFS 0.25° / NOAA GFS / DWD ICON / ECCC GEM)';

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
): { score: number; label: string; badgeClass: string } {
  if (!metrics || !ensembleHour) {
    return {
      score: 75,
      label: 'Bom para Campo',
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
      label: 'Excelente',
      badgeClass:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/70',
    };
  }
  if (score >= 52) {
    return {
      score,
      label: 'Atenção Moderada',
      badgeClass:
        'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/70',
    };
  }
  return {
    score,
    label: 'Condição Restrita',
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

function deriveDeterministicExtremeEvents(
  forecast: NormalizedForecast,
  startIndex: number,
): GlobalExtremeEventAlert[] {
  if (forecast.extremeEvents && forecast.extremeEvents.length > 0) {
    return forecast.extremeEvents;
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
      title: 'Risco Elevado de Tempestade Convectiva e Raios',
      summary: `${stormHours.length}h com instabilidade convectiva severa detectada nos modelos globais.`,
      potentialDamages:
        'Descargas elétricas em áreas abertas, pancadas bruscas de chuva e rajadas convectivas localizadas.',
      recommendedAction:
        'Evite exposição em topos, praias, espelhos d’água e estruturas metálicas durante a janela crítica.',
      metricBadge: peak.capeJkg?.mean
        ? `CAPE ${Math.round(peak.capeJkg.mean)} J/kg`
        : 'Convecção Alta',
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: stormHours[0]!.timestampUnix,
      windowEndUnix: stormHours[stormHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote:
        'Derivado deterministicamente dos indicadores convectivos (CAPE, código sinótico WMO e queda barométrica).',
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
    const maxGust = Math.round(peak.windGusts10m.max ?? peak.windGusts10m.mean ?? 55);
    derived.push({
      id: `ext_gust_${peak.timestampUnix}`,
      category: 'extreme_wind',
      severity: maxGust >= 75 ? 'extreme' : 'severe',
      title: `Rajadas Severas de Vento (até ${maxGust} km/h)`,
      summary: `Pico previsto de ${maxGust} km/h a 10m da superfície ao longo de ${gustHours.length}h.`,
      potentialDamages:
        'Queda de galhos, deslocamento de tendas/equipamentos leves, dificuldade em navegação costeira e voo de drones inviável.',
      recommendedAction:
        'Reforce amarrações, suspenda voos de VANT e antecipe abrigo de embarcações miúdas.',
      metricBadge: `Rajada ${maxGust} km/h`,
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: gustHours[0]!.timestampUnix,
      windowEndUnix: gustHours[gustHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote: 'Limiar fixo de segurança para rajadas de superfície >= 55 km/h.',
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
    const maxRain = (peak.precipitationMm.max ?? peak.precipitationMm.mean ?? 15).toFixed(1);
    derived.push({
      id: `ext_rain_${peak.timestampUnix}`,
      category: 'heavy_rain',
      severity: Number(maxRain) >= 30 ? 'extreme' : 'severe',
      title: `Chuva Intensa Horária (${maxRain} mm/h)`,
      summary: `Taxa horária elevada prevista em ${rainHours.length} janela(s) do horizonte de 7 dias.`,
      potentialDamages:
        'Alagamentos rápidos em vias urbanas/trilhas, enxurradas em encostas e perda severa de visibilidade horizontal.',
      recommendedAction:
        'Evite travessia de áreas alagáveis, vales estreitos e estradas não pavimentadas sob chuva forte.',
      metricBadge: `${maxRain} mm/h`,
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: rainHours[0]!.timestampUnix,
      windowEndUnix: rainHours[rainHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote: 'Alerta automático para precipitação horária >= 15 mm/h.',
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
    const delta = (peak.pressureDelta3hHpa ?? -4).toFixed(1);
    derived.push({
      id: `ext_squall_${peak.timestampUnix}`,
      category: 'pressure_squall',
      severity: 'severe',
      title: `Queda Barométrica Brusca / Linha de Instabilidade (${delta} hPa/3h)`,
      summary: ' Despressurização rápida na superfície sinalizando passagem frontal ou squall.',
      potentialDamages:
        'Mudança repentina na direção do vento (rondada brusca), entrada súbita de rajadas e agitação marítima rápida.',
      recommendedAction:
        'Antecipe recolhimento de equipamentos sensíveis antes da virada do tempo.',
      metricBadge: `ΔP ${delta} hPa/3h`,
      peakTimestampUnix: peak.timestampUnix,
      windowStartUnix: squallHours[0]!.timestampUnix,
      windowEndUnix: squallHours[squallHours.length - 1]!.timestampUnix,
      sourceName: 'Open-Meteo Multi-Model (ECMWF / NOAA GFS / DWD ICON / ECCC GEM)',
      sourceUrl: 'https://open-meteo.com/en/docs',
      methodologyNote: 'Gatilho físico ΔP/3h <= -4.0 hPa.',
    });
  }

  // 5. Coastal Swell >= 3.0 m
  if (forecast.marineAvailable) {
    const swellHours = scanHours.filter((h) => (h.marine?.waveHeight ?? 0) >= 3.0);
    if (swellHours.length > 0) {
      const peak = swellHours.reduce((best, cur) =>
        (cur.marine?.waveHeight ?? 0) > (best.marine?.waveHeight ?? 0) ? cur : best,
      );
      const maxWave = (peak.marine?.waveHeight ?? 3.0).toFixed(1);
      derived.push({
        id: `ext_wave_${peak.timestampUnix}`,
        category: 'coastal_swell',
        severity: Number(maxWave) >= 4.5 ? 'extreme' : 'severe',
        title: `Ressaca / Mar Grosso Costeiro (Ondas de ${maxWave} m)`,
        summary: `${swellHours.length}h com altura significativa de onda igual ou superior a 3.0 m.`,
        potentialDamages:
          'Arrebentação forte em costões e praias, risco à navegação de pequeno porte e sobrelevação costeira.',
        recommendedAction:
          'Evite costões rochosos, barras de entrada expostas e consulte avisos de mau tempo da Marinha (DHN).',
        metricBadge: `Ondas ${maxWave} m`,
        peakTimestampUnix: peak.timestampUnix,
        windowStartUnix: swellHours[0]!.timestampUnix,
        windowEndUnix: swellHours[swellHours.length - 1]!.timestampUnix,
        sourceName: 'Open-Meteo Marine + Multi-Model Atmosférico',
        sourceUrl: 'https://open-meteo.com/en/docs/marine-weather-api',
        methodologyNote: 'Altura significativa de onda (Hs) >= 3.0 m na grade costeira.',
      });
    }
  }

  return derived;
}

/**
 * Formats a `YYYY-MM-DD` local date key safely anchored at noon UTC (`12:00:00Z`)
 * so UTC-negative timezones NEVER shift the calendar day backward.
 */
function formatLocalCalendarRowLabel(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) {
    return 'Hoje';
  }
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(noonUtc.getTime())) {
    return ymd;
  }
  const formatted = noonUtc.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
  return formatted.replace('.', '');
}

function formatAlertWindowBadge(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    return d.toLocaleString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return formatLocalHourBadge(timestampUnix, timezone);
  }
}

function formatTimeIsoHHMM(iso: string | null | undefined, timezone?: string): string {
  if (!iso) {
    return '—';
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso.slice(11, 16) || '—';
    }
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
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
  savedLocations: propSavedLocations,
  isLoading = false,
  viewMode: propViewMode,
  onViewModeChange: propOnViewModeChange,
  thresholds,
  onSaveThresholds,
  onSelectLocation: propOnSelectLocation,
  onSaveLocation: propOnSaveLocation,
  onRequestGps: propOnRequestGps,
  onOpenLocationsModal,
  onReloadForecast,
  onToast,
  onErrorLog,
  isPrimaryLocation = false,
  onSetPrimaryLocation,
  onNavigateTab,
}) => {
  const locationCtx = useAppLocationContext();
  const resolvedOnSelectLocation = propOnSelectLocation ?? locationCtx?.onSelectLocation;
  const resolvedOnSaveLocation = propOnSaveLocation ?? locationCtx?.onSaveLocation;
  const resolvedOnRequestGps = propOnRequestGps ?? locationCtx?.onRequestGps;
  const resolvedSavedLocations = propSavedLocations ?? locationCtx?.savedLocations ?? [];
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
    () => (forecast ? deriveDeterministicExtremeEvents(forecast, currentLocalHourIndex) : []),
    [forecast, currentLocalHourIndex],
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

    return Array.from(groups.values())
      .slice(0, 7)
      .map((g) => ({
        ymd: g.ymd,
        label: formatLocalCalendarRowLabel(g.ymd, realNowLocalYmd),
        minTempC: g.temps.length > 0 ? Math.round(Math.min(...g.temps)) : null,
        maxTempC: g.temps.length > 0 ? Math.round(Math.max(...g.temps)) : null,
        rainMmTotal: Math.round(g.rainMmTotal * 10) / 10,
        maxRainProbPct: Math.round(g.maxRainProb),
        maxWindKmh: Math.round(g.maxWindKmh),
        maxCloudPct: Math.round(g.maxCloudPct),
        thunderstormRisk: g.worstStorm,
      }));
  }, [forecast, activeSummaryModel, realNowLocalYmd]);

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
          Nenhuma previsão carregada para {activeLocation.name}
        </p>
        <p className="text-xs text-slate-600 dark:text-sky-200">
          Verifique sua conexão ou selecione uma localidade salva no mapa.
        </p>
        {onReloadForecast && (
          <button
            type="button"
            onClick={() => void onReloadForecast()}
            className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-full text-xs font-bold bg-[#0080cd] hover:bg-[#006bb3] text-white transition-colors"
          >
            Tentar Novamente
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
      label: 'Janela Segura',
      dot: 'bg-emerald-500',
      box: 'border-emerald-200 bg-emerald-50/85 text-emerald-900 dark:border-emerald-700/70 dark:bg-emerald-950/55 dark:text-emerald-100',
    },
    amber: {
      label: 'Atenção Moderada',
      dot: 'bg-amber-500',
      box: 'border-amber-200 bg-amber-50/85 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/55 dark:text-amber-100',
    },
    red: {
      label: 'Fora dos Limites',
      dot: 'bg-rose-500',
      box: 'border-rose-200 bg-rose-50/85 text-rose-900 dark:border-rose-700/70 dark:bg-rose-950/55 dark:text-rose-100',
    },
  };

  const stormBadgeMeta: Record<
    ThunderstormRiskLevel,
    { label: string; className: string }
  > = {
    none: {
      label: 'Baixo',
      className:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/70',
    },
    moderate: {
      label: 'Moderado',
      className:
        'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/70',
    },
    high: {
      label: 'Alto',
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

  return (
    <ModuleErrorBoundary
      moduleName="Resumo Diário (FieldCast V4)"
      onReset={onReloadForecast}
      onErrorLog={onErrorLog}
    >
      <div data-testid="daily-summary-tab" className="space-y-4 sm:space-y-5">
        {/* 1. Model Selector Pill Bar */}
        <section
          data-testid="summary-model-selector"
          aria-label="Fonte do Modelo Meteorológico"
          className="rounded-2xl border border-sky-200/85 dark:border-sky-800/75 bg-white dark:bg-[#132a47] p-3 sm:p-3.5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2 shrink-0">
            <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-900/60 text-[#0080cd] dark:text-sky-300 border border-sky-200/70 dark:border-sky-700/60">
              <Layers className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <span className="text-xs font-extrabold text-slate-900 dark:text-white block">
                Modelo Ativo no Resumo
              </span>
              <span className="text-[11px] text-slate-500 dark:text-sky-200/75 block">
                Altere entre o Consenso FieldCast e cada modelo global individual
              </span>
            </div>
          </div>

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
                  className={`min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-xl text-left inline-flex items-center gap-2 shrink-0 border transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isSelected
                      ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                      : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                  }`}
                >
                  {opt.id === 'fieldcast' ? (
                    <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <div>
                    <span className="block text-xs font-bold leading-tight">{opt.label}</span>
                    <span
                      className={`block text-[10px] leading-tight ${
                        isSelected ? 'text-sky-100' : 'text-slate-500 dark:text-sky-300/75'
                      }`}
                    >
                      {opt.sublabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Global Extreme Events Span (Always visible regardless of custom thresholds) */}
        <section
          data-testid="global-extreme-events-span"
          aria-label="Monitoramento Global de Eventos Extremos"
          className={`rounded-2xl border p-4 shadow-sm space-y-3 transition-colors ${
            hasExtremeAlerts
              ? primaryExtremeAlert?.severity === 'extreme'
                ? 'border-rose-300 bg-rose-50/95 dark:border-rose-700 dark:bg-rose-950/55 text-rose-950 dark:text-rose-100'
                : 'border-amber-300 bg-amber-50/95 dark:border-amber-700 dark:bg-amber-950/55 text-amber-950 dark:text-amber-100'
              : 'border-emerald-200 bg-emerald-50/85 dark:border-emerald-800/80 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className={`p-2.5 rounded-xl shrink-0 border ${
                  hasExtremeAlerts
                    ? primaryExtremeAlert?.severity === 'extreme'
                      ? 'bg-rose-500 text-white border-rose-600'
                      : 'bg-amber-500 text-slate-950 border-amber-600'
                    : 'bg-emerald-500 text-white border-emerald-600'
                }`}
              >
                {hasExtremeAlerts ? (
                  <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                )}
              </div>

              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs sm:text-sm font-extrabold">
                    {hasExtremeAlerts && primaryExtremeAlert
                      ? primaryExtremeAlert.title
                      : 'Condições sem Eventos Extremos Severos Previstos'}
                  </span>
                  {hasExtremeAlerts && primaryExtremeAlert && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-white/85 dark:bg-slate-900/75 border border-current/20">
                      {primaryExtremeAlert.metricBadge}
                    </span>
                  )}
                  {extremeAlerts.length > 1 && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/80 dark:bg-slate-900/70">
                      +{extremeAlerts.length - 1} alerta(s)
                    </span>
                  )}
                </div>

                <p className="text-xs leading-relaxed opacity-90">
                  {hasExtremeAlerts && primaryExtremeAlert ? (
                    <>
                      <strong>Danos potenciais:</strong> {primaryExtremeAlert.potentialDamages}{' '}
                      <span className="font-semibold">
                        (Pico:{' '}
                        {formatAlertWindowBadge(
                          primaryExtremeAlert.peakTimestampUnix,
                          forecast.timezone,
                        )}
                        )
                      </span>
                    </>
                  ) : (
                    'Nenhum gatilho de tempestade elétrica severa, rajada >= 55 km/h, chuva >= 15 mm/h, queda barométrica brusca ou ressaca >= 3.0 m detectado.'
                  )}
                </p>

                <p className="text-[11px] font-semibold opacity-80">
                  {primaryExtremeAlert?.sourceName
                    ? `Fonte Oficial: ${primaryExtremeAlert.sourceName}`
                    : OFFICIAL_MULTI_MODEL_SOURCE}
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="extreme-events-details-toggle"
              onClick={() => setIsExtremeDetailsOpen((prev) => !prev)}
              aria-expanded={isExtremeDetailsOpen}
              className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 shrink-0 bg-white/90 hover:bg-white dark:bg-[#0d1f36]/90 dark:hover:bg-[#0d1f36] text-slate-900 dark:text-sky-100 border border-slate-200/90 dark:border-sky-700/80 shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <span>{isExtremeDetailsOpen ? 'Ocultar Detalhes' : 'Mais Detalhes'}</span>
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
                        <strong>Impactos / Danos:</strong> {alert.potentialDamages}
                      </p>
                      <p className="text-[11px]">
                        <strong>Recomendação:</strong> {alert.recommendedAction}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-sky-300/75">
                        Fonte: {alert.sourceName} • {alert.methodologyNote}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                    Tendência Barométrica (ΔP / 3h)
                  </span>
                  <p className="font-extrabold text-slate-900 dark:text-white">
                    {activeMetrics?.pressureHpa !== null && activeMetrics?.pressureHpa !== undefined
                      ? `${Math.round(activeMetrics.pressureHpa)} hPa`
                      : '—'}{' '}
                    •{' '}
                    <span>
                      Δ3h:{' '}
                      {selectedEnsembleHour?.pressureDelta3hHpa !== null &&
                      selectedEnsembleHour?.pressureDelta3hHpa !== undefined
                        ? `${selectedEnsembleHour.pressureDelta3hHpa >= 0 ? '+' : ''}${selectedEnsembleHour.pressureDelta3hHpa.toFixed(1)} hPa`
                        : 'Estável'}
                    </span>
                  </p>
                </div>

                <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                    Convecção / CAPE &amp; Trovoada
                  </span>
                  <p className="font-extrabold text-slate-900 dark:text-white">
                    Risco {currentStormMeta.label}
                    {activeMetrics?.capeJkg !== null && activeMetrics?.capeJkg !== undefined
                      ? ` • CAPE ${Math.round(activeMetrics.capeJkg)} J/kg`
                      : ''}
                  </p>
                </div>

                <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                    Visibilidade &amp; Nevoeiro
                  </span>
                  <p className="font-extrabold text-slate-900 dark:text-white">
                    {activeMetrics?.visibilityM !== null && activeMetrics?.visibilityM !== undefined
                      ? `${(activeMetrics.visibilityM / 1000).toFixed(1)} km`
                      : 'Boa'}{' '}
                    • {selectedEnsembleHour?.fogRisk ? 'Risco de Nevoeiro' : 'Sem Nevoeiro'}
                  </p>
                </div>

                <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    Confiabilidade ({Math.round(confidence.total)}/100)
                  </span>
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-sky-200">
                    Acordo {confidence.breakdown.modelAgreement.toFixed(0)}/50 • Fontes{' '}
                    {confidence.breakdown.sourceIntegrity.toFixed(0)}/30 • Prazo{' '}
                    {confidence.breakdown.timeHorizon.toFixed(0)}/20
                  </p>
                </div>

                <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                    <Mountain className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
                    Altitude Oficial DEM
                  </span>
                  <p className="font-extrabold text-slate-900 dark:text-white">
                    {Math.round(forecast.elevationDemM)} m (Modelo Digital Open-Meteo)
                  </p>
                </div>

                <div className="rounded-xl bg-white/95 dark:bg-[#0d1f36]/95 border border-slate-200/80 dark:border-sky-800 p-3 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-sky-300 flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5 text-sky-500" aria-hidden="true" />
                    Efemérides do Dia
                  </span>
                  <p className="font-extrabold text-slate-900 dark:text-white">
                    {activeEphemeris
                      ? `Sol ${formatTimeIsoHHMM(activeEphemeris.sunriseIso, forecast.timezone)}–${formatTimeIsoHHMM(activeEphemeris.sunsetIso, forecast.timezone)} • ${activeEphemeris.moonPhaseLabel} (${Math.round(activeEphemeris.moonIlluminationPct)}%)`
                      : 'Efemérides locais indisponíveis'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 3. Hero Daily Card */}
        <section
          data-testid="hero-daily-card"
          aria-label="Resumo Principal do Dia"
          className="rounded-3xl border border-slate-200/90 dark:border-sky-800/75 bg-gradient-to-br from-white via-[#f8fbff] to-sky-50/75 dark:from-[#132a47] dark:via-[#10243e] dark:to-[#0d1f36] p-5 sm:p-6 shadow-sm space-y-5"
        >
          {/* Header Row: Location + Pin Primary + Field Quality Score + Safe Window */}
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                {resolvedOpenLocationsModal ? (
                  <button
                    type="button"
                    onClick={resolvedOpenLocationsModal}
                    className="min-h-[44px] inline-flex items-center gap-2 text-left rounded-xl hover:text-[#0080cd] transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <MapPin className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white leading-tight">
                      {activeLocation.name}
                    </h1>
                  </button>
                ) : (
                  <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white leading-tight">
                    {activeLocation.name}
                  </h1>
                )}

                {isPrimaryLocation ? (
                  <span
                    data-testid="primary-location-badge"
                    className="min-h-[44px] px-3.5 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 border bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700/70"
                  >
                    <Star
                      className="w-3.5 h-3.5 fill-emerald-500 text-emerald-600 dark:text-emerald-300"
                      aria-hidden="true"
                    />
                    <span>Local Principal</span>
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
                            errorTitle: 'Não foi possível salvar o local principal',
                            onLoadingChange: setIsSettingPrimary,
                            onToast,
                          },
                        );
                      }}
                      className="min-h-[44px] min-w-[44px] px-3.5 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 border bg-white dark:bg-[#0d1f36] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-[#0070b8] dark:text-sky-200 border-sky-200 dark:border-sky-700 disabled:opacity-60 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <Star className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                      <span>Fixar Local Principal</span>
                    </button>
                  )
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/70">
                  <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span>
                    {isInspectingOtherHour
                      ? `Horário ${displayedHourHHMM}`
                      : `Agora • ${displayedHourHHMM}`}
                  </span>
                </span>

                {isInspectingOtherHour && (
                  <button
                    type="button"
                    onClick={() => setManualHourIndex(null)}
                    className="min-h-[44px] px-3 py-1 rounded-full text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors"
                  >
                    Voltar para Agora ({currentNowHHMM})
                  </button>
                )}

                <span className="px-2.5 py-1 rounded-full font-semibold bg-sky-50 dark:bg-[#0d1f36] text-[#0070b8] dark:text-sky-200 border border-sky-200/80 dark:border-sky-800">
                  {activeModelDisplayLabel}
                </span>

                <span className="px-2.5 py-1 rounded-full font-medium bg-slate-100 dark:bg-[#0d1f36] text-slate-600 dark:text-sky-200">
                  Alt. DEM {Math.round(forecast.elevationDemM)}m
                </span>
              </div>
            </div>

            {/* Right Status Badges: Field Quality Score (0-100) + Safe Window + Thresholds Button */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div
                data-testid="field-quality-score"
                className={`min-h-[44px] px-3.5 py-2 rounded-2xl border inline-flex items-center gap-2 ${quality.badgeClass}`}
              >
                <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                <div className="text-left leading-tight">
                  <span className="block text-[10px] font-semibold opacity-80">
                    Qualidade de Campo
                  </span>
                  <span className="block text-xs font-extrabold">
                    {quality.score}/100 • {quality.label}
                  </span>
                </div>
              </div>

              <div
                className={`min-h-[44px] px-2.5 py-1 rounded-2xl border inline-flex items-center gap-2 ${currentSafeMeta.box}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${currentSafeMeta.dot}`} />
                <span className="text-xs font-extrabold">{currentSafeMeta.label}</span>
                <button
                  type="button"
                  data-testid="open-thresholds-btn"
                  onClick={() => setIsThresholdModalOpen(true)}
                  aria-label="Personalizar limites da Janela Segura"
                  className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#132a47] hover:bg-sky-50 text-slate-700 dark:text-sky-100 border border-slate-200 dark:border-sky-700 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Sliders className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <span>Limites</span>
                </button>
              </div>
            </div>
          </div>

          {/* Center Hero Temperature + Everyday Metrics Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Large Current Temperature + Min/Max + Apparent */}
            <div className="lg:col-span-5 rounded-2xl border border-sky-100 dark:border-sky-800/80 bg-white dark:bg-[#0d1f36]/90 p-4 sm:p-5 flex items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <WeatherConditionIcon
                    thunderstormRisk={activeMetrics?.thunderstormRisk ?? 'none'}
                    precipMm={activeMetrics?.precipMm ?? null}
                    precipProbPct={activeMetrics?.precipProbPct ?? null}
                    cloudPct={activeMetrics?.cloudCoverPct ?? null}
                    className="w-9 h-9"
                  />
                  <span
                    data-testid="hero-current-temp"
                    className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white"
                  >
                    {activeMetrics?.tempC !== null && activeMetrics?.tempC !== undefined
                      ? `${Math.round(activeMetrics.tempC)}°C`
                      : '—'}
                  </span>
                </div>

                <p className="text-xs font-semibold text-slate-600 dark:text-sky-200">
                  Sensação térmica:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {activeMetrics?.apparentTempC !== null &&
                    activeMetrics?.apparentTempC !== undefined
                      ? `${activeMetrics.apparentTempC.toFixed(1)}°C`
                      : '—'}
                  </strong>
                </p>
              </div>

              <div className="text-right space-y-1.5 shrink-0">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-sky-300/80 block">
                  Hoje (Mín / Máx)
                </span>
                <div className="flex items-center justify-end gap-2.5 text-base sm:text-lg font-extrabold">
                  <span className="inline-flex items-center gap-0.5 text-[#0080cd] dark:text-sky-400">
                    <ArrowDown className="w-4 h-4" aria-hidden="true" />
                    {activeDayMinMax.min !== null ? `${activeDayMinMax.min}°` : '—'}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-orange-500 dark:text-orange-400">
                    <ArrowUp className="w-4 h-4" aria-hidden="true" />
                    {activeDayMinMax.max !== null ? `${activeDayMinMax.max}°` : '—'}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                  Nuvens:{' '}
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
                  <span>Umidade</span>
                </span>
                <div>
                  <span className="text-xl font-extrabold text-slate-900 dark:text-white block">
                    {activeMetrics?.relativeHumidityPct !== null &&
                    activeMetrics?.relativeHumidityPct !== undefined
                      ? `${activeMetrics.relativeHumidityPct}%`
                      : '—'}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                    Orvalho{' '}
                    {activeMetrics?.dewPointC !== null && activeMetrics?.dewPointC !== undefined
                      ? `${activeMetrics.dewPointC.toFixed(0)}°C`
                      : '—'}
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
                  <span>Chuva</span>
                </span>
                <div>
                  <span className="text-xl font-extrabold text-slate-900 dark:text-white block">
                    {activeMetrics?.precipProbPct !== null &&
                    activeMetrics?.precipProbPct !== undefined
                      ? `${Math.round(activeMetrics.precipProbPct)}%`
                      : '0%'}
                  </span>
                  <span className="text-[11px] font-semibold text-[#0070b8] dark:text-sky-300 block">
                    Taxa:{' '}
                    {activeMetrics?.precipMm !== null && activeMetrics?.precipMm !== undefined
                      ? `${activeMetrics.precipMm.toFixed(1)} mm/h`
                      : '0.0 mm/h'}
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
                  <span>Trovoada</span>
                </span>
                <div className="space-y-1">
                  <span
                    data-testid="thunderstorm-risk-badge"
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${currentStormMeta.className}`}
                  >
                    {currentStormMeta.label}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-sky-300/75 block">
                    Pressão{' '}
                    {activeMetrics?.pressureHpa !== null &&
                    activeMetrics?.pressureHpa !== undefined
                      ? `${Math.round(activeMetrics.pressureHpa)} hPa`
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Wind 10m + Gusts */}
              <div
                data-testid="hero-wind-card"
                className="rounded-2xl border border-slate-200/85 dark:border-sky-800/75 bg-white dark:bg-[#0d1f36]/90 p-3.5 flex flex-col justify-between gap-2"
              >
                <span className="text-xs font-bold text-slate-600 dark:text-sky-200 inline-flex items-center gap-1.5">
                  <Wind className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                  <span>Vento 10m</span>
                </span>
                <div>
                  <span className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white block">
                    {activeMetrics?.windSpeed10mKmh !== null &&
                    activeMetrics?.windSpeed10mKmh !== undefined
                      ? `${Math.round(activeMetrics.windSpeed10mKmh)} km/h`
                      : '—'}{' '}
                    <span className="text-xs font-bold text-[#0070b8] dark:text-sky-300">
                      {degreesToCardinalShort(activeMetrics?.windDir10mDeg)}
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-300 block">
                    Rajadas:{' '}
                    {activeMetrics?.windGusts10mKmh !== null &&
                    activeMetrics?.windGusts10mKmh !== undefined
                      ? `${Math.round(activeMetrics.windGusts10mKmh)} km/h`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {forecast.marineAvailable && selectedEnsembleHour?.marine && (
            <div className="rounded-2xl border border-sky-100 dark:border-sky-800/75 bg-sky-50/70 dark:bg-[#0d1f36]/75 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Waves className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                <span className="font-bold text-slate-800 dark:text-white">
                  Condição Costeira: Ondas{' '}
                  {selectedEnsembleHour.marine.waveHeight !== null
                    ? `${selectedEnsembleHour.marine.waveHeight.toFixed(1)} m`
                    : '—'}{' '}
                  ({selectedEnsembleHour.marine.wavePeriod !== null
                    ? `${Math.round(selectedEnsembleHour.marine.wavePeriod)}s`
                    : '—'}{' '}
                  • {degreesToCardinalShort(selectedEnsembleHour.marine.waveDirection)})
                </span>
                {typeof selectedEnsembleHour.marine.seaLevelHeightMsl === 'number' &&
                  Number.isFinite(selectedEnsembleHour.marine.seaLevelHeightMsl) && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800">
                      Maré Est. MSL: {selectedEnsembleHour.marine.seaLevelHeightMsl >= 0 ? '+' : ''}
                      {selectedEnsembleHour.marine.seaLevelHeightMsl.toFixed(2)} m
                    </span>
                  )}
              </div>
              {typeof selectedEnsembleHour.marine.seaLevelHeightMsl === 'number' &&
                Number.isFinite(selectedEnsembleHour.marine.seaLevelHeightMsl) && (
                  <span className="text-[11px] text-slate-500 dark:text-sky-200/80">
                    Estimativa MSL (~8 km) não substitui tábua oficial da DHN / Marinha.
                  </span>
                )}
            </div>
          )}
        </section>

        {/* 4. 24-Hour Horizontal Forecast Strip */}
        <section
          data-testid="hourly-24h-strip"
          aria-label="Previsão das Próximas 24 Horas"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/75 bg-white dark:bg-[#132a47] p-4 sm:p-5 shadow-sm space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Próximas 24 Horas
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-sky-200/75">
              Toque em qualquer horário para atualizar o cartão principal
            </span>
          </div>

          <div className="min-w-0 overflow-x-auto scrollbar-thin pb-1">
            <div className="flex items-stretch gap-2.5 min-w-max">
              {next24Hours.map((item) => {
                const m = item.metrics;
                return (
                  <button
                    key={item.timestampUnix}
                    type="button"
                    onClick={() =>
                      setManualHourIndex(item.isCurrentHour ? null : item.absoluteIndex)
                    }
                    aria-pressed={item.isSelectedHour}
                    className={`min-h-[44px] min-w-[84px] p-3 rounded-2xl border text-center flex flex-col items-center justify-between gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      item.isSelectedHour
                        ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-md'
                        : item.isCurrentHour
                          ? 'bg-amber-50/90 dark:bg-amber-950/45 text-slate-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                          : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-800 dark:text-sky-100 border-slate-200/80 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50'
                    }`}
                  >
                    <span className="text-[11px] font-extrabold leading-none">
                      {item.isCurrentHour ? 'Agora' : item.hourLabel}
                    </span>

                    <WeatherConditionIcon
                      thunderstormRisk={m?.thunderstormRisk ?? 'none'}
                      precipMm={m?.precipMm ?? null}
                      precipProbPct={m?.precipProbPct ?? null}
                      cloudPct={m?.cloudCoverPct ?? null}
                      className={`w-5 h-5 ${item.isSelectedHour ? '!text-white' : ''}`}
                    />

                    <span className="text-sm font-extrabold">
                      {m?.tempC !== null && m?.tempC !== undefined
                        ? `${Math.round(m.tempC)}°`
                        : '—'}
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
                        ? `${m.precipMm.toFixed(1)}mm`
                        : '0mm'}
                    </span>

                    <span
                      className={`text-[10px] font-semibold leading-tight ${
                        item.isSelectedHour
                          ? 'text-white/90'
                          : 'text-slate-600 dark:text-sky-200/80'
                      }`}
                    >
                      {m?.windSpeed10mKmh !== null && m?.windSpeed10mKmh !== undefined
                        ? `${Math.round(m.windSpeed10mKmh)}km/h ${degreesToCardinalShort(m.windDir10mDeg)}`
                        : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 5. 7-Day Daily Forecast List (Local Timezone Grouped) */}
        <section
          data-testid="daily-7d-list"
          aria-label="Previsão Diária de 7 Dias"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/75 bg-white dark:bg-[#132a47] p-4 sm:p-5 shadow-sm space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                Próximos 7 Dias ({activeModelDisplayLabel})
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-sky-200/75">
              Agrupamento no fuso horário local ({forecast.timezone})
            </span>
          </div>

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
                        title={`Risco de trovoada: ${day.thunderstormRisk === 'high' ? 'Alto' : 'Moderado'}`}
                        className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 shrink-0"
                      >
                        ⚡
                      </span>
                    )}
                  </div>

                  {/* Max Rain Prob % + Total Rain mm */}
                  <div className="col-span-3 sm:col-span-3 flex items-center gap-1.5 text-slate-700 dark:text-sky-200">
                    <Droplets className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <span className="font-bold text-[#0070b8] dark:text-sky-300">
                      {day.maxRainProbPct}%
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-sky-300/75">
                      ({day.rainMmTotal.toFixed(1)} mm)
                    </span>
                  </div>

                  {/* Max Wind km/h */}
                  <div className="hidden sm:flex sm:col-span-2 items-center gap-1 text-slate-600 dark:text-sky-200">
                    <Wind className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    <span className="font-semibold">{day.maxWindKmh} km/h</span>
                  </div>

                  {/* Min / Max Temp Range Bar */}
                  <div className="col-span-5 sm:col-span-4 flex items-center gap-2">
                    <span className="w-7 text-right font-bold text-[#0080cd] dark:text-sky-300 shrink-0">
                      {day.minTempC !== null ? `${day.minTempC}°` : '—'}
                    </span>
                    <div className="relative flex-1 h-2 rounded-full bg-slate-200/90 dark:bg-[#0d1f36] overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-[#0080cd] via-amber-400 to-orange-500"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="w-7 text-left font-extrabold text-orange-600 dark:text-orange-300 shrink-0">
                      {day.maxTempC !== null ? `${day.maxTempC}°` : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 6. Interactive Location Mini-Map + Quick CTA to Model Comparison & Charts */}
        <section className="space-y-3">
          <ForecastPinMiniMap
            activeLocation={activeLocation}
            savedLocations={resolvedSavedLocations}
            forecast={forecast}
            viewMode={activeSummaryModel}
            selectedHourIndex={safeHourIndex}
            currentWindSpeedKmh={activeMetrics?.windSpeed10mKmh ?? null}
            currentWindDirectionDeg={activeMetrics?.windDir10mDeg ?? null}
            onSelectLocation={resolvedOnSelectLocation}
            onSaveLocation={resolvedOnSaveLocation}
            onRequestGps={resolvedOnRequestGps}
            onToast={onToast}
          />

          <div className="rounded-2xl border border-sky-200/90 dark:border-sky-800/80 bg-gradient-to-r from-sky-50 via-white to-sky-50 dark:from-[#0d1f36] dark:via-[#132a47] dark:to-[#0d1f36] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[#0080cd] text-white shrink-0">
                <GitCompare className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Análise Especialista Multi-Modelo &amp; Tabela Windguru
                </h3>
                <p className="text-xs text-slate-600 dark:text-sky-200/80">
                  Compare ECMWF, GFS, ICON e GEM lado a lado, ative gráficos sob demanda e veja as 168h completas.
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="goto-comparison-btn"
              onClick={() => onNavigateTab?.('comparison')}
              className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-full text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 bg-[#0080cd] hover:bg-[#006bb3] text-white shadow-sm shrink-0 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <Thermometer className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
              <span>Abrir Comparação Multi-Modelo &amp; Gráficos (168h)</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
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
