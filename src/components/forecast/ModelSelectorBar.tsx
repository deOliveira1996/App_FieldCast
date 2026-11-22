import React from 'react';
import { Activity, Clock, GitCompare, Layers, Sparkles } from 'lucide-react';
import type { ForecastViewMode } from '../../types/weather';
import { HelpPopover } from '../common/HelpPopover';

export type ForecastHorizonHours = 48 | 72 | 168;

export interface ModelSelectorBarProps {
  viewMode: ForecastViewMode;
  onViewModeChange: (mode: ForecastViewMode) => void;
  showInterpolatedProfile: boolean;
  onToggleInterpolatedProfile: (enabled: boolean) => void;
  horizonHours: ForecastHorizonHours;
  onHorizonHoursChange: (hours: ForecastHorizonHours) => void;
  atypicalShearWarning?: boolean;
  showVerticalProfileControl?: boolean;
}

const VIEW_MODES: Array<{
  id: ForecastViewMode;
  label: string;
  sublabel: string;
}> = [
  {
    id: 'fieldcast',
    label: 'Consenso FieldCast',
    sublabel: 'Média dos 3 Modelos',
  },
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF (Europeu)',
    sublabel: 'Alta Precisão 0.25°',
  },
  {
    id: 'gfs_seamless',
    label: 'NOAA GFS',
    sublabel: 'Global Americano',
  },
  {
    id: 'icon_seamless',
    label: 'DWD ICON',
    sublabel: 'Global Alemão',
  },
  {
    id: 'spaghetti',
    label: 'Comparar Modelos',
    sublabel: 'Curvas Sobrepostas',
  },
];

const HORIZONS: Array<{ hours: ForecastHorizonHours; label: string }> = [
  { hours: 48, label: '2 Dias (48h)' },
  { hours: 72, label: '3 Dias (72h)' },
  { hours: 168, label: '7 Dias (168h)' },
];

export const ModelSelectorBar: React.FC<ModelSelectorBarProps> = ({
  viewMode,
  onViewModeChange,
  showInterpolatedProfile,
  onToggleInterpolatedProfile,
  horizonHours,
  onHorizonHoursChange,
  atypicalShearWarning = false,
  showVerticalProfileControl = true,
}) => {
  return (
    <div
      role="region"
      aria-label="Seleção de Modelo Meteorológico e Período"
      className="rounded-2xl border border-sky-200/80 dark:border-sky-800/70 bg-white/95 dark:bg-[#132a47]/95 p-3.5 sm:p-4 shadow-sm shadow-sky-900/5 space-y-3"
    >
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        {/* Model View Selector Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1 xl:pb-0">
          {VIEW_MODES.map((m) => {
            const isActive = viewMode === m.id;
            const isEnsemble = m.id === 'fieldcast';
            const isSpaghetti = m.id === 'spaghetti';

            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onViewModeChange(m.id)}
                aria-pressed={isActive}
                className={`min-h-[42px] min-w-[44px] px-3.5 py-2 rounded-xl text-left flex items-center gap-2 shrink-0 border transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  isActive
                    ? 'bg-sky-600 text-white border-sky-500 shadow-sm shadow-sky-500/20'
                    : 'bg-sky-50/75 dark:bg-[#0d1f36]/80 text-slate-700 dark:text-sky-200 border-sky-200/80 dark:border-sky-800 hover:bg-sky-100/80 dark:hover:bg-sky-900/50'
                }`}
              >
                {isEnsemble ? (
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : isSpaghetti ? (
                  <GitCompare className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <div>
                  <span className="block text-xs font-bold leading-tight">{m.label}</span>
                  <span
                    className={`block text-[10px] leading-tight ${
                      isActive ? 'text-sky-100' : 'text-slate-500 dark:text-sky-300/75'
                    }`}
                  >
                    {m.sublabel}
                  </span>
                </div>
              </button>
            );
          })}
          <HelpPopover topic="ensemble_vs_native" />
        </div>

        {/* Right Controls: Vertical Interpolation Toggle + Horizon Selector */}
        <div className="flex flex-wrap items-center justify-between xl:justify-end gap-2.5">
          {showVerticalProfileControl && (
            <div className="inline-flex items-center gap-1 rounded-xl border border-sky-200/80 dark:border-sky-800 bg-sky-50/60 dark:bg-[#0d1f36]/80 p-1">
              <button
                type="button"
                onClick={() => onToggleInterpolatedProfile(!showInterpolatedProfile)}
                aria-pressed={showInterpolatedProfile}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  showInterpolatedProfile
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-sky-200 hover:bg-sky-100/80 dark:hover:bg-sky-900/50'
                }`}
              >
                <Activity className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Curva 10–120m</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    showInterpolatedProfile
                      ? 'bg-white/20 text-white'
                      : 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200'
                  }`}
                >
                  Estimado
                </span>
              </button>
              <HelpPopover topic="vertical_profile" />
            </div>
          )}

          {/* Time Horizon Filter (48h / 72h / 168h) */}
          <div
            role="group"
            aria-label="Horizonte temporal de exibição"
            className="inline-flex items-center gap-1 rounded-xl border border-sky-200/80 dark:border-sky-800 bg-sky-50/60 dark:bg-[#0d1f36]/80 p-1"
          >
            <Clock className="w-4 h-4 text-sky-500 ml-2 hidden sm:inline" aria-hidden="true" />
            {HORIZONS.map((h) => {
              const active = horizonHours === h.hours;
              return (
                <button
                  key={h.hours}
                  type="button"
                  onClick={() => onHorizonHoursChange(h.hours)}
                  aria-pressed={active}
                  className={`min-h-[38px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    active
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-sky-200 hover:bg-sky-100/80 dark:hover:bg-sky-900/50'
                  }`}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Notice when Vertical Interpolation is enabled */}
      {showVerticalProfileControl && showInterpolatedProfile && (
        <div
          className={`rounded-xl px-3.5 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border ${
            atypicalShearWarning
              ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-200 font-semibold'
              : 'border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-800 dark:bg-[#0d1f36] dark:text-sky-200'
          }`}
        >
          <span>
            <strong>Perfil Estimado Ativo:</strong> Os níveis intermediários entre 10m e 120m são calculados por interpolação vertical. As rajadas são exibidas a <strong>10m</strong>.
          </span>
          {atypicalShearWarning && (
            <span className="px-2 py-0.5 rounded-lg bg-rose-600 text-white text-[11px] font-bold">
              Gradiente Atípico — Priorize Níveis Nativos
            </span>
          )}
        </div>
      )}
    </div>
  );
};
