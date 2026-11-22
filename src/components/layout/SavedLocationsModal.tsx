import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Check,
  Compass,
  Edit3,
  Map as MapIcon,
  MapPin,
  Navigation,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { ActiveCoordinates, SavedLocation } from '../../types/field';
import type { ToastMessage } from '../../types/health';
import type { NominatimResult } from '../../types/schemas';
import { safeAction } from '../../utils/safeAction';
import { ForecastPinMiniMap } from '../forecast/ForecastPinMiniMap';

export interface SavedLocationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLocation: ActiveCoordinates;
  savedLocations: SavedLocation[];
  onSelectLocation: (coords: {
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
  onRenameLocation?: (id: string, newName: string) => void | Promise<void>;
  onToggleFavorite?: (id: string, isFavorite: boolean) => void | Promise<void>;
  onDeleteLocation?: (id: string) => void | Promise<void>;
  onSearchQuery?: (query: string) => Promise<NominatimResult[]>;
  onRequestGps?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const SavedLocationsModal: React.FC<SavedLocationsModalProps> = ({
  isOpen,
  onClose,
  activeLocation,
  savedLocations,
  onSelectLocation,
  onSaveLocation,
  onRenameLocation,
  onToggleFavorite,
  onDeleteLocation,
  onSearchQuery,
  onRequestGps,
  onToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showPinMap, setShowPinMap] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const sortedSaved = [...savedLocations].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    return b.lastUsedAtIso.localeCompare(a.lastUsedAtIso);
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return;
    }

    void safeAction(
      async () => {
        setHasSearched(true);
        if (!onSearchQuery) {
          setSearchResults([]);
          return;
        }
        const results = await onSearchQuery(trimmed);
        setSearchResults(results);
      },
      {
        actionKey: 'nominatim_search_submit',
        moduleName: 'SavedLocationsModal',
        errorTitle: 'Falha ao buscar localidade no mapa',
        onLoadingChange: setIsSearching,
        onToast,
      },
    );
  };

  const handleSelectSaved = (loc: SavedLocation) => {
    void safeAction(
      async () => {
        await onSelectLocation({
          latitude: loc.latitude,
          longitude: loc.longitude,
          name: loc.name,
          origin: 'saved',
        });
        onClose();
      },
      {
        actionKey: `select_saved_${loc.id}`,
        moduleName: 'SavedLocationsModal',
        errorTitle: 'Erro ao selecionar ponto salvo',
        onToast,
      },
    );
  };

  const handleSaveCurrentActive = () => {
    if (!onSaveLocation) {
      return;
    }
    void safeAction(
      async () => {
        await onSaveLocation({
          name: activeLocation.name || 'Ponto de Campo',
          latitude: activeLocation.latitude,
          longitude: activeLocation.longitude,
          isFavorite: true,
        });
      },
      {
        actionKey: 'save_current_active_location',
        moduleName: 'SavedLocationsModal',
        successTitle: 'Coordenada atual salva nos favoritos',
        errorTitle: 'Erro ao salvar coordenada atual',
        onToast,
      },
    );
  };

  const handleStartRename = (loc: SavedLocation) => {
    setEditingId(loc.id);
    setEditingName(loc.name);
  };

  const handleConfirmRename = (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed || !onRenameLocation) {
      setEditingId(null);
      return;
    }
    void safeAction(
      async () => {
        await onRenameLocation(id, trimmed);
        setEditingId(null);
      },
      {
        actionKey: `rename_location_${id}`,
        moduleName: 'SavedLocationsModal',
        successTitle: 'Ponto renomeado com sucesso',
        errorTitle: 'Erro ao renomear ponto salvo',
        onToast,
      },
    );
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = Number.parseFloat(manualLat.replace(',', '.'));
    const lonNum = Number.parseFloat(manualLon.replace(',', '.'));
    if (
      Number.isNaN(latNum) ||
      Number.isNaN(lonNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lonNum < -180 ||
      lonNum > 180
    ) {
      onToast?.({
        type: 'warning',
        title: 'Coordenadas inválidas',
        message: 'Informe Latitude entre -90 e 90 e Longitude entre -180 e 180.',
      });
      return;
    }
    const finalName =
      manualName.trim() || `Ponto (${latNum.toFixed(4)}, ${lonNum.toFixed(4)})`;

    void safeAction(
      async () => {
        if (onSaveLocation) {
          await onSaveLocation({
            name: finalName,
            latitude: latNum,
            longitude: lonNum,
            isFavorite: true,
          });
        }
        await onSelectLocation({
          latitude: latNum,
          longitude: lonNum,
          name: finalName,
          origin: 'saved',
        });
        setShowManualForm(false);
        setManualName('');
        setManualLat('');
        setManualLon('');
        onClose();
      },
      {
        actionKey: 'manual_coords_submit',
        moduleName: 'SavedLocationsModal',
        successTitle: 'Coordenada selecionada e salva',
        errorTitle: 'Erro ao aplicar coordenada manual',
        onToast,
      },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-locations-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-sky-950/45 dark:bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-3xl border border-sky-200 dark:border-sky-800/80 bg-white dark:bg-[#132a47] text-slate-800 dark:text-sky-50 shadow-2xl shadow-sky-950/20 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-sky-100 dark:border-sky-800/70 bg-gradient-to-r from-sky-50 via-blue-50/40 to-white dark:from-[#0f243d] dark:to-[#132a47]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-sky-600 text-white shadow-sm shadow-sky-500/20">
              <MapPin className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="saved-locations-modal-title" className="text-lg md:text-xl font-bold text-sky-950 dark:text-white">
                Escolher Local no Mapa, Buscar ou Favoritos
              </h2>
              <p className="text-xs text-slate-600 dark:text-sky-200/80">
                Clique diretamente no mapa para dar um Pin (estilo Windy), busque pelo nome ou escolha um ponto salvo
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar seletor de pontos e busca"
            className="min-h-[44px] min-w-[44px] rounded-2xl inline-flex items-center justify-center text-slate-500 dark:text-sky-200 hover:bg-sky-100/80 dark:hover:bg-sky-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5 scrollbar-thin flex-1">
          {/* Active Location Banner + Quick GPS & Save Buttons */}
          <div className="rounded-2xl border border-sky-200/90 dark:border-sky-700/70 bg-sky-50/80 dark:bg-[#0d1f36]/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                Localização Ativa da Previsão
              </span>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {activeLocation.name}
              </p>
              <p className="text-xs text-slate-600 dark:text-sky-200/80">
                Lat {activeLocation.latitude.toFixed(4)}° • Lon{' '}
                {activeLocation.longitude.toFixed(4)}°
                {activeLocation.isApproximateIp ? ' (Aproximado via IP)' : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPinMap((prev) => !prev)}
                className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                  showPinMap
                    ? 'bg-sky-100 dark:bg-sky-800/80 text-sky-800 dark:text-white border-sky-300 dark:border-sky-600'
                    : 'bg-white dark:bg-[#132a47] text-slate-700 dark:text-sky-100 border-sky-200 dark:border-sky-700'
                }`}
              >
                <MapIcon className="w-4 h-4 text-sky-600 dark:text-sky-300" aria-hidden="true" />
                <span>{showPinMap ? 'Ocultar Mapa de Pin' : 'Abrir Mapa de Pin'}</span>
              </button>

              {onRequestGps && (
                <button
                  type="button"
                  onClick={() => {
                    void safeAction(
                      async () => {
                        await onRequestGps();
                        onClose();
                      },
                      {
                        actionKey: 'request_gps_location',
                        moduleName: 'SavedLocationsModal',
                        errorTitle: 'Não foi possível obter o GPS',
                        onToast,
                      },
                    );
                  }}
                  className="min-h-[42px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white shadow-sm shadow-sky-500/20 transition-colors"
                >
                  <Navigation className="w-4 h-4" aria-hidden="true" />
                  <span>Usar Meu GPS</span>
                </button>
              )}

              {onSaveLocation && (
                <button
                  type="button"
                  onClick={handleSaveCurrentActive}
                  className="min-h-[42px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-white dark:bg-[#132a47] hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-700 dark:text-sky-100 border border-sky-200 dark:border-sky-700 transition-colors"
                >
                  <Bookmark className="w-4 h-4 text-amber-500" aria-hidden="true" />
                  <span>Salvar Atual</span>
                </button>
              )}
            </div>
          </div>

          {/* Interactive Pin Map Picker (Windy Style) */}
          {showPinMap && (
            <ForecastPinMiniMap
              activeLocation={activeLocation}
              savedLocations={savedLocations}
              onSelectLocation={onSelectLocation}
              onSaveLocation={onSaveLocation}
              onRequestGps={onRequestGps}
              onToast={onToast}
              heightClassName="h-56 sm:h-64"
              compact={true}
            />
          )}

          {/* Nominatim Search Form */}
          <form onSubmit={handleSearchSubmit} className="space-y-2">
            <label
              htmlFor="location-search-input"
              className="block text-xs font-bold text-slate-700 dark:text-sky-200"
            >
              Buscar por Nome de Cidade, Praia, Baía ou Região
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="w-4 h-4 text-sky-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="location-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Digite cidade, praia, porto ou serra e clique em Buscar..."
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-sky-200 dark:border-sky-700/80 bg-sky-50/40 dark:bg-[#0d1f36] text-sm text-slate-800 dark:text-sky-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-sm shadow-sky-500/20 transition-all shrink-0"
              >
                <Search className="w-4 h-4" aria-hidden="true" />
                <span>{isSearching ? 'Buscando...' : 'Buscar'}</span>
              </button>
            </div>

            {/* Search Results */}
            {hasSearched && (
              <div className="mt-2 rounded-2xl border border-sky-200/80 dark:border-sky-800 bg-sky-50/50 dark:bg-[#0d1f36]/70 divide-y divide-sky-100 dark:divide-sky-800/70">
                {searchResults.length === 0 && !isSearching ? (
                  <p className="p-3.5 text-xs text-slate-500 dark:text-sky-200/70 text-center">
                    Nenhum resultado encontrado para &ldquo;{searchQuery}&rdquo;.
                  </p>
                ) : (
                  searchResults.map((res, idx) => {
                    const lat = Number.parseFloat(res.lat);
                    const lon = Number.parseFloat(res.lon);
                    const shortName =
                      res.name || res.display_name.split(',')[0] || res.display_name;
                    return (
                      <div
                        key={res.place_id ?? idx}
                        className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
                            {shortName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-sky-200/75 line-clamp-1">
                            {res.display_name}
                          </p>
                          <p className="text-[11px] font-mono text-sky-700 dark:text-sky-300">
                            {lat.toFixed(4)}°, {lon.toFixed(4)}°
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              void safeAction(
                                async () => {
                                  await onSelectLocation({
                                    latitude: lat,
                                    longitude: lon,
                                    name: shortName,
                                    origin: 'search',
                                  });
                                  onClose();
                                },
                                {
                                  actionKey: `select_search_result_${idx}`,
                                  moduleName: 'SavedLocationsModal',
                                  onToast,
                                },
                              );
                            }}
                            className="min-h-[40px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
                          >
                            Ver Previsão
                          </button>

                          {onSaveLocation && (
                            <button
                              type="button"
                              onClick={() => {
                                void safeAction(
                                  async () => {
                                    await onSaveLocation({
                                      name: shortName,
                                      latitude: lat,
                                      longitude: lon,
                                      region: res.display_name,
                                      isFavorite: true,
                                    });
                                  },
                                  {
                                    actionKey: `save_search_result_${idx}`,
                                    moduleName: 'SavedLocationsModal',
                                    successTitle: `${shortName} salvo nos pontos favoritos`,
                                    onToast,
                                  },
                                );
                              }}
                              aria-label={`Salvar ${shortName} nos favoritos`}
                              title="Salvar ponto"
                              className="min-h-[40px] min-w-[40px] p-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-[#132a47] hover:bg-sky-50 inline-flex items-center justify-center text-amber-500 transition-colors"
                            >
                              <Star className="w-4 h-4" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </form>

          {/* Manual Coordinate Entry Toggle */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowManualForm((prev) => !prev)}
              className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 bg-sky-50 dark:bg-[#0d1f36] hover:bg-sky-100/80 dark:hover:bg-sky-900/50 text-sky-800 dark:text-sky-200 border border-sky-200/80 dark:border-sky-800 transition-colors"
            >
              <Compass className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span>
                {showManualForm
                  ? 'Ocultar Digitação Manual de Coordenadas'
                  : 'Digitar Latitude e Longitude Manualmente'}
              </span>
            </button>

            {showManualForm && (
              <form
                onSubmit={handleManualSubmit}
                className="rounded-2xl border border-sky-200/80 dark:border-sky-800 bg-sky-50/50 dark:bg-[#0d1f36]/70 p-3.5 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-sky-200 mb-1">
                      Nome do Ponto
                    </label>
                    <input
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="Ex.: Boia Costeira 01"
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-[#132a47] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-sky-200 mb-1">
                      Latitude (-90 a 90)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={manualLat}
                      onChange={(e) => setManualLat(e.target.value)}
                      placeholder="-27.5954"
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-[#132a47] text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-sky-200 mb-1">
                      Longitude (-180 a 180)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={manualLon}
                      onChange={(e) => setManualLon(e.target.value)}
                      placeholder="-48.5480"
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-[#132a47] text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Aplicar e Salvar Coordenada</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Saved Locations List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 dark:text-sky-200">
                Meus Locais Favoritos Salvos ({sortedSaved.length})
              </h3>
              <span className="text-[11px] text-sky-700/80 dark:text-sky-300/80">
                Disponíveis mesmo sem internet
              </span>
            </div>

            {sortedSaved.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sky-200 dark:border-sky-800 p-6 text-center space-y-1 bg-sky-50/30 dark:bg-[#0d1f36]/40">
                <p className="text-sm font-semibold text-slate-700 dark:text-sky-100">
                  Nenhum ponto favorito salvo ainda
                </p>
                <p className="text-xs text-slate-500 dark:text-sky-200/70">
                  Clique no mapa acima e escolha &ldquo;Salvar Pin&rdquo; ou busque uma localidade para manter acesso rápido.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedSaved.map((loc) => {
                  const isEditing = editingId === loc.id;
                  const isCurrent =
                    Math.abs(loc.latitude - activeLocation.latitude) < 0.001 &&
                    Math.abs(loc.longitude - activeLocation.longitude) < 0.001;

                  return (
                    <div
                      key={loc.id}
                      className={`rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                        isCurrent
                          ? 'border-sky-400 bg-sky-50/90 dark:bg-sky-900/30 dark:border-sky-500'
                          : 'border-sky-100 dark:border-sky-800/70 bg-white dark:bg-[#0d1f36]/60 hover:border-sky-200'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              aria-label="Novo nome do ponto salvo"
                              className="min-h-[42px] flex-1 px-3 py-1.5 rounded-xl border border-sky-400 bg-white dark:bg-[#132a47] text-sm font-semibold"
                            />
                            <button
                              type="button"
                              onClick={() => handleConfirmRename(loc.id)}
                              aria-label="Confirmar novo nome"
                              className="min-h-[42px] min-w-[42px] p-2 rounded-xl bg-emerald-600 text-white inline-flex items-center justify-center"
                            >
                              <Check className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              aria-label="Cancelar edição"
                              className="min-h-[42px] min-w-[42px] p-2 rounded-xl bg-sky-100 dark:bg-sky-900 text-slate-700 dark:text-sky-200 inline-flex items-center justify-center"
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelectSaved(loc)}
                            className="w-full text-left group focus:outline-none"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-800 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors truncate">
                                {loc.name}
                              </span>
                              {isCurrent && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-600 text-white">
                                  Ativo
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-sky-200/75">
                              Lat {loc.latitude.toFixed(4)}° • Lon {loc.longitude.toFixed(4)}°
                              {loc.elevationM != null ? ` • Altitude ${Math.round(loc.elevationM)}m` : ''}
                            </p>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSelectSaved(loc)}
                          className="min-h-[40px] min-w-[44px] px-3.5 py-1.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
                        >
                          Selecionar
                        </button>

                        {onToggleFavorite && (
                          <button
                            type="button"
                            onClick={() => {
                              void safeAction(
                                async () => onToggleFavorite(loc.id, !loc.isFavorite),
                                {
                                  actionKey: `fav_loc_${loc.id}`,
                                  moduleName: 'SavedLocationsModal',
                                  onToast,
                                },
                              );
                            }}
                            aria-label={
                              loc.isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'
                            }
                            className="min-h-[40px] min-w-[40px] p-2 rounded-xl border border-sky-100 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50 inline-flex items-center justify-center transition-colors"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                loc.isFavorite
                                  ? 'text-amber-500 fill-amber-500'
                                  : 'text-slate-400'
                              }`}
                              aria-hidden="true"
                            />
                          </button>
                        )}

                        {onRenameLocation && (
                          <button
                            type="button"
                            onClick={() => handleStartRename(loc)}
                            aria-label={`Renomear ${loc.name}`}
                            className="min-h-[40px] min-w-[40px] p-2 rounded-xl border border-sky-100 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-900/50 inline-flex items-center justify-center text-slate-600 dark:text-sky-200 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}

                        {onDeleteLocation && (
                          <button
                            type="button"
                            onClick={() => {
                              void safeAction(async () => onDeleteLocation(loc.id), {
                                actionKey: `del_loc_${loc.id}`,
                                moduleName: 'SavedLocationsModal',
                                successTitle: 'Ponto removido',
                                onToast,
                              });
                            }}
                            aria-label={`Excluir ${loc.name}`}
                            className="min-h-[40px] min-w-[40px] p-2 rounded-xl border border-sky-100 dark:border-sky-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-300 inline-flex items-center justify-center text-slate-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
