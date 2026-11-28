import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Anchor,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Database,
  GitCompare,
  Map as MapIcon,
  MapPin,
  Menu,
  Moon,
  Plane,
  RefreshCw,
  Route,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import type { ActiveCoordinates, SavedLocation } from '../../types/field';
import type { HealthCheckSnapshot, ToastMessage } from '../../types/health';
import type { NominatimResult } from '../../types/schemas';
import type {
  NotificationRuleTemplate,
  UserNotificationPreferences,
  V4AppTabId,
} from '../../types/v4';
import type { ForecastViewMode } from '../../types/weather';
import type { ThemeMode } from '../../hooks/useTheme';
import { ENABLED_TABS, IS_MINIMAL_EDITION } from '../../config/appEdition';
import { useLocale } from '../../context/LocaleContext';
import {
  dispatchFieldCastLayoutRefresh,
  useViewportResize,
} from '../../hooks/useViewportResize';
import { safeAction } from '../../utils/safeAction';
import { GlossaryModal } from '../common/GlossaryModal';
import { HealthBadge } from '../common/HealthBadge';
import { HealthCheckModal } from '../common/HealthCheckModal';
import { ModelModeSwitchPill } from '../common/ModelModeSwitchPill';
import { SavedLocationsModal } from './SavedLocationsModal';

export type AppTabId = V4AppTabId;

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'fieldcast_sidebar_collapsed_v4';

function loadPersistedSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Ignora restrições de armazenamento privado
  }
}

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
  unreadNotificationsCount?: number;
  viewMode?: ForecastViewMode;
  onViewModeChange?: (mode: ForecastViewMode) => void;
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
  primaryLocationKey?: string | null;
  onSetPrimaryLocation?: (loc: {
    savedLocationId?: string;
    name: string;
    latitude: number;
    longitude: number;
    region?: string;
    origin?: ActiveCoordinates['origin'];
  }) => void | Promise<void>;
  onRunHealthCheck?: () => void | Promise<void>;
  onClearErrorLogs?: () => void | Promise<void>;
  onActivateTemplate?: (
    template: NotificationRuleTemplate,
    updatedPrefs: UserNotificationPreferences,
  ) => void;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  isLocationsModalOpen?: boolean;
  onLocationsModalOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

interface NavTabDefinition {
  id: AppTabId;
  label: string;
  mobileLabel: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
}

const MOBILE_PRIMARY_TAB_IDS: ReadonlyArray<AppTabId> = [
  'forecast',
  'comparison',
  'planner',
  'map',
  'field',
];

