import React, { useEffect, useState } from 'react';
import { CloudRain, RotateCcw, Save, Sliders, Waves, Wind, X } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { useUnits } from '../../context/UnitsContext';
import type { ToastMessage } from '../../types/health';
import { SafeWindowThresholdsSchema } from '../../types/schemas';
import {
  DEFAULT_SAFE_WINDOW_THRESHOLDS,
  type SafeWindowThresholdKey,
  type SafeWindowThresholds,
} from '../../types/weather';
import { safeAction } from '../../utils/safeAction';
import {
  convertWaveHeight,
  convertWindSpeed,
  getWaveUnitLabel,
  getWindUnitLabel,
  waveHeightToM,
  windSpeedToKmh,
} from '../../utils/units';
import { HelpPopover } from '../common/HelpPopover';
import { NumericInput } from '../common/NumericInput';

export interface ThresholdSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  thresholds: SafeWindowThresholds;
  onSaveThresholds: (nextThresholds: SafeWindowThresholds) => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
}

function clampVal(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const ThresholdSettingsModal: React.FC<ThresholdSettingsModalProps> = ({
  isOpen,
  onClose,
  thresholds,
  onSaveThresholds,
  onToast,
}) => {
  const { units } = useUnits();
  const { tr } = useLocale();

  const windMinDisplay = Number((Math.ceil((convertWindSpeed(5, units.wind) ?? 5) * 10) / 10).toFixed(1));
  const windMaxDisplay = Number((Math.floor((convertWindSpeed(150, units.wind) ?? 150) * 10) / 10).toFixed(1));
  const gustMinDisplay = Number((Math.ceil((convertWindSpeed(5, units.wind) ?? 5) * 10) / 10).toFixed(1));
  const gustMaxDisplay = Number((Math.floor((convertWindSpeed(200, units.wind) ?? 200) * 10) / 10).toFixed(1));
  const waveMinDisplay = Number((Math.ceil((convertWaveHeight(0.1, units.wave) ?? 0.1) * 10) / 10).toFixed(1));
  const waveMaxDisplay = Number((Math.floor((convertWaveHeight(20, units.wave) ?? 20) * 10) / 10).toFixed(1));

  const [windDisplay, setWindDisplay] = useState<number | null>(() =>
    Number((convertWindSpeed(thresholds.maxWindKmh, units.wind) ?? thresholds.maxWindKmh).toFixed(1)),
  );
  const [gustDisplay, setGustDisplay] = useState<number | null>(() =>
    Number((convertWindSpeed(thresholds.maxGustKmh, units.wind) ?? thresholds.maxGustKmh).toFixed(1)),
  );
  const [waveDisplay, setWaveDisplay] = useState<number | null>(() =>
    Number((convertWaveHeight(thresholds.maxWaveM, units.wave) ?? thresholds.maxWaveM).toFixed(1)),
  );
  const [precipDisplay, setPrecipDisplay] = useState<number | null>(thresholds.maxPrecipProbPct);
  const [enabledMap, setEnabledMap] = useState<Record<SafeWindowThresholdKey, boolean>>({
    maxWindKmh: thresholds.enabled?.maxWindKmh ?? true,
    maxGustKmh: thresholds.enabled?.maxGustKmh ?? true,
    maxWaveM: thresholds.enabled?.maxWaveM ?? true,
    maxPrecipProbPct: thresholds.enabled?.maxPrecipProbPct ?? true,
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setWindDisplay(
        Number((convertWindSpeed(thresholds.maxWindKmh, units.wind) ?? thresholds.maxWindKmh).toFixed(1)),
      );
      setGustDisplay(
        Number((convertWindSpeed(thresholds.maxGustKmh, units.wind) ?? thresholds.maxGustKmh).toFixed(1)),
      );
      setWaveDisplay(
        Number((convertWaveHeight(thresholds.maxWaveM, units.wave) ?? thresholds.maxWaveM).toFixed(1)),
      );
      setPrecipDisplay(thresholds.maxPrecipProbPct);
      setEnabledMap({
        maxWindKmh: thresholds.enabled?.maxWindKmh ?? true,
        maxGustKmh: thresholds.enabled?.maxGustKmh ?? true,
        maxWaveM: thresholds.enabled?.maxWaveM ?? true,
        maxPrecipProbPct: thresholds.enabled?.maxPrecipProbPct ?? true,
      });
      setValidationError(null);
    }
  }, [isOpen, thresholds, units.wind, units.wave]);

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

  const handleRestoreDefaults = () => {
    setWindDisplay(
      Number(
        (
          convertWindSpeed(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWindKmh, units.wind) ??
          DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWindKmh
        ).toFixed(1),
      ),
    );
    setGustDisplay(
      Number(
        (
          convertWindSpeed(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxGustKmh, units.wind) ??
          DEFAULT_SAFE_WINDOW_THRESHOLDS.maxGustKmh
        ).toFixed(1),
      ),
    );
    setWaveDisplay(
      Number(
        (
          convertWaveHeight(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWaveM, units.wave) ??
          DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWaveM
        ).toFixed(1),
      ),
    );
    setPrecipDisplay(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxPrecipProbPct);
    setEnabledMap({
      maxWindKmh: true,
      maxGustKmh: true,
      maxWaveM: true,
      maxPrecipProbPct: true,
    });
    setValidationError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (
      (enabledMap.maxWindKmh && (windDisplay === null || !Number.isFinite(windDisplay))) ||
      (enabledMap.maxGustKmh && (gustDisplay === null || !Number.isFinite(gustDisplay))) ||
      (enabledMap.maxWaveM && (waveDisplay === null || !Number.isFinite(waveDisplay))) ||
      (enabledMap.maxPrecipProbPct && (precipDisplay === null || !Number.isFinite(precipDisplay)))
    ) {
      setValidationError(
        tr(
          'Preencha todos os limites monitorados antes de salvar.',
          'Fill in all monitored thresholds before saving.',
        ),
      );
      return;
    }

    const resolvedWindKmh =
      windDisplay !== null && Number.isFinite(windDisplay)
        ? clampVal(
            Number(windSpeedToKmh(clampVal(windDisplay, windMinDisplay, windMaxDisplay), units.wind).toFixed(2)),
            5,
            150,
          )
        : thresholds.maxWindKmh;
    const resolvedGustKmh =
      gustDisplay !== null && Number.isFinite(gustDisplay)
        ? clampVal(
            Number(windSpeedToKmh(clampVal(gustDisplay, gustMinDisplay, gustMaxDisplay), units.wind).toFixed(2)),
            5,
            200,
          )
        : thresholds.maxGustKmh;
    const resolvedWaveM =
      waveDisplay !== null && Number.isFinite(waveDisplay)
        ? clampVal(
            Number(waveHeightToM(clampVal(waveDisplay, waveMinDisplay, waveMaxDisplay), units.wave).toFixed(2)),
            0.1,
            20,
          )
        : thresholds.maxWaveM;
    const resolvedPrecipPct =
      precipDisplay !== null && Number.isFinite(precipDisplay)
        ? clampVal(Math.round(precipDisplay), 0, 100)
        : thresholds.maxPrecipProbPct;

    const candidate: SafeWindowThresholds = {
      maxWindKmh: resolvedWindKmh,
      maxGustKmh: resolvedGustKmh,
      maxWaveM: resolvedWaveM,
      maxPrecipProbPct: resolvedPrecipPct,
      enabled: { ...enabledMap },
    };

    const parsed = SafeWindowThresholdsSchema.safeParse(candidate);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setValidationError(
        firstIssue?.message ??
          tr(
            'Verifique os valores inseridos nos limites operacionais.',
            'Check the operational threshold values entered.',
          ),
      );
      return;
    }

    void safeAction(
      async () => {
        await onSaveThresholds(parsed.data);
        onClose();
      },
      {
        actionKey: 'save_safe_window_thresholds',
        moduleName: 'ThresholdSettingsModal',
        successTitle: tr(
          'Limites de operação atualizados',
          'Operational thresholds updated',
        ),
        errorTitle: tr(
          'Erro ao salvar limites operacionais',
          'Failed to save operational thresholds',
        ),
        onLoadingChange: setIsSaving,
        onToast,
      },
    );
  };

  const windUnit = getWindUnitLabel(units.wind);
  const waveUnit = getWaveUnitLabel(units.wave);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="threshold-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-sky-950/45 dark:bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border border-sky-200 dark:border-sky-800/80 bg-white dark:bg-[#132a47] text-slate-800 dark:text-sky-50 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-sky-100 dark:border-sky-800/70 bg-gradient-to-r from-sky-50 via-blue-50/40 to-white dark:from-[#0f243d] dark:to-[#132a47]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#0080cd] text-white shadow-sm">
              <Sliders className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <h2 id="threshold-modal-title" className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  {tr('Limites da Janela Segura', 'Safe Window Thresholds')}
                </h2>
                <HelpPopover topic="safe_window" align="left" />
              </div>
              <p className="text-xs text-slate-600 dark:text-sky-200/80">
                {tr(
                  'Defina os valores máximos ideais para sua atividade no mar ou em campo',
                  'Set ideal maximum limits for your marine or field operation',
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Fechar configuração de limites', 'Close threshold settings')}
            className="min-h-[44px] min-w-[44px] rounded-2xl inline-flex items-center justify-center text-slate-500 dark:text-sky-200 hover:bg-sky-100/80 dark:hover:bg-sky-900/50 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {validationError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
            >
              {validationError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Max Wind 10m */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="threshold-wind"
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-sky-200"
                >
                  <Wind className="w-4 h-4 text-[#0080cd]" aria-hidden="true" />
                  <span>{tr(`Vento Máx 10m (${windUnit})`, `Max Wind 10m (${windUnit})`)}</span>
                </label>
                <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-sky-300 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="threshold-enable-wind"
                    checked={enabledMap.maxWindKmh}
                    onChange={(e) =>
                      setEnabledMap((prev) => ({ ...prev, maxWindKmh: e.target.checked }))
                    }
                    className="h-4 w-4 accent-sky-600 rounded"
                  />
                  <span>{tr('Monitorar', 'Monitor')}</span>
                </label>
              </div>
              <NumericInput
                id="threshold-wind"
                min={windMinDisplay}
                max={windMaxDisplay}
                decimals={1}
                allowEmpty={true}
                disabled={!enabledMap.maxWindKmh}
                value={windDisplay}
                onValueChange={(_raw, parsed) => setWindDisplay(parsed)}
                onCommit={(committed) => setWindDisplay(committed)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-[#f4f8fb] dark:bg-[#0d1f36] text-sm font-bold disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-sky-200/75">
                {enabledMap.maxWindKmh
                  ? `${tr('Padrão:', 'Default:')} ${(convertWindSpeed(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWindKmh, units.wind) ?? DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWindKmh).toFixed(1)} ${windUnit}`
                  : tr('Opcional — desativado no semáforo', 'Optional — disabled in semaphore')}
              </p>
            </div>

            {/* Max Gust 10m */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="threshold-gust"
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-sky-200"
                >
                  <Wind className="w-4 h-4 text-orange-500" aria-hidden="true" />
                  <span>{tr(`Rajada Máx 10m (${windUnit})`, `Max Gust 10m (${windUnit})`)}</span>
                </label>
                <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-sky-300 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="threshold-enable-gust"
                    checked={enabledMap.maxGustKmh}
                    onChange={(e) =>
                      setEnabledMap((prev) => ({ ...prev, maxGustKmh: e.target.checked }))
                    }
                    className="h-4 w-4 accent-sky-600 rounded"
                  />
                  <span>{tr('Monitorar', 'Monitor')}</span>
                </label>
              </div>
              <NumericInput
                id="threshold-gust"
                min={gustMinDisplay}
                max={gustMaxDisplay}
                decimals={1}
                allowEmpty={true}
                disabled={!enabledMap.maxGustKmh}
                value={gustDisplay}
                onValueChange={(_raw, parsed) => setGustDisplay(parsed)}
                onCommit={(committed) => setGustDisplay(committed)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-[#f4f8fb] dark:bg-[#0d1f36] text-sm font-bold disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-sky-200/75">
                {enabledMap.maxGustKmh
                  ? `${tr('Padrão:', 'Default:')} ${(convertWindSpeed(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxGustKmh, units.wind) ?? DEFAULT_SAFE_WINDOW_THRESHOLDS.maxGustKmh).toFixed(1)} ${windUnit}`
                  : tr('Opcional — desativado no semáforo', 'Optional — disabled in semaphore')}
              </p>
            </div>

            {/* Max Wave Height */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="threshold-wave"
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-sky-200"
                >
                  <Waves className="w-4 h-4 text-[#0080cd]" aria-hidden="true" />
                  <span>{tr(`Altura Máx. Onda (${waveUnit})`, `Max Wave Height (${waveUnit})`)}</span>
                </label>
                <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-sky-300 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="threshold-enable-wave"
                    checked={enabledMap.maxWaveM}
                    onChange={(e) =>
                      setEnabledMap((prev) => ({ ...prev, maxWaveM: e.target.checked }))
                    }
                    className="h-4 w-4 accent-sky-600 rounded"
                  />
                  <span>{tr('Monitorar', 'Monitor')}</span>
                </label>
              </div>
              <NumericInput
                id="threshold-wave"
                min={waveMinDisplay}
                max={waveMaxDisplay}
                decimals={1}
                allowEmpty={true}
                disabled={!enabledMap.maxWaveM}
                value={waveDisplay}
                onValueChange={(_raw, parsed) => setWaveDisplay(parsed)}
                onCommit={(committed) => setWaveDisplay(committed)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-[#f4f8fb] dark:bg-[#0d1f36] text-sm font-bold disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-sky-200/75">
                {enabledMap.maxWaveM
                  ? `${tr('Padrão:', 'Default:')} ${(convertWaveHeight(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWaveM, units.wave) ?? DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWaveM).toFixed(1)} ${waveUnit}`
                  : tr('Opcional — desativado no semáforo', 'Optional — disabled in semaphore')}
              </p>
            </div>

            {/* Max Precip Probability */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="threshold-precip"
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-sky-200"
                >
                  <CloudRain className="w-4 h-4 text-[#0080cd]" aria-hidden="true" />
                  <span>{tr('Chance Máx. Chuva (%)', 'Max Rain Prob. (%)')}</span>
                </label>
                <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-sky-300 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="threshold-enable-precip"
                    checked={enabledMap.maxPrecipProbPct}
                    onChange={(e) =>
                      setEnabledMap((prev) => ({ ...prev, maxPrecipProbPct: e.target.checked }))
                    }
                    className="h-4 w-4 accent-sky-600 rounded"
                  />
                  <span>{tr('Monitorar', 'Monitor')}</span>
                </label>
              </div>
              <NumericInput
                id="threshold-precip"
                min={0}
                max={100}
                decimals={0}
                allowEmpty={true}
                disabled={!enabledMap.maxPrecipProbPct}
                value={precipDisplay}
                onValueChange={(_raw, parsed) => setPrecipDisplay(parsed)}
                onCommit={(committed) => setPrecipDisplay(committed)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-sky-200 dark:border-sky-700 bg-[#f4f8fb] dark:bg-[#0d1f36] text-sm font-bold disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-sky-200/75">
                {enabledMap.maxPrecipProbPct
                  ? `${tr('Padrão:', 'Default:')} ${DEFAULT_SAFE_WINDOW_THRESHOLDS.maxPrecipProbPct}%`
                  : tr('Opcional — desativado no semáforo', 'Optional — disabled in semaphore')}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-sky-100 dark:border-sky-800/70">
            <button
              type="button"
              onClick={handleRestoreDefaults}
              className="min-h-[42px] min-w-[44px] px-4 py-2 rounded-full text-xs font-semibold inline-flex items-center justify-center gap-2 bg-[#f4f8fb] dark:bg-[#0d1f36] hover:bg-sky-50 text-slate-700 dark:text-sky-200 border border-sky-200 dark:border-sky-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>{tr('Restaurar Padrão', 'Reset Defaults')}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] min-w-[44px] px-4 py-2 rounded-full text-xs font-semibold bg-slate-100 dark:bg-sky-900/50 hover:bg-slate-200 text-slate-700 dark:text-sky-100 transition-colors flex-1 sm:flex-initial"
              >
                {tr('Cancelar', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[42px] min-w-[44px] px-5 py-2 rounded-full text-xs font-bold inline-flex items-center justify-center gap-2 bg-[#0080cd] hover:bg-[#006bb3] disabled:opacity-60 text-white shadow-sm transition-colors flex-1 sm:flex-initial"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isSaving
                    ? tr('Salvando...', 'Saving...')
                    : tr('Salvar Limites', 'Save Limits')}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
