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
}

const VIEW_MODES: Array<{
  id: ForecastViewMode;
  label: string;
  sublabel: string;
}> = [
  {
    id: 'fieldcast',
    label: 'Modelo FieldCast (Ensemble)',
    sublabel: 'Média + Min/Máx + Vetorial R',
  },
  {
    id: 'ecmwf_ifs025',
    label: 'ECMWF IFS 0.25°',
    sublabel: 'Nativo (10m, 100m)',
  },
  {
    id: 'gfs_seamless',
    label: 'NOAA GFS',
    sublabel: 'Nativo (10m, 80m, 120m)',
  },
  {
    id: 'icon_seamless',
    label: 'DWD ICON',
    sublabel: 'Nativo (10m, 80m, 120m)',
  },
  {
    id: 'spaghetti',
    label: 'Spaghetti Plot',
    sublabel: 'Comparativo 3 Modelos',
  },
];

const HORIZONS: Array<{ hours: ForecastHorizonHours; label: string }> = [
  { hours: 48, label: '48h (2 Dias)' },
  { hours: 72, label: '72h (3 Dias)' },
  { hours: 168, label: '168h (7 Dias)' },
];

export const ModelSelectorBar: React.FC<ModelSelectorBarProps> = ({
  viewMode,
  onViewModeChange,
  showInterpolatedProfile,
  onToggleInterpolatedProfile,
  horizonHours,
  onHorizonHoursChange,
  atypicalShearWarning = false,
}) => {
  return (
    <div
      role="region"
      aria-label="Seleção de Modelo Meteorológico e Perfil Vertical"
      className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 shadow-sm space-y-3"
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
                className={`min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-left flex items-center gap-2 shrink-0 border transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  isActive
                    ? isEnsemble
                      ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                      : isSpaghetti
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                        : 'bg-slate-900 dark:bg-sky-600 text-white border-slate-800 dark:border-sky-500 shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
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
                  <span className="block text-xs font-extrabold leading-tight">{m.label}</span>
                  <span
                    className={`block text-[10px] leading-tight ${
                      isActive ? 'text-white/85' : 'text-slate-500 dark:text-slate-400'
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
          {/* Vertical Profile Interpolation Toggle (Lei de Potência α) */}
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/70 p-1">
            <button
              type="button"
              onClick={() => onToggleInterpolatedProfile(!showInterpolatedProfile)}
              aria-pressed={showInterpolatedProfile}
              className={`min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                showInterpolatedProfile
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              <Activity className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Interpolação 10–120m</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                  showInterpolatedProfile
                    ? 'bg-slate-950 text-amber-300'
                    : 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                }`}
              >
                Estimado
              </span>
            </button>
            <HelpPopover topic="vertical_profile" />
          </div>

          {/* Time Horizon Filter (48h / 72h / 168h) */}
          <div
            role="group"
            aria-label="Horizonte temporal de exibição"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/70 p-1"
          >
            <Clock className="w-4 h-4 text-slate-400 ml-2 hidden sm:inline" aria-hidden="true" />
            {HORIZONS.map((h) => {
              const active = horizonHours === h.hours;
              return (
                <button
                  key={h.hours}
                  type="button"
                  onClick={() => onHorizonHoursChange(h.hours)}
                  aria-pressed={active}
                  className={`min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    active
                      ? 'bg-slate-900 dark:bg-sky-600 text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Warning Notice when Vertical Interpolation is enabled */}
      {showInterpolatedProfile && (
        <div
          className={`rounded-xl px-3.5 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border ${
            atypicalShearWarning
              ? 'border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200 font-semibold'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-200'
          }`}
        >
          <span>
            <strong>Selo &ldquo;Estimado&rdquo; Ativo:</strong> Os níveis intermediários de 10 em
            10m até 120m são estimados pela Lei de Potência{' '}
            <code className="font-mono">v(z) = v_ref · (z / z_ref)^α</code>. As rajadas são
            exibidas estritamente a <strong>10m</strong>.
          </span>
          {atypicalShearWarning && (
            <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px] font-extrabold">
              Cisalhamento Atípico — Baixa Confiança na Interpolação
            </span>
          )}
        </div>
      )}
    </div>
  );
};
