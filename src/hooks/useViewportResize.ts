import { useEffect, useRef, useState } from 'react';

export const FIELDCAST_LAYOUT_REFRESH_EVENT = 'fieldcast:layout-refresh';

export interface FieldCastLayoutRefreshDetail {
  width: number;
  height: number;
  isLandscape: boolean;
  isMobile: boolean;
}

export interface ViewportResizeState {
  width: number;
  height: number;
  isLandscape: boolean;
  isMobile: boolean;
  layoutEpoch: number;
}

const MOBILE_BREAKPOINT_PX = 768;
const DEBOUNCE_DELAY_MS = 90;

function readViewportDimensions(): Omit<ViewportResizeState, 'layoutEpoch'> {
  if (typeof window === 'undefined') {
    return {
      width: 1280,
      height: 800,
      isLandscape: true,
      isMobile: false,
    };
  }

  const rawWidth =
    window.innerWidth ||
    window.visualViewport?.width ||
    document.documentElement?.clientWidth ||
    1280;
  const rawHeight =
    window.innerHeight ||
    window.visualViewport?.height ||
    document.documentElement?.clientHeight ||
    800;

  const width = Math.max(1, Math.round(rawWidth));
  const height = Math.max(1, Math.round(rawHeight));

  return {
    width,
    height,
    isLandscape: width > height,
    isMobile: width < MOBILE_BREAKPOINT_PX,
  };
}

/**
 * Dispara o evento global de recálculo de layout (`fieldcast:layout-refresh`)
 * para que instâncias de ECharts e Leaflet recalculem suas dimensões após
 * rotações `Paisagem <-> Retrato`, abertura de Tela Cheia ou retração da Sidebar.
 */
export function dispatchFieldCastLayoutRefresh(
  detail?: Partial<FieldCastLayoutRefreshDetail>,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const current = readViewportDimensions();
  const payload: FieldCastLayoutRefreshDetail = {
    width: detail?.width ?? current.width,
    height: detail?.height ?? current.height,
    isLandscape: detail?.isLandscape ?? current.isLandscape,
    isMobile: detail?.isMobile ?? current.isMobile,
  };

  window.dispatchEvent(
    new CustomEvent<FieldCastLayoutRefreshDetail>(FIELDCAST_LAYOUT_REFRESH_EVENT, {
      detail: payload,
    }),
  );
}

/**
 * Monitora `window` (`resize`, `orientationchange`), `screen.orientation` (`change`)
 * e `window.visualViewport` (`resize`) com debounce de 90ms, incrementando `layoutEpoch`
 * e emitindo `FIELDCAST_LAYOUT_REFRESH_EVENT` para destravar larguras horizontais residuais.
 */
export function useViewportResize(): ViewportResizeState {
  const [state, setState] = useState<ViewportResizeState>(() => ({
    ...readViewportDimensions(),
    layoutEpoch: 0,
  }));

  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const scheduleRefresh = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const nextDims = readViewportDimensions();

        setState((prev) => ({
          width: nextDims.width,
          height: nextDims.height,
          isLandscape: nextDims.isLandscape,
          isMobile: nextDims.isMobile,
          layoutEpoch: prev.layoutEpoch + 1,
        }));

        dispatchFieldCastLayoutRefresh(nextDims);
      }, DEBOUNCE_DELAY_MS);
    };

    window.addEventListener('resize', scheduleRefresh, { passive: true });
    window.addEventListener('orientationchange', scheduleRefresh, { passive: true });

    const screenOrientation =
      typeof window.screen !== 'undefined' ? window.screen.orientation : undefined;
    if (screenOrientation && typeof screenOrientation.addEventListener === 'function') {
      screenOrientation.addEventListener('change', scheduleRefresh);
    }

    const visualViewport = window.visualViewport;
    if (visualViewport && typeof visualViewport.addEventListener === 'function') {
      visualViewport.addEventListener('resize', scheduleRefresh, { passive: true });
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      window.removeEventListener('resize', scheduleRefresh);
      window.removeEventListener('orientationchange', scheduleRefresh);

      if (screenOrientation && typeof screenOrientation.removeEventListener === 'function') {
        screenOrientation.removeEventListener('change', scheduleRefresh);
      }

      if (visualViewport && typeof visualViewport.removeEventListener === 'function') {
        visualViewport.removeEventListener('resize', scheduleRefresh);
      }
    };
  }, []);

  return state;
}
