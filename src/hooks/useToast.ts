import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastMessage } from '../types/health';

const DEFAULT_TOAST_DURATION_MS = 4500;
const MAX_VISIBLE_TOASTS = 5;

export interface UseToastResult {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

/**
 * Hook de gerenciamento de notificações visuais (Toasts) compatível com `safeAction`.
 */
export function useToast(): UseToastResult {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const existingTimer = timersRef.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addToast = useCallback(
    (toastInput: Omit<ToastMessage, 'id'>): string => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const durationMs = toastInput.durationMs ?? DEFAULT_TOAST_DURATION_MS;
      const newToast: ToastMessage = {
        ...toastInput,
        id,
        durationMs,
      };

      setToasts((prev) => {
        const next = [newToast, ...prev];
        return next.slice(0, MAX_VISIBLE_TOASTS);
      });

      if (durationMs > 0) {
        const timer = setTimeout(() => {
          dismissToast(id);
        }, durationMs);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismissToast],
  );

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return {
    toasts,
    addToast,
    dismissToast,
    clearToasts,
  };
}
