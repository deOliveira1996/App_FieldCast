import type {
  AgroClimaticWaterBalance,
  DescriptiveMetricStats,
  ScientificAnalysisSummary,
  TechnicalReportDocument,
} from '../types/v4';
import { buildPureZipArchiveBytes, formatCardinalDirection, UTF8_BOM } from './exporters';
import { formatLocalYMD } from './localTimeHour';

const WATER_STRESS_LABELS_PT: Record<
  AgroClimaticWaterBalance['waterStressClassification'],
  string
> = {
  surplus: 'Superávit Hídrico (P - ET0 > +10 mm)',
  balanced: 'Equilíbrio Hídrico (-10 mm <= P - ET0 <= +10 mm)',
  moderate_deficit: 'Déficit Hídrico Moderado (-30 mm <= P - ET0 < -10 mm)',
  severe_deficit: 'Déficit Hídrico Severo (P - ET0 < -30 mm)',
};

function fmtStat(value: number | null | undefined, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/D';
  }
  return value.toFixed(decimals);
}

function fmtSigned(value: number | null | undefined, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/D';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function findMetric(
  metrics: readonly DescriptiveMetricStats[],
  key: string,
): DescriptiveMetricStats | undefined {
  return metrics.find((m) => m.variableKey === key);
}

function formatPeriodDateLabel(iso: string, timezone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return formatLocalYMD(parsed, timezone);
}

function hasMarineMetrics(analysis: ScientificAnalysisSummary): boolean {
  return (
    analysis.modelsCompared.includes('marine') ||
    analysis.metrics.some(
      (m) =>
        (m.variableKey === 'wave_height' || m.variableKey === 'sea_level_msl') &&
        m.sampleCount > 0,
    )
  );
}

/**
 * Gera o documento técnico-acadêmico estruturado (`TechnicalReportDocument`) em português
 * com prosa objetiva, rigor físico-estatístico e discussão parcimoniosa.
 */
