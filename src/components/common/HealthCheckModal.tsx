import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Globe,
  Navigation,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  GpsHealthStatus,
  HealthCheckSnapshot,
  HealthLevel,
  PlatformKind,
  ServiceEndpointStatus,
  ToastMessage,
} from '../../types/health';
import { safeAction } from '../../utils/safeAction';

export interface HealthCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: HealthCheckSnapshot;
  onRunHealthCheck?: () => void | Promise<void>;
  onClearErrorLogs?: () => void | Promise<void>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
}

const HEALTH_BADGE_MAP: Record<
  HealthLevel,
  {
    label: string;
    bgClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  healthy: {
    label: 'Operacional',
    bgClass:
      'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30',
    Icon: CheckCircle2,
  },
  degraded: {
    label: 'Degradado',
    bgClass: 'bg-amber-500/15 text-amber-900 dark:text-amber-300 border border-amber-500/30',
    Icon: AlertTriangle,
  },
  down: {
    label: 'Indisponível',
    bgClass: 'bg-red-500/15 text-red-900 dark:text-red-300 border border-red-500/30',
    Icon: XCircle,
  },
  unverified: {
    label: 'Sob Demanda / Não Verificado',
    bgClass: 'bg-sky-500/15 text-sky-900 dark:text-sky-200 border border-sky-500/30',
    Icon: Clock,
  },
};

const PLATFORM_LABELS: Record<PlatformKind, string> = {
  web: 'Web / PWA (Navegador)',
  android: 'Android Nativo (Capacitor)',
  ios: 'iOS (Web / PWA)',
};

const GPS_LABELS: Record<GpsHealthStatus, { label: string; tone: string }> = {
  granted: {
    label: 'GPS Ativo (Permissão Concedida)',
    tone: 'text-emerald-700 dark:text-emerald-400',
  },
  fallback_ip: {
    label: 'Aproximado via IP (ipwho.is)',
    tone: 'text-amber-700 dark:text-amber-400',
  },
  offline_cache: {
    label: 'Coordenada em Cache Offline (IndexedDB)',
    tone: 'text-sky-700 dark:text-sky-400',
  },
  denied: {
    label: 'Permissão de GPS Negada',
    tone: 'text-red-700 dark:text-red-400',
  },
  unavailable: {
    label: 'Sensor GPS Indisponível',
    tone: 'text-slate-600 dark:text-slate-400',
  },
};

