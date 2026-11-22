import type { TrackPoint, TrackSession, Waypoint } from '../types/field';
import type { NormalizedForecast } from '../types/weather';

export const UTF8_BOM = '\uFEFF';
export const EARTH_RADIUS_KM = 6371;

/**
 * Calcula a distância geodésica em quilômetros entre duas coordenadas (Lat/Lon em graus)
 * utilizando a fórmula de Haversine.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Calcula a distância de Haversine em metros.
 */
export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return haversineDistanceKm(lat1, lon1, lat2, lon2) * 1000;
}

/**
 * Calcula a distância total acumulada (em km) de uma sequência de pontos de track GPS.
 */
export function computeTrackDistanceKm(
  points: readonly Pick<TrackPoint, 'latitude' | 'longitude'>[],
): number {
  if (points.length < 2) {
    return 0;
  }
  let totalKm = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    totalKm += haversineDistanceKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
  }
  return Number(totalKm.toFixed(4));
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

function formatNum(val: number | null | undefined, decimals = 2): string {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return '';
  }
  return val.toFixed(decimals);
}

/**
 * Exporta a previsão horária normalizada (`NormalizedForecast`) para CSV precedido por BOM UTF-8 (`\uFEFF`).
 */
export function exportForecastToCsv(forecast: NormalizedForecast): string {
  const headers = [
    'timestamp_unix',
    'timestamp_iso',
    'hour_index',
    'latitude',
    'longitude',
    'elevation_dem_m',
    'wind_speed_10m_kmh',
    'wind_speed_80m_kmh',
    'wind_speed_100m_kmh',
    'wind_speed_120m_kmh',
    'wind_direction_10m_deg',
    'wind_coherence_r_10m',
    'wind_gusts_10m_kmh',
    'temperature_2m_c',
    'dew_point_2m_c',
    'dew_point_spread_c',
    'precipitation_mm',
    'precipitation_prob_pct',
    'surface_pressure_hpa',
    'pressure_delta_3h_hpa',
    'visibility_m',
    'cloud_cover_low_pct',
    'cloud_cover_mid_pct',
    'cloud_cover_high_pct',
    'wave_height_m',
    'wave_period_s',
    'wave_direction_deg',
    'swell_wave_height_m',
    'ocean_current_velocity_kmh',
    'shear_alpha',
    'atypical_shear_warning',
    'confidence_score',
    'confidence_badge',
    'safe_window',
    'fog_risk',
    'barometric_squall_risk',
  ];

  const rows: string[] = [headers.join(',')];

  for (const h of forecast.hours) {
    const row = [
      h.timestampUnix,
      h.timestampIso,
      h.hourIndex,
      formatNum(forecast.latitude, 4),
      formatNum(forecast.longitude, 4),
      formatNum(forecast.elevationDemM, 1),
      formatNum(h.windSpeed10m.mean, 1),
      formatNum(h.windSpeed80m.mean, 1),
      formatNum(h.windSpeed100m.mean, 1),
      formatNum(h.windSpeed120m.mean, 1),
      formatNum(h.windDirection10m.degree, 0),
      formatNum(h.windDirection10m.resultantLengthR, 3),
      formatNum(h.windGusts10m.mean, 1),
      formatNum(h.temperature2mC.mean, 1),
      formatNum(h.dewPoint2mC.mean, 1),
      formatNum(h.dewPointSpreadC, 1),
      formatNum(h.precipitationMm.mean, 2),
      formatNum(h.precipitationProbabilityPct.mean, 0),
      formatNum(h.surfacePressureHpa.mean, 1),
      formatNum(h.pressureDelta3hHpa, 2),
      formatNum(h.visibilityM.mean, 0),
      formatNum(h.cloudCover.lowPct.mean, 0),
      formatNum(h.cloudCover.midPct.mean, 0),
      formatNum(h.cloudCover.highPct.mean, 0),
      formatNum(h.marine?.waveHeight, 2),
      formatNum(h.marine?.wavePeriod, 1),
      formatNum(h.marine?.waveDirection, 0),
      formatNum(h.marine?.swellWaveHeight, 2),
      formatNum(h.marine?.oceanCurrentVelocity, 2),
      formatNum(h.verticalProfile.alpha, 3),
      h.verticalProfile.atypicalShearWarning,
      h.confidence.total,
      h.confidence.badge,
      h.safeWindow,
      h.fogRisk,
      h.barometricSquallRisk,
    ].map(escapeCsvCell);

    rows.push(row.join(','));
  }

  return UTF8_BOM + rows.join('\r\n');
}

