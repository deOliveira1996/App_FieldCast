import React, { useState } from 'react';
import { GitCompare, Layers, Sparkles } from 'lucide-react';
import type { ForecastViewMode } from '../../types/weather';

export interface ModelModeSwitchPillProps {
  viewMode?: ForecastViewMode;
  onViewModeChange?: (mode: ForecastViewMode) => void;
  value?: ForecastViewMode;
  onChange?: (mode: ForecastViewMode) => void;
  allowSpaghetti?: boolean;
  compact?: boolean;
  label?: string;
  className?: string;
  testId?: string;
}

interface ModelSwitchOption {
  id: ForecastViewMode;
  label: string;
  description: string;
}

const BASE_MODEL_OPTIONS: ReadonlyArray<ModelSwitchOption> = [
  {
    id: 'fieldcast',
    label: 'FieldCast Ensemble',
    description: 'Consenso ponderado multi-modelo (padrão)',
  },
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF',
    description: 'Modelo Europeu IFS 0.25° (~9 km)',
  },
  {
    id: 'gfs_seamless',
    label: 'GFS',
    description: 'Modelo Global NOAA GFS',
  },
  {
    id: 'icon_seamless',
    label: 'ICON',
    description: 'Modelo Global DWD ICON',
  },
  {
    id: 'gem_seamless',
    label: 'GEM',
    description: 'Modelo Global CMC GEM',
  },
];

const SPAGHETTI_OPTION: ModelSwitchOption = {
  id: 'spaghetti',
  label: 'Comparar',
  description: 'Curvas sobrepostas de todos os modelos',
};

export const ModelModeSwitchPill: React.FC<ModelModeSwitchPillProps> = ({
  viewMode,
  onViewModeChange,
  value,
  onChange,
  allowSpaghetti = false,
  compact = false,
  label,
  className = '',
  testId = 'global-model-selector',
}) => {
  const [internalMode, setInternalMode] = useState<ForecastViewMode>('fieldcast');
  const activeMode: ForecastViewMode = viewMode ?? value ?? internalMode;

  const options = allowSpaghetti
    ? [...BASE_MODEL_OPTIONS, SPAGHETTI_OPTION]
    : BASE_MODEL_OPTIONS;

  const handleSelect = (nextMode: ForecastViewMode) => {
    if (viewMode === undefined && value === undefined) {
      setInternalMode(nextMode);
    }
    onViewModeChange?.(nextMode);
    onChange?.(nextMode);
  };

  return (
    <div
      role="group"
      aria-label={label ?? 'Seletor de Modelo Meteorológico'}
      data-testid={testId}
      className={`flex flex-wrap items-center gap-1.5 min-w-0 ${
        compact
          ? ''
          : 'rounded-2xl border border-sky-200/80 dark:border-sky-800/70 bg-white/95 dark:bg-[#132a47]/95 p-2 shadow-sm'
      } ${className}`.trim()}
    >
      {label && (
        <span className="text-xs font-bold text-slate-600 dark:text-sky-200 px-1.5 shrink-0">
          {label}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {options.map((opt) => {
          const isActive = activeMode === opt.id;
          const isEnsemble = opt.id === 'fieldcast';
          const isSpaghetti = opt.id === 'spaghetti';

          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`model-pill-${opt.id}`}
              onClick={() => handleSelect(opt.id)}
              aria-pressed={isActive}
              title={opt.description}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                isActive
                  ? 'bg-[#0080cd] dark:bg-sky-600 text-white border-[#0070b8] dark:border-sky-500 shadow-sm'
                  : 'bg-sky-50/80 dark:bg-[#0d1f36]/80 text-slate-700 dark:text-sky-200 border-sky-200/80 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/50'
              }`}
            >
              {isEnsemble ? (
                <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : isSpaghetti ? (
                <GitCompare className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
