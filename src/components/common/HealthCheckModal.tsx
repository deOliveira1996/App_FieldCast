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
import { useLocale, type AppLocale } from '../../context/LocaleContext';
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

const HEALTH_BADGE_STYLES: Record<
  HealthLevel,
  {
    labelPt: string;
    labelEn: string;
    bgClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  healthy: {
    labelPt: 'Operacional',
    labelEn: 'Operational',
    bgClass:
      'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30',
    Icon: CheckCircle2,
  },
  degraded: {
    labelPt: 'Degradado',
    labelEn: 'Degraded',
    bgClass: 'bg-amber-500/15 text-amber-900 dark:text-amber-300 border border-amber-500/30',
    Icon: AlertTriangle,
  },
  down: {
    labelPt: 'Indisponível',
    labelEn: 'Unavailable',
    bgClass: 'bg-red-500/15 text-red-900 dark:text-red-300 border border-red-500/30',
    Icon: XCircle,
  },
  unverified: {
    labelPt: 'Sob Demanda / Não Verificado',
    labelEn: 'On Demand / Unverified',
    bgClass: 'bg-sky-500/15 text-sky-900 dark:text-sky-200 border border-sky-500/30',
    Icon: Clock,
  },
};

function getPlatformLabel(platform: PlatformKind, locale: AppLocale): string {
  const isEn = locale === 'en';
  switch (platform) {
    case 'web':
      return isEn ? 'Web Browser' : 'Navegador (Web)';
    case 'android':
      return isEn ? 'Android App' : 'Aplicativo Android';
    case 'ios':
      return isEn ? 'iOS App / Browser' : 'Aplicativo iOS / Navegador';
    default:
      return platform;
  }
}

function getGpsInfo(status: GpsHealthStatus, locale: AppLocale): { label: string; tone: string } {
  const isEn = locale === 'en';
  switch (status) {
    case 'granted':
      return {
        label: isEn ? 'GPS Active (Permission Granted)' : 'GPS Ativo (Permissão Concedida)',
        tone: 'text-emerald-700 dark:text-emerald-400',
      };
    case 'fallback_ip':
      return {
        label: isEn ? 'Approximate Network Location' : 'Localização Aproximada por Rede',
        tone: 'text-amber-700 dark:text-amber-400',
      };
    case 'offline_cache':
      return {
        label: isEn ? 'Last saved location on device' : 'Último local salvo no aparelho',
        tone: 'text-sky-700 dark:text-sky-400',
      };
    case 'denied':
      return {
        label: isEn ? 'GPS Permission Denied' : 'Permissão de GPS Negada',
        tone: 'text-red-700 dark:text-red-400',
      };
    case 'unavailable':
    default:
      return {
        label: isEn ? 'GPS Sensor Unavailable' : 'Sensor GPS Indisponível',
        tone: 'text-slate-600 dark:text-slate-400',
      };
  }
}

