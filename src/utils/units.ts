export type WindSpeedUnit = 'kmh' | 'ms' | 'kt' | 'mph';
export type TemperatureUnit = 'c' | 'f';
export type WaveHeightUnit = 'm' | 'ft';
export type PressureUnit = 'hpa' | 'inhg';
export type PrecipitationUnit = 'mm' | 'in';

export interface UnitPreferences {
  wind: WindSpeedUnit;
  temperature: TemperatureUnit;
  wave: WaveHeightUnit;
  pressure: PressureUnit;
  precipitation: PrecipitationUnit;
}

export const UNIT_PREFERENCES_STORAGE_KEY = 'fieldcast_unit_preferences_v41';
export const UNITS_CHANGED_EVENT = 'fieldcast:units-changed';

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  wind: 'kmh',
  temperature: 'c',
  wave: 'm',
  pressure: 'hpa',
  precipitation: 'mm',
};

const VALID_WIND_UNITS = new Set<WindSpeedUnit>(['kmh', 'ms', 'kt', 'mph']);
const VALID_TEMP_UNITS = new Set<TemperatureUnit>(['c', 'f']);
const VALID_WAVE_UNITS = new Set<WaveHeightUnit>(['m', 'ft']);
const VALID_PRESSURE_UNITS = new Set<PressureUnit>(['hpa', 'inhg']);
const VALID_PRECIP_UNITS = new Set<PrecipitationUnit>(['mm', 'in']);

let memoryUnits: UnitPreferences = { ...DEFAULT_UNIT_PREFERENCES };

export function sanitizeUnitPreferences(
  raw: Partial<UnitPreferences> | null | undefined,
): UnitPreferences {
  return {
    wind: raw?.wind && VALID_WIND_UNITS.has(raw.wind) ? raw.wind : DEFAULT_UNIT_PREFERENCES.wind,
    temperature:
      raw?.temperature && VALID_TEMP_UNITS.has(raw.temperature)
        ? raw.temperature
        : DEFAULT_UNIT_PREFERENCES.temperature,
    wave: raw?.wave && VALID_WAVE_UNITS.has(raw.wave) ? raw.wave : DEFAULT_UNIT_PREFERENCES.wave,
    pressure:
      raw?.pressure && VALID_PRESSURE_UNITS.has(raw.pressure)
        ? raw.pressure
        : DEFAULT_UNIT_PREFERENCES.pressure,
    precipitation:
      raw?.precipitation && VALID_PRECIP_UNITS.has(raw.precipitation)
        ? raw.precipitation
        : DEFAULT_UNIT_PREFERENCES.precipitation,
  };
}

export function loadUnitPreferences(): UnitPreferences {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(UNIT_PREFERENCES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UnitPreferences>;
        const sanitized = sanitizeUnitPreferences(parsed);
        memoryUnits = sanitized;
        return { ...sanitized };
      }
    }
  } catch {
    // Fallback em memória quando localStorage está indisponível
  }
  return { ...memoryUnits };
}

export function saveUnitPreferences(next: Partial<UnitPreferences>): UnitPreferences {
  const sanitized = sanitizeUnitPreferences({ ...loadUnitPreferences(), ...next });
  memoryUnits = sanitized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(UNIT_PREFERENCES_STORAGE_KEY, JSON.stringify(sanitized));
    }
  } catch {
    // Ignora falha de escrita em ambiente restrito
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<UnitPreferences>(UNITS_CHANGED_EVENT, { detail: sanitized }));
  }
  return { ...sanitized };
}

export function convertWindSpeed(
  kmh: number | null | undefined,
  unit: WindSpeedUnit,
): number | null {
  if (typeof kmh !== 'number' || !Number.isFinite(kmh)) return null;
  switch (unit) {
    case 'ms':
      return kmh / 3.6;
    case 'kt':
      return kmh / 1.852;
    case 'mph':
      return kmh / 1.609344;
    case 'kmh':
    default:
      return kmh;
  }
}

export function windSpeedToKmh(value: number, unit: WindSpeedUnit): number {
  switch (unit) {
    case 'ms':
      return value * 3.6;
    case 'kt':
      return value * 1.852;
    case 'mph':
      return value * 1.609344;
    case 'kmh':
    default:
      return value;
  }
}

