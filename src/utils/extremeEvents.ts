import type {
  ExtremeEventSeverity,
  GlobalExtremeEventAlert,
} from '../types/v4';
import type { EnsembleHour } from '../types/weather';
import { formatLocalHourBadge, formatLocalYMD } from './localTimeHour';

const MAX_FORECAST_SCAN_HOURS = 168;
const MAX_CONTIGUOUS_GAP_SECONDS = 3 * 3600;
const MAX_WINDOWS_PER_DETECTOR = 2;

const CONVECTIVE_WMO_CODES = new Set([95, 96, 99]);

const OPEN_METEO_DOCS_URL = 'https://open-meteo.com/en/docs';
const OPEN_METEO_MARINE_DOCS_URL = 'https://open-meteo.com/en/docs/marine-weather-api';
const NOAA_SWPC_URL = 'https://services.swpc.noaa.gov/';

interface ContiguousHourWindow {
  startIdx: number;
  endIdx: number;
  indices: number[];
}

function groupContiguousIndices(
  indices: readonly number[],
  hours: readonly EnsembleHour[],
): ContiguousHourWindow[] {
  if (indices.length === 0) {
    return [];
  }

  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const firstIdx = sorted[0];
  if (firstIdx === undefined) {
    return [];
  }

  const groups: ContiguousHourWindow[] = [];
  let current: ContiguousHourWindow = {
    startIdx: firstIdx,
    endIdx: firstIdx,
    indices: [firstIdx],
  };

  for (let k = 1; k < sorted.length; k++) {
    const idx = sorted[k];
    if (idx === undefined) continue;

    const prevHour = hours[current.endIdx];
    const curHour = hours[idx];
    const gapSeconds =
      prevHour && curHour
        ? curHour.timestampUnix - prevHour.timestampUnix
        : (idx - current.endIdx) * 3600;

    if (gapSeconds <= MAX_CONTIGUOUS_GAP_SECONDS) {
      current.endIdx = idx;
      current.indices.push(idx);
    } else {
      groups.push(current);
      current = {
        startIdx: idx,
        endIdx: idx,
        indices: [idx],
      };
    }
  }

  groups.push(current);
  return groups;
}

function formatWindowSpanLabel(
  startUnix: number,
  endUnix: number,
  timezone?: string,
): string {
  const startDate = formatLocalYMD(new Date(startUnix * 1000), timezone);
  const endDate = formatLocalYMD(new Date(endUnix * 1000), timezone);
  const startHh = formatLocalHourBadge(startUnix, timezone);
  const endHh = formatLocalHourBadge(endUnix, timezone);

  if (startUnix === endUnix) {
    return `${startDate} às ${startHh}`;
  }
  if (startDate === endDate) {
    return `${startDate} (${startHh}–${endHh})`;
  }
  return `${startDate} ${startHh} até ${endDate} ${endHh}`;
}

function computeRolling6hPrecipitationMm(hours: readonly EnsembleHour[]): number[] {
  return hours.map((cur, i) => {
    let sum = 0;
    for (let j = i; j >= 0; j--) {
      const candidate = hours[j];
      if (!candidate) continue;
      if (cur.timestampUnix - candidate.timestampUnix > 5 * 3600 + 600) {
        break;
      }
      const rain = candidate.precipitationMm.mean;
      if (rain !== null && Number.isFinite(rain) && rain > 0) {
        sum += rain;
      }
    }
    return Number(sum.toFixed(2));
  });
}

function severityRank(severity: ExtremeEventSeverity): number {
  if (severity === 'extreme') return 3;
  if (severity === 'severe') return 2;
  return 1;
}

function selectTopWindows<T extends { score: number; window: ContiguousHourWindow }>(
  candidates: readonly T[],
): T[] {
  return [...candidates]
    .sort((a, b) => b.score - a.score || a.window.startIdx - b.window.startIdx)
    .slice(0, MAX_WINDOWS_PER_DETECTOR)
    .sort((a, b) => a.window.startIdx - b.window.startIdx);
}

