import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'fieldcast_theme';

function getInitialTheme(defaultTheme: ThemeMode = 'dark'): ThemeMode {
  if (typeof window === 'undefined') {
    return defaultTheme;
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  } catch {
    // Ignore localStorage access errors in restricted webviews
  }
  return defaultTheme;
}

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
    metaThemeColor.setAttribute('content', theme === 'dark' ? '#070b14' : '#f8fafc');
  }
}

export interface UseThemeResult {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

/**
 * Hook de gerenciamento persistente de Tema Claro (alto contraste solar)
 * e Escuro (noturno), sincronizado com `localStorage` e classe `dark` no `<html>`.
 */
export function useTheme(defaultTheme: ThemeMode = 'dark'): UseThemeResult {
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
