import { normalizeAngleDeg } from './ensembleMath';
import { computeTrackDistanceKm, haversineDistanceKm } from './exporters';

export interface ImportedRoutePoint {
  latitude: number;
  longitude: number;
  name?: string;
  altitudeM?: number | null;
}

export type ImportedRouteFormat = 'gpx' | 'kml' | 'kmz' | 'geojson' | 'csv' | 'manual';

export interface ParsedRouteTrack {
  name: string;
  format: ImportedRouteFormat;
  rawPointCount: number;
  points: ImportedRoutePoint[];
  totalDistanceKm: number;
}

export interface RouteCheckpoint {
  index: number;
  label: string;
  latitude: number;
  longitude: number;
  altitudeM?: number | null;
  legDistanceKm: number;
  cumulativeDistanceKm: number;
  bearingDeg: number | null;
}

export type RelativeWindClass = 'headwind' | 'tailwind' | 'crosswind';

export interface RelativeWindAnalysis {
  /** Ângulo absoluto [0..180°]: 0° = proa pura (headwind), 90° = través (crosswind), 180° = popa (tailwind). */
  relativeAngleDeg: number;
  /** Diferença angular assinada em [-180..+180°] (`windFromDeg - legBearingDeg`). */
  signedAngleDeg: number;
  classification: RelativeWindClass;
  /** Fator de componente de proa (`cos(rel)`): +1 proa pura, -1 popa pura. */
  headwindFactor: number;
  /** Fator de componente de través (`|sin(rel)|`): 0..1. */
  crosswindFactor: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Calcula o azimute inicial verdadeiro (bearing em graus `[0, 360)`) de `(lat1, lon1)` até `(lat2, lon2)`.
 */
export function computeBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = (lon2 - lon1) * DEG_TO_RAD;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) {
    return 0;
  }

  return Number(normalizeAngleDeg(Math.atan2(y, x) * RAD_TO_DEG).toFixed(1));
}

/**
 * Calcula o ângulo relativo entre a direção meteorológica do vento (`windFromDeg`, de onde sopra)
 * e o rumo da perna da rota (`legBearingDeg`, para onde se desloca), classificando em:
 * - `'headwind'` (proa, `<= 45°`)
 * - `'tailwind'` (popa, `>= 135°`)
 * - `'crosswind'` (través, `45°..135°`)
 */
export function computeRelativeWindAngleDeg(
  windFromDeg: number,
  legBearingDeg: number,
): RelativeWindAnalysis {
  const w = normalizeAngleDeg(windFromDeg);
  const b = normalizeAngleDeg(legBearingDeg);
  const rawSigned = ((w - b + 540) % 360) - 180;
  const signedAngleDeg = Number(rawSigned.toFixed(1));
  const relativeAngleDeg = Number(Math.abs(rawSigned).toFixed(1));

  let classification: RelativeWindClass;
  if (relativeAngleDeg <= 45) {
    classification = 'headwind';
  } else if (relativeAngleDeg >= 135) {
    classification = 'tailwind';
  } else {
    classification = 'crosswind';
  }

  const relRad = relativeAngleDeg * DEG_TO_RAD;
  const headwindFactor = Number(Math.cos(relRad).toFixed(4));
  const crosswindFactor = Number(Math.abs(Math.sin(relRad)).toFixed(4));

  return {
    relativeAngleDeg,
    signedAngleDeg,
    classification,
    headwindFactor,
    crosswindFactor,
  };
}

/**
 * Constrói checkpoints operacionais com distância por perna, distância acumulada (Haversine)
 * e azimute de avanço (`bearingDeg`), reamostrando uniformemente trilhas longas para `<= maxCheckpoints`
 * preservando sempre o ponto inicial exato (P1) e o destino final exato (Pn).
 */
