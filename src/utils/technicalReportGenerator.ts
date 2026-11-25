import type {
  AgroClimaticWaterBalance,
  DescriptiveMetricStats,
  ScientificAnalysisSummary,
  TechnicalReportDocument,
} from '../types/v4';
import { formatCardinalDirection, UTF8_BOM } from './exporters';
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