export function generateTechnicalReportDocument(
  analysis: ScientificAnalysisSummary,
): TechnicalReportDocument {
  const generatedAtIso = analysis.generatedAtIso || new Date().toISOString();
  const reportId = `FC-REL-${analysis.datasetKind === 'historical_era5' ? 'ERA5' : 'NWP'}-${generatedAtIso.replace(/[^0-9]/g, '').slice(0, 14)}`;

  const startLabel = formatPeriodDateLabel(analysis.periodStartIso, analysis.timezone);
  const endLabel = formatPeriodDateLabel(analysis.periodEndIso, analysis.timezone);
  const datasetTitleLabel =
    analysis.datasetKind === 'historical_era5'
      ? 'Série Temporal Retroativa & Reanálise Climática ERA5'
      : 'Previsão Numérica Multi-Modelo de Curto e Médio Prazo (168h)';

  const tempMetric = findMetric(analysis.metrics, 'temperature_2m');
  const rhMetric = findMetric(analysis.metrics, 'relative_humidity_2m');
  const precipMetric = findMetric(analysis.metrics, 'precipitation');
  const windMetric = findMetric(analysis.metrics, 'wind_speed_10m');
  const gustMetric = findMetric(analysis.metrics, 'wind_gusts_10m');
  const pressureMetric = findMetric(analysis.metrics, 'surface_pressure');
  const waveMetric = findMetric(analysis.metrics, 'wave_height');
  const mslMetric = findMetric(analysis.metrics, 'sea_level_msl');

  const sampleHours = tempMetric?.sampleCount ?? windMetric?.sampleCount ?? 0;
  const windCardinal = formatCardinalDirection(analysis.dominantWindDirectionDeg);
  const wb = analysis.waterBalance;
  const stressLabel = WATER_STRESS_LABELS_PT[wb.waterStressClassification];
  const marinePresent = hasMarineMetrics(analysis);

  const executiveSummary = [
    `Este relatório técnico-científico sintetiza ${sampleHours} registros horários consecutivos (${startLabel} a ${endLabel}, fuso ${analysis.timezone}) para a localidade de ${analysis.locationName} (latitude ${analysis.latitude.toFixed(4)}°, longitude ${analysis.longitude.toFixed(4)}°, altitude ortométrica DEM ${Math.round(analysis.elevationDemM)} m), processados sob a fonte "${analysis.activeModelLabel}".`,
    tempMetric && tempMetric.mean !== null
      ? `O regime térmico a 2 m apresentou média de ${fmtStat(tempMetric.mean, 1)} °C (±${fmtStat(tempMetric.stdDev, 1)} °C; extremos entre ${fmtStat(tempMetric.min, 1)} °C e ${fmtStat(tempMetric.max, 1)} °C; intervalo interdecil P10–P90 de ${fmtStat(tempMetric.p10, 1)} a ${fmtStat(tempMetric.p90, 1)} °C), acumulando ${fmtStat(wb.growingDegreeDaysBase10C, 1)} °C·dia em Graus-Dia de Crescimento (base 10 °C).`
      : 'Não foram observadas amostras válidas de temperatura a 2 m no recorte analisado.',
    windMetric && windMetric.mean !== null
      ? `A circulação anemométrica a 10 m registrou velocidade média de ${fmtStat(windMetric.mean, 1)} km/h (P90 = ${fmtStat(windMetric.p90, 1)} km/h) e rajadas máximas de ${fmtStat(gustMetric?.max, 1)} km/h, com rumo vetorial dominante de ${fmtStat(analysis.dominantWindDirectionDeg, 0)}° (${windCardinal}) e índice de consistência direcional resultante R = ${fmtStat(analysis.windDirectionalConsistencyR, 3)}.`
      : '',
    `O balanço hídrico agroclimático contabilizou precipitação acumulada P = ${fmtStat(wb.totalPrecipitationMm, 1)} mm frente à evapotranspiração de referência FAO-56 ET0 = ${fmtStat(wb.totalEt0FaoMm, 1)} mm, resultando em saldo líquido P - ET0 = ${fmtSigned(wb.netWaterBalanceMm, 1)} mm (${stressLabel}).`,
  ]
    .filter(Boolean)
    .join(' ');

  const methodologySection = [
    '1. Assimilação Multi-Modelo e Estatística Descritiva Não-Paramétrica: As séries horárias (passo temporal de 1 h, indexadas em tempo Unix UTC e projetadas no fuso civil local) são validadas estruturalmente via esquemas estritos (Zod). Para cada variável escalar calculam-se média aritmética, desvio-padrão populacional (sigma), mediana (P50), quantis empíricos P10, P25, P75 e P90, amplitude interquartil (IQR = P75 - P25), anomalia padronizada máxima (|Z|_max = max(|x - mu| / sigma)) e tendência temporal linear por Mínimos Quadrados Ordinários (OLS, expressa em unidades por 24 h).',
    '2. Decomposição Vetorial Circular e Perfil Vertical de Hellmann: Grandezas angulares (direção do vento e ondulação) são decompostas nas componentes zonais u = -V * sin(theta * pi/180) e meridionais v = -V * cos(theta * pi/180), reconstruindo-se o azimute médio via atan2(-u_medio, -v_medio) em [0°, 360°) e a coerência direcional adimensional pelo comprimento do vetor resultante unitário R em [0, 1]. Na camada limite superficial (10 m a 120 m), a extrapolação vertical obedece à Lei de Potência de Hellmann v(z) = v_ref * (z / z_ref)^alpha, sinalizando cisalhamento atípico sempre que alpha < 0,05 ou alpha > 0,40.',
    `3. Disciplina Altimétrica por Modelo Digital de Elevação (DEM): A cota altimétrica de referência (${Math.round(analysis.elevationDemM)} m) provém exclusivamente do Modelo Digital de Elevação Copernicus GLO-90 / NASA SRTM (~90 m), jamais sendo sobrescrita pela altitude elipsoidal ruidosa de receptores GNSS móveis.`,
    '4. Balanço Hídrico Agroclimático (FAO-56) e Conforto Térmico: O saldo hídrico superficial é obtido por B_h = P - ET0, onde ET0 corresponde à evapotranspiração de referência FAO-56 Penman-Monteith (ou parametrização física radiativo-térmica de Hargreaves-Samani ajustada pelo déficit de pressão de vapor quando ET0 nativo está ausente). A umidade relativa derivada respeita a equação psicrométrica de Magnus-Tetens, os Graus-Dia seguem GDD_10 = soma(max(0, T_media_diaria - 10 °C)), e a sobrecarga térmica máxima utiliza a regressão polinomial de Rothfusz/Steadman (Heat Index).',
  ].join('\n\n');

  const metricLines: string[] = [];
  if (tempMetric && tempMetric.sampleCount > 0) {
    metricLines.push(
      `Temperatura a 2 m (N=${tempMetric.sampleCount}): média ${fmtStat(tempMetric.mean, 2)} °C, mediana ${fmtStat(tempMetric.median, 2)} °C, DP ${fmtStat(tempMetric.stdDev, 2)} °C, IQR ${fmtStat(tempMetric.iqr, 2)} °C, tendência linear de ${fmtSigned(tempMetric.linearTrendPerDay, 2)} °C/dia e anomalia máxima |Z| = ${fmtStat(tempMetric.anomalyZScoreMax, 2)}.`,
    );
  }
  if (rhMetric && rhMetric.sampleCount > 0) {
    metricLines.push(
      `Umidade Relativa a 2 m (N=${rhMetric.sampleCount}): média ${fmtStat(rhMetric.mean, 1)}%, faixa P10–P90 entre ${fmtStat(rhMetric.p10, 1)}% e ${fmtStat(rhMetric.p90, 1)}%, e índice de calor máximo (Rothfusz/Steadman) de ${fmtStat(wb.maxHeatIndexC, 1)} °C.`,
    );
  }
  if (precipMetric && precipMetric.sampleCount > 0) {
    metricLines.push(
      `Precipitação Horária (N=${precipMetric.sampleCount}): acumulado total ${fmtStat(wb.totalPrecipitationMm, 2)} mm, taxa horária máxima ${fmtStat(precipMetric.max, 2)} mm/h (P90 = ${fmtStat(precipMetric.p90, 2)} mm/h) e anomalia episódica |Z| = ${fmtStat(precipMetric.anomalyZScoreMax, 2)}.`,
    );
  }
  if (windMetric && windMetric.sampleCount > 0) {
    metricLines.push(
      `Escoamento Horizontal a 10 m (N=${windMetric.sampleCount}): velocidade média ${fmtStat(windMetric.mean, 2)} km/h (mediana ${fmtStat(windMetric.median, 2)} km/h, P90 ${fmtStat(windMetric.p90, 2)} km/h), rajada máxima a 10 m de ${fmtStat(gustMetric?.max, 2)} km/h, direção dominante ${fmtStat(analysis.dominantWindDirectionDeg, 1)}° (${windCardinal}) e persistência vetorial R = ${fmtStat(analysis.windDirectionalConsistencyR, 3)}.`,
    );
  }
  if (pressureMetric && pressureMetric.sampleCount > 0) {
    metricLines.push(
      `Pressão Atmosférica à Superfície (N=${pressureMetric.sampleCount}): média ${fmtStat(pressureMetric.mean, 1)} hPa (amplitude de ${fmtStat(pressureMetric.min, 1)} a ${fmtStat(pressureMetric.max, 1)} hPa) com deriva barométrica linear de ${fmtSigned(pressureMetric.linearTrendPerDay, 2)} hPa/dia.`,
    );
  }
  if (waveMetric && waveMetric.sampleCount > 0) {
    metricLines.push(
      `Agitação Marítima Costeira (N=${waveMetric.sampleCount}): altura significativa de onda Hs média de ${fmtStat(waveMetric.mean, 2)} m, P90 de ${fmtStat(waveMetric.p90, 2)} m e pico de ${fmtStat(waveMetric.max, 2)} m.`,
    );
  }
  if (mslMetric && mslMetric.sampleCount > 0) {
    metricLines.push(
      `Nível Oceânico Estimado MSL ~8 km (N=${mslMetric.sampleCount}): excursão entre ${fmtSigned(mslMetric.min, 2)} m e ${fmtSigned(mslMetric.max, 2)} m em relação ao nível médio do mar modelado.`,
    );
  }

  const resultsInterpretation = metricLines.join(' ');

  const consistencyValue = analysis.windDirectionalConsistencyR ?? 0;
  const windRegimeText =
    consistencyValue >= 0.75
      ? `alta persistência sinótica unidirecional (R = ${consistencyValue.toFixed(3)})`
      : consistencyValue >= 0.45
        ? `regime direcional moderadamente organizado com alternância mesoescalar/brisa (R = ${consistencyValue.toFixed(3)})`
        : `elevada variabilidade direcional horária ou transição frontal/circulação local fraca (R = ${consistencyValue.toFixed(3)})`;

  const pressureTrend = pressureMetric?.linearTrendPerDay ?? 0;
  const baroRegimeText =
    pressureTrend <= -1.5
      ? `tendência barométrica negativa (${fmtSigned(pressureTrend, 2)} hPa/dia), compatível com perda gradual de estabilidade sinótica ou aproximação de cavado`
      : pressureTrend >= 1.5
        ? `tendência barométrica positiva (${fmtSigned(pressureTrend, 2)} hPa/dia), indicativa de avanço anticiclônico pós-frontal e estabilização subsidente`
        : `estabilidade barométrica em escala sinótica (${fmtSigned(pressureTrend, 2)} hPa/dia), predominando forçantes termodinâmicas diurnas`;

  const parcimonicDiscussion = [
    `Sob o princípio da parcimônia interpretativa, os indicadores convergem para um quadro caracterizado por ${baroRegimeText}, associado a ${windRegimeText}.`,
    `No domínio hidrometeorológico e agrometeorológico, a relação entre entrada pluviométrica (${fmtStat(wb.totalPrecipitationMm, 1)} mm) e demanda evaporativa atmosférica (${fmtStat(wb.totalEt0FaoMm, 1)} mm) classifica o período em "${stressLabel}", informação objetiva para manejo de campo, trafegabilidade de solo e planejamento operacional.`,
    'Ressalta-se que estatísticas derivadas de grades numéricas representam médias espaciais de célula (13 km a 25 km na atmosfera; ~8 km no oceano), devendo eventuais extremos microclimáticos de orografia sub-grade, canalização costeira ou convecção isolada ser confrontados com observações in situ (waypoints e telemetria local).',
  ].join(' ');

  const limitationsAndDisclaimers: string[] = [
    `Representatividade de Grade Espacial: Os campos numéricos analisados (${analysis.modelsCompared.join(', ')}) refletem valores médios integrados na célula de grade dos modelos globais/reanálise e na altitude DEM (${Math.round(analysis.elevationDemM)} m), podendo divergir de microclimas de vale, topo de morro ou cânions urbanos.`,
    'Horizonte de Previsibilidade e Incerteza Epistêmica: Em previsões operacionais de até 168 horas, a dispersão inter-modelos cresce não-linearmente após 72–96 horas; recomenda-se priorizar o intervalo interdecil (P10–P90) e reatualizações periódicas antes de manobras críticas.',
    'Processamento 100% Local e Auditável: Todos os cálculos estatísticos, regressões OLS e índices físicos deste documento foram processados localmente no cliente (FieldCast Offline-First Engine), sem alteração ou interpolação oculta sobre os vetores primários.',
  ];

  if (marinePresent) {
    limitationsAndDisclaimers.unshift(
      'Aviso Hidrográfico Obrigatório — Maré Estimada (MSL ~8 km): As cotas de nível do mar (sea_level_height_msl) derivam de modelagem hidrodinâmica oceânica de mesoescala (~8 km de resolução) referenciada ao Nível Médio do Mar (MSL) e NÃO substituem, sob nenhuma hipótese, as tábuas de marés astronômicas oficiais da DHN / Marinha do Brasil nem cartas náuticas homologadas para navegação em barras, canais portuários e águas restritas.',
    );
  } else {
    limitationsAndDisclaimers.push(
      'Domínio Continental / Ausência de Grade Costeira: A coordenada avaliada encontra-se em domínio continental ou sem célula costeira ativa na Marine API; nenhuma penalidade espúria foi aplicada aos índices atmosféricos.',
    );
  }

  return {
    reportId,
    title: `Relatório Técnico-Científico Meteorológico e Agroclimático — ${analysis.locationName}`,
    subtitle: `${datasetTitleLabel} • ${startLabel} a ${endLabel} (${analysis.activeModelLabel})`,
    generatedAtIso,
    analysis,
    executiveSummary,
    methodologySection,
    resultsInterpretation,
    parcimonicDiscussion,
    limitationsAndDisclaimers,
  };
}

