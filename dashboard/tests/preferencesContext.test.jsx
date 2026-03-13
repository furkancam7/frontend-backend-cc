import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PreferencesProvider,
  usePreferences,
  resolveLanguageFromNavigator,
  resolveInitialLanguage,
  resolveInitialTheme,
} from '../src/context/PreferencesContext';

function ThemeProbe() {
  const { theme } = usePreferences();
  return <div>{theme}</div>;
}

describe('PreferencesContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects Turkish for Turkish browser locales', () => {
    expect(resolveLanguageFromNavigator('tr-TR')).toBe('tr');
    expect(resolveInitialLanguage(null, 'tr')).toBe('tr');
  });

  it('selects Serbian for Serbian browser locales', () => {
    expect(resolveLanguageFromNavigator('sr-RS')).toBe('sr');
    expect(resolveInitialLanguage(null, 'sr-Latn')).toBe('sr');
  });

  it('falls back to English for non-Turkish locales', () => {
    expect(resolveLanguageFromNavigator('en-US')).toBe('en');
    expect(resolveInitialLanguage(null, 'de-DE')).toBe('en');
  });

  it('prefers stored language over browser language', () => {
    expect(resolveInitialLanguage('en', 'tr-TR')).toBe('en');
  });

  it('follows system theme when no saved theme exists', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('saved theme overrides system preference', () => {
    localStorage.setItem('dashboard.preferences.theme', 'light');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(
      <PreferencesProvider>
        <ThemeProbe />
      </PreferencesProvider>
    );
    expect(screen.getByText('light')).toBeInTheDocument();
    expect(resolveInitialTheme('light', true)).toBe('light');
  });
});
