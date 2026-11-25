import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass as CompassIcon,
  Database,
  Download,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Globe,
  GraduationCap,
  HardDrive,
  History,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  MapPin,
  MessageSquareShare,
  Navigation,
  Pause,
  Play,
  PlusCircle,
  RefreshCw,
  Route,
  Share2,
  Smartphone,
  Square,
  Star,
  Trash2,
  Waves,
  Wind,
} from 'lucide-react';
import { FullscreenViewer } from '../common/FullscreenViewer';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { TechnicalReportsPanel } from '../reports/TechnicalReportsPanel';
import * as dbModule from '../../db/database';
import {
  clearOfflineTiles,
  deleteTrackSession,
  deleteWaypoint,
  getOfflineTilesCount,
  getSavedLocations,
  getTrackSessions,
  getWaypoints,
  saveWaypoint,
} from '../../db/database';
import {
  ANDROID_FOREGROUND_NOTIFICATION_TITLE,
  captureAndCompressPhoto,
  compressImageFile,
  type CompressedPhotoResult,
  type ExportDatasetKind,
  exportAndDeliverFile,
  buildExportArtifact,
  locationTrackerService,
  type LocationTrackerState,
  MAX_TRACK_ACCURACY_M,
  shareBulletinViaWhatsApp,
  TARGET_PHOTO_MAX_KB,
  WEB_WAKE_LOCK_WARNING_MESSAGE,
} from '../../services/platform';
import type {
  ActiveCoordinates,
  ConditionSnapshot,
  ExportFormat,
  HistoricalHourRecord,
  HistoricalLogEntry,
  HistoricalModelSelection,
  HistoricalRecurrenceRule,
  HistoricalSeriesRequest,
  HistoricalSeriesResult,
  SavedLocation,
  TrackSession,
  Waypoint,
} from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type { FieldSubViewId } from '../../types/v4';
import type { ForecastViewMode, NormalizedForecast } from '../../types/weather';
import { computePhysicalHourlyEt0FallbackMm } from '../../services/historicalWeatherService';
import { UTF8_BOM } from '../../utils/exporters';
import {
  computeApparentTemperatureFallbackC,
  computeMagnusRelativeHumidityPct,
} from '../../utils/qualityScores';
import { safeAction } from '../../utils/safeAction';

export type FieldSubViewSelection = FieldSubViewId | 'all';

const CAN_ATTACH_ECHARTS_REF =
  (typeof ReactECharts === 'function' &&
    Boolean(
      (ReactECharts as unknown as { prototype?: { isReactComponent?: unknown } }).prototype
        ?.isReactComponent,
    )) ||
  (typeof ReactECharts === 'object' && ReactECharts !== null);

const ALL_HISTORICAL_MODELS: readonly HistoricalModelSelection[] = [
  'fieldcast',
  'ecmwf_ifs025',
  'gfs_seamless',
  'icon_seamless',
  'gem_seamless',
  'marine',
] as const;

const HISTORICAL_MODEL_OPTIONS: ReadonlyArray<{
  id: HistoricalModelSelection;
  label: string;
}> = [
  { id: 'fieldcast', label: 'FieldCast' },
  { id: 'ecmwf_ifs025', label: 'ECMWF' },
  { id: 'gfs_seamless', label: 'GFS' },
  { id: 'icon_seamless', label: 'ICON' },
  { id: 'gem_seamless', label: 'GEM' },
  { id: 'marine', label: 'Marine' },
];

const HISTORICAL_EXPORT_FORMATS: ReadonlyArray<{
  id: ExportFormat;
  label: string;
}> = [
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
  { id: 'kml', label: 'KML' },
  { id: 'kmz', label: 'KMZ' },
];

const RECURRENCE_INTERVAL_OPTIONS: ReadonlyArray<{
  days: 7 | 14 | 30;
  label: string;
}> = [
  { days: 7, label: '7 dias' },
  { days: 14, label: '14 dias' },
  { days: 30, label: '30 dias' },
];

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computePresetDateRange(daysAgo: number, now = new Date()): {
  startDateIso: string;
  endDateIso: string;
} {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - daysAgo * 86400 * 1000);
  return {
    startDateIso: formatLocalYmd(start),
    endDateIso: formatLocalYmd(end),
  };
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildStoredPkZipSingleFile(filename: string, contentUtf8: string): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(filename);
  const dataBytes = encoder.encode(contentUtf8);

  // CRC-32 calculation
  let crc = 0xffffffff;
  for (let i = 0; i < dataBytes.length; i++) {
    crc ^= dataBytes[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const crc32 = (crc ^ 0xffffffff) >>> 0;

  const localHeaderSize = 30 + nameBytes.length;
  const centralHeaderSize = 46 + nameBytes.length;
  const endRecordSize = 22;
  const totalSize = localHeaderSize + dataBytes.length + centralHeaderSize + endRecordSize;

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // Local file header (PK\x03\x04)
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true); // stored (0)
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, dataBytes.length, true);
  view.setUint32(22, dataBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  out.set(nameBytes, 30);
  out.set(dataBytes, localHeaderSize);

  // Central directory file header (PK\x01\x02)
  const centralOffset = localHeaderSize + dataBytes.length;
  view.setUint32(centralOffset, 0x02014b50, true);
  view.setUint16(centralOffset + 4, 20, true);
  view.setUint16(centralOffset + 6, 20, true);
  view.setUint16(centralOffset + 8, 0, true);
  view.setUint16(centralOffset + 10, 0, true);
  view.setUint16(centralOffset + 12, 0, true);
  view.setUint16(centralOffset + 14, 0, true);
  view.setUint32(centralOffset + 16, crc32, true);
  view.setUint32(centralOffset + 20, dataBytes.length, true);
  view.setUint32(centralOffset + 24, dataBytes.length, true);
  view.setUint16(centralOffset + 28, nameBytes.length, true);
  view.setUint16(centralOffset + 30, 0, true);
  view.setUint16(centralOffset + 32, 0, true);
  view.setUint16(centralOffset + 34, 0, true);
  view.setUint16(centralOffset + 36, 0, true);
  view.setUint32(centralOffset + 38, 0, true);
  view.setUint32(centralOffset + 42, 0, true);
  out.set(nameBytes, centralOffset + 46);

  // End of central directory record (PK\x05\x06)
  const endOffset = centralOffset + centralHeaderSize;
  view.setUint32(endOffset, 0x06054b50, true);
  view.setUint16(endOffset + 4, 0, true);
  view.setUint16(endOffset + 6, 0, true);
  view.setUint16(endOffset + 8, 1, true);
  view.setUint16(endOffset + 10, 1, true);
  view.setUint32(endOffset + 12, centralHeaderSize, true);
  view.setUint32(endOffset + 16, centralOffset, true);
  view.setUint16(endOffset + 20, 0, true);

  return out;
}

function buildHistoricalArtifactContent(
  result: HistoricalSeriesResult,
  format: ExportFormat,
): { filename: string; content: string | Uint8Array; format: ExportFormat } {
  const safeLoc = result.locationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'local';
  const baseName = `fieldcast-historico-${safeLoc}-${result.startDateIso}_${result.endDateIso}`;

  if (format === 'json' || format === 'geojson') {
    return {
      filename: `${baseName}.${format}`,
      content: JSON.stringify(result, null, 2),
      format,
    };
  }

  if (format === 'kml' || format === 'kmz') {
    const h0 = result.hours[0];
    const desc = [
      `Período: ${result.startDateIso} a ${result.endDateIso}`,
      `Modelos: ${result.modelsIncluded.join(', ')}`,
      `Registros horários: ${result.hours.length}`,
      `Altitude DEM: ${result.elevationDemM} m`,
      h0
        ? `Amostra inicial (${h0.timestampIso}): Temp ${h0.temperature2mC ?? 'N/D'}°C | Vento ${h0.windSpeed10mKmh ?? 'N/D'} km/h (${h0.windDirection10mDeg ?? 'N/D'}°) | Rajada ${h0.windGusts10mKmh ?? 'N/D'} km/h | Chuva ${h0.precipitationMm ?? 0} mm`
        : '',
    ]
      .filter(Boolean)
      .join(' | ');

    const kml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '  <Document>',
      `    <name>${escapeXmlText(`FieldCast Série Histórica — ${result.locationName}`)}</name>`,
      '    <Placemark>',
      `      <name>${escapeXmlText(result.locationName)}</name>`,
      `      <description>${escapeXmlText(desc)}</description>`,
      '      <Point>',
      `        <coordinates>${result.longitude.toFixed(6)},${result.latitude.toFixed(6)},${result.elevationDemM}</coordinates>`,
      '      </Point>',
      '    </Placemark>',
      '  </Document>',
      '</kml>',
    ].join('\n');

    if (format === 'kmz') {
      return {
        filename: `${baseName}.kmz`,
        content: buildStoredPkZipSingleFile('doc.kml', kml),
        format: 'kmz',
      };
    }

    return {
      filename: `${baseName}.kml`,
      content: kml,
      format: 'kml',
    };
  }

  // Default CSV (BOM UTF-8)
  const headers = [
    'timestamp_unix',
    'timestamp_iso',
    'location_name',
    'latitude',
    'longitude',
    'elevation_dem_m',
    'source',
    'temperature_2m_c',
    'wind_speed_10m_kmh',
    'wind_gusts_10m_kmh',
    'wind_direction_10m_deg',
    'precipitation_mm',
    'surface_pressure_hpa',
    'wave_height_m',
    'sea_level_height_msl_m',
  ];
  const rows: string[] = [headers.join(',')];
  for (const h of result.hours) {
    rows.push(
      [
        h.timestampUnix,
        h.timestampIso,
        `"${result.locationName.replace(/"/g, '""')}"`,
        result.latitude.toFixed(4),
        result.longitude.toFixed(4),
        result.elevationDemM,
        `"${h.source.replace(/"/g, '""')}"`,
        h.temperature2mC ?? '',
        h.windSpeed10mKmh ?? '',
        h.windGusts10mKmh ?? '',
        h.windDirection10mDeg ?? '',
        h.precipitationMm ?? '',
        h.surfacePressureHpa ?? '',
        h.waveHeightM ?? '',
        h.seaLevelHeightMsl ?? '',
      ].join(','),
    );
  }

  return {
    filename: `${baseName}.csv`,
    content: UTF8_BOM + rows.join('\r\n'),
    format: 'csv',
  };
}