function buildInlinePercentileBarSvg(metric: DescriptiveMetricStats): string {
  if (
    metric.sampleCount === 0 ||
    metric.min === null ||
    metric.max === null ||
    metric.mean === null
  ) {
    return '<span style="color:#64748b;font-size:11px;">Sem amostra</span>';
  }
  const span = metric.max - metric.min;
  const toX = (val: number | null): number => {
    if (val === null || !Number.isFinite(val) || span <= 1e-9) {
      return 60;
    }
    const ratio = Math.max(0, Math.min(1, (val - metric.min!) / span));
    return Number((6 + ratio * 108).toFixed(1));
  };

  const xP10 = toX(metric.p10);
  const xP90 = toX(metric.p90);
  const xMean = toX(metric.mean);
  const xMedian = toX(metric.median);
  const barWidth = Math.max(2, Number((xP90 - xP10).toFixed(1)));

  return `<svg width="120" height="20" viewBox="0 0 120 20" role="img" aria-label="Distribuição P10-P90 e média de ${escapeHtml(metric.label)}">
    <line x1="6" y1="10" x2="114" y2="10" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" />
    <rect x="${xP10}" y="5" width="${barWidth}" height="10" rx="3" fill="#0284c7" fill-opacity="0.28" stroke="#0284c7" stroke-width="1" />
    <line x1="${xMedian}" y1="4" x2="${xMedian}" y2="16" stroke="#0f172a" stroke-width="1.8" />
    <circle cx="${xMean}" cy="10" r="3" fill="#ea580c" />
  </svg>`;
}

/**
 * Formata um relatório HTML5 autônomo pronto para publicação/impressão acadêmica (`@media print`).
 */