/**
 * Detecta eventos meteorológicos, oceanográficos e geomagnéticos extremos no horizonte
 * de previsão (72–168h), agrupando janelas horárias contíguas em alertas desduplicados
 * com atribuição formal de fonte aberta e notas metodológicas em português.
 */
export function detectGlobalExtremeEvents(
  hours: readonly EnsembleHour[],
  timezone?: string,
  kpValue?: number | null,
): GlobalExtremeEventAlert[] {
  const scanHours = hours.slice(0, MAX_FORECAST_SCAN_HOURS);
  const alerts: GlobalExtremeEventAlert[] = [];

  if (scanHours.length > 0) {
    // 1. Tempestade Convectiva & Raios ('thunderstorm')
    const stormIndices: number[] = [];
    scanHours.forEach((h, idx) => {
      const code = h.weatherCodeDominant;
      const cape = h.capeJkg?.mean ?? null;
      const hasConvectiveWmo =
        code !== null && code !== undefined && CONVECTIVE_WMO_CODES.has(Math.round(code));
      const hasHighCape = cape !== null && Number.isFinite(cape) && cape >= 1200;
      if (hasConvectiveWmo || hasHighCape) {
        stormIndices.push(idx);
      }
    });

    const stormWindows = selectTopWindows(
      groupContiguousIndices(stormIndices, scanHours).map((window) => {
        let peakHour = scanHours[window.startIdx]!;
        let bestScore = -1;
        for (const idx of window.indices) {
          const h = scanHours[idx];
          if (!h) continue;
          const code = h.weatherCodeDominant ?? 0;
          const cape = h.capeJkg?.mean ?? 0;
          const s = (code >= 99 ? 3500 : code >= 96 ? 2600 : code >= 95 ? 1800 : 0) + cape;
          if (s > bestScore) {
            bestScore = s;
            peakHour = h;
          }
        }
        return { window, peakHour, score: bestScore };
      }),
    );

    for (const { window, peakHour } of stormWindows) {
      const startHour = scanHours[window.startIdx]!;
      const endHour = scanHours[window.endIdx]!;
      const peakCode = peakHour.weatherCodeDominant ?? null;
      const peakCape = peakHour.capeJkg?.mean ?? null;

      const severity: ExtremeEventSeverity =
        peakCode === 99 || (peakCape !== null && peakCape >= 2500)
          ? 'extreme'
          : peakCode === 96 || peakCode === 95 || (peakCape !== null && peakCape >= 1600)
            ? 'severe'
            : 'moderate';

      const metricBadge =
        peakCape !== null && peakCape >= 1200
          ? `CAPE ${Math.round(peakCape)} J/kg`
          : `WMO ${peakCode ?? 95} • Tempestade`;

      const spanLabel = formatWindowSpanLabel(
        startHour.timestampUnix,
        endHour.timestampUnix,
        timezone,
      );

      alerts.push({
        id: `extreme_thunderstorm_${startHour.timestampUnix}`,
        category: 'thunderstorm',
        severity,
        title:
          peakCode === 96 || peakCode === 99
            ? 'Tempestade Severa com Risco de Granizo e Descargas Elétricas'
            : 'Risco Elevado de Tempestade Convectiva e Raios',
        summary: `Instabilidade convectiva intensa prevista em ${spanLabel} (${window.indices.length}h sob risco).`,
        potentialDamages:
          'Descargas atmosféricas em áreas abertas, rajadas convectivas localizadas (downbursts), pancadas intensas de chuva e possível queda de granizo.',
        recommendedAction:
          'Suspenda atividades em cristas, praias, lâminas d’água e estruturas metálicas expostas; recue equipamentos aéreos antes do início da janela.',
        metricBadge,
        peakTimestampUnix: peakHour.timestampUnix,
        windowStartUnix: startHour.timestampUnix,
        windowEndUnix: endHour.timestampUnix,
        sourceName: 'Open-Meteo Convective Ensemble (ECMWF / GFS / ICON / GEM)',
        sourceUrl: OPEN_METEO_DOCS_URL,
        methodologyNote:
          'Detecção determinística por código sinótico WMO (95, 96 ou 99) ou energia potencial disponível para convecção (CAPE >= 1200 J/kg) no ensemble multi-modelo.',
      });
    }

    // 2. Vento Extremo & Rajadas Severas ('extreme_wind')
    const windIndices: number[] = [];
    scanHours.forEach((h, idx) => {
      const gust = h.windGusts10m.mean;
      const wind = h.windSpeed10m.mean;
      if (
        (gust !== null && Number.isFinite(gust) && gust >= 55) ||
        (wind !== null && Number.isFinite(wind) && wind >= 42)
      ) {
        windIndices.push(idx);
      }
    });

    const windWindows = selectTopWindows(
      groupContiguousIndices(windIndices, scanHours).map((window) => {
        let peakHour = scanHours[window.startIdx]!;
        let bestMetric = -1;
        for (const idx of window.indices) {
          const h = scanHours[idx];
          if (!h) continue;
          const m = Math.max(h.windGusts10m.mean ?? 0, (h.windSpeed10m.mean ?? 0) * 1.3);
          if (m > bestMetric) {
            bestMetric = m;
            peakHour = h;
          }
        }
        return { window, peakHour, score: bestMetric };
      }),
    );

    for (const { window, peakHour } of windWindows) {
      const startHour = scanHours[window.startIdx]!;
      const endHour = scanHours[window.endIdx]!;
      const peakGust = peakHour.windGusts10m.mean;
      const peakWind = peakHour.windSpeed10m.mean;

      const severity: ExtremeEventSeverity =
        (peakGust !== null && peakGust >= 80) || (peakWind !== null && peakWind >= 62)
          ? 'extreme'
          : (peakGust !== null && peakGust >= 65) || (peakWind !== null && peakWind >= 50)
            ? 'severe'
            : 'moderate';

      const metricBadge =
        peakGust !== null && peakGust >= 55
          ? `Rajada ${Math.round(peakGust)} km/h`
          : `Vento ${Math.round(peakWind ?? 42)} km/h`;

      const spanLabel = formatWindowSpanLabel(
        startHour.timestampUnix,
        endHour.timestampUnix,
        timezone,
      );

      alerts.push({
        id: `extreme_wind_${startHour.timestampUnix}`,
        category: 'extreme_wind',
        severity,
        title:
          peakGust !== null && peakGust >= 55
            ? `Vendaval / Rajadas Severas (até ${Math.round(peakGust)} km/h)`
            : `Vento Sustentado Forte (até ${Math.round(peakWind ?? 42)} km/h)`,
        summary: `Escoamento intenso a 10m previsto em ${spanLabel} (${window.indices.length}h de duração).`,
        potentialDamages:
          'Queda de galhos e estruturas temporárias, deriva acentuada de embarcações miúdas e perda de controle em aeronaves remotamente pilotadas (drones).',
        recommendedAction:
          'Reforce estaiamentos e amarrações, cancele voos de VANT e antecipe abrigo costeiro antes do pico de vento.',
        metricBadge,
        peakTimestampUnix: peakHour.timestampUnix,
        windowStartUnix: startHour.timestampUnix,
        windowEndUnix: endHour.timestampUnix,
        sourceName: 'Open-Meteo Multi-Model Ensemble (ECMWF / GFS / ICON / GEM)',
        sourceUrl: OPEN_METEO_DOCS_URL,
        methodologyNote:
          'Acionado quando a média multi-modelo de rajadas a 10m atinge >= 55 km/h ou o vento médio sustentado a 10m atinge >= 42 km/h.',
      });
    }

    // 3. Chuva Intensa Horária ou Acumulado 6h ('heavy_rain')
    const rolling6hMm = computeRolling6hPrecipitationMm(scanHours);
    const rainIndexSet = new Set<number>();
    scanHours.forEach((h, idx) => {
      const hourlyRain = h.precipitationMm.mean ?? 0;
      const cum6h = rolling6hMm[idx] ?? 0;
      if (hourlyRain >= 15) {
        rainIndexSet.add(idx);
      }
      if (cum6h >= 40) {
        rainIndexSet.add(idx);
        for (let j = idx - 1; j >= 0; j--) {
          const prev = scanHours[j];
          if (!prev || h.timestampUnix - prev.timestampUnix > 5 * 3600 + 600) {
            break;
          }
          if ((prev.precipitationMm.mean ?? 0) >= 1) {
            rainIndexSet.add(j);
          }
        }
      }
    });

    const rainWindows = selectTopWindows(
      groupContiguousIndices([...rainIndexSet], scanHours).map((window) => {
        let peakHour = scanHours[window.startIdx]!;
        let maxHourly = 0;
        let max6h = 0;
        for (const idx of window.indices) {
          const h = scanHours[idx];
          if (!h) continue;
          const r1 = h.precipitationMm.mean ?? 0;
          const r6 = rolling6hMm[idx] ?? 0;
          if (r1 > maxHourly || (r1 === maxHourly && r6 > max6h)) {
            maxHourly = r1;
            peakHour = h;
          }
          if (r6 > max6h) {
            max6h = r6;
          }
        }
        return {
          window,
          peakHour,
          maxHourly,
          max6h,
          score: Math.max(maxHourly * 2.5, max6h),
        };
      }),
    );

    for (const { window, peakHour, maxHourly, max6h } of rainWindows) {
      const startHour = scanHours[window.startIdx]!;
      const endHour = scanHours[window.endIdx]!;

      const severity: ExtremeEventSeverity =
        maxHourly >= 30 || max6h >= 70
          ? 'extreme'
          : maxHourly >= 20 || max6h >= 50
            ? 'severe'
            : 'moderate';

      const metricBadge =
        maxHourly >= 15 ? `${maxHourly.toFixed(1)} mm/h` : `${max6h.toFixed(1)} mm/6h`;

      const spanLabel = formatWindowSpanLabel(
        startHour.timestampUnix,
        endHour.timestampUnix,
        timezone,
      );

      alerts.push({
        id: `extreme_heavy_rain_${startHour.timestampUnix}`,
        category: 'heavy_rain',
        severity,
        title:
          maxHourly >= 15
            ? `Chuva Torrencial Horária (${maxHourly.toFixed(1)} mm/h)`
            : `Acumulado Pluviométrico Elevado (${max6h.toFixed(1)} mm em 6h)`,
        summary: `Volume expressivo de precipitação previsto em ${spanLabel}.`,
        potentialDamages:
          'Alagamentos rápidos, enxurradas em drenagens e trilhas íngremes, atolamento em acessos rurais e redução severa da visibilidade.',
        recommendedAction:
          'Evite fundos de vale, cabeceiras de drenagem, encostas saturadas e travessias de áreas sujeitas a alagamento.',
        metricBadge,
        peakTimestampUnix: peakHour.timestampUnix,
        windowStartUnix: startHour.timestampUnix,
        windowEndUnix: endHour.timestampUnix,
        sourceName: 'Open-Meteo Quantitative Precipitation Ensemble (ECMWF / GFS / ICON / GEM)',
        sourceUrl: OPEN_METEO_DOCS_URL,
        methodologyNote:
          'Gatilho hidrológico para taxa horária média >= 15 mm/h ou precipitação acumulada móvel de 6 horas >= 40 mm.',
      });
    }

    // 4. Queda Barométrica Brusca / Squall ('pressure_squall')
    const squallIndices: number[] = [];
    scanHours.forEach((h, idx) => {
      if (
        h.pressureDelta3hHpa !== null &&
        Number.isFinite(h.pressureDelta3hHpa) &&
        h.pressureDelta3hHpa <= -4
      ) {
        squallIndices.push(idx);
      }
    });

    const squallWindows = selectTopWindows(
      groupContiguousIndices(squallIndices, scanHours).map((window) => {
        let peakHour = scanHours[window.startIdx]!;
        let minDelta = 0;
        for (const idx of window.indices) {
          const h = scanHours[idx];
          if (!h) continue;
          const d = h.pressureDelta3hHpa ?? 0;
          if (d < minDelta) {
            minDelta = d;
            peakHour = h;
          }
        }
        return { window, peakHour, minDelta, score: Math.abs(minDelta) };
      }),
    );

    for (const { window, peakHour, minDelta } of squallWindows) {
      const startHour = scanHours[window.startIdx]!;
      const endHour = scanHours[window.endIdx]!;

      const severity: ExtremeEventSeverity =
        minDelta <= -7 ? 'extreme' : minDelta <= -5 ? 'severe' : 'moderate';

      const spanLabel = formatWindowSpanLabel(
        startHour.timestampUnix,
        endHour.timestampUnix,
        timezone,
      );

      alerts.push({
        id: `extreme_pressure_squall_${startHour.timestampUnix}`,
        category: 'pressure_squall',
        severity,
        title: `Queda Barométrica Brusca / Linha de Instabilidade (${minDelta.toFixed(1)} hPa/3h)`,
        summary: `Despressurização rápida na superfície prevista em ${spanLabel}, sinalizando avanço frontal ou squall.`,
        potentialDamages:
          'Rondada brusca na direção do vento, entrada repentina de rajadas frontais e rápida degradação do estado do mar.',
        recommendedAction:
          'Antecipe o retorno de embarcações e recolha lonas ou equipamentos sensíveis antes da virada barométrica.',
        metricBadge: `ΔP ${minDelta.toFixed(1)} hPa/3h`,
        peakTimestampUnix: peakHour.timestampUnix,
        windowStartUnix: startHour.timestampUnix,
        windowEndUnix: endHour.timestampUnix,
        sourceName: 'Open-Meteo Barometric Ensemble (ECMWF / GFS / ICON / GEM)',
        sourceUrl: OPEN_METEO_DOCS_URL,
        methodologyNote:
          'Calculado sobre a tendência barométrica de 3 horas (ΔP/3h <= -4.0 hPa) da pressão média ao nível da superfície.',
      });
    }

    // 5. Ressaca / Mar Grosso Costeiro ('coastal_swell')
    const swellIndices: number[] = [];
    scanHours.forEach((h, idx) => {
      const wave = h.marine?.waveHeight;
      if (wave !== null && wave !== undefined && Number.isFinite(wave) && wave >= 2.8) {
        swellIndices.push(idx);
      }
    });

    const swellWindows = selectTopWindows(
      groupContiguousIndices(swellIndices, scanHours).map((window) => {
        let peakHour = scanHours[window.startIdx]!;
        let maxWave = 0;
        for (const idx of window.indices) {
          const h = scanHours[idx];
          const w = h?.marine?.waveHeight ?? 0;
          if (h && w > maxWave) {
            maxWave = w;
            peakHour = h;
          }
        }
        return { window, peakHour, maxWave, score: maxWave };
      }),
    );

    for (const { window, peakHour, maxWave } of swellWindows) {
      const startHour = scanHours[window.startIdx]!;
      const endHour = scanHours[window.endIdx]!;

      const severity: ExtremeEventSeverity =
        maxWave >= 4.5 ? 'extreme' : maxWave >= 3.5 ? 'severe' : 'moderate';

      const spanLabel = formatWindowSpanLabel(
        startHour.timestampUnix,
        endHour.timestampUnix,
        timezone,
      );

      alerts.push({
        id: `extreme_coastal_swell_${startHour.timestampUnix}`,
        category: 'coastal_swell',
        severity,
        title: `Ressaca / Ondulação Costeira Elevada (${maxWave.toFixed(1)} m)`,
        summary: `Altura significativa de onda >= 2.8 m prevista em ${spanLabel} (${window.indices.length}h).`,
        potentialDamages:
          'Arrebentação violenta em praias e costões, fechamento de barras costeiras, risco de emborcamento de pequenas embarcações e sobrelevação na orla.',
        recommendedAction:
          'Suspenda saídas em embarcações de pequeno porte, evite costões rochosos e verifique os avisos oficiais de mau tempo da DHN / Marinha.',
        metricBadge: `Ondas ${maxWave.toFixed(1)} m`,
        peakTimestampUnix: peakHour.timestampUnix,
        windowStartUnix: startHour.timestampUnix,
        windowEndUnix: endHour.timestampUnix,
        sourceName: 'Open-Meteo Marine Global Wave Model',
        sourceUrl: OPEN_METEO_MARINE_DOCS_URL,
        methodologyNote:
          'Gatilho oceanográfico para altura significativa de onda total (Hs >= 2.8 m) na grade costeira. Estimativas oceânicas não substituem avisos da DHN/Marinha.',
      });
    }

    // 7. Extremos Térmicos: Calor Intenso (>= 37 °C) e Frio Intenso / Geada (<= 3 °C)
    const heatIndices: number[] = [];
    const coldIndices: number[] = [];
    scanHours.forEach((h, idx) => {
      const t = h.temperature2mC.mean;
      if (t !== null && Number.isFinite(t)) {
        if (t >= 37) heatIndices.push(idx);
        if (t <= 3) coldIndices.push(idx);
      }
    });

    const heatWindows = selectTopWindows(
      groupContiguousIndices(heatIndices, scanHours).map((window) => {
        let peakHour = scanHours[window.startIdx]!;
        let maxTemp = -Infinity;
        for (const idx of window.indices) {
          const h = scanHours[idx];
          const t = h?.temperature2mC.mean ?? -Infinity;
          if (h && t > maxTemp) {
            maxTemp = t;
            peakHour = h;
          }
        }
        return { window, peakHour, maxTemp, score: maxTemp };
      }),
    );

    for (const { window, peakHour, maxTemp } of heatWindows) {
      const startHour = scanHours[window.startIdx]!;
      const endHour = scanHours[window.endIdx]!;
      const severity: ExtremeEventSeverity =
        maxTemp >= 41 ? 'extreme' : maxTemp >= 39 ? 'severe' : 'moderate';
      const spanLabel = formatWindowSpanLabel(
        startHour.timestampUnix,
        endHour.timestampUnix,
        timezone,
      );

      alerts.push({
        id: `extreme_thermal_heat_${startHour.timestampUnix}`,
        category: 'thermal_extreme',
        severity,
        title: `Calor Extremo em Superfície (${maxTemp.toFixed(1)} °C)`,
        summary: `Temperatura do ar a 2m >= 37 °C prevista em ${spanLabel}.`,
        potentialDamages:
          'Estresse térmico severo, desidratação rápida em equipes de campo, superaquecimento de baterias LiPo e redução de performance aerodinâmica (alta altitude densidade).',
        recommendedAction:
          'Reduza esforço físico nos horários de pico solar, reforce hidratação/sombra e monitore temperatura de baterias e equipamentos.',
        metricBadge: `Máx ${maxTemp.toFixed(1)} °C`,
        peakTimestampUnix: peakHour.timestampUnix,
        windowStartUnix: startHour.timestampUnix,
        windowEndUnix: endHour.timestampUnix,
        sourceName: 'Open-Meteo Surface Temperature Ensemble (ECMWF / GFS / ICON / GEM)',
        sourceUrl: OPEN_METEO_DOCS_URL,
        methodologyNote:
          'Alerta térmico acionado quando a temperatura média multi-modelo a 2m atinge ou supera 37.0 °C.',
      });
    }

    const coldWindows = selectTopWindows(
      groupContiguousIndices(coldIndices, scanHours).map((window) => {
        let peakHour = scanHours[window.startIdx]!;
        let minTemp = Infinity;
        for (const idx of window.indices) {
          const h = scanHours[idx];
          const t = h?.temperature2mC.mean ?? Infinity;
          if (h && t < minTemp) {
            minTemp = t;
            peakHour = h;
          }
        }
        return { window, peakHour, minTemp, score: 20 - minTemp };
      }),
    );

    for (const { window, peakHour, minTemp } of coldWindows) {
      const startHour = scanHours[window.startIdx]!;
      const endHour = scanHours[window.endIdx]!;
      const severity: ExtremeEventSeverity =
        minTemp <= -2 ? 'extreme' : minTemp <= 0 ? 'severe' : 'moderate';
      const spanLabel = formatWindowSpanLabel(
        startHour.timestampUnix,
        endHour.timestampUnix,
        timezone,
      );

      alerts.push({
        id: `extreme_thermal_cold_${startHour.timestampUnix}`,
        category: 'thermal_extreme',
        severity,
        title: `Frio Intenso / Risco de Geada (${minTemp.toFixed(1)} °C)`,
        summary: `Temperatura do ar a 2m <= 3 °C prevista em ${spanLabel}.`,
        potentialDamages:
          'Risco de hipotermia em campo aberto, formação de geada em culturas agrícolas e queda acentuada na autonomia de baterias.',
        recommendedAction:
          'Utilize vestuário térmico em camadas, proteja cultivos sensíveis e mantenha baterias aquecidas antes da operação.',
        metricBadge: `Mín ${minTemp.toFixed(1)} °C`,
        peakTimestampUnix: peakHour.timestampUnix,
        windowStartUnix: startHour.timestampUnix,
        windowEndUnix: endHour.timestampUnix,
        sourceName: 'Open-Meteo Surface Temperature Ensemble (ECMWF / GFS / ICON / GEM)',
        sourceUrl: OPEN_METEO_DOCS_URL,
        methodologyNote:
          'Alerta térmico acionado quando a temperatura média multi-modelo a 2m cai para <= 3.0 °C.',
      });
    }
  }

  // 6. Tempestade Geomagnética ('geomagnetic_storm')
  if (typeof kpValue === 'number' && Number.isFinite(kpValue) && kpValue >= 5) {
    const startUnix = scanHours[0]?.timestampUnix ?? Math.floor(Date.now() / 1000);
    const endUnix =
      scanHours[Math.min(Math.max(0, scanHours.length - 1), 11)]?.timestampUnix ??
      startUnix + 3 * 3600;
    const gScale =
      kpValue >= 9
        ? 'G5'
        : kpValue >= 8
          ? 'G4'
          : kpValue >= 7
            ? 'G3'
            : kpValue >= 6
              ? 'G2'
              : 'G1';
    const severity: ExtremeEventSeverity =
      kpValue >= 8 ? 'extreme' : kpValue >= 6 ? 'severe' : 'moderate';

    alerts.push({
      id: `extreme_geomagnetic_${startUnix}`,
      category: 'geomagnetic_storm',
      severity,
      title: `Tempestade Geomagnética Ativa (Escala NOAA ${gScale})`,
      summary: `Índice planetário Kp em ${kpValue.toFixed(1)} (>= 5.0), indicando perturbação geomagnética e ionosférica significativa.`,
      potentialDamages:
        'Degradação de precisão GNSS/GPS em drones e navegação, cintilação ionosférica e desvios transitórios em bússolas magnéticas.',
      recommendedAction:
        'Evite voos autônomos BVLOS dependentes exclusivamente de GNSS, calibre sensores e mantenha redundância visual em campo.',
      metricBadge: `Kp ${kpValue.toFixed(1)} (${gScale})`,
      peakTimestampUnix: startUnix,
      windowStartUnix: startUnix,
      windowEndUnix: endUnix,
      sourceName: 'NOAA SWPC Planetary K-Index',
      sourceUrl: NOAA_SWPC_URL,
      methodologyNote:
        'Baseado no índice planetário oficial Kp >= 5 (tempestade geomagnética classe G1 a G5 da NOAA Space Weather Prediction Center).',
    });
  }

  return alerts.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.windowStartUnix - b.windowStartUnix,
  );
}
