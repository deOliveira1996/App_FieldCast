import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'fieldcast_theme_clean_v2';

function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'dark' ? '#0d1f36' : '#f0f8ff');
  }
}

function getInitialTheme(_defaultTheme: ThemeMode = 'light'): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }
  let resolved: ThemeMode = 'light';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      resolved = stored;
    }
  } catch {
    // Ignore localStorage access errors in restricted webviews
  }
  applyThemeToDom(resolved);
  return resolved;
}

export interface UseThemeResult {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

/**
 * Hook de gerenciamento persistente do Tema Clean Azul/Branco (padrão 'light')
 * e Tema Oceânico Noturno ('dark'), sincronizado com `localStorage` e classe `dark` no `<html>`.
 */
export function useTheme(defaultTheme: ThemeMode = 'light'): UseThemeResult {
  const [theme, setThemeState] = useState<ThemeMode>(() => getInitialTheme(defaultTheme));

  useEffect(() => {
    applyThemeToDom(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage quota/security errors
    }
  }, [theme]);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggleTheme,
  };
}
