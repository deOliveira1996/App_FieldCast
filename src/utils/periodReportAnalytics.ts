import type { HistoricalHourRecord } from '../types/field';
import type { EnsembleHour } from '../types/weather';
import { computeCircularStat } from './ensembleMath';
import { formatLocalYMD } from './localTimeHour';

export type DayPeriodId = 'madrugada' | 'manha' | 'tarde' | 'noite';

export interface DayPeriodDefinition {
  id: DayPeriodId;
  label: string;
  rangeLabel: string;
  startHour: number;
  endHour: number;
}

export const DAY_PERIOD_DEFINITIONS: DayPeriodDefinition[] = [
  { id: 'madrugada', label: 'Madrugada', rangeLabel: '00h–05h', startHour: 0, endHour: 5 },
  { id: 'manha', label: 'Manhã', rangeLabel: '06h–11h', startHour: 6, endHour: 11 },
  { id: 'tarde', label: 'Tarde', rangeLabel: '12h–17h', startHour: 12, endHour: 17 },
  { id: 'noite', label: 'Noite', rangeLabel: '18h–23h', startHour: 18, endHour: 23 },
];

export interface DayPeriodMetricSummary {
  periodId: DayPeriodId;
  label: string;
  rangeLabel: string;
  sampleHours: number;
  meanTempC: number | null;
  minTempC: number | null;
  maxTempC: number | null;
  meanHumidityPct: number | null;
  totalPrecipMm: number;
  rainyDaysCount: number;
  meanWindKmh: number | null;
  maxGustKmh: number | null;
  prevailingWindDeg: number | null;
  windPersistenceR: number | null;
  meanPressureHpa: number | null;
  dominantSummary: string;
}

export interface DailyProvenanceSummary {
  dateIso: string;
  provenanceLabel: string;
  hoursCount: number;
  minTempC: number | null;
  maxTempC: number | null;
  totalPrecipMm: number;
  maxWindKmh: number | null;
  maxGustKmh: number | null;
  meanHumidityPct: number | null;
  predominantPeriodSummary: string;
}

export interface MultiDayPeriodReport {
  startDateIso: string;
  endDateIso: string;
  totalDays: number;
  totalHours: number;
  periods: DayPeriodMetricSummary[];
  dailyRows: DailyProvenanceSummary[];
  methodologyNote: string;
}

export interface SingleDayHourlyPointRow {
  timestampUnix: number;
  hhmm: string;
  periodId: DayPeriodId;
  periodLabel: string;
  temperatureC: number | null;
  humidityPct: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  precipMm: number;
  pressureHpa: number | null;
}

export interface SingleDayPointLog {
  dateIso: string;
  found: boolean;
  provenanceLabel: string;
  hoursCount: number;
  minTempC: number | null;
  maxTempC: number | null;
  meanTempC: number | null;
  totalPrecipMm: number;
  meanHumidityPct: number | null;
  meanWindKmh: number | null;
  maxGustKmh: number | null;
  prevailingWindDeg: number | null;
  periods: DayPeriodMetricSummary[];
  hourlyRows: SingleDayHourlyPointRow[];
}

interface UnifiedPeriodSample {
  timestampUnix: number;
  localDateIso: string;
  localHour: number;
  temperatureC: number | null;
  humidityPct: number | null;
  precipMm: number;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirectionDeg: number | null;
  pressureHpa: number | null;
  provenanceLabel: string;
}

export function classifyDayPeriod(localHour: number): DayPeriodDefinition {
  const normalized = ((Math.floor(localHour) % 24) + 24) % 24;
  if (normalized <= 5) return DAY_PERIOD_DEFINITIONS[0];
  if (normalized <= 11) return DAY_PERIOD_DEFINITIONS[1];
  if (normalized <= 17) return DAY_PERIOD_DEFINITIONS[2];
  return DAY_PERIOD_DEFINITIONS[3];
}

function resolveLocalHourInTimezone(timestampUnix: number, timezone?: string): number {
  const date = new Date(timestampUnix * 1000);
  if (timezone && timezone !== 'auto') {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date);
      const hourStr = parts.find((p) => p.type === 'hour')?.value;
      const parsed = hourStr ? Number(hourStr) : NaN;
      if (Number.isFinite(parsed)) {
        return parsed % 24;
      }
    } catch {
      // Fallback para hora local do dispositivo
    }
  }
  return date.getHours();
}

