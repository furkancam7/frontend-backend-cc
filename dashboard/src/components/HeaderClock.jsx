import React, { useState, useEffect } from 'react';
import { usePreferences } from '../context/PreferencesContext';

function HeaderClock() {
  const { locale } = usePreferences();
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
