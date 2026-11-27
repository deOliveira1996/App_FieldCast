import React from 'react';
import { Route } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import type { RoutePlanningTabProps } from '../../types/v4';

/**
 * Placeholder tipado da aba de Planejamento de Rotas 4D (Stage 1).
 * Será substituído pela implementação completa no Stage 2 (`v43-route-4d`).
 */
export const RoutePlanningTab: React.FC<RoutePlanningTabProps> = ({ activeLocation }) => {
  const { tr } = useLocale();

  return (
    <section
      data-testid="route-planning-tab"
      className="rounded-2xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#132a47] p-5 shadow-sm space-y-2"
    >
      <div className="flex items-center gap-2 text-[#0080cd] dark:text-sky-300">
        <Route className="w-5 h-5 shrink-0" aria-hidden="true" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          {tr('Planejamento de Rotas 4D', '4D Route Planning')}
        </h2>
      </div>
      <p className="text-xs text-slate-600 dark:text-sky-200/80">
        {tr(
          `Módulo 4D pronto para integração em ${activeLocation.name} (${activeLocation.latitude.toFixed(4)}°, ${activeLocation.longitude.toFixed(4)}°).`,
          `4D route module ready for integration at ${activeLocation.name} (${activeLocation.latitude.toFixed(4)}°, ${activeLocation.longitude.toFixed(4)}°).`,
        )}
      </p>
    </section>
  );
};
