import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Circle,
  MapContainer,
  Marker,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  BookmarkPlus,
  Check,
  Crosshair,
  Layers,
  MapPin,
  Navigation,
  Sparkles,
} from 'lucide-react';
import {
  createOfflineCartoTileLayer,
  type MapBaseStyle,
  type MapTileTheme,
  type OfflineCartoTileLayer,
} from '../../services/offlineTilesService';
import type { LocationOrigin } from '../../types/field';
import { safeAction } from '../../utils/safeAction';

export interface LocationPinMapPickerProps {
  latitude?: number;
  longitude?: number;
  locationName?: string;
  activeLocation?: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  windSpeedKmh?: number | null;
  windDirectionDeg?: number | null;
  temperatureC?: number | null;
  height?: number | string;
  defaultInstantApply?: boolean;
  defaultRadiusKm?: number;
  isDark?: boolean;
  onSelectLocation?: (coords: {
    latitude: number;
    longitude: number;
    name: string;
    origin?: LocationOrigin;
  }) => void | Promise<void>;
  onSaveLocation?: (location: {
    name: string;
    latitude: number;
    longitude: number;
    region?: string;
    isFavorite?: boolean;
  }) => void | Promise<void>;
  className?: string;
}

const AREA_RADIUS_OPTIONS_KM = [0, 2, 5, 10, 25] as const;

const BASE_STYLE_OPTIONS: ReadonlyArray<{
  id: MapBaseStyle;
  label: string;
}> = [
  { id: 'osm', label: 'Mapa Padrão' },
  { id: 'esri_street', label: 'Costeiro / Ruas' },
  { id: 'esri_satellite', label: 'Satélite' },
];

export function degreesToCardinal(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) {
    return '';
  }
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const normalized = ((deg % 360) + 360) % 360;
  return dirs[Math.round(normalized / 45) % 8] ?? '';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Cria o ícone de Pin estilo bandeirinha do Windy (ponto branco + haste vertical + pílula flutuante).
 */
export function createWindyFlagPinIcon(options: {
  titleText: string;
  subtitleText: string;
  ctaText?: string;
  isPending?: boolean;
}): L.DivIcon {
  const safeTitle = escapeHtml(options.titleText);
  const safeSub = escapeHtml(options.subtitleText);
  const safeCta = options.ctaText ? escapeHtml(options.ctaText) : '';
  const dotColor = options.isPending ? '#f59e0b' : '#0284c7';

  return L.divIcon({
    className: 'fieldcast-windy-flag-pin',
    iconSize: [190, 76],
    iconAnchor: [16, 70],
    popupAnchor: [70, -64],
    html: `
      <div style="position:relative;width:190px;height:76px;pointer-events:auto;user-select:none;font-family:system-ui,-apple-system,sans-serif;">
        <div style="position:absolute;left:16px;top:4px;background:rgba(15,23,42,0.92);color:#ffffff;border-radius:10px;padding:5px 10px;box-shadow:0 6px 16px rgba(15,23,42,0.32);border:1px solid rgba(255,255,255,0.22);min-width:136px;backdrop-filter:blur(6px);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;font-weight:700;line-height:1.25;white-space:nowrap;">
            <span>${safeTitle}</span>
          </div>
          <div style="font-size:10px;color:#bae6fd;font-weight:600;line-height:1.25;margin-top:1px;white-space:nowrap;">
            ${safeSub}
          </div>
          ${
            safeCta
              ? `<div style="margin-top:3px;padding-top:2px;border-top:1px solid rgba(255,255,255,0.16);font-size:10px;font-weight:700;color:#fbbf24;display:flex;align-items:center;justify-content:space-between;">
                  <span>${safeCta}</span>
                  <span>&#8250;</span>
                </div>`
              : ''
          }
        </div>
        <div style="position:absolute;left:15px;top:36px;width:2.5px;height:30px;background:#0f172a;box-shadow:0 0 2px rgba(255,255,255,0.85);"></div>
        <div style="position:absolute;left:8px;top:62px;width:16px;height:16px;border-radius:9999px;background:#ffffff;border:3.5px solid ${dotColor};box-shadow:0 0 0 4px rgba(2,132,199,0.25),0 2px 6px rgba(15,23,42,0.45);"></div>
      </div>
    `,
  });
}

