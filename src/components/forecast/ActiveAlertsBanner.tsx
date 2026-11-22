import React from 'react';
import { Eye, Gauge, ShieldCheck, Wind } from 'lucide-react';
import type { EnsembleHour, OperationalAlert } from '../../types/weather';

export interface ActiveAlertsBannerProps {
  alerts: OperationalAlert[];
  selectedHour?: EnsembleHour;
  timezone?: string;
  showInterpolatedProfile?: boolean;
}

/**
 * Cards de Índices e Condições do Dia (Estilo Climatempo Clean):
 * Cards 100% brancos com apenas uma bolinha colorida no canto superior direito
 * (Verde / Amarela / Vermelha), título em negrito e texto curto e natural logo abaixo.
 */
export const ActiveAlertsBanner: React.FC<ActiveAlertsBannerProps> = ({
  alerts,
  selectedHour,
}) => {
  const pressureDropAlert = alerts.find((a) => a.type === 'pressure_drop');
  const fogAlert = alerts.find((a) => a.type === 'fog_risk');
  const shearAlert =
    alerts.find((a) => a.type === 'atypical_shear') ||
    (selectedHour?.verticalProfile.atypicalShearWarning ? true : false);

  const safeWindowStatus = selectedHour?.safeWindow ?? 'green';

  const cards = [
    {
      id: 'safe_window',
      title: 'Condição para Campo',
      Icon: ShieldCheck,
      dotColor:
        safeWindowStatus === 'green'
          ? 'bg-emerald-500'
          : safeWindowStatus === 'amber'
            ? 'bg-amber-400'
            : 'bg-rose-500',
      description:
        safeWindowStatus === 'green'
          ? 'Vento, rajadas, ondas e chuva dentro dos limites confortáveis configurados.'
          : safeWindowStatus === 'amber'
            ? selectedHour?.safeWindowReasons.join(' • ') ||
              'Parâmetros próximos do limite configurado. Recomenda-se atenção.'
            : selectedHour?.safeWindowReasons.join(' • ') ||
              'Condição acima dos limites operacionais configurados.',
    },
    {
      id: 'pressure_stability',
      title: 'Tendência Barométrica',
      Icon: Gauge,
      dotColor: pressureDropAlert ? 'bg-rose-500' : 'bg-emerald-500',
      description: pressureDropAlert
        ? pressureDropAlert.description
        : 'Pressão atmosférica estável, sem queda brusca indicativa de frente ou tempestade.',
    },
    {
      id: 'visibility_fog',
      title: 'Visibilidade & Neblina',
      Icon: Eye,
      dotColor: fogAlert ? 'bg-amber-400' : 'bg-emerald-500',
      description: fogAlert
        ? fogAlert.description
        : 'Boa visibilidade horizontal, sem formação de nevoeiro denso prevista.',
    },
    {
      id: 'wind_profile',
      title: 'Circulação de Vento',
      Icon: Wind,
      dotColor: shearAlert ? 'bg-amber-400' : 'bg-emerald-500',
      description: shearAlert
        ? 'Gradiente de vento acentuado entre a superfície e 120m de altura.'
        : 'Escoamento de vento regular entre os níveis de superfície e altitude.',
    },
  ];

  return (
    <section aria-label="Índices e Condições Operacionais do Dia">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {cards.map((card) => {
          const { Icon } = card;
          return (
            <div
              key={card.id}
              className="relative rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 shadow-sm flex flex-col justify-between gap-2"
            >
              {/* Colored Status Dot in Top-Right Corner (Climatempo style) */}
              <span
                className={`absolute top-4 right-4 w-3 h-3 rounded-full ${card.dotColor}`}
                aria-hidden="true"
              />

              <div className="flex items-center gap-2 pr-5">
                <Icon className="w-4 h-4 text-[#0080cd] dark:text-sky-400 shrink-0" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                  {card.title}
                </h3>
              </div>

              <p className="text-xs text-slate-600 dark:text-sky-200/80 leading-relaxed">
                {card.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};