export function buildCheckpointsFromPoints(
  points: readonly ImportedRoutePoint[],
  maxCheckpoints = 18,
): RouteCheckpoint[] {
  const valid: ImportedRoutePoint[] = [];
  for (const pt of points) {
    if (!pt || !isValidLatLon(pt.latitude, pt.longitude)) {
      continue;
    }
    const prev = valid[valid.length - 1];
    if (
      prev &&
      Math.abs(prev.latitude - pt.latitude) < 1e-6 &&
      Math.abs(prev.longitude - pt.longitude) < 1e-6
    ) {
      continue;
    }
    valid.push({
      latitude: pt.latitude,
      longitude: pt.longitude,
      ...(pt.name?.trim() ? { name: pt.name.trim() } : {}),
      ...(typeof pt.altitudeM === 'number' && Number.isFinite(pt.altitudeM)
        ? { altitudeM: pt.altitudeM }
        : {}),
    });
  }

  if (valid.length === 0) {
    return [];
  }

  const limit = Math.max(2, Math.floor(maxCheckpoints));
  let selected: ImportedRoutePoint[];

  if (valid.length <= limit) {
    selected = valid;
  } else {
    // Reamostragem uniforme ao longo da distância acumulada preservando P1 e Pn exatos
    const cumDistances: number[] = [0];
    let running = 0;
    for (let i = 1; i < valid.length; i++) {
      const prev = valid[i - 1]!;
      const curr = valid[i]!;
      running += haversineDistanceKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      cumDistances.push(running);
    }

    const totalDist = running;
    selected = [valid[0]!];

    if (totalDist <= 1e-6) {
      for (let k = 1; k < limit - 1; k++) {
        const idx = Math.round((k * (valid.length - 1)) / (limit - 1));
        selected.push(valid[idx]!);
      }
    } else {
      let segIdx = 0;
      for (let k = 1; k < limit - 1; k++) {
        const targetDist = (k / (limit - 1)) * totalDist;
        while (segIdx < valid.length - 2 && cumDistances[segIdx + 1]! < targetDist) {
          segIdx += 1;
        }
        const d0 = cumDistances[segIdx]!;
        const d1 = cumDistances[segIdx + 1]!;
        const p0 = valid[segIdx]!;
        const p1 = valid[segIdx + 1]!;
        const segLen = d1 - d0;
        const t = segLen > 1e-9 ? Math.max(0, Math.min(1, (targetDist - d0) / segLen)) : 0;

        const interpLat = p0.latitude + (p1.latitude - p0.latitude) * t;
        const interpLon = p0.longitude + (p1.longitude - p0.longitude) * t;
        const interpAlt =
          typeof p0.altitudeM === 'number' && typeof p1.altitudeM === 'number'
            ? Number((p0.altitudeM + (p1.altitudeM - p0.altitudeM) * t).toFixed(1))
            : (p0.altitudeM ?? p1.altitudeM ?? null);

        const inheritedName = t < 0.15 ? p0.name : t > 0.85 ? p1.name : undefined;

        selected.push({
          latitude: Number(interpLat.toFixed(6)),
          longitude: Number(interpLon.toFixed(6)),
          ...(inheritedName ? { name: inheritedName } : {}),
          ...(interpAlt !== null ? { altitudeM: interpAlt } : {}),
        });
      }
    }

    selected.push(valid[valid.length - 1]!);
  }

  let cumulativeKm = 0;
  const checkpoints: RouteCheckpoint[] = selected.map((pt, idx) => {
    const legDistanceKm =
      idx === 0
        ? 0
        : Number(
            haversineDistanceKm(
              selected[idx - 1]!.latitude,
              selected[idx - 1]!.longitude,
              pt.latitude,
              pt.longitude,
            ).toFixed(3),
          );
    cumulativeKm = Number((cumulativeKm + legDistanceKm).toFixed(3));

    return {
      index: idx,
      label: pt.name?.trim() || `P${idx + 1}`,
      latitude: pt.latitude,
      longitude: pt.longitude,
      ...(pt.altitudeM !== undefined ? { altitudeM: pt.altitudeM } : {}),
      legDistanceKm,
      cumulativeDistanceKm: cumulativeKm,
      bearingDeg: null,
    };
  });

  for (let i = 0; i < checkpoints.length; i++) {
    if (i < checkpoints.length - 1) {
      const curr = checkpoints[i]!;
      const next = checkpoints[i + 1]!;
      curr.bearingDeg = computeBearingDeg(
        curr.latitude,
        curr.longitude,
        next.latitude,
        next.longitude,
      );
    } else if (i > 0) {
      checkpoints[i]!.bearingDeg = checkpoints[i - 1]!.bearingDeg;
    }
  }

  return checkpoints;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function stripBaseFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  return base || 'Rota Importada';
}

