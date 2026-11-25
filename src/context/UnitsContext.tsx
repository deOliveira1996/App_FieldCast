import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_UNIT_PREFERENCES,
  formatPrecip,
  formatPressure,
  formatTemp,
  formatWave,
  formatWind,
  getPrecipUnitLabel,
  getPressureUnitLabel,
  getTempUnitLabel,
  getWaveUnitLabel,
  getWindUnitLabel,
  loadUnitPreferences,
  saveUnitPreferences,
  UNITS_CHANGED_EVENT,
  type PrecipitationUnit,
  type PressureUnit,
  type TemperatureUnit,
  type UnitPreferences,
  type WaveHeightUnit,
  type WindSpeedUnit,
} from '../utils/units';

export interface UnitsContextValue {
  units: UnitPreferences;
  setUnits: (next: UnitPreferences) => void;
  updateUnits: (patch: Partial<UnitPreferences>) => void;
  setWindUnit: (wind: WindSpeedUnit) => void;
  setTemperatureUnit: (temperature: TemperatureUnit) => void;
  setWaveUnit: (wave: WaveHeightUnit) => void;
  setPressureUnit: (pressure: PressureUnit) => void;
  setPrecipitationUnit: (precipitation: PrecipitationUnit) => void;
  resetUnits: () => void;
  windLabel: string;
  tempLabel: string;
  waveLabel: string;
  pressureLabel: string;
  precipLabel: string;
  formatWindValue: (kmh: number | null | undefined, decimals?: number) => string;
  formatTempValue: (celsius: number | null | undefined, decimals?: number) => string;
  formatWaveValue: (meters: number | null | undefined, decimals?: number) => string;
  formatPressureValue: (hpa: number | null | undefined) => string;
  formatPrecipValue: (mm: number | null | undefined, decimals?: number) => string;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

function buildUnitsValue(
  units: UnitPreferences,
  setUnitsFn: (next: UnitPreferences) => void,
  updateUnitsFn: (patch: Partial<UnitPreferences>) => void,
  resetUnitsFn: () => void,
): UnitsContextValue {
  return {
    units,
    setUnits: setUnitsFn,
    updateUnits: updateUnitsFn,
    setWindUnit: (wind) => updateUnitsFn({ wind }),
    setTemperatureUnit: (temperature) => updateUnitsFn({ temperature }),
    setWaveUnit: (wave) => updateUnitsFn({ wave }),
    setPressureUnit: (pressure) => updateUnitsFn({ pressure }),
    setPrecipitationUnit: (precipitation) => updateUnitsFn({ precipitation }),
    resetUnits: resetUnitsFn,
    windLabel: getWindUnitLabel(units.wind),
    tempLabel: getTempUnitLabel(units.temperature),
    waveLabel: getWaveUnitLabel(units.wave),
    pressureLabel: getPressureUnitLabel(units.pressure),
    precipLabel: getPrecipUnitLabel(units.precipitation),
    formatWindValue: (kmh, decimals = 1) => formatWind(kmh, units.wind, decimals),
    formatTempValue: (c, decimals = 1) => formatTemp(c, units.temperature, decimals),
    formatWaveValue: (m, decimals = 2) => formatWave(m, units.wave, decimals),
    formatPressureValue: (hpa) => formatPressure(hpa, units.pressure),
    formatPrecipValue: (mm, decimals = 1) => formatPrecip(mm, units.precipitation, decimals),
  };
}

export const UnitsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [units, setUnitsState] = useState<UnitPreferences>(() => loadUnitPreferences());

  useEffect(() => {
    const handleExternalChange = (event: Event) => {
      const detail = (event as CustomEvent<UnitPreferences>).detail;
      if (detail) {
        setUnitsState(detail);
      } else {
        setUnitsState(loadUnitPreferences());
      }
    };
    window.addEventListener(UNITS_CHANGED_EVENT, handleExternalChange);
    return () => window.removeEventListener(UNITS_CHANGED_EVENT, handleExternalChange);
  }, []);

  const setUnits = useCallback((next: UnitPreferences) => {
    const saved = saveUnitPreferences(next);
    setUnitsState(saved);
  }, []);

  const updateUnits = useCallback((patch: Partial<UnitPreferences>) => {
    const saved = saveUnitPreferences(patch);
    setUnitsState(saved);
  }, []);

  const resetUnits = useCallback(() => {
    const saved = saveUnitPreferences(DEFAULT_UNIT_PREFERENCES);
    setUnitsState(saved);
  }, []);

  const value = useMemo(
    () => buildUnitsValue(units, setUnits, updateUnits, resetUnits),
    [units, setUnits, updateUnits, resetUnits],
  );

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
};

/**
 * Hook seguro que funciona dentro de `<UnitsProvider>` ou de forma independente em testes unitários.
 */
export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  const [standaloneUnits, setStandaloneUnits] = useState<UnitPreferences>(() =>
    loadUnitPreferences(),
  );

  useEffect(() => {
    if (ctx) return;
    const handleExternalChange = (event: Event) => {
      const detail = (event as CustomEvent<UnitPreferences>).detail;
      setStandaloneUnits(detail ?? loadUnitPreferences());
    };
    window.addEventListener(UNITS_CHANGED_EVENT, handleExternalChange);
    return () => window.removeEventListener(UNITS_CHANGED_EVENT, handleExternalChange);
  }, [ctx]);

  const setStandalone = useCallback((next: UnitPreferences) => {
    setStandaloneUnits(saveUnitPreferences(next));
  }, []);

  const updateStandalone = useCallback((patch: Partial<UnitPreferences>) => {
    setStandaloneUnits(saveUnitPreferences(patch));
  }, []);

  const resetStandalone = useCallback(() => {
    setStandaloneUnits(saveUnitPreferences(DEFAULT_UNIT_PREFERENCES));
  }, []);

  const fallbackValue = useMemo(
    () => buildUnitsValue(standaloneUnits, setStandalone, updateStandalone, resetStandalone),
    [standaloneUnits, setStandalone, updateStandalone, resetStandalone],
  );

  return ctx ?? fallbackValue;
}
