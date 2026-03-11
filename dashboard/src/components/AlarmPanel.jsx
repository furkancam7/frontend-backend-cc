import React, { memo, useMemo, useState, useCallback, useRef } from 'react';

const ALARM_STYLES = {
  red: {
    bg: 'bg-red-950/90',
    border: 'border-red-500',
    shadow: 'shadow-red-900/20',
    iconBg: 'bg-red-900/50 border-red-400 text-red-400',
    textColor: 'text-red-400',
    focusRing: 'focus:ring-red-500',
    animate: 'animate-pulse-slow',
    progressBar: true
  },
  partial: {
    bg: 'bg-blue-950/90',
    border: 'border-blue-500',
    shadow: 'shadow-blue-900/20',
    iconBg: 'bg-blue-900/50 border-blue-400 text-blue-400',
    textColor: 'text-blue-400',
    focusRing: 'focus:ring-blue-500',
    animate: '',
    progressBar: false
  },
  complete: {
    bg: 'bg-green-950/90',
    border: 'border-green-500',
    shadow: 'shadow-green-900/20',
    iconBg: 'bg-green-900/50 border-green-400 text-green-400',
    textColor: 'text-green-400',
    focusRing: 'focus:ring-green-500',
    animate: '',
    progressBar: false
  },
  default: {
    bg: 'bg-yellow-950/90',
    border: 'border-yellow-500',
    shadow: 'shadow-yellow-900/20',
    iconBg: 'bg-yellow-900/50 border-yellow-400 text-yellow-400',
    textColor: 'text-yellow-400',
    focusRing: 'focus:ring-yellow-500',
    animate: '',
    progressBar: false
  }
};

const ALARM_TITLES = {
  red: 'CRITICAL ALERT',
  partial: 'PARTIAL IMAGE',
  complete: 'IMAGE COMPLETED',
  default: 'WARNING'
};

const ALARM_ACTIONS = {
  partial: 'PENDING',
  complete: 'VIEW',
  default: 'CLICK TO SEE'
};

const ALARM_MESSAGES = {
  partial: {
    primary: 'Incomplete image received.',
    primaryClass: 'text-blue-300',
    secondary: 'Waiting for remaining data...'
  },
  complete: {
    primary: 'Image transmission completed!',
    primaryClass: 'text-green-300',
    secondary: 'Full image is now available.'
  }
};

const ALARM_ICONS = {
  red: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  partial: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  complete: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  default: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
};

const INITIAL_VISIBLE_ALARMS = 10;
const LOAD_MORE_COUNT = 10;
const SCROLL_THRESHOLD = 50;
const SCROLL_THROTTLE_MS = 100;
const MAX_ANIMATED_INDEX = 3;
const getAlarmStyles = (type) => ALARM_STYLES[type] || ALARM_STYLES.default;
const getAlarmTitle = (type) => ALARM_TITLES[type] || ALARM_TITLES.default;
const getAlarmIcon = (type) => ALARM_ICONS[type] || ALARM_ICONS.default;
const getActionText = (type) => ALARM_ACTIONS[type] || ALARM_ACTIONS.default;
const safeToUpperCase = (value) => {
  if (value == null) return '';
  return String(value).toUpperCase();
};

const getAlarmMessage = (alarm) => {
  const type = alarm?.type;
  if (ALARM_MESSAGES[type]) return ALARM_MESSAGES[type];
  
  return {
    primary: `DETECTED: ${safeToUpperCase(alarm?.detection?.class) || 'UNKNOWN'}`,
    primaryClass: 'text-gray-200',
    secondary: null
  };
};

const formatTime = (timestamp) => {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '--:--:--';
    return date.toLocaleTimeString();
  } catch {
    return '--:--:--';
  }
};

const toISOString = (timestamp) => {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return undefined;
    return date.toISOString();
  } catch {
    return undefined;
  }
};

const getAlarmId = (alarm) => {
  if (alarm?.detection?.crop_id != null) {
    return String(alarm.detection.crop_id);
  }
  if (typeof alarm?.meta_data === 'string' && alarm.meta_data.length > 0) {
    return alarm.meta_data.slice(-8);
  }
  return 'N/A';
};

const getKey = (alarm) => {
  if (alarm?.id != null) return alarm.id;
  const type = alarm?.type ?? 'unknown';
  const ts = alarm?.timestamp ?? 0;
  const alarmId = getAlarmId(alarm);
  return `fallback-${type}-${ts}-${alarmId}`;
};

