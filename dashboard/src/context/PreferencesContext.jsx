import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PreferencesContext = createContext(null);

const THEME_STORAGE_KEY = 'dashboard.preferences.theme';
const SUPPORTED_THEMES = ['dark', 'light'];

const normalizeTheme = (value) => {
  const normalized = String(value || '').toLowerCase();
  return SUPPORTED_THEMES.includes(normalized) ? normalized : null;
};

export const resolveInitialTheme = (storedTheme, prefersDark) => {
  const fromStorage = normalizeTheme(storedTheme);
  if (fromStorage) return fromStorage;
  return prefersDark ? 'dark' : 'light';
};

const readStorage = (key) => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // no-op
  }
};

const detectPrefersDark = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export function PreferencesProvider({ children }) {
  const [theme, setTheme] = useState(() =>
    resolveInitialTheme(readStorage(THEME_STORAGE_KEY), detectPrefersDark())
  );

  useEffect(() => {
    writeStorage(THEME_STORAGE_KEY, theme);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }), [theme]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}

