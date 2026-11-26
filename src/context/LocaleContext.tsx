import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translateKey, type AppLocale } from '../i18n/translations';

export type { AppLocale };

export const LOCALE_STORAGE_KEY = 'fieldcast_locale_v42';
export const LOCALE_CHANGED_EVENT = 'fieldcast:locale-change';

export interface LocaleContextValue {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
  toggleLocale: () => void;
  isPt: boolean;
  isEn: boolean;
  tr: (pt: string, en: string) => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

let memoryLocale: AppLocale = 'pt';

function sanitizeLocale(raw: unknown): AppLocale {
  return raw === 'en' ? 'en' : 'pt';
}

function applyDocumentLang(locale: AppLocale): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en';
  }
}

export function loadLocalePreference(): AppLocale {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === 'pt' || stored === 'en') {
        memoryLocale = stored;
        return stored;
      }
    }
  } catch {
    // Fallback em memória quando localStorage está indisponível
  }
  return memoryLocale;
}

export function saveLocalePreference(next: AppLocale): AppLocale {
  const sanitized = sanitizeLocale(next);
  memoryLocale = sanitized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCALE_STORAGE_KEY, sanitized);
    }
  } catch {
    // Ignora falha de escrita em ambiente restrito
  }
  applyDocumentLang(sanitized);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<AppLocale>(LOCALE_CHANGED_EVENT, { detail: sanitized }));
  }
  return sanitized;
}

function buildLocaleValue(
  locale: AppLocale,
  setLocaleFn: (next: AppLocale) => void,
  toggleLocaleFn: () => void,
): LocaleContextValue {
  const isPt = locale === 'pt';
  const isEn = locale === 'en';
  return {
    locale,
    setLocale: setLocaleFn,
    toggleLocale: toggleLocaleFn,
    isPt,
    isEn,
    tr: (pt: string, en: string) => (isEn ? en : pt),
    t: (key: string, vars?: Record<string, string | number>) => translateKey(locale, key, vars),
  };
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export const LocaleProvider: React.FC<{
  children: React.ReactNode;
  initialLocale?: AppLocale;
}> = ({ children, initialLocale }) => {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    if (initialLocale !== undefined) {
      const sanitized = sanitizeLocale(initialLocale);
      memoryLocale = sanitized;
      return sanitized;
    }
    return loadLocalePreference();
  });

  useEffect(() => {
    applyDocumentLang(locale);
  }, [locale]);

  useEffect(() => {
    const handleExternalChange = (event: Event) => {
      const detail = (event as CustomEvent<AppLocale>).detail;
      if (detail === 'pt' || detail === 'en') {
        memoryLocale = detail;
        setLocaleState(detail);
      } else {
        setLocaleState(loadLocalePreference());
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) {
        const next = sanitizeLocale(event.newValue);
        memoryLocale = next;
        applyDocumentLang(next);
        setLocaleState(next);
      }
    };

    window.addEventListener(LOCALE_CHANGED_EVENT, handleExternalChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener(LOCALE_CHANGED_EVENT, handleExternalChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setLocale = useCallback((next: AppLocale) => {
    const saved = saveLocalePreference(next);
    setLocaleState(saved);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: AppLocale = prev === 'pt' ? 'en' : 'pt';
      return saveLocalePreference(next);
    });
  }, []);

  const value = useMemo(
    () => buildLocaleValue(locale, setLocale, toggleLocale),
    [locale, setLocale, toggleLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

/**
 * Hook seguro que funciona dentro de `<LocaleProvider>` ou de forma independente em testes unitários.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  const [standaloneLocale, setStandaloneLocale] = useState<AppLocale>(() =>
    loadLocalePreference(),
  );

  useEffect(() => {
    if (ctx) return;

    const handleExternalChange = (event: Event) => {
      const detail = (event as CustomEvent<AppLocale>).detail;
      if (detail === 'pt' || detail === 'en') {
        memoryLocale = detail;
        setStandaloneLocale(detail);
      } else {
        setStandaloneLocale(loadLocalePreference());
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) {
        const next = sanitizeLocale(event.newValue);
        memoryLocale = next;
        applyDocumentLang(next);
        setStandaloneLocale(next);
      }
    };

    window.addEventListener(LOCALE_CHANGED_EVENT, handleExternalChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener(LOCALE_CHANGED_EVENT, handleExternalChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [ctx]);

  const setStandalone = useCallback((next: AppLocale) => {
    setStandaloneLocale(saveLocalePreference(next));
  }, []);

  const toggleStandalone = useCallback(() => {
    setStandaloneLocale((prev) => saveLocalePreference(prev === 'pt' ? 'en' : 'pt'));
  }, []);

  const fallbackValue = useMemo(
    () => buildLocaleValue(standaloneLocale, setStandalone, toggleStandalone),
    [standaloneLocale, setStandalone, toggleStandalone],
  );

  return ctx ?? fallbackValue;
}
