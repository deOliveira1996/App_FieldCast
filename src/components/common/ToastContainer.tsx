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
      'border-emerald-200 bg-white text-slate-800 dark:bg-[#132a47] dark:text-emerald-100 dark:border-emerald-600/40',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  info: {
    container:
      'border-sky-200 bg-white text-slate-800 dark:bg-[#132a47] dark:text-sky-100 dark:border-sky-600/40',
    iconColor: 'text-[#0080cd] dark:text-sky-400',
    Icon: Info,
  },
  warning: {
    container:
      'border-amber-200 bg-white text-slate-800 dark:bg-[#132a47] dark:text-amber-100 dark:border-amber-500/40',
    iconColor: 'text-amber-500 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  error: {
    container:
      'border-rose-200 bg-white text-slate-800 dark:bg-[#132a47] dark:text-rose-100 dark:border-rose-500/40',
    iconColor: 'text-rose-500 dark:text-rose-400',
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
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-2xl border p-3.5 shadow-xl shadow-sky-950/10 backdrop-blur-md transition-all ${style.container}`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${style.iconColor}`} aria-hidden="true" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-bold leading-snug break-words">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs text-slate-600 dark:text-sky-200/80 leading-relaxed break-words">
                    {toast.message}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={`Fechar notificação: ${toast.title}`}
              className="min-h-[36px] min-w-[36px] -m-1 rounded-xl inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-sky-50 dark:hover:bg-white/10 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