function parseGpxText(text: string, fallbackName: string): ParsedRouteTrack {
  const extractTagName = (block: string): string | undefined => {
    const m = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(block);
    const cleaned = m?.[1] ? decodeXmlEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
    return cleaned || undefined;
  };

  const trackBlockMatch = /<(?:trk|rte)\b[^>]*>([\s\S]*?)<\/(?:trk|rte)>/i.exec(text);
  const metadataMatch = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i.exec(text);
  const routeName =
    (trackBlockMatch?.[1] ? extractTagName(trackBlockMatch[1]) : undefined) ??
    (metadataMatch?.[1] ? extractTagName(metadataMatch[1]) : undefined) ??
    fallbackName;

  const extractPointsByTag = (tag: 'trkpt' | 'rtept' | 'wpt'): ImportedRoutePoint[] => {
    const regex = new RegExp(
      `<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`,
      'gi',
    );
    const found: ImportedRoutePoint[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const attrs = match[1] ?? '';
      const inner = match[2] ?? '';
      const latMatch = /\blat\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const lonMatch = /\blon\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!latMatch || !lonMatch) continue;

      const lat = Number(latMatch[1]);
      const lon = Number(lonMatch[1]);
      if (!isValidLatLon(lat, lon)) continue;

      const name = inner ? extractTagName(inner) : undefined;
      const eleMatch = inner ? /<ele[^>]*>([^<]+)<\/ele>/i.exec(inner) : null;
      const altVal = eleMatch?.[1] ? Number(eleMatch[1].trim()) : null;

      found.push({
        latitude: lat,
        longitude: lon,
        ...(name ? { name } : {}),
        ...(altVal !== null && Number.isFinite(altVal) ? { altitudeM: altVal } : {}),
      });
    }
    return found;
  };

  const trkPts = extractPointsByTag('trkpt');
  const rtePts = trkPts.length > 0 ? [] : extractPointsByTag('rtept');
  const wptPts = trkPts.length > 0 || rtePts.length > 0 ? [] : extractPointsByTag('wpt');
  const points = trkPts.length > 0 ? trkPts : rtePts.length > 0 ? rtePts : wptPts;

  if (points.length === 0) {
    throw new Error('Nenhum ponto válido (<trkpt>, <rtept> ou <wpt>) encontrado no arquivo GPX.');
  }

  return {
    name: routeName,
    format: 'gpx',
    rawPointCount: points.length,
    points,
    totalDistanceKm: computeTrackDistanceKm(points),
  };
}

function parseKmlCoordinatesText(rawCoords: string): ImportedRoutePoint[] {
  const tokens = rawCoords
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const pts: ImportedRoutePoint[] = [];
  for (const token of tokens) {
    const parts = token.split(',');
    if (parts.length < 2) continue;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    const alt = parts.length >= 3 ? Number(parts[2]) : null;
    if (!isValidLatLon(lat, lon)) continue;
    pts.push({
      latitude: lat,
      longitude: lon,
      ...(alt !== null && Number.isFinite(alt) ? { altitudeM: alt } : {}),
    });
  }
  return pts;
}

