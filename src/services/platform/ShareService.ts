import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ExportFormat, TrackSession, Waypoint } from '../../types/field';
import type { NormalizedForecast } from '../../types/weather';
import {
  buildWhatsAppShareUrl,
  exportFieldDataToJson,
  exportForecastToCsv,
  exportForecastToJson,
  exportToGeoJson,
  exportToGpx,
  exportToKml,
  exportToKmz,
  exportTracksToCsv,
  exportWaypointsToCsv,
  UTF8_BOM,
} from '../../utils/exporters';

export type ExportDatasetKind = 'forecast' | 'waypoints' | 'tracks' | 'mission_bundle';

export interface ExportDeliveryPayload {
  filename: string;
  content: string | Uint8Array | Blob;
  format: ExportFormat;
  title?: string;
  text?: string;
  preferNativeShare?: boolean;
  isNativePlatformFn?: () => boolean;
}

export interface ExportDeliveryResult {
  deliveredVia: 'capacitor_share' | 'web_share' | 'browser_download';
  filename: string;
  byteLength: number;
  mimeType: string;
  savedPathDisplay: string;
  uri?: string;
}

export type ShareDeliveryResult = ExportDeliveryResult;

export function getMimeTypeForFormat(format: ExportFormat): string {
  switch (format) {
    case 'csv':
      return 'text/csv;charset=utf-8';
    case 'json':
      return 'application/json;charset=utf-8';
    case 'gpx':
      return 'application/gpx+xml;charset=utf-8';
    case 'geojson':
      return 'application/geo+json;charset=utf-8';
    case 'kml':
      return 'application/vnd.google-earth.kml+xml;charset=utf-8';
    case 'kmz':
      return 'application/vnd.google-earth.kmz';
    case 'html':
      return 'text/html;charset=utf-8';
    case 'md':
      return 'text/markdown;charset=utf-8';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
}

export function getFileExtensionForFormat(format: ExportFormat): string {
  switch (format) {
    case 'csv':
      return 'csv';
    case 'json':
      return 'json';
    case 'gpx':
      return 'gpx';
    case 'geojson':
      return 'geojson';
    case 'kml':
      return 'kml';
    case 'kmz':
      return 'kmz';
    case 'html':
      return 'html';
    case 'md':
      return 'md';
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
  }
}

function sanitizeExportFilename(filename: string, format: ExportFormat): string {
  const cleaned = filename
    .replace(/[\\/]+/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '')
    .trim();
  const ext = getFileExtensionForFormat(format);
  if (!cleaned) {
    return `fieldcast-export.${ext}`;
  }
  return cleaned;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    let chunk = '';
    for (let j = 0; j < slice.length; j++) {
      chunk += String.fromCharCode(slice[j]!);
    }
    binary += chunk;
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function toBlobPart(content: string | Uint8Array | Blob): BlobPart {
  if (typeof content === 'string' || content instanceof Blob) {
    return content;
  }
  return new Uint8Array(content);
}

/**
 * Dispara download local no navegador via `Blob` + `<a download>`.
 */
export function triggerBrowserFileDownload(
  filename: string,
  content: string | Uint8Array | Blob,
  mimeType: string,
): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return;
  }

  const blob =
    content instanceof Blob ? content : new Blob([toBlobPart(content)], { type: mimeType });
  const hasUrlApi =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

  if (!hasUrlApi) {
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignora
      }
    }, 1500);
  }
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

async function resolveNativeWritePayload(
  content: string | Uint8Array | Blob,
): Promise<{ data: string; encoding?: Encoding; byteLength: number }> {
  if (typeof content === 'string') {
    return {
      data: content,
      encoding: Encoding.UTF8,
      byteLength: new TextEncoder().encode(content).byteLength,
    };
  }
  if (content instanceof Blob) {
    const buf = new Uint8Array(await content.arrayBuffer());
    return {
      data: uint8ArrayToBase64(buf),
      byteLength: buf.byteLength,
    };
  }
  return {
    data: uint8ArrayToBase64(content),
    byteLength: content.byteLength,
  };
}

/**
 * Entrega um arquivo exportado (CSV, JSON, GPX, GeoJSON, KML, KMZ, HTML, MD, PDF ou DOCX):
 * - No Android/iOS nativo (`Capacitor.isNativePlatform()`): grava preferencialmente em
 *   `Directory.Documents` (`FieldCast/<arquivo>`), com fallback para `Directory.Cache`,
 *   e abre `@capacitor/share` (tratando cancelamento sem descartar o arquivo salvo).
 * - Na Web Mobile (quando `preferNativeShare === true` e `navigator.canShare` suporta arquivos): utiliza Web Share API.
 * - No Desktop (ou fallback universal): dispara download direto via `Blob` + `<a download>`.
 */
