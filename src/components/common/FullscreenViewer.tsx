import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import { dispatchFieldCastLayoutRefresh } from '../../hooks/useViewportResize';

export interface FullscreenRenderContext {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
}

export interface FullscreenViewerProps {
  title: string;
  subtitle?: string;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  defaultExpanded?: boolean;
  headerActions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  testId?: string;
  showInlineTrigger?: boolean;
  children: React.ReactNode | ((ctx: FullscreenRenderContext) => React.ReactNode);
}

const LAYOUT_REFRESH_DELAY_MS = 60;

export const FullscreenViewer: React.FC<FullscreenViewerProps> = ({
  title,
  subtitle,
  isExpanded: controlledExpanded,
  onExpandedChange,
  defaultExpanded = false,
  headerActions,
  className = '',
  contentClassName = '',
  testId,
  showInlineTrigger = true,
  children,
}) => {
  const [internalExpanded, setInternalExpanded] = useState<boolean>(defaultExpanded);
  const isFullscreen = controlledExpanded ?? internalExpanded;
  const hasMountedRef = useRef<boolean>(false);

  const setExpanded = useCallback(
    (next: boolean) => {
      if (controlledExpanded === undefined) {
        setInternalExpanded(next);
      }
      onExpandedChange?.(next);
    },
    [controlledExpanded, onExpandedChange],
  );

  const toggleFullscreen = useCallback(() => {
    setExpanded(!isFullscreen);
  }, [isFullscreen, setExpanded]);

  // Gerencia tecla Escape e bloqueio seguro de scroll do body quando expandido
  useEffect(() => {
    if (!isFullscreen || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setExpanded(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen, setExpanded]);

  // Dispara recálculo de dimensões (ECharts / Leaflet) 60ms após alternar Tela Cheia
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (!isFullscreen) {
        return;
      }
    }

    const timer = window.setTimeout(() => {
      dispatchFieldCastLayoutRefresh();
      window.dispatchEvent(new Event('resize'));
    }, LAYOUT_REFRESH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isFullscreen]);

  const buttonTestId = testId ? `${testId}-btn` : 'fullscreen-viewer-btn';
  const renderedContent =
    typeof children === 'function'
      ? children({ isFullscreen, toggleFullscreen })
      : children;

  if (isFullscreen && typeof document !== 'undefined') {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId ? `${testId}-modal` : 'fullscreen-viewer-modal'}
        className="fixed inset-0 z-[85] flex flex-col bg-slate-50 dark:bg-[#0b192c] text-slate-900 dark:text-sky-50 p-3 sm:p-5 overflow-y-auto pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-sky-200/80 dark:border-sky-800/80 shrink-0 min-w-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-slate-600 dark:text-sky-200/80 truncate">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              data-testid={buttonTestId}
              onClick={toggleFullscreen}
              aria-expanded={true}
              aria-label={`Reduzir tela cheia: ${title}`}
              title="Sair da Tela Cheia (Esc)"
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <Minimize2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Reduzir</span>
            </button>
          </div>
        </div>

        <div className={`flex-1 min-h-0 min-w-0 ${contentClassName}`}>
          {renderedContent}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div
      data-testid={testId ?? 'fullscreen-viewer'}
      className={`min-w-0 ${className}`.trim()}
    >
      {showInlineTrigger && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 min-w-0">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-slate-600 dark:text-sky-200/80 truncate">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              data-testid={buttonTestId}
              onClick={toggleFullscreen}
              aria-expanded={false}
              aria-label={`Expandir em tela cheia: ${title}`}
              title="Expandir em Tela Cheia"
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-sky-200/90 dark:border-sky-800 bg-sky-50/90 dark:bg-[#0d1f36]/90 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-slate-700 dark:text-sky-100 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <Maximize2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Tela Cheia</span>
            </button>
          </div>
        </div>
      )}

      <div className={`min-w-0 ${contentClassName}`.trim()}>
        {renderedContent}
      </div>
    </div>
  );
};
