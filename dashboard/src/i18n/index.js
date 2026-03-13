import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import tr from '../locales/tr.json';
import sr from '../locales/sr.json';

const SUPPORTED_LANGUAGES = ['en', 'tr', 'sr'];

const LANGUAGE_NAMESPACES = [
  'common',
  'login',
  'app',
  'mapStyles',
  'notifications',
  'detectionList',
  'dataTable',
  'detectionHistory',
  'detectionDetail',
  'locationSettings',
  'mapPopup',
  'notificationLog',
  'deviceStatus'
];

export function normalizeDetectedLanguage(language) {
  const normalized = String(language || '').toLowerCase();
  if (normalized.startsWith('tr')) return 'tr';
  if (normalized.startsWith('sr')) return 'sr';
  return 'en';
}

export function resolveLanguageFromSources(storedLanguage, navigatorLanguage) {
  const rawStored = String(storedLanguage || '').toLowerCase();
  if (rawStored && SUPPORTED_LANGUAGES.includes(rawStored)) {
    return rawStored;
  }
  return normalizeDetectedLanguage(navigatorLanguage);
}

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en,
        tr,
        sr
      },
      fallbackLng: 'en',
      supportedLngs: SUPPORTED_LANGUAGES,
      ns: LANGUAGE_NAMESPACES,
      defaultNS: 'common',
      fallbackNS: ['common'],
      interpolation: {
        escapeValue: false
      },
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: 'i18nextLng',
        caches: ['localStorage'],
        convertDetectedLanguage: normalizeDetectedLanguage
      }
    });
}

export default i18n;
