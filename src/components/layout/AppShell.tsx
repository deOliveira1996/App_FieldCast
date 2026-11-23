import React, { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import {
  BookOpen,
  CloudSun,
  Compass,
  Map as MapIcon,
  MapPin,
  Moon,
  RefreshCw,
  Search,
  Sun,
} from 'lucide-react';
import type { ActiveCoordinates, SavedLocation } from '../../types/field';
import type { HealthCheckSnapshot, ToastMessage } from '../../types/health';
import type { NominatimResult } from '../../types/schemas';
import type { ThemeMode } from '../../hooks/useTheme';
import { safeAction } from '../../utils/safeAction';
import { GlossaryModal } from '../common/GlossaryModal';
import { HealthBadge } from '../common/HealthBadge';
import { HealthCheckModal } from '../common/HealthCheckModal';
import { SavedLocationsModal } from './SavedLocationsModal';

export type AppTabId = 'forecast' | 'map' | 'field';

export interface AppLocationContextValue {
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
  onRequestGps?: () => void | Promise<void>;
  openLocationsModal: () => void;
}

const AppLocationContext = createContext<AppLocationContextValue | null>(null);

export function useAppLocationContext(): AppLocationContextValue | null {
  return useContext(AppLocationContext);
}

export interface AppShellProps {
  activeTab: AppTabId;
  onTabChange: (tab: AppTabId) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  activeLocation: ActiveCoordinates;
  savedLocations: SavedLocation[];
  healthSnapshot: HealthCheckSnapshot;
  activeAlertsCount?: number;
  isRefreshingForecast?: boolean;
  onRefreshForecast?: () => void | Promise<void>;
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
  onToggleFavoriteLocation?: (id: string, isFavorite: boolean) => void | Promise<void>;
  onDeleteLocation?: (id: string) => void | Promise<void>;
  onSearchQuery?: (query: string) => Promise<NominatimResult[]>;
  onRequestGps?: () => void | Promise<void>;
  onRunHealthCheck?: () => void | Promise<void>;
  onClearErrorLogs?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  isLocationsModalOpen?: boolean;
  onLocationsModalOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

const ORIGIN_BADGE_LABELS: Record<ActiveCoordinates['origin'], string> = {
  gps: 'GPS',
  ip: 'Via IP',
  cached: 'Cache',
  saved: 'Salvo',
  search: 'Pin / Busca',
};

export const AppShell: React.FC<AppShellProps> = ({
  activeTab,
  onTabChange,
  theme,
  onToggleTheme,
  activeLocation,
  savedLocations,
  healthSnapshot,
  activeAlertsCount = 0,
  isRefreshingForecast = false,
  onRefreshForecast,
  onSelectLocation,
  onSaveLocation,
  onRenameLocation,
  onToggleFavoriteLocation,
  onDeleteLocation,
  onSearchQuery,
  onRequestGps,
  onRunHealthCheck,
  onClearErrorLogs,
  onToast,
  isLocationsModalOpen: controlledLocationsOpen,
  onLocationsModalOpenChange,
  children,
}) => {
  const [internalLocationsOpen, setInternalLocationsOpen] = useState(false);
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isHealthOpen, setIsHealthOpen] = useState(false);

  const isLocationsOpen = controlledLocationsOpen ?? internalLocationsOpen;
  const setLocationsOpen = (open: boolean) => {
    setInternalLocationsOpen(open);
    onLocationsModalOpenChange?.(open);
  };

  const locationContextValue = useMemo<AppLocationContextValue>(
    () => ({
      activeLocation,
      savedLocations,
      onSelectLocation,
      onSaveLocation,
      onRequestGps,
      openLocationsModal: () => setLocationsOpen(true),
    }),
    [activeLocation, savedLocations, onSelectLocation, onSaveLocation, onRequestGps],
  );

  const tabs: Array<{
    id: AppTabId;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    badgeCount?: number;
  }> = [
    {
      id: 'forecast',
      label: 'Previsão',
      Icon: CloudSun,
      badgeCount: activeAlertsCount > 0 ? activeAlertsCount : undefined,
    },
    {
      id: 'map',
      label: 'Mapa & Radar',
      Icon: MapIcon,
    },
    {
      id: 'field',
      label: 'Campo & Dados',
      Icon: Compass,
    },
  ];

  const handleRefreshClick = () => {
    if (!onRefreshForecast) {
      return;
    }
    void safeAction(async () => onRefreshForecast(), {
      actionKey: 'app_shell_refresh_forecast',
      moduleName: 'AppShell',
      errorTitle: 'Não foi possível atualizar a previsão',
      onToast,
    });
  };

  return (
    <AppLocationContext.Provider value={locationContextValue}>
      <div className="min-h-screen flex flex-col bg-[#f1f5f9] text-slate-800 dark:bg-[#0d1f36] dark:text-sky-50">
        {/* Clean Ocean-Blue Top Header (Climatempo Aesthetic) */}
        <header className="sticky top-0 z-30 shadow-md bg-[#0080cd] dark:bg-[#0a3656] text-white">
          {/* Primary Row: Brand + Centered Rounded White Search/Pin Bar + Quick Controls */}
          <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            {/* Brand Logo */}
            <div className="flex items-center gap-2.5 shrink-0">
              <img
                src="/icon.svg"
                alt="FieldCast"
                className="w-9 h-9 rounded-xl shadow-sm border border-white/25 bg-white/10"
              />
              <div>
                <span className="text-lg font-extrabold tracking-tight text-white block leading-none">
                  FieldCast
                </span>
                <span className="text-[11px] font-medium text-sky-100">
                  Previsão &amp; Campo
                </span>
              </div>
            </div>

            {/* Centered Rounded White Search & Map Pin Trigger Pill (Climatempo style) */}
            <div className="order-3 md:order-2 w-full md:w-auto md:flex-1 max-w-xl mx-auto min-w-0 md:min-w-[220px]">
              <button
                type="button"
                onClick={() => setLocationsOpen(true)}
                aria-label={`Local ativo: ${activeLocation.name}. Clique para buscar uma localidade ou dar um Pin no mapa.`}
                className="w-full min-h-[42px] px-4 py-1.5 rounded-full bg-white text-slate-800 hover:bg-sky-50 shadow-sm flex items-center justify-between gap-2.5 transition-all focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <MapPin className="w-4 h-4 text-[#0080cd] shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                    {activeLocation.name}
                  </span>
                  <span className="hidden md:inline-block text-[11px] text-slate-500 font-mono shrink-0">
                    ({activeLocation.latitude.toFixed(3)}°, {activeLocation.longitude.toFixed(3)}°)
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0070b8]">
                    {activeLocation.isApproximateIp
                      ? 'Aproximado via IP'
                      : ORIGIN_BADGE_LABELS[activeLocation.origin]}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#0080cd] text-white">
                    <Search className="w-3 h-3" aria-hidden="true" />
                    <span className="hidden sm:inline">Buscar / Pin</span>
                  </span>
                </div>
              </button>
            </div>

            {/* Right Controls: Refresh, Glossary, Theme Toggle, HealthBadge */}
            <div className="order-2 md:order-3 flex items-center gap-1.5 sm:gap-2 shrink-0">
              {onRefreshForecast && (
                <button
                  type="button"
                  onClick={handleRefreshClick}
                  disabled={isRefreshingForecast}
                  aria-label="Atualizar previsão meteorológica"
                  title="Atualizar Previsão"
                  className="min-h-[40px] min-w-[40px] p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isRefreshingForecast ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              )}

              {/* Glossary Button */}
              <button
                type="button"
                onClick={() => setIsGlossaryOpen(true)}
                aria-label="Abrir Guia Rápido e Glossário"
                title="Guia Rápido & Glossário"
                className="min-h-[40px] min-w-[40px] px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                <span className="hidden xl:inline">Guia Rápido</span>
              </button>

              {/* Theme Toggle */}
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={
                  theme === 'dark'
                    ? 'Alternar para Tema Claro Clean'
                    : 'Alternar para Tema Noturno'
                }
                title={
                  theme === 'dark'
                    ? 'Tema Claro Clean (Azul e Branco)'
                    : 'Tema Noturno Oceânico'
                }
                className="min-h-[40px] min-w-[40px] px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-4 h-4 text-amber-300" aria-hidden="true" />
                    <span className="hidden lg:inline">Claro</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-4 h-4 text-sky-100" aria-hidden="true" />
                    <span className="hidden lg:inline">Noturno</span>
                  </>
                )}
              </button>

              {/* Fixed Health Check Badge */}
              <HealthBadge snapshot={healthSnapshot} onClick={() => setIsHealthOpen(true)} />
            </div>
          </div>

          {/* Secondary Sub-Bar: Climatempo-style Blue Bar with White Active Tab Pill */}
          <div className="hidden md:block bg-[#006bb3] dark:bg-[#072842] border-t border-white/15">
            <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-1.5 flex items-center justify-between gap-3 overflow-x-auto scrollbar-thin">
              <div className="hidden sm:flex items-center gap-2 text-xs text-sky-100 font-medium shrink-0">
                <span>Tempo agora em</span>
                <strong className="text-white font-bold">{activeLocation.name}</strong>
              </div>

              <nav
                aria-label="Navegação Principal Desktop"
                className="hidden md:flex items-center gap-1.5 mx-auto sm:mx-0"
              >
                {tabs.map(({ id, label, Icon, badgeCount }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onTabChange(id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`min-h-[36px] px-4 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-white ${
                        isActive
                          ? 'bg-white text-[#0070b8] shadow-sm'
                          : 'text-white/90 hover:bg-white/15'
                      }`}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span>{label}</span>
                      {badgeCount !== undefined && badgeCount > 0 && (
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                            isActive
                              ? 'bg-[#0080cd] text-white'
                              : 'bg-amber-400 text-slate-950'
                          }`}
                        >
                          {badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        </header>

        {/* Main Content Workspace */}
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 pt-5 pb-24 md:pb-10">
          {children}
        </main>

        {/* Mobile Fixed Bottom Tab Bar (3 Tabs >= 44x44px) */}
        <nav
          aria-label="Navegação Principal Mobile"
          className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-sky-200 dark:border-sky-800/70 bg-white/95 dark:bg-[#0f243d]/95 backdrop-blur-md px-2 py-1.5 shadow-xl"
        >
          <div className="grid grid-cols-3 gap-1.5 max-w-md mx-auto">
            {tabs.map(({ id, label, Icon, badgeCount }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTabChange(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`min-h-[48px] min-w-[44px] py-1.5 px-2 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors relative focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isActive
                      ? 'bg-[#0080cd] text-white shadow-sm'
                      : 'text-slate-600 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/40'
                  }`}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  <span className="text-[11px] leading-tight">{label}</span>
                  {badgeCount !== undefined && badgeCount > 0 && (
                    <span
                      className={`absolute top-1 right-3 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-white text-[#0080cd]' : 'bg-amber-500 text-slate-950'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Modals managed by AppShell */}
        <GlossaryModal isOpen={isGlossaryOpen} onClose={() => setIsGlossaryOpen(false)} />

        <HealthCheckModal
          isOpen={isHealthOpen}
          onClose={() => setIsHealthOpen(false)}
          snapshot={healthSnapshot}
          onRunHealthCheck={onRunHealthCheck}
          onClearErrorLogs={onClearErrorLogs}
          onToast={onToast}
        />

        <SavedLocationsModal
          isOpen={isLocationsOpen}
          onClose={() => setLocationsOpen(false)}
          activeLocation={activeLocation}
          savedLocations={savedLocations}
          onSelectLocation={onSelectLocation}
          onSaveLocation={onSaveLocation}
          onRenameLocation={onRenameLocation}
          onToggleFavorite={onToggleFavoriteLocation}
          onDeleteLocation={onDeleteLocation}
          onSearchQuery={onSearchQuery}
          onRequestGps={onRequestGps}
          onToast={onToast}
        />
      </div>
    </AppLocationContext.Provider>
  );
};
