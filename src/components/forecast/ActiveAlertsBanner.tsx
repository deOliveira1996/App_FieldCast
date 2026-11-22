import React from 'react';
import { AlertTriangle, CheckCircle2, EyeOff, Gauge, Wind } from 'lucide-react';
import type {
  EnsembleHour,
  OperationalAlert,
  OperationalAlertSeverity,
  OperationalAlertType,
} from '../../types/weather';
import { HelpPopover, type HelpTopicId } from '../common/HelpPopover';

export interface ActiveAlertsBannerProps {
  alerts: OperationalAlert[];
  selectedHour?: EnsembleHour;
  timezone?: string;
  showInterpolatedProfile?: boolean;
}

const SEVERITY_STYLES: Record<
  OperationalAlertSeverity,
  {
    card: string;
    badge: string;
  }
> = {
  critical: {
    card: 'border-red-500/50 bg-red-500/10 text-red-950 dark:text-red-100',
    badge: 'bg-red-600 text-white',
  },
  warning: {
    card: 'border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100',
    badge: 'bg-amber-500 text-slate-950',
  },
  info: {
    card: 'border-sky-500/40 bg-sky-500/10 text-sky-950 dark:text-sky-100',
    badge: 'bg-sky-600 text-white',
  },
};

const ALERT_TYPE_META: Record<
  OperationalAlertType,
  {
    Icon: React.ComponentType<{ className?: string }>;
    helpTopic: HelpTopicId;
    tag: string;
  }
> = {
  pressure_drop: {
    Icon: Gauge,
    helpTopic: 'barometric_trend',
    tag: 'Tendência Barométrica (ΔP/3h)',
  },
  fog_risk: {
    Icon: EyeOff,
    helpTopic: 'fog_risk',
    tag: 'Nevoeiro & Visibilidade',
  },
  atypical_shear: {
    Icon: Wind,
    helpTopic: 'vertical_profile',
    tag: 'Cisalhamento Vertical (α)',
  },
  safe_window_red: {
    Icon: AlertTriangle,
    helpTopic: 'safe_window',
    tag: 'Janela Segura Violada',
  },
};

function formatAlertHour(isoString: string, timezone?: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) {
      return isoString;
    }
    return d.toLocaleString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return isoString;
  }
}

export const ActiveAlertsBanner: React.FC<ActiveAlertsBannerProps> = ({
  alerts,
  selectedHour,
  timezone,
  showInterpolatedProfile = false,
}) => {
  // Combine forecast-wide alerts with any instant shear warning on the selected hour
  const displayedAlerts: OperationalAlert[] = [...alerts];

  if (
    selectedHour &&
    selectedHour.verticalProfile.atypicalShearWarning &&
    !displayedAlerts.some((a) => a.type === 'atypical_shear')
  ) {
    displayedAlerts.unshift({
      id: `shear_selected_${selectedHour.timestampUnix}`,
      type: 'atypical_shear',
      severity: showInterpolatedProfile ? 'warning' : 'info',
      title: 'Cisalhamento Atípico — Baixa Confiança na Interpolação',
      description:
        selectedHour.verticalProfile.shearWarningMessage ??
        `Expoente α (${
          selectedHour.verticalProfile.alpha?.toFixed(3) ?? 'N/A'
        }) fora da faixa normal [0.05, 0.40]. Priorize os níveis nativos 10m, 80m, 100m e 120m.`,
      timestampUnix: selectedHour.timestampUnix,
      timestampIso: selectedHour.timestampIso,
      value: selectedHour.verticalProfile.alpha,
      unit: 'α',
    });
  }

  if (displayedAlerts.length === 0) {
    return (
      <section
        aria-label="Status de Alertas Meteorológicos"
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-emerald-950 dark:text-emerald-200"
      >
        <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold">
          <CheckCircle2
            className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0"
            aria-hidden="true"
          />
          <span>
            Nenhum alerta crítico de Queda Barométrica (&gt; 4 hPa/3h), Nevoeiro (&lt; 1000m) ou
            Cisalhamento Atípico ativo.
          </span>
        </div>
        <div className="flex items-center gap-1">
          <HelpPopover topic="barometric_trend" />
          <HelpPopover topic="fog_risk" />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Alertas Operacionais Ativos" className="space-y-2.5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {displayedAlerts.slice(0, 6).map((alert) => {
          const sev = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.warning;
          const meta = ALERT_TYPE_META[alert.type] ?? ALERT_TYPE_META.safe_window_red;
          const { Icon } = meta;

          return (
            <div
              key={alert.id}
              role="alert"
              className={`rounded-2xl border p-3.5 flex items-start justify-between gap-3 shadow-sm ${sev.card}`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-black/5 dark:bg-white/10 shrink-0 mt-0.5">
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider ${sev.badge}`}
                    >
                      {meta.tag}
                    </span>
                    <span className="text-[11px] font-mono opacity-80">
                      {formatAlertHour(alert.timestampIso, timezone)}
                    </span>
                  </div>
                  <h3 className="text-sm font-extrabold leading-snug">{alert.title}</h3>
                  <p className="text-xs opacity-90 leading-relaxed">{alert.description}</p>
                </div>
              </div>

              <HelpPopover topic={meta.helpTopic} className="shrink-0" />
            </div>
          );
        })}
      </div>
    </section>
  );
};