function formatUtcTimestamp(iso: string | null | undefined): string {
  if (!iso) {
    return 'Nunca verificado';
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const HealthCheckModal: React.FC<HealthCheckModalProps> = ({
  isOpen,
  onClose,
  snapshot,
  onRunHealthCheck,
  onClearErrorLogs,
  onToast,
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [isClearingLogs, setIsClearingLogs] = useState(false);

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

  const overallCfg = HEALTH_BADGE_MAP[snapshot.overall] ?? HEALTH_BADGE_MAP.degraded;
  const OverallIcon = overallCfg.Icon;
  const gpsInfo = GPS_LABELS[snapshot.gpsStatus] ?? GPS_LABELS.unavailable;
  const endpointsList: ServiceEndpointStatus[] = Object.values(snapshot.endpoints ?? {});

  const handleRunCheck = () => {
    if (!onRunHealthCheck) {
      return;
    }
    void safeAction(async () => onRunHealthCheck(), {
      actionKey: 'health_modal_run_check',
      moduleName: 'HealthCheckModal',
      successTitle: 'Autodiagnóstico atualizado',
      errorTitle: 'Falha ao executar autodiagnóstico',
      onLoadingChange: setIsChecking,
      onToast,
    });
  };

  const handleClearLogs = () => {
    if (!onClearErrorLogs) {
      return;
    }
    void safeAction(async () => onClearErrorLogs(), {
      actionKey: 'health_modal_clear_logs',
      moduleName: 'HealthCheckModal',
      successTitle: 'Log de erros limpo com sucesso',
      errorTitle: 'Não foi possível limpar o log de erros',
      onLoadingChange: setIsClearingLogs,
      onToast,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="health-check-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-sky-950/45 dark:bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#132a47] text-slate-800 dark:text-sky-50 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-sky-100 dark:border-sky-800 bg-gradient-to-r from-sky-50 via-blue-50/40 to-white dark:from-[#0f243d] dark:to-[#132a47]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#0080cd] text-white shadow-sm">
              <Activity className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="health-check-modal-title" className="text-lg md:text-xl font-bold">
                  Painel de Autodiagnóstico (Health Check)
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${overallCfg.bgClass}`}
                >
                  <OverallIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  {overallCfg.label}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Última checagem: {formatUtcTimestamp(snapshot.checkedAtIso)} • Monitoramento de
                Circuit Breaker, Sensores e Cache Offline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRunHealthCheck && (
              <button
                type="button"
                onClick={handleRunCheck}
                disabled={isChecking}
                className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Testar Agora</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar painel de autodiagnóstico"
              className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-6 scrollbar-thin flex-1">
          {/* Core System Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Platform */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Smartphone className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>Plataforma de Execução</span>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {PLATFORM_LABELS[snapshot.platform] ?? snapshot.platform}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Capacitor Native Detection Ativo
              </p>
            </div>

            {/* GPS Status */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Navigation className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>Geolocalização em Cascata</span>
              </div>
              <p className={`text-sm font-bold ${gpsInfo.tone}`}>{gpsInfo.label}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Cascata: GPS (8s) → ipwho.is → Cache
              </p>
            </div>

            {/* IndexedDB */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Database className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>Banco Local (IndexedDB / Dexie)</span>
              </div>
              <p
                className={`text-sm font-bold ${
                  snapshot.indexedDbOk
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {snapshot.indexedDbOk ? 'Íntegro & Gravável' : 'Erro / Indisponível'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Pontos, Waypoints, Rotas e Tiles
              </p>
            </div>

            {/* Forecast Cache */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Clock className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>Estado da Previsão 168h</span>
              </div>
              <p
                className={`text-sm font-bold ${
                  snapshot.usingCachedForecast
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {snapshot.usingCachedForecast ? 'Usando Cache Offline' : 'Dados em Tempo Real'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {snapshot.cacheAgeMinutes !== null
                  ? `Idade dos dados: ${Math.round(snapshot.cacheAgeMinutes)} min`
                  : 'Frescor verificado'}
              </p>
            </div>
          </div>

          {/* Monitored APIs & Circuit Breaker Table */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>APIs Externas & Estado do Circuit Breaker</span>
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Timeout: 10s • Retries: 2 • Abre após 3 falhas
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2.5 px-3 font-bold">Serviço / API</th>
                    <th className="py-2.5 px-3 font-bold">Status</th>
                    <th className="py-2.5 px-3 font-bold">Latência</th>
                    <th className="py-2.5 px-3 font-bold">Circuit Breaker</th>
                    <th className="py-2.5 px-3 font-bold">Última Checagem</th>
                    <th className="py-2.5 px-3 font-bold">Detalhe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {endpointsList.map((ep) => {
                    const epBadge = HEALTH_BADGE_MAP[ep.status] ?? HEALTH_BADGE_MAP.degraded;
                    const EpIcon = epBadge.Icon;
                    return (
                      <tr key={ep.service} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                          {ep.label}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${epBadge.bgClass}`}
                          >
                            <EpIcon className="w-3 h-3" aria-hidden="true" />
                            {epBadge.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          {ep.latencyMs !== null ? `${Math.round(ep.latencyMs)} ms` : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {ep.circuitOpen ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/15 text-red-700 dark:text-red-300 font-bold">
                              Aberto ({ep.consecutiveFailures} falhas)
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                              Fechado ({ep.consecutiveFailures}/3)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                          {formatUtcTimestamp(ep.lastCheckedIso)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-xs truncate">
                          {ep.message ??
                            (ep.status === 'unverified'
                              ? 'Aguardando uso (Sob Demanda / Não Verificado)'
                              : 'OK')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Error Log Section */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />
                <span>Log de Erros Recentes ({snapshot.recentErrors?.length ?? 0})</span>
              </h3>
              {onClearErrorLogs && (snapshot.recentErrors?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={handleClearLogs}
                  disabled={isClearingLogs}
                  className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Limpar Log de Erros</span>
                </button>
              )}
            </div>

            {!snapshot.recentErrors || snapshot.recentErrors.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                Nenhuma exceção ou erro registrado no armazenamento local.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-56 scrollbar-thin">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 px-3 font-bold">Horário UTC</th>
                      <th className="py-2 px-3 font-bold">Módulo</th>
                      <th className="py-2 px-3 font-bold">Ação</th>
                      <th className="py-2 px-3 font-bold">Mensagem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                    {snapshot.recentErrors.map((err, index) => (
                      <tr key={err.id ?? index} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                          {err.timestampUtcIso.replace('T', ' ').slice(0, 19)}
                        </td>
                        <td className="py-2 px-3 font-semibold text-sky-700 dark:text-sky-400">
                          {err.module}
                        </td>
                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                          {err.action}
                        </td>
                        <td className="py-2 px-3 text-red-700 dark:text-red-300 break-all">
                          {err.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Arquitetura Zero-Crash • Fallback Automático para IndexedDB
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] px-5 py-2 rounded-xl text-sm font-bold bg-slate-900 dark:bg-sky-600 text-white hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