function parseKmlText(
  text: string,
  fallbackName: string,
  format: 'kml' | 'kmz' = 'kml',
): ParsedRouteTrack {
  const docNameMatch = /<Document\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i.exec(text);
  const anyNameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(text);
  const rawName = docNameMatch?.[1] ?? anyNameMatch?.[1] ?? '';
  const routeName =
    decodeXmlEntities(rawName.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) || fallbackName;

  // Prioriza LineString (rota contínua); faz fallback para qualquer bloco <coordinates> (Placemarks/Points)
  const linePoints: ImportedRoutePoint[] = [];
  const lineStringRegex = /<LineString\b[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/gi;
  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = lineStringRegex.exec(text)) !== null) {
    linePoints.push(...parseKmlCoordinatesText(lineMatch[1] ?? ''));
  }

  let points = linePoints;

  if (points.length === 0) {
    const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
    const pmPoints: ImportedRoutePoint[] = [];
    let pmMatch: RegExpExecArray | null;
    while ((pmMatch = placemarkRegex.exec(text)) !== null) {
      const body = pmMatch[1] ?? '';
      const pmNameMatch = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(body);
      const pmName = pmNameMatch?.[1]
        ? decodeXmlEntities(pmNameMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
        : undefined;
      const coordRegex = /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = coordRegex.exec(body)) !== null) {
        const parsed = parseKmlCoordinatesText(cMatch[1] ?? '');
        parsed.forEach((pt, idx) => {
          pmPoints.push({
            ...pt,
            ...(pmName && idx === 0 ? { name: pmName } : {}),
          });
        });
      }
    }
    points = pmPoints;
  }

  if (points.length === 0) {
    const anyCoordRegex = /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
    let cMatch: RegExpExecArray | null;
    const fallbackPts: ImportedRoutePoint[] = [];
    while ((cMatch = anyCoordRegex.exec(text)) !== null) {
      fallbackPts.push(...parseKmlCoordinatesText(cMatch[1] ?? ''));
    }
    points = fallbackPts;
  }

  if (points.length === 0) {
    throw new Error(`Nenhuma coordenada válida encontrada no arquivo ${format.toUpperCase()}.`);
  }

  return {
    name: routeName,
    format,
    rawPointCount: points.length,
    points,
    totalDistanceKm: computeTrackDistanceKm(points),
  };
}

interface GlobalWithDecompressionStream {
  DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const ctor = (globalThis as unknown as GlobalWithDecompressionStream).DecompressionStream;
  if (typeof ctor !== 'function') {
    throw new Error(
      'KMZ compactado (Deflate) requer suporte nativo a DecompressionStream neste navegador.',
    );
  }
  const ds = new ctor('deflate-raw');
  const writer = ds.writable.getWriter();
  await writer.write(compressed);
  await writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLen += value.byteLength;
    }
  }
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Leitor PKZIP 100% TypeScript puro para arquivos `.kmz` (suporta Stored método 0 e Deflate método 8).
 */
async function extractFirstKmlFromKmzBytes(zipBytes: Uint8Array): Promise<string> {
  if (zipBytes.byteLength < 22) {
    throw new Error('Arquivo KMZ inválido ou truncado.');
  }

  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  // 1. Tenta localizar End of Central Directory (EOCD: 0x06054b50) para lidar com data descriptors
  let eocdOffset = -1;
  const minScan = Math.max(0, zipBytes.byteLength - 65_557);
  for (let i = zipBytes.byteLength - 22; i >= minScan; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    let cursor = cdOffset;
    const cdEnd = Math.min(zipBytes.byteLength, cdOffset + cdSize);

    while (cursor + 46 <= cdEnd && view.getUint32(cursor, true) === 0x02014b50) {
      const method = view.getUint16(cursor + 10, true);
      const compSize = view.getUint32(cursor + 20, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const localHeaderOffset = view.getUint32(cursor + 42, true);

      const entryName = decoder.decode(
        zipBytes.subarray(cursor + 46, cursor + 46 + nameLen),
      );

      if (entryName.toLowerCase().endsWith('.kml')) {
        if (localHeaderOffset + 30 > zipBytes.byteLength) {
          throw new Error('Cabeçalho local KMZ fora dos limites do arquivo.');
        }
        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compSize;
        if (dataEnd > zipBytes.byteLength) {
          throw new Error('Payload KML truncado dentro do arquivo KMZ.');
        }
        const rawPayload = zipBytes.subarray(dataStart, dataEnd);
        if (method === 0) {
          return decoder.decode(rawPayload);
        }
        if (method === 8) {
          const inflated = await inflateRawBytes(rawPayload);
          return decoder.decode(inflated);
        }
        throw new Error(`Método de compressão ZIP não suportado no KMZ (método ${method}).`);
      }

      cursor += 46 + nameLen + extraLen + commentLen;
    }
  }

  // 2. Fallback sequencial via Local File Headers (0x04034b50)
  let offset = 0;
  while (offset + 30 <= zipBytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const entryName = decoder.decode(zipBytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > zipBytes.byteLength) {
      break;
    }
    if (entryName.toLowerCase().endsWith('.kml')) {
      const rawPayload = zipBytes.subarray(dataStart, dataEnd);
      if (method === 0) {
        return decoder.decode(rawPayload);
      }
      if (method === 8) {
        const inflated = await inflateRawBytes(rawPayload);
        return decoder.decode(inflated);
      }
      throw new Error(`Método de compressão ZIP não suportado no KMZ (método ${method}).`);
    }
    offset = dataEnd;
  }

  throw new Error('Nenhum arquivo .kml encontrado dentro do pacote KMZ.');
}

function extractGeoJsonCoords(
  geometry: unknown,
  featureName?: string,
): ImportedRoutePoint[] {
  if (!geometry || typeof geometry !== 'object') {
    return [];
  }
  const g = geometry as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  const pts: ImportedRoutePoint[] = [];

  const pushTuple = (tuple: unknown, label?: string) => {
    if (!Array.isArray(tuple) || tuple.length < 2) return;
    const lon = Number(tuple[0]);
    const lat = Number(tuple[1]);
    const alt = tuple.length >= 3 ? Number(tuple[2]) : null;
    if (!isValidLatLon(lat, lon)) return;
    pts.push({
      latitude: lat,
      longitude: lon,
      ...(label ? { name: label } : {}),
      ...(alt !== null && Number.isFinite(alt) ? { altitudeM: alt } : {}),
    });
  };

  if (g.type === 'Point') {
    pushTuple(g.coordinates, featureName);
  } else if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    g.coordinates.forEach((coord, idx) => pushTuple(coord, idx === 0 ? featureName : undefined));
  } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    for (const line of g.coordinates) {
      if (Array.isArray(line)) {
        line.forEach((coord) => pushTuple(coord));
      }
    }
  } else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    for (const child of g.geometries) {
      pts.push(...extractGeoJsonCoords(child, featureName));
    }
  }

  return pts;
}

