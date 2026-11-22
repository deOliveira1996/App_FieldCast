import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ErrorLogRecord } from '../../types/health';
import { safeAction } from '../../utils/safeAction';

export interface ModuleErrorBoundaryProps {
  moduleName: string;
  children: ReactNode;
  fallbackDescription?: string;
  onReset?: () => void | Promise<void>;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

interface ModuleErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  timestampUtcIso: string | null;
  isReloading: boolean;
}

function getHumanReadableReason(error: Error | null): string {
  if (!error) {
    return 'Ocorreu uma falha temporária ao renderizar este módulo.';
  }
  const msg = error.message.toLowerCase();
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return 'Falha de comunicação de rede ao carregar dados deste módulo.';
  }
  if (msg.includes('quota') || msg.includes('indexeddb') || msg.includes('dexie')) {
    return 'Restrição de armazenamento local (IndexedDB) detectada no navegador.';
  }
  if (msg.includes('canvas') || msg.includes('echarts') || msg.includes('leaflet')) {
    return 'Erro ao inicializar o motor gráfico ou camada visual deste painel.';
  }
  return `Exceção isolada no módulo: ${error.message}`;
}

export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  constructor(props: ModuleErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      timestampUtcIso: null,
      isReloading: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ModuleErrorBoundaryState> {
    return {
      hasError: true,
      error,
      timestampUtcIso: new Date().toISOString(),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const timestampUtcIso = new Date().toISOString();
    if (this.props.onErrorLog) {
      const record: ErrorLogRecord = {
        timestampUtcIso,
        module: this.props.moduleName,
        action: 'ModuleRenderBoundary',
        message: error.message || `Falha no módulo ${this.props.moduleName}`,
        stack: [error.stack, errorInfo.componentStack].filter(Boolean).join('\n\n'),
      };
      Promise.resolve(this.props.onErrorLog(record)).catch(() => {
        // Silencia erro secundário do logger
      });
    }
  }

  private handleReloadModule = (): void => {
    void safeAction(
      async () => {
        if (this.props.onReset) {
          await this.props.onReset();
        }
        this.setState({
          hasError: false,
          error: null,
          timestampUtcIso: null,
        });
      },
      {
        actionKey: `reload_module_${this.props.moduleName}`,
        moduleName: this.props.moduleName,
        errorTitle: `Não foi possível recarregar o módulo ${this.props.moduleName}`,
        onLoadingChange: (isReloading) => this.setState({ isReloading }),
      },
    );
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { moduleName, fallbackDescription } = this.props;
    const { error, timestampUtcIso, isReloading } = this.state;
    const humanReason = getHumanReadableReason(error);

    return (
      <div
        role="alert"
        className="w-full rounded-2xl border border-amber-500/40 bg-amber-50/90 dark:bg-slate-900/90 p-5 md:p-6 shadow-md space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0">
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-800 dark:text-amber-300">
                  Módulo Isolado: {moduleName}
                </span>
                {timestampUtcIso && (
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                    UTC {timestampUtcIso.slice(11, 19)}
                  </span>
                )}
              </div>
              <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white">
                {humanReason}
              </h3>
              <p className="text-xs md:text-sm text-slate-700 dark:text-slate-300">
                {fallbackDescription ??
                  'Os demais recursos do FieldCast continuam operando normalmente. Clique abaixo para reinicializar este painel.'}
              </p>
              {error?.message && (
                <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-white/80 dark:bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-800 mt-2 break-all">
                  Detalhe técnico: {error.message}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={this.handleReloadModule}
            disabled={isReloading}
            className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white shadow-sm transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <RefreshCw
              className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Recarregar Módulo</span>
          </button>
        </div>
      </div>
    );
  }
}
