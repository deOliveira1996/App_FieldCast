import React from 'react';
import { Activity } from 'lucide-react';
import type { HealthCheckSnapshot, HealthLevel } from '../../types/health';

export interface HealthBadgeProps {
  snapshot: HealthCheckSnapshot;
  onClick: () => void;
  className?: string;
}

const LEVEL_CONFIG: Record<
  HealthLevel,
  {
    label: string;
    shortLabel: string;
    dotColor: string;
    badgeStyle: string;
  }
> = {
  healthy: {
    label: 'Online',
    shortLabel: 'Online',
    dotColor: 'bg-emerald-400',
    badgeStyle:
      'border-white/25 bg-white/15 text-white hover:bg-white/25',
  },
  degraded: {
    label: 'Modo Local',
    shortLabel: 'Local',
    dotColor: 'bg-amber-300',
    badgeStyle:
      'border-white/25 bg-white/15 text-white hover:bg-white/25',
  },
  down: {
    label: 'Offline',
    shortLabel: 'Offline',
    dotColor: 'bg-rose-400',
    badgeStyle:
      'border-rose-300/50 bg-rose-600/30 text-white hover:bg-rose-600/40',
  },
  unverified: {
    label: 'Parcial',
    shortLabel: 'Parcial',
    dotColor: 'bg-sky-300',
    badgeStyle:
      'border-white/25 bg-white/15 text-white hover:bg-white/25',
  },
};

export const HealthBadge: React.FC<HealthBadgeProps> = ({ snapshot, onClick, className = '' }) => {
  const cfg = LEVEL_CONFIG[snapshot.overall] ?? LEVEL_CONFIG.degraded;
  const errorCount = snapshot.recentErrors?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Autodiagnóstico do Sistema: ${cfg.label}. Clique para abrir detalhes.`}
      title={`Status do Sistema: ${cfg.label}`}
      className={`min-h-[40px] min-w-[40px] px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-white/70 ${cfg.badgeStyle} ${className}`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.dotColor}`}
        />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dotColor}`} />
      </span>
      <Activity className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{cfg.label}</span>
      <span className="sm:hidden">{cfg.shortLabel}</span>
      {errorCount > 0 && (
        <span
          aria-label={`${errorCount} erros registrados`}
          className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white"
        >
          {errorCount}
        </span>
      )}
    </button>
  );
};
