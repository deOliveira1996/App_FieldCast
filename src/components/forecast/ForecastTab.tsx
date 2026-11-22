import React, { useState } from 'react';
import type { ActiveCoordinates } from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type {
  ForecastViewMode,
  NormalizedForecast,
  SafeWindowThresholds,
} from '../../types/weather';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';
import { ForecastSkeleton } from '../common/SkeletonLoaders';
import { ActiveAlertsBanner } from './ActiveAlertsBanner';
import { CurrentSummaryCard } from './CurrentSummaryCard';
import { EphemerisCard } from './EphemerisCard';
import { ForecastCharts } from './ForecastCharts';
import { type ForecastHorizonHours, ModelSelectorBar } from './ModelSelectorBar';
import { ThresholdSettingsModal } from './ThresholdSettingsModal';
import { WindguruTable } from './WindguruTable';

export interface ForecastTabProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  isLoading?: boolean;
  isDark?: boolean;
  thresholds?: SafeWindowThresholds;
  onSaveThresholds?: (nextThresholds: SafeWindowThresholds) => void | Promise<void>;
  onOpenLocationsModal?: () => void;
  onReloadForecast?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

/**
 * Aba Previsão — Hierarquia estrita inspirada em Windy / Windguru (Seção 6.3 da SPEC):
 * 1. Resumo Atual + Seletor de Pontos Salvos/Busca + Badge de Confiança + Semáforo de Janela Segura
 * 2. Alertas Ativos (Barômetro / Nevoeiro / Cisalhamento)
 * 3. Seletor de Modelos (FieldCast Ensemble vs. Nativos / Spaghetti) + Gráficos Horários ECharts
 * 4. Tabela Horária Compacta estilo Windguru (168h)
 * 5. Efemérides Solares e Lunares
 */
export const ForecastTab: React.FC<ForecastTabProps> = ({
  forecast,
  activeLocation,
  isLoading = false,
  isDark = true,
  thresholds,
  onSaveThresholds,
  onOpenLocationsModal,
  onReloadForecast,
  onToast,
  onErrorLog,
}) => {
  const [viewMode, setViewMode] = useState<ForecastViewMode>('fieldcast');
  const [showInterpolatedProfile, setShowInterpolatedProfile] = useState<boolean>(false);
  const [horizonHours, setHorizonHours] = useState<ForecastHorizonHours>(168);
  const [selectedHourIndex, setSelectedHourIndex] = useState<number>(0);
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState<boolean>(false);

  if (isLoading && !forecast) {
    return <ForecastSkeleton />;
  }

  if (!forecast) {
    return (
      <div className="rounded-2xl border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-3">
        <p className="text-base font-bold text-slate-900 dark:text-white">
          Nenhuma previsão carregada para {activeLocation.name}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Verifique sua conexão ou selecione um ponto salvo com cache offline disponível.
        </p>
        {onReloadForecast && (
          <button
            type="button"
            onClick={() => void onReloadForecast()}
            className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-colors"
          >
            Tentar Novamente
          </button>
        )}
      </div>
    );
  }

  const safeHourIndex = Math.min(
    Math.max(0, selectedHourIndex),
    Math.max(0, forecast.hours.length - 1),
  );
  const selectedHour = forecast.hours[safeHourIndex];
  const activeThresholds = thresholds ?? forecast.thresholdsUsed;

  return (
    <ModuleErrorBoundary
      moduleName="Aba Previsão (Windy/Windguru)"
      onReset={onReloadForecast}
      onErrorLog={onErrorLog}
    >
      <div className="space-y-4 sm:space-y-5">
        {/* 1. Resumo Atual + Badge de Confiança + Semáforo de Janela Segura */}
        <CurrentSummaryCard
          forecast={forecast}
          activeLocation={activeLocation}
          selectedHourIndex={safeHourIndex}
          onOpenThresholdModal={() => setIsThresholdModalOpen(true)}
          onOpenLocationsModal={onOpenLocationsModal}
        />

        {/* 2. Alertas Ativos (Barômetro / Nevoeiro / Cisalhamento) */}
        <ActiveAlertsBanner
          alerts={forecast.alerts}
          selectedHour={selectedHour}
          timezone={forecast.timezone}
          showInterpolatedProfile={showInterpolatedProfile}
        />

        {/* 3. Seletor de Modelos + Gráficos Horários Apache ECharts */}
        <ModelSelectorBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showInterpolatedProfile={showInterpolatedProfile}
          onToggleInterpolatedProfile={setShowInterpolatedProfile}
          horizonHours={horizonHours}
          onHorizonHoursChange={setHorizonHours}
          atypicalShearWarning={selectedHour?.verticalProfile.atypicalShearWarning ?? false}
        />

        <ForecastCharts
          forecast={forecast}
          viewMode={viewMode}
          showInterpolatedProfile={showInterpolatedProfile}
          horizonHours={horizonHours}
          selectedHourIndex={safeHourIndex}
          onSelectHourIndex={setSelectedHourIndex}
          isDark={isDark}
        />

        {/* 4. Tabela Horária Compacta estilo Windguru (168h) */}
        <WindguruTable
          forecast={forecast}
          viewMode={viewMode}
          showInterpolatedProfile={showInterpolatedProfile}
          selectedHourIndex={safeHourIndex}
          onSelectHourIndex={setSelectedHourIndex}
        />

        {/* 5. Efemérides Solares e Lunares */}
        <EphemerisCard
          ephemerisByDay={forecast.ephemerisByDay}
          timezone={forecast.timezone}
        />

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