function parseGeoJsonText(text: string, fallbackName: string): ParsedRouteTrack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Arquivo GeoJSON inválido (erro de sintaxe JSON).');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Estrutura GeoJSON inválida.');
  }

  const root = parsed as {
    type?: string;
    name?: string;
    features?: Array<{
      type?: string;
      geometry?: unknown;
      properties?: Record<string, unknown> | null;
    }>;
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
  };

  let routeName =
    typeof root.name === 'string' && root.name.trim() ? root.name.trim() : fallbackName;
  const linePoints: ImportedRoutePoint[] = [];
  const pointFeatures: ImportedRoutePoint[] = [];

  if (root.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const feat of root.features) {
      const fName =
        typeof feat.properties?.name === 'string' && feat.properties.name.trim()
          ? feat.properties.name.trim()
          : undefined;
      if (fName && routeName === fallbackName) {
        routeName = fName;
      }
      const geomType = (feat.geometry as { type?: string } | undefined)?.type;
      const extracted = extractGeoJsonCoords(feat.geometry, fName);
      if (geomType === 'LineString' || geomType === 'MultiLineString') {
        linePoints.push(...extracted);
      } else {
        pointFeatures.push(...extracted);
      }
    }
  } else if (root.type === 'Feature') {
    const fName =
      typeof root.properties?.name === 'string' && root.properties.name.trim()
        ? root.properties.name.trim()
        : undefined;
    if (fName) routeName = fName;
    linePoints.push(...extractGeoJsonCoords(root.geometry, fName));
  } else {
    linePoints.push(...extractGeoJsonCoords(root));
  }

  const points = linePoints.length > 0 ? linePoints : pointFeatures;
  if (points.length === 0) {
    throw new Error(
      'Nenhuma geometria válida (LineString, MultiLineString ou Point) encontrada no GeoJSON.',
    );
  }

  return {
    name: routeName,
    format: 'geojson',
    rawPointCount: points.length,
    points,
    totalDistanceKm: computeTrackDistanceKm(points),
  };
}

function splitCsvRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvNumber(raw: string | undefined): number {
  if (!raw) return Number.NaN;
  const cleaned = raw.trim().replace(',', '.');
  return Number(cleaned);
}