const AlarmCard = memo(function AlarmCard({ alarm, onAcknowledge, index }) {
  const styles = getAlarmStyles(alarm.type);
  const message = getAlarmMessage(alarm);
  const alarmId = getAlarmId(alarm);
  const formattedTime = formatTime(alarm.timestamp);
  const isoDateTime = toISOString(alarm.timestamp);
  const actionText = getActionText(alarm.type);
  const shouldAnimate = index < MAX_ANIMATED_INDEX;
  const animationClass = shouldAnimate ? styles.animate : '';
  const handleClick = useCallback(() => {
    onAcknowledge?.(alarmId);
  }, [onAcknowledge, alarmId]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${getAlarmTitle(alarm.type)}: ${message.primary}. ${actionText}`}
      className={`
        relative overflow-hidden rounded-lg border shadow-lg cursor-pointer 
        transition-all duration-200 hover:scale-[1.02]
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900
        ${styles.focusRing}
        w-full text-left
        ${styles.bg} ${styles.border} ${styles.shadow} ${animationClass}
      `}
    >
      {alarm.type === 'red' && (
        <div className="absolute inset-0 opacity-10 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,0,0,0.1)_10px,rgba(255,0,0,0.1)_20px)]" aria-hidden="true" />
      )}

      <div className="p-3 flex gap-3 relative z-10">
        <div className={`flex-shrink-0 w-10 h-10 rounded flex items-center justify-center border ${styles.iconBg}`} aria-hidden="true">
          {getAlarmIcon(alarm.type)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start">
            <h3 className={`text-sm font-bold uppercase tracking-wider ${styles.textColor}`}>
              {getAlarmTitle(alarm.type)}
            </h3>
            <time dateTime={isoDateTime} className="text-[10px] font-mono text-gray-400">
              {formattedTime}
            </time>
          </div>

          <p className="text-xs text-gray-200 font-medium mt-1">
            <span className={message.primaryClass}>{message.primary}</span>
            {message.secondary && (
              <>
                <br />
                <span className="text-gray-400">{message.secondary}</span>
              </>
            )}
          </p>

          <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 font-mono">
            <span>ID: #{alarmId}</span>
            <span className="flex items-center gap-1">
              {actionText}
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {styles.progressBar && shouldAnimate && (
        <div className="absolute bottom-0 left-0 h-0.5 bg-red-500 animate-progress w-full" aria-hidden="true" />
      )}
    </button>
  );
});

function AlarmPanel({ alarms, onAcknowledge }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ALARMS);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const lastScrollTime = useRef(0);
  const isLoadingRef = useRef(false); 
  const alarmsLengthRef = useRef(alarms.length);
  alarmsLengthRef.current = alarms.length;
  const handleScroll = useCallback((e) => {
    const now = Date.now();

    if (now - lastScrollTime.current < SCROLL_THROTTLE_MS) return;
    lastScrollTime.current = now;
    
    if (isLoadingRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
    
    if (isNearBottom) {
      setVisibleCount(prev => {
        if (prev >= alarmsLengthRef.current) return prev;
        isLoadingRef.current = true;
        setIsLoadingMore(true);
        requestAnimationFrame(() => {
          isLoadingRef.current = false;
          setIsLoadingMore(false);
        });
        
        return Math.min(prev + LOAD_MORE_COUNT, alarmsLengthRef.current);
      });
    }
  }, []);

  const visibleAlarms = useMemo(() => {
    if (!Array.isArray(alarms)) return [];
    return alarms.slice(0, visibleCount);
  }, [alarms, visibleCount]);

  if (!Array.isArray(alarms) || alarms.length === 0) return null;

  const hiddenCount = alarms.length - visibleAlarms.length;

  return (
    <div 
      onScroll={handleScroll}
      className="absolute top-20 right-4 z-50 flex flex-col gap-2 w-80 max-h-[calc(100vh-150px)] overflow-y-auto custom-scrollbar"
      role="region"
      aria-label={`Alarm Panel - ${alarms.length} alarm, ${visibleAlarms.length} is showing`}
      aria-live="polite"
    >
      {visibleAlarms.map((alarm, index) => (
        <AlarmCard
          key={getKey(alarm)}
          alarm={alarm}
          onAcknowledge={onAcknowledge}
          index={index}
        />
      ))}
      
      {hiddenCount > 0 && (
        <div 
          className={`text-center py-2 text-xs bg-gray-800/50 rounded-lg border border-gray-700 transition-colors ${
            isLoadingMore ? 'text-blue-400 border-blue-700' : 'text-gray-400'
          }`}
          role="status"
        >
          {isLoadingMore ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Loading...
            </span>
          ) : (
            <span>↓ {hiddenCount} more alarm{hiddenCount > 1 ? 's' : ''} — scroll to load</span>
          )}
        </div>
      )}
      
      {hiddenCount === 0 && alarms.length > INITIAL_VISIBLE_ALARMS && (
        <div className="text-center py-1 text-[10px] text-gray-500">
          All {alarms.length} alarms loaded
        </div>
      )}
    </div>
  );
}

export default memo(AlarmPanel);

