export interface ForecastVisibleParams {
  wind10m: boolean;
  verticalProfile: boolean;
  waves: boolean;
  rainPressure: boolean;
  tempVisibility: boolean;
  clouds: boolean;
  alerts: boolean;
  charts: boolean;
  table168h: boolean;
  ephemeris: boolean;
}

export type ForecastParamKey = keyof ForecastVisibleParams;

export const VISIBLE_PARAMS_STORAGE_KEY = 'fieldcast_visible_params_v1';

/**
 * Modo Essencial (Limpo) — Padrão inicial para uma leitura suave e sem poluição visual.
 */
export const ESSENTIAL_VISIBLE_PARAMS: ForecastVisibleParams = {
  wind10m: true,
  verticalProfile: false,
  waves: true,
  rainPressure: true,
  tempVisibility: true,
  clouds: false,
  alerts: true,
  charts: true,
  table168h: true,
  ephemeris: true,
};

/**
 * Modo Completo — Todos os 10 grupos de parâmetros ativos (incluindo Perfil Vertical 80-120m e Nuvens B/M/A).
 */
export const COMPLETE_VISIBLE_PARAMS: ForecastVisibleParams = {
  wind10m: true,
  verticalProfile: true,
  waves: true,
  rainPressure: true,
  tempVisibility: true,
  clouds: true,
  alerts: true,
  charts: true,
  table168h: true,
  ephemeris: true,
};

/**
 * Modo Resumo Rápido — Apenas cartões principais e gráficos essenciais.
 */
export const QUICK_SUMMARY_VISIBLE_PARAMS: ForecastVisibleParams = {
  wind10m: true,
  verticalProfile: false,
  waves: true,
  rainPressure: true,
  tempVisibility: true,
  clouds: false,
  alerts: true,
  charts: true,
  table168h: false,
  ephemeris: false,
};

export const FORECAST_PARAM_DEFINITIONS: ReadonlyArray<{
  key: ForecastParamKey;
  label: string;
  shortLabel: string;
}> = [
  { key: 'wind10m', label: 'Vento 10m & Rajada', shortLabel: 'Vento 10m' },
  { key: 'verticalProfile', label: 'Perfil Vertical (80–120m)', shortLabel: 'Altitude 80–120m' },
  { key: 'waves', label: 'Ondas & Swell', shortLabel: 'Ondas & Swell' },
  { key: 'rainPressure', label: 'Chuva & Pressão', shortLabel: 'Chuva & Pressão' },
  { key: 'tempVisibility', label: 'Temperatura & Visibilidade', shortLabel: 'Temp & Visib.' },
  { key: 'clouds', label: 'Nebulosidade (3 Camadas)', shortLabel: 'Nuvens' },
  { key: 'alerts', label: 'Alertas Meteorológicos', shortLabel: 'Alertas' },
  { key: 'charts', label: 'Gráficos Interativos', shortLabel: 'Gráficos' },
  { key: 'table168h', label: 'Tabela Horária 168h', shortLabel: 'Tabela 168h' },
  { key: 'ephemeris', label: 'Sol & Lua (Efemérides)', shortLabel: 'Sol & Lua' },
];

export function loadPersistedVisibleParams(): ForecastVisibleParams {
  if (typeof window === 'undefined') {
    return ESSENTIAL_VISIBLE_PARAMS;
  }
  try {
    const raw = window.localStorage.getItem(VISIBLE_PARAMS_STORAGE_KEY);
    if (!raw) {
      return ESSENTIAL_VISIBLE_PARAMS;
    }
    const parsed = JSON.parse(raw) as Partial<ForecastVisibleParams>;
    return {
      wind10m: typeof parsed.wind10m === 'boolean' ? parsed.wind10m : ESSENTIAL_VISIBLE_PARAMS.wind10m,
      verticalProfile:
        typeof parsed.verticalProfile === 'boolean'
          ? parsed.verticalProfile
          : ESSENTIAL_VISIBLE_PARAMS.verticalProfile,
      waves: typeof parsed.waves === 'boolean' ? parsed.waves : ESSENTIAL_VISIBLE_PARAMS.waves,
      rainPressure:
        typeof parsed.rainPressure === 'boolean'
          ? parsed.rainPressure
          : ESSENTIAL_VISIBLE_PARAMS.rainPressure,
      tempVisibility:
        typeof parsed.tempVisibility === 'boolean'
          ? parsed.tempVisibility
          : ESSENTIAL_VISIBLE_PARAMS.tempVisibility,
      clouds: typeof parsed.clouds === 'boolean' ? parsed.clouds : ESSENTIAL_VISIBLE_PARAMS.clouds,
      alerts: typeof parsed.alerts === 'boolean' ? parsed.alerts : ESSENTIAL_VISIBLE_PARAMS.alerts,
      charts: typeof parsed.charts === 'boolean' ? parsed.charts : ESSENTIAL_VISIBLE_PARAMS.charts,
      table168h:
        typeof parsed.table168h === 'boolean' ? parsed.table168h : ESSENTIAL_VISIBLE_PARAMS.table168h,
      ephemeris:
        typeof parsed.ephemeris === 'boolean' ? parsed.ephemeris : ESSENTIAL_VISIBLE_PARAMS.ephemeris,
    };
  } catch {
    return ESSENTIAL_VISIBLE_PARAMS;
  }
}

export function persistVisibleParams(params: ForecastVisibleParams): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(VISIBLE_PARAMS_STORAGE_KEY, JSON.stringify(params));
  } catch {
    // Ignore storage quota errors
  }
}