export function formatTechnicalReportHtml(doc: TechnicalReportDocument): string {
  const { analysis } = doc;
  const wb = analysis.waterBalance;
  const windCardinal = formatCardinalDirection(analysis.dominantWindDirectionDeg);
  const stressLabel = WATER_STRESS_LABELS_PT[wb.waterStressClassification];

  const statsRowsHtml = analysis.metrics
    .map(
      (m) => `
        <tr>
          <td><strong>${escapeHtml(m.label)}</strong> <span class="unit">(${escapeHtml(m.unit)})</span></td>
          <td class="num">${m.sampleCount}</td>
          <td class="num">${fmtStat(m.mean, 2)}</td>
          <td class="num">${fmtStat(m.stdDev, 2)}</td>
          <td class="num">${fmtStat(m.median, 2)}</td>
          <td class="num">${fmtStat(m.min, 2)}</td>
          <td class="num">${fmtStat(m.p10, 2)}</td>
          <td class="num">${fmtStat(m.p90, 2)}</td>
          <td class="num">${fmtStat(m.max, 2)}</td>
          <td class="num">${fmtStat(m.iqr, 2)}</td>
          <td class="num">${fmtSigned(m.linearTrendPerDay, 2)}</td>
          <td class="num">${fmtStat(m.anomalyZScoreMax, 2)}</td>
          <td class="svg-cell">${buildInlinePercentileBarSvg(m)}</td>
        </tr>`,
    )
    .join('\n');

  const methodologyParagraphsHtml = doc.methodologySection
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n');

  const disclaimersHtml = doc.limitationsAndDisclaimers
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('\n');

  const citationsHtml = analysis.citations
    .map(
      (c) => `
        <li>
          <strong>${escapeHtml(c.datasetName)}</strong> (${escapeHtml(c.provider)} — grade ${escapeHtml(c.spatialResolution)}, passo ${escapeHtml(c.temporalResolution)}):
          ${escapeHtml(c.formalCitation)}
          <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.url)}</a>
        </li>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    :root {
      --ink: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --accent: #0369a1;
      --bg-soft: #f8fafc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      font-family: "Georgia", "Times New Roman", serif;
      color: var(--ink);
      background: #ffffff;
      line-height: 1.58;
      font-size: 13.5px;
    }
    .container {
      max-width: 1040px;
      margin: 0 auto;
    }
    header.academic-header {
      border-bottom: 2px solid var(--ink);
      padding-bottom: 14px;
      margin-bottom: 22px;
    }
    header.academic-header .kicker {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
    }
    header.academic-header h1 {
      margin: 6px 0 4px;
      font-size: 22px;
      line-height: 1.25;
    }
    header.academic-header .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 13.5px;
      font-style: italic;
    }
    header.academic-header .meta-id {
      margin-top: 8px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      color: var(--muted);
    }
    h2 {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ink);
      border-bottom: 1px solid var(--border);
      padding-bottom: 4px;
      margin-top: 24px;
      margin-bottom: 10px;
    }
    p {
      margin: 0 0 10px;
      text-align: justify;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11.5px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      background: var(--bg-soft);
      font-weight: 700;
      color: var(--ink);
    }
    td.num, th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    td.svg-cell {
      text-align: center;
      width: 128px;
    }
    .unit {
      color: var(--muted);
      font-weight: 400;
    }
    .water-box {
      border: 1.5px solid #0284c7;
      background: #f0f9ff;
      border-radius: 8px;
      padding: 14px 16px;
      margin: 14px 0 18px;
      font-family: system-ui, -apple-system, sans-serif;
      break-inside: avoid;
    }
    .water-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 8px;
      font-size: 12px;
    }
    .disclaimer-list, .citation-list {
      margin: 8px 0 16px;
      padding-left: 20px;
    }
    .disclaimer-list li, .citation-list li {
      margin-bottom: 6px;
    }
    a {
      color: var(--accent);
      word-break: break-all;
    }
    footer {
      margin-top: 28px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
    }
    @media print {
      @page {
        size: A4 portrait;
        margin: 14mm 12mm;
      }
      body {
        padding: 0;
        font-size: 11.5px;
      }
      h2, table, .water-box {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="academic-header">
      <div class="kicker">FieldCast V4 • Relatório Técnico e Científico Auditável</div>
      <h1>${escapeHtml(doc.title)}</h1>
      <p class="subtitle">${escapeHtml(doc.subtitle)}</p>
      <div class="meta-id">ID: ${escapeHtml(doc.reportId)} • Emitido em: ${escapeHtml(doc.generatedAtIso)}</div>
    </header>

    <section>
      <h2>1. Identificação Geodésica e Metadados da Amostragem</h2>
      <table>
        <tbody>
          <tr>
            <th>Localidade / Estação</th>
            <td>${escapeHtml(analysis.locationName)}</td>
            <th>Coordenadas WGS84</th>
            <td class="num">${analysis.latitude.toFixed(4)}°, ${analysis.longitude.toFixed(4)}°</td>
          </tr>
          <tr>
            <th>Altitude Ortométrica (DEM)</th>
            <td class="num">${Math.round(analysis.elevationDemM)} m (SRTM / Copernicus)</td>
            <th>Fuso Horário Local</th>
            <td>${escapeHtml(analysis.timezone)}</td>
          </tr>
          <tr>
            <th>Janela Temporal (Início – Fim)</th>
            <td colspan="3">${escapeHtml(analysis.periodStartIso)} &rarr; ${escapeHtml(analysis.periodEndIso)}</td>
          </tr>
          <tr>
            <th>Fonte Ativa / Modelos</th>
            <td>${escapeHtml(analysis.activeModelLabel)} (${escapeHtml(analysis.modelsCompared.join(', '))})</td>
            <th>Vento Vetorial Dominante</th>
            <td class="num">${fmtStat(analysis.dominantWindDirectionDeg, 1)}° (${windCardinal}) • R = ${fmtStat(analysis.windDirectionalConsistencyR, 3)}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>2. Resumo Executivo</h2>
      <p>${escapeHtml(doc.executiveSummary)}</p>
    </section>

    <section>
      <h2>3. Síntese Estatística Descritiva, Quantis e Tendência Linear (OLS)</h2>
      <table>
        <thead>
          <tr>
            <th>Variável</th>
            <th class="num">N</th>
            <th class="num">Média</th>
            <th class="num">DP (&sigma;)</th>
            <th class="num">Mediana</th>
            <th class="num">Mín</th>
            <th class="num">P10</th>
            <th class="num">P90</th>
            <th class="num">Máx</th>
            <th class="num">IQR</th>
            <th class="num">Tend./24h</th>
            <th class="num">|Z| máx</th>
            <th>Perfil P10–P90 / Média</th>
          </tr>
        </thead>
        <tbody>
          ${statsRowsHtml}
        </tbody>
      </table>
    </section>

    <section class="water-box">
      <strong>Quadro Agroclimático e Balanço Hídrico Superficial (FAO-56): ${escapeHtml(stressLabel)}</strong>
      <div class="water-grid">
        <div>Precipitação Acumulada (P): <strong>${fmtStat(wb.totalPrecipitationMm, 2)} mm</strong></div>
        <div>Evapotranspiração Ref. (ET0): <strong>${fmtStat(wb.totalEt0FaoMm, 2)} mm</strong></div>
        <div>Saldo Hídrico Líquido (P - ET0): <strong>${fmtSigned(wb.netWaterBalanceMm, 2)} mm</strong></div>
        <div>Graus-Dia Acumulados (GDD Base 10°C): <strong>${fmtStat(wb.growingDegreeDaysBase10C, 2)} °C·dia</strong></div>
        <div>Umidade Relativa Média (2m): <strong>${fmtStat(wb.meanRelativeHumidityPct, 1)} %</strong></div>
        <div>Índice de Calor Máximo (Rothfusz): <strong>${fmtStat(wb.maxHeatIndexC, 1)} °C</strong></div>
      </div>
    </section>

    <section>
      <h2>4. Metodologia Físico-Matemática</h2>
      ${methodologyParagraphsHtml}
    </section>

    <section>
      <h2>5. Interpretação Objetiva dos Resultados</h2>
      <p>${escapeHtml(doc.resultsInterpretation)}</p>
    </section>

    <section>
      <h2>6. Discussão Parcimoniosa</h2>
      <p>${escapeHtml(doc.parcimonicDiscussion)}</p>
    </section>

    <section>
      <h2>7. Limitações Técnicas e Avisos Operacionais Obrigatórios</h2>
      <ul class="disclaimer-list">
        ${disclaimersHtml}
      </ul>
    </section>

    <section>
      <h2>8. Referências Bibliográficas e Fontes Primárias de Dados</h2>
      <ol class="citation-list">
        ${citationsHtml}
      </ol>
    </section>

    <footer>
      <span>FieldCast Offline-First Multi-Model Weather &amp; Field Operations</span>
      <span>Documento ${escapeHtml(doc.reportId)}</span>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Formata o relatório técnico-científico em Markdown compatível com GitHub/Pandoc/LaTeX.
 */
export function formatTechnicalReportMarkdown(doc: TechnicalReportDocument): string {
  const { analysis } = doc;
  const wb = analysis.waterBalance;
  const windCardinal = formatCardinalDirection(analysis.dominantWindDirectionDeg);
  const stressLabel = WATER_STRESS_LABELS_PT[wb.waterStressClassification];

  const lines: string[] = [
    `# ${doc.title}`,
    '',
    `> **${doc.subtitle}**  `,
    `> **ID do Relatório:** \`${doc.reportId}\` | **Gerado em:** \`${doc.generatedAtIso}\``,
    '',
    '## 1. Metadados Geodésicos e Operacionais',
    '',
    '| Parâmetro | Valor |',
    '| :--- | :--- |',
    `| Localidade | ${analysis.locationName} |`,
    `| Coordenadas (WGS84) | ${analysis.latitude.toFixed(4)}°, ${analysis.longitude.toFixed(4)}° |`,
    `| Altitude Ortométrica (DEM) | ${Math.round(analysis.elevationDemM)} m |`,
    `| Fuso Horário | ${analysis.timezone} |`,
    `| Período Analisado | ${analysis.periodStartIso} a ${analysis.periodEndIso} |`,
    `| Fonte / Modelos | ${analysis.activeModelLabel} (${analysis.modelsCompared.join(', ')}) |`,
    `| Vento Vetorial Dominante | ${fmtStat(analysis.dominantWindDirectionDeg, 1)}° (${windCardinal}) — Consistência R = ${fmtStat(analysis.windDirectionalConsistencyR, 3)} |`,
    '',
    '## 2. Resumo Executivo',
    '',
    doc.executiveSummary,
    '',
    '## 3. Estatística Descritiva, Quantis e Tendência Linear (OLS)',
    '',
    '| Variável | Unid. | N | Média | DP | Mediana | Mín | P10 | P90 | Máx | IQR | Tendência/dia | \\|Z\\| máx |',
    '| :--- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const m of analysis.metrics) {
    lines.push(
      `| ${m.label} | ${m.unit} | ${m.sampleCount} | ${fmtStat(m.mean, 2)} | ${fmtStat(m.stdDev, 2)} | ${fmtStat(m.median, 2)} | ${fmtStat(m.min, 2)} | ${fmtStat(m.p10, 2)} | ${fmtStat(m.p90, 2)} | ${fmtStat(m.max, 2)} | ${fmtStat(m.iqr, 2)} | ${fmtSigned(m.linearTrendPerDay, 2)} | ${fmtStat(m.anomalyZScoreMax, 2)} |`,
    );
  }

  lines.push(
    '',
    '## 4. Balanço Hídrico Agroclimático (FAO-56)',
    '',
    `- **Classificação Hídrica:** ${stressLabel}`,
    `- **Precipitação Acumulada (P):** ${fmtStat(wb.totalPrecipitationMm, 2)} mm`,
    `- **Evapotranspiração de Referência (ET0):** ${fmtStat(wb.totalEt0FaoMm, 2)} mm`,
    `- **Saldo Hídrico Líquido (P - ET0):** ${fmtSigned(wb.netWaterBalanceMm, 2)} mm`,
    `- **Graus-Dia de Crescimento (GDD Base 10 °C):** ${fmtStat(wb.growingDegreeDaysBase10C, 2)} °C·dia`,
    `- **Umidade Relativa Média (2m):** ${fmtStat(wb.meanRelativeHumidityPct, 1)} %`,
    `- **Índice de Calor Máximo (Rothfusz/Steadman):** ${fmtStat(wb.maxHeatIndexC, 1)} °C`,
    '',
    '## 5. Metodologia Científica',
    '',
    doc.methodologySection,
    '',
    '## 6. Interpretação dos Resultados',
    '',
    doc.resultsInterpretation,
    '',
    '## 7. Discussão Parcimoniosa',
    '',
    doc.parcimonicDiscussion,
    '',
    '## 8. Limitações e Avisos Operacionais',
    '',
    ...doc.limitationsAndDisclaimers.map((d) => `- ${d}`),
    '',
    '## 9. Referências Acadêmicas e Fontes de Dados',
    '',
    ...analysis.citations.map(
      (c, i) =>
        `${i + 1}. **${c.datasetName}** (*${c.provider}*, ${c.spatialResolution}, ${c.temporalResolution}). ${c.formalCitation} — ${c.url}`,
    ),
    '',
  );

  return lines.join('\n');
}

