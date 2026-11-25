import { z } from 'zod';

/**
 * Array numérico onde valores ausentes por modelo/grade chegam como `null`.
 */
export const NullableNumberArraySchema = z.array(z.number().nullable());

/**
 * Schema do objeto `hourly` da Open-Meteo Forecast API multi-modelo
 * (`models=ecmwf_ifs025,gfs_seamless,icon_seamless` & `timeformat=unixtime`).
 *
 * Chaves verificadas no API Probe real:
 * - `ecmwf_ifs025`: entrega `10m` e `100m`; retorna `null` em `80m`, `120m`, `visibility` e `precipitation_probability`.
 * - `gfs_seamless`: entrega `10m`, `80m` e `120m`; retorna `null` em `100m`.
 * - `icon_seamless`: entrega `10m`, `80m` e `120m`; retorna `null` em `100m` e `precipitation_probability`.
 */
export const OpenMeteoForecastHourlySchema = z
  .object({
    time: z.array(z.number()),

    // ECMWF IFS 0.25° (ecmwf_ifs025)
    wind_speed_10m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_speed_80m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_speed_100m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_speed_120m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_direction_10m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_direction_80m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_direction_100m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_direction_120m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    wind_gusts_10m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    precipitation_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    precipitation_probability_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    temperature_2m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    dew_point_2m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    visibility_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    surface_pressure_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    cloud_cover_low_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    cloud_cover_mid_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    cloud_cover_high_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    relative_humidity_2m_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    apparent_temperature_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    cape_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    weather_code_ecmwf_ifs025: NullableNumberArraySchema.optional(),
    et0_fao_evapotranspiration_ecmwf_ifs025: NullableNumberArraySchema.optional(),

    // GFS Seamless (gfs_seamless)
    wind_speed_10m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_speed_80m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_speed_100m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_speed_120m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_direction_10m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_direction_80m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_direction_100m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_direction_120m_gfs_seamless: NullableNumberArraySchema.optional(),
    wind_gusts_10m_gfs_seamless: NullableNumberArraySchema.optional(),
    precipitation_gfs_seamless: NullableNumberArraySchema.optional(),
    precipitation_probability_gfs_seamless: NullableNumberArraySchema.optional(),
    temperature_2m_gfs_seamless: NullableNumberArraySchema.optional(),
    dew_point_2m_gfs_seamless: NullableNumberArraySchema.optional(),
    visibility_gfs_seamless: NullableNumberArraySchema.optional(),
    surface_pressure_gfs_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_low_gfs_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_mid_gfs_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_high_gfs_seamless: NullableNumberArraySchema.optional(),
    relative_humidity_2m_gfs_seamless: NullableNumberArraySchema.optional(),
    apparent_temperature_gfs_seamless: NullableNumberArraySchema.optional(),
    cape_gfs_seamless: NullableNumberArraySchema.optional(),
    weather_code_gfs_seamless: NullableNumberArraySchema.optional(),
    et0_fao_evapotranspiration_gfs_seamless: NullableNumberArraySchema.optional(),

    // DWD ICON Seamless (icon_seamless)
    wind_speed_10m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_speed_80m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_speed_100m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_speed_120m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_direction_10m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_direction_80m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_direction_100m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_direction_120m_icon_seamless: NullableNumberArraySchema.optional(),
    wind_gusts_10m_icon_seamless: NullableNumberArraySchema.optional(),
    precipitation_icon_seamless: NullableNumberArraySchema.optional(),
    precipitation_probability_icon_seamless: NullableNumberArraySchema.optional(),
    temperature_2m_icon_seamless: NullableNumberArraySchema.optional(),
    dew_point_2m_icon_seamless: NullableNumberArraySchema.optional(),
    visibility_icon_seamless: NullableNumberArraySchema.optional(),
    surface_pressure_icon_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_low_icon_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_mid_icon_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_high_icon_seamless: NullableNumberArraySchema.optional(),
    relative_humidity_2m_icon_seamless: NullableNumberArraySchema.optional(),
    apparent_temperature_icon_seamless: NullableNumberArraySchema.optional(),
    cape_icon_seamless: NullableNumberArraySchema.optional(),
    weather_code_icon_seamless: NullableNumberArraySchema.optional(),
    et0_fao_evapotranspiration_icon_seamless: NullableNumberArraySchema.optional(),

    // CMC Canada GEM Seamless (gem_seamless)
    wind_speed_10m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_speed_80m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_speed_100m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_speed_120m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_direction_10m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_direction_80m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_direction_100m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_direction_120m_gem_seamless: NullableNumberArraySchema.optional(),
    wind_gusts_10m_gem_seamless: NullableNumberArraySchema.optional(),
    precipitation_gem_seamless: NullableNumberArraySchema.optional(),
    precipitation_probability_gem_seamless: NullableNumberArraySchema.optional(),
    temperature_2m_gem_seamless: NullableNumberArraySchema.optional(),
    dew_point_2m_gem_seamless: NullableNumberArraySchema.optional(),
    visibility_gem_seamless: NullableNumberArraySchema.optional(),
    surface_pressure_gem_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_low_gem_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_mid_gem_seamless: NullableNumberArraySchema.optional(),
    cloud_cover_high_gem_seamless: NullableNumberArraySchema.optional(),
    relative_humidity_2m_gem_seamless: NullableNumberArraySchema.optional(),
    apparent_temperature_gem_seamless: NullableNumberArraySchema.optional(),
    cape_gem_seamless: NullableNumberArraySchema.optional(),
    weather_code_gem_seamless: NullableNumberArraySchema.optional(),
    et0_fao_evapotranspiration_gem_seamless: NullableNumberArraySchema.optional(),
  })
  .passthrough();

export const OpenMeteoForecastResponseSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    generationtime_ms: z.number().optional(),
    utc_offset_seconds: z.number(),
    timezone: z.string(),
    timezone_abbreviation: z.string().optional(),
    elevation: z.number(),
    hourly_units: z.record(z.string(), z.string()).optional(),
    hourly: OpenMeteoForecastHourlySchema,
  })
  .passthrough();

export type OpenMeteoForecastHourly = z.infer<typeof OpenMeteoForecastHourlySchema>;
export type OpenMeteoForecastResponse = z.infer<typeof OpenMeteoForecastResponseSchema>;

/**
 * Schema do objeto `hourly` da Open-Meteo Marine API (`timeformat=unixtime`).
 * Em coordenadas continentais (ex.: Brasília), todos os arrays retornam `[null, null, ...]`.
 */
export const OpenMeteoMarineHourlySchema = z
  .object({
    time: z.array(z.number()),
    wave_height: NullableNumberArraySchema.optional(),
    wave_period: NullableNumberArraySchema.optional(),
    wave_direction: NullableNumberArraySchema.optional(),
    swell_wave_height: NullableNumberArraySchema.optional(),
    swell_wave_period: NullableNumberArraySchema.optional(),
    swell_wave_direction: NullableNumberArraySchema.optional(),
    ocean_current_velocity: NullableNumberArraySchema.optional(),
    ocean_current_direction: NullableNumberArraySchema.optional(),
    sea_level_height_msl: NullableNumberArraySchema.optional(),
  })
  .passthrough();

export const OpenMeteoMarineResponseSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    generationtime_ms: z.number().optional(),
    utc_offset_seconds: z.number(),
    timezone: z.string(),
    timezone_abbreviation: z.string().optional(),
    elevation: z.number().optional(),
    hourly_units: z.record(z.string(), z.string()).optional(),
    hourly: OpenMeteoMarineHourlySchema,
  })
  .passthrough();

export type OpenMeteoMarineHourly = z.infer<typeof OpenMeteoMarineHourlySchema>;
export type OpenMeteoMarineResponse = z.infer<typeof OpenMeteoMarineResponseSchema>;

/**
 * Verifica se o payload da Marine API possui dados reais de grade oceânica
 * (retorna `false` quando a coordenada é continental e todos os pontos são `null`).
 */