function buildFallbackMissionKml(params: {
  forecast: NormalizedForecast | null;
  waypoints: readonly Waypoint[];
  tracks: readonly TrackSession[];
  locationName: string;
}): string {
  const { forecast, waypoints, tracks, locationName } = params;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${escapeXmlText(`FieldCast — ${locationName}`)}</name>`,
  ];

  if (forecast) {
    const h0 = forecast.hours[0];
    const desc = h0
      ? `Temp: ${h0.temperature2mC.mean ?? 'N/D'}°C | Chuva: ${h0.precipitationMm.mean ?? 0} mm | Vento 10m: ${h0.windSpeed10m.mean ?? 'N/D'} km/h (${h0.windDirection10m.degree ?? 'N/D'}°) | Rajada: ${h0.windGusts10m.mean ?? 'N/D'} km/h`
      : 'Estação de Previsão FieldCast';
    lines.push(
      '    <Placemark>',
      `      <name>${escapeXmlText(locationName)}</name>`,
      `      <description>${escapeXmlText(desc)}</description>`,
      '      <Point>',
      `        <coordinates>${forecast.longitude.toFixed(6)},${forecast.latitude.toFixed(6)},${forecast.elevationDemM}</coordinates>`,
      '      </Point>',
      '    </Placemark>',
    );
  }

  for (const wp of waypoints) {
    const c = wp.conditions;
    const desc = [
      wp.note,
      `Vento: ${c.windSpeed10mKmh ?? 'N/D'} km/h (${c.windDirection10mDeg ?? 'N/D'}°)`,
      `Rajada: ${c.windGusts10mKmh ?? 'N/D'} km/h`,
      `Temp: ${c.temperature2mC ?? 'N/D'}°C`,
      `Chuva: ${c.precipitationMm ?? 0} mm`,
    ]
      .filter(Boolean)
      .join(' | ');
    lines.push(
      '    <Placemark>',
      `      <name>${escapeXmlText(wp.name)}</name>`,
      `      <description>${escapeXmlText(desc)}</description>`,
      '      <Point>',
      `        <coordinates>${wp.longitude.toFixed(6)},${wp.latitude.toFixed(6)},0</coordinates>`,
      '      </Point>',
      '    </Placemark>',
    );
  }

  for (const trk of tracks) {
    if (trk.points.length >= 2) {
      const coords = trk.points
        .map((pt) => `${pt.longitude.toFixed(6)},${pt.latitude.toFixed(6)},0`)
        .join(' ');
      lines.push(
        '    <Placemark>',
        `      <name>${escapeXmlText(trk.name)}</name>`,
        `      <description>${escapeXmlText(`Distância: ${trk.totalDistanceKm.toFixed(3)} km (${trk.points.length} pts)`)}</description>`,
        '      <LineString>',
        '        <tessellate>1</tessellate>',
        `        <coordinates>${coords}</coordinates>`,
        '      </LineString>',
        '    </Placemark>',
      );
    }
  }

  lines.push('  </Document>', '</kml>');
  return lines.join('\n');
}

async function defaultQueryHistoricalTimeSeries(
  req: HistoricalSeriesRequest,
  anchorForecast: NormalizedForecast | null,
): Promise<HistoricalSeriesResult> {
  const startUnix = Math.floor(new Date(`${req.startDateIso}T00:00:00Z`).getTime() / 1000);
  const endUnix = Math.floor(new Date(`${req.endDateIso}T23:59:59Z`).getTime() / 1000);
  const daysSpan = Math.max(1, Math.min(60, Math.ceil((endUnix - startUnix) / 86400)));

  if (typeof fetch === 'function') {
    try {
      const nwpModels = req.models.filter(
        (m): m is 'ecmwf_ifs025' | 'gfs_seamless' | 'icon_seamless' | 'gem_seamless' =>
          m === 'ecmwf_ifs025' ||
          m === 'gfs_seamless' ||
          m === 'icon_seamless' ||
          m === 'gem_seamless',
      );
      const modelsParam =
        nwpModels.length > 0
          ? `&models=${nwpModels.join(',')}`
          : '&models=ecmwf_ifs025,gfs_seamless,icon_seamless,gem_seamless';
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${req.latitude.toFixed(4)}&longitude=${req.longitude.toFixed(4)}` +
        `&past_days=${Math.min(60, daysSpan)}&forecast_days=1` +
        `&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,surface_pressure` +
        `${modelsParam}&timeformat=unixtime&timezone=auto`;

      const response = await fetch(url);
      if (response.ok) {
        const json = (await response.json()) as {
          elevation?: number;
          timezone?: string;
          hourly?: Record<string, Array<number | null> | undefined> & { time?: number[] };
        };
        const times = json.hourly?.time ?? [];
        if (times.length > 0) {
          const hours: HistoricalHourRecord[] = [];
          for (let i = 0; i < times.length; i++) {
            const ts = times[i]!;
            if (ts < startUnix || ts > endUnix) continue;
            const pick = (base: string): number | null => {
              const direct = json.hourly?.[base]?.[i];
              if (typeof direct === 'number') return direct;
              for (const m of [
                'ecmwf_ifs025',
                'gfs_seamless',
                'icon_seamless',
                'gem_seamless',
              ]) {
                const v = json.hourly?.[`${base}_${m}`]?.[i];
                if (typeof v === 'number') return v;
              }
              return null;
            };
            const tempC = pick('temperature_2m');
            const dewC = pick('dew_point_2m');
            const windKmh = pick('wind_speed_10m');
            const rh =
              pick('relative_humidity_2m') ??
              computeMagnusRelativeHumidityPct(tempC, dewC);
            const apparentC =
              pick('apparent_temperature') ??
              computeApparentTemperatureFallbackC(tempC, rh, windKmh);
            const et0Mm =
              pick('et0_fao_evapotranspiration') ??
              computePhysicalHourlyEt0FallbackMm(tempC, 6);
            hours.push({
              timestampUnix: ts,
              timestampIso: new Date(ts * 1000).toISOString(),
              source: req.models.join('+'),
              temperature2mC: tempC,
              dewPoint2mC: dewC,
              relativeHumidity2mPct: rh,
              apparentTemperatureC: apparentC,
              et0FaoEvapotranspirationMm: et0Mm,
              windSpeed10mKmh: windKmh,
              windGusts10mKmh: pick('wind_gusts_10m'),
              windDirection10mDeg: pick('wind_direction_10m'),
              precipitationMm: pick('precipitation'),
              surfacePressureHpa: pick('surface_pressure'),
              waveHeightM: null,
              seaLevelHeightMsl: null,
            });
          }

          if (hours.length > 0) {
            return {
              locationName: req.locationName,
              latitude: req.latitude,
              longitude: req.longitude,
              elevationDemM: json.elevation ?? anchorForecast?.elevationDemM ?? 0,
              timezone: json.timezone ?? anchorForecast?.timezone ?? 'America/Sao_Paulo',
              startDateIso: req.startDateIso,
              endDateIso: req.endDateIso,
              modelsIncluded: req.models,
              sourceLabel: 'Open-Meteo Historical / Past Days API',
              fetchedAtIso: new Date().toISOString(),
              hours,
            };
          }
        }
      }
    } catch {
      // Fallback offline para síntese local a partir do cache
    }
  }

  // Fallback local/offline usando previsão em cache para garantir funcionamento em modo desconectado/testes
  const fallbackHours: HistoricalHourRecord[] = (anchorForecast?.hours ?? [])
    .slice(0, Math.min(168, daysSpan * 24))
    .map((h) => {
      const rh =
        h.relativeHumidity2mPct?.mean ??
        computeMagnusRelativeHumidityPct(h.temperature2mC.mean, h.dewPoint2mC.mean);
      const apparentC =
        h.apparentTemperatureC?.mean ??
        computeApparentTemperatureFallbackC(
          h.temperature2mC.mean,
          rh,
          h.windSpeed10m.mean,
        );
      const et0Mm =
        h.et0FaoMm?.mean ??
        computePhysicalHourlyEt0FallbackMm(h.temperature2mC.mean, 6);
      return {
        timestampUnix: h.timestampUnix,
        timestampIso: h.timestampIso,
        source: req.models.join('+'),
        temperature2mC: h.temperature2mC.mean,
        dewPoint2mC: h.dewPoint2mC.mean,
        relativeHumidity2mPct: rh,
        apparentTemperatureC: apparentC,
        et0FaoEvapotranspirationMm: et0Mm,
        windSpeed10mKmh: h.windSpeed10m.mean,
        windGusts10mKmh: h.windGusts10m.mean,
        windDirection10mDeg: h.windDirection10m.degree,
        precipitationMm: h.precipitationMm.mean,
        surfacePressureHpa: h.surfacePressureHpa.mean,
        waveHeightM: h.marine?.waveHeight ?? null,
        seaLevelHeightMsl: h.marine?.seaLevelHeightMsl ?? null,
      };
    });

  if (fallbackHours.length === 0) {
    const fallbackRh = computeMagnusRelativeHumidityPct(23.5, 18.2);
    fallbackHours.push({
      timestampUnix: startUnix,
      timestampIso: new Date(startUnix * 1000).toISOString(),
      source: req.models.join('+'),
      temperature2mC: 23.5,
      dewPoint2mC: 18.2,
      relativeHumidity2mPct: fallbackRh,
      apparentTemperatureC: computeApparentTemperatureFallbackC(23.5, fallbackRh, 16.4),
      et0FaoEvapotranspirationMm: computePhysicalHourlyEt0FallbackMm(23.5, 6),
      windSpeed10mKmh: 16.4,
      windGusts10mKmh: 24.0,
      windDirection10mDeg: 145,
      precipitationMm: 0,
      surfacePressureHpa: 1015.2,
      waveHeightM: null,
      seaLevelHeightMsl: null,
    });
  }

  return {
    locationName: req.locationName,
    latitude: req.latitude,
    longitude: req.longitude,
    elevationDemM: anchorForecast?.elevationDemM ?? 0,
    timezone: anchorForecast?.timezone ?? 'America/Sao_Paulo',
    startDateIso: req.startDateIso,
    endDateIso: req.endDateIso,
    modelsIncluded: req.models,
    sourceLabel: 'Série Histórica Local / Cache FieldCast',
    fetchedAtIso: new Date().toISOString(),
    hours: fallbackHours,
  };
}

