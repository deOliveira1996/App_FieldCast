import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';

export interface CollapsibleModuleProps {
  id?: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  storageKey?: string;
  keepMounted?: boolean;
  hideIconStyle?: 'eye' | 'chevron';
  headerActions?: React.ReactNode;
  testId?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

function readStoredOpenState(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw === 'true') return true;
      if (raw === 'false') return false;
    }
  } catch {
    // Fallback silencioso
  }
  return fallback;
}

export const CollapsibleModule: React.FC<CollapsibleModuleProps> = ({
  id,
  title,
  subtitle,
  badge,
  icon,
  defaultOpen = true,
  isOpen: controlledOpen,
  onOpenChange,
  storageKey,
  keepMounted = true,
  hideIconStyle = 'eye',
  headerActions,
  testId,
  className = '',
  bodyClassName = 'px-3 pb-3 pt-1 sm:px-4 sm:pb-4',
  children,
}) => {
  const [internalOpen, setInternalOpen] = useState<boolean>(() =>
    readStoredOpenState(storageKey, defaultOpen),
  );

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  useEffect(() => {
    if (!storageKey || isControlled) return;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, String(internalOpen));
      }
    } catch {
      // Ignora erro de quota
    }
  }, [internalOpen, isControlled, storageKey]);

  const handleToggle = () => {
    const next = !open;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <section
      id={id}
      data-testid={testId}
      data-open={open ? 'true' : 'false'}
      className={`rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] shadow-sm transition-colors ${className}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 sm:px-4 sm:py-2 min-h-[44px]">
        <button
          type="button"
          data-testid={testId ? `${testId}-toggle` : undefined}
          aria-expanded={open}
          aria-label={`${open ? 'Ocultar' : 'Mostrar'} ${title}`}
          title={`${open ? 'Ocultar' : 'Mostrar'} ${title}`}
          onClick={handleToggle}
          className="flex-1 min-w-0 min-h-[40px] flex items-center gap-2 text-left rounded-xl hover:bg-slate-50/80 dark:hover:bg-sky-900/25 px-1.5 py-1 transition-colors"
        >
          {icon && <span className="shrink-0 flex items-center">{icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                {title}
              </h3>
              {badge}
            </div>
            {subtitle && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <span
            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-sky-950/70 text-slate-600 dark:text-sky-300"
            aria-hidden="true"
          >
            {hideIconStyle === 'chevron' ? (
              open ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )
            ) : open ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </span>
        </button>
        {headerActions && <div className="shrink-0 flex items-center gap-1">{headerActions}</div>}
      </div>

      {keepMounted ? (
        <div className={open ? bodyClassName : 'hidden'} aria-hidden={!open}>
          {children}
        </div>
      ) : (
        open && <div className={bodyClassName}>{children}</div>
      )}
    </section>
  );
};

export default CollapsibleModule;
