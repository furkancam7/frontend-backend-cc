import React, { useState, useEffect } from 'react';
import { useUiTranslation } from '../i18n/useUiTranslation';
import { toIntlLocale } from '../i18n/locale';

function HeaderClock() {
  const { i18n } = useUiTranslation();
  const locale = toIntlLocale(i18n.resolvedLanguage);
  const [time, setTime] = useState(new Date().toLocaleString(locale));

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleString(locale));
    }, 1000);
    return () => clearInterval(interval);
  }, [locale]);

  return <span className="text-gray-400">{time}</span>;
}

export default React.memo(HeaderClock);
