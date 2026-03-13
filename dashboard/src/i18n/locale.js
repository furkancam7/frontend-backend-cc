export function toIntlLocale(languageCode) {
  const normalized = String(languageCode || 'en').toLowerCase();
  if (normalized.startsWith('tr')) return 'tr-TR';
  if (normalized.startsWith('sr')) return 'sr-RS';
  return 'en-US';
}