export async function exportAndDeliverFile(
  payload: ExportDeliveryPayload,
): Promise<ExportDeliveryResult> {
  const mimeType = getMimeTypeForFormat(payload.format);
  const safeFilename = sanitizeExportFilename(payload.filename, payload.format);
  const byteLength =
    typeof payload.content === 'string'
      ? new TextEncoder().encode(payload.content).byteLength
      : payload.content instanceof Blob
        ? payload.content.size
        : payload.content.byteLength;

  const isNative =
    payload.isNativePlatformFn?.() ??
    (() => {
      try {
        return Capacitor.isNativePlatform();
      } catch {
        return false;
      }
    })();

  if (isNative) {
    try {
      const prepared = await resolveNativeWritePayload(payload.content);
      const relativePath = `FieldCast/${safeFilename}`;
      let writtenUri: string | undefined;
      let savedPathDisplay = `Documentos/${relativePath}`;

      try {
        const writtenDocs = await Filesystem.writeFile({
          path: relativePath,
          data: prepared.data,
          directory: Directory.Documents,
          recursive: true,
          ...(prepared.encoding ? { encoding: prepared.encoding } : {}),
        });
        writtenUri = writtenDocs.uri;
      } catch {
        const writtenCache = await Filesystem.writeFile({
          path: relativePath,
          data: prepared.data,
          directory: Directory.Cache,
          recursive: true,
          ...(prepared.encoding ? { encoding: prepared.encoding } : {}),
        });
        writtenUri = writtenCache.uri;
        savedPathDisplay = `Cache/${relativePath}`;
      }

      if (writtenUri) {
        try {
          await Share.share({
            title: payload.title ?? `FieldCast — ${safeFilename}`,
            text: payload.text ?? `Exportação FieldCast (${safeFilename})`,
            files: [writtenUri],
            dialogTitle: payload.title ?? 'Compartilhar Dados de Campo',
          });
        } catch {
          // Usuário cancelou ou fechou a folha de compartilhamento — o arquivo permanece salvo
        }

        return {
          deliveredVia: 'capacitor_share',
          filename: safeFilename,
          byteLength: prepared.byteLength,
          mimeType,
          savedPathDisplay,
          uri: writtenUri,
        };
      }
    } catch {
      // Fallback para download caso o plugin de arquivos falhe
    }
  }

  if (
    payload.preferNativeShare &&
    isMobileUserAgent() &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof File !== 'undefined'
  ) {
    try {
      const file = new File([toBlobPart(payload.content)], safeFilename, {
        type: mimeType,
      });
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({
          title: payload.title ?? `FieldCast — ${safeFilename}`,
          text: payload.text,
          files: [file],
        });
        return {
          deliveredVia: 'web_share',
          filename: safeFilename,
          byteLength,
          mimeType,
          savedPathDisplay: `Compartilhamento/${safeFilename}`,
        };
      }
    } catch {
      // Fallback para download local
    }
  }

  triggerBrowserFileDownload(safeFilename, payload.content, mimeType);
  return {
    deliveredVia: 'browser_download',
    filename: safeFilename,
    byteLength,
    mimeType,
    savedPathDisplay: `Downloads/${safeFilename}`,
  };
}

/**
 * Reabre a folha nativa de compartilhamento (`@capacitor/share` no nativo ou Web Share API)
 * para um arquivo já gerado/salvo, permitindo que banners pós-exportação compartilhem sob demanda.
 */
export async function shareDeliveredPayload(options: {
  filename: string;
  format: ExportFormat;
  data: string | Uint8Array | Blob;
  title?: string;
  uri?: string;
  isNativePlatformFn?: () => boolean;
}): Promise<boolean> {
  const mimeType = getMimeTypeForFormat(options.format);
  const safeFilename = sanitizeExportFilename(options.filename, options.format);
  const isNative =
    options.isNativePlatformFn?.() ??
    (() => {
      try {
        return Capacitor.isNativePlatform();
      } catch {
        return false;
      }
    })();

  if (isNative) {
    try {
      let targetUri = options.uri;
      if (!targetUri) {
        const prepared = await resolveNativeWritePayload(options.data);
        const written = await Filesystem.writeFile({
          path: `FieldCast/${safeFilename}`,
          data: prepared.data,
          directory: Directory.Cache,
          recursive: true,
          ...(prepared.encoding ? { encoding: prepared.encoding } : {}),
        });
        targetUri = written.uri;
      }
      await Share.share({
        title: options.title ?? `FieldCast — ${safeFilename}`,
        text: `Exportação FieldCast (${safeFilename})`,
        files: [targetUri],
        dialogTitle: options.title ?? 'Compartilhar Arquivo FieldCast',
      });
      return true;
    } catch {
      return false;
    }
  }

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof File !== 'undefined'
  ) {
    try {
      const file = new File([toBlobPart(options.data)], safeFilename, { type: mimeType });
      const canShare =
        typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });
      if (canShare) {
        await navigator.share({
          title: options.title ?? `FieldCast — ${safeFilename}`,
          files: [file],
        });
        return true;
      }
    } catch {
      return false;
    }
  }

  triggerBrowserFileDownload(safeFilename, options.data, mimeType);
  return false;
}