/**
 * Exporta o resumo estatístico e agroclimático em CSV prefixado com UTF-8 BOM (`\uFEFF`)
 * para compatibilidade direta com Excel, R, Python/Pandas e QGIS.
 */
export function formatScientificStatsCsvBom(analysis: ScientificAnalysisSummary): string {
  const headers = [
    'dataset_kind',
    'location_name',
    'latitude',
    'longitude',
    'elevation_dem_m',
    'timezone',
    'period_start_iso',
    'period_end_iso',
    'active_model_label',
    'variable_key',
    'variable_label',
    'unit',
    'sample_count',
    'mean',
    'std_dev',
    'median',
    'min',
    'p10',
    'p90',
    'max',
    'iqr',
    'linear_trend_per_day',
    'anomaly_z_score_max',
    'dominant_wind_dir_deg',
    'wind_consistency_r',
    'total_precip_mm',
    'total_et0_fao_mm',
    'net_water_balance_mm',
    'water_stress_class',
    'gdd_base10_c',
  ];

  const rows: string[] = [headers.join(',')];
  const wb = analysis.waterBalance;

  for (const m of analysis.metrics) {
    const row: unknown[] = [
      analysis.datasetKind,
      analysis.locationName,
      analysis.latitude.toFixed(4),
      analysis.longitude.toFixed(4),
      analysis.elevationDemM.toFixed(1),
      analysis.timezone,
      analysis.periodStartIso,
      analysis.periodEndIso,
      analysis.activeModelLabel,
      m.variableKey,
      m.label,
      m.unit,
      m.sampleCount,
      m.mean !== null ? m.mean.toFixed(3) : '',
      m.stdDev !== null ? m.stdDev.toFixed(3) : '',
      m.median !== null ? m.median.toFixed(3) : '',
      m.min !== null ? m.min.toFixed(3) : '',
      m.p10 !== null ? m.p10.toFixed(3) : '',
      m.p90 !== null ? m.p90.toFixed(3) : '',
      m.max !== null ? m.max.toFixed(3) : '',
      m.iqr !== null ? m.iqr.toFixed(3) : '',
      m.linearTrendPerDay !== null ? m.linearTrendPerDay.toFixed(3) : '',
      m.anomalyZScoreMax !== null ? m.anomalyZScoreMax.toFixed(3) : '',
      analysis.dominantWindDirectionDeg !== null
        ? analysis.dominantWindDirectionDeg.toFixed(1)
        : '',
      analysis.windDirectionalConsistencyR !== null
        ? analysis.windDirectionalConsistencyR.toFixed(3)
        : '',
      wb.totalPrecipitationMm.toFixed(2),
      wb.totalEt0FaoMm.toFixed(2),
      wb.netWaterBalanceMm.toFixed(2),
      wb.waterStressClassification,
      wb.growingDegreeDaysBase10C.toFixed(2),
    ];
    rows.push(row.map(escapeCsvCell).join(','));
  }

  return UTF8_BOM + rows.join('\r\n');
}

/**
 * Serializa o documento técnico completo (`TechnicalReportDocument`) em JSON estruturado.
 */
export function formatTechnicalReportJson(doc: TechnicalReportDocument): string {
  return JSON.stringify(doc, null, 2);
}

// ============================================================================
// Exportador PDF 1.4 100% Client-Side (WinAnsi, multipágina, tabela xref exata)
// ============================================================================

const WINANSI_EXTRA_MAP: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

const UNICODE_ASCII_FALLBACK: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '−': '-',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '≈': '~=',
  '∈': 'in',
  'α': 'alpha',
  'β': 'beta',
  'Δ': 'Delta',
  'σ': 'sigma',
  'θ': 'theta',
  'π': 'pi',
  'Σ': 'Sigma',
  '∑': 'soma',
};

function sanitizeForPdfMeasure(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (UNICODE_ASCII_FALLBACK[ch]) {
      out += UNICODE_ASCII_FALLBACK[ch];
    } else {
      out += ch;
    }
  }
  return out;
}