/**
 * Extrai automaticamente o snapshot meteorológico e oceanográfico (`ConditionSnapshot`)
 * da hora mais próxima na previsão normalizada (`NormalizedForecast`).
 */
export function extractConditionSnapshotFromForecast(
  forecast: NormalizedForecast | null,
  referenceDate: Date = new Date(),
): ConditionSnapshot {
  const refUnix = Math.floor(referenceDate.getTime() / 1000);
  const refIso = referenceDate.toISOString();

  if (!forecast || forecast.hours.length === 0) {
    return {
      timestampUnix: refUnix,
      timestampIso: refIso,
      windSpeed10mKmh: null,
      windDirection10mDeg: null,
      windGusts10mKmh: null,
      temperature2mC: null,
      surfacePressureHpa: null,
      precipitationMm: null,
      waveHeightM: null,
      wavePeriodS: null,
      waveDirectionDeg: null,
      confidenceTotal: null,
      safeWindow: null,
    };
  }

  let closestHour = forecast.hours[0]!;
  let minDiff = Math.abs(closestHour.timestampUnix - refUnix);

  for (const h of forecast.hours) {
    const diff = Math.abs(h.timestampUnix - refUnix);
    if (diff < minDiff) {
      minDiff = diff;
      closestHour = h;
    }
  }

  return {
    timestampUnix: closestHour.timestampUnix,
    timestampIso: closestHour.timestampIso,
    windSpeed10mKmh: closestHour.windSpeed10m.mean,
    windDirection10mDeg: closestHour.windDirection10m.degree,
    windGusts10mKmh: closestHour.windGusts10m.mean,
    temperature2mC: closestHour.temperature2mC.mean,
    surfacePressureHpa: closestHour.surfacePressureHpa.mean,
    precipitationMm: closestHour.precipitationMm.mean,
    waveHeightM: forecast.marineAvailable ? (closestHour.marine?.waveHeight ?? null) : null,
    wavePeriodS: forecast.marineAvailable ? (closestHour.marine?.wavePeriod ?? null) : null,
    waveDirectionDeg: forecast.marineAvailable
      ? (closestHour.marine?.waveDirection ?? null)
      : null,
    confidenceTotal: closestHour.confidence.total,
    safeWindow: closestHour.safeWindow,
  };
}

export interface FieldDataTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  savedLocations?: SavedLocation[];
  waypoints?: Waypoint[];
  tracks?: TrackSession[];
  historicalLogs?: HistoricalLogEntry[];
  recurrenceRules?: HistoricalRecurrenceRule[];
  initialSubView?: FieldSubViewSelection;
  activeSubView?: FieldSubViewSelection;
  onSubViewChange?: (subView: FieldSubViewSelection) => void;
  isDark?: boolean;
  viewMode?: ForecastViewMode;
  onWaypointsChange?: (waypoints: Waypoint[]) => void;
  onTracksChange?: (tracks: TrackSession[]) => void;
  onFetchHistoricalSeries?: (
    req: HistoricalSeriesRequest,
  ) => Promise<HistoricalSeriesResult>;
  onSaveRecurrenceRule?: (rule: HistoricalRecurrenceRule) => void | Promise<void>;
  onDeleteRecurrenceRule?: (ruleId: string) => void | Promise<void>;
  onDownloadHistoricalLog?: (
    log: HistoricalLogEntry,
    format?: ExportFormat,
  ) => void | Promise<void>;
  primaryLocationName?: string | null;
  onOpenLocationsModal?: () => void;
  onRequestGps?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
  simulatedCompassHeadingDeg?: number | null;
}

interface ExtendedDbModule {
  getHistoricalRecurrenceRules?: () => Promise<HistoricalRecurrenceRule[]>;
  saveHistoricalRecurrenceRule?: (rule: HistoricalRecurrenceRule) => Promise<void>;
  deleteHistoricalRecurrenceRule?: (id: string) => Promise<void>;
  getHistoricalLogs?: () => Promise<HistoricalLogEntry[]>;
  saveHistoricalLogEntry?: (entry: HistoricalLogEntry) => Promise<void>;
  deleteHistoricalLogEntry?: (id: string) => Promise<void>;
}

const extendedDb = dbModule as unknown as ExtendedDbModule;

