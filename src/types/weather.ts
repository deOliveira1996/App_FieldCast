export const WEATHER_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'] as const;

export type WeatherModelId = (typeof WEATHER_MODELS)[number];

export type ForecastViewMode = 'fieldcast' | WeatherModelId | 'spaghetti';

export type SafeWindowStatus = 'green' | 'amber' | 'red';

export type ConfidenceBadgeColor = 'green' | 'amber' | 'red';

export interface ScalarStat {
  mean: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  sampleCount: number;
  valuesByModel?: Partial<Record<WeatherModelId, number | null>>;
}

export interface CircularStat {
  degree: number | null;
  uMean: number | null;
  vMean: number | null;
  resultantLengthR: number | null;
  sampleCount: number;
  valuesByModel?: Partial<Record<WeatherModelId, number | null>>;
}

export interface VerticalWindLevel {
  heightM: number;
  speedKmh: number | null;
  directionDeg: number | null;
  isInterpolated: boolean;
  label?: string;
}

export interface VerticalWindProfile {
  nativeLevels: VerticalWindLevel[];
  interpolatedLevels: VerticalWindLevel[];
  alpha: number | null;
  atypicalShearWarning: boolean;
  shearWarningMessage: string | null;
}

export interface NativeModelHour {
  timestampUnix: number;
  timestampIso: string;
  model: WeatherModelId;
  windSpeed10m: number | null;
  windSpeed80m: number | null;
  windSpeed100m: number | null;
  windSpeed120m: number | null;
  windDirection10m: number | null;
  windDirection80m: number | null;
  windDirection100m: number | null;
  windDirection120m: number | null;
  windGusts10m: number | null;
  precipitation: number | null;
  precipitationProbability: number | null;
  temperature2m: number | null;
  dewPoint2m: number | null;
  visibility: number | null;
  surfacePressure: number | null;
  cloudCoverLow: number | null;
  cloudCoverMid: number | null;
  cloudCoverHigh: number | null;
}

export interface MarineHour {
  timestampUnix: number;
  timestampIso: string;
  waveHeight: number | null;
  wavePeriod: number | null;
  waveDirection: number | null;
  swellWaveHeight: number | null;
  swellWavePeriod: number | null;
  swellWaveDirection: number | null;
  oceanCurrentVelocity: number | null;
  oceanCurrentDirection: number | null;
}

export interface ConfidenceBreakdown {
  modelAgreement: number;
  sourceIntegrity: number;
  timeHorizon: number;
  shearPenalty: number;
}

export interface ConfidenceScore {
  total: number;
  badge: ConfidenceBadgeColor;
  breakdown: ConfidenceBreakdown;
  isContinental: boolean;
  reasons: string[];
}

export interface SafeWindowThresholds {
  maxWindKmh: number;
  maxGustKmh: number;
  maxWaveM: number;
  maxPrecipProbPct: number;
}

export const DEFAULT_SAFE_WINDOW_THRESHOLDS: SafeWindowThresholds = {
  maxWindKmh: 30,
  maxGustKmh: 45,
  maxWaveM: 2.0,
  maxPrecipProbPct: 60,
};

export type OperationalAlertType =
  | 'pressure_drop'
  | 'fog_risk'
  | 'atypical_shear'
  | 'safe_window_red';

export type OperationalAlertSeverity = 'info' | 'warning' | 'critical';

export interface OperationalAlert {
  id: string;
  type: OperationalAlertType;
  severity: OperationalAlertSeverity;
  title: string;
  description: string;
  timestampUnix: number;
  timestampIso: string;
  value?: number | null;
  unit?: string;
}

export interface StratifiedCloudCover {
  lowPct: ScalarStat;
  midPct: ScalarStat;
  highPct: ScalarStat;
}

export interface EnsembleHour {
  timestampUnix: number;
  timestampIso: string;
  hourIndex: number;
  windSpeed10m: ScalarStat;
  windSpeed80m: ScalarStat;
  windSpeed100m: ScalarStat;
  windSpeed120m: ScalarStat;
  windDirection10m: CircularStat;
  windDirection80m: CircularStat;
  windDirection100m: CircularStat;
  windDirection120m: CircularStat;
  windGusts10m: ScalarStat;
  precipitationMm: ScalarStat;
  precipitationProbabilityPct: ScalarStat;
  temperature2mC: ScalarStat;
  dewPoint2mC: ScalarStat;
  dewPointSpreadC: number | null;
  visibilityM: ScalarStat;
  surfacePressureHpa: ScalarStat;
  pressureDelta3hHpa: number | null;
  cloudCover: StratifiedCloudCover;
  verticalProfile: VerticalWindProfile;
  marine: MarineHour | null;
  confidence: ConfidenceScore;
  safeWindow: SafeWindowStatus;
  safeWindowReasons: string[];
  fogRisk: boolean;
  barometricSquallRisk: boolean;
}

export interface EphemerisData {
  dateIso: string;
  sunriseIso: string | null;
  sunsetIso: string | null;
  civilDawnIso: string | null;
  civilDuskIso: string | null;
  nauticalDawnIso: string | null;
  nauticalDuskIso: string | null;
  moonPhaseValue: number;
  moonPhaseLabel: string;
  moonIlluminationPct: number;
}

export interface NormalizedForecast {
  locationKey: string;
  latitude: number;
  longitude: number;
  elevationDemM: number;
  timezone: string;
  utcOffsetSeconds: number;
  fetchedAtIso: string;
  fromCache: boolean;
  marineAvailable: boolean;
  hours: EnsembleHour[];
  nativeByModel: Record<WeatherModelId, NativeModelHour[]>;
  overallConfidence: ConfidenceScore;
  alerts: OperationalAlert[];
  ephemerisByDay: EphemerisData[];
  thresholdsUsed: SafeWindowThresholds;
}
