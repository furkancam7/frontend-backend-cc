import { describe, it, expect } from 'vitest';
import { normalizeDetectedLanguage, resolveLanguageFromSources } from '../src/i18n';

describe('i18n language resolution', () => {
  it('normalizes Turkish and Serbian navigator locales', () => {
    expect(normalizeDetectedLanguage('tr-TR')).toBe('tr');
    expect(normalizeDetectedLanguage('sr-Latn-RS')).toBe('sr');
  });

  it('falls back to English for unsupported locales', () => {
    expect(normalizeDetectedLanguage('de-DE')).toBe('en');
    expect(normalizeDetectedLanguage('')).toBe('en');
  });

  it('prefers stored language when supported', () => {
    expect(resolveLanguageFromSources('tr', 'en-US')).toBe('tr');
    expect(resolveLanguageFromSources('sr', 'tr-TR')).toBe('sr');
  });

  it('falls back to navigator language when stored value is invalid', () => {
    expect(resolveLanguageFromSources('fr', 'tr-TR')).toBe('tr');
    expect(resolveLanguageFromSources('unknown', 'sr-RS')).toBe('sr');
    expect(resolveLanguageFromSources(null, 'de-DE')).toBe('en');
  });
});

