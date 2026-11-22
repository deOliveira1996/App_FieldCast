import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, Check, Copy, RotateCcw, Terminal } from 'lucide-react';
import type { ErrorLogRecord } from '../../types/health';
import { safeAction } from '../../utils/safeAction';

export interface GlobalErrorBoundaryProps {
  children: ReactNode;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
  onClearCache?: () => void | Promise<void>;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  timestampUtcIso: string | null;
  copiedReport: boolean;
  isClearing: boolean;
}

export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      componentStack: null,
      timestampUtcIso: null,
      copiedReport: false,
      isClearing: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<GlobalErrorBoundaryState> {
    return {
      hasError: true,
      error,
      timestampUtcIso: new Date().toISOString(),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const timestampUtcIso = new Date().toISOString();
    this.setState({
      componentStack: errorInfo.componentStack ?? null,
      timestampUtcIso,
    });

    if (this.props.onErrorLog) {
      const record: ErrorLogRecord = {
        timestampUtcIso,
        module: 'GlobalErrorBoundary',
        action: 'ReactRootRenderCrash',
        message: error.message || 'Erro crítico na raiz da aplicação',
        stack: [error.stack, errorInfo.componentStack].filter(Boolean).join('\n\n'),
      };
      Promise.resolve(this.props.onErrorLog(record)).catch(() => {
        // Silencia erro secundário do logger
      });
    }
  }

  private buildTechnicalReport(): string {
    const { error, componentStack, timestampUtcIso } = this.state;
    const report = {
      application: 'FieldCast — Previsão Local & Campo',
      timestampUtc: timestampUtcIso ?? new Date().toISOString(),
      errorMessage: error?.message ?? 'Erro desconhecido',
      errorName: error?.name ?? 'Error',
      stack: error?.stack ?? null,
      componentStack: componentStack ?? null,
      url: typeof window !== 'undefined' ? window.location.href : 'N/A',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    };
    return JSON.stringify(report, null, 2);
  }

  private handleCopyReport = (): void => {
    void safeAction(
      async () => {
        const text = this.buildTechnicalReport();
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else if (typeof document !== 'undefined') {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        this.setState({ copiedReport: true });
        setTimeout(() => {
          this.setState({ copiedReport: false });
        }, 3000);
      },
      {
        actionKey: 'global_error_copy_report',
        moduleName: 'GlobalErrorBoundary',
        errorTitle: 'Não foi possível copiar o relatório técnico',
      },
    );
  };

  private handleClearCacheAndRestart = (): void => {
    void safeAction(
      async () => {
        if (this.props.onClearCache) {
          await this.props.onClearCache();
        }

        if (typeof window !== 'undefined') {
          try {
            window.localStorage.clear();
            window.sessionStorage.clear();
          } catch {
            // Ignora falhas de storage restrito
          }

          if ('caches' in window) {
            try {
              const cacheKeys = await window.caches.keys();
              await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
            } catch {
              // Ignora falha ao limpar Cache Storage
            }
          }

          if ('indexedDB' in window && window.indexedDB) {
            try {
              window.indexedDB.deleteDatabase('FieldCastDB');
              window.indexedDB.deleteDatabase('fieldcast_db');
            } catch {
              // Ignora bloqueio de deleção do IndexedDB
            }
          }

          window.location.reload();
        }
      },
      {
        actionKey: 'global_error_clear_cache_restart',
        moduleName: 'GlobalErrorBoundary',
        errorTitle: 'Erro ao limpar cache local',
        onLoadingChange: (isClearing) => this.setState({ isClearing }),
      },
    );
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, timestampUtcIso, copiedReport, isClearing } = this.state;

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4"
      >
        <div className="max-w-2xl w-full rounded-2xl border border-red-500/40 bg-slate-900/95 shadow-2xl p-6 md:p-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 shrink-0">
              <AlertOctagon className="w-8 h-8" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-red-500/20 text-red-300 border border-red-500/30">
                Proteção Zero-Crash — Erro Global Interceptado
              </span>
              <h1 className="text-xl md:text-2xl font-bold text-white">
                O FieldCast encontrou uma falha inesperada
              </h1>
              <p className="text-sm text-slate-300">
                Seus pontos salvos, waypoints e rotas gravadas estão protegidos. Você pode copiar o
                diagnóstico técnico abaixo ou limpar o cache temporário para reiniciar o aplicativo.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-3 font-mono text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800 text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-semibold text-sky-400">
                <Terminal className="w-4 h-4" aria-hidden="true" />
                Motivo Exato da Exceção
              </span>
              <span>UTC: {timestampUtcIso ?? new Date().toISOString()}</span>
            </div>
            <p className="text-red-300 font-semibold break-words text-sm">
              {error?.name ? `${error.name}: ` : ''}
              {error?.message || 'Erro de execução não especificado'}
            </p>
            {error?.stack && (
              <pre className="text-slate-400 overflow-x-auto max-h-44 scrollbar-thin whitespace-pre-wrap leading-relaxed">
                {error.stack}
              </pre>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={this.handleCopyReport}
              className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {copiedReport ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  <span>Relatório Técnico Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-sky-400" aria-hidden="true" />
                  <span>Copiar Relatório Técnico</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={this.handleClearCacheAndRestart}
              disabled={isClearing}
              className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white shadow-lg shadow-red-900/30 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <RotateCcw
                className={`w-4 h-4 ${isClearing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isClearing ? 'Limpando Cache...' : 'Limpar Cache e Reiniciar'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
