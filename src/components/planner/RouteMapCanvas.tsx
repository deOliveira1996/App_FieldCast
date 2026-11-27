import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Crosshair, Layers, Pencil, Waves, Wind } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import {
  createOfflineCartoTileLayer,
  type MapBaseStyle,
  type MapTileTheme,
  type OfflineCartoTileLayer,
} from '../../services/offlineTilesService';
import type {
  RouteCheckpointForecast,
  RouteForecast4DResult,
  RouteMissionCategory,
} from '../../services/routeForecastService';
import type { SafeWindowStatus } from '../../types/weather';
import { formatCardinalDirection } from '../../utils/exporters';
import type { RouteCheckpoint } from '../../utils/routeImporter';
import {
  formatAltitudeWithUnit,
  formatExactEtaDateTime,
  formatRelativeWindSummary,
  formatRouteDistance,
  formatRouteStatusLabel,
  getStatusBadgeClasses,
  ROUTE_DRAFT_HEX,
  ROUTE_STATUS_HEX,
  worstRouteStatus,
} from './routeDisplayUtils';

export interface RouteMapCanvasProps {
  centerLat: number;
  centerLon: number;
  checkpoints: readonly RouteCheckpoint[];
  forecastResult: RouteForecast4DResult | null;
  category: RouteMissionCategory;
  isDrawMode: boolean;
  isDark?: boolean;
  selectedCheckpointIndex: number | null;
  fitTrigger: number;
  onAddMapPoint: (lat: number, lon: number) => void;
  onSelectCheckpoint: (index: number) => void;
}

const BASE_STYLES: ReadonlyArray<{ id: MapBaseStyle; pt: string; en: string }> = [
  { id: 'osm', pt: 'Padrão', en: 'Standard' },
  { id: 'esri_street', pt: 'Costeiro', en: 'Coastal' },
  { id: 'esri_satellite', pt: 'Satélite', en: 'Satellite' },
];

function createCheckpointBadgeIcon(options: {
  shortCode: string;
  colorHex: string;
  isSelected: boolean;
}): L.DivIcon {
  const { shortCode, colorHex, isSelected } = options;
  const ringStyle = isSelected
    ? `box-shadow:0 0 0 4px rgba(255,255,255,0.95),0 0 0 7px ${colorHex},0 4px 12px rgba(15,23,42,0.45);transform:scale(1.12);`
    : 'box-shadow:0 2px 8px rgba(15,23,42,0.38);';

  return L.divIcon({
    className: 'fieldcast-route-checkpoint-pin',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:${colorHex};color:#ffffff;border:2.5px solid #ffffff;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;font-size:10px;font-weight:800;letter-spacing:-0.02em;${ringStyle}">${shortCode}</div>`,
  });
}

function RouteMapTileLayer({
  theme,
  baseStyle,
}: {
  theme: MapTileTheme;
  baseStyle: MapBaseStyle;
}): null {
  const map = useMap();
  const layerRef = useRef<OfflineCartoTileLayer | null>(null);

  useEffect(() => {
    try {
      const layer = createOfflineCartoTileLayer(theme, { baseStyle });
      layer.addTo(map);
      if (typeof layer.bringToBack === 'function') {
        layer.bringToBack();
      }
      layerRef.current = layer;
    } catch {
      // Ambiente de teste com mapa mockado
    }

    return () => {
      if (layerRef.current) {
        try {
          map.removeLayer?.(layerRef.current);
        } catch {
          // Ignora na desmontagem
        }
        layerRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (layerRef.current) {
      try {
        layerRef.current.setTheme(theme);
        layerRef.current.setBaseStyle(baseStyle);
      } catch {
        // Ignora em ambiente mockado
      }
    }
  }, [theme, baseStyle]);

  return null;
}

function RouteMapInteractionBridge({
  centerLat,
  centerLon,
  checkpoints,
  isDrawMode,
  fitTrigger,
  selectedCheckpointIndex,
  onAddMapPoint,
}: {
  centerLat: number;
  centerLon: number;
  checkpoints: readonly RouteCheckpoint[];
  isDrawMode: boolean;
  fitTrigger: number;
  selectedCheckpointIndex: number | null;
  onAddMapPoint: (lat: number, lon: number) => void;
}): null {
  const map = useMap();
  const prevFitTriggerRef = useRef<number>(fitTrigger);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        map.invalidateSize?.();
      } catch {
        // Ignora
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    if (prevFitTriggerRef.current === fitTrigger) return;
    prevFitTriggerRef.current = fitTrigger;

    try {
      if (checkpoints.length >= 2 && typeof map.fitBounds === 'function') {
        const latLngs = checkpoints.map((c) => [c.latitude, c.longitude] as [number, number]);
        map.fitBounds(latLngs, { padding: [36, 36], maxZoom: 13 });
      } else if (checkpoints.length === 1 && typeof map.setView === 'function') {
        map.setView([checkpoints[0]!.latitude, checkpoints[0]!.longitude], 11);
      } else if (typeof map.setView === 'function') {
        map.setView([centerLat, centerLon], 10);
      }
    } catch {
      // Ignora em ambiente mockado
    }
  }, [centerLat, centerLon, checkpoints, fitTrigger, map]);

  useEffect(() => {
    if (selectedCheckpointIndex === null) return;
    const cp = checkpoints[selectedCheckpointIndex];
    if (!cp) return;
    try {
      if (typeof map.panTo === 'function') {
        map.panTo([cp.latitude, cp.longitude], { animate: true });
      }
    } catch {
      // Ignora em ambiente mockado
    }
  }, [checkpoints, map, selectedCheckpointIndex]);

  useMapEvents({
    click(e) {
      if (!isDrawMode) return;
      onAddMapPoint(
        Number(e.latlng.lat.toFixed(5)),
        Number(e.latlng.lng.toFixed(5)),
      );
    },
  });

  return null;
}