function formatCheckedTimestamp(iso: string | null | undefined, locale: AppLocale): string {
  if (!iso) {
    return locale === 'en' ? 'Never checked' : 'Nunca verificado';
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toLocaleTimeString(locale === 'en' ? 'en-US' : 'pt-BR', {
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
  const { locale, tr } = useLocale();
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

  const overallCfg = HEALTH_BADGE_STYLES[snapshot.overall] ?? HEALTH_BADGE_STYLES.degraded;
  const OverallIcon = overallCfg.Icon;
  const gpsInfo = getGpsInfo(snapshot.gpsStatus, locale);
  const endpointsList: ServiceEndpointStatus[] = Object.values(snapshot.endpoints ?? {});

  const handleRunCheck = () => {
    if (!onRunHealthCheck) {
      return;
    }
    void safeAction(async () => onRunHealthCheck(), {
      actionKey: 'health_modal_run_check',
      moduleName: 'HealthCheckModal',
      successTitle: tr('Verificação de serviços concluída', 'Service status check completed'),
      errorTitle: tr('Falha ao verificar serviços', 'Failed to check service status'),
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
      successTitle: tr('Registro limpo com sucesso', 'Record cleared successfully'),
      errorTitle: tr('Não foi possível limpar o registro', 'Could not clear record'),
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
                  {tr('Estado da Conexão e Serviços', 'Connection & Service Status')}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${overallCfg.bgClass}`}
                >
                  <OverallIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  {locale === 'en' ? overallCfg.labelEn : overallCfg.labelPt}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {tr(
                  `Última verificação: ${formatCheckedTimestamp(snapshot.checkedAtIso, locale)} • Monitoramento de serviços de clima, GPS e dados salvos`,
                  `Last checked: ${formatCheckedTimestamp(snapshot.checkedAtIso, locale)} • Monitoring weather services, GPS, and saved data`,
                )}
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
                <span className="hidden sm:inline">{tr('Verificar Agora', 'Check Now')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={tr(
                'Fechar painel de estado da conexão',
                'Close connection status panel',
              )}
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
                <span>{tr('Aplicativo e Dispositivo', 'App & Device')}</span>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {getPlatformLabel(snapshot.platform, locale)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'Adaptação automática para este aparelho',
                  'Automatic adaptation for this device',
                )}
              </p>
            </div>

            {/* GPS Status */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Navigation className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>{tr('Localização (GPS)', 'Location (GPS)')}</span>
              </div>
              <p className={`text-sm font-bold ${gpsInfo.tone}`}>{gpsInfo.label}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'Prioridade: GPS do aparelho → Rede → Último local salvo',
                  'Priority: Device GPS → Network → Last saved location',
                )}
              </p>
            </div>

            {/* Device Storage */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Database className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>{tr('Dados salvos no aparelho', 'Device Saved Data')}</span>
              </div>
              <p
                className={`text-sm font-bold ${
                  snapshot.indexedDbOk
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {snapshot.indexedDbOk
                  ? tr('Íntegro e Gravável', 'Healthy & Writable')
                  : tr('Erro / Indisponível', 'Error / Unavailable')}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr(
                  'Locais favoritos, marcações, rotas e mapas offline',
                  'Favorite places, waypoints, routes & offline maps',
                )}
              </p>
            </div>

            {/* Forecast Cache */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Clock className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>{tr('Estado da Previsão 168h', '168h Forecast Status')}</span>
              </div>
              <p
                className={`text-sm font-bold ${
                  snapshot.usingCachedForecast
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {snapshot.usingCachedForecast
                  ? tr('Usando dados salvos no aparelho', 'Using saved device data')
                  : tr('Dados em Tempo Real', 'Live Data')}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {snapshot.cacheAgeMinutes !== null
                  ? tr(
                      `Atualizado há ${Math.round(snapshot.cacheAgeMinutes)} min`,
                      `Updated ${Math.round(snapshot.cacheAgeMinutes)} min ago`,
                    )
                  : tr('Dados atualizados', 'Up to date')}
              </p>
            </div>
          </div>

          {/* Monitored Weather & Map Services Table */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-500" aria-hidden="true" />
                <span>
                  {tr(
                    'Conexão com serviços de clima',
                    'Weather & Map Services Connection',
                  )}
                </span>
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'Reconexão automática • Atualização a cada 1 hora',
                  'Automatic reconnection • Refreshes every 1 hour',
                )}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2.5 px-3 font-bold">{tr('Serviço', 'Service')}</th>
                    <th className="py-2.5 px-3 font-bold">{tr('Status', 'Status')}</th>
                    <th className="py-2.5 px-3 font-bold">
                      {tr('Tempo de Resposta', 'Response Time')}
                    </th>
                    <th className="py-2.5 px-3 font-bold">
                      {tr('Proteção de Conexão', 'Connection Protection')}
                    </th>
                    <th className="py-2.5 px-3 font-bold">
                      {tr('Última Checagem', 'Last Checked')}
                    </th>
                    <th className="py-2.5 px-3 font-bold">{tr('Detalhe', 'Details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {endpointsList.map((ep) => {
                    const epBadge = HEALTH_BADGE_STYLES[ep.status] ?? HEALTH_BADGE_STYLES.degraded;
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
                            {locale === 'en' ? epBadge.labelEn : epBadge.labelPt}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          {ep.latencyMs !== null ? `${Math.round(ep.latencyMs)} ms` : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {ep.circuitOpen ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/15 text-red-700 dark:text-red-300 font-bold">
                              {tr(
                                `Pausado (${ep.consecutiveFailures} falhas)`,
                                `Paused (${ep.consecutiveFailures} failures)`,
                              )}
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                              {ep.consecutiveFailures > 0
                                ? tr(
                                    `Normal (${ep.consecutiveFailures}/3)`,
                                    `Normal (${ep.consecutiveFailures}/3)`,
                                  )
                                : tr('Normal', 'Normal')}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                          {formatCheckedTimestamp(ep.lastCheckedIso, locale)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-xs truncate">
                          {ep.message ??
                            (ep.status === 'unverified'
                              ? tr(
                                  'Aguardando uso (Sob Demanda / Não Verificado)',
                                  'Awaiting use (On Demand / Unverified)',
                                )
                              : 'OK')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Issue Log Section */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />
                <span>
                  {tr(
                    `Registro de Ocorrências (${snapshot.recentErrors?.length ?? 0})`,
                    `Recent Issue Log (${snapshot.recentErrors?.length ?? 0})`,
                  )}
                </span>
              </h3>
              {onClearErrorLogs && (snapshot.recentErrors?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={handleClearLogs}
                  disabled={isClearingLogs}
                  className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{tr('Limpar Registro', 'Clear Log')}</span>
                </button>
              )}
            </div>

            {!snapshot.recentErrors || snapshot.recentErrors.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                {tr(
                  'Nenhuma falha registrada no armazenamento do aparelho.',
                  'No failures recorded in device storage.',
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-56 scrollbar-thin">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 px-3 font-bold">{tr('Horário', 'Time')}</th>
                      <th className="py-2 px-3 font-bold">{tr('Área', 'Area')}</th>
                      <th className="py-2 px-3 font-bold">{tr('Ação', 'Action')}</th>
                      <th className="py-2 px-3 font-bold">{tr('Descrição', 'Details')}</th>
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
            {tr(
              'Proteção contínua • Dados salvos automaticamente no aparelho',
              'Continuous protection • Data automatically saved on device',
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] px-5 py-2 rounded-xl text-sm font-bold bg-slate-900 dark:bg-sky-600 text-white hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {tr('Fechar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