/**
 * Exporta Waypoints de campo com seus snapshots meteorológicos para CSV com BOM UTF-8 (`\uFEFF`).
 */
export function exportWaypointsToCsv(waypoints: readonly Waypoint[]): string {
  const headers = [
    'id',
    'name',
    'latitude',
    'longitude',
    'timestamp_utc_iso',
    'note',
    'wind_speed_10m_kmh',
    'wind_direction_10m_deg',
    'wind_gusts_10m_kmh',
    'temperature_2m_c',
    'surface_pressure_hpa',
    'precipitation_mm',
    'wave_height_m',
    'wave_period_s',
    'wave_direction_deg',
    'confidence_total',
    'safe_window',
    'has_photo',
  ];

  const rows: string[] = [headers.join(',')];

  for (const wp of waypoints) {
    const c = wp.conditions;
    const row = [
      wp.id,
      wp.name,
      formatNum(wp.latitude, 6),
      formatNum(wp.longitude, 6),
      wp.timestampUtcIso,
      wp.note,
      formatNum(c.windSpeed10mKmh, 1),
      formatNum(c.windDirection10mDeg, 0),
      formatNum(c.windGusts10mKmh, 1),
      formatNum(c.temperature2mC, 1),
      formatNum(c.surfacePressureHpa, 1),
      formatNum(c.precipitationMm, 2),
      formatNum(c.waveHeightM, 2),
      formatNum(c.wavePeriodS, 1),
      formatNum(c.waveDirectionDeg, 0),
      c.confidenceTotal ?? '',
      c.safeWindow ?? '',
      Boolean(wp.photoDataUrl),
    ].map(escapeCsvCell);

    rows.push(row.join(','));
  }

  return UTF8_BOM + rows.join('\r\n');
}

/**
 * Exporta sessões de Track GPS para CSV com BOM UTF-8 (`\uFEFF`).
 */
