import React, { useCallback, useEffect, useState } from 'react';
import { Check, Clock, Eye, EyeOff, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { ActiveCoordinates, SavedLocation } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type {
  ForecastViewMode,
  NormalizedForecast,
  SafeWindowThresholds,
} from '../../types/weather';
import {
  formatLocalHourBadge,
  useCurrentLocalHourIndex,
} from '../../utils/localTimeHour';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { ForecastSkeleton } from '../common/SkeletonLoaders';
import { useAppLocationContext } from '../layout/AppShell';
import { ActiveAlertsBanner } from './ActiveAlertsBanner';
import { CurrentSummaryCard } from './CurrentSummaryCard';
import { EphemerisCard } from './EphemerisCard';
import { ForecastCharts } from './ForecastCharts';
import { ForecastPinMiniMap } from './ForecastPinMiniMap';
import {
  COMPLETE_VISIBLE_PARAMS,
  ESSENTIAL_VISIBLE_PARAMS,
  FORECAST_PARAM_DEFINITIONS,
  type ForecastParamKey,
  type ForecastVisibleParams,
  loadPersistedVisibleParams,
  persistVisibleParams,
  QUICK_SUMMARY_VISIBLE_PARAMS,
} from './forecastParamsVisibility';
import { type ForecastHorizonHours, ModelSelectorBar } from './ModelSelectorBar';
import { ThresholdSettingsModal } from './ThresholdSettingsModal';
import { WindguruTable } from './WindguruTable';

export interface ForecastTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  savedLocations?: SavedLocation[];
  isLoading?: boolean;
  isDark?: boolean;
  viewMode?: ForecastViewMode;
  onViewModeChange?: (mode: ForecastViewMode) => void;
  thresholds?: SafeWindowThresholds;
  onSaveThresholds?: (nextThresholds: SafeWindowThresholds) => void | Promise<void>;
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
  onOpenLocationsModal?: () => void;
  onReloadForecast?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

/**
 * Aba Previsão — Estética Clean Azul, Branco e Azul-Claro (Climatempo + Windy + Windguru):
 * 1. Card de Resumo do Dia com 6 Blocos Limpos + Grau de Certeza + Janela Segura
 * 2. Mapa Interativo de Pin com Bandeirinha Estilo Windy (seleção de ponto e área no mapa)
 * 3. Barra "Parâmetros Visíveis (Mostrar / Ocultar)" para evitar poluição visual
 * 4. Cards Brancos de Índices e Condições do Dia com bolinha de status no canto
 * 5. Seletor de Modelos + Gráficos Hora a Hora com pílulas por parâmetro
 * 6. Tabela Horária Compacta estilo Windguru (168h) com Heatmap, Tune e Compare
 * 7. Efemérides Solares e Lunares
 */
export const ForecastTab: React.FC<ForecastTabProps> = ({
  forecast,
  activeLocation,
  savedLocations: propSavedLocations,
  isLoading = false,
  isDark = false,
  viewMode: propViewMode,
  onViewModeChange: propOnViewModeChange,
  thresholds,
  onSaveThresholds,
  onSelectLocation: propOnSelectLocation,
  onSaveLocation: propOnSaveLocation,
  onRequestGps: propOnRequestGps,
  onOpenLocationsModal,
  onReloadForecast,
  onToast,
  onErrorLog,
}) => {
  const locationCtx = useAppLocationContext();
  const resolvedOnSelectLocation = propOnSelectLocation ?? locationCtx?.onSelectLocation;
  const resolvedOnSaveLocation = propOnSaveLocation ?? locationCtx?.onSaveLocation;
  const resolvedOnRequestGps = propOnRequestGps ?? locationCtx?.onRequestGps;
  const resolvedSavedLocations = propSavedLocations ?? locationCtx?.savedLocations ?? [];

  const [internalViewMode, setInternalViewMode] = useState<ForecastViewMode>('fieldcast');
  const viewMode = propViewMode ?? internalViewMode;
  const setViewMode = useCallback(
    (nextMode: ForecastViewMode) => {
      setInternalViewMode(nextMode);
      propOnViewModeChange?.(nextMode);
    },
    [propOnViewModeChange],
  );
  const [showInterpolatedProfile, setShowInterpolatedProfile] = useState<boolean>(false);
  const [horizonHours, setHorizonHours] = useState<ForecastHorizonHours>(168);
  const currentLocalHourIndex = useCurrentLocalHourIndex(forecast?.hours, forecast?.timezone);
  const [manualHourIndex, setManualHourIndex] = useState<number | null>(null);
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState<boolean>(false);
  const [isMiniMapOpen, setIsMiniMapOpen] = useState<boolean>(true);

  const forecastKey = forecast
    ? `${forecast.locationKey}_${forecast.hours[0]?.timestampUnix ?? 0}`
    : '';

  useEffect(() => {
    setManualHourIndex(null);
  }, [forecastKey]);

  const handleSelectHourIndex = useCallback(
    (idx: number) => {
      if (idx === currentLocalHourIndex) {
        setManualHourIndex(null);
      } else {
        setManualHourIndex(idx);
      }
    },
    [currentLocalHourIndex],
  );

  const handleResetToCurrentHour = useCallback(() => {
    setManualHourIndex(null);
  }, []);

  const [visibleParams, setVisibleParams] = useState<ForecastVisibleParams>(() =>
    loadPersistedVisibleParams(),
  );

  const updateVisibleParams = useCallback((next: ForecastVisibleParams) => {
    setVisibleParams(next);
    persistVisibleParams(next);
  }, []);

  const handleToggleParam = useCallback((key: ForecastParamKey) => {
    setVisibleParams((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persistVisibleParams(next);
      return next;
    });
  }, []);

  if (isLoading && !forecast) {
    return <ForecastSkeleton />;
  }

  if (!forecast) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-sky-800 bg-white dark:bg-[#132a47] p-8 text-center space-y-3 shadow-sm">
        <p className="text-base font-bold text-slate-900 dark:text-white">
          Nenhuma previsão carregada para {activeLocation.name}
        </p>
        <p className="text-xs text-slate-600 dark:text-sky-200">
          Verifique sua conexão ou escolha um ponto salvo no mapa.
        </p>
        {onReloadForecast && (
          <button
            type="button"
            onClick={() => void onReloadForecast()}
            className="min-h-[42px] min-w-[44px] px-5 py-2.5 rounded-full text-xs font-bold bg-[#0080cd] hover:bg-[#006bb3] text-white transition-colors"
          >
            Tentar Novamente
          </button>
        )}
      </div>
    );
  }

  const rawHourIndex = manualHourIndex ?? currentLocalHourIndex;
  const safeHourIndex = Math.min(
    Math.max(0, rawHourIndex),
    Math.max(0, forecast.hours.length - 1),
  );
  const selectedHour = forecast.hours[safeHourIndex];
  const activeThresholds = thresholds ?? forecast.thresholdsUsed;

  const isEssentialPreset =
    JSON.stringify(visibleParams) === JSON.stringify(ESSENTIAL_VISIBLE_PARAMS);
  const isCompletePreset =
    JSON.stringify(visibleParams) === JSON.stringify(COMPLETE_VISIBLE_PARAMS);
  const isQuickPreset =
    JSON.stringify(visibleParams) === JSON.stringify(QUICK_SUMMARY_VISIBLE_PARAMS);

  const currentLocalHourObj = forecast.hours[currentLocalHourIndex];
  const currentLocalHHMM = currentLocalHourObj
    ? formatLocalHourBadge(currentLocalHourObj.timestampUnix, forecast.timezone)
    : '00:00';

  return (
    <ModuleErrorBoundary
      moduleName="Aba Previsão (Climatempo / Windy / Windguru)"
      onReset={onReloadForecast}
      onErrorLog={onErrorLog}
    >
      <div className="space-y-4 sm:space-y-5">
        {manualHourIndex !== null && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50/90 dark:bg-amber-950/50 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950 dark:text-amber-100">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Você está inspecionando outra janela horária ({formatLocalHourBadge(selectedHour?.timestampUnix ?? 0, forecast.timezone)}).
            </span>
            <button
              type="button"
              onClick={handleResetToCurrentHour}
              className="min-h-[30px] px-3 py-1 rounded-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors"
            >
              Agora ({currentLocalHHMM})
            </button>
          </div>
        )}

        {/* 1. Card de Resumo do Dia + Grau de Certeza + Janela Segura */}
        <CurrentSummaryCard
          forecast={forecast}
          activeLocation={activeLocation}
          selectedHourIndex={safeHourIndex}
          onResetToCurrentHour={manualHourIndex !== null ? handleResetToCurrentHour : undefined}
          onOpenThresholdModal={() => setIsThresholdModalOpen(true)}
          onOpenLocationsModal={onOpenLocationsModal}
          visibleParams={visibleParams}
          isMiniMapOpen={isMiniMapOpen}
          onToggleMiniMap={() => setIsMiniMapOpen((prev) => !prev)}
        />

        {/* 2. Mapa Interativo de Pin Estilo Windy (Bandeirinha com Vento + Seleção de Ponto/Área) */}
        {isMiniMapOpen && (
          <ForecastPinMiniMap
            activeLocation={activeLocation}
            savedLocations={resolvedSavedLocations}
            forecast={forecast}
            viewMode={viewMode}
            selectedHourIndex={safeHourIndex}
            currentWindSpeedKmh={selectedHour?.windSpeed10m.mean ?? null}
            currentWindDirectionDeg={selectedHour?.windDirection10m.degree ?? null}
            onSelectLocation={resolvedOnSelectLocation}
            onSaveLocation={resolvedOnSaveLocation}
            onRequestGps={resolvedOnRequestGps}
            onToast={onToast}
          />
        )}

        {/* 3. Barra "Parâmetros Visíveis (Mostrar / Ocultar)" — Tune Filter */}
        <section
          aria-label="Parâmetros Visíveis (Mostrar e Ocultar)"
          className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-3.5 sm:p-4 shadow-sm space-y-2.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/60 text-[#0080cd] dark:text-sky-300">
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                  Parâmetros Visíveis (Mostrar / Ocultar)
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-sky-200/75">
                  Oculte ou exiba variáveis nos cartões, gráficos e tabela para manter a leitura limpa
                </p>
              </div>
            </div>

            {/* Quick Presets: Essencial (Limpo), Resumo Rápido, Completo (Todos) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => updateVisibleParams(ESSENTIAL_VISIBLE_PARAMS)}
                aria-pressed={isEssentialPreset}
                className={`min-h-[32px] px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1 border transition-colors ${
                  isEssentialPreset
                    ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                    : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
                }`}
              >
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                <span>Essencial (Limpo)</span>
              </button>

              <button
                type="button"
                onClick={() => updateVisibleParams(QUICK_SUMMARY_VISIBLE_PARAMS)}
                aria-pressed={isQuickPreset}
                className={`min-h-[32px] px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 border transition-colors ${
                  isQuickPreset
                    ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                    : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
                }`}
              >
                <span>Resumo Rápido</span>
              </button>

              <button
                type="button"
                onClick={() => updateVisibleParams(COMPLETE_VISIBLE_PARAMS)}
                aria-pressed={isCompletePreset}
                className={`min-h-[32px] px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 border transition-colors ${
                  isCompletePreset
                    ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                    : 'bg-[#f4f8fb] dark:bg-[#0d1f36] text-slate-700 dark:text-sky-200 border-slate-200 dark:border-sky-800 hover:bg-sky-50'
                }`}
              >
                <span>Completo (Todos)</span>
              </button>
            </div>
          </div>

          {/* Individual Parameter Toggle Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {FORECAST_PARAM_DEFINITIONS.map((def) => {
              const isVisible = visibleParams[def.key];
              return (
                <button
                  key={def.key}
                  type="button"
                  onClick={() => handleToggleParam(def.key)}
                  aria-pressed={isVisible}
                  className={`min-h-[32px] px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border transition-all ${
                    isVisible
                      ? 'bg-sky-50 dark:bg-sky-900/70 text-[#0070b8] dark:text-sky-100 border-sky-300 dark:border-sky-600 font-bold'
                      : 'bg-white dark:bg-[#0d1f36]/60 text-slate-400 dark:text-sky-300/50 border-slate-200 dark:border-sky-800/60 hover:text-slate-600'
                  }`}
                >
                  {isVisible ? (
                    <Check className="w-3.5 h-3.5 text-[#0080cd] dark:text-sky-300" aria-hidden="true" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                  )}
                  <span>{def.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. Cards Brancos de Índices / Alertas Operacionais (Bolinha de status no canto) */}
        {visibleParams.alerts && (
          <ActiveAlertsBanner
            alerts={forecast.alerts}
            selectedHour={selectedHour}
            timezone={forecast.timezone}
            showInterpolatedProfile={showInterpolatedProfile}
          />
        )}

        {/* 5. Seletor de Modelos + Gráficos Horários Apache ECharts */}
        {(visibleParams.charts || visibleParams.table168h) && (
          <ModelSelectorBar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showInterpolatedProfile={showInterpolatedProfile}
            onToggleInterpolatedProfile={setShowInterpolatedProfile}
            horizonHours={horizonHours}
            onHorizonHoursChange={setHorizonHours}
            atypicalShearWarning={selectedHour?.verticalProfile.atypicalShearWarning ?? false}
            showVerticalProfileControl={visibleParams.verticalProfile}
          />
        )}

        {visibleParams.charts && (
          <ForecastCharts
            forecast={forecast}
            viewMode={viewMode}
            showInterpolatedProfile={showInterpolatedProfile}
            horizonHours={horizonHours}
            selectedHourIndex={safeHourIndex}
            currentHourIndex={currentLocalHourIndex}
            onSelectHourIndex={handleSelectHourIndex}
            onResetToCurrentHour={manualHourIndex !== null ? handleResetToCurrentHour : undefined}
            isDark={isDark}
            visibleParams={visibleParams}
          />
        )}

        {/* 6. Tabela Horária Compacta estilo Windguru (168h) */}
        {visibleParams.table168h && (
          <WindguruTable
            forecast={forecast}
            viewMode={viewMode}
            showInterpolatedProfile={showInterpolatedProfile}
            horizonHours={horizonHours}
            selectedHourIndex={safeHourIndex}
            currentHourIndex={currentLocalHourIndex}
            onSelectHourIndex={handleSelectHourIndex}
            visibleParams={visibleParams}
            onToggleParam={handleToggleParam}
            onOpenThresholdModal={() => setIsThresholdModalOpen(true)}
          />
        )}

        {/* 7. Efemérides Solares e Lunares */}
        {visibleParams.ephemeris && (
          <EphemerisCard
            ephemerisByDay={forecast.ephemerisByDay}
            timezone={forecast.timezone}
          />
        )}

        {/* Fallback notice if user hid all sections */}
        {!visibleParams.alerts &&
          !visibleParams.charts &&
          !visibleParams.table168h &&
          !visibleParams.ephemeris && (
            <div className="rounded-2xl border border-dashed border-sky-200 bg-white dark:bg-[#132a47] p-6 text-center space-y-2">
              <Eye className="w-6 h-6 text-[#0080cd] mx-auto" />
              <p className="text-sm font-bold text-slate-800 dark:text-white">
                Os painéis abaixo estão ocultos no filtro de parâmetros
              </p>
              <button
                type="button"
                onClick={() => updateVisibleParams(ESSENTIAL_VISIBLE_PARAMS)}
                className="min-h-[38px] px-4 py-1.5 rounded-full text-xs font-bold bg-[#0080cd] text-white"
              >
                Restaurar Modo Essencial (Limpo)
              </button>
            </div>
          )}

        {/* Modal Configurável de Limites do Semáforo */}
        <ThresholdSettingsModal
          isOpen={isThresholdModalOpen}
          onClose={() => setIsThresholdModalOpen(false)}
          thresholds={activeThresholds}
          onSaveThresholds={async (next) => {
            if (onSaveThresholds) {
              await onSaveThresholds(next);
            }
          }}
          onToast={onToast}
        />
      </div>
    </ModuleErrorBoundary>
  );
};