function encodePdfWinAnsiLiteralBytes(raw: string): number[] {
  const normalized = sanitizeForPdfMeasure(raw);
  const bytes: number[] = [0x28]; // '('
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      // Escapa '(', ')' e '\'
      bytes.push(0x5c, code);
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      bytes.push(code);
      continue;
    }
    const winAnsiCode = WINANSI_EXTRA_MAP[code];
    if (winAnsiCode !== undefined) {
      bytes.push(winAnsiCode);
      continue;
    }
    // Fallback ASCII para caracteres fora da tabela WinAnsi
    const asciiBase = normalized[i]!
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (asciiBase.length > 0 && asciiBase.charCodeAt(0) >= 0x20 && asciiBase.charCodeAt(0) <= 0x7e) {
      const fallbackCode = asciiBase.charCodeAt(0);
      if (fallbackCode === 0x28 || fallbackCode === 0x29 || fallbackCode === 0x5c) {
        bytes.push(0x5c, fallbackCode);
      } else {
        bytes.push(fallbackCode);
      }
    } else {
      bytes.push(0x3f); // '?'
    }
  }
  bytes.push(0x29); // ')'
  return bytes;
}

function wrapPdfLines(text: string, maxWidthPt: number, fontSizePt: number): string[] {
  const cleaned = sanitizeForPdfMeasure(text).replace(/\r\n/g, '\n');
  const approxCharWidth = fontSizePt * 0.51;
  const maxChars = Math.max(16, Math.floor(maxWidthPt / approxCharWidth));
  const result: string[] = [];

  for (const paragraph of cleaned.split('\n')) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      if (!currentLine) {
        if (word.length <= maxChars) {
          currentLine = word;
        } else {
          // Quebra palavra muito longa (ex.: URL)
          for (let i = 0; i < word.length; i += maxChars) {
            result.push(word.slice(i, i + maxChars));
          }
          currentLine = '';
        }
      } else if (currentLine.length + 1 + word.length <= maxChars) {
        currentLine += ` ${word}`;
      } else {
        result.push(currentLine);
        if (word.length <= maxChars) {
          currentLine = word;
        } else {
          for (let i = 0; i < word.length; i += maxChars) {
            result.push(word.slice(i, i + maxChars));
          }
          currentLine = '';
        }
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

function asciiToBytes(str: string): Uint8Array {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    arr[i] = str.charCodeAt(i) & 0xff;
  }
  return arr;
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) {
    total += c.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

interface PdfTextCommand {
  font: 'F1' | 'F2';
  size: number;
  x: number;
  y: number;
  text: string;
}

/**
 * Gera um documento **PDF 1.4** binário válido 100% no cliente (`Uint8Array`)
 * com paginação automática A4, tipografia Helvetica / Helvetica-Bold (WinAnsiEncoding),
 * tabela de métricas estatísticas, balanço hídrico e tabela `xref` exata por byte-offset.
 */
export function generateTechnicalReportPdfBytes(doc: TechnicalReportDocument): Uint8Array {
  const { analysis } = doc;
  const wb = analysis.waterBalance;
  const windCardinal = formatCardinalDirection(analysis.dominantWindDirectionDeg);
  const stressLabel = WATER_STRESS_LABELS_PT[wb.waterStressClassification];

  const pageWidth = 595;
  const pageHeight = 842;
  const marginLeft = 45;
  const marginRight = 45;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const topY = 792;
  const bottomY = 52;

  const pages: PdfTextCommand[][] = [[]];
  let cursorY = topY;

  const ensureSpace = (neededPt: number) => {
    if (cursorY - neededPt < bottomY) {
      pages.push([]);
      cursorY = topY;
    }
  };

  const pushTextLine = (
    text: string,
    options?: {
      font?: 'F1' | 'F2';
      size?: number;
      lineHeight?: number;
      indent?: number;
    },
  ) => {
    const font = options?.font ?? 'F1';
    const size = options?.size ?? 9.5;
    const lineHeight = options?.lineHeight ?? size * 1.38;
    const indent = options?.indent ?? 0;
    ensureSpace(lineHeight);
    pages[pages.length - 1]!.push({
      font,
      size,
      x: marginLeft + indent,
      y: cursorY,
      text,
    });
    cursorY -= lineHeight;
  };

  const pushParagraph = (
    text: string,
    options?: { font?: 'F1' | 'F2'; size?: number; indent?: number; spaceAfter?: number },
  ) => {
    const font = options?.font ?? 'F1';
    const size = options?.size ?? 9.5;
    const indent = options?.indent ?? 0;
    const lines = wrapPdfLines(text, contentWidth - indent, size);
    for (const line of lines) {
      if (line === '') {
        cursorY -= size * 0.6;
        continue;
      }
      pushTextLine(line, { font, size, indent });
    }
    cursorY -= options?.spaceAfter ?? 5;
  };

  const pushSectionHeading = (heading: string) => {
    ensureSpace(28);
    cursorY -= 6;
    pushTextLine(heading, { font: 'F2', size: 11.5, lineHeight: 16 });
    cursorY -= 2;
  };

  // Cabeçalho do relatório
  pushParagraph(doc.title, { font: 'F2', size: 14, spaceAfter: 3 });
  pushParagraph(doc.subtitle, { font: 'F1', size: 10, spaceAfter: 3 });
  pushParagraph(`ID: ${doc.reportId} | Emitido em: ${doc.generatedAtIso}`, {
    font: 'F1',
    size: 8.5,
    spaceAfter: 8,
  });

  // Seção 1: Metadados Geodésicos
  pushSectionHeading('1. Identificação Geodésica e Metadados');
  pushParagraph(
    `Localidade: ${analysis.locationName} | Coordenadas WGS84: ${analysis.latitude.toFixed(4)}°, ${analysis.longitude.toFixed(4)}° | Altitude DEM: ${Math.round(analysis.elevationDemM)} m`,
    { size: 9, spaceAfter: 2 },
  );
  pushParagraph(
    `Fuso Horário: ${analysis.timezone} | Janela: ${analysis.periodStartIso} -> ${analysis.periodEndIso}`,
    { size: 9, spaceAfter: 2 },
  );
  pushParagraph(
    `Fonte / Modelos: ${analysis.activeModelLabel} (${analysis.modelsCompared.join(', ')}) | Vento Vetorial: ${fmtStat(analysis.dominantWindDirectionDeg, 1)}° (${windCardinal}), R = ${fmtStat(analysis.windDirectionalConsistencyR, 3)}`,
    { size: 9, spaceAfter: 6 },
  );

  // Seção 2: Resumo Executivo
  pushSectionHeading('2. Resumo Executivo');
  pushParagraph(doc.executiveSummary, { size: 9.5, spaceAfter: 6 });

  // Seção 3: Balanço Hídrico Agroclimático
  pushSectionHeading('3. Balanço Hídrico Agroclimático (FAO-56)');
  pushParagraph(`Classificação Hídrica: ${stressLabel}`, { font: 'F2', size: 9.5, spaceAfter: 2 });
  pushParagraph(
    `Precipitação (P): ${fmtStat(wb.totalPrecipitationMm, 2)} mm | ET0 Ref.: ${fmtStat(wb.totalEt0FaoMm, 2)} mm | Saldo Líquido (P - ET0): ${fmtSigned(wb.netWaterBalanceMm, 2)} mm`,
    { size: 9, spaceAfter: 2 },
  );
  pushParagraph(
    `Graus-Dia (GDD Base 10°C): ${fmtStat(wb.growingDegreeDaysBase10C, 2)} °C·dia | Umidade Relativa Média: ${fmtStat(wb.meanRelativeHumidityPct, 1)}% | Índice de Calor Máx.: ${fmtStat(wb.maxHeatIndexC, 1)} °C`,
    { size: 9, spaceAfter: 6 },
  );

  // Seção 4: Tabela de Métricas Estatísticas
  pushSectionHeading('4. Síntese Estatística Descritiva, Quantis e Tendência (OLS)');
  pushTextLine(
    'Variável (Unid.) | N | Média | DP | Med | Mín | P10 | P90 | Máx | Tend/24h | |Z|máx',
    { font: 'F2', size: 8, lineHeight: 12 },
  );
  for (const m of analysis.metrics) {
    const rowText = `${m.label} (${m.unit}) | ${m.sampleCount} | ${fmtStat(m.mean, 2)} | ${fmtStat(m.stdDev, 2)} | ${fmtStat(m.median, 2)} | ${fmtStat(m.min, 2)} | ${fmtStat(m.p10, 2)} | ${fmtStat(m.p90, 2)} | ${fmtStat(m.max, 2)} | ${fmtSigned(m.linearTrendPerDay, 2)} | ${fmtStat(m.anomalyZScoreMax, 2)}`;
    pushParagraph(rowText, { size: 8, spaceAfter: 2 });
  }

  // Seção 5: Metodologia
  pushSectionHeading('5. Metodologia Físico-Matemática');
  pushParagraph(doc.methodologySection, { size: 9, spaceAfter: 6 });

  // Seção 6: Interpretação dos Resultados
  pushSectionHeading('6. Interpretação Objetiva dos Resultados');
  pushParagraph(doc.resultsInterpretation, { size: 9.5, spaceAfter: 6 });

  // Seção 7: Discussão Parcimoniosa
  pushSectionHeading('7. Discussão Parcimoniosa');
  pushParagraph(doc.parcimonicDiscussion, { size: 9.5, spaceAfter: 6 });

  // Seção 8: Limitações e Avisos
  pushSectionHeading('8. Limitações Técnicas e Avisos Operacionais');
  for (const disclaimer of doc.limitationsAndDisclaimers) {
    pushParagraph(`• ${disclaimer}`, { size: 8.8, indent: 8, spaceAfter: 3 });
  }

  // Seção 9: Referências
  if (analysis.citations.length > 0) {
    pushSectionHeading('9. Referências e Fontes Primárias');
    analysis.citations.forEach((c, idx) => {
      pushParagraph(
        `${idx + 1}. ${c.datasetName} (${c.provider}, ${c.spatialResolution}, ${c.temporalResolution}): ${c.formalCitation} — ${c.url}`,
        { size: 8.2, indent: 8, spaceAfter: 2 },
      );
    });
  }

  // Rodapé paginado em cada página
  const totalPages = pages.length;
  pages.forEach((cmds, pageIdx) => {
    cmds.push({
      font: 'F1',
      size: 8,
      x: marginLeft,
      y: 28,
      text: `FieldCast Offline-First Technical Report • ${doc.reportId} • Página ${pageIdx + 1}/${totalPages}`,
    });
  });

  // Monta os streams de conteúdo de cada página
  const buildPageStreamBytes = (cmds: readonly PdfTextCommand[]): Uint8Array => {
    const streamChunks: Uint8Array[] = [asciiToBytes('BT\n')];
    for (const cmd of cmds) {
      streamChunks.push(
        asciiToBytes(`/${cmd.font} ${cmd.size.toFixed(1)} Tf 1 0 0 1 ${cmd.x.toFixed(1)} ${cmd.y.toFixed(1)} Tm `),
      );
      streamChunks.push(new Uint8Array(encodePdfWinAnsiLiteralBytes(cmd.text)));
      streamChunks.push(asciiToBytes(' Tj\n'));
    }
    streamChunks.push(asciiToBytes('ET\n'));
    return concatUint8Arrays(streamChunks);
  };

  // Objetos PDF:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Helvetica + WinAnsiEncoding)
  // 4: Font F2 (Helvetica-Bold + WinAnsiEncoding)
  // Para cada página i (0..totalPages-1):
  //   pageObjNum = 5 + i*2
  //   contentObjNum = 6 + i*2
  const objects: Array<{ id: number; body: Uint8Array }> = [];
  const pageIds = pages.map((_, idx) => 5 + idx * 2);

  objects.push({
    id: 1,
    body: asciiToBytes('<< /Type /Catalog /Pages 2 0 R >>'),
  });
  objects.push({
    id: 2,
    body: asciiToBytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${totalPages} >>`),
  });
  objects.push({
    id: 3,
    body: asciiToBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  });
  objects.push({
    id: 4,
    body: asciiToBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  });

  pages.forEach((cmds, idx) => {
    const pageObjId = 5 + idx * 2;
    const contentObjId = 6 + idx * 2;
    const streamBytes = buildPageStreamBytes(cmds);

    objects.push({
      id: pageObjId,
      body: asciiToBytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
      ),
    });

    objects.push({
      id: contentObjId,
      body: concatUint8Arrays([
        asciiToBytes(`<< /Length ${streamBytes.byteLength} >>\nstream\n`),
        streamBytes,
        asciiToBytes('endstream'),
      ]),
    });
  });

  // Serializa arquivo PDF com byte-offsets exatos para xref
  const fileChunks: Uint8Array[] = [
    new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  ];
  let byteOffset = fileChunks[0]!.byteLength;
  const offsets: number[] = [0]; // obj 0

  for (const obj of objects) {
    offsets[obj.id] = byteOffset;
    const header = asciiToBytes(`${obj.id} 0 obj\n`);
    const footer = asciiToBytes('\nendobj\n');
    fileChunks.push(header, obj.body, footer);
    byteOffset += header.byteLength + obj.body.byteLength + footer.byteLength;
  }

  const xrefOffset = byteOffset;
  const maxObjId = objects.length;
  const xrefLines: string[] = [
    `xref\n0 ${maxObjId + 1}\n`,
    '0000000000 65535 f \n',
  ];
  for (let id = 1; id <= maxObjId; id++) {
    const off = offsets[id] ?? 0;
    xrefLines.push(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
  xrefLines.push(
    `trailer\n<< /Size ${maxObjId + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n`,
    '%%EOF\n',
  );

  fileChunks.push(asciiToBytes(xrefLines.join('')));
  return concatUint8Arrays(fileChunks);
}

// ============================================================================
// Exportador OOXML (.docx) 100% Client-Side via buildPureZipArchiveBytes
// ============================================================================

function escapeDocxXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildDocxParagraph(text: string, styleId?: string, bold = false): string {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
  const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeDocxXml(text)}</w:t></w:r></w:p>`;
}

function buildDocxTableCell(text: string, isHeader = false): string {
  const shd = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/>' : '';
  const rPr = isHeader ? '<w:rPr><w:b/><w:sz w:val="18"/></w:rPr>' : '<w:rPr><w:sz w:val="18"/></w:rPr>';
  return `<w:tc><w:tcPr>${shd}</w:tcPr><w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeDocxXml(text)}</w:t></w:r></w:p></w:tc>`;
}

/**
 * Gera um arquivo **OOXML (.docx)** válido 100% no cliente via `buildPureZipArchiveBytes`,
 * contendo `[Content_Types].xml`, `_rels/.rels`, `word/styles.xml` e `word/document.xml`
 * com títulos estilizados, resumo executivo, tabela `<w:tbl>` de métricas e notas metodológicas.
 */
export function generateTechnicalReportDocxBytes(doc: TechnicalReportDocument): Uint8Array {
  const { analysis } = doc;
  const wb = analysis.waterBalance;
  const windCardinal = formatCardinalDirection(analysis.dominantWindDirectionDeg);
  const stressLabel = WATER_STRESS_LABELS_PT[wb.waterStressClassification];

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '</Types>',
  ].join('\n');

  const rootRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join('\n');

  const stylesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">',
    '    <w:name w:val="Normal"/>',
    '    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>',
    '  </w:style>',
    '  <w:style w:type="paragraph" w:styleId="Title">',
    '    <w:name w:val="Title"/>',
    '    <w:basedOn w:val="Normal"/>',
    '    <w:pPr><w:spacing w:after="120"/></w:pPr>',
    '    <w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="32"/></w:rPr>',
    '  </w:style>',
    '  <w:style w:type="paragraph" w:styleId="Heading1">',
    '    <w:name w:val="heading 1"/>',
    '    <w:basedOn w:val="Normal"/>',
    '    <w:pPr><w:spacing w:before="220" w:after="80"/></w:pPr>',
    '    <w:rPr><w:b/><w:color w:val="0369A1"/><w:sz w:val="26"/></w:rPr>',
    '  </w:style>',
    '</w:styles>',
  ].join('\n');

  const tableHeaders = [
    'Variável',
    'Unid.',
    'N',
    'Média',
    'DP',
    'Mediana',
    'Mín',
    'P10',
    'P90',
    'Máx',
    'IQR',
    'Tend./24h',
    '|Z| máx',
  ];

  const headerRowXml = `<w:tr>${tableHeaders.map((h) => buildDocxTableCell(h, true)).join('')}</w:tr>`;
  const dataRowsXml = analysis.metrics
    .map((m) => {
      const cells = [
        m.label,
        m.unit,
        String(m.sampleCount),
        fmtStat(m.mean, 2),
        fmtStat(m.stdDev, 2),
        fmtStat(m.median, 2),
        fmtStat(m.min, 2),
        fmtStat(m.p10, 2),
        fmtStat(m.p90, 2),
        fmtStat(m.max, 2),
        fmtStat(m.iqr, 2),
        fmtSigned(m.linearTrendPerDay, 2),
        fmtStat(m.anomalyZScoreMax, 2),
      ];
      return `<w:tr>${cells.map((c) => buildDocxTableCell(c, false)).join('')}</w:tr>`;
    })
    .join('');

  const metricsTableXml = [
    '<w:tbl>',
    '  <w:tblPr>',
    '    <w:tblBorders>',
    '      <w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>',
    '      <w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>',
    '      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>',
    '      <w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>',
    '      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>',
    '      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>',
    '    </w:tblBorders>',
    '  </w:tblPr>',
    headerRowXml,
    dataRowsXml,
    '</w:tbl>',
  ].join('');

  const bodyParts: string[] = [
    buildDocxParagraph(doc.title, 'Title', true),
    buildDocxParagraph(doc.subtitle),
    buildDocxParagraph(`ID do Relatório: ${doc.reportId} | Emitido em: ${doc.generatedAtIso}`),

    buildDocxParagraph('1. Identificação Geodésica e Metadados', 'Heading1', true),
    buildDocxParagraph(
      `Localidade: ${analysis.locationName} | Coordenadas WGS84: ${analysis.latitude.toFixed(4)}°, ${analysis.longitude.toFixed(4)}° | Altitude Ortométrica (DEM): ${Math.round(analysis.elevationDemM)} m`,
    ),
    buildDocxParagraph(
      `Fuso Horário: ${analysis.timezone} | Janela Temporal: ${analysis.periodStartIso} a ${analysis.periodEndIso}`,
    ),
    buildDocxParagraph(
      `Fonte / Modelos: ${analysis.activeModelLabel} (${analysis.modelsCompared.join(', ')}) | Vento Vetorial Dominante: ${fmtStat(analysis.dominantWindDirectionDeg, 1)}° (${windCardinal}), R = ${fmtStat(analysis.windDirectionalConsistencyR, 3)}`,
    ),

    buildDocxParagraph('2. Resumo Executivo', 'Heading1', true),
    buildDocxParagraph(doc.executiveSummary),

    buildDocxParagraph('3. Balanço Hídrico Agroclimático (FAO-56)', 'Heading1', true),
    buildDocxParagraph(`Classificação Hídrica: ${stressLabel}`, undefined, true),
    buildDocxParagraph(
      `Precipitação Acumulada (P): ${fmtStat(wb.totalPrecipitationMm, 2)} mm | Evapotranspiração Ref. (ET0): ${fmtStat(wb.totalEt0FaoMm, 2)} mm | Saldo Hídrico (P - ET0): ${fmtSigned(wb.netWaterBalanceMm, 2)} mm`,
    ),
    buildDocxParagraph(
      `Graus-Dia Acumulados (GDD Base 10°C): ${fmtStat(wb.growingDegreeDaysBase10C, 2)} °C·dia | Umidade Relativa Média: ${fmtStat(wb.meanRelativeHumidityPct, 1)}% | Índice de Calor Máximo: ${fmtStat(wb.maxHeatIndexC, 1)} °C`,
    ),

    buildDocxParagraph('4. Síntese Estatística Descritiva, Quantis e Tendência Linear (OLS)', 'Heading1', true),
    metricsTableXml,

    buildDocxParagraph('5. Metodologia Físico-Matemática', 'Heading1', true),
    ...doc.methodologySection.split(/\n\n+/).map((p) => buildDocxParagraph(p)),

    buildDocxParagraph('6. Interpretação Objetiva dos Resultados', 'Heading1', true),
    buildDocxParagraph(doc.resultsInterpretation),

    buildDocxParagraph('7. Discussão Parcimoniosa', 'Heading1', true),
    buildDocxParagraph(doc.parcimonicDiscussion),

    buildDocxParagraph('8. Limitações Técnicas e Avisos Operacionais', 'Heading1', true),
    ...doc.limitationsAndDisclaimers.map((d) => buildDocxParagraph(`• ${d}`)),

    buildDocxParagraph('9. Referências Bibliográficas e Fontes Primárias', 'Heading1', true),
    ...analysis.citations.map((c, idx) =>
      buildDocxParagraph(
        `${idx + 1}. ${c.datasetName} (${c.provider}, ${c.spatialResolution}, ${c.temporalResolution}): ${c.formalCitation} — ${c.url}`,
      ),
    ),
  ];

  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `  <w:body>${bodyParts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>`,
    '</w:document>',
  ].join('\n');

  return buildPureZipArchiveBytes([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/document.xml', data: documentXml },
  ]);
}