export const AppShell: React.FC<AppShellProps> = ({
  activeTab,
  onTabChange,
  theme,
  onToggleTheme,
  activeLocation,
  savedLocations,
  healthSnapshot,
  activeAlertsCount = 0,
  unreadNotificationsCount = 0,
  viewMode,
  onViewModeChange,
  isRefreshingForecast = false,
  onRefreshForecast,
  onSelectLocation,
  onSaveLocation,
  onRenameLocation,
  onToggleFavoriteLocation,
  onDeleteLocation,
  onSearchQuery,
  onRequestGps,
  primaryLocationKey,
  onSetPrimaryLocation,
  onRunHealthCheck,
  onClearErrorLogs,
  onActivateTemplate,
  onToast,
  isLocationsModalOpen: controlledLocationsOpen,
  onLocationsModalOpenChange,
  children,
}) => {
  const { locale, toggleLocale, tr } = useLocale();
  const viewport = useViewportResize();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() =>
    loadPersistedSidebarCollapsed(),
  );
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);
  const [internalViewMode, setInternalViewMode] = useState<ForecastViewMode>('fieldcast');

  const [internalLocationsOpen, setInternalLocationsOpen] = useState(false);
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isHealthOpen, setIsHealthOpen] = useState(false);

  const effectiveViewMode = viewMode ?? internalViewMode;

  const handleModelModeChange = useCallback(
    (nextMode: ForecastViewMode) => {
      if (viewMode === undefined) {
        setInternalViewMode(nextMode);
      }
      onViewModeChange?.(nextMode);
    },
    [onViewModeChange, viewMode],
  );

  const isLocationsOpen = controlledLocationsOpen ?? internalLocationsOpen;
  const setLocationsOpen = useCallback(
    (open: boolean) => {
      setInternalLocationsOpen(open);
      onLocationsModalOpenChange?.(open);
    },
    [onLocationsModalOpenChange],
  );

  const handleToggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      persistSidebarCollapsed(next);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          dispatchFieldCastLayoutRefresh();
          window.dispatchEvent(new Event('resize'));
        }, 220);
      }
      return next;
    });
  }, []);

  // Fecha o drawer mobile automaticamente ao migrar para viewport desktop
  useEffect(() => {
    if (!viewport.isMobile && isMobileDrawerOpen) {
      setIsMobileDrawerOpen(false);
    }
  }, [isMobileDrawerOpen, viewport.isMobile]);

  // Tecla Escape e bloqueio de rolagem de fundo no Drawer Mobile
  useEffect(() => {
    if (!isMobileDrawerOpen || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileDrawerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileDrawerOpen]);

  const locationContextValue = useMemo<AppLocationContextValue>(
    () => ({
      activeLocation,
      savedLocations,
      onSelectLocation,
      onSaveLocation,
      onRequestGps,
      openLocationsModal: () => setLocationsOpen(true),
    }),
    [activeLocation, onRequestGps, onSaveLocation, onSelectLocation, savedLocations, setLocationsOpen],
  );

  const originBadgeLabels: Record<ActiveCoordinates['origin'], string> = {
    gps: 'GPS',
    ip: tr('Rede', 'Network'),
    cached: tr('Salvo', 'Saved'),
    saved: tr('Salvo', 'Saved'),
    search: tr('Pin / Busca', 'Pin / Search'),
  };

  const allTabs: NavTabDefinition[] = [
    {
      id: 'forecast',
      label: tr('Resumo', 'Summary'),
      mobileLabel: tr('Resumo', 'Summary'),
      description: tr(
        'Condições atuais, eventos extremos e resumo diário',
        'Current conditions, extreme events and daily summary',
      ),
      Icon: CloudSun,
      badgeCount: activeAlertsCount > 0 ? activeAlertsCount : undefined,
    },
    {
      id: 'comparison',
      label: tr('Modelos', 'Models'),
      mobileLabel: tr('Modelos', 'Models'),
      description: tr(
        'Comparação multi-modelo 168h e gráficos sob demanda',
        '168h multi-model comparison and on-demand charts',
      ),
      Icon: GitCompare,
    },
    {
      id: 'navigation',
      label: tr('Navegação', 'Marine'),
      mobileLabel: tr('Navegar', 'Marine'),
      description: tr(
        'Marés MSL, ondas, correntes e bússola costeira',
        'MSL tides, waves, currents and coastal compass',
      ),
      Icon: Anchor,
    },
    {
      id: 'aeronautics',
      label: tr('Aeronáutica', 'Aero & Drone'),
      mobileLabel: tr('Drone/Kp', 'Drone/Kp'),
      description: tr(
        'Voo de drone, perfil vertical, cisalhamento e índice Kp',
        'Drone flight, vertical profile, wind shear and Kp index',
      ),
      Icon: Plane,
    },
    {
      id: 'planner',
      label: tr('Planejamento', 'Route Planner'),
      mobileLabel: tr('Rotas', 'Routes'),
      description: tr(
        'Planejamento de rotas 4D (náutico e aéreo/VANT) com ETA',
        '4D route planning (coastal and aerial/UAV) with ETA',
      ),
      Icon: Route,
    },
    {
      id: 'map',
      label: tr('Mapa', 'Map & Radar'),
      mobileLabel: tr('Mapa', 'Map'),
      description: tr(
        'Mapa interativo, trava de pin, radar e mapas offline',
        'Interactive map, pin lock, radar and offline maps',
      ),
      Icon: MapIcon,
    },
    {
      id: 'field',
      label: tr('Armazenamento', 'Field & Data'),
      mobileLabel: tr('Dados', 'Data'),
      description: tr(
        'Rotas GPS, marcações, séries históricas e relatórios',
        'GPS routes, waypoints, historical series and reports',
      ),
      Icon: Database,
    },
    {
      id: 'settings',
      label: tr('Configurações', 'Settings'),
      mobileLabel: tr('Ajustes', 'Settings'),
      description: tr(
        'Notificações customizadas, janelas horárias e limites',
        'Custom notifications, time windows and thresholds',
      ),
      Icon: Settings,
      badgeCount: unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined,
    },
  ];

  const tabs = allTabs.filter((tab) => ENABLED_TABS.includes(tab.id));
  const mobilePrimaryTabs = IS_MINIMAL_EDITION
    ? tabs
    : tabs.filter((tab) => MOBILE_PRIMARY_TAB_IDS.includes(tab.id));
  const mobilePrimaryTabIds = mobilePrimaryTabs.map((tab) => tab.id);
  const isSecondaryMobileTabActive = !mobilePrimaryTabIds.includes(activeTab);

  const handleRefreshClick = () => {
    if (!onRefreshForecast) {
      return;
    }
    void safeAction(async () => onRefreshForecast(), {
      actionKey: 'app_shell_refresh_forecast',
      moduleName: 'AppShell',
      errorTitle: tr('Não foi possível atualizar a previsão', 'Could not refresh forecast'),
      onToast,
    });
  };

  const handleMobileDrawerSelectTab = (tabId: AppTabId) => {
    onTabChange(tabId);
    setIsMobileDrawerOpen(false);
  };

  return (
    <AppLocationContext.Provider value={locationContextValue}>
      <div
        data-testid="app-shell-root"
        data-layout-epoch={viewport.layoutEpoch}
        data-orientation={viewport.isLandscape ? 'landscape' : 'portrait'}
        className="min-h-screen w-full max-w-[100vw] overflow-x-clip flex flex-col bg-[#f1f5f9] text-slate-800 dark:bg-[#0d1f36] dark:text-sky-50"
      >
        {/* Clean Ocean-Blue Top Header with Safe-Area Top Padding */}
        <header className="sticky top-0 z-30 w-full max-w-[100vw] shadow-md bg-[#0080cd] dark:bg-[#0a3656] text-white pt-[env(safe-area-inset-top,0px)]">
          <div className="max-w-[1600px] w-full mx-auto px-2.5 sm:px-5 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 min-w-0">
            {/* Brand Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <img
                src={`${import.meta.env.BASE_URL}icon.svg`}
                alt="FieldCast"
                className="w-8 h-8 rounded-xl shadow-sm border border-white/25 bg-white/10"
              />
              <div>
                <span className="text-base font-extrabold tracking-tight text-white block leading-none">
                  {IS_MINIMAL_EDITION ? 'FieldCast Minimal' : 'FieldCast'}
                </span>
                <span className="text-[10px] font-medium text-sky-100">
                  {IS_MINIMAL_EDITION
                    ? tr('Previsão & Radar', 'Forecast & Radar')
                    : tr('Previsão & Campo', 'Forecast & Field')}
                </span>
              </div>
            </div>

            {/* Centered Rounded White Search & Map Pin Trigger Pill */}
            <div className="order-3 md:order-2 w-full md:w-auto md:flex-1 max-w-xl mx-auto min-w-0 md:min-w-[220px]">
              <button
                type="button"
                onClick={() => setLocationsOpen(true)}
                aria-label={tr(
                  `Local ativo: ${activeLocation.name}. Clique para buscar uma localidade ou dar um Pin no mapa.`,
                  `Active location: ${activeLocation.name}. Click to search a location or drop a map pin.`,
                )}
                className="w-full min-h-[44px] px-4 py-1.5 rounded-full bg-white text-slate-800 hover:bg-sky-50 shadow-sm flex items-center justify-between gap-2.5 transition-all focus:outline-none focus:ring-2 focus:ring-sky-200 min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <MapPin className="w-4 h-4 text-[#0080cd] shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                    {activeLocation.name}
                  </span>
                  <span className="hidden lg:inline-block text-[11px] text-slate-500 font-mono shrink-0">
                    ({activeLocation.latitude.toFixed(3)}°, {activeLocation.longitude.toFixed(3)}°)
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0070b8]">
                    {activeLocation.isApproximateIp
                      ? tr('Aproximado por Rede', 'Approx. Network')
                      : originBadgeLabels[activeLocation.origin]}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#0080cd] text-white">
                    <Search className="w-3 h-3" aria-hidden="true" />
                    <span className="hidden sm:inline">{tr('Buscar / Pin', 'Search / Pin')}</span>
                  </span>
                </div>
              </button>
            </div>

            {/* Right Controls: Refresh, PT/EN Toggle, Glossary, Theme Toggle, Settings Gear, HealthBadge */}
            <div className="order-2 md:order-3 flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0">
              {onRefreshForecast && (
                <button
                  type="button"
                  data-testid="refresh-forecast-btn"
                  onClick={handleRefreshClick}
                  disabled={isRefreshingForecast}
                  aria-label={tr(
                    'Atualizar previsão meteorológica',
                    'Refresh weather forecast',
                  )}
                  title={tr('Atualizar Previsão', 'Refresh Forecast')}
                  className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isRefreshingForecast ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              )}

              {/* Bilingual PT / EN Toggle */}
              <button
                type="button"
                data-testid="locale-toggle-btn"
                onClick={toggleLocale}
                aria-label={tr(
                  'Alternar idioma para Inglês (EN)',
                  'Switch language to Portuguese (PT)',
                )}
                title={tr(
                  'Idioma: Português (clique para Inglês)',
                  'Language: English (click for Portuguese)',
                )}
                className="min-h-[44px] min-w-[44px] px-2.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 inline-flex items-center justify-center gap-1 text-xs font-extrabold tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                <span
                  className={
                    locale === 'pt' ? 'underline decoration-2 underline-offset-2' : 'opacity-70'
                  }
                >
                  PT
                </span>
                <span className="opacity-50">/</span>
                <span
                  className={
                    locale === 'en' ? 'underline decoration-2 underline-offset-2' : 'opacity-70'
                  }
                >
                  EN
                </span>
              </button>

              {/* Glossary Button (Icon-only compact) */}
              <button
                type="button"
                onClick={() => setIsGlossaryOpen(true)}
                aria-label={tr('Abrir Guia Rápido e Glossário', 'Open Quick Guide & Glossary')}
                title={tr('Guia Rápido & Glossário', 'Quick Guide & Glossary')}
                className="hidden sm:inline-flex min-h-[44px] min-w-[44px] p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
              </button>

              {/* Theme Toggle (Icon-only compact) */}
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={
                  theme === 'dark'
                    ? tr('Alternar para Tema Claro Clean', 'Switch to Clean Light Theme')
                    : tr('Alternar para Tema Noturno', 'Switch to Dark Theme')
                }
                title={
                  theme === 'dark'
                    ? tr('Tema Claro Clean (Azul e Branco)', 'Clean Light Theme (Blue & White)')
                    : tr('Tema Noturno Oceânico', 'Oceanic Dark Theme')
                }
                className="hidden sm:inline-flex min-h-[44px] min-w-[44px] p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-300" aria-hidden="true" />
                ) : (
                  <Moon className="w-4 h-4 text-sky-100" aria-hidden="true" />
                )}
              </button>

              {/* Direct Header Settings Gear Button */}
              <button
                type="button"
                data-testid="header-settings-btn"
                onClick={() => onTabChange('settings')}
                aria-label={tr(
                  'Abrir Configurações e Alertas',
                  'Open Settings and Alerts',
                )}
                aria-current={activeTab === 'settings' ? 'page' : undefined}
                title={tr('Configurações & Alertas', 'Settings & Alerts')}
                className={`relative min-h-[44px] min-w-[44px] p-2 rounded-xl border inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/70 ${
                  activeTab === 'settings'
                    ? 'bg-white text-[#0070b8] border-white shadow-sm'
                    : 'bg-white/15 hover:bg-white/25 text-white border-white/20'
                }`}
              >
                <Settings className="w-4 h-4 shrink-0" aria-hidden="true" />
                {unreadNotificationsCount > 0 && (
                  <span
                    className={`absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      activeTab === 'settings'
                        ? 'bg-[#0080cd] text-white'
                        : 'bg-amber-400 text-slate-950'
                    }`}
                  >
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>

              {/* Fixed Health Check Badge */}
              <HealthBadge
                snapshot={healthSnapshot}
                onClick={() => setIsHealthOpen(true)}
                className="min-h-[44px] min-w-[44px]"
              />
            </div>
          </div>
        </header>

        {/* Body Workspace: Desktop Retractable Sidebar + Main Content */}
        <div className="relative flex-1 flex w-full max-w-[100vw] min-w-0">
          {isSidebarCollapsed && (
            <button
              type="button"
              data-testid="sidebar-collapse-toggle"
              onClick={handleToggleSidebarCollapsed}
              aria-expanded={false}
              aria-label={tr('Expandir barra lateral', 'Expand sidebar')}
              title={tr('Expandir barra lateral', 'Expand sidebar')}
              className="hidden md:inline-flex fixed left-1.5 top-[72px] z-40 min-h-[44px] min-w-[44px] w-9 h-9 rounded-full border border-sky-200 dark:border-sky-700 bg-white/95 dark:bg-[#132a47]/95 hover:bg-sky-50 dark:hover:bg-sky-900/70 text-[#0080cd] dark:text-sky-200 shadow-md items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          )}

          {/* Desktop Retractable Left Sidebar (0px visual footprint when collapsed) */}
          <aside
            data-testid="app-retractable-sidebar"
            aria-label={tr('Barra Lateral de Módulos', 'Modules Sidebar')}
            data-collapsed={isSidebarCollapsed ? 'true' : 'false'}
            className={`hidden md:block shrink-0 transition-[width,opacity] duration-200 ${
              isSidebarCollapsed
                ? 'w-0 overflow-hidden border-r-0 opacity-0 pointer-events-none'
                : 'w-56 border-r border-sky-200/80 dark:border-sky-800/70 bg-white/95 dark:bg-[#0f243d]/95 opacity-100'
            }`}
          >
            <div className="sticky top-[62px] flex flex-col gap-2 p-2 max-h-[calc(100vh-62px)] overflow-y-auto scrollbar-thin min-w-0">
              {/* Sidebar Header & Collapse Toggle */}
              <div className="flex items-center justify-between px-1 gap-2 min-w-0">
                <div className="min-w-0">
                  <span className="block text-[10px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300 truncate">
                    {tr('Módulos', 'Modules')}
                  </span>
                  <span className="block text-xs font-semibold text-slate-600 dark:text-sky-200/80 truncate">
                    {activeLocation.name}
                  </span>
                </div>

                {!isSidebarCollapsed && (
                  <button
                    type="button"
                    data-testid="sidebar-collapse-toggle"
                    onClick={handleToggleSidebarCollapsed}
                    aria-expanded={true}
                    aria-label={tr('Recolher barra lateral', 'Collapse sidebar')}
                    title={tr('Recolher barra lateral', 'Collapse sidebar')}
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-sky-200/80 dark:border-sky-800 bg-sky-50/80 dark:bg-[#132a47] hover:bg-sky-100 dark:hover:bg-sky-900/60 text-slate-700 dark:text-sky-100 inline-flex items-center justify-center shrink-0 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              {/* Desktop Primary Navigation (All 8 Tabs) */}
              <nav
                aria-label={tr('Navegação Principal Desktop', 'Desktop Primary Navigation')}
                className="hidden md:flex flex-col gap-1.5 min-w-0"
              >
                {tabs.map(({ id, label, Icon, badgeCount }) => {
                  const isActive = activeTab === id;
                  const desktopTestId =
                    id === 'planner' && !viewport.isMobile
                      ? 'nav-tab-planner'
                      : `desktop-tab-${id}`;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={desktopTestId}
                      onClick={() => onTabChange(id)}
                      aria-current={isActive ? 'page' : undefined}
                      title={label}
                      className={`relative min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center ${
                        isSidebarCollapsed ? 'justify-center' : 'justify-between'
                      } gap-2.5 transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                        isActive
                          ? 'bg-[#0080cd] text-white shadow-sm'
                          : 'text-slate-700 dark:text-sky-100 hover:bg-sky-50 dark:hover:bg-sky-900/40'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span className={isSidebarCollapsed ? 'sr-only' : 'truncate'}>
                          {label}
                        </span>
                      </span>

                      {badgeCount !== undefined && badgeCount > 0 && (
                        <span
                          className={`${
                            isSidebarCollapsed
                              ? 'absolute top-1 right-1 px-1 py-0.2 text-[9px]'
                              : 'px-1.5 py-0.5 text-[10px]'
                          } rounded-full font-extrabold shrink-0 ${
                            isActive
                              ? 'bg-white text-[#0080cd]'
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
          </aside>

          {/* Main Content Workspace */}
          <main className="flex-1 min-w-0 max-w-full px-2.5 sm:px-5 pt-3 sm:pt-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-8">
            <div className="max-w-[1440px] w-full mx-auto min-w-0">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile Fixed Bottom Tab Bar (Quick Tabs + Menu Drawer Button >= 48x44px) */}
        <nav
          aria-label={tr('Navegação Principal Mobile', 'Mobile Primary Navigation')}
          className="md:hidden fixed bottom-0 inset-x-0 z-40 max-w-[100vw] border-t border-sky-200 dark:border-sky-800/70 bg-white/95 dark:bg-[#0f243d]/95 backdrop-blur-md px-1.5 pt-2 pb-[max(0.65rem,env(safe-area-inset-bottom,0px))] shadow-xl"
        >
          <div
            className={`grid ${
              IS_MINIMAL_EDITION ? 'grid-cols-5' : 'grid-cols-6'
            } gap-1 max-w-lg mx-auto min-w-0`}
          >
            {mobilePrimaryTabs.map(({ id, label, mobileLabel, Icon, badgeCount }) => {
              const isActive = activeTab === id && !isMobileDrawerOpen;
              const mobileTestId =
                id === 'planner' && viewport.isMobile
                  ? 'nav-tab-planner'
                  : `mobile-tab-${id}`;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={mobileTestId}
                  aria-label={label}
                  onClick={() => {
                    setIsMobileDrawerOpen(false);
                    onTabChange(id);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={`min-h-[48px] min-w-[44px] py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors relative focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isActive
                      ? 'bg-[#0080cd] text-white shadow-sm'
                      : 'text-slate-600 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/40'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="text-[10px] leading-tight truncate max-w-full">
                    {mobileLabel}
                  </span>
                  {badgeCount !== undefined && badgeCount > 0 && (
                    <span
                      className={`absolute top-0.5 right-1 px-1 py-0.2 rounded-full text-[9px] font-bold ${
                        isActive ? 'bg-white text-[#0080cd]' : 'bg-amber-500 text-slate-950'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Slide-Over Drawer Toggle Button */}
            <button
              type="button"
              data-testid="mobile-drawer-toggle"
              aria-label="Menu"
              aria-expanded={isMobileDrawerOpen}
              aria-controls="mobile-sidebar-drawer"
              onClick={() => setIsMobileDrawerOpen((prev) => !prev)}
              className={`min-h-[48px] min-w-[44px] py-1.5 px-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors relative focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                isMobileDrawerOpen || isSecondaryMobileTabActive
                  ? 'bg-[#0080cd] text-white shadow-sm'
                  : 'text-slate-600 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/40'
              }`}
            >
              <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="text-[10px] leading-tight truncate max-w-full">Menu</span>
              {unreadNotificationsCount > 0 && (
                <span
                  className={`absolute top-0.5 right-1 px-1 py-0.2 rounded-full text-[9px] font-bold ${
                    isMobileDrawerOpen || isSecondaryMobileTabActive
                      ? 'bg-white text-[#0080cd]'
                      : 'bg-amber-500 text-slate-950'
                  }`}
                >
                  {unreadNotificationsCount}
                </span>
              )}
            </button>
          </div>
        </nav>

        {/* Mobile Slide-Over Sidebar Drawer (All 7 Tabs + Model Switch + Theme + Glossary) */}
        {isMobileDrawerOpen && (
          <div
            className="md:hidden fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setIsMobileDrawerOpen(false)}
          >
            <aside
              id="mobile-sidebar-drawer"
              data-testid="mobile-sidebar-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={tr('Menu Completo FieldCast', 'FieldCast Full Menu')}
              onClick={(e) => e.stopPropagation()}
              className="w-[min(88vw,360px)] max-w-full h-full flex flex-col justify-between bg-white dark:bg-[#0f243d] text-slate-800 dark:text-sky-50 border-l border-sky-200 dark:border-sky-800 shadow-2xl overflow-y-auto px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] gap-5"
            >
              <div className="space-y-5 min-w-0">
                {/* Drawer Header */}
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-sky-100 dark:border-sky-800/80">
                  <div className="min-w-0">
                    <span className="block text-base font-extrabold text-slate-900 dark:text-white truncate">
                      {tr('Menu FieldCast', 'FieldCast Menu')}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-sky-200/80 truncate">
                      {activeLocation.name}
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid="mobile-drawer-close"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    aria-label={tr('Fechar menu lateral', 'Close side menu')}
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-[#132a47] text-slate-700 dark:text-sky-100 inline-flex items-center justify-center hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>

                {/* All Enabled Modular Tabs */}
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300 px-1">
                    {tr(`Todas as Seções (${tabs.length})`, `All Sections (${tabs.length})`)}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {tabs.map(({ id, label, description, Icon, badgeCount }) => {
                      const isActive = activeTab === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          data-testid={`mobile-drawer-tab-${id}`}
                          onClick={() => handleMobileDrawerSelectTab(id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={`min-h-[48px] min-w-[44px] px-3.5 py-2 rounded-xl text-left flex items-center justify-between gap-3 border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                            isActive
                              ? 'bg-[#0080cd] text-white border-[#0070b8] shadow-sm'
                              : 'bg-sky-50/70 dark:bg-[#132a47]/80 text-slate-800 dark:text-sky-100 border-sky-200/70 dark:border-sky-800/80 hover:bg-sky-100 dark:hover:bg-sky-900/50'
                          }`}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block text-xs font-bold truncate">{label}</span>
                              <span
                                className={`block text-[10px] truncate ${
                                  isActive
                                    ? 'text-sky-100'
                                    : 'text-slate-500 dark:text-sky-300/75'
                                }`}
                              >
                                {description}
                              </span>
                            </span>
                          </span>

                          {badgeCount !== undefined && badgeCount > 0 && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                                isActive
                                  ? 'bg-white text-[#0080cd]'
                                  : 'bg-amber-400 text-slate-950'
                              }`}
                            >
                              {badgeCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Model Switch */}
                <div className="space-y-2 pt-2 border-t border-sky-100 dark:border-sky-800/80">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300 px-1">
                    {tr('Modelo Meteorológico Rápido', 'Quick Weather Model')}
                  </span>
                  <ModelModeSwitchPill
                    viewMode={effectiveViewMode}
                    onViewModeChange={handleModelModeChange}
                    allowSpaghetti
                    compact
                  />
                </div>
              </div>

              {/* Drawer Footer: Theme Toggle & Quick Glossary */}
              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-sky-100 dark:border-sky-800/80">
                <button
                  type="button"
                  data-testid="mobile-drawer-theme-toggle"
                  onClick={onToggleTheme}
                  className="min-h-[48px] min-w-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-[#132a47] text-slate-800 dark:text-sky-100 text-xs font-bold inline-flex items-center justify-center gap-2 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <span>{tr('Tema Claro', 'Light Theme')}</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-sky-700 shrink-0" aria-hidden="true" />
                      <span>{tr('Tema Noturno', 'Dark Theme')}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  data-testid="mobile-drawer-glossary-btn"
                  onClick={() => {
                    setIsMobileDrawerOpen(false);
                    setIsGlossaryOpen(true);
                  }}
                  className="min-h-[48px] min-w-[44px] px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-[#132a47] text-slate-800 dark:text-sky-100 text-xs font-bold inline-flex items-center justify-center gap-2 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <BookOpen className="w-4 h-4 text-[#0080cd] dark:text-sky-300 shrink-0" aria-hidden="true" />
                  <span>{tr('Glossário', 'Glossary')}</span>
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Modals managed by AppShell */}
        <GlossaryModal
          isOpen={isGlossaryOpen}
          onClose={() => setIsGlossaryOpen(false)}
          onActivateTemplate={onActivateTemplate}
        />

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
          primaryLocationKey={primaryLocationKey}
          onSetPrimaryLocation={onSetPrimaryLocation}
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