export const RouteMapCanvas: React.FC<RouteMapCanvasProps> = ({
  centerLat,
  centerLon,
  checkpoints,
  forecastResult,
  category,
  isDrawMode,
  isDark = false,
  selectedCheckpointIndex,
  fitTrigger,
  onAddMapPoint,
  onSelectCheckpoint,
}) => {
  const { locale, isEn, tr } = useLocale();
  const { units, formatWindValue, formatTempValue, formatWaveValue, formatPrecipValue } = useUnits();
  const [baseStyle, setBaseStyle] = useState<MapBaseStyle>('osm');
  const [localFitCount, setLocalFitCount] = useState<number>(0);

  const forecastByIndex = useMemo(() => {
    const map = new Map<number, RouteCheckpointForecast>();
    if (forecastResult) {
      forecastResult.checkpoints.forEach((item, idx) => {
        map.set(idx, item);
      });
    }
    return map;
  }, [forecastResult]);

  const segments = useMemo(() => {
    const out: Array<{
      key: string;
      positions: [[number, number], [number, number]];
      color: string;
      status: SafeWindowStatus | 'draft';
    }> = [];

    for (let i = 0; i < checkpoints.length - 1; i++) {
      const a = checkpoints[i]!;
      const b = checkpoints[i + 1]!;
      const fA = forecastByIndex.get(i);
      const fB = forecastByIndex.get(i + 1);
      if (fA && fB) {
        const legStatus = worstRouteStatus(fA.status, fB.status);
        out.push({
          key: `seg-${i}-${legStatus}`,
          positions: [
            [a.latitude, a.longitude],
            [b.latitude, b.longitude],
          ],
          color: ROUTE_STATUS_HEX[legStatus],
          status: legStatus,
        });
      } else {
        out.push({
          key: `seg-draft-${i}`,
          positions: [
            [a.latitude, a.longitude],
            [b.latitude, b.longitude],
          ],
          color: ROUTE_DRAFT_HEX,
          status: 'draft',
        });
      }
    }
    return out;
  }, [checkpoints, forecastByIndex]);

  const markerIcons = useMemo(() => {
    return checkpoints.map((_cp, idx) => {
      const fc = forecastByIndex.get(idx);
      const colorHex = fc ? ROUTE_STATUS_HEX[fc.status] : ROUTE_DRAFT_HEX;
      return createCheckpointBadgeIcon({
        shortCode: `P${idx + 1}`,
        colorHex,
        isSelected: selectedCheckpointIndex === idx,
      });
    });
  }, [checkpoints, forecastByIndex, selectedCheckpointIndex]);

  const initialCenter: [number, number] =
    checkpoints.length > 0
      ? [checkpoints[0]!.latitude, checkpoints[0]!.longitude]
      : [centerLat, centerLon];

  return (
    <div
      data-testid="route-4d-map-wrapper"
      className="rounded-xl border border-slate-200 dark:border-sky-800/70 overflow-hidden bg-slate-100 dark:bg-slate-900"
    >
      {/* Barra superior do mapa: Estilo base, legenda de risco 4D e enquadramento */}
      <div className="px-3 py-2 bg-slate-50/95 dark:bg-[#0f243d] border-b border-slate-200 dark:border-sky-800/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex items-center rounded-xl bg-white dark:bg-slate-900 p-0.5 border border-slate-200 dark:border-sky-800">
            <Layers className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400 ml-2 mr-1" aria-hidden="true" />
            {BASE_STYLES.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setBaseStyle(st.id)}
                className={`min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                  baseStyle === st.id
                    ? 'bg-[#0080cd] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-sky-700'
                }`}
              >
                {isEn ? st.en : st.pt}
              </button>
            ))}
          </div>

          {isDrawMode && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 border border-sky-300 dark:border-sky-700">
              <Pencil className="w-3 h-3" aria-hidden="true" />
              {tr('Toque no mapa para adicionar P1 → Pn', 'Tap map to add P1 → Pn')}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {forecastResult && (
            <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-sky-800">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                {tr('Seguro', 'Safe')}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                {tr('Atenção', 'Caution')}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-300">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f43f5e]" />
                {tr('Restrito', 'No-Go')}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setLocalFitCount((c) => c + 1)}
            className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-sky-900/40 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            title={tr('Enquadrar toda a rota no mapa', 'Fit full route on map')}
          >
            <Crosshair className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
            <span>{tr('Enquadrar', 'Fit Route')}</span>
          </button>
        </div>
      </div>

      {/* Container Leaflet */}
      <div
        className={`relative w-full h-[320px] sm:h-[380px] z-0 ${isDrawMode ? 'cursor-crosshair' : ''}`}
      >
        <MapContainer
          center={initialCenter}
          zoom={10}
          scrollWheelZoom={true}
          className="w-full h-full z-0"
        >
          <RouteMapTileLayer theme={isDark ? 'dark' : 'light'} baseStyle={baseStyle} />

          <RouteMapInteractionBridge
            centerLat={centerLat}
            centerLon={centerLon}
            checkpoints={checkpoints}
            isDrawMode={isDrawMode}
            fitTrigger={fitTrigger + localFitCount}
            selectedCheckpointIndex={selectedCheckpointIndex}
            onAddMapPoint={onAddMapPoint}
          />

          {/* Segmentos da rota coloridos por risco 4D */}
          {segments.map((seg) => (
            <Polyline
              key={seg.key}
              positions={seg.positions}
              pathOptions={{
                color: seg.color,
                weight: seg.status === 'draft' ? 4 : 5,
                opacity: 0.92,
                dashArray: seg.status === 'draft' ? '8 6' : undefined,
              }}
            />
          ))}

          {/* Marcadores P1..Pn com Popups 4D */}
          {checkpoints.map((cp, idx) => {
            const fc = forecastByIndex.get(idx);
            const relWind = fc ? formatRelativeWindSummary(fc.relativeWind, isEn) : null;
            const statusStyle = fc ? getStatusBadgeClasses(fc.status) : null;
            const etaDisplay = fc ? formatExactEtaDateTime(fc.etaUnix, fc.timezone, locale) : null;

            return (
              <Marker
                key={`cp-${idx}-${cp.latitude.toFixed(5)}-${cp.longitude.toFixed(5)}`}
                position={[cp.latitude, cp.longitude]}
                icon={markerIcons[idx]}
                eventHandlers={{
                  click() {
                    onSelectCheckpoint(idx);
                  },
                }}
              >
                <Popup maxWidth={300}>
                  <div className="min-w-[220px] text-xs text-slate-800 space-y-1.5 font-sans">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1">
                      <strong className="text-slate-900 font-bold">
                        {cp.label === `P${idx + 1}` ? cp.label : `P${idx + 1} · ${cp.label}`}
                      </strong>
                      {fc && statusStyle && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusStyle.pill}`}
                        >
                          {formatRouteStatusLabel(fc.status, isEn)}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>
                        {tr('Dist.', 'Dist.')}:{' '}
                        <strong>{formatRouteDistance(cp.cumulativeDistanceKm, category, units.wind)}</strong>
                      </span>
                      {cp.bearingDeg !== null && (
                        <span>
                          {tr('Rumo', 'Bearing')}:{' '}
                          <strong>
                            {Math.round(cp.bearingDeg)}° {formatCardinalDirection(cp.bearingDeg)}
                          </strong>
                        </span>
                      )}
                    </div>

                    {fc ? (
                      <>
                        <div className="text-[11px] font-semibold text-sky-800 bg-sky-50 px-2 py-1 rounded-md">
                          ETA: {etaDisplay} ({fc.timezone})
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-0.5">
                          <div className="bg-slate-50 rounded p-1.5">
                            <div className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Wind className="w-3 h-3" />
                              {category === 'aerial'
                                ? `${tr('Vento', 'Wind')} ${fc.operationalAltitudeM}m`
                                : tr('Vento 10m', '10m Wind')}
                            </div>
                            <div className="font-bold text-slate-900">
                              {formatWindValue(fc.operationalWindKmh, 1)}{' '}
                              {fc.operationalWindDirDeg !== null
                                ? formatCardinalDirection(fc.operationalWindDirDeg)
                                : ''}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {tr('Rajada', 'Gust')}: {formatWindValue(fc.windGusts10mKmh, 1)}
                            </div>
                          </div>

                          <div className="bg-slate-50 rounded p-1.5">
                            <div className="text-[10px] text-slate-500">
                              {tr('Vento Relativo', 'Rel. Wind')}
                            </div>
                            <div className="font-bold text-slate-900">
                              {relWind?.label ?? '—'}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {tr('Chuva', 'Rain')}: {formatPrecipValue(fc.precipitationMm, 1)} (
                              {fc.precipitationProbabilityPct !== null
                                ? `${Math.round(fc.precipitationProbabilityPct)}%`
                                : '—'}
                              )
                            </div>
                          </div>

                          {category === 'navigation' ? (
                            <>
                              <div className="bg-slate-50 rounded p-1.5">
                                <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                  <Waves className="w-3 h-3" />
                                  {tr('Onda Hs / Período', 'Wave Hs / Period')}
                                </div>
                                <div className="font-bold text-slate-900">
                                  {fc.marineAvailable
                                    ? `${formatWaveValue(fc.waveHeightM, 2)} · ${fc.wavePeriodS !== null ? `${fc.wavePeriodS.toFixed(1)}s` : '—'}`
                                    : tr('Continental', 'Inland')}
                                </div>
                                {fc.waveDirectionDeg !== null && (
                                  <div className="text-[10px] text-slate-500">
                                    {Math.round(fc.waveDirectionDeg)}°{' '}
                                    {formatCardinalDirection(fc.waveDirectionDeg)}
                                  </div>
                                )}
                              </div>

                              <div className="bg-slate-50 rounded p-1.5">
                                <div className="text-[10px] text-slate-500">
                                  {tr('Corrente / Maré MSL', 'Current / Tide MSL')}
                                </div>
                                <div className="font-bold text-slate-900">
                                  {fc.marineAvailable
                                    ? `${formatWindValue(fc.oceanCurrentVelocityKmh, 1)} / ${formatWaveValue(fc.seaLevelHeightMslM, 2)}`
                                    : '—'}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {tr('Visib.', 'Vis.')}:{' '}
                                  {fc.visibilityM !== null
                                    ? `${(fc.visibilityM / 1000).toFixed(1)} km`
                                    : '—'}{' '}
                                  · {formatTempValue(fc.temperature2mC, 1)}
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="bg-slate-50 rounded p-1.5">
                                <div className="text-[10px] text-slate-500">
                                  {tr('Wind Shear / CAPE', 'Wind Shear / CAPE')}
                                </div>
                                <div className="font-bold text-slate-900">
                                  {fc.windShearKtPer100ft !== null
                                    ? `${fc.windShearKtPer100ft.toFixed(1)} kt/100ft`
                                    : '—'}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  CAPE: {fc.capeJkg !== null ? `${Math.round(fc.capeJkg)} J/kg` : '—'}
                                </div>
                              </div>

                              <div className="bg-slate-50 rounded p-1.5">
                                <div className="text-[10px] text-slate-500">
                                  {tr('Nuvens B/M/A · DEM', 'Clouds L/M/H · DEM')}
                                </div>
                                <div className="font-bold text-slate-900">
                                  {fc.cloudCoverLowPct !== null ? Math.round(fc.cloudCoverLowPct) : '—'}/
                                  {fc.cloudCoverMidPct !== null ? Math.round(fc.cloudCoverMidPct) : '—'}/
                                  {fc.cloudCoverHighPct !== null ? Math.round(fc.cloudCoverHighPct) : '—'}%
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  DEM: {formatAltitudeWithUnit(fc.elevationDemM, units.wave)} ·{' '}
                                  {fc.visibilityM !== null
                                    ? `${(fc.visibilityM / 1000).toFixed(1)} km`
                                    : '—'}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {fc.reasons.length > 0 && (
                          <div className="text-[10px] text-slate-600 border-t border-slate-200 pt-1">
                            {fc.reasons.slice(0, 2).join(' • ')}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-[11px] text-slate-500">
                        {cp.latitude.toFixed(4)}°, {cp.longitude.toFixed(4)}° —{' '}
                        {tr(
                          'Clique em "Calcular Previsão 4D" para obter o ETA e métricas.',
                          'Click "Compute 4D Forecast" to get ETA and weather metrics.',
                        )}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};

export default RouteMapCanvas;