function parseCsvText(text: string, fallbackName: string): ParsedRouteTrack {
  const withoutBom = text.replace(/^\uFEFF/, '');
  const lines = withoutBom
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('Arquivo CSV vazio ou sem linhas de coordenadas suficientes.');
  }

  const headerLine = lines[0]!;
  const semicolonCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const delimiter =
    semicolonCount > commaCount && semicolonCount >= tabCount
      ? ';'
      : tabCount > commaCount
        ? '\t'
        : ',';

  const headers = splitCsvRow(headerLine, delimiter).map((h) =>
    h
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]/g, ''),
  );

  const findColIndex = (candidates: readonly string[]): number =>
    headers.findIndex((h) => candidates.includes(h));

  const latIdx = findColIndex(['lat', 'latitude', 'lat_deg', 'latdeg', 'y']);
  const lonIdx = findColIndex(['lon', 'lng', 'long', 'longitude', 'lon_deg', 'londeg', 'x']);
  const nameIdx = findColIndex(['name', 'nome', 'label', 'waypoint', 'ponto', 'checkpoint', 'id']);
  const altIdx = findColIndex(['alt', 'altitude', 'alt_m', 'ele', 'elevation', 'elev']);

  if (latIdx < 0 || lonIdx < 0) {
    throw new Error(
      'Cabeçalho CSV não reconhecido: inclua colunas de latitude (lat/latitude) e longitude (lon/lng/longitude).',
    );
  }

  const points: ImportedRoutePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i]!, delimiter);
    const lat = parseCsvNumber(cols[latIdx]);
    const lon = parseCsvNumber(cols[lonIdx]);
    if (!isValidLatLon(lat, lon)) continue;

    const name = nameIdx >= 0 ? cols[nameIdx]?.trim() || undefined : undefined;
    const alt = altIdx >= 0 ? parseCsvNumber(cols[altIdx]) : Number.NaN;

    points.push({
      latitude: lat,
      longitude: lon,
      ...(name ? { name } : {}),
      ...(Number.isFinite(alt) ? { altitudeM: alt } : {}),
    });
  }

  if (points.length === 0) {
    throw new Error('Nenhuma coordenada válida encontrada nas linhas do arquivo CSV.');
  }

  return {
    name: fallbackName,
    format: 'csv',
    rawPointCount: points.length,
    points,
    totalDistanceKm: computeTrackDistanceKm(points),
  };
}

function isPkZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/**
 * Faz o parse universal client-side de arquivos de rota (`.gpx`, `.kml`, `.kmz`, `.geojson`/`.json`, `.csv`).
 */
export async function parseRouteFileContent(
  filename: string,
  content: string | Uint8Array,
): Promise<ParsedRouteTrack> {
  const lowerName = filename.trim().toLowerCase();
  const fallbackName = stripBaseFilename(filename);

  const isKmzByExt = lowerName.endsWith('.kmz');
  if (content instanceof Uint8Array && (isKmzByExt || isPkZipMagic(content))) {
    const kmlText = await extractFirstKmlFromKmzBytes(content);
    return parseKmlText(kmlText, fallbackName, 'kmz');
  }

  if (typeof content === 'string' && isKmzByExt) {
    const rawBytes = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) {
      rawBytes[i] = content.charCodeAt(i) & 0xff;
    }
    const kmlText = await extractFirstKmlFromKmzBytes(rawBytes);
    return parseKmlText(kmlText, fallbackName, 'kmz');
  }

  const text =
    content instanceof Uint8Array
      ? new TextDecoder('utf-8').decode(content)
      : content;

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Arquivo de rota vazio.');
  }

  if (lowerName.endsWith('.gpx') || /<gpx\b/i.test(trimmed)) {
    return parseGpxText(trimmed, fallbackName);
  }
  if (lowerName.endsWith('.kml') || /<kml\b/i.test(trimmed)) {
    return parseKmlText(trimmed, fallbackName, 'kml');
  }
  if (
    lowerName.endsWith('.geojson') ||
    lowerName.endsWith('.json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')
  ) {
    return parseGeoJsonText(trimmed, fallbackName);
  }
  return parseCsvText(trimmed, fallbackName);
}
