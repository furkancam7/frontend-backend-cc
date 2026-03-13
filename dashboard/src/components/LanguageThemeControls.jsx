import React from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { useUiTranslation } from '../i18n/useUiTranslation';

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'EN' },
  { value: 'tr', label: 'TR' },
  { value: 'sr', label: 'SR' }
];

export default function LanguageThemeControls({
  className = '',
  languageId = 'language-select',
  compact = true
}) {
  const { theme, toggleTheme } = usePreferences();
  const { t, i18n } = useUiTranslation(['common']);

  const controlHeightClass = compact ? 'h-7 text-[10px]' : 'h-8 text-[11px]';
  const selectPaddingClass = compact ? 'px-1.5' : 'px-2';

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <label className="sr-only" htmlFor={languageId}>{t('common.language')}</label>
      <select
        id={languageId}
        value={i18n.resolvedLanguage || i18n.language || 'en'}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className={`${controlHeightClass} rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] ${selectPaddingClass} text-[var(--text-main)] focus:outline-none`}
        title={t('common.language')}
      >
        {LANGUAGE_OPTIONS.map((languageOption) => (
          <option key={languageOption.value} value={languageOption.value}>
            {languageOption.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggleTheme}
        className={`${controlHeightClass} rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 uppercase text-[var(--text-main)] transition-colors hover:border-cyan-500/70`}
        title={`${t('common.theme')}: ${theme === 'dark' ? t('common.dark') : t('common.light')}`}
      >
        {theme === 'dark' ? t('common.dark') : t('common.light')}
      </button>
    </div>
  );
}

