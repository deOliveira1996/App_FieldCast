import React, { useEffect, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import {
  Bookmark,
  Check,
  Compass,
  Crosshair,
  Layers,
  MapPin,
  Navigation,
  Sparkles,
} from 'lucide-react';
import type { ActiveCoordinates, SavedLocation } from '../../types/field';
import type { ToastMessage } from '../../types/health';
import { safeAction } from '../../utils/safeAction';
import { degreesToCardinalShort } from './CurrentSummaryCard';

export type MiniMapBaseLayerId = 'osm' | 'esri_street' | 'esri_satellite';

interface BaseLayerOption {
  id: MiniMapBaseLayerId;
  label: string;
  url: string;
  attribution: string;
}

const BASE_LAYERS: ReadonlyArray<BaseLayerOption> = [
  {
    id: 'osm',
    label: 'Mapa Padrão',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    id: 'esri_street',
    label: 'Costeiro & Relevo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
  {
    id: 'esri_satellite',
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
];

const RADIUS_OPTIONS_KM: ReadonlyArray<{ km: number; label: string }> = [
  { km: 0, label: 'Ponto Exato' },
  { km: 2, label: 'Área 2 km' },
  { km: 5, label: 'Área 5 km' },
  { km: 10, label: 'Área 10 km' },
  { km: 25, label: 'Área 25 km' },
];

/**
 * Creates a Windy-style Weather Flag Pin (`media_1795368639016_31126363.jpg`):
 * - White circle dot anchored at the exact map coordinate
 * - Vertical stem rising up
 * - Floating pill flag showing wind speed & direction + "Previsão para este local"
 */
function createWindyFlagPinIcon(windSummaryText: string): L.DivIcon {
  return L.divIcon({
    className: 'fieldcast-windy-flag-pin',
    iconSize: [180, 68],
    iconAnchor: [14, 62],
    html: `
      <div style="position:relative;width:180px;height:68px;pointer-events:auto;font-family:system-ui,-apple-system,sans-serif;">
        <div style="position:absolute;left:14px;top:4px;background:rgba(15,23,42,0.88);backdrop-filter:blur(6px);color:#ffffff;border-radius:10px;padding:4px 10px;box-shadow:0 4px 14px rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,0.22);white-space:nowrap;">
          <div style="font-size:12px;font-weight:800;line-height:1.2;display:flex;align-items:center;gap:6px;">
            <span>${windSummaryText}</span>
          </div>
          <div style="font-size:10px;font-weight:600;color:#fde047;line-height:1.2;margin-top:1px;">
            Previsão para este local ▾
          </div>
        </div>
        <div style="position:absolute;left:13px;top:38px;width:2.5px;height:22px;background:#0f172a;box-shadow:0 0 3px rgba(255,255,255,0.8);"></div>
        <div style="position:absolute;left:7px;top:55px;width:14px;height:14px;border-radius:9999px;background:#ffffff;border:3px solid #0080cd;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
      </div>
    `,
  });
}

const MapClickAndSyncController: React.FC<{
  centerLat: number;
  centerLon: number;
  onPickCoordinates: (lat: number, lon: number) => void;
}> = ({ centerLat, centerLon, onPickCoordinates }) => {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch {
        // Ignore in headless test environment
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    try {
      const current = map.getCenter();
      const dist = Math.hypot(current.lat - centerLat, current.lng - centerLon);
      if (dist > 0.0005) {
        map.setView([centerLat, centerLon], map.getZoom(), { animate: true });
      }
    } catch {
      // Ignore in headless test environment
    }
  }, [centerLat, centerLon, map]);

  useMapEvents({
    click(event) {
      onPickCoordinates(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
};

export interface ForecastPinMiniMapProps {
  activeLocation: ActiveCoordinates;
  savedLocations?: SavedLocation[];
  currentWindSpeedKmh?: number | null;
  currentWindDirectionDeg?: number | null;
  onSelectLocation?: (coords: {
    latitude: number;
    longitude: number;
    name: string;
    origin?: ActiveCoordinates['origin'];
  }) => void | Promise<void>;
  onSaveLocation?: (location: {
    name: string;
    latitude: number;
    longitude: number;
    region?: string;
    isFavorite?: boolean;
  }) => void | Promise<void>;
  onRequestGps?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onAfterSelect?: () => void;
  heightClassName?: string;
  compact?: boolean;
}

export const ForecastPinMiniMap: React.FC<ForecastPinMiniMapProps> = ({
  activeLocation,
  savedLocations = [],
  currentWindSpeedKmh = null,
  currentWindDirectionDeg = null,
  onSelectLocation,
  onSaveLocation,
  onRequestGps,
  onToast,
  onAfterSelect,
  heightClassName = 'h-60 sm:h-72',
  compact = false,
}) => {
  const [pinLat, setPinLat] = useState<number>(activeLocation.latitude);
  const [pinLon, setPinLon] = useState<number>(activeLocation.longitude);
  const [areaRadiusKm, setAreaRadiusKm] = useState<number>(5);
  const [baseLayerId, setBaseLayerId] = useState<MiniMapBaseLayerId>('osm');
  const [instantApplyOnClick, setInstantApplyOnClick] = useState<boolean>(true);
  const [customPinName, setCustomPinName] = useState<string>('');
  const [justApplied, setJustApplied] = useState<boolean>(false);

  useEffect(() => {
    setPinLat(activeLocation.latitude);
    setPinLon(activeLocation.longitude);
  }, [activeLocation.latitude, activeLocation.longitude]);

  const windFlagText = useMemo(() => {
    if (currentWindSpeedKmh !== null && !Number.isNaN(currentWindSpeedKmh)) {
      const cardinal = degreesToCardinalShort(currentWindDirectionDeg);
      return `${Math.round(currentWindSpeedKmh)} km/h ◄ ${cardinal}`;
    }
    return `${pinLat.toFixed(2)}°, ${pinLon.toFixed(2)}°`;
  }, [currentWindDirectionDeg, currentWindSpeedKmh, pinLat, pinLon]);

  const pinIcon = useMemo(() => createWindyFlagPinIcon(windFlagText), [windFlagText]);
  const activeBaseLayer =
    BASE_LAYERS.find((layer) => layer.id === baseLayerId) ?? BASE_LAYERS[0]!;

  const buildPinDisplayName = (lat: number, lon: number, radiusKm: number): string => {
    const trimmed = customPinName.trim();
    const areaSuffix = radiusKm > 0 ? ` • Área ${radiusKm}km` : '';
    if (trimmed) {
      return `${trimmed}${areaSuffix}`;
    }
    return `Pin no Mapa (${lat.toFixed(3)}°, ${lon.toFixed(3)}°${areaSuffix})`;
  };

  const applyPinForecast = (lat: number, lon: number, radiusKm = areaRadiusKm) => {
    if (!onSelectLocation) {
      return;
    }
    const label = buildPinDisplayName(lat, lon, radiusKm);
    void safeAction(
      async () => {
        await onSelectLocation({
          latitude: lat,
          longitude: lon,
          name: label,
          origin: 'search',
        });
        setJustApplied(true);
        setTimeout(() => setJustApplied(false), 1800);
        onAfterSelect?.();
      },
      {
        actionKey: 'forecast_pin_minimap_apply',
        moduleName: 'ForecastPinMiniMap',
        errorTitle: 'Não foi possível carregar a previsão para o ponto selecionado',
        onToast,
      },
    );
  };

  const handleMapPick = (lat: number, lon: number) => {
    const clampedLat = Math.max(-85, Math.min(85, Number(lat.toFixed(5))));
    const clampedLon = Math.max(-180, Math.min(180, Number(lon.toFixed(5))));
    setPinLat(clampedLat);
    setPinLon(clampedLon);
    if (instantApplyOnClick && onSelectLocation) {
      applyPinForecast(clampedLat, clampedLon, areaRadiusKm);
    }
  };

  const handleSavePinnedLocation = () => {
    if (!onSaveLocation) {
      return;
    }
    const label =
      customPinName.trim() ||
      `Ponto Mapa (${pinLat.toFixed(3)}°, ${pinLon.toFixed(3)}°)`;
    void safeAction(
      async () => {
        await onSaveLocation({
          name: label,
          latitude: pinLat,
          longitude: pinLon,
          region:
            areaRadiusKm > 0
              ? `Área demarcada no mapa (Raio ${areaRadiusKm} km)`
              : 'Ponto demarcado no mapa interativo',
          isFavorite: true,
        });
        if (onSelectLocation) {
          await onSelectLocation({
            latitude: pinLat,
            longitude: pinLon,
            name: label,
            origin: 'saved',
          });
        }
        setCustomPinName('');
      },
      {
        actionKey: 'forecast_pin_minimap_save',
        moduleName: 'ForecastPinMiniMap',
        successTitle: 'Ponto do mapa salvo nos favoritos',
        errorTitle: 'Não foi possível salvar o ponto do mapa',
        onToast,
      },
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm space-y-3">
      {/* Top Toolbar: Instructions + Base Layer Switcher + Instant Mode Toggle */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-start sm:items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-900/60 text-[#0080cd] dark:text-sky-300 border border-sky-200/80 dark:border-sky-700/60 shrink-0">
            <MapPin className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-sky-50">
                Mapa de Pin da Previsão (Estilo Windy)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 dark:bg-sky-900/70 text-[#0070b8] dark:text-sky-200 border border-sky-200/70 dark:border-sky-700/60">
                Clique no mapa para posicionar a bandeirinha
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-sky-200/75">
              Posicione o pin em qualquer ponto costeiro, oceânico ou continental e defina um raio de área
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Instant Windy Click Toggle */}
          <button
            type="button"
            onClick={() => setInstantApplyOnClick((prev) => !prev)}
            aria-pressed={instantApplyOnClick}
            className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border transition-all ${
              instantApplyOnClick
                ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                : 'bg-white dark:bg-[#0d1f36] text-slate-600 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{instantApplyOnClick ? 'Atualizar ao Clicar: Ativo' : 'Atualizar ao Clicar: Pausado'}</span>
          </button>

          {/* Base Layer Switcher */}
          <div
            role="group"
            aria-label="Estilo do mapa base"
            className="inline-flex items-center rounded-full border border-slate-200 dark:border-sky-800 bg-[#f4f8fb] dark:bg-[#0d1f36] p-0.5"
          >
            <Layers className="w-3.5 h-3.5 text-[#0080cd] ml-2.5 mr-1 hidden sm:inline" aria-hidden="true" />
            {BASE_LAYERS.map((layer) => {
              const active = baseLayerId === layer.id;
              return (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => setBaseLayerId(layer.id)}
                  aria-pressed={active}
                  className={`min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-white dark:bg-sky-700 text-[#0070b8] dark:text-white font-bold shadow-sm'
                      : 'text-slate-600 dark:text-sky-200/80 hover:text-[#0080cd]'
                  }`}
                >
                  {layer.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Area Radius Selector + Saved Locations Quick Chips */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-sky-200/80 inline-flex items-center gap-1 mr-1">
            <Compass className="w-3.5 h-3.5 text-[#0080cd]" aria-hidden="true" />
            Área / Raio:
          </span>
          {RADIUS_OPTIONS_KM.map((opt) => {
            const isSelected = areaRadiusKm === opt.km;
            return (
              <button
                key={opt.km}
                type="button"
                onClick={() => setAreaRadiusKm(opt.km)}
                aria-pressed={isSelected}
                className={`min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  isSelected
                    ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                    : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-600 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Quick Saved Locations & GPS Chips */}
        {!compact && (savedLocations.length > 0 || onRequestGps) && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin max-w-full pb-0.5">
            {onRequestGps && (
              <button
                type="button"
                onClick={() => void onRequestGps()}
                className="min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sky-50 dark:bg-sky-900/60 hover:bg-sky-100 text-[#0070b8] dark:text-sky-200 border border-sky-200 dark:border-sky-700/60 inline-flex items-center gap-1 shrink-0 transition-colors"
              >
                <Navigation className="w-3 h-3 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                <span>Meu GPS</span>
              </button>
            )}
            {savedLocations.slice(0, 4).map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => {
                  setPinLat(loc.latitude);
                  setPinLon(loc.longitude);
                  if (onSelectLocation) {
                    void onSelectLocation({
                      latitude: loc.latitude,
                      longitude: loc.longitude,
                      name: loc.name,
                      origin: 'saved',
                    });
                  }
                }}
                className="min-h-[30px] px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 text-slate-700 dark:text-sky-200 border border-slate-200 dark:border-sky-800 shrink-0 transition-colors"
              >
                {loc.name.split('—')[0]?.trim() || loc.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Leaflet Map Container */}
      <div
        className={`relative w-full ${heightClassName} rounded-2xl overflow-hidden border border-slate-200 dark:border-sky-800/80 shadow-inner bg-sky-100/60 dark:bg-[#0b192c]`}
      >
        <MapContainer
          center={[pinLat, pinLon]}
          zoom={10}
          scrollWheelZoom={true}
          className="w-full h-full z-10"
        >
          <TileLayer
            key={activeBaseLayer.id}
            url={activeBaseLayer.url}
            attribution={activeBaseLayer.attribution}
          />

          <MapClickAndSyncController
            centerLat={pinLat}
            centerLon={pinLon}
            onPickCoordinates={handleMapPick}
          />

          <Marker
            position={[pinLat, pinLon]}
            icon={pinIcon}
            draggable={true}
            eventHandlers={{
              click: () => {
                applyPinForecast(pinLat, pinLon, areaRadiusKm);
              },
              dragend: (event) => {
                const marker = event.target as L.Marker;
                const pos = marker.getLatLng();
                handleMapPick(pos.lat, pos.lng);
              },
            }}
          />

          {areaRadiusKm > 0 && (
            <Circle
              center={[pinLat, pinLon]}
              radius={areaRadiusKm * 1000}
              pathOptions={{
                color: '#0080cd',
                weight: 2,
                fillColor: '#38bdf8',
                fillOpacity: 0.14,
              }}
            />
          )}
        </MapContainer>

        {/* Floating Coordinates Pill Overlay on Map */}
        <div className="absolute bottom-2.5 left-2.5 z-20 pointer-events-none">
          <div className="px-3 py-1.5 rounded-full bg-white/95 dark:bg-[#0d1f36]/95 backdrop-blur-md border border-slate-200 dark:border-sky-700/70 shadow-md text-[11px] font-medium text-slate-700 dark:text-sky-100 flex items-center gap-2">
            <Crosshair className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
            <span>
              Pin: <strong className="font-mono">{pinLat.toFixed(4)}°</strong>,{' '}
              <strong className="font-mono">{pinLon.toFixed(4)}°</strong>
              {areaRadiusKm > 0 ? ` • Área ${areaRadiusKm} km` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Action Bar: Name Input + Apply Forecast + Save Favorite */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-0.5">
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={customPinName}
            onChange={(e) => setCustomPinName(e.target.value)}
            placeholder="Nome opcional para este local (ex.: Praia Mole / Canal Central)..."
            aria-label="Nome personalizado para o pin no mapa"
            className="w-full min-h-[38px] px-3.5 py-1.5 rounded-full border border-slate-200 dark:border-sky-800 bg-[#f8fafc] dark:bg-[#0d1f36] text-xs text-slate-800 dark:text-sky-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onSelectLocation && (
            <button
              type="button"
              onClick={() => applyPinForecast(pinLat, pinLon, areaRadiusKm)}
              className="min-h-[38px] px-4 py-1.5 rounded-full text-xs font-bold inline-flex items-center justify-center gap-1.5 bg-[#0080cd] hover:bg-[#006bb3] text-white shadow-sm transition-colors"
            >
              {justApplied ? (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>Previsão Atualizada!</span>
                </>
              ) : (
                <>
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  <span>Previsão para este local</span>
                </>
              )}
            </button>
          )}

          {onSaveLocation && (
            <button
              type="button"
              onClick={handleSavePinnedLocation}
              className="min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-semibold inline-flex items-center justify-center gap-1.5 bg-[#f4f8fb] dark:bg-sky-900/50 hover:bg-sky-50 text-[#0070b8] dark:text-sky-100 border border-sky-200 dark:border-sky-700/70 transition-colors"
            >
              <Bookmark className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
              <span>Salvar Favorito</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
