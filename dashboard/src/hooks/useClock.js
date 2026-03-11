import { useState, useEffect, useCallback } from 'react';

export default function useClock(intervalMs = 1000) {
  const [time, setTime] = useState(() => new Date().toUTCString());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toUTCString());
    }, intervalMs);

    return () => clearInterval(interval);
  }, [intervalMs]);

  return time;
}