export function hasValidMarineGrid(marine: OpenMeteoMarineResponse | null | undefined): boolean {
  if (!marine || !marine.hourly) {
    return false;
  }
  const { wave_height, swell_wave_height, ocean_current_velocity } = marine.hourly;
  const hasWave = Array.isArray(wave_height) && wave_height.some((v) => v !== null);
  const hasSwell = Array.isArray(swell_wave_height) && swell_wave_height.some((v) => v !== null);
  const hasCurrent =
    Array.isArray(ocean_current_velocity) && ocean_current_velocity.some((v) => v !== null);
  return hasWave || hasSwell || hasCurrent;
}

/**
 * Schema da API pública do RainViewer (`https://api.rainviewer.com/public/weather-maps.json`)
 */
export const RainViewerFrameSchema = z.object({
  time: z.number(),
  path: z.string(),
});

export const RainViewerResponseSchema = z
  .object({
    version: z.string().optional(),
    generated: z.number().optional(),
    host: z.string(),
    radar: z.object({
      past: z.array(RainViewerFrameSchema),
      nowcast: z.array(RainViewerFrameSchema).optional().default([]),
    }),
  })
  .passthrough();

export type RainViewerFrame = z.infer<typeof RainViewerFrameSchema>;
export type RainViewerResponse = z.infer<typeof RainViewerResponseSchema>;

/**
 * Schema de geocodificação Nominatim (OSM)
 */
export const NominatimResultSchema = z
  .object({
    place_id: z.number().optional(),
    lat: z.string(),
    lon: z.string(),
    display_name: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export const NominatimResponseSchema = z.array(NominatimResultSchema);

export type NominatimResult = z.infer<typeof NominatimResultSchema>;

/**
 * Schema do fallback de geolocalização por IP (`https://ipwho.is/`)
 */
export const IpWhoIsResponseSchema = z
  .object({
    ip: z.string().optional(),
    success: z.boolean(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type IpWhoIsResponse = z.infer<typeof IpWhoIsResponseSchema>;

/**
 * Schema de validação para `SafeWindowThresholds` configuráveis pelo usuário.
 */
export const SafeWindowThresholdsSchema = z.object({
  maxWindKmh: z.number().min(5).max(150),
  maxGustKmh: z.number().min(5).max(200),
  maxWaveM: z.number().min(0.1).max(20),
  maxPrecipProbPct: z.number().min(0).max(100),
});

/**
 * Schema da Open-Meteo Historical Weather Archive API (ERA5 / reanálise horária).
 */
export const OpenMeteoArchiveResponseSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    generationtime_ms: z.number().optional(),
    utc_offset_seconds: z.number().optional().default(-10800),
    timezone: z.string().optional().default('America/Sao_Paulo'),
    elevation: z.number().optional().default(0),
    hourly: z
      .object({
        time: z.array(z.number()),
        temperature_2m: NullableNumberArraySchema.optional(),
        dew_point_2m: NullableNumberArraySchema.optional(),
        wind_speed_10m: NullableNumberArraySchema.optional(),
        wind_gusts_10m: NullableNumberArraySchema.optional(),
        wind_direction_10m: NullableNumberArraySchema.optional(),
        precipitation: NullableNumberArraySchema.optional(),
        surface_pressure: NullableNumberArraySchema.optional(),
        relative_humidity_2m: NullableNumberArraySchema.optional(),
        apparent_temperature: NullableNumberArraySchema.optional(),
        et0_fao_evapotranspiration: NullableNumberArraySchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type OpenMeteoArchiveResponse = z.infer<typeof OpenMeteoArchiveResponseSchema>;

/**
 * Schema do feed oficial aberto NOAA SWPC Planetary K-index (`noaa-planetary-k-index-forecast.json`).
 */
export const NoaaSwpcKpPointSchema = z
  .object({
    time_tag: z.string(),
    kp: z.number(),
    observed: z.string(),
    noaa_scale: z.string().nullable().optional(),
  })
  .passthrough();

export const NoaaSwpcKpForecastSchema = z.array(NoaaSwpcKpPointSchema);
export type NoaaSwpcKpPoint = z.infer<typeof NoaaSwpcKpPointSchema>;
