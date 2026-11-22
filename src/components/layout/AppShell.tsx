import React, { type ReactNode, useState } from 'react';
import {
  BookOpen,
  CloudSun,
  Compass,
  Map as MapIcon,
  MapPin,
  Moon,
  RefreshCw,
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
  ip: 'Aproximado via IP',
  cached: 'Cache Offline',
  saved: 'Ponto Salvo',
  search: 'Busca OSM',
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
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 dark:bg-field-950 dark:text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-300/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-sm">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          {/* Brand + Active Location Trigger */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1 sm:flex-initial">
            <div className="flex items-center gap-2.5 shrink-0">
              <img
                src="/icon.svg"
                alt="FieldCast"
                className="w-9 h-9 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700"
              />
              <div className="hidden sm:block">
                <span className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white block leading-none">
                  FieldCast
                </span>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Previsão 168h & Campo
                </span>
              </div>
            </div>

            {/* Active Location Selector Button (>= 44x44px) */}
            <button
              type="button"
              onClick={() => setLocationsOpen(true)}
              aria-label={`Local ativo: ${activeLocation.name}. Clique para trocar ou buscar ponto.`}
              className="min-h-[44px] min-w-[44px] max-w-xs sm:max-w-sm px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/90 hover:border-sky-500 dark:hover:border-sky-500 text-left flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <MapPin className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                    {activeLocation.name}
                  </span>
                  <span
                    className={`hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                      activeLocation.isApproximateIp
                        ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                        : 'bg-sky-500/15 text-sky-800 dark:text-sky-300'
                    }`}
                  >
                    {activeLocation.isApproximateIp
                      ? 'Aproximado via IP'
                      : ORIGIN_BADGE_LABELS[activeLocation.origin]}
                  </span>
                </div>
                <span className="block text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                  {activeLocation.latitude.toFixed(4)}°, {activeLocation.longitude.toFixed(4)}°
                </span>
              </div>
            </button>
          </div>

          {/* Desktop Top Navigation Bar (3 Tabs) */}
          <nav
            aria-label="Navegação Principal Desktop"
            className="hidden md:flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/70"
          >
            {tabs.map(({ id, label, Icon, badgeCount }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTabChange(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <span>{label}</span>
                  {badgeCount !== undefined && badgeCount > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                        isActive
                          ? 'bg-white text-sky-700'
                          : 'bg-amber-500 text-slate-950'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Controls: Refresh, Glossary, Theme Toggle, HealthBadge */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {onRefreshForecast && (
              <button
                type="button"
                onClick={handleRefreshClick}
                disabled={isRefreshingForecast}
                aria-label="Atualizar previsão meteorológica"
                title="Atualizar Previsão"
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isRefreshingForecast ? 'animate-spin text-sky-500' : ''}`}
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
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <BookOpen className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span className="hidden xl:inline">Guia Rápido & Glossário</span>
            </button>

            {/* Theme Toggle (Claro Alto Contraste Solar / Escuro Noturno) */}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={
                theme === 'dark'
                  ? 'Alternar para Tema Claro (Alto Contraste Solar)'
                  : 'Alternar para Tema Escuro (Noturno)'
              }
              title={
                theme === 'dark'
                  ? 'Tema Claro (Alto Contraste Solar)'
                  : 'Tema Escuro (Modo Noturno)'
              }
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  <span className="hidden lg:inline">Claro</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />
                  <span className="hidden lg:inline">Escuro</span>
                </>
              )}
            </button>

            {/* Fixed Health Check Badge */}
            <HealthBadge snapshot={healthSnapshot} onClick={() => setIsHealthOpen(true)} />
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 pt-4 pb-24 md:pb-10">
        {children}
      </main>

      {/* Mobile Fixed Bottom Tab Bar (3 Tabs >= 44x44px) */}
      <nav
        aria-label="Navegação Principal Mobile"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-300 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-2 py-1.5 shadow-2xl"
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
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-[11px] leading-tight">{label}</span>
                {badgeCount !== undefined && badgeCount > 0 && (
                  <span
                    className={`absolute top-1 right-3 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      isActive ? 'bg-white text-sky-700' : 'bg-amber-500 text-slate-950'
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
  );
};