export function convertTemperature(
  celsius: number | null | undefined,
  unit: TemperatureUnit,
): number | null {
  if (typeof celsius !== 'number' || !Number.isFinite(celsius)) return null;
  return unit === 'f' ? (celsius * 9) / 5 + 32 : celsius;
}

export function temperatureToC(value: number, unit: TemperatureUnit): number {
  return unit === 'f' ? ((value - 32) * 5) / 9 : value;
}

export function convertWaveHeight(
  meters: number | null | undefined,
  unit: WaveHeightUnit,
): number | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return null;
  return unit === 'ft' ? meters * 3.28084 : meters;
}

export function waveHeightToM(value: number, unit: WaveHeightUnit): number {
  return unit === 'ft' ? value / 3.28084 : value;
}

export function convertPressure(
  hpa: number | null | undefined,
  unit: PressureUnit,
): number | null {
  if (typeof hpa !== 'number' || !Number.isFinite(hpa)) return null;
  return unit === 'inhg' ? hpa * 0.02952998 : hpa;
}

export function pressureToHpa(value: number, unit: PressureUnit): number {
  return unit === 'inhg' ? value / 0.02952998 : value;
}

export function convertPrecipitation(
  mm: number | null | undefined,
  unit: PrecipitationUnit,
): number | null {
  if (typeof mm !== 'number' || !Number.isFinite(mm)) return null;
  return unit === 'in' ? mm / 25.4 : mm;
}

export function precipitationToMm(value: number, unit: PrecipitationUnit): number {
  return unit === 'in' ? value * 25.4 : value;
}

export function getWindUnitLabel(unit: WindSpeedUnit): string {
  switch (unit) {
    case 'ms':
      return 'm/s';
    case 'kt':
      return 'kt';
    case 'mph':
      return 'mph';
    case 'kmh':
    default:
      return 'km/h';
  }
}

export function getTempUnitLabel(unit: TemperatureUnit): string {
  return unit === 'f' ? '°F' : '°C';
}

export function getWaveUnitLabel(unit: WaveHeightUnit): string {
  return unit === 'ft' ? 'ft' : 'm';
}

export function getPressureUnitLabel(unit: PressureUnit): string {
  return unit === 'inhg' ? 'inHg' : 'hPa';
}

export function getPrecipUnitLabel(unit: PrecipitationUnit): string {
  return unit === 'in' ? 'in' : 'mm';
}

export function formatWind(
  kmh: number | null | undefined,
  unit: WindSpeedUnit,
  decimals = 1,
): string {
  const val = convertWindSpeed(kmh, unit);
  if (val === null) return '—';
  const effDecimals = unit === 'ms' ? Math.max(1, decimals) : decimals;
  return `${val.toFixed(effDecimals)} ${getWindUnitLabel(unit)}`;
}

export function formatTemp(
  celsius: number | null | undefined,
  unit: TemperatureUnit,
  decimals = 1,
): string {
  const val = convertTemperature(celsius, unit);
  if (val === null) return '—';
  return `${val.toFixed(decimals)}${getTempUnitLabel(unit)}`;
}

export function formatWave(
  meters: number | null | undefined,
  unit: WaveHeightUnit,
  decimals = 2,
): string {
  const val = convertWaveHeight(meters, unit);
  if (val === null) return '—';
  const effDecimals = unit === 'ft' ? 1 : decimals;
  return `${val.toFixed(effDecimals)} ${getWaveUnitLabel(unit)}`;
}

export function formatPressure(
  hpa: number | null | undefined,
  unit: PressureUnit,
): string {
  const val = convertPressure(hpa, unit);
  if (val === null) return '—';
  return unit === 'inhg' ? `${val.toFixed(2)} inHg` : `${Math.round(val)} hPa`;
}

export function formatPrecip(
  mm: number | null | undefined,
  unit: PrecipitationUnit,
  decimals = 1,
): string {
  const val = convertPrecipitation(mm, unit);
  if (val === null) return '—';
  const effDecimals = unit === 'in' ? 2 : decimals;
  return `${val.toFixed(effDecimals)} ${getPrecipUnitLabel(unit)}`;
}