export interface BuildExportArtifactParams {
  dataset: ExportDatasetKind;
  format: ExportFormat;
  forecast: NormalizedForecast | null;
  waypoints: readonly Waypoint[];
  tracks: readonly TrackSession[];
  locationName?: string;
}

function buildMissionBundleCsv(params: {
  forecast: NormalizedForecast | null;
  waypoints: readonly Waypoint[];
  tracks: readonly TrackSession[];
}): string {
  const sections: string[] = [];

  if (params.forecast) {
    const body = exportForecastToCsv(params.forecast).replace(/^\uFEFF/, '');
    sections.push(`# PREVISAO_HORARIA_168H\r\n${body}`);
  }
  if (params.waypoints.length > 0) {
    const body = exportWaypointsToCsv(params.waypoints).replace(/^\uFEFF/, '');
    sections.push(`# WAYPOINTS_DE_CAMPO\r\n${body}`);
  }
  if (params.tracks.length > 0) {
    const body = exportTracksToCsv(params.tracks).replace(/^\uFEFF/, '');
    sections.push(`# ROTAS_GPS_TRACKS\r\n${body}`);
  }

  if (sections.length === 0) {
    return exportWaypointsToCsv([]);
  }

  return UTF8_BOM + sections.join('\r\n\r\n');
}

/**
 * Constrói o conteúdo e nome de arquivo para qualquer combinação de dataset e formato (`csv`, `json`, `gpx`, `geojson`, `kml`, `kmz`).
 */
export function buildExportArtifact(
  params: BuildExportArtifactParams & { format: 'kmz' },
): { filename: string; content: Uint8Array; format: 'kmz' };
export function buildExportArtifact(
  params: BuildExportArtifactParams & { format: Exclude<ExportFormat, 'kmz'> },
): { filename: string; content: string; format: Exclude<ExportFormat, 'kmz'> };
export function buildExportArtifact(
  params: BuildExportArtifactParams,
): { filename: string; content: string | Uint8Array; format: ExportFormat };
export function buildExportArtifact(
  params: BuildExportArtifactParams,
): { filename: string; content: string | Uint8Array; format: ExportFormat } {
  const { dataset, format, forecast, waypoints, tracks, locationName } = params;
  const dateTag = new Date().toISOString().slice(0, 10);
  const ext = getFileExtensionForFormat(format);

  if (format === 'csv') {
    if (dataset === 'forecast') {
      if (!forecast) {
        throw new Error('Nenhuma previsão carregada para exportar em CSV.');
      }
      return {
        filename: `fieldcast-previsao-168h-${dateTag}.${ext}`,
        content: exportForecastToCsv(forecast),
        format,
      };
    }
    if (dataset === 'waypoints') {
      return {
        filename: `fieldcast-waypoints-${dateTag}.${ext}`,
        content: exportWaypointsToCsv(waypoints),
        format,
      };
    }
    if (dataset === 'tracks') {
      return {
        filename: `fieldcast-tracks-${dateTag}.${ext}`,
        content: exportTracksToCsv(tracks),
        format,
      };
    }
    return {
      filename: `fieldcast-missao-completa-${dateTag}.${ext}`,
      content: buildMissionBundleCsv({ forecast, waypoints, tracks }),
      format,
    };
  }

  if (format === 'json') {
    if (dataset === 'forecast') {
      if (!forecast) {
        throw new Error('Nenhuma previsão carregada para exportar em JSON.');
      }
      return {
        filename: `fieldcast-previsao-168h-${dateTag}.${ext}`,
        content: exportForecastToJson(forecast),
        format,
      };
    }
    if (dataset === 'waypoints') {
      return {
        filename: `fieldcast-waypoints-${dateTag}.${ext}`,
        content: exportFieldDataToJson({ waypoints }),
        format,
      };
    }
    if (dataset === 'tracks') {
      return {
        filename: `fieldcast-tracks-${dateTag}.${ext}`,
        content: exportFieldDataToJson({ tracks }),
        format,
      };
    }
    return {
      filename: `fieldcast-missao-completa-${dateTag}.${ext}`,
      content: exportFieldDataToJson({ waypoints, tracks, forecast }),
      format,
    };
  }

  if (format === 'gpx') {
    return {
      filename: `fieldcast-missao-${dateTag}.${ext}`,
      content: exportToGpx({
        waypoints: dataset === 'tracks' ? [] : waypoints,
        tracks: dataset === 'waypoints' ? [] : tracks,
        name: locationName ? `FieldCast — ${locationName}` : 'FieldCast Mission Export',
      }),
      format,
    };
  }

  if (format === 'kml') {
    return {
      filename: `fieldcast-missao-${dateTag}.${ext}`,
      content: exportToKml({
        waypoints: dataset === 'tracks' ? [] : waypoints,
        tracks: dataset === 'waypoints' ? [] : tracks,
        forecast: dataset === 'waypoints' || dataset === 'tracks' ? null : forecast,
        name: locationName ? `FieldCast — ${locationName}` : 'FieldCast Missão',
      }),
      format,
    };
  }

  if (format === 'kmz') {
    return {
      filename: `fieldcast-missao-${dateTag}.${ext}`,
      content: exportToKmz({
        waypoints: dataset === 'tracks' ? [] : waypoints,
        tracks: dataset === 'waypoints' ? [] : tracks,
        forecast: dataset === 'waypoints' || dataset === 'tracks' ? null : forecast,
        name: locationName ? `FieldCast — ${locationName}` : 'FieldCast Missão',
      }),
      format,
    };
  }

  // format === 'geojson'
  return {
    filename: `fieldcast-missao-${dateTag}.${ext}`,
    content: exportToGeoJson({
      waypoints: dataset === 'tracks' ? [] : waypoints,
      tracks: dataset === 'waypoints' ? [] : tracks,
      forecast: dataset === 'waypoints' || dataset === 'tracks' ? null : forecast,
    }),
    format,
  };
}

