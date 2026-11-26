import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle, Lightbulb, X } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export type HelpTopicId =
  | 'confidence'
  | 'ensemble_vs_native'
  | 'vertical_profile'
  | 'barometric_trend'
  | 'safe_window'
  | 'fog_risk'
  | 'stratified_clouds'
  | 'waves_swell'
  | 'ephemeris'
  | 'confidence_agreement'
  | 'confidence_integrity'
  | 'confidence_proximity'
  | 'confidence_vertical'
  | 'model_dispersion'
  | 'report_studio_overview'
  | 'report_water_balance'
  | 'report_gdd'
  | 'report_vector_r'
  | 'report_zscore_ols'
  | 'report_era5_hybrid'
  | 'report_16d_projection'
  | 'summary_overview'
  | 'alerts_builder_help';

export interface HelpTopicDefinition {
  title: string;
  summary: string;
  details: string[];
  operationalTip?: string;
}

export const HELP_TOPICS: Record<HelpTopicId, HelpTopicDefinition> = {
  confidence: {
    title: 'Índice de Confiabilidade (0 a 100)',
    summary:
      'Mede o grau de certeza da previsão combinando a concordância entre 4 modelos globais (ECMWF, GFS, ICON e GEM), a saúde das fontes e o horizonte de tempo.',
    details: [
      'Concordância entre Modelos (até 50 pts): Compara os 4 modelos globais (ECMWF, GFS, ICON e GEM). Quanto menor a dispersão de vento/chuva e maior a coerência direcional vetorial (R → 1), maior a nota.',
      'Integridade e Frescor das Fontes (até 30 pts): Avalia se as APIs responderam em tempo real ou se o cache tem menos de 30 min. Em pontos continentais (sem mar), os pesos são redistribuídos automaticamente sem penalizar a nota.',
      'Horizonte Temporal (até 20 pts): Pontuação máxima nas primeiras 24h, com decaimento gradual de 24h a 72h e mais acentuado após 72h.',
      'Penalidade de Cisalhamento: Aplica desconto caso a interpolação vertical esteja ativa sob perfil de cisalhamento atípico (α fora de 0.05–0.40).',
    ],
    operationalTip:
      'Verde (80–100): Alta convergência entre modelos. Âmbar (50–79): Modelos divergem moderadamente; acompanhe as bandas min/máx. Vermelho (0–49): Alta incerteza; redobre a margem de segurança em campo.',
  },
  ensemble_vs_native: {
    title: 'Modelo FieldCast (Ensemble) vs. Modelos Nativos',
    summary:
      'Alterna entre a fusão estatística inteligente (Ensemble) e a leitura individual de cada centro meteorológico global.',
    details: [
      'Modelo FieldCast (Ensemble): Calcula hora a hora a média, mínimo, máximo e desvio padrão para variáveis escalares, e utiliza decomposição vetorial (u, v) para direções de vento e corrente.',
      'ECMWF IFS 0.25°: Modelo europeu de alta precisão sinótica (fornece vento nativo a 10m e 100m).',
      'NOAA GFS Seamless: Modelo norte-americano com excelente cobertura de visibilidade e vento a 10m, 80m e 120m.',
      'DWD ICON Seamless: Modelo alemão de malha icosaédrica detalhada (vento a 10m, 80m e 120m).',
      'CMC GEM Seamless: Modelo global canadense (15 km) que amplia a diversidade sinótica do consenso multi-modelo.',
      'Modo Spaghetti: Sobrepõe as curvas dos 4 modelos globais (ECMWF, GFS, ICON e GEM) no mesmo gráfico para visualizar rapidamente onde eles concordam ou divergem.',
    ],
    operationalTip:
      'Use o Modelo FieldCast para decisão geral e ative o modo Spaghetti quando quiser inspecionar qual modelo puxa o cenário mais extremo.',
  },
  vertical_profile: {
    title: 'Perfil Vertical de Vento (0–120m) & Cisalhamento (α)',
    summary:
      'Mostra como a velocidade do vento varia desde a superfície (10m) até 120m de altura (útil para drones, torres, guindastes e vela oceânica).',
    details: [
      'Níveis Nativos: São os dados brutos calculados diretamente pelos modelos (10m, 80m, 100m e 120m).',
      'Interpolação Estimada (10 em 10m): Quando ativada no Modelo FieldCast, estima os níveis intermediários pela Lei de Potência v(z) = v_ref · (z / z_ref)^α.',
      'Double-Check de Cisalhamento: Se o expoente α calculado ficar abaixo de 0.05 (atmosfera hiper-misturada/inversão) ou acima de 0.40 (cisalhamento severo), um alerta é disparado.',
      'Rajadas (Gusts): Exibidas estritamente a 10m de altura, nunca extrapoladas artificialmente para níveis superiores.',
    ],
    operationalTip:
      'Valores interpolados são sempre sinalizados com o selo "Estimado". Para decisões críticas em altitude, priorize os níveis nativos 80m, 100m e 120m.',
  },
  barometric_trend: {
    title: 'Tendência Barométrica (ΔP / 3h)',
    summary:
      'Monitora variações rápidas na pressão atmosférica ao nível da superfície para antecipar frentes frias e linhas de instabilidade (squalls).',
    details: [
      'Gatilho Operacional: Uma queda superior a 4 hPa em um intervalo de 3 horas (ΔP / 3h < -4 hPa) dispara alerta imediato.',
      'Significado Físico: Quedas bruscas de pressão indicam aproximação rápida de cavados, frentes ou tempestades convectivas com entrada repentina de rajadas.',
    ],
    operationalTip:
      'Se o alerta barométrico estiver ativo, antecipe o recolhimento de equipamentos sensíveis mesmo que o vento atual ainda pareça calmo.',
  },
  safe_window: {
    title: 'Semáforo de Janela Segura (Configurável)',
    summary:
      'Classifica automaticamente cada hora das próximas 168h em Verde, Amarelo ou Vermelho segundo os limites da sua operação.',
    details: [
      'Verde (Janela Segura): Vento, rajadas, ondas e probabilidade de chuva estão confortavelmente abaixo dos seus limites configurados.',
      'Amarelo (Atenção / Margem Limite): Pelo menos um parâmetro atingiu 80% ou mais do limite configurado, ou há risco moderado.',
      'Vermelho (Fora dos Limites): Um ou mais parâmetros ultrapassaram o teto operacional configurado.',
    ],
    operationalTip:
      'Clique em "Configurar Limites" para ajustar os tetos de vento (km/h), rajada (km/h), onda (m) e probabilidade de chuva (%) ao seu equipamento ou embarcação.',
  },
  fog_risk: {
    title: 'Alerta de Nevoeiro e Baixa Visibilidade',
    summary:
      'Combina visibilidade horizontal estimada com a proximidade entre temperatura do ar e ponto de orvalho (Dew Point Spread).',
    details: [
      'Gatilho Cruzado: Disparado quando a visibilidade cai abaixo de 1000m E o spread (Temperatura 2m − Ponto de Orvalho 2m) é inferior a 2 °C.',
      'Quando o ar esfria até quase atingir o ponto de orvalho, o vapor condensa formando nevoeiro denso ou neblina costeira.',
    ],
    operationalTip:
      'Crítico para navegação visual, operação de VANTs/drones e deslocamento em trilhas ou rodovias serranas.',
  },
  stratified_clouds: {
    title: 'Nebulosidade Estratificada (Baixa, Média e Alta)',
    summary:
      'Separa a cobertura de nuvens em três camadas atmosféricas para avaliar teto operacional, radiação solar e potencial de chuva.',
    details: [
      'Nuvens Baixas (0–2 km): Stratus, Cumulus e Stratocumulus. Afetam diretamente o teto visual, nevoeiro de encosta e garoa.',
      'Nuvens Médias (2–6 km): Altostratus e Altocumulus. Indicam transição sinótica e redução moderada de insolação.',
      'Nuvens Altas (> 6 km): Cirrus e Cirrostratus. Nuvens finas de cristais de gelo; raramente bloqueiam operações visuais, mas podem anteceder frentes.',
    ],
    operationalTip:
      'Céu com 90% de nuvens altas (Cirrus) ainda permite boa visibilidade e iluminação em campo, enquanto 90% de nuvens baixas indica teto fechado.',
  },
  waves_swell: {
    title: 'Ondas Significativas, Swell e Corrente Oceânica',
    summary:
      'Dados da grade oceanográfica Open-Meteo Marine para pontos costeiros e marítimos.',
    details: [
      'Altura Significativa de Onda (m): Média do terço maior das ondas combinando vaga local (gerada pelo vento local) e ondulação distante.',
      'Swell (Ondulação de Fundo): Ondas geradas por sistemas distantes, caracterizadas por período mais longo (s) e maior energia na costa.',
      'Nível do Mar Est. (MSL ~8 km): Estimativa barométrica/maré indicativa; não substitui Tábua de Marés oficial da DHN/Marinha.',
      'Detecção Continental: Em cidades no interior (terra firme), a grade marinha não se aplica e o sistema exibe um aviso informativo sem descontar pontos de confiabilidade.',
    ],
    operationalTip:
      'Atenção especial quando a direção do vento local for oposta à direção do Swell ou da corrente oceânica, pois isso gera mar curto e íngreme.',
  },
  ephemeris: {
    title: 'Efemérides Solares e Lunares (100% Offline)',
    summary:
      'Calculadas localmente no dispositivo via algoritmos astronômicos (SunCalc) para a coordenada e fuso horário ativos.',
    details: [
      'Crepúsculo Civil: Sol até 6° abaixo do horizonte — ainda há luz natural suficiente para atividades ao ar livre sem iluminação artificial.',
      'Crepúsculo Náutico: Sol entre 6° e 12° abaixo do horizonte — horizonte marítimo ainda distinguível para navegação.',
      'Fase e Iluminação Lunar: Percentual do disco lunar iluminado, essencial para operações noturnas e amplitude de marés (sizígia vs. quadratura).',
    ],
    operationalTip:
      'Planeje o retorno de campo antes do fim do Crepúsculo Civil para evitar desmontagem de equipamentos no escuro.',
  },
  confidence_agreement: {
    title: 'Sub-índice: Concordância entre Modelos (0–50 pts)',
    summary:
      'Quantifica o grau de consenso entre ECMWF, GFS, ICON e GEM para vento, chuva e direção vetorial.',
    details: [
      'Dispersão Escalar: Calcula o desvio-padrão entre os modelos para velocidade do vento e precipitação; menor spread eleva a pontuação.',
      'Coerência Direcional (R): Mede se os vetores de vento apontam para o mesmo quadrante (R próximo de 1).',
    ],
    operationalTip:
      'Pontuação abaixo de 25/50 indica divergência sinótica forte — ative o modo Spaghetti na aba Modelos.',
  },
  confidence_integrity: {
    title: 'Sub-índice: Integridade & Frescor das Fontes (0–30 pts)',
    summary:
      'Mede quantas fontes responderam sem falhas e quão recente é o dado em relação à última sincronização.',
    details: [
      'Dados ao vivo ou com menos de 30 min recebem pontuação máxima; cache antigo perde pontos gradualmente.',
      'Em pontos continentais sem grade marinha, os pesos são redistribuídos automaticamente sem penalidade.',
    ],
    operationalTip:
      'Quando estiver offline por muitas horas, verifique o timestamp da última atualização no topo.',
  },
  confidence_proximity: {
    title: 'Sub-índice: Horizonte Temporal / Proximidade (0–20 pts)',
    summary:
      'Reflete o decaimento físico da previsibilidade atmosférica conforme o prazo avança de 0h até 168h.',
    details: [
      '0h a 24h: Máxima previsibilidade (até 20 pts).',
      '24h a 72h: Decaimento moderado por crescimento de instabilidades de mesoescala.',
      '72h a 168h: Incerteza sinótica crescente; use como planejamento tendencial.',
    ],
    operationalTip:
      'Revalide janelas operacionais marcadas além de 72h com 24h de antecedência.',
  },
  confidence_vertical: {
    title: 'Sub-índice: Coerência Vertical & Cisalhamento',
    summary:
      'Verifica se o perfil vertical de vento (10m a 120m) segue comportamento físico estável pela Lei de Hellmann.',
    details: [
      'Expoente α entre 0.05 e 0.40 indica camada limite bem comportada (zero penalidade).',
      'Valores fora dessa faixa com interpolação ativa aplicam desconto de confiabilidade e alerta de cisalhamento.',
    ],
    operationalTip:
      'Para voos de VANTs ou içamentos, inspecione diretamente as camadas 80m, 100m e 120m.',
  },
  model_dispersion: {
    title: 'Dispersão Multi-Modelo (Spread & Envelope Mín–Máx)',
    summary:
      'Mostra a amplitude entre o modelo mais conservador e o mais extremo em cada hora da previsão.',
    details: [
      'Banda Estreita: Modelos convergem para o mesmo cenário físico.',
      'Banda Larga: Indica sensibilidade a frentes, cavados ou convecção local onde pequenos desvios alteram o resultado.',
    ],
    operationalTip:
      'Em operações críticas, planeje contingência considerando o limite superior (P90 / máximo) da dispersão.',
  },
  report_studio_overview: {
    title: 'Estúdio de Relatórios Técnico-Científicos',
    summary:
      'Compila estatísticas descritivas, balanço hídrico, metodologia e referências em formatos auditáveis (PDF, DOCX, HTML, MD, CSV, JSON).',
    details: [
      'Funciona 100% localmente no dispositivo sem envio de dados para servidores externos.',
      'Suporta séries de previsão NWP (168h), reanálise histórica ERA5 e projeções estendidas de 16 dias.',
    ],
    operationalTip:
      'Exporte em PDF para envio rápido em campo ou em DOCX/Markdown para edição em laudos e artigos.',
  },
  report_water_balance: {
    title: 'Balanço Hídrico Agroclimático (P − ET0 FAO-56)',
    summary:
      'Avalia o saldo entre a chuva acumulada (P) e a demanda evaporativa atmosférica de referência (ET0).',
    details: [
      'Superávit (> +10 mm): Excesso hídrico disponível no sistema solo-planta.',
      'Equilíbrio (-10 a +10 mm): Balanço próximo da neutralidade.',
      'Déficit Moderado (-30 a -10 mm) ou Severo (< -30 mm): Perda líquida de umidade, elevando risco de estresse hídrico e inflamabilidade.',
    ],
    operationalTip:
      'Útil para planejar janelas de pulverização, manejo de solo, irrigação e risco de incêndio florestal.',
  },
  report_gdd: {
    title: 'Graus-Dia de Crescimento (GDD Base 10 °C)',
    summary:
      'Mede o acúmulo térmico diário acima da temperatura basal de 10 °C, utilizado em fenologia agrícola e entomologia.',
    details: [
      'Calculado por dia como max(0, T_média_diária − 10 °C) e somado ao longo de todo o período analisado.',
      'Permite estimar ritmo de desenvolvimento vegetal, maturação de culturas e atividade biológica.',
    ],
    operationalTip:
      'Compare o GDD acumulado entre safras usando a fonte Histórica ERA5.',
  },
  report_vector_r: {
    title: 'Coerência Direcional Vetorial (R ∈ [0, 1])',
    summary:
      'Mede o quanto a direção do vento permaneceu constante ao longo do período analisado via média circular unitária.',
    details: [
      'R próximo de 1.00: Vento soprou persistentemente de um único quadrante (regime sinótico estável).',
      'R abaixo de 0.45: Alta variabilidade direcional, brisas alternadas ou passagem de sistemas frontais.',
    ],
    operationalTip:
      'Combine o rumo vetorial dominante com o valor de R para evitar interpretações enganosas de médias simples em graus.',
  },
  report_zscore_ols: {
    title: 'Anomalia Padronizada (|Z| máx) e Tendência Linear (OLS)',
    summary:
      'Identifica episódios extremos fora do padrão da série e a taxa média de variação diária.',
    details: [
      '|Z| máx = max(|x − μ| / σ): Valores acima de 2.5 sinalizam picos atípicos dentro da janela analisada.',
      'Tendência OLS (por 24h): Inclinação da reta de Mínimos Quadrados Ordinários, indicando aquecimento, queda de pressão ou ganho de vento ao longo do período.',
    ],
    operationalTip:
      'Uma tendência barométrica negativa forte combinada com |Z| elevado em rajadas sugere episódio frontal marcante.',
  },
  report_era5_hybrid: {
    title: 'Série Histórica ERA5 & Fusão Híbrida',
    summary:
      'Combina reanálise climática ECMWF ERA5 (histórico consolidado) com dados recentes sem lacunas temporais.',
    details: [
      'ERA5 oferece grade global contínua para auditorias retroativas, perícia meteorológica e climatologia local.',
      'O motor híbrido preenche os últimos dias de latência da reanálise mantendo continuidade horária.',
    ],
    operationalTip:
      'Use o recorte histórico para validar ocorrências passadas ou calibrar limites operacionais da equipe.',
  },
  report_16d_projection: {
    title: 'Projeção Estendida de 16 Dias',
    summary:
      'Estende a visão de planejamento operacional além das 168h padrão para antecipar tendências sinóticas de médio prazo.',
    details: [
      'Entre os dias 8 e 16, a precisão determinística horária cai naturalmente; foque em regimes térmicos, acumulados de chuva e janelas amplas.',
    ],
    operationalTip:
      'Ideal para logística de expedições e cronogramas agrícolas, sempre revalidando na previsão de 168h próxima à data.',
  },
  summary_overview: {
    title: 'Resumo Diário & Períodos do Dia',
    summary:
      'Apresenta as condições da hora local ativa, o semáforo de janela segura e a síntese por Madrugada, Manhã, Tarde e Noite.',
    details: [
      'A seleção do horário acompanha automaticamente o fuso da coordenada escolhida.',
      'Você pode fixar a coordenada atual como Área Principal para abertura imediata em campo.',
    ],
    operationalTip:
      'Toque em "Voltar para Agora" sempre que quiser retornar do modo de inspeção futura para a hora atual.',
  },
  alerts_builder_help: {
    title: 'Construtor de Alertas & Janelas Horárias',
    summary:
      'Permite criar regras personalizadas com condições combinadas, janela de horário ativo e templates prontos de missão.',
    details: [
      'Defina tetos opcionais para temperatura, chuva, vento, rajadas, nebulosidade, ondas ou índice geomagnético Kp.',
      'Limite os alertas para disparar apenas dentro da sua janela operacional (ex.: 06:00 às 18:00).',
    ],
    operationalTip:
      'Comece aplicando um Template (Voo de Drone, Navegação Costeira ou Campo Agrícola) e ajuste apenas os campos necessários.',
  },
};

