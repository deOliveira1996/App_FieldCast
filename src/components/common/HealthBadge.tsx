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
    label: 'Sistema Operacional',
    shortLabel: 'Online',
    dotColor: 'bg-emerald-500',
    badgeStyle:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/20',
  },
  degraded: {
    label: 'Modo Degradado / Cache',
    shortLabel: 'Degradado',
    dotColor: 'bg-amber-500',
    badgeStyle:
      'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-300 hover:bg-amber-500/20',
  },
  down: {
    label: 'Offline / Falha de Serviços',
    shortLabel: 'Offline',
    dotColor: 'bg-red-500',
    badgeStyle:
      'border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-300 hover:bg-red-500/20',
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
      title={`Health Check: ${cfg.label}`}
      className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border text-xs font-bold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${cfg.badgeStyle} ${className}`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.dotColor}`}
        />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dotColor}`} />
      </span>
      <Activity className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{cfg.label}</span>
      <span className="sm:hidden">{cfg.shortLabel}</span>
      {errorCount > 0 && (
        <span
          aria-label={`${errorCount} erros registrados`}
          className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-red-600 text-white"
        >
          {errorCount}
        </span>
      )}
    </button>
  );
};
