import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const toSafeTranslationKey = (key) => {
  if (typeof key === 'string') return key;
  if (Array.isArray(key)) return key.map(item => String(item ?? ''));
  if (key == null) return '';
  return String(key);
};

const toSafeTranslationOptions = (options) => {
  if (options == null) return undefined;
  if (typeof options === 'object' && !Array.isArray(options)) return options;
  return { defaultValue: String(options) };
};

export function useUiTranslation(namespaces) {
  const { t: rawT, i18n } = useTranslation(namespaces);

  const t = useCallback((key, options = undefined) => {
    if (import.meta.env.DEV && typeof key !== 'string' && !Array.isArray(key) && key != null) {
      // Helps identify accidental t({ ... }) / t(number) calls during development.
      console.warn('[i18n] Non-string translation key received:', key);
    }

    const safeKey = toSafeTranslationKey(key);
    const safeOptions = toSafeTranslationOptions(options);

    if (Array.isArray(safeKey)) {
      return rawT(safeKey, safeOptions);
    }

    if (!safeKey) return '';

    const splitIndex = safeKey.indexOf('.');
    if (splitIndex === -1) return rawT(safeKey, safeOptions);

    const ns = safeKey.slice(0, splitIndex);
    const actualKey = safeKey.slice(splitIndex + 1);
    return rawT(actualKey, { ns, ...(safeOptions || {}) });
  }, [rawT]);

  return { t, i18n };
}