export const HELP_TOPICS_EN: Record<HelpTopicId, HelpTopicDefinition> = {
  confidence: {
    title: 'Confidence Index (0 to 100)',
    summary:
      'Measures forecast certainty by combining agreement across 4 global models (ECMWF, GFS, ICON & GEM), data-source health, and forecast lead time.',
    details: [
      'Model Agreement (up to 50 pts): Compares all 4 global models (ECMWF, GFS, ICON & GEM). Lower wind/rain spread and higher circular directional coherence (R → 1) raise the score.',
      'Source Integrity & Freshness (up to 30 pts): Checks whether APIs responded live or cache age is under 30 min. On inland coordinates (no marine grid), weights redistribute automatically with zero penalty.',
      'Time Horizon (up to 20 pts): Full score in the first 24h, decaying gradually through 72h and faster beyond 72h.',
      'Shear Penalty: Applies a deduction when vertical interpolation is active under atypical wind shear (α outside 0.05–0.40).',
    ],
    operationalTip:
      'Green (80–100): Strong model convergence. Amber (50–79): Moderate divergence; inspect min/max envelopes. Red (0–49): High uncertainty; add operational safety margins.',
  },
  ensemble_vs_native: {
    title: 'FieldCast Model (Ensemble) vs. Native Models',
    summary:
      'Switches between statistical multi-model fusion (Ensemble) and individual global NWP centers.',
    details: [
      'FieldCast Model (Ensemble): Computes hourly mean, min, max, and standard deviation for scalar variables, and circular vector decomposition (u, v) for wind and current directions.',
      'ECMWF IFS 0.25°: European high-accuracy synoptic model (native wind at 10m and 100m).',
      'NOAA GFS Seamless: US global model with strong visibility coverage and native wind at 10m, 80m, and 120m.',
      'DWD ICON Seamless: German icosahedral-grid model (native wind at 10m, 80m, and 120m).',
      'CMC GEM Seamless: Canadian global model (15 km) expanding synoptic diversity.',
      'Spaghetti Mode: Overlays all 4 global models (ECMWF, GFS, ICON & GEM) on the same chart so divergences jump out immediately.',
    ],
    operationalTip:
      'Use FieldCast Ensemble for baseline decisions and enable Spaghetti mode to inspect which model drives extreme scenarios.',
  },
  vertical_profile: {
    title: 'Vertical Wind Profile (0–120m) & Wind Shear (α)',
    summary:
      'Shows how wind speed changes from surface (10m) up to 120m AGL (essential for drones, towers, cranes, and sailing).',
    details: [
      'Native Levels: Raw model outputs at 10m, 80m, 100m, and 120m.',
      'Estimated Interpolation (every 10m): Uses Hellmann Power Law v(z) = v_ref · (z / z_ref)^α when enabled in FieldCast Ensemble.',
      'Shear Double-Check: Flags atypical boundary-layer shear when α < 0.05 or α > 0.40.',
      'Gusts: Strictly reported at 10m surface level, never extrapolated upward.',
    ],
    operationalTip:
      'Interpolated heights carry an "Estimated" tag. For critical altitude work, prioritize native 80m, 100m, and 120m levels.',
  },
  barometric_trend: {
    title: 'Barometric Trend (ΔP / 3h)',
    summary:
      'Tracks rapid surface pressure drops to warn early about approaching cold fronts and convective squall lines.',
    details: [
      'Trigger: A drop exceeding 4 hPa over 3 hours (ΔP / 3h < -4 hPa) activates an immediate alert.',
      'Physics: Steep pressure falls signal rapid trough, front, or squall arrival with sudden gust fronts.',
    ],
    operationalTip:
      'When active, secure sensitive gear early even if surface wind still feels calm.',
  },
  safe_window: {
    title: 'Safe Window Traffic Light (Configurable)',
    summary:
      'Classifies each hour of the next 168h as Green, Amber, or Red against your operational limits.',
    details: [
      'Green (Safe Window): Wind, gusts, waves, and rain probability remain well below configured limits.',
      'Amber (Caution): At least one parameter reached 80%+ of its threshold or moderate hazard is present.',
      'Red (Out of Limits): One or more parameters exceeded your operational ceiling.',
    ],
    operationalTip:
      'Adjust wind, gust, wave, and rain limits in Settings to match your aircraft, vessel, or crew.',
  },
  fog_risk: {
    title: 'Fog & Low Visibility Alert',
    summary:
      'Combines horizontal visibility with temperature–dew-point proximity (Dew Point Spread).',
    details: [
      'Cross-Trigger: Fires when visibility < 1000m AND Dew Point Spread (T2m − Td2m) < 2 °C.',
      'Near-zero spread indicates air near saturation, promoting dense radiation or coastal fog.',
    ],
    operationalTip:
      'Critical for VFR operations, UAV/drone line-of-sight, and mountain or coastal transit.',
  },
  stratified_clouds: {
    title: 'Stratified Cloud Cover (Low, Mid & High)',
    summary:
      'Splits cloudiness into three atmospheric layers to evaluate visual ceiling, solar irradiance, and rain potential.',
    details: [
      'Low Clouds (0–2 km): Stratus, Cumulus, Stratocumulus — directly impact visual ceiling and drizzle.',
      'Mid Clouds (2–6 km): Altostratus/Altocumulus — signal synoptic transitions.',
      'High Clouds (> 6 km): Cirrus/Cirrostratus — thin ice crystals; rarely block visual ops.',
    ],
    operationalTip:
      '90% high clouds still leave good surface light and visibility, whereas 90% low clouds indicate a low ceiling.',
  },
  waves_swell: {
    title: 'Significant Waves, Swell & Ocean Currents',
    summary:
      'Open-Meteo Marine grid data for coastal and offshore coordinates.',
    details: [
      'Significant Wave Height (m): Mean of the highest third of waves combining wind sea and swell.',
      'Swell: Long-period waves generated by distant storms carrying higher coastal energy.',
      'Est. Sea Level (MSL ~8 km): Hydrodynamic estimate only; does NOT replace official port/navy tide tables.',
      'Continental Detection: Inland locations skip marine penalties automatically.',
    ],
    operationalTip:
      'Watch out when local wind opposes swell or current direction — this creates short, steep, breaking seas.',
  },
  ephemeris: {
    title: 'Solar & Lunar Ephemeris (100% Offline)',
    summary:
      'Computed locally on-device using SunCalc astronomical formulas for the active coordinate and timezone.',
    details: [
      'Civil Twilight: Sun up to 6° below horizon — enough natural daylight for outdoor work.',
      'Nautical Twilight: Sun 6°–12° below horizon — sea horizon still distinguishable.',
      'Lunar Phase & Illumination: Crucial for night operations and spring/neap tidal ranges.',
    ],
    operationalTip:
      'Plan field pack-up before Civil Dusk ends to avoid working in full darkness.',
  },
  confidence_agreement: {
    title: 'Sub-score: Model Agreement (0–50 pts)',
    summary:
      'Measures consensus across ECMWF, GFS, ICON, and GEM for wind, precipitation, and vector direction.',
    details: [
      'Scalar Spread: Lower standard deviation across models yields higher points.',
      'Directional Coherence (R): Rewards aligned wind vectors across all participating models.',
    ],
    operationalTip:
      'Scores below 25/50 indicate strong synoptic divergence — open Spaghetti mode in the Models tab.',
  },
  confidence_integrity: {
    title: 'Sub-score: Source Integrity & Freshness (0–30 pts)',
    summary:
      'Tracks API availability and cache age relative to the last live synchronization.',
    details: [
      'Live responses or cache < 30 min earn full points; older offline caches decay gradually.',
      'Inland points redistribute marine weight automatically with zero penalty.',
    ],
    operationalTip:
      'When working offline for extended periods, check the last-sync timestamp in the header.',
  },
  confidence_proximity: {
    title: 'Sub-score: Time Horizon / Proximity (0–20 pts)',
    summary:
      'Captures natural atmospheric predictability decay from 0h out to 168h.',
    details: [
      '0h–24h: Highest predictability (up to 20 pts).',
      '24h–72h: Moderate decay from mesoscale error growth.',
      '72h–168h: Increasing synoptic uncertainty; use for trend planning.',
    ],
    operationalTip:
      'Re-verify operational windows booked beyond 72h at least 24h prior.',
  },
  confidence_vertical: {
    title: 'Sub-score: Vertical Profile Coherence & Shear',
    summary:
      'Checks whether the 10m–120m wind profile obeys physically stable Hellmann Power Law behavior.',
    details: [
      'Exponent α between 0.05 and 0.40 indicates normal boundary-layer shear (no penalty).',
      'Values outside that range during active interpolation deduct confidence points and trigger a shear warning.',
    ],
    operationalTip:
      'For UAVs or crane lifts, inspect native 80m, 100m, and 120m layers directly.',
  },
  model_dispersion: {
    title: 'Inter-Model Dispersion (Spread & Min–Max Envelope)',
    summary:
      'Displays the range between the mildest and strongest model solution at each forecast hour.',
    details: [
      'Narrow Envelope: Models agree tightly on the atmospheric evolution.',
      'Wide Envelope: Signals frontal timing or convective sensitivity.',
    ],
    operationalTip:
      'Plan safety contingencies against the upper envelope (P90 / max) during critical ops.',
  },
  report_studio_overview: {
    title: 'Technical Reports Studio',
    summary:
      'Builds auditable statistics, water balance, methodology, and citations locally in PDF, DOCX, HTML, MD, CSV, and JSON.',
    details: [
      'Runs 100% client-side with zero external server uploads.',
      'Supports 168h NWP forecasts, ERA5 historical series, and 16-day extended projections.',
    ],
    operationalTip:
      'Export PDF for fast field sharing or DOCX/Markdown for formal reports and manuscripts.',
  },
  report_water_balance: {
    title: 'Agro-Climatic Water Balance (P − ET0 FAO-56)',
    summary:
      'Evaluates net water balance between accumulated precipitation (P) and reference evapotranspiration (ET0).',
    details: [
      'Surplus (> +10 mm): Positive water availability.',
      'Balanced (-10 to +10 mm): Near-neutral moisture balance.',
      'Moderate/Severe Deficit (< -10 / -30 mm): Net moisture loss raising drought and fire-weather stress.',
    ],
    operationalTip:
      'Use for spray windows, irrigation scheduling, soil trafficability, and wildfire risk checks.',
  },
  report_gdd: {
    title: 'Growing Degree Days (GDD Base 10 °C)',
    summary:
      'Accumulates daily mean thermal energy above 10 °C for crop phenology and ecological tracking.',
    details: [
      'Computed daily as max(0, T_mean_daily − 10 °C) and summed across the analysis window.',
      'Helps estimate crop growth stages and biological activity rates.',
    ],
    operationalTip:
      'Compare seasonal GDD totals using the ERA5 Historical dataset.',
  },
  report_vector_r: {
    title: 'Circular Directional Coherence (R ∈ [0, 1])',
    summary:
      'Measures directional persistence using unit-vector circular statistics.',
    details: [
      'R near 1.00: Highly persistent wind direction from a single quadrant.',
      'R below 0.45: Shifting breezes or frontal passages with high directional variability.',
    ],
    operationalTip:
      'Always read dominant wind azimuth together with R to avoid misleading degree averages.',
  },
  report_zscore_ols: {
    title: 'Standardized Anomaly (|Z| max) & Linear Trend (OLS)',
    summary:
      'Highlights extreme episodic spikes and average 24h linear drift across the analyzed window.',
    details: [
      '|Z| max = max(|x − μ| / σ): Values above 2.5 signal notable outlier episodes.',
      'OLS Trend (per 24h): Ordinary Least Squares slope showing warming, pressure falls, or wind ramps.',
    ],
    operationalTip:
      'A steep negative pressure slope paired with high gust |Z| max indicates a strong frontal passage.',
  },
  report_era5_hybrid: {
    title: 'ERA5 Historical Series & Hybrid Fusion',
    summary:
      'Blends ECMWF ERA5 reanalysis archives with recent observations to eliminate recent-day gaps.',
    details: [
      'ERA5 provides consistent global gridded reanalysis for retrospective audits and climatology.',
      'Hybrid fusion bridges recent reanalysis latency with hourly continuity.',
    ],
    operationalTip:
      'Use historical mode to audit past field events or calibrate team thresholds.',
  },
  report_16d_projection: {
    title: 'Extended 16-Day Projection',
    summary:
      'Extends operational planning beyond the standard 168h window to spot medium-range synoptic shifts.',
    details: [
      'Between days 8 and 16, deterministic hour-by-hour skill drops; focus on thermal regimes, rain totals, and broad windows.',
    ],
    operationalTip:
      'Great for expedition logistics and agricultural scheduling; always confirm against the 168h forecast closer to execution.',
  },
  summary_overview: {
    title: 'Daily Summary & Day Periods',
    summary:
      'Displays current local-hour conditions, Safe Window status, and breakdowns for Dawn, Morning, Afternoon, and Night.',
    details: [
      'Time selection automatically follows the active coordinate timezone.',
      'Pin your current coordinate as Primary Area for instant field startup.',
    ],
    operationalTip:
      'Tap "Back to Now" anytime to jump back from future inspection to the current local hour.',
  },
  alerts_builder_help: {
    title: 'Custom Alert Builder & Active Windows',
    summary:
      'Create multi-condition alert rules with active local-hour schedules and ready-to-use mission templates.',
    details: [
      'Combine optional thresholds for temperature, rain, wind, gusts, clouds, waves, or NOAA Kp index.',
      'Restrict alerts to your operational work window (e.g. 06:00–18:00).',
    ],
    operationalTip:
      'Start from a preset Template (Drone Flight, Coastal Navigation, or Field Agronomy) and fine-tune only what you need.',
  },
};

