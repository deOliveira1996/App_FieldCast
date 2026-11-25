import type { SafeWindowStatus, ScalarStat, WeatherModelId } from './weather';

/**
 * Identificadores canônicos das abas na arquitetura modular V4:
 * - `forecast`: Resumo Diário Simplificado (Usuário do Dia a Dia)
 * - `comparison`: Comparação Multi-Modelo & Gráficos Sob Demanda (estilo Windguru/Windy)
 * - `navigation`: Navegação Costeira, Marés MSL, Ondas, Correntes & Bússola
 * - `aeronautics`: Aeronáutica, Drone, Wind Shear, CAPE & NOAA Kp
 * - `map`: Mapa Interativo, Pin Lock, Tela Cheia, Radar & Cache Offline
 * - `field`: Dados, Rotas GPS, Waypoints, Séries ERA5 & Relatórios Técnicos (Sub-vistas)
 * - `settings`: Central de Configurações, Notificações, Janelas Horárias & Templates
 */
export type V4AppTabId =
  | 'forecast'
  | 'comparison'
  | 'navigation'
  | 'aeronautics'
  | 'map'
  | 'field'
  | 'settings';

/**
 * Sub-vistas interativas dentro de `Dados & Relatórios` (`FieldDataTab`),
 * eliminando o scroll monolítico e entregando área útil dedicada por operação.
 */
export type FieldSubViewId =
  | 'overview'
  | 'tracker'
  | 'waypoints'
  | 'history'
  | 'reports';

export type ThunderstormRiskLevel = 'none' | 'moderate' | 'high';

export interface ConvectiveAndSurfaceExtras {
  relativeHumidity2mPct: ScalarStat;
  apparentTemperatureC: ScalarStat;
  capeJkg: ScalarStat;
  weatherCodeDominant: number | null;
  thunderstormRisk: ThunderstormRiskLevel;
  windShearKtPer100ft: number | null;
}

export type ExtremeEventCategory =
  | 'thunderstorm'
  | 'extreme_wind'
  | 'heavy_rain'
  | 'pressure_squall'
  | 'coastal_swell'
  | 'geomagnetic_storm'
  | 'thermal_extreme';

export type ExtremeEventSeverity = 'moderate' | 'severe' | 'extreme';

/**
 * Span global de Alerta de Evento Extremo exibido na tela inicial (independente dos limites customizados),
 * sempre acompanhado da fonte primária documentada e opção expansível "Mais Detalhes".
 */
export interface GlobalExtremeEventAlert {
  id: string;
  category: ExtremeEventCategory;
  severity: ExtremeEventSeverity;
  title: string;
  summary: string;
  potentialDamages: string;
  recommendedAction: string;
  metricBadge: string;
  peakTimestampUnix: number;
  windowStartUnix: number;
  windowEndUnix: number;
  sourceName: string;
  sourceUrl: string;
  methodologyNote: string;
}

export type ActivityDomainId = 'daily_field' | 'coastal_navigation' | 'aeronautics_drone';

export interface ActivityQualityThresholds {
  dailyField: {
    idealMinTempC: number;
    idealMaxTempC: number;
    maxWindKmh: number;
    maxGustKmh: number;
    maxPrecipProbPct: number;
    maxCapeJkg: number;
  };
  coastalNavigation: {
    maxWindKmh: number;
    maxGustKmh: number;
    maxWaveM: number;
    maxCurrentKmh: number;
    minVisibilityKm: number;
  };
}

export interface ActivityQualityAssessment {
  domain: ActivityDomainId;
  score: number;
  status: SafeWindowStatus;
  label: string;
  summary: string;
  factors: string[];
}

export interface NotificationTimeWindow {
  /** Hora inicial no formato local `HH:MM` (ex.: `"06:00"`). */
  startHHMM: string;
  /** Hora final no formato local `HH:MM` (ex.: `"20:00"`). */
  endHHMM: string;
  /** Horário opcional a partir do qual enviar resumo/alerta (`"07:00"`). */
  notifyFromHHMM?: string | null;
}

export interface CustomNotificationConditions {
  minTempC?: number | null;
  maxTempC?: number | null;
  minPrecipProbPct?: number | null;
  maxWindKmh?: number | null;
  maxGustKmh?: number | null;
  maxCloudCoverPct?: number | null;
  maxWaveM?: number | null;
  maxKpIndex?: number | null;
}

export interface CustomNotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: CustomNotificationConditions;
  timeWindow: NotificationTimeWindow;
  customTitle: string;
  customMessage: string;
  createdAtIso: string;
  lastTriggeredIso?: string | null;
}

export interface NotificationRuleTemplate {
  templateId: string;
  name: string;
  description: string;
  categoryLabel: string;
  suggestedConditions: CustomNotificationConditions;
  suggestedTimeWindow: NotificationTimeWindow;
  suggestedTitle: string;
  suggestedMessage: string;
}

export interface UserNotificationPreferences {
  masterEnabled: boolean;
  extremeEventsAutoEnabled: boolean;
  globalActiveWindow: {
    enabled: boolean;
    startHHMM: string;
    endHHMM: string;
  };
  rules: CustomNotificationRule[];
  updatedAtIso: string;
}

export interface DescriptiveMetricStats {
  variableKey: string;
  label: string;
  unit: string;
  sampleCount: number;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
  p10: number | null;
  p90: number | null;
  iqr: number | null;
  linearTrendPerDay: number | null;
  anomalyZScoreMax: number | null;
}

export interface AgroClimaticWaterBalance {
  totalPrecipitationMm: number;
  totalEt0FaoMm: number;
  netWaterBalanceMm: number;
  waterStressClassification: 'surplus' | 'balanced' | 'moderate_deficit' | 'severe_deficit';
  growingDegreeDaysBase10C: number;
  meanRelativeHumidityPct: number | null;
  maxHeatIndexC: number | null;
}

export interface AcademicSourceCitation {
  id: string;
  provider: string;
  datasetName: string;
  spatialResolution: string;
  temporalResolution: string;
  url: string;
  formalCitation: string;
}

export interface ScientificAnalysisSummary {
  generatedAtIso: string;
  datasetKind: 'forecast_168h' | 'historical_era5';
  locationName: string;
  latitude: number;
  longitude: number;
  elevationDemM: number;
  timezone: string;
  periodStartIso: string;
  periodEndIso: string;
  activeModelLabel: string;
  modelsCompared: Array<'fieldcast' | WeatherModelId | 'marine'>;
  metrics: DescriptiveMetricStats[];
  dominantWindDirectionDeg: number | null;
  windDirectionalConsistencyR: number | null;
  waterBalance: AgroClimaticWaterBalance;
  citations: AcademicSourceCitation[];
}

export interface TechnicalReportDocument {
  reportId: string;
  title: string;
  subtitle: string;
  generatedAtIso: string;
  analysis: ScientificAnalysisSummary;
  executiveSummary: string;
  methodologySection: string;
  resultsInterpretation: string;
  parcimonicDiscussion: string;
  limitationsAndDisclaimers: string[];
}
