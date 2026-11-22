import React, { useEffect, useState } from 'react';
import { CloudRain, RotateCcw, Save, Sliders, Waves, Wind, X } from 'lucide-react';
import type { ToastMessage } from '../../types/health';
import { SafeWindowThresholdsSchema } from '../../types/schemas';
import {
  DEFAULT_SAFE_WINDOW_THRESHOLDS,
  type SafeWindowThresholds,
} from '../../types/weather';
import { safeAction } from '../../utils/safeAction';
import { HelpPopover } from '../common/HelpPopover';

export interface ThresholdSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  thresholds: SafeWindowThresholds;
  onSaveThresholds: (nextThresholds: SafeWindowThresholds) => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const ThresholdSettingsModal: React.FC<ThresholdSettingsModalProps> = ({
  isOpen,
  onClose,
  thresholds,
  onSaveThresholds,
  onToast,
}) => {
  const [maxWindKmh, setMaxWindKmh] = useState<number>(thresholds.maxWindKmh);
  const [maxGustKmh, setMaxGustKmh] = useState<number>(thresholds.maxGustKmh);
  const [maxWaveM, setMaxWaveM] = useState<number>(thresholds.maxWaveM);
  const [maxPrecipProbPct, setMaxPrecipProbPct] = useState<number>(thresholds.maxPrecipProbPct);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMaxWindKmh(thresholds.maxWindKmh);
      setMaxGustKmh(thresholds.maxGustKmh);
      setMaxWaveM(thresholds.maxWaveM);
      setMaxPrecipProbPct(thresholds.maxPrecipProbPct);
      setValidationError(null);
    }
  }, [isOpen, thresholds]);

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
    setMaxWindKmh(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWindKmh);
    setMaxGustKmh(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxGustKmh);
    setMaxWaveM(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWaveM);
    setMaxPrecipProbPct(DEFAULT_SAFE_WINDOW_THRESHOLDS.maxPrecipProbPct);
    setValidationError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const candidate: SafeWindowThresholds = {
      maxWindKmh: Number(maxWindKmh),
      maxGustKmh: Number(maxGustKmh),
      maxWaveM: Number(maxWaveM),
      maxPrecipProbPct: Number(maxPrecipProbPct),
    };

    const parsed = SafeWindowThresholdsSchema.safeParse(candidate);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setValidationError(
        firstIssue?.message ?? 'Verifique os valores inseridos nos limites operacionais.',
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
        successTitle: 'Limites do Semáforo de Janela Segura atualizados',
        errorTitle: 'Erro ao salvar limites operacionais',
        onLoadingChange: setIsSaving,
        onToast,
      },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="threshold-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              <Sliders className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <h2 id="threshold-modal-title" className="text-base sm:text-lg font-bold">
                  Limites do Semáforo de Janela Segura
                </h2>
                <HelpPopover topic="safe_window" align="left" />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Personalize os tetos operacionais que pintam cada hora em Verde, Amarelo ou Vermelho
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configuração de limites"
            className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {validationError && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs font-semibold text-red-700 dark:text-red-300"
            >
              {validationError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Max Wind 10m */}
            <div className="space-y-1.5">
              <label
                htmlFor="threshold-wind"
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                <Wind className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>Vento Máximo 10m (km/h)</span>
              </label>
              <input
                id="threshold-wind"
                type="number"
                min={5}
                max={150}
                step={1}
                required
                value={maxWindKmh}
                onChange={(e) => setMaxWindKmh(Number(e.target.value))}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Padrão: {DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWindKmh} km/h (5 a 150)
              </p>
            </div>

            {/* Max Gust 10m */}
            <div className="space-y-1.5">
              <label
                htmlFor="threshold-gust"
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                <Wind className="w-4 h-4 text-amber-500" aria-hidden="true" />
                <span>Rajada Máxima 10m (km/h)</span>
              </label>
              <input
                id="threshold-gust"
                type="number"
                min={5}
                max={200}
                step={1}
                required
                value={maxGustKmh}
                onChange={(e) => setMaxGustKmh(Number(e.target.value))}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Padrão: {DEFAULT_SAFE_WINDOW_THRESHOLDS.maxGustKmh} km/h (5 a 200)
              </p>
            </div>

            {/* Max Wave Height */}
            <div className="space-y-1.5">
              <label
                htmlFor="threshold-wave"
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                <Waves className="w-4 h-4 text-teal-500" aria-hidden="true" />
                <span>Altura Máx. de Onda (m)</span>
              </label>
              <input
                id="threshold-wave"
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                required
                value={maxWaveM}
                onChange={(e) => setMaxWaveM(Number(e.target.value))}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Padrão: {DEFAULT_SAFE_WINDOW_THRESHOLDS.maxWaveM.toFixed(1)} m (ignorado em
                continente)
              </p>
            </div>

            {/* Max Precip Probability */}
            <div className="space-y-1.5">
              <label
                htmlFor="threshold-precip"
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                <CloudRain className="w-4 h-4 text-indigo-500" aria-hidden="true" />
                <span>Probabilidade Máx. Chuva (%)</span>
              </label>
              <input
                id="threshold-precip"
                type="number"
                min={0}
                max={100}
                step={5}
                required
                value={maxPrecipProbPct}
                onChange={(e) => setMaxPrecipProbPct(Number(e.target.value))}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Padrão: {DEFAULT_SAFE_WINDOW_THRESHOLDS.maxPrecipProbPct}% (0 a 100%)
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleRestoreDefaults}
              className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Restaurar Padrão</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors flex-1 sm:flex-initial"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[44px] min-w-[44px] px-5 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white shadow-sm transition-colors flex-1 sm:flex-initial"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{isSaving ? 'Salvando...' : 'Salvar Limites'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