export interface HelpPopoverProps {
  topic?: HelpTopicId;
  title?: string;
  summary?: string;
  details?: string[];
  operationalTip?: string;
  label?: string;
  align?: 'left' | 'right';
  className?: string;
}

export const HelpPopover: React.FC<HelpPopoverProps> = ({
  topic,
  title,
  summary,
  details,
  operationalTip,
  label,
  align = 'right',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const { locale, tr } = useLocale();

  const topicDictionary = locale === 'en' ? HELP_TOPICS_EN : HELP_TOPICS;
  const preset = topic ? topicDictionary[topic] : undefined;
  const resolvedTitle = title ?? preset?.title ?? tr('Ajuda Contextual', 'Contextual Help');
  const resolvedSummary =
    summary ??
    preset?.summary ??
    tr(
      'Explicação operacional simplificada deste indicador.',
      'Simplified operational explanation for this indicator.',
    );
  const resolvedDetails = details ?? preset?.details ?? [];
  const resolvedTip = operationalTip ?? preset?.operationalTip;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-label={label ?? tr(`Ajuda sobre ${resolvedTitle}`, `Help about ${resolvedTitle}`)}
        title={`${tr('Ajuda', 'Help')}: ${resolvedTitle}`}
        className="min-h-[38px] min-w-[38px] p-1.5 rounded-xl inline-flex items-center justify-center text-slate-500 hover:text-[#0080cd] dark:text-sky-300/75 dark:hover:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <HelpCircle className="w-4 h-4" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={resolvedTitle}
          onClick={(e) => e.stopPropagation()}
          className={`fixed inset-x-4 top-24 sm:inset-auto sm:absolute z-50 sm:top-full sm:mt-1.5 w-auto sm:w-96 max-w-[calc(100vw-2rem)] rounded-2xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#132a47] text-slate-800 dark:text-sky-50 shadow-2xl p-4 space-y-3 text-left ${
            align === 'left' ? 'sm:left-0' : 'sm:right-0'
          }`}
        >
          <div className="flex items-start justify-between gap-2 border-b border-sky-100 dark:border-sky-800 pb-2.5">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-[#0080cd] dark:text-sky-400 shrink-0" />
              <h4 className="text-sm font-bold leading-snug">{resolvedTitle}</h4>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label={tr('Fechar ajuda', 'Close help')}
              className="min-h-[44px] min-w-[44px] -m-2 rounded-xl inline-flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <p className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
            {resolvedSummary}
          </p>

          {resolvedDetails.length > 0 && (
            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4 leading-relaxed">
              {resolvedDetails.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          )}

          {resolvedTip && (
            <div className="rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/70 p-2.5 flex items-start gap-2 text-xs text-sky-950 dark:text-sky-200">
              <Lightbulb className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                <strong>{tr('Dica de Campo:', 'Field Tip:')}</strong> {resolvedTip}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
