import type {
  HistoricalSeriesResult,
  TrackPoint,
  TrackSession,
  Waypoint,
} from '../types/field';
import type { NormalizedForecast } from '../types/weather';
import {
  findCurrentLocalHourIndex,
  formatLocalHourBadge,
  formatLocalYMD,
} from './localTimeHour';

export const UTF8_BOM = '\uFEFF';
export const EARTH_RADIUS_KM = 6371;

const CARDINAL_16_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/**
 * Converte um azimute/direção em graus para sigla cardeal de 16 pontos.
 */
export function formatCardinalDirection(deg: number | null | undefined): string {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) {
    return 'N/D';
  }
  const normalized = ((deg % 360) + 360) % 360;
  const idx = Math.round(normalized / 22.5) % 16;
  return CARDINAL_16_POINTS[idx] ?? 'N';
}

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
    if (c.windSpeed10mKmh !== null) {
      const dirSuffix =
        c.windDirection10mDeg !== null
          ? ` (${Math.round(c.windDirection10mDeg)}° ${formatCardinalDirection(c.windDirection10mDeg)})`
          : '';
      summaryParts.push(`Vento: ${c.windSpeed10mKmh.toFixed(1)} km/h${dirSuffix}`);
    } else if (c.windDirection10mDeg !== null) {
      summaryParts.push(
        `Dir. Vento: ${Math.round(c.windDirection10mDeg)}° (${formatCardinalDirection(c.windDirection10mDeg)})`,
      );
    }
    if (c.windGusts10mKmh !== null)
      summaryParts.push(`Rajada: ${c.windGusts10mKmh.toFixed(1)} km/h`);
    if (c.temperature2mC !== null) summaryParts.push(`Temp: ${c.temperature2mC.toFixed(1)} °C`);
    if (c.precipitationMm !== null) summaryParts.push(`Chuva: ${c.precipitationMm.toFixed(1)} mm`);
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
 * Gera documento KML 2.2 válido para Google Earth contendo estação de previsão,
 * Waypoints georreferenciados, Tracks GPS (`<LineString>`) e/ou série histórica horária.
 */