export function exportTracksToCsv(tracks: readonly TrackSession[]): string {
  const headers = [
    'track_id',
    'track_name',
    'status',
    'total_distance_km',
    'point_index',
    'latitude',
    'longitude',
    'accuracy_m',
    'speed_ms',
    'heading_deg',
    'timestamp_utc_iso',
  ];

  const rows: string[] = [headers.join(',')];

  for (const trk of tracks) {
    if (trk.points.length === 0) {
      rows.push(
        [
          trk.id,
          trk.name,
          trk.status,
          formatNum(trk.totalDistanceKm, 3),
          0,
          '',
          '',
          '',
          '',
          '',
          trk.startedAtIso,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
      continue;
    }

    trk.points.forEach((pt, idx) => {
      rows.push(
        [
          trk.id,
          trk.name,
          trk.status,
          formatNum(trk.totalDistanceKm, 3),
          idx,
          formatNum(pt.latitude, 6),
          formatNum(pt.longitude, 6),
          formatNum(pt.accuracyM, 1),
          formatNum(pt.speedMs, 2),
          formatNum(pt.headingDeg, 0),
          pt.timestampUtcIso,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    });
  }

  return UTF8_BOM + rows.join('\r\n');
}

/**
 * Serializa qualquer objeto de previsão ou operação de campo para JSON formatado.
 */
export function exportToJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Exporta `NormalizedForecast` para JSON formatado.
 */
export function exportForecastToJson(forecast: NormalizedForecast): string {
  return exportToJson(forecast);
}

/**
 * Exporta pacote consolidado de campo (Waypoints, Tracks e Previsão) para JSON.
 */
export function exportFieldDataToJson(payload: {
  waypoints?: readonly Waypoint[];
  tracks?: readonly TrackSession[];
  forecast?: NormalizedForecast | null;
}): string {
  return exportToJson({
    exportedAtIso: new Date().toISOString(),
    application: 'FieldCast',
    waypoints: payload.waypoints ?? [],
    tracks: payload.tracks ?? [],
    forecast: payload.forecast ?? null,
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Gera arquivo GPX 1.1 válido contendo Waypoints (`<wpt>`) e Tracks (`<trk><trkseg><trkpt>`).
 */
export function exportToGpx(options: {
  waypoints?: readonly Waypoint[];
  tracks?: readonly TrackSession[];
  name?: string;
}): string {
  const waypoints = options.waypoints ?? [];
  const tracks = options.tracks ?? [];
  const docName = escapeXml(options.name ?? 'FieldCast Mission Export');
  const nowIso = new Date().toISOString();

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="FieldCast - org.fieldcast.app" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${docName}</name>`,
    `    <time>${nowIso}</time>`,
    '  </metadata>',
  ];

  for (const wp of waypoints) {
    const c = wp.conditions;
    const summaryParts: string[] = [];
    if (wp.note) summaryParts.push(wp.note);
    if (c.windSpeed10mKmh !== null) summaryParts.push(`Vento: ${c.windSpeed10mKmh.toFixed(1)} km/h`);
    if (c.windGusts10mKmh !== null)
      summaryParts.push(`Rajada: ${c.windGusts10mKmh.toFixed(1)} km/h`);
    if (c.temperature2mC !== null) summaryParts.push(`Temp: ${c.temperature2mC.toFixed(1)} °C`);
    if (c.waveHeightM !== null) summaryParts.push(`Onda: ${c.waveHeightM.toFixed(2)} m`);
    if (c.safeWindow !== null) summaryParts.push(`Semáforo: ${c.safeWindow}`);

    lines.push(
      `  <wpt lat="${wp.latitude.toFixed(6)}" lon="${wp.longitude.toFixed(6)}">`,
      `    <time>${escapeXml(wp.timestampUtcIso)}</time>`,
      `    <name>${escapeXml(wp.name)}</name>`,
      `    <desc>${escapeXml(summaryParts.join(' | '))}</desc>`,
      '  </wpt>',
    );
  }

  for (const trk of tracks) {
    lines.push('  <trk>', `    <name>${escapeXml(trk.name)}</name>`, '    <trkseg>');
    for (const pt of trk.points) {
      lines.push(
        `      <trkpt lat="${pt.latitude.toFixed(6)}" lon="${pt.longitude.toFixed(6)}">`,
        `        <time>${escapeXml(pt.timestampUtcIso)}</time>`,
        '      </trkpt>',
      );
    }
    lines.push('    </trkseg>', '  </trk>');
  }

  lines.push('</gpx>');
  return lines.join('\n');
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry:
    | {
        type: 'Point';
        coordinates: [number, number] | [number, number, number];
      }
    | {
        type: 'LineString';
        coordinates: [number, number][];
      };
  properties: Record<string, unknown>;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

/**
 * Gera um GeoJSON (`FeatureCollection` RFC 7946) contendo Waypoints (`Point`),
 * Tracks (`LineString`) e opcionalmente o ponto central da previsão (`Point`).
 */
export function exportToGeoJson(options: {
  waypoints?: readonly Waypoint[];
  tracks?: readonly TrackSession[];
  forecast?: NormalizedForecast | null;
}): string {
  const features: GeoJsonFeature[] = [];

  if (options.forecast) {
    const f = options.forecast;
    const currentHour = f.hours[0];
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.longitude, f.latitude, f.elevationDemM],
      },
      properties: {
        featureKind: 'forecast_station',
        locationKey: f.locationKey,
        elevationDemM: f.elevationDemM,
        timezone: f.timezone,
        marineAvailable: f.marineAvailable,
        overallConfidence: f.overallConfidence.total,
        confidenceBadge: f.overallConfidence.badge,
        currentWind10mKmh: currentHour?.windSpeed10m.mean ?? null,
        currentGust10mKmh: currentHour?.windGusts10m.mean ?? null,
        currentWaveHeightM: currentHour?.marine?.waveHeight ?? null,
        currentSafeWindow: currentHour?.safeWindow ?? null,
      },
    });
  }

  for (const wp of options.waypoints ?? []) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [wp.longitude, wp.latitude],
      },
      properties: {
        featureKind: 'waypoint',
        id: wp.id,
        name: wp.name,
        timestampUtcIso: wp.timestampUtcIso,
        note: wp.note,
        hasPhoto: Boolean(wp.photoDataUrl),
        conditions: wp.conditions,
      },
    });
  }

  for (const trk of options.tracks ?? []) {
    if (trk.points.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: trk.points.map((pt) => [pt.longitude, pt.latitude]),
        },
        properties: {
          featureKind: 'track',
          id: trk.id,
          name: trk.name,
          status: trk.status,
          startedAtIso: trk.startedAtIso,
          endedAtIso: trk.endedAtIso ?? null,
          totalDistanceKm: trk.totalDistanceKm,
          pointCount: trk.points.length,
        },
      });
    } else if (trk.points.length === 1) {
      const pt = trk.points[0]!;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [pt.longitude, pt.latitude],
        },
        properties: {
          featureKind: 'track_single_point',
          id: trk.id,
          name: trk.name,
          status: trk.status,
          startedAtIso: trk.startedAtIso,
          totalDistanceKm: trk.totalDistanceKm,
        },
      });
    }
  }

  const collection: GeoJsonFeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  return JSON.stringify(collection, null, 2);
}

/**
 * Gera resumo operacional formatado em português e link `https://wa.me/?text=...` para compartilhamento rápido.
 */
export function buildWhatsAppShareUrl(
  forecast: NormalizedForecast,
  locationName = 'Ponto de Missão',
): { text: string; url: string } {
  const h0 = forecast.hours[0];
  const windStr =
    h0?.windSpeed10m.mean !== null && h0?.windSpeed10m.mean !== undefined
      ? `${h0.windSpeed10m.mean.toFixed(1)} km/h`
      : 'N/D';
  const gustStr =
    h0?.windGusts10m.mean !== null && h0?.windGusts10m.mean !== undefined
      ? `${h0.windGusts10m.mean.toFixed(1)} km/h`
      : 'N/D';
  const waveStr =
    forecast.marineAvailable &&
    h0?.marine?.waveHeight !== null &&
    h0?.marine?.waveHeight !== undefined
      ? `${h0.marine.waveHeight.toFixed(2)} m`
      : 'Continental / Sem grade marinha';
  const semLabel =
    h0?.safeWindow === 'green'
      ? 'VERDE (Janela Segura)'
      : h0?.safeWindow === 'amber'
        ? 'AMARELO (Atenção)'
        : 'VERMELHO (Crítico)';

  const text = [
    `*FieldCast — Boletim Operacional*`,
    `Local: ${locationName} (${forecast.latitude.toFixed(4)}, ${forecast.longitude.toFixed(4)})`,
    `Altitude DEM: ${forecast.elevationDemM} m`,
    `Vento 10m: ${windStr} (Rajadas: ${gustStr})`,
    `Ondas: ${waveStr}`,
    `Confiabilidade: ${forecast.overallConfidence.total}/100 (${forecast.overallConfidence.badge.toUpperCase()})`,
    `Semáforo Operacional: ${semLabel}`,
  ].join('\n');

  return {
    text,
    url: `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}
