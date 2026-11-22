import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage, ToastType } from '../../types/health';

export interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const TOAST_STYLES: Record<
  ToastType,
  {
    container: string;
    iconColor: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  success: {
    container:
      'border-emerald-600/40 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/95 dark:text-emerald-100 dark:border-emerald-500/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  info: {
    container:
      'border-sky-600/40 bg-sky-50 text-sky-950 dark:bg-slate-900/95 dark:text-sky-100 dark:border-sky-500/40',
    iconColor: 'text-sky-600 dark:text-sky-400',
    Icon: Info,
  },
  warning: {
    container:
      'border-amber-600/40 bg-amber-50 text-amber-950 dark:bg-amber-950/95 dark:text-amber-100 dark:border-amber-500/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  error: {
    container:
      'border-red-600/40 bg-red-50 text-red-950 dark:bg-red-950/95 dark:text-red-100 dark:border-red-500/40',
    iconColor: 'text-red-600 dark:text-red-400',
    Icon: AlertCircle,
  },
};

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Notificações do sistema"
      aria-live="polite"
      className="fixed bottom-20 md:bottom-6 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
    >
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.type] ?? TOAST_STYLES.info;
        const { Icon } = style;

        return (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-xl border p-3.5 shadow-xl backdrop-blur-md transition-all ${style.container}`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${style.iconColor}`} aria-hidden="true" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-bold leading-snug break-words">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs opacity-90 leading-relaxed break-words">{toast.message}</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={`Fechar notificação: ${toast.title}`}
              className="min-h-[44px] min-w-[44px] -m-1.5 rounded-lg inline-flex items-center justify-center opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