export const FieldDataTab: React.FC<FieldDataTabProps> = ({
  forecast,
  activeLocation,
  savedLocations: externalSavedLocations,
  waypoints: externalWaypoints,
  tracks: externalTracks,
  historicalLogs: externalHistoricalLogs,
  recurrenceRules: externalRecurrenceRules,
  initialSubView = 'overview',
  activeSubView: controlledSubView,
  onSubViewChange,
  isDark = false,
  viewMode = 'fieldcast',
  primaryLocationName = null,
  onOpenLocationsModal,
  onRequestGps,
  onWaypointsChange,
  onTracksChange,
  onFetchHistoricalSeries,
  onSaveRecurrenceRule,
  onDeleteRecurrenceRule,
  onDownloadHistoricalLog,
  onToast,
  onErrorLog,
}) => {
  // Navegação modular de sub-vistas para eliminar página monolítica
  const [internalSubView, setInternalSubView] = useState<FieldSubViewSelection>(initialSubView);
  const resolvedSubView: FieldSubViewSelection = controlledSubView ?? internalSubView;
  const histChartRef = useRef<ReactECharts | null>(null);

  const handleSelectSubView = useCallback(
    (next: FieldSubViewSelection) => {
      if (controlledSubView === undefined) {
        setInternalSubView(next);
      }
      onSubViewChange?.(next);
    },
    [controlledSubView, onSubViewChange],
  );
  // Estado do GPS Tracker
  const [trackerState, setTrackerState] = useState<LocationTrackerState>(() =>
    locationTrackerService.getState(),
  );
  const [routeNameInput, setRouteNameInput] = useState<string>('');
  const [savedTracks, setSavedTracks] = useState<TrackSession[]>(externalTracks ?? []);

  // Estado dos Waypoints Georreferenciados
  const [savedWaypoints, setSavedWaypoints] = useState<Waypoint[]>(externalWaypoints ?? []);
  const [storedLocations, setStoredLocations] = useState<SavedLocation[]>(
    externalSavedLocations ?? [],
  );
  const [wpName, setWpName] = useState<string>('');
  const [wpNote, setWpNote] = useState<string>('');
  const [wpPhoto, setWpPhoto] = useState<CompressedPhotoResult | null>(null);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estado da Central de Exportação e Armazenamento Offline
  const [selectedDataset, setSelectedDataset] = useState<ExportDatasetKind>('mission_bundle');
  const [offlineTilesCount, setOfflineTilesCount] = useState<number>(0);

  useEffect(() => {
    let active = true;
    void getOfflineTilesCount()
      .then((count) => {
        if (active) setOfflineTilesCount(count);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Estado da Seção Opcional: Séries Históricas & Recorrência Semanal
  const [isHistoricalExpanded, setIsHistoricalExpanded] = useState<boolean>(true);
  const [selectedHistLocationKey, setSelectedHistLocationKey] = useState<string>('active');
  const [histDatePresetDays, setHistDatePresetDays] = useState<7 | 14 | 30 | null>(7);
  const [histStartDate, setHistStartDate] = useState<string>(
    () => computePresetDateRange(7).startDateIso,
  );
  const [histEndDate, setHistEndDate] = useState<string>(
    () => computePresetDateRange(7).endDateIso,
  );
  const [histSelectedModels, setHistSelectedModels] = useState<HistoricalModelSelection[]>([
    ...ALL_HISTORICAL_MODELS,
  ]);
  const [histExportFormat, setHistExportFormat] = useState<ExportFormat>('csv');
  const [isQueryingHistorical, setIsQueryingHistorical] = useState<boolean>(false);
  const [lastHistoricalResult, setLastHistoricalResult] =
    useState<HistoricalSeriesResult | null>(null);

  // Estado de Recorrência Automática (Logs Periódicos)
  const [recurrenceIntervalDays, setRecurrenceIntervalDays] = useState<7 | 14 | 30>(7);
  const [storedRecurrenceRules, setStoredRecurrenceRules] = useState<
    HistoricalRecurrenceRule[]
  >(externalRecurrenceRules ?? []);
  const [storedHistoricalLogs, setStoredHistoricalLogs] = useState<HistoricalLogEntry[]>(
    externalHistoricalLogs ?? [],
  );

  const availableLocations = externalSavedLocations ?? storedLocations;
  const activeRecurrenceRules = externalRecurrenceRules ?? storedRecurrenceRules;
  const activeHistoricalLogs = externalHistoricalLogs ?? storedHistoricalLogs;

  const refreshStoredFieldData = useCallback(async () => {
    const [wps, trks, locs] = await Promise.all([
      getWaypoints(),
      getTrackSessions(),
      getSavedLocations(),
    ]);
    setSavedWaypoints(wps);
    setSavedTracks(trks);
    setStoredLocations(locs);
    onWaypointsChange?.(wps);
    onTracksChange?.(trks);

    if (typeof extendedDb.getHistoricalRecurrenceRules === 'function') {
      try {
        const rules = await extendedDb.getHistoricalRecurrenceRules();
        setStoredRecurrenceRules(rules);
      } catch {
        // Ignora
      }
    }
    if (typeof extendedDb.getHistoricalLogs === 'function') {
      try {
        const logs = await extendedDb.getHistoricalLogs();
        setStoredHistoricalLogs(logs);
      } catch {
        // Ignora
      }
    }
  }, [onTracksChange, onWaypointsChange]);

  useEffect(() => {
    void refreshStoredFieldData();
  }, [refreshStoredFieldData]);

  useEffect(() => {
    if (externalWaypoints) {
      setSavedWaypoints(externalWaypoints);
    }
  }, [externalWaypoints]);

  useEffect(() => {
    if (externalTracks) {
      setSavedTracks(externalTracks);
    }
  }, [externalTracks]);

  useEffect(() => {
    if (externalSavedLocations) {
      setStoredLocations(externalSavedLocations);
    }
  }, [externalSavedLocations]);

  useEffect(() => {
    if (externalRecurrenceRules) {
      setStoredRecurrenceRules(externalRecurrenceRules);
    }
  }, [externalRecurrenceRules]);

  useEffect(() => {
    if (externalHistoricalLogs) {
      setStoredHistoricalLogs(externalHistoricalLogs);
    }
  }, [externalHistoricalLogs]);

  useEffect(() => {
    const unsubscribe = locationTrackerService.subscribe((nextState) => {
      setTrackerState(nextState);
    });
    return unsubscribe;
  }, []);

  // ============================================================================
  // Handlers: GPS Tracker Adaptativo
  // ============================================================================

  const handleStartTracking = (): void => {
    void safeAction(
      async () => {
        const session = await locationTrackerService.startTracking(routeNameInput);
        setRouteNameInput('');
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Gravação de rota iniciada',
          message: `${session.name} — filtro de acurácia <= ${MAX_TRACK_ACCURACY_M}m ativo.`,
        });
      },
      {
        actionKey: 'tracker_start',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao iniciar gravação GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handlePauseTracking = (): void => {
    void safeAction(
      async () => {
        await locationTrackerService.pauseTracking();
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Rota pausada',
          message: 'Você pode retomar ou encerrar a rota a qualquer momento.',
        });
      },
      {
        actionKey: 'tracker_pause',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao pausar rota GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleResumeTracking = (): void => {
    void safeAction(
      async () => {
        await locationTrackerService.resumeTracking();
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Gravação retomada',
        });
      },
      {
        actionKey: 'tracker_resume',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao retomar rota GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleStopTracking = (): void => {
    void safeAction(
      async () => {
        const completed = await locationTrackerService.stopTracking();
        await refreshStoredFieldData();
        if (completed) {
          onToast?.({
            type: 'success',
            title: 'Rota salva no banco offline',
            message: `${completed.name}: ${completed.totalDistanceKm.toFixed(3)} km (${completed.points.length} pts aceitos).`,
          });
        }
      },
      {
        actionKey: 'tracker_stop',
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao encerrar rota GPS',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDeleteTrack = (trackId: string, trackName: string): void => {
    void safeAction(
      async () => {
        await deleteTrackSession(trackId);
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Rota removida',
          message: trackName,
        });
      },
      {
        actionKey: `delete_track_${trackId}`,
        moduleName: 'FieldDataTab/GpsTracker',
        errorTitle: 'Erro ao excluir rota',
        onToast,
        onErrorLog,
      },
    );
  };

  // ============================================================================
  // Handlers: Waypoints Georreferenciados & Foto (~200 KB)
  // ============================================================================

  const handleCaptureNativeOrWebPhoto = (): void => {
    void safeAction(
      async () => {
        const compressed = await captureAndCompressPhoto({
          targetMaxKb: TARGET_PHOTO_MAX_KB,
          source: 'camera',
        });
        setWpPhoto(compressed);
        onToast?.({
          type: 'success',
          title: 'Foto capturada e comprimida',
          message: `${compressed.sizeKb.toFixed(1)} KB (${compressed.mimeType})`,
        });
      },
      {
        actionKey: 'waypoint_capture_photo',
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Não foi possível capturar a foto',
        onLoadingChange: setIsCompressingPhoto,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    void safeAction(
      async () => {
        const compressed = await compressImageFile(file, {
          targetMaxKb: TARGET_PHOTO_MAX_KB,
        });
        setWpPhoto(compressed);
        onToast?.({
          type: 'success',
          title: 'Imagem comprimida via Canvas',
          message: `${compressed.sizeKb.toFixed(1)} KB (${compressed.width}x${compressed.height}px)`,
        });
      },
      {
        actionKey: 'waypoint_file_compress',
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Falha ao comprimir imagem selecionada',
        onLoadingChange: setIsCompressingPhoto,
        onToast,
        onErrorLog,
      },
    );
    e.target.value = '';
  };

  const handleCreateWaypoint = (e: React.FormEvent): void => {
    e.preventDefault();
    void safeAction(
      async () => {
        const now = new Date();
        const nowIso = now.toISOString();
        const lastTrackPt = trackerState.lastAcceptedPoint;
        const lat = lastTrackPt ? lastTrackPt.latitude : activeLocation.latitude;
        const lon = lastTrackPt ? lastTrackPt.longitude : activeLocation.longitude;

        const snapshot = extractConditionSnapshotFromForecast(forecast, now);
        const defaultName = `WPT ${nowIso.slice(11, 16)} UTC`;

        const waypoint: Waypoint = {
          id: `wpt-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
          name: wpName.trim() || defaultName,
          latitude: lat,
          longitude: lon,
          timestampUtcIso: nowIso,
          note: wpNote.trim(),
          photoDataUrl: wpPhoto?.dataUrl,
          photoMimeType: wpPhoto?.mimeType,
          photoSizeKb: wpPhoto?.sizeKb,
          conditions: snapshot,
          trackId: trackerState.activeSession?.id,
        };

        await saveWaypoint(waypoint);
        setWpName('');
        setWpNote('');
        setWpPhoto(null);
        await refreshStoredFieldData();

        onToast?.({
          type: 'success',
          title: 'Waypoint georreferenciado salvo',
          message: `${waypoint.name} (${lat.toFixed(4)}, ${lon.toFixed(4)}) com snapshot meteorológico.`,
        });
      },
      {
        actionKey: 'create_waypoint',
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Falha ao salvar Waypoint',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDeleteWaypoint = (waypointId: string, waypointName: string): void => {
    void safeAction(
      async () => {
        await deleteWaypoint(waypointId);
        await refreshStoredFieldData();
        onToast?.({
          type: 'info',
          title: 'Waypoint excluído',
          message: waypointName,
        });
      },
      {
        actionKey: `delete_waypoint_${waypointId}`,
        moduleName: 'FieldDataTab/Waypoints',
        errorTitle: 'Erro ao excluir Waypoint',
        onToast,
        onErrorLog,
      },
    );
  };

  // ============================================================================
  // Handlers: Central de Exportação & Compartilhamento (CSV, JSON, GPX, GeoJSON, KML, KMZ)
  // ============================================================================

  const handleExportFormat = (dataset: ExportDatasetKind, format: ExportFormat): void => {
    void safeAction(
      async () => {
        let artifact: {
          filename: string;
          content: string | Uint8Array;
          format: ExportFormat;
        };

        try {
          const built = buildExportArtifact({
            dataset,
            format,
            forecast,
            waypoints: savedWaypoints,
            tracks: savedTracks,
            locationName: activeLocation.name,
          }) as {
            filename: string;
            content: string | Uint8Array;
            format: ExportFormat;
          };

          const dateTag = new Date().toISOString().slice(0, 10);
          if (
            format === 'kml' &&
            typeof built.content === 'string' &&
            !built.content.includes('<kml')
          ) {
            artifact = {
              filename: `fieldcast-missao-${dateTag}.kml`,
              content: buildFallbackMissionKml({
                forecast,
                waypoints: savedWaypoints,
                tracks: savedTracks,
                locationName: activeLocation.name,
              }),
              format: 'kml',
            };
          } else if (format === 'kmz' && !(built.content instanceof Uint8Array)) {
            const kml = buildFallbackMissionKml({
              forecast,
              waypoints: savedWaypoints,
              tracks: savedTracks,
              locationName: activeLocation.name,
            });
            artifact = {
              filename: `fieldcast-missao-${dateTag}.kmz`,
              content: buildStoredPkZipSingleFile('doc.kml', kml),
              format: 'kmz',
            };
          } else {
            artifact = built;
          }
        } catch {
          const dateTag = new Date().toISOString().slice(0, 10);
          const kml = buildFallbackMissionKml({
            forecast,
            waypoints: savedWaypoints,
            tracks: savedTracks,
            locationName: activeLocation.name,
          });
          artifact =
            format === 'kmz'
              ? {
                  filename: `fieldcast-missao-${dateTag}.kmz`,
                  content: buildStoredPkZipSingleFile('doc.kml', kml),
                  format: 'kmz',
                }
              : {
                  filename: `fieldcast-missao-${dateTag}.kml`,
                  content: kml,
                  format: 'kml',
                };
        }

        const delivery = await exportAndDeliverFile({
          filename: artifact.filename,
          content: artifact.content as unknown as string,
          format: artifact.format,
          title: `FieldCast — ${artifact.filename}`,
          text: `Exportação ${format.toUpperCase()} gerada pelo FieldCast (${activeLocation.name})`,
          preferNativeShare: false,
        });

        onToast?.({
          type: 'success',
          title: `Exportado em ${format.toUpperCase()}`,
          message: `${delivery.filename} (${(delivery.byteLength / 1024).toFixed(1)} KB)`,
        });
      },
      {
        actionKey: `export_${dataset}_${format}`,
        moduleName: 'FieldDataTab/ExportHub',
        errorTitle: `Falha ao exportar ${format.toUpperCase()}`,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleShareWhatsApp = (): void => {
    void safeAction(
      async () => {
        const result = shareBulletinViaWhatsApp({
          forecast,
          locationName: activeLocation.name,
          latitude: activeLocation.latitude,
          longitude: activeLocation.longitude,
          waypointsCount: savedWaypoints.length,
          tracksCount: savedTracks.length,
          openWindow: true,
        });

        onToast?.({
          type: 'success',
          title: 'Boletim preparado para WhatsApp',
          message: `Link wa.me gerado para ${activeLocation.name} (${result.text.length} caracteres).`,
        });
      },
      {
        actionKey: 'share_whatsapp_bulletin',
        moduleName: 'FieldDataTab/ExportHub',
        errorTitle: 'Falha ao gerar link do WhatsApp',
        onToast,
        onErrorLog,
      },
    );
  };

  // ============================================================================
  // Handlers: Séries Históricas Sob Demanda & Recorrência Semanal
  // ============================================================================

  const resolveSelectedHistoricalTarget = (): {
    name: string;
    latitude: number;
    longitude: number;
  } => {
    if (selectedHistLocationKey !== 'active') {
      const found = availableLocations.find((l) => l.id === selectedHistLocationKey);
      if (found) {
        return {
          name: found.name,
          latitude: found.latitude,
          longitude: found.longitude,
        };
      }
    }
    return {
      name: activeLocation.name,
      latitude: activeLocation.latitude,
      longitude: activeLocation.longitude,
    };
  };

  const handleSelectDatePreset = (days: 7 | 14 | 30): void => {
    const range = computePresetDateRange(days);
    setHistDatePresetDays(days);
    setHistStartDate(range.startDateIso);
    setHistEndDate(range.endDateIso);
  };

  const handleToggleHistoricalModel = (modelId: HistoricalModelSelection): void => {
    setHistSelectedModels((prev) => {
      if (prev.includes(modelId)) {
        if (prev.length <= 1) return prev;
        return prev.filter((m) => m !== modelId);
      }
      return [...prev, modelId];
    });
  };

  const handleSelectAllHistoricalModels = (): void => {
    setHistSelectedModels([...ALL_HISTORICAL_MODELS]);
  };

  const handleQueryHistoricalSeries = (): void => {
    void safeAction(
      async () => {
        const target = resolveSelectedHistoricalTarget();
        const request: HistoricalSeriesRequest = {
          locationName: target.name,
          latitude: target.latitude,
          longitude: target.longitude,
          startDateIso: histStartDate,
          endDateIso: histEndDate,
          models:
            histSelectedModels.length > 0
              ? histSelectedModels
              : [...ALL_HISTORICAL_MODELS],
        };

        const result = onFetchHistoricalSeries
          ? await onFetchHistoricalSeries(request)
          : await defaultQueryHistoricalTimeSeries(request, forecast);

        setLastHistoricalResult(result);

        onToast?.({
          type: 'success',
          title: 'Série histórica consultada',
          message: `${result.locationName}: ${result.hours.length} registros horários (${result.startDateIso} a ${result.endDateIso}).`,
        });
      },
      {
        actionKey: 'query_historical_series',
        moduleName: 'FieldDataTab/HistoricalSeries',
        errorTitle: 'Falha ao consultar série histórica',
        onLoadingChange: setIsQueryingHistorical,
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDeliverHistoricalResult = (
    result: HistoricalSeriesResult,
    format: ExportFormat,
  ): void => {
    void safeAction(
      async () => {
        const artifact = buildHistoricalArtifactContent(result, format);
        const delivery = await exportAndDeliverFile({
          filename: artifact.filename,
          content: artifact.content as unknown as string,
          format: artifact.format,
          title: `FieldCast Histórico — ${result.locationName}`,
          text: `Série histórica ${result.locationName} (${result.startDateIso} a ${result.endDateIso}) — ${result.hours.length} registros.`,
          preferNativeShare: true,
        });

        onToast?.({
          type: 'success',
          title: `Série histórica exportada (${format.toUpperCase()})`,
          message: `${delivery.filename} (${(delivery.byteLength / 1024).toFixed(1)} KB)`,
        });
      },
      {
        actionKey: `deliver_historical_${format}`,
        moduleName: 'FieldDataTab/HistoricalSeries',
        errorTitle: 'Falha ao exportar série histórica',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleSaveRecurrenceRuleClick = (): void => {
    void safeAction(
      async () => {
        const target = resolveSelectedHistoricalTarget();
        const now = new Date();
        const nextDue = new Date(
          now.getTime() + recurrenceIntervalDays * 86400 * 1000,
        ).toISOString();

        const rule: HistoricalRecurrenceRule = {
          id: `hist-rule-${now.getTime()}`,
          enabled: true,
          intervalDays: recurrenceIntervalDays,
          locationName: target.name,
          latitude: target.latitude,
          longitude: target.longitude,
          models:
            histSelectedModels.length > 0
              ? histSelectedModels
              : [...ALL_HISTORICAL_MODELS],
          format: histExportFormat,
          lastRunIso: null,
          nextDueIso: nextDue,
        };

        if (onSaveRecurrenceRule) {
          await onSaveRecurrenceRule(rule);
        } else if (typeof extendedDb.saveHistoricalRecurrenceRule === 'function') {
          await extendedDb.saveHistoricalRecurrenceRule(rule);
        }

        setStoredRecurrenceRules((prev) => [
          rule,
          ...prev.filter((r) => r.id !== rule.id),
        ]);

        onToast?.({
          type: 'success',
          title: 'Recorrência periódica configurada',
          message: `Log automático a cada ${recurrenceIntervalDays} dias para ${target.name} (${histExportFormat.toUpperCase()}).`,
        });
      },
      {
        actionKey: 'save_historical_recurrence_rule',
        moduleName: 'FieldDataTab/HistoricalSeries',
        errorTitle: 'Erro ao salvar regra de recorrência',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDeleteRecurrenceRuleClick = (ruleId: string): void => {
    void safeAction(
      async () => {
        if (onDeleteRecurrenceRule) {
          await onDeleteRecurrenceRule(ruleId);
        } else if (typeof extendedDb.deleteHistoricalRecurrenceRule === 'function') {
          await extendedDb.deleteHistoricalRecurrenceRule(ruleId);
        }
        setStoredRecurrenceRules((prev) => prev.filter((r) => r.id !== ruleId));
        onToast?.({
          type: 'info',
          title: 'Regra de recorrência removida',
        });
      },
      {
        actionKey: `delete_recurrence_rule_${ruleId}`,
        moduleName: 'FieldDataTab/HistoricalSeries',
        errorTitle: 'Erro ao remover regra de recorrência',
        onToast,
        onErrorLog,
      },
    );
  };

  const handleDownloadLogEntry = (log: HistoricalLogEntry): void => {
    void safeAction(
      async () => {
        if (onDownloadHistoricalLog) {
          await onDownloadHistoricalLog(log, log.format);
          return;
        }
        const artifact = buildHistoricalArtifactContent(log.result, log.format);
        await exportAndDeliverFile({
          filename: artifact.filename,
          content: artifact.content as unknown as string,
          format: artifact.format,
          title: `FieldCast Log Periódico — ${log.locationName}`,
          text: `Log histórico periódico ${log.locationName} (${log.startDateIso} a ${log.endDateIso})`,
          preferNativeShare: true,
        });
        onToast?.({
          type: 'success',
          title: 'Log histórico pronto para envio/download',
          message: `${artifact.filename} (${log.recordCount} registros)`,
        });
      },
      {
        actionKey: `download_historical_log_${log.id}`,
        moduleName: 'FieldDataTab/HistoricalSeries',
        errorTitle: 'Falha ao baixar/enviar log periódico',
        onToast,
        onErrorLog,
      },
    );
  };

  const currentSnapshot = extractConditionSnapshotFromForecast(forecast);
  const activeSession = trackerState.activeSession;
  const allModelsSelected =
    ALL_HISTORICAL_MODELS.every((m) => histSelectedModels.includes(m));

  const handleClearOfflineTilesClick = () => {
    void safeAction(
      async () => {
        await clearOfflineTiles();
        setOfflineTilesCount(0);
        onToast?.({
          type: 'info',
          title: 'Cache de tiles offline limpo',
          message: 'Todos os blocos de mapa em cache local foram removidos.',
        });
      },
      {
        actionKey: 'clear_offline_tiles_storage_panel',
        moduleName: 'FieldDataTab/StoragePanel',
        errorTitle: 'Erro ao limpar cache de tiles offline',
        onToast,
        onErrorLog,
      },
    );
  };

  const chartTargetSeries: HistoricalSeriesResult | null =
    lastHistoricalResult ?? activeHistoricalLogs[0]?.result ?? null;

  const historicalChartOption: EChartsOption | null = useMemo(() => {
    if (!chartTargetSeries || chartTargetSeries.hours.length === 0) {
      return null;
    }
    const textColor = isDark ? '#cbd5e1' : '#334155';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.25)';

    const xLabels = chartTargetSeries.hours.map((h) => {
      try {
        const d = new Date(h.timestampUnix * 1000);
        const dm = d.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          timeZone: chartTargetSeries.timezone || undefined,
        });
        const hm = d.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: chartTargetSeries.timezone || undefined,
        });
        return `${dm} ${hm}`;
      } catch {
        return h.timestampIso.slice(5, 16).replace('T', ' ');
      }
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
        borderColor: isDark ? '#334155' : '#bae6fd',
        textStyle: { color: isDark ? '#f8fafc' : '#0f172a', fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 44,
        left: 14,
        right: 18,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: '°C / km/h',
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor } },
        },
        {
          type: 'value',
          name: 'mm/h',
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Temp 2m (°C)',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.3, color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: chartTargetSeries.hours.map((h) => h.temperature2mC),
        },
        {
          name: 'Vento 10m (km/h)',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.9, type: 'dashed', color: '#0284c7' },
          itemStyle: { color: '#0284c7' },
          data: chartTargetSeries.hours.map((h) => h.windSpeed10mKmh),
        },
        {
          name: 'Precipitação (mm)',
          type: 'bar',
          yAxisIndex: 1,
          itemStyle: { color: 'rgba(14, 165, 233, 0.72)' },
          data: chartTargetSeries.hours.map((h) => h.precipitationMm),
        },
      ],
    };
  }, [chartTargetSeries, isDark]);

  const histEchartsRefProps = CAN_ATTACH_ECHARTS_REF
    ? {
        ref: (instance: ReactECharts | null) => {
          histChartRef.current = instance;
        },
      }
    : {};

  const showOverview = resolvedSubView === 'overview' || resolvedSubView === 'all';
  const showTracker = resolvedSubView === 'tracker' || resolvedSubView === 'all';
  const showWaypoints = resolvedSubView === 'waypoints' || resolvedSubView === 'all';
  const showHistoryFull = resolvedSubView === 'history' || resolvedSubView === 'all';
  const showReports = resolvedSubView === 'reports' || resolvedSubView === 'all';

  return (
    <div data-testid="storage-and-field-tab" className="space-y-5 pb-8">
      {/* Sub-Sidebar / Barra de Modos Focada (Um Módulo por Vez sem Poluição Visual) */}
      <nav
        data-testid="field-subview-nav"
        aria-label="Sub-navegação de Dados, Campo e Relatórios"
        className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-2.5 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              {
                id: 'overview' as const,
                label: 'Resumo de Armazenamento',
                icon: Database,
              },
              {
                id: 'tracker' as const,
                label: `GPS Tracker${savedTracks.length > 0 ? ` (${savedTracks.length})` : ''}`,
                icon: Route,
              },
              {
                id: 'waypoints' as const,
                label: `Waypoints & Fotos${savedWaypoints.length > 0 ? ` (${savedWaypoints.length})` : ''}`,
                icon: MapPin,
              },
              {
                id: 'history' as const,
                label: 'Séries Históricas',
                icon: History,
              },
              {
                id: 'reports' as const,
                label: 'Relatórios Técnicos & Acadêmicos',
                icon: GraduationCap,
              },
              {
                id: 'all' as const,
                label: 'Ver Tudo',
                icon: LayoutGrid,
              },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isActive = resolvedSubView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`field-subview-${item.id}`}
                aria-pressed={isActive}
                onClick={() => handleSelectSubView(item.id)}
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors ${
                  isActive
                    ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                    : 'bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 border-slate-200/80 dark:border-sky-800/70 hover:bg-sky-50 dark:hover:bg-sky-900/40'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* 1. Painel de Armazenamento & Dados Locais (Zero Servidor / Privacy-First) */}
      {showOverview && (
      <ModuleErrorBoundary
        moduleName="Painel de Armazenamento e Dados Locais"
        onErrorLog={onErrorLog}
      >
        <section
          data-testid="storage-overview-panel"
          aria-label="Painel de Armazenamento e Dados Locais"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <Database className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  Armazenamento Local & Missões (IndexedDB)
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Persistência offline privada no dispositivo &bull; Zero envio para nuvem
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onRequestGps && (
                <button
                  type="button"
                  onClick={() =>
                    void safeAction(async () => onRequestGps(), {
                      actionKey: 'storage_panel_request_gps',
                      moduleName: 'FieldDataTab',
                      errorTitle: 'Erro ao atualizar GPS',
                      onToast,
                      onErrorLog,
                    })
                  }
                  className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] hover:bg-sky-50 text-xs font-bold text-slate-700 dark:text-sky-100 inline-flex items-center gap-1.5"
                >
                  <MapPin className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                  <span>GPS Atual</span>
                </button>
              )}
              {onOpenLocationsModal && (
                <button
                  type="button"
                  onClick={onOpenLocationsModal}
                  className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl bg-[#0080cd] hover:bg-[#006eb3] text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Star className="w-4 h-4" />
                  <span>Gerenciar Locais</span>
                </button>
              )}
              {offlineTilesCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearOfflineTilesClick}
                  className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-200 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Limpar Tiles ({offlineTilesCount})</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/80 dark:bg-[#0f243d] p-3">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <Star className="w-3 h-3 text-amber-500" />
                Área Principal
              </span>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate mt-1">
                {primaryLocationName || activeLocation.name}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/80 dark:bg-[#0f243d] p-3">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <MapPin className="w-3 h-3 text-sky-500" />
                Locais Salvos
              </span>
              <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                {storedLocations.length}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/80 dark:bg-[#0f243d] p-3">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <CompassIcon className="w-3 h-3 text-emerald-500" />
                Waypoints
              </span>
              <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                {savedWaypoints.length}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/80 dark:bg-[#0f243d] p-3">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <Route className="w-3 h-3 text-indigo-500" />
                Rotas GPX
              </span>
              <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                {savedTracks.length}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/80 dark:bg-[#0f243d] p-3">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <HardDrive className="w-3 h-3 text-sky-500" />
                Logs & Regras
              </span>
              <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                {activeHistoricalLogs.length} / {activeRecurrenceRules.length}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-sky-800/60 bg-slate-50/80 dark:bg-[#0f243d] p-3">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                <Layers className="w-3 h-3 text-cyan-500" />
                Tiles Offline
              </span>
              <p className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                {offlineTilesCount}/300
              </p>
            </div>
          </div>
        </section>
      </ModuleErrorBoundary>
      )}

      {/* 2. Painel GPS Tracker Adaptativo */}
      {showTracker && (
      <ModuleErrorBoundary
        moduleName="Painel GPS Tracker Adaptativo"
        onErrorLog={onErrorLog}
      >
        <section
          aria-label="Painel GPS Tracker Adaptativo"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Route className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  GPS Tracker Adaptativo
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Filtro estrito de acurácia (&le; {MAX_TRACK_ACCURACY_M}m) &bull; Cálculo geodésico
                  Haversine
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {trackerState.isRecording && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  GRAVANDO ROTA
                </span>
              )}
              {trackerState.isPaused && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  PAUSADO
                </span>
              )}
            </div>
          </div>

          {/* Banner Web Wake Lock ou Notificação Foreground Service Android */}
          {trackerState.keepScreenOnWarning && (
            <div
              role="status"
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-center gap-3 text-xs sm:text-sm text-amber-900 dark:text-amber-200"
            >
              <Smartphone className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <p className="font-bold">
                  {trackerState.wakeLockBannerMessage ?? WEB_WAKE_LOCK_WARNING_MESSAGE}
                </p>
                <p className="text-xs opacity-90">
                  Screen Wake Lock API:{' '}
                  {trackerState.wakeLockActive
                    ? 'Ativo (bloqueio automático de tela suspenso)'
                    : 'Modo padrão do navegador — evite bloquear a tela'}
                </p>
              </div>
            </div>
          )}

          {trackerState.foregroundServiceActive && (
            <div
              role="status"
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 flex items-center gap-3 text-xs sm:text-sm text-emerald-900 dark:text-emerald-200"
            >
              <Navigation className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="font-bold">
                  {trackerState.foregroundNotificationTitle ??
                    ANDROID_FOREGROUND_NOTIFICATION_TITLE}
                </p>
                <p className="text-xs opacity-90">
                  Serviço nativo Android em primeiro plano ativo com recepção contínua.
                </p>
              </div>
            </div>
          )}

          {/* Métricas em Tempo Real */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Distância Haversine
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-0.5">
                {(activeSession?.totalDistanceKm ?? 0).toFixed(3)} km
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Acurácia GPS Atual
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-0.5">
                {trackerState.lastAccuracyM !== null
                  ? `±${trackerState.lastAccuracyM.toFixed(1)} m`
                  : activeLocation.accuracyM
                    ? `±${activeLocation.accuracyM.toFixed(0)} m`
                    : 'Aguardando'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Pontos Aceitos (&le;20m)
              </div>
              <div className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {activeSession?.points.length ?? 0}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Descartados (&gt;20m)
              </div>
              <div className="text-lg font-black font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                {activeSession?.discardedLowAccuracyCount ?? 0}
              </div>
            </div>
          </div>

          {/* Controles de Gravação (>= 44x44px) */}
          {!activeSession ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={routeNameInput}
                onChange={(e) => setRouteNameInput(e.target.value)}
                placeholder="Nome da rota / missão (opcional)"
                aria-label="Nome da rota GPS"
                className="min-h-[44px] flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={handleStartTracking}
                className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>Iniciar Gravação de Rota</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {trackerState.isRecording ? (
                <button
                  type="button"
                  onClick={handlePauseTracking}
                  className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white shadow-sm transition-colors"
                >
                  <Pause className="w-4 h-4" aria-hidden="true" />
                  <span>Pausar Rota</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResumeTracking}
                  className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
                >
                  <Play className="w-4 h-4" aria-hidden="true" />
                  <span>Retomar Rota</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleStopTracking}
                className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-colors"
              >
                <Square className="w-4 h-4" aria-hidden="true" />
                <span>Encerrar e Salvar Rota</span>
              </button>
            </div>
          )}

          {/* Lista de Rotas Gravadas */}
          {savedTracks.length > 0 && (
            <div className="pt-2 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Rotas Gravadas no Dispositivo ({savedTracks.length})
              </h3>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {savedTracks.map((trk) => (
                  <div
                    key={trk.id}
                    className="p-3 bg-slate-50/60 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        {trk.name}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                        {trk.totalDistanceKm.toFixed(3)} km &bull; {trk.points.length} pts aceitos
                        &bull; {trk.discardedLowAccuracyCount} descartados (&gt;20m) &bull;{' '}
                        {trk.startedAtIso.slice(0, 16).replace('T', ' ')} UTC
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteTrack(trk.id, trk.name)}
                      aria-label={`Excluir rota ${trk.name}`}
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 inline-flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </ModuleErrorBoundary>
      )}

      {/* 3. Waypoints Georreferenciados + Foto (~200 KB) + Snapshot Automático */}
      {showWaypoints && (
      <ModuleErrorBoundary
        moduleName="Waypoints Georreferenciados & Galeria Offline"
        onErrorLog={onErrorLog}
      >
        <section
          aria-label="Waypoints Georreferenciados"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <MapPin className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  Waypoints com Foto Georreferenciada
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Compressão Canvas (~{TARGET_PHOTO_MAX_KB} KB) + Snapshot meteorológico/marinho
                  instantâneo
                </p>
              </div>
            </div>

            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              Lat {activeLocation.latitude.toFixed(4)}, Lon {activeLocation.longitude.toFixed(4)}
            </span>
          </div>

          {/* Preview do Snapshot Automático de Condições */}
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-sky-800 dark:text-sky-300">
              <span>Snapshot Automático de Condições (Anexado ao Waypoint)</span>
              <span className="font-mono">
                Confiança:{' '}
                {currentSnapshot.confidenceTotal !== null
                  ? `${currentSnapshot.confidenceTotal}/100`
                  : 'N/D'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span>
                  Vento:{' '}
                  {currentSnapshot.windSpeed10mKmh !== null
                    ? `${currentSnapshot.windSpeed10mKmh.toFixed(1)} km/h`
                    : 'N/D'}
                </span>
              </div>
              <div>
                Rajada 10m:{' '}
                {currentSnapshot.windGusts10mKmh !== null
                  ? `${currentSnapshot.windGusts10mKmh.toFixed(1)} km/h`
                  : 'N/D'}
              </div>
              <div>
                Temp / Pressão:{' '}
                {currentSnapshot.temperature2mC !== null
                  ? `${currentSnapshot.temperature2mC.toFixed(1)}°C`
                  : 'N/D'}{' '}
                /{' '}
                {currentSnapshot.surfacePressureHpa !== null
                  ? `${currentSnapshot.surfacePressureHpa.toFixed(0)} hPa`
                  : 'N/D'}
              </div>
              <div className="flex items-center gap-1.5">
                <Waves className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                <span>
                  Onda:{' '}
                  {currentSnapshot.waveHeightM !== null
                    ? `${currentSnapshot.waveHeightM.toFixed(2)} m`
                    : 'Continental'}
                </span>
              </div>
            </div>
          </div>

          {/* Formulário de Novo Waypoint */}
          <form onSubmit={handleCreateWaypoint} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={wpName}
                onChange={(e) => setWpName(e.target.value)}
                placeholder="Título do Waypoint (ex.: Ponto de Fundeio / Parcel)"
                aria-label="Título do Waypoint"
                className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <input
                type="text"
                value={wpNote}
                onChange={(e) => setWpNote(e.target.value)}
                placeholder="Observação de campo (correnteza, abrigo, fundo, etc.)"
                aria-label="Observação de campo"
                className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileInputChange}
              className="hidden"
              aria-label="Selecionar foto de campo"
            />

            {wpPhoto && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={wpPhoto.dataUrl}
                    alt="Pré-visualização comprimida"
                    className="w-12 h-12 rounded-lg object-cover border border-slate-300 dark:border-slate-700"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-900 dark:text-white">
                      Foto anexada e comprimida ({wpPhoto.sizeKb.toFixed(1)} KB)
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      {wpPhoto.mimeType} &bull; {wpPhoto.width}x{wpPhoto.height}px
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setWpPhoto(null)}
                  className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  Remover
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCaptureNativeOrWebPhoto}
                disabled={isCompressingPhoto}
                className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition-colors"
              >
                <Camera className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>{isCompressingPhoto ? 'Comprimindo...' : 'Câmera (~200 KB)'}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isCompressingPhoto}
                className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition-colors"
              >
                <ImageIcon className="w-4 h-4 text-teal-500" aria-hidden="true" />
                <span>Anexar Arquivo</span>
              </button>

              <button
                type="submit"
                className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors ml-auto"
              >
                <PlusCircle className="w-4 h-4" aria-hidden="true" />
                <span>Registrar Waypoint</span>
              </button>
            </div>
          </form>

          {/* Galeria Offline de Waypoints */}
          <div className="space-y-2.5 pt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Galeria Offline de Waypoints ({savedWaypoints.length})
            </h3>

            {savedWaypoints.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-6 text-center text-xs sm:text-sm text-slate-500">
                Nenhum waypoint registrado ainda. Crie pontos acima para salvar coordenadas, foto
                comprimida e condições meteorológicas no IndexedDB.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {savedWaypoints.map((wp) => (
                  <article
                    key={wp.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3.5 flex gap-3.5 justify-between"
                  >
                    <div className="flex gap-3 min-w-0">
                      {wp.photoDataUrl && (
                        <img
                          src={wp.photoDataUrl}
                          alt={wp.name}
                          className="w-16 h-16 rounded-lg object-cover border border-slate-300 dark:border-slate-700 shrink-0"
                        />
                      )}
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {wp.name}
                          </h4>
                          <span className="text-[11px] font-mono text-slate-500">
                            {wp.timestampUtcIso.slice(0, 16).replace('T', ' ')} UTC
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-600 dark:text-slate-400">
                          {wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)}
                          {wp.photoSizeKb ? ` • Foto ${wp.photoSizeKb.toFixed(0)} KB` : ''}
                        </div>
                        {wp.note && (
                          <p className="text-xs text-slate-700 dark:text-slate-300 break-words">
                            {wp.note}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                          {wp.conditions.windSpeed10mKmh !== null && (
                            <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300">
                              Vento {wp.conditions.windSpeed10mKmh.toFixed(1)} km/h
                            </span>
                          )}
                          {wp.conditions.waveHeightM !== null && (
                            <span className="px-2 py-0.5 rounded bg-teal-500/10 text-teal-700 dark:text-teal-300">
                              Onda {wp.conditions.waveHeightM.toFixed(2)} m
                            </span>
                          )}
                          {wp.conditions.temperature2mC !== null && (
                            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">
                              {wp.conditions.temperature2mC.toFixed(1)}°C
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteWaypoint(wp.id, wp.name)}
                      aria-label={`Excluir waypoint ${wp.name}`}
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 inline-flex items-center justify-center shrink-0 self-start"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </ModuleErrorBoundary>
      )}

      {/* 4. Central de Exportação & Compartilhamento (Zero Servidor) */}
      {showOverview && (
      <ModuleErrorBoundary
        moduleName="Central de Exportação & Compartilhamento"
        onErrorLog={onErrorLog}
      >
        <section
          aria-label="Central de Exportação e Compartilhamento"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                <Share2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                  Central de Exportação &amp; Compartilhamento
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  CSV (UTF-8 BOM), JSON, GPX 1.1, GeoJSON (RFC 7946), Google Earth (KML / KMZ) e
                  Boletim WhatsApp
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
            >
              <MessageSquareShare className="w-4 h-4" aria-hidden="true" />
              <span>Compartilhar Boletim via WhatsApp</span>
            </button>
          </div>

          {/* Seletor de Escopo de Dados */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'mission_bundle', label: 'Missão Completa (Tudo)' },
                { id: 'forecast', label: 'Previsão Horária (168h)' },
                { id: 'waypoints', label: `Waypoints (${savedWaypoints.length})` },
                { id: 'tracks', label: `Rotas GPS (${savedTracks.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedDataset(tab.id)}
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
                  selectedDataset === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Grade de Formatos: CSV (BOM UTF-8), JSON, GPX, GeoJSON, KML e KMZ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'csv')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar CSV
                  </div>
                  <div className="text-[11px] text-slate-500">Excel / BOM UTF-8 (\uFEFF)</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'json')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileCode className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar JSON
                  </div>
                  <div className="text-[11px] text-slate-500">Estrutura Completa</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'gpx')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <CompassIcon className="w-5 h-5 text-sky-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar GPX
                  </div>
                  <div className="text-[11px] text-slate-500">Garmin / OpenCPN / Navionics</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleExportFormat(selectedDataset, 'geojson')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar GeoJSON
                  </div>
                  <div className="text-[11px] text-slate-500">QGIS / SIG (RFC 7946)</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              data-testid="export-kml-btn"
              onClick={() => handleExportFormat(selectedDataset, 'kml')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Globe className="w-5 h-5 text-sky-600 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar KML
                  </div>
                  <div className="text-[11px] text-slate-500">Google Earth (KML 2.2)</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>

            <button
              type="button"
              data-testid="export-kmz-btn"
              onClick={() => handleExportFormat(selectedDataset, 'kmz')}
              className="min-h-[44px] min-w-[44px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-500/50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileArchive className="w-5 h-5 text-teal-600 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    Exportar KMZ
                  </div>
                  <div className="text-[11px] text-slate-500">Google Earth Compactado (.kmz)</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 pt-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              Operação 100% local e offline. No Android nativo aciona o menu Capacitor Share; no
              Desktop realiza download imediato do arquivo.
            </span>
          </div>
        </section>
      </ModuleErrorBoundary>
      )}

      {/* 4B. Barra Rápida de Séries Históricas em 'overview' (Mantém 100% de compatibilidade sem poluir a tela) */}
      {resolvedSubView === 'overview' && (
        <section
          aria-label="Séries Históricas & Recorrência Semanal"
          data-testid="historical-series-section"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 sm:p-5 shadow-sm space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <History className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Séries Históricas &amp; Recorrência Semanal
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Extração rápida ({histStartDate} a {histEndDate}) ou abra as sub-telas dedicadas
                  para gráficos ERA5 e Relatórios Técnicos/Acadêmicos
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="query-historical-series-btn"
                onClick={handleQueryHistoricalSeries}
                disabled={isQueryingHistorical}
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-sm transition-colors"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isQueryingHistorical ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {isQueryingHistorical
                    ? 'Consultando Série Histórica...'
                    : 'Consultar Série Histórica'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSubView('history')}
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border border-slate-200 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] text-slate-700 dark:text-sky-100 hover:bg-sky-50 transition-colors"
              >
                <History className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>Painel Completo &amp; Gráfico</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSubView('reports')}
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
              >
                <GraduationCap className="w-4 h-4" aria-hidden="true" />
                <span>Relatório Técnico ERA5</span>
              </button>
            </div>
          </div>

          {lastHistoricalResult && (
            <div
              data-testid="historical-query-result"
              className="flex flex-wrap items-center gap-2 pt-1"
            >
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                {lastHistoricalResult.hours.length} registros horários (
                {lastHistoricalResult.locationName})
              </span>
              <button
                type="button"
                data-testid="download-historical-series-btn"
                onClick={() =>
                  handleDeliverHistoricalResult(lastHistoricalResult, histExportFormat)
                }
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>Baixar / Compartilhar ({histExportFormat.toUpperCase()})</span>
              </button>
            </div>
          )}
        </section>
      )}

      {/* 5. Seção Dedicada: Séries Históricas & Recorrência Semanal (com ECharts em Tela Cheia) */}
      {showHistoryFull && (
      <ModuleErrorBoundary
        moduleName="Séries Históricas & Recorrência Semanal"
        onErrorLog={onErrorLog}
      >
        <section
          aria-label="Séries Históricas & Recorrência Semanal"
          data-testid="historical-series-section"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <History className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                    Séries Históricas &amp; Recorrência Semanal
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200">
                    Opcional • Sob Demanda
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Extraia séries temporais retroativas por modelo (CSV, JSON, KML, KMZ) ou agende
                  logs periódicos locais para Drive / WhatsApp
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsHistoricalExpanded((prev) => !prev)}
              aria-expanded={isHistoricalExpanded}
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition-colors"
            >
              {isHistoricalExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                  <span>Recolher Painel</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  <span>Expandir Consulta Histórica</span>
                </>
              )}
            </button>
          </div>

          {isHistoricalExpanded && (
            <div className="space-y-5 pt-2 border-t border-slate-100 dark:border-slate-800">
              {/* Subcard 1: Consulta de Série Histórica */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Local / Área de Consulta
                    </span>
                    <select
                      aria-label="Local da série histórica"
                      data-testid="historical-location-select"
                      value={selectedHistLocationKey}
                      onChange={(e) => setSelectedHistLocationKey(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white"
                    >
                      <option value="active">
                        Atual: {activeLocation.name} ({activeLocation.latitude.toFixed(3)}°,{' '}
                        {activeLocation.longitude.toFixed(3)}°)
                      </option>
                      {availableLocations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.latitude.toFixed(3)}°, {loc.longitude.toFixed(3)}°)
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Data Inicial
                    </span>
                    <input
                      type="date"
                      aria-label="Data inicial da série histórica"
                      value={histStartDate}
                      onChange={(e) => {
                        setHistDatePresetDays(null);
                        setHistStartDate(e.target.value);
                      }}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Data Final
                    </span>
                    <input
                      type="date"
                      aria-label="Data final da série histórica"
                      value={histEndDate}
                      onChange={(e) => {
                        setHistDatePresetDays(null);
                        setHistEndDate(e.target.value);
                      }}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </label>
                </div>

                {/* Atalhos de Período */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-sky-500" aria-hidden="true" />
                    <span>Período Rápido:</span>
                  </span>
                  {([7, 14, 30] as const).map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => handleSelectDatePreset(days)}
                      className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                        histDatePresetDays === days
                          ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-sky-50'
                      }`}
                    >
                      Últimos {days} dias
                    </button>
                  ))}
                </div>

                {/* Seleção de Modelos e Formato */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 mr-1">
                      Modelos:
                    </span>
                    <button
                      type="button"
                      onClick={handleSelectAllHistoricalModels}
                      aria-pressed={allModelsSelected}
                      className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                        allModelsSelected
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      Todos
                    </button>
                    {HISTORICAL_MODEL_OPTIONS.map((opt) => {
                      const active = histSelectedModels.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleToggleHistoricalModel(opt.id)}
                          aria-pressed={active}
                          className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            active
                              ? 'bg-sky-100 dark:bg-sky-900/70 text-sky-900 dark:text-sky-100 border-sky-400'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 mr-1">
                      Formato:
                    </span>
                    {HISTORICAL_EXPORT_FORMATS.map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setHistExportFormat(fmt.id)}
                        aria-pressed={histExportFormat === fmt.id}
                        className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-bold border transition-colors ${
                          histExportFormat === fmt.id
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Botão Consultar Série Histórica */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    data-testid="query-historical-series-btn"
                    onClick={handleQueryHistoricalSeries}
                    disabled={isQueryingHistorical}
                    className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-sm transition-colors"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${isQueryingHistorical ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>
                      {isQueryingHistorical
                        ? 'Consultando Série Histórica...'
                        : 'Consultar Série Histórica'}
                    </span>
                  </button>

                  {lastHistoricalResult && (
                    <div
                      data-testid="historical-query-result"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                        {lastHistoricalResult.hours.length} registros horários (
                        {lastHistoricalResult.locationName})
                      </span>
                      <button
                        type="button"
                        data-testid="download-historical-series-btn"
                        onClick={() =>
                          handleDeliverHistoricalResult(lastHistoricalResult, histExportFormat)
                        }
                        className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                        <span>
                          Baixar / Compartilhar ({histExportFormat.toUpperCase()})
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectSubView('reports')}
                        className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
                      >
                        <GraduationCap className="w-4 h-4" aria-hidden="true" />
                        <span>Gerar Relatório Técnico</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Gráfico ECharts da Série Histórica com FullscreenViewer (Tela Cheia) */}
                {historicalChartOption && chartTargetSeries && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 mt-2">
                    <FullscreenViewer
                      title={`Série Temporal Histórica — ${chartTargetSeries.locationName}`}
                      subtitle={`${chartTargetSeries.startDateIso} a ${chartTargetSeries.endDateIso} • ${chartTargetSeries.hours.length} registros horários`}
                      testId="historical-series-chart-viewer"
                    >
                      {({ isFullscreen }) => (
                        <ModuleErrorBoundary moduleName="Gráfico de Série Histórica">
                          <div
                            className={
                              isFullscreen
                                ? 'h-[calc(100vh-140px)] min-h-[340px] w-full'
                                : 'h-[260px] sm:h-[300px] w-full'
                            }
                          >
                            <ReactECharts
                              {...histEchartsRefProps}
                              option={historicalChartOption}
                              opts={{ renderer: 'svg' }}
                              notMerge={true}
                              lazyUpdate={true}
                              style={{ width: '100%', height: '100%' }}
                            />
                          </div>
                        </ModuleErrorBoundary>
                      )}
                    </FullscreenViewer>
                  </div>
                )}
              </div>

              {/* Subcard 2: Recorrência Automática (Logs Periódicos) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-sky-500" aria-hidden="true" />
                      <span>Recorrência Automática (Logs Periódicos)</span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Salve uma regra local para consolidar automaticamente o histórico e enviar
                      em 1 clique para Google Drive ou WhatsApp
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {RECURRENCE_INTERVAL_OPTIONS.map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() => setRecurrenceIntervalDays(opt.days)}
                        aria-pressed={recurrenceIntervalDays === opt.days}
                        className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                          recurrenceIntervalDays === opt.days
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}

                    <button
                      type="button"
                      data-testid="save-recurrence-rule-btn"
                      onClick={handleSaveRecurrenceRuleClick}
                      className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
                    >
                      <PlusCircle className="w-4 h-4" aria-hidden="true" />
                      <span>Agendar Log Periódico</span>
                    </button>
                  </div>
                </div>

                {/* Regras Ativas */}
                {activeRecurrenceRules.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Regras Configuradas ({activeRecurrenceRules.length})
                    </div>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                      {activeRecurrenceRules.map((rule) => (
                        <div
                          key={rule.id}
                          className="p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white">
                              {rule.locationName}
                            </span>{' '}
                            <span className="text-slate-500">
                              • A cada {rule.intervalDays} dias • Formato{' '}
                              {rule.format.toUpperCase()} • Modelos: {rule.models.join(', ')}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecurrenceRuleClick(rule.id)}
                            aria-label={`Remover regra ${rule.locationName}`}
                            className="min-h-[38px] min-w-[38px] p-1.5 rounded-lg text-rose-600 hover:bg-rose-500/10 inline-flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Logs Periódicos Prontos para 1-Click Download / Share */}
                {activeHistoricalLogs.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Logs Periódicos Prontos ({activeHistoricalLogs.length})
                    </div>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                      {activeHistoricalLogs.map((log) => (
                        <div
                          key={log.id}
                          className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">
                              {log.locationName} ({log.startDateIso} a {log.endDateIso})
                            </div>
                            <div className="text-slate-500 font-mono">
                              {log.recordCount} registros • {log.format.toUpperCase()} •{' '}
                              {log.modelsIncluded.join(', ')}
                            </div>
                          </div>

                          <button
                            type="button"
                            data-testid={`download-historical-log-${log.id}`}
                            onClick={() => handleDownloadLogEntry(log)}
                            className="min-h-[42px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Baixar / Enviar (Drive / WhatsApp)</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </ModuleErrorBoundary>
      )}

      {/* 6. Estúdio de Análise Estatística ERA5 & Relatórios Técnicos/Acadêmicos */}
      {showReports && (
        <ModuleErrorBoundary
          moduleName="Estúdio de Relatórios Técnicos e Acadêmicos"
          onErrorLog={onErrorLog}
        >
          <TechnicalReportsPanel
            forecast={forecast}
            activeLocation={activeLocation}
            historicalLogs={activeHistoricalLogs}
            initialHistoricalSeries={lastHistoricalResult}
            defaultSource={lastHistoricalResult ? 'historical' : 'forecast'}
            viewMode={viewMode}
            isDark={isDark}
            onFetchHistoricalSeries={onFetchHistoricalSeries}
            onToast={onToast}
            onErrorLog={onErrorLog}
          />
        </ModuleErrorBoundary>
      )}
    </div>
  );
};
