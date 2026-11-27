import type { ActiveCoordinates } from './field';
import type { ErrorLogRecord, ToastMessage } from './health';
import type {
  NormalizedForecast,
  SafeWindowStatus,
  ScalarStat,
  WeatherModelId,
} from './weather';

/**
 * Identificadores canônicos das abas na arquitetura modular V4:
 * - `forecast`: Resumo Diário Simplificado (Usuário do Dia a Dia)
 * - `comparison`: Comparação Multi-Modelo & Gráficos Sob Demanda (estilo Windguru/Windy)
 * - `navigation`: Navegação Costeira, Marés MSL, Ondas, Correntes & Bússola
 * - `aeronautics`: Aeronáutica, Drone, Wind Shear, CAPE & NOAA Kp
 * - `planner`: Planejamento de Rotas 4D (Náutico & Aéreo/VANT)
 * - `map`: Mapa Interativo, Pin Lock, Tela Cheia, Radar & Cache Offline
 * - `field`: Dados, Rotas GPS, Waypoints, Séries ERA5 & Relatórios Técnicos (Sub-vistas)
 * - `settings`: Central de Configurações, Notificações, Janelas Horárias & Templates
 */
export type V4AppTabId =
  | 'forecast'
  | 'comparison'
  | 'navigation'
  | 'aeronautics'
  | 'planner'
  | 'map'
  | 'field'
  | 'settings';

export interface RoutePlanningTabProps {
  activeLocation: ActiveCoordinates;
  forecast?: NormalizedForecast | null;
  isDark?: boolean;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

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

export type DailyFieldThresholdKey =
  | 'idealMinTempC'
  | 'idealMaxTempC'
  | 'maxWindKmh'
  | 'maxGustKmh'
  | 'maxPrecipProbPct'
  | 'maxCapeJkg';

export type CoastalNavThresholdKey =
  | 'maxWindKmh'
  | 'maxGustKmh'
  | 'maxWaveM'
  | 'maxCurrentKmh'
  | 'minVisibilityKm';

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
  enabledDailyField?: Partial<Record<DailyFieldThresholdKey, boolean>>;
  enabledCoastalNavigation?: Partial<Record<CoastalNavThresholdKey, boolean>>;
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
  minTideMslM?: number | null;
  maxTideMslM?: number | null;
}

export interface NotificationRecurrenceConfig {
  mode: 'once' | 'times_per_window' | 'interval_hours';
  maxTriggersPerWindow: number;
  intervalHours?: number;
}

export interface CustomNotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: CustomNotificationConditions;
  timeWindow: NotificationTimeWindow;
  recurrence?: NotificationRecurrenceConfig;
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

export interface ExtremeAlertsRecurrenceConfig {
  enabled: boolean;
  minPerDay: number;
  urgentIntervalMinutes: number;
}

export interface UserNotificationPreferences {
  masterEnabled: boolean;
  extremeEventsAutoEnabled: boolean;
  extremeAlertsRecurrence?: ExtremeAlertsRecurrenceConfig;
  backgroundSyncEnabled?: boolean;
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
  mad?: number | null;
  robustZScoreMax?: number | null;
  theilSenTrendPerDay?: number | null;
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

export type GroundTruthRainClass = 'none' | 'light' | 'moderate' | 'heavy';

export type GroundTruthWindFeel = 'calm' | 'light' | 'moderate' | 'strong' | 'gale';

export interface GroundTruthModelPrediction {
  windSpeed10mKmh: number | null;
  windGusts10mKmh?: number | null;
  temperature2mC: number | null;
  precipitationMm: number | null;
  precipitationProbPct?: number | null;
}

export interface GroundTruthObservation {
  id: string;
  timestampUtcIso: string;
  timestampUnix: number;
  latitude: number;
  longitude: number;
  locationKey: string;
  regionKey: string;
  locationName: string;
  rainClass: GroundTruthRainClass;
  windFeel: GroundTruthWindFeel;
  measuredWindKmh?: number | null;
  measuredTempC?: number | null;
  measuredWaveM?: number | null;
  note?: string;
  photoDataUrl?: string;
  photoMimeType?: 'image/webp' | 'image/jpeg';
  photoSizeKb?: number;
  modelPredictions: Partial<Record<WeatherModelId, GroundTruthModelPrediction>>;
  ensembleWindKmh?: number | null;
  ensembleTempC?: number | null;
  ensemblePrecipMm?: number | null;
  ensemblePrecipProbPct?: number | null;
  sourceDeviceLabel?: string;
}

export interface ModelSkillMetrics {
  model: WeatherModelId;
  sampleCount: number;
  windMaeKmh: number | null;
  windBiasKmh: number | null;
  tempMaeC: number | null;
  tempBiasC: number | null;
  rainBrierScore: number | null;
  compositeSkillScore: number;
  weight: number;
}

export interface RegionalCalibrationResult {
  latitude: number;
  longitude: number;
  radiusKm: number;
  sampleCount: number;
  minRequiredSamples: number;
  calibrationEligible: boolean;
  shrinkageFactor: number;
  weightsByModel: Record<WeatherModelId, number>;
  metricsByModel: Record<WeatherModelId, ModelSkillMetrics>;
  bestModel: WeatherModelId | null;
  computedAtIso: string;
}

export interface GroundTruthExportPackage {
  schemaVersion: 'fieldcast-gt-v1';
  exportedAtIso: string;
  sourceLabel?: string;
  observationCount: number;
  observations: GroundTruthObservation[];
}