export function exportToKml(options: {
  waypoints?: readonly Waypoint[];
  tracks?: readonly TrackSession[];
  forecast?: NormalizedForecast | null;
  historical?: HistoricalSeriesResult | null;
  name?: string;
}): string {
  const waypoints = options.waypoints ?? [];
  const tracks = options.tracks ?? [];
  const docName = escapeXml(options.name ?? 'FieldCast Exportação Operacional');

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${docName}</name>`,
    '    <description>Exportado offline pelo FieldCast (Previsão Multi-Modelo, Oceanografia &amp; Campo).</description>',
    '    <Style id="fieldcast-station"><IconStyle><scale>1.2</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/blu-circle.png</href></Icon></IconStyle></Style>',
    '    <Style id="fieldcast-waypoint"><IconStyle><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/ylw-stars.png</href></Icon></IconStyle></Style>',
    '    <Style id="fieldcast-track"><LineStyle><color>ffeb9b00</color><width>3.5</width></LineStyle></Style>',
  ];

  if (options.forecast) {
    const f = options.forecast;
    const hIdx = findCurrentLocalHourIndex(f.hours, f.timezone);
    const h = f.hours[hIdx] ?? f.hours[0];
    const windMean = h?.windSpeed10m.mean;
    const windDir = h?.windDirection10m.degree;
    const gusts = h?.windGusts10m.mean;
    const temp = h?.temperature2mC.mean;
    const precip = h?.precipitationMm.mean;
    const precipProb = h?.precipitationProbabilityPct.mean;
    const localDate = h ? formatLocalYMD(new Date(h.timestampUnix * 1000), f.timezone) : 'N/D';
    const localHour = h ? formatLocalHourBadge(h.timestampUnix, f.timezone) : 'N/D';

    const descParts = [
      `Horário local: ${localDate} ${localHour} (${f.timezone})`,
      `Altitude DEM: ${f.elevationDemM} m`,
      `Temperatura 2m: ${temp !== null && temp !== undefined ? `${temp.toFixed(1)} °C` : 'N/D'}`,
      `Precipitação: ${precip !== null && precip !== undefined ? `${precip.toFixed(1)} mm` : 'N/D'} (${precipProb !== null && precipProb !== undefined ? `${Math.round(precipProb)}%` : 'N/D'})`,
      `Vento Médio 10m: ${windMean !== null && windMean !== undefined ? `${windMean.toFixed(1)} km/h` : 'N/D'} (${windDir !== null && windDir !== undefined ? `${Math.round(windDir)}° ${formatCardinalDirection(windDir)}` : 'N/D'}) | Rajadas 10m: ${gusts !== null && gusts !== undefined ? `${gusts.toFixed(1)} km/h` : 'N/D'}`,
      `Confiabilidade: ${f.overallConfidence.total}/100 (${f.overallConfidence.badge.toUpperCase()})`,
      `Semáforo: ${h?.safeWindow ?? 'N/D'}`,
    ];
    if (f.marineAvailable && h?.marine) {
      const mslPart =
        h.marine.seaLevelHeightMsl !== null && h.marine.seaLevelHeightMsl !== undefined
          ? ` | Nível Mar Est. (MSL ~8 km): ${h.marine.seaLevelHeightMsl.toFixed(2)} m (não substitui DHN)`
          : '';
      descParts.push(
        `Ondas: ${h.marine.waveHeight !== null ? `${h.marine.waveHeight.toFixed(2)} m` : 'N/D'}${mslPart}`,
      );
    }

    lines.push(
      '    <Placemark>',
      `      <name>${escapeXml(`Estação Previsão (${f.locationKey})`)}</name>`,
      '      <styleUrl>#fieldcast-station</styleUrl>',
      `      <description>${escapeXml(descParts.join('\n'))}</description>`,
      '      <Point>',
      `        <coordinates>${f.longitude.toFixed(6)},${f.latitude.toFixed(6)},${Math.round(f.elevationDemM)}</coordinates>`,
      '      </Point>',
      '    </Placemark>',
    );
  }

  if (waypoints.length > 0) {
    lines.push('    <Folder>', '      <name>Waypoints de Campo</name>');
    for (const wp of waypoints) {
      const c = wp.conditions;
      const wpDesc = [
        wp.note ? `Nota: ${wp.note}` : null,
        `Data UTC: ${wp.timestampUtcIso}`,
        `Vento Médio 10m: ${c.windSpeed10mKmh !== null ? `${c.windSpeed10mKmh.toFixed(1)} km/h` : 'N/D'} (${c.windDirection10mDeg !== null ? `${Math.round(c.windDirection10mDeg)}° ${formatCardinalDirection(c.windDirection10mDeg)}` : 'N/D'}) | Rajadas 10m: ${c.windGusts10mKmh !== null ? `${c.windGusts10mKmh.toFixed(1)} km/h` : 'N/D'}`,
        `Temperatura 2m: ${c.temperature2mC !== null ? `${c.temperature2mC.toFixed(1)} °C` : 'N/D'}`,
        `Precipitação: ${c.precipitationMm !== null ? `${c.precipitationMm.toFixed(1)} mm` : 'N/D'}`,
        c.waveHeightM !== null ? `Onda: ${c.waveHeightM.toFixed(2)} m` : null,
        c.safeWindow !== null ? `Semáforo: ${c.safeWindow}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join('\n');

      lines.push(
        '      <Placemark>',
        `        <name>${escapeXml(wp.name)}</name>`,
        '        <styleUrl>#fieldcast-waypoint</styleUrl>',
        `        <TimeStamp><when>${escapeXml(wp.timestampUtcIso)}</when></TimeStamp>`,
        `        <description>${escapeXml(wpDesc)}</description>`,
        '        <Point>',
        `          <coordinates>${wp.longitude.toFixed(6)},${wp.latitude.toFixed(6)},0</coordinates>`,
        '        </Point>',
        '      </Placemark>',
      );
    }
    lines.push('    </Folder>');
  }

  if (tracks.length > 0) {
    lines.push('    <Folder>', '      <name>Rotas GPS (Tracks)</name>');
    for (const trk of tracks) {
      if (trk.points.length === 0) {
        continue;
      }
      const trkDesc = [
        `Status: ${trk.status}`,
        `Distância: ${trk.totalDistanceKm.toFixed(3)} km`,
        `Pontos: ${trk.points.length}`,
        `Início: ${trk.startedAtIso}`,
        trk.endedAtIso ? `Término: ${trk.endedAtIso}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join('\n');

      if (trk.points.length >= 2) {
        const coordsText = trk.points
          .map((pt) => `${pt.longitude.toFixed(6)},${pt.latitude.toFixed(6)},0`)
          .join(' ');
        lines.push(
          '      <Placemark>',
          `        <name>${escapeXml(trk.name)}</name>`,
          '        <styleUrl>#fieldcast-track</styleUrl>',
          `        <description>${escapeXml(trkDesc)}</description>`,
          '        <LineString>',
          '          <tessellate>1</tessellate>',
          `          <coordinates>${coordsText}</coordinates>`,
          '        </LineString>',
          '      </Placemark>',
        );
      } else {
        const pt = trk.points[0]!;
        lines.push(
          '      <Placemark>',
          `        <name>${escapeXml(trk.name)}</name>`,
          `        <description>${escapeXml(trkDesc)}</description>`,
          '        <Point>',
          `          <coordinates>${pt.longitude.toFixed(6)},${pt.latitude.toFixed(6)},0</coordinates>`,
          '        </Point>',
          '      </Placemark>',
        );
      }
    }
    lines.push('    </Folder>');
  }

  if (options.historical) {
    const hist = options.historical;
    lines.push('    <Folder>', `      <name>${escapeXml(`Série Histórica — ${hist.locationName}`)}</name>`);
    lines.push(
      '      <Placemark>',
      `        <name>${escapeXml(`${hist.locationName} (${hist.startDateIso} a ${hist.endDateIso})`)}</name>`,
      '        <styleUrl>#fieldcast-station</styleUrl>',
      `        <description>${escapeXml(`Fonte: ${hist.sourceLabel}\nRegistros horários: ${hist.hours.length}\nModelos: ${hist.modelsIncluded.join(', ')}\nAltitude DEM: ${hist.elevationDemM} m`)}</description>`,
      '        <Point>',
      `          <coordinates>${hist.longitude.toFixed(6)},${hist.latitude.toFixed(6)},${Math.round(hist.elevationDemM)}</coordinates>`,
      '        </Point>',
      '      </Placemark>',
    );

    for (const hr of hist.hours) {
      const hrDesc = [
        `Fonte: ${hr.source}`,
        `Temperatura 2m: ${hr.temperature2mC !== null ? `${hr.temperature2mC.toFixed(1)} °C` : 'N/D'}`,
        `Vento Médio 10m: ${hr.windSpeed10mKmh !== null ? `${hr.windSpeed10mKmh.toFixed(1)} km/h` : 'N/D'} (${hr.windDirection10mDeg !== null ? `${Math.round(hr.windDirection10mDeg)}° ${formatCardinalDirection(hr.windDirection10mDeg)}` : 'N/D'}) | Rajadas 10m: ${hr.windGusts10mKmh !== null ? `${hr.windGusts10mKmh.toFixed(1)} km/h` : 'N/D'}`,
        `Precipitação: ${hr.precipitationMm !== null ? `${hr.precipitationMm.toFixed(2)} mm` : 'N/D'}`,
        `Pressão: ${hr.surfacePressureHpa !== null ? `${hr.surfacePressureHpa.toFixed(1)} hPa` : 'N/D'}`,
        hr.waveHeightM !== null && hr.waveHeightM !== undefined
          ? `Onda: ${hr.waveHeightM.toFixed(2)} m`
          : null,
        hr.seaLevelHeightMsl !== null && hr.seaLevelHeightMsl !== undefined
          ? `Nível Mar Est. (MSL ~8 km): ${hr.seaLevelHeightMsl.toFixed(2)} m (não substitui DHN)`
          : null,
      ]
        .filter((v): v is string => v !== null)
        .join('\n');

      lines.push(
        '      <Placemark>',
        `        <name>${escapeXml(`${hist.locationName} — ${hr.timestampIso.slice(0, 16).replace('T', ' ')}Z`)}</name>`,
        `        <TimeStamp><when>${escapeXml(hr.timestampIso)}</when></TimeStamp>`,
        `        <description>${escapeXml(hrDesc)}</description>`,
        '        <Point>',
        `          <coordinates>${hist.longitude.toFixed(6)},${hist.latitude.toFixed(6)},${Math.round(hist.elevationDemM)}</coordinates>`,
        '        </Point>',
        '      </Placemark>',
      );
    }
    lines.push('    </Folder>');
  }

  lines.push('  </Document>', '</kml>');
  return lines.join('\n');
}

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Calcula CRC-32 IEEE 802.3 sem dependências externas.
 */
export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Empacota entradas em um arquivo ZIP (PKZIP Stored / método 0) 100% em TypeScript puro.
 */
export function buildStoredZip(
  entries: ReadonlyArray<{ name: string; data: Uint8Array }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const localRecords: Array<{
    nameBytes: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }> = [];

  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = computeCrc32(entry.data);
    localRecords.push({ nameBytes, data: entry.data, crc, offset });
    offset += 30 + nameBytes.length + entry.data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const rec of localRecords) {
    centralDirSize += 46 + rec.nameBytes.length;
  }

  const totalSize = centralDirOffset + centralDirSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let cursor = 0;
  for (const rec of localRecords) {
    // Local file header signature
    view.setUint32(cursor, 0x04034b50, true);
    view.setUint16(cursor + 4, 20, true); // version needed
    view.setUint16(cursor + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(cursor + 8, 0, true); // method = 0 (stored)
    view.setUint16(cursor + 10, dosTime, true);
    view.setUint16(cursor + 12, dosDate, true);
    view.setUint32(cursor + 14, rec.crc, true);
    view.setUint32(cursor + 18, rec.data.length, true);
    view.setUint32(cursor + 22, rec.data.length, true);
    view.setUint16(cursor + 26, rec.nameBytes.length, true);
    view.setUint16(cursor + 28, 0, true); // extra field len
    out.set(rec.nameBytes, cursor + 30);
    cursor += 30 + rec.nameBytes.length;
    out.set(rec.data, cursor);
    cursor += rec.data.length;
  }

  for (const rec of localRecords) {
    // Central directory header signature
    view.setUint32(cursor, 0x02014b50, true);
    view.setUint16(cursor + 4, 20, true); // version made by
    view.setUint16(cursor + 6, 20, true); // version needed
    view.setUint16(cursor + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(cursor + 10, 0, true); // stored
    view.setUint16(cursor + 12, dosTime, true);
    view.setUint16(cursor + 14, dosDate, true);
    view.setUint32(cursor + 16, rec.crc, true);
    view.setUint32(cursor + 20, rec.data.length, true);
    view.setUint32(cursor + 24, rec.data.length, true);
    view.setUint16(cursor + 28, rec.nameBytes.length, true);
    view.setUint16(cursor + 30, 0, true); // extra len
    view.setUint16(cursor + 32, 0, true); // comment len
    view.setUint16(cursor + 34, 0, true); // disk start
    view.setUint16(cursor + 36, 0, true); // internal attrs
    view.setUint32(cursor + 38, 0, true); // external attrs
    view.setUint32(cursor + 42, rec.offset, true);
    out.set(rec.nameBytes, cursor + 46);
    cursor += 46 + rec.nameBytes.length;
  }

  // End of central directory record
  view.setUint32(cursor, 0x06054b50, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, localRecords.length, true);
  view.setUint16(cursor + 10, localRecords.length, true);
  view.setUint32(cursor + 12, centralDirSize, true);
  view.setUint32(cursor + 16, centralDirOffset, true);
  view.setUint16(cursor + 20, 0, true);

  return out;
}

/**
 * Gera arquivo KMZ válido para Google Earth (`doc.kml` compactado em PKZIP Stored sem dependências externas).
 */
export function exportToKmz(options: {
  waypoints?: readonly Waypoint[];
  tracks?: readonly TrackSession[];
  forecast?: NormalizedForecast | null;
  historical?: HistoricalSeriesResult | null;
  name?: string;
}): Uint8Array {
  const kmlText = exportToKml(options);
  const kmlBytes = new TextEncoder().encode(kmlText);
  return buildStoredZip([{ name: 'doc.kml', data: kmlBytes }]);
}

/**
 * Gera resumo operacional formatado em português e link `https://wa.me/?text=...` para compartilhamento rápido.
 * Quando `hourIndex` não é informado, resolve automaticamente a hora local atual em `forecast.timezone`.
 */
export function buildWhatsAppShareUrl(
  forecast: NormalizedForecast,
  locationName = 'Ponto de Missão',
  hourIndex?: number,
): { text: string; url: string } {
  const targetIndex =
    typeof hourIndex === 'number' && Number.isFinite(hourIndex) && forecast.hours.length > 0
      ? Math.max(0, Math.min(forecast.hours.length - 1, Math.trunc(hourIndex)))
      : findCurrentLocalHourIndex(forecast.hours, forecast.timezone);

  const h = forecast.hours[targetIndex];
  const localDateStr = h
    ? formatLocalYMD(new Date(h.timestampUnix * 1000), forecast.timezone)
    : 'N/D';
  const localHourStr = h
    ? formatLocalHourBadge(h.timestampUnix, forecast.timezone)
    : 'N/D';

  const tempStr =
    typeof h?.temperature2mC.mean === 'number' && Number.isFinite(h.temperature2mC.mean)
      ? `${h.temperature2mC.mean.toFixed(1)} °C`
      : 'N/D';

  const precipMmStr =
    typeof h?.precipitationMm.mean === 'number' && Number.isFinite(h.precipitationMm.mean)
      ? `${h.precipitationMm.mean.toFixed(1)} mm`
      : 'N/D';
  const precipProbStr =
    typeof h?.precipitationProbabilityPct.mean === 'number' &&
    Number.isFinite(h.precipitationProbabilityPct.mean)
      ? `${Math.round(h.precipitationProbabilityPct.mean)}%`
      : 'N/D';

  const windStr =
    typeof h?.windSpeed10m.mean === 'number' && Number.isFinite(h.windSpeed10m.mean)
      ? `${h.windSpeed10m.mean.toFixed(1)} km/h`
      : 'N/D';
  const dirStr =
    typeof h?.windDirection10m.degree === 'number' && Number.isFinite(h.windDirection10m.degree)
      ? `${Math.round(h.windDirection10m.degree)}° (${formatCardinalDirection(h.windDirection10m.degree)})`
      : 'N/D';
  const gustStr =
    typeof h?.windGusts10m.mean === 'number' && Number.isFinite(h.windGusts10m.mean)
      ? `${h.windGusts10m.mean.toFixed(1)} km/h`
      : 'N/D';

  let waveStr = 'Continental / Sem grade marinha';
  if (forecast.marineAvailable && h?.marine) {
    const waveHeightPart =
      typeof h.marine.waveHeight === 'number' && Number.isFinite(h.marine.waveHeight)
        ? `${h.marine.waveHeight.toFixed(2)} m`
        : 'N/D';
    const wavePeriodPart =
      typeof h.marine.wavePeriod === 'number' && Number.isFinite(h.marine.wavePeriod)
        ? `${h.marine.wavePeriod.toFixed(1)} s`
        : null;
    const waveDirPart =
      typeof h.marine.waveDirection === 'number' && Number.isFinite(h.marine.waveDirection)
        ? `${Math.round(h.marine.waveDirection)}° (${formatCardinalDirection(h.marine.waveDirection)})`
        : null;
    const mslPart =
      typeof h.marine.seaLevelHeightMsl === 'number' && Number.isFinite(h.marine.seaLevelHeightMsl)
        ? ` | Maré Est. (MSL ~8 km): ${h.marine.seaLevelHeightMsl >= 0 ? '+' : ''}${h.marine.seaLevelHeightMsl.toFixed(2)} m (não substitui DHN)`
        : '';

    waveStr = [waveHeightPart, wavePeriodPart, waveDirPart].filter(Boolean).join(' • ') + mslPart;
  }

  const semLabel =
    h?.safeWindow === 'green'
      ? 'VERDE (Janela Segura)'
      : h?.safeWindow === 'amber'
        ? 'AMARELO (Atenção)'
        : 'VERMELHO (Crítico)';

  const text = [
    `*FieldCast — Boletim Operacional*`,
    `Local: ${locationName} (${forecast.latitude.toFixed(4)}, ${forecast.longitude.toFixed(4)})`,
    `Horário Local: ${localDateStr} ${localHourStr} (${forecast.timezone})`,
    `Altitude DEM: ${forecast.elevationDemM} m`,
    `Temperatura: ${tempStr}`,
    `Precipitação: ${precipMmStr} (${precipProbStr})`,
    `Vento Médio 10m: ${windStr} (${dirStr}) | Rajadas 10m: ${gustStr}`,
    `Ondas / Maré Est.: ${waveStr}`,
    `Confiabilidade: ${forecast.overallConfidence.total}/100 (${forecast.overallConfidence.badge.toUpperCase()})`,
    `Semáforo Operacional: ${semLabel}`,
  ].join('\n');

  return {
    text,
    url: `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}
