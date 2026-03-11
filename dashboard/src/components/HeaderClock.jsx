import React, { useState, useEffect } from 'react';

function HeaderClock() {
  const [time, setTime] = useState(new Date().toUTCString());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toUTCString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return <span className="text-gray-400">{time}</span>;
}

export default React.memo(HeaderClock);