function MiniMapTileLayer({
  theme,
  baseStyle,
}: {
  theme: MapTileTheme;
  baseStyle: MapBaseStyle;
}): null {
  const map = useMap();
  const layerRef = useRef<OfflineCartoTileLayer | null>(null);

  useEffect(() => {
    const layer = createOfflineCartoTileLayer(theme, { baseStyle });
    layer.addTo(map);
    layer.bringToBack();
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.setTheme(theme);
      layerRef.current.setBaseStyle(baseStyle);
    }
  }, [theme, baseStyle]);

  return null;
}

function MiniMapInteractionBridge({
  pinLat,
  pinLon,
  recenterCount,
  onPickCoordinate,
}: {
  pinLat: number;
  pinLon: number;
  recenterCount: number;
  onPickCoordinate: (lat: number, lon: number) => void;
}): null {
  const map = useMap();
  const prevRef = useRef({ lat: pinLat, lon: pinLon, recenterCount });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 100);
    return () => window.clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    const prev = prevRef.current;
    const moved =
      Math.abs(prev.lat - pinLat) > 0.0001 ||
      Math.abs(prev.lon - pinLon) > 0.0001 ||
      prev.recenterCount !== recenterCount;

    if (moved) {
      prevRef.current = { lat: pinLat, lon: pinLon, recenterCount };
      map.panTo([pinLat, pinLon], { animate: true });
    }
  }, [pinLat, pinLon, recenterCount, map]);

  useMapEvents({
    click(e) {
      onPickCoordinate(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}

/**
 * Mini-Mapa Interativo de Pin Estilo Windy ("Colocar um Pin no Mapa para pegar a previsão").
 * Permite clicar ou arrastar o Pin em qualquer ponto/área costeira ou continental,
 * definir um raio de cobertura e atualizar a previsão com 1 clique.
 */
export function LocationPinMapPicker({
  latitude,
  longitude,
  locationName,
  activeLocation,
  windSpeedKmh,
  windDirectionDeg,
  temperatureC,
  height = 270,
  defaultInstantApply = true,
  defaultRadiusKm = 5,
  isDark = false,
  onSelectLocation,
  onSaveLocation,
  className = '',
}: LocationPinMapPickerProps): React.ReactElement {
  const resolvedActiveLat = activeLocation?.latitude ?? latitude ?? -27.5954;
  const resolvedActiveLon = activeLocation?.longitude ?? longitude ?? -48.548;
  const resolvedActiveName =
    activeLocation?.name ?? locationName ?? 'Ponto Selecionado';

  const [pinLat, setPinLat] = useState<number>(resolvedActiveLat);
  const [pinLon, setPinLon] = useState<number>(resolvedActiveLon);
  const [customName, setCustomName] = useState<string>('');
  const [instantApply, setInstantApply] = useState<boolean>(defaultInstantApply);
  const [areaRadiusKm, setAreaRadiusKm] = useState<number>(defaultRadiusKm);
  const [baseStyle, setBaseStyle] = useState<MapBaseStyle>('osm');
  const [recenterCount, setRecenterCount] = useState<number>(0);
  const [justApplied, setJustApplied] = useState<boolean>(false);

  useEffect(() => {
    setPinLat(resolvedActiveLat);
    setPinLon(resolvedActiveLon);
  }, [resolvedActiveLat, resolvedActiveLon]);

  const isMovedFromActive =
    Math.abs(pinLat - resolvedActiveLat) > 0.0003 ||
    Math.abs(pinLon - resolvedActiveLon) > 0.0003;

  const buildPinDisplayName = useCallback(
    (lat: number, lon: number, rawCustomName: string): string => {
      const trimmed = rawCustomName.trim();
      if (trimmed.length > 0) {
        return areaRadiusKm > 0 ? `${trimmed} (Área ${areaRadiusKm} km)` : trimmed;
      }
      const areaSuffix = areaRadiusKm > 0 ? ` • Área ${areaRadiusKm}km` : '';
      return `Pin no Mapa (${lat.toFixed(3)}, ${lon.toFixed(3)}${areaSuffix})`;
    },
    [areaRadiusKm],
  );

  const applyCoordinateToForecast = useCallback(
    (lat: number, lon: number, nameOverride?: string) => {
      if (!onSelectLocation) return;
      const targetName =
        nameOverride ?? buildPinDisplayName(lat, lon, customName);
      void safeAction(
        async () => {
          await onSelectLocation({
            latitude: Number(lat.toFixed(5)),
            longitude: Number(lon.toFixed(5)),
            name: targetName,
            origin: 'search',
          });
          setJustApplied(true);
          window.setTimeout(() => setJustApplied(false), 1800);
        },
        {
          actionKey: 'windy_pin_select_location',
          moduleName: 'LocationPinMapPicker',
        },
      );
    },
    [onSelectLocation, buildPinDisplayName, customName],
  );

  const handleMapPick = useCallback(
    (lat: number, lon: number) => {
      const roundedLat = Number(lat.toFixed(5));
      const roundedLon = Number(lon.toFixed(5));
      setPinLat(roundedLat);
      setPinLon(roundedLon);

      if (instantApply && onSelectLocation) {
        applyCoordinateToForecast(roundedLat, roundedLon);
      }
    },
    [instantApply, onSelectLocation, applyCoordinateToForecast],
  );

  const handleSavePinFavorite = (): void => {
    if (!onSaveLocation) return;
    const targetName = buildPinDisplayName(pinLat, pinLon, customName);
    void safeAction(
      async () => {
        await onSaveLocation({
          name: targetName,
          latitude: pinLat,
          longitude: pinLon,
          region:
            areaRadiusKm > 0
              ? `Pin Interativo (Raio ${areaRadiusKm} km)`
              : 'Pin Interativo no Mapa',
          isFavorite: true,
        });
      },
      {
        actionKey: 'windy_pin_save_favorite',
        moduleName: 'LocationPinMapPicker',
      },
    );
  };

  const flagPinIcon = useMemo(() => {
    const cardinal = degreesToCardinal(windDirectionDeg);
    const hasWeather =
      !isMovedFromActive &&
      windSpeedKmh !== null &&
      windSpeedKmh !== undefined &&
      Number.isFinite(windSpeedKmh);

    const titleText = hasWeather
      ? `${Math.round(windSpeedKmh)} km/h ${cardinal ? `◄ ${cardinal}` : ''}${
          temperatureC !== null && temperatureC !== undefined
            ? ` • ${Math.round(temperatureC)}°C`
            : ''
        }`
      : `${pinLat.toFixed(3)}°, ${pinLon.toFixed(3)}°`;

    const subtitleText = isMovedFromActive
      ? customName.trim() || 'Novo Pin Selecionado'
      : resolvedActiveName.slice(0, 24);

    return createWindyFlagPinIcon({
      titleText,
      subtitleText,
      ctaText: isMovedFromActive
        ? 'Previsão para este local'
        : areaRadiusKm > 0
          ? `Área de Previsão: ${areaRadiusKm} km`
          : 'Pin de Previsão Ativo',
      isPending: isMovedFromActive,
    });
  }, [
    windDirectionDeg,
    windSpeedKmh,
    temperatureC,
    isMovedFromActive,
    pinLat,
    pinLon,
    customName,
    resolvedActiveName,
    areaRadiusKm,
  ]);

  const resolvedHeightStyle =
    typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`rounded-2xl border border-sky-200/90 dark:border-sky-800/60 bg-white dark:bg-slate-900 shadow-sm overflow-hidden ${className}`}
    >
      {/* Barra Superior Clean: Título, Estilo de Mapa Base, Raio de Área e Modo Instantâneo */}
      <div className="px-3.5 py-2.5 bg-gradient-to-r from-sky-50/90 via-white to-sky-50/60 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/80 border-b border-sky-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-sky-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <MapPin className="w-4 h-4" aria-hidden="true" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-white">
                Pin Interativo de Previsão (Estilo Windy)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                Clique ou arraste o Pin
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Posicione o pin em qualquer ponto ou área costeira/continental para carregar a previsão exata
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Seletor de Mapa Base (Sem API Key) */}
          <div className="inline-flex items-center rounded-xl bg-sky-50/90 dark:bg-slate-800 p-0.5 border border-sky-200/80 dark:border-slate-700">
            <Layers
              className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 ml-2 mr-1"
              aria-hidden="true"
            />
            {BASE_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setBaseStyle(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                  baseStyle === opt.id
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-sky-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Seletor de Raio / Área de Previsão */}
          <div className="inline-flex items-center rounded-xl bg-sky-50/90 dark:bg-slate-800 p-0.5 border border-sky-200/80 dark:border-slate-700">
            {AREA_RADIUS_OPTIONS_KM.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setAreaRadiusKm(r)}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                  areaRadiusKm === r
                    ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-sm border border-sky-200/70 dark:border-slate-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-sky-700'
                }`}
                title={
                  r === 0
                    ? 'Previsão apenas no ponto exato do Pin'
                    : `Demarcar área circular de ${r} km ao redor do Pin`
                }
              >
                {r === 0 ? 'Ponto' : `${r} km`}
              </button>
            ))}
          </div>

          {/* Toggle Aplicar ao Clicar (Instantâneo como no Windy) */}
          <button
            type="button"
            onClick={() => setInstantApply((prev) => !prev)}
            aria-pressed={instantApply}
            className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-colors ${
              instantApply
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
            }`}
            title="Quando ativo, basta clicar em qualquer lugar do mapa para atualizar a previsão imediatamente"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{instantApply ? 'Pin Instantâneo: ON' : 'Pin Instantâneo: OFF'}</span>
          </button>
        </div>
      </div>

      {/* Área do Mini-Mapa Leaflet com Bandeirinha Windy e Círculo de Área */}
      <div
        className="relative w-full z-0"
        style={{ height: resolvedHeightStyle }}
      >
        <MapContainer
          center={[pinLat, pinLon]}
          zoom={11}
          scrollWheelZoom={true}
          className="w-full h-full z-0"
        >
          <MiniMapTileLayer
            theme={isDark ? 'dark' : 'light'}
            baseStyle={baseStyle}
          />

          <MiniMapInteractionBridge
            pinLat={pinLat}
            pinLon={pinLon}
            recenterCount={recenterCount}
            onPickCoordinate={handleMapPick}
          />

          {/* Círculo de Área/Raio ao redor do Pin */}
          {areaRadiusKm > 0 && (
            <Circle
              center={[pinLat, pinLon]}
              radius={areaRadiusKm * 1000}
              pathOptions={{
                color: '#0284c7',
                weight: 2,
                dashArray: '5 4',
                fillColor: '#38bdf8',
                fillOpacity: 0.14,
              }}
            />
          )}

          {/* Marcador Arrastável com Bandeirinha Estilo Windy */}
          <Marker
            position={[pinLat, pinLon]}
            icon={flagPinIcon}
            draggable={true}
            eventHandlers={{
              dragend(e) {
                const marker = e.target as L.Marker;
                const pos = marker.getLatLng();
                handleMapPick(pos.lat, pos.lng);
              },
              click() {
                if (onSelectLocation) {
                  applyCoordinateToForecast(pinLat, pinLon);
                }
              },
            }}
          />
        </MapContainer>

        {/* Botão Flutuante de Centralizar no Pin */}
        <button
          type="button"
          onClick={() => setRecenterCount((c) => c + 1)}
          className="absolute top-2.5 right-2.5 z-[400] min-h-[38px] px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-sky-50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-slate-700 shadow-md text-xs font-semibold inline-flex items-center gap-1.5 backdrop-blur-sm"
          title="Centralizar mapa no Pin"
        >
          <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Centralizar Pin</span>
        </button>
      </div>

      {/* Barra Inferior Flutuante: Coordenadas do Pin, Nome Opcional e Botão "Previsão para este local" */}
      <div className="px-3.5 py-2.5 bg-sky-50/50 dark:bg-slate-900/95 border-t border-sky-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-sky-200/80 dark:border-slate-700 text-xs font-mono font-bold text-sky-900 dark:text-sky-200">
            <Navigation className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
            <span>
              {pinLat.toFixed(4)}°, {pinLon.toFixed(4)}°
            </span>
            {areaRadiusKm > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 text-[10px] font-sans font-semibold">
                Raio {areaRadiusKm} km
              </span>
            )}
          </div>

          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Nome opcional para este Pin / Área..."
            aria-label="Nome opcional para o ponto marcado no mapa"
            className="flex-1 min-w-[180px] min-h-[38px] px-3 py-1.5 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onSaveLocation && (
            <button
              type="button"
              onClick={handleSavePinFavorite}
              className="min-h-[40px] px-3 py-1.5 rounded-xl border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-sky-800 dark:text-sky-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
              title="Salvar este Pin nos locais favoritos"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
              <span>Salvar Pin</span>
            </button>
          )}

          {onSelectLocation && (
            <button
              type="button"
              onClick={() => applyCoordinateToForecast(pinLat, pinLon)}
              className="min-h-[40px] px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors"
            >
              {justApplied ? (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>Previsão Atualizada!</span>
                </>
              ) : (
                <>
                  <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Obter Previsão Neste Pin</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default LocationPinMapPicker;