/**
 * Gera link `https://wa.me/?text=...` com resumo meteorológico/oceanográfico e de campo,
 * tentando `Share.share` no Android/iOS nativo ou abrindo nova aba no navegador.
 */
export function shareBulletinViaWhatsApp(params: {
  forecast: NormalizedForecast | null;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  waypointsCount?: number;
  tracksCount?: number;
  hourIndex?: number;
  openWindow?: boolean;
  isNativePlatformFn?: () => boolean;
}): { text: string; url: string } {
  const {
    forecast,
    locationName = 'Ponto de Missão',
    latitude,
    longitude,
    waypointsCount = 0,
    tracksCount = 0,
    hourIndex,
    openWindow = false,
    isNativePlatformFn,
  } = params;

  let base: { text: string; url: string };

  if (forecast) {
    base = buildWhatsAppShareUrl(forecast, locationName, hourIndex);
  } else {
    const latStr = typeof latitude === 'number' ? latitude.toFixed(4) : 'N/D';
    const lonStr = typeof longitude === 'number' ? longitude.toFixed(4) : 'N/D';
    const fallbackText = [
      `*FieldCast — Boletim Operacional*`,
      `Local: ${locationName} (${latStr}, ${lonStr})`,
      `Waypoints registrados: ${waypointsCount}`,
      `Rotas (Tracks) gravadas: ${tracksCount}`,
    ].join('\n');
    base = {
      text: fallbackText,
      url: `https://wa.me/?text=${encodeURIComponent(fallbackText)}`,
    };
  }

  if (forecast && (waypointsCount > 0 || tracksCount > 0)) {
    const extendedText = [
      base.text,
      `Campo: ${waypointsCount} waypoint(s) | ${tracksCount} rota(s) GPS`,
    ].join('\n');
    base = {
      text: extendedText,
      url: `https://wa.me/?text=${encodeURIComponent(extendedText)}`,
    };
  }

  if (openWindow) {
    const isNative =
      isNativePlatformFn?.() ??
      (() => {
        try {
          return Capacitor.isNativePlatform();
        } catch {
          return false;
        }
      })();

    const openWebLink = () => {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(base.url, '_blank', 'noopener,noreferrer');
      }
    };

    if (isNative) {
      void Share.share({
        title: `FieldCast — ${locationName}`,
        text: base.text,
        url: base.url,
        dialogTitle: 'Compartilhar Boletim via WhatsApp',
      }).catch(() => {
        openWebLink();
      });
    } else {
      openWebLink();
    }
  }

  return base;
}