function resolveLocalHHMM(timestampUnix: number, timezone?: string): string {
  const date = new Date(timestampUnix * 1000);
  if (timezone && timezone !== 'auto') {
    try {
      const hhmm = new Intl.DateTimeFormat('pt-BR', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(date);
      if (hhmm) return hhmm;
    } catch {
      // Fallback abaixo
    }
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function finiteAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function toSamplesFromHistorical(
  hours: HistoricalHourRecord[],
  timezone?: string,
  provenanceMap?: Record<string, string>,
): UnifiedPeriodSample[] {
  return hours.map((h) => {
    const localDateIso = formatLocalYMD(new Date(h.timestampUnix * 1000), timezone);
    const localHour = resolveLocalHourInTimezone(h.timestampUnix, timezone);
    const provenanceLabel =
      provenanceMap?.[localDateIso] ??
      h.source ??
      'Open-Meteo Archive / NWP';
    return {
      timestampUnix: h.timestampUnix,
      localDateIso,
      localHour,
      temperatureC: h.temperature2mC,
      humidityPct: h.relativeHumidity2mPct ?? null,
      precipMm:
        typeof h.precipitationMm === 'number' && Number.isFinite(h.precipitationMm)
          ? h.precipitationMm
          : 0,
      windSpeedKmh: h.windSpeed10mKmh,
      windGustKmh: h.windGusts10mKmh,
      windDirectionDeg: h.windDirection10mDeg,
      pressureHpa: h.surfacePressureHpa,
      provenanceLabel,
    };
  });
}

export type ForecastPeriodHourInput = Pick<
  EnsembleHour,
  | 'timestampUnix'
  | 'temperature2mC'
  | 'relativeHumidity2mPct'
  | 'precipitationMm'
  | 'windSpeed10m'
  | 'windGusts10m'
  | 'windDirection10m'
  | 'surfacePressureHpa'
>;

function toSamplesFromEnsemble(
  hours: readonly ForecastPeriodHourInput[],
  timezone?: string,
  provenanceMap?: Record<string, string>,
): UnifiedPeriodSample[] {
  return hours.map((h) => {
    const localDateIso = formatLocalYMD(new Date(h.timestampUnix * 1000), timezone);
    const localHour = resolveLocalHourInTimezone(h.timestampUnix, timezone);
    return {
      timestampUnix: h.timestampUnix,
      localDateIso,
      localHour,
      temperatureC: h.temperature2mC.mean,
      humidityPct: h.relativeHumidity2mPct?.mean ?? null,
      precipMm:
        typeof h.precipitationMm.mean === 'number' && Number.isFinite(h.precipitationMm.mean)
          ? h.precipitationMm.mean
          : 0,
      windSpeedKmh: h.windSpeed10m.mean,
      windGustKmh: h.windGusts10m.mean,
      windDirectionDeg: h.windDirection10m.degree,
      pressureHpa: h.surfacePressureHpa.mean,
      provenanceLabel: provenanceMap?.[localDateIso] ?? 'Ensemble Multi-Modelo (Open-Meteo)',
    };
  });
}

export function formatCompassSector(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return 'N/D';
  const sectors = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return `${sectors[idx]} (${Math.round(deg)}°)`;
}

function buildPeriodSummary(
  def: DayPeriodDefinition,
  samples: UnifiedPeriodSample[],
): DayPeriodMetricSummary {
  const temps = samples
    .map((s) => s.temperatureC)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const rhs = samples
    .map((s) => s.humidityPct)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const winds = samples
    .map((s) => s.windSpeedKmh)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const gusts = samples
    .map((s) => s.windGustKmh)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const dirs = samples
    .map((s) => s.windDirectionDeg)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const pressures = samples
    .map((s) => s.pressureHpa)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const totalPrecipMm = samples.reduce((acc, s) => acc + s.precipMm, 0);
  const rainyDaysSet = new Set<string>();
  const precipByDay = new Map<string, number>();
  for (const s of samples) {
    precipByDay.set(s.localDateIso, (precipByDay.get(s.localDateIso) ?? 0) + s.precipMm);
  }
  for (const [day, mm] of precipByDay.entries()) {
    if (mm >= 0.2) {
      rainyDaysSet.add(day);
    }
  }

  const circ = dirs.length > 0 ? computeCircularStat(dirs) : null;
  const meanTempC = finiteAverage(temps);
  const meanWindKmh = finiteAverage(winds);
  const maxGustKmh = gusts.length > 0 ? Math.max(...gusts) : null;

  const rainDescriptor =
    totalPrecipMm >= 10
      ? `chuva recorrente (${totalPrecipMm.toFixed(1)} mm em ${rainyDaysSet.size}d)`
      : totalPrecipMm >= 1
        ? `chuva leve/isolada (${totalPrecipMm.toFixed(1)} mm em ${rainyDaysSet.size}d)`
        : 'tempo predominantemente seco';

  const windDescriptor =
    meanWindKmh !== null
      ? `vento médio ${meanWindKmh.toFixed(1)} km/h ${formatCompassSector(circ?.degree ?? null)}`
      : 'vento N/D';

  const dominantSummary =
    samples.length === 0
      ? 'Sem amostras horárias neste turno.'
      : `${rainDescriptor}; ${windDescriptor}${meanTempC !== null ? `; T méd ${meanTempC.toFixed(1)} °C` : ''}.`;

  return {
    periodId: def.id,
    label: def.label,
    rangeLabel: def.rangeLabel,
    sampleHours: samples.length,
    meanTempC,
    minTempC: temps.length > 0 ? Math.min(...temps) : null,
    maxTempC: temps.length > 0 ? Math.max(...temps) : null,
    meanHumidityPct: finiteAverage(rhs),
    totalPrecipMm,
    rainyDaysCount: rainyDaysSet.size,
    meanWindKmh,
    maxGustKmh,
    prevailingWindDeg: circ ? circ.degree : null,
    windPersistenceR: circ ? circ.resultantLengthR : null,
    meanPressureHpa: finiteAverage(pressures),
    dominantSummary,
  };
}

function buildMultiDayReportFromSamples(
  samples: UnifiedPeriodSample[],
  methodologyNote: string,
): MultiDayPeriodReport {
  const sorted = [...samples].sort((a, b) => a.timestampUnix - b.timestampUnix);
  const periods = DAY_PERIOD_DEFINITIONS.map((def) =>
    buildPeriodSummary(
      def,
      sorted.filter((s) => s.localHour >= def.startHour && s.localHour <= def.endHour),
    ),
  );

  const byDay = new Map<string, UnifiedPeriodSample[]>();
  for (const s of sorted) {
    const arr = byDay.get(s.localDateIso);
    if (arr) arr.push(s);
    else byDay.set(s.localDateIso, [s]);
  }

  const dailyRows: DailyProvenanceSummary[] = Array.from(byDay.entries()).map(([dateIso, daySamples]) => {
    const temps = daySamples
      .map((s) => s.temperatureC)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const winds = daySamples
      .map((s) => s.windSpeedKmh)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const gusts = daySamples
      .map((s) => s.windGustKmh)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const rhs = daySamples
      .map((s) => s.humidityPct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const totalPrecipMm = daySamples.reduce((acc, s) => acc + s.precipMm, 0);

    // Identifica faixa horária mais crítica do dia (maior precipitação ou maior vento)
    let peakPeriod = DAY_PERIOD_DEFINITIONS[1];
    let peakScore = -1;
    for (const def of DAY_PERIOD_DEFINITIONS) {
      const pSamples = daySamples.filter(
        (s) => s.localHour >= def.startHour && s.localHour <= def.endHour,
      );
      if (pSamples.length === 0) continue;
      const pRain = pSamples.reduce((a, b) => a + b.precipMm, 0);
      const pWind = Math.max(0, ...pSamples.map((s) => s.windSpeedKmh ?? 0));
      const score = pRain * 3 + pWind * 0.25;
      if (score > peakScore) {
        peakScore = score;
        peakPeriod = def;
      }
    }

    const provenanceCounts = new Map<string, number>();
    for (const s of daySamples) {
      provenanceCounts.set(s.provenanceLabel, (provenanceCounts.get(s.provenanceLabel) ?? 0) + 1);
    }
    const provenanceLabel =
      Array.from(provenanceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Open-Meteo';

    return {
      dateIso,
      provenanceLabel,
      hoursCount: daySamples.length,
      minTempC: temps.length > 0 ? Math.min(...temps) : null,
      maxTempC: temps.length > 0 ? Math.max(...temps) : null,
      totalPrecipMm,
      maxWindKmh: winds.length > 0 ? Math.max(...winds) : null,
      maxGustKmh: gusts.length > 0 ? Math.max(...gusts) : null,
      meanHumidityPct: finiteAverage(rhs),
      predominantPeriodSummary:
        totalPrecipMm >= 0.5
          ? `Maior atividade em ${peakPeriod.label} (${peakPeriod.rangeLabel})`
          : `Estável; pico de vento em ${peakPeriod.label} (${peakPeriod.rangeLabel})`,
    };
  });

  const dates = dailyRows.map((d) => d.dateIso);
  return {
    startDateIso: dates[0] ?? '—',
    endDateIso: dates[dates.length - 1] ?? '—',
    totalDays: dailyRows.length,
    totalHours: sorted.length,
    periods,
    dailyRows,
    methodologyNote,
  };
}

export function computeHistoricalPeriodSummary(
  hours: HistoricalHourRecord[],
  timezone?: string,
  provenanceMap?: Record<string, string>,
): MultiDayPeriodReport {
  const samples = toSamplesFromHistorical(hours, timezone, provenanceMap);
  return buildMultiDayReportFromSamples(
    samples,
    'Visão pretérita híbrida: reanálise ERA5 (~0,25°, com latência ~5 dias) combinada a séries NWP recentes para os últimos 5 dias sem lacunas temporais.',
  );
}

export function computeForecastPeriodSummary(
  hours: readonly ForecastPeriodHourInput[],
  timezone?: string,
  provenanceMap?: Record<string, string>,
): MultiDayPeriodReport {
  const samples = toSamplesFromEnsemble(hours, timezone, provenanceMap);
  return buildMultiDayReportFromSamples(
    samples,
    'Projeção estendida por faixas horárias: média ponderada multi-modelo até +7/+10d e continuidade NOAA GFS Seamless até +16d (incerteza crescente após +7 dias).',
  );
}

export function extractSingleDayPointLog(
  hours: HistoricalHourRecord[],
  targetDateIso: string,
  timezone?: string,
  provenanceMap?: Record<string, string>,
): SingleDayPointLog {
  const samples = toSamplesFromHistorical(hours, timezone, provenanceMap).filter(
    (s) => s.localDateIso === targetDateIso,
  );
  samples.sort((a, b) => a.timestampUnix - b.timestampUnix);

  if (samples.length === 0) {
    return {
      dateIso: targetDateIso,
      found: false,
      provenanceLabel: 'Sem registros disponíveis para a data solicitada',
      hoursCount: 0,
      minTempC: null,
      maxTempC: null,
      meanTempC: null,
      totalPrecipMm: 0,
      meanHumidityPct: null,
      meanWindKmh: null,
      maxGustKmh: null,
      prevailingWindDeg: null,
      periods: DAY_PERIOD_DEFINITIONS.map((def) => buildPeriodSummary(def, [])),
      hourlyRows: [],
    };
  }

  const temps = samples
    .map((s) => s.temperatureC)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const rhs = samples
    .map((s) => s.humidityPct)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const winds = samples
    .map((s) => s.windSpeedKmh)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const gusts = samples
    .map((s) => s.windGustKmh)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const dirs = samples
    .map((s) => s.windDirectionDeg)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const circ = dirs.length > 0 ? computeCircularStat(dirs) : null;
  const totalPrecipMm = samples.reduce((acc, s) => acc + s.precipMm, 0);
  const periods = DAY_PERIOD_DEFINITIONS.map((def) =>
    buildPeriodSummary(
      def,
      samples.filter((s) => s.localHour >= def.startHour && s.localHour <= def.endHour),
    ),
  );

  const provenanceLabel =
    provenanceMap?.[targetDateIso] ?? samples[0]?.provenanceLabel ?? 'Open-Meteo Archive / NWP';

  const hourlyRows: SingleDayHourlyPointRow[] = samples.map((s) => {
    const def = classifyDayPeriod(s.localHour);
    return {
      timestampUnix: s.timestampUnix,
      hhmm: resolveLocalHHMM(s.timestampUnix, timezone),
      periodId: def.id,
      periodLabel: def.label,
      temperatureC: s.temperatureC,
      humidityPct: s.humidityPct,
      windSpeedKmh: s.windSpeedKmh,
      windGustKmh: s.windGustKmh,
      windDirectionDeg: s.windDirectionDeg,
      precipMm: s.precipMm,
      pressureHpa: s.pressureHpa,
    };
  });

  return {
    dateIso: targetDateIso,
    found: true,
    provenanceLabel,
    hoursCount: samples.length,
    minTempC: temps.length > 0 ? Math.min(...temps) : null,
    maxTempC: temps.length > 0 ? Math.max(...temps) : null,
    meanTempC: finiteAverage(temps),
    totalPrecipMm,
    meanHumidityPct: finiteAverage(rhs),
    meanWindKmh: finiteAverage(winds),
    maxGustKmh: gusts.length > 0 ? Math.max(...gusts) : null,
    prevailingWindDeg: circ ? circ.degree : null,
    periods,
    hourlyRows,
  };
}
