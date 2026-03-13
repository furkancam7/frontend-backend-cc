const FIRE_ALIASES = ['fire', 'flame', 'yangin', 'ates', 'pozar'];
const SMOKE_ALIASES = ['smoke', 'duman', 'dim'];

const normalizeDetectionClass = (value) => String(value ?? '').trim();

const matchesAlias = (className, aliases) => {
  const lower = normalizeDetectionClass(className).toLowerCase();
  if (!lower) return false;
  return aliases.some((alias) => lower === alias || lower.includes(alias));
};

export const getDetectionClassTranslationKey = (className) => {
  if (matchesAlias(className, FIRE_ALIASES)) return 'common.classNames.fire';
  if (matchesAlias(className, SMOKE_ALIASES)) return 'common.classNames.smoke';
  return null;
};

export const localizeDetectionClassName = (className, t) => {
  const normalized = normalizeDetectionClass(className);
  if (!normalized) return '';

  const key = getDetectionClassTranslationKey(normalized);
  return key ? t(key) : normalized;
};

