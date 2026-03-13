import React, { useState, useMemo, memo, useRef, useCallback, useEffect } from 'react';
import { useUiTranslation } from '../i18n/useUiTranslation';
import { toIntlLocale } from '../i18n/locale';
import { localizeDetectionClassName } from '../utils/detectionLabels';

const Icon = memo(({ path, className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
  </svg>
));

const THREAT_COLORS = {
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500'
};

const getThreatInfo = (cls, accuracy) => {
  const c = cls?.toLowerCase() || '';
  let level = Number(accuracy);
  if (Number.isFinite(level)) {
    if (level > 0 && level <= 1) level *= 100;
    level = Math.max(0, Math.min(100, level));
  } else {
    level = 0;
  }
  if (c === 'person') return { level, type: 'red', color: '#ef4444' };
  if (['car', 'truck', 'motorcycle', 'bicycle', 'bus', 'horse', 'camel'].includes(c)) return { level, type: 'yellow', color: '#eab308' };
  return { level, type: 'green', color: '#22c55e' };
};

const CLASS_OPTIONS = ['all', 'person', 'car', 'truck', 'motorcycle', 'bicycle', 'bus', 'horse', 'camel'];
const THREAT_OPTIONS = ['all', 'high', 'medium', 'low'];

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function DetectionHistory({ detections = [], onClose, onViewContext, onFlyToDetection }) {
  const { t, i18n } = useUiTranslation(['detectionHistory']);
  const locale = toIntlLocale(i18n.resolvedLanguage);
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [startDate, setStartDate] = useState(formatDateForInput(weekAgo));
  const [endDate, setEndDate] = useState(formatDateForInput(today));
  const [classFilter, setClassFilter] = useState('all');
  const [threatFilter, setThreatFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [position, setPosition] = useState({ x: null, y: null });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Calculate bounded position helper
  const calculateBoundedPosition = useCallback((clientX, clientY) => {
    const newX = clientX - dragOffset.current.x;
    const newY = clientY - dragOffset.current.y;
    const maxX = window.innerWidth - (dragRef.current?.offsetWidth || 320);
    const maxY = window.innerHeight - (dragRef.current?.offsetHeight || 300);
    return {
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    };
  }, []);

  // Mouse drag handlers
  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    const rect = dragRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    setIsDragging(true);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    setPosition(calculateBoundedPosition(e.clientX, e.clientY));
  }, [isDragging, calculateBoundedPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch drag handlers for mobile/tablet
  const handleTouchStart = useCallback((e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    const touch = e.touches[0];
    const rect = dragRef.current?.getBoundingClientRect();
    if (!rect || !touch) return;
    dragOffset.current = {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    };
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault(); // Prevent scroll while dragging
    setPosition(calculateBoundedPosition(touch.clientX, touch.clientY));
  }, [isDragging, calculateBoundedPosition]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Touch event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.addEventListener('touchcancel', handleTouchEnd);
      return () => {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('touchcancel', handleTouchEnd);
      };
    }
  }, [isDragging, handleTouchMove, handleTouchEnd]);

  const filteredDetections = useMemo(() => {
    const start = startDate ? new Date(startDate + 'T00:00:00') : null;
    const end = endDate ? new Date(endDate + 'T23:59:59') : null;
    const toLowerSafe = (value) => String(value ?? '').toLowerCase();

    return detections.filter(d => {
      if (start || end) {
        const dt = new Date(d.captured_time || d.detection_time);
        if (start && dt < start) return false;
        if (end && dt > end) return false;
      }

      if (classFilter !== 'all') {
        if (toLowerSafe(d.class) !== toLowerSafe(classFilter)) return false;
      }

      if (threatFilter !== 'all') {
        const threat = getThreatInfo(d.class, d.accuracy);
        if (threatFilter === 'high' && threat.type !== 'red') return false;
        if (threatFilter === 'medium' && threat.type !== 'yellow') return false;
        if (threatFilter === 'low' && threat.type !== 'green') return false;
      }

      if (searchTerm) {
        const term = toLowerSafe(searchTerm);
        const matches =
          toLowerSafe(d.class).includes(term) ||
          toLowerSafe(d.crop_id).includes(term) ||
          toLowerSafe(d.device_id).includes(term);
        if (!matches) return false;
      }

      return true;
    });
  }, [detections, startDate, endDate, classFilter, threatFilter, searchTerm]);

  const groupedByDate = useMemo(() => {
    const groups = {};
    filteredDetections.forEach(d => {
      const dt = new Date(d.captured_time || d.detection_time);
      const key = dt.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return groups;
  }, [filteredDetections, locale]);

  const dateKeys = Object.keys(groupedByDate);
  
  // Position and transition styles
  const positionStyle = position.x !== null 
    ? { 
        left: position.x, 
        top: position.y, 
        right: 'auto', 
        bottom: 'auto',
        // Smooth movement when not dragging, instant when dragging
        transition: isDragging ? 'none' : 'left 0.1s ease-out, top 0.1s ease-out'
      }
    : {};

  return (
    <div 
      ref={dragRef}
      className={`${position.x !== null ? 'fixed' : 'absolute bottom-24 right-4 sm:right-6'} z-[100] w-[calc(100vw-2rem)] sm:w-[400px] md:w-[480px] max-h-[60vh] sm:max-h-[70vh] bg-[#0a0a0a]/95 backdrop-blur-md border border-gray-800 rounded-xl shadow-2xl shadow-black/60 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200`}
      style={positionStyle}
    >
      <div 
        className="h-11 flex items-center justify-between px-3 sm:px-4 border-b border-gray-800 flex-shrink-0 cursor-move select-none touch-none"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div className="flex items-center gap-2">
          <Icon path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" className="w-4 h-4 text-cyan-400" />
          <span className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-wider">{t('detectionHistory.title')}</span>
          <span className="hidden sm:inline text-[9px] text-gray-600 ml-1">• {t('detectionHistory.dragToMove')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] sm:text-[10px] text-gray-500 font-mono">{filteredDetections.length}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <Icon path="M6 18L18 6M6 6l12 12" className="w-4 h-4" />
          </button>
        </div>
      </div>
     
      <div className="p-2 sm:p-3 border-b border-gray-800/50 space-y-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex-1">
            <label className="block text-[8px] sm:text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">{t('detectionHistory.from')}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-[11px] text-white font-mono focus:border-cyan-800 focus:outline-none [color-scheme:dark]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[8px] sm:text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">{t('detectionHistory.to')}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-[11px] text-white font-mono focus:border-cyan-800 focus:outline-none [color-scheme:dark]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="w-[calc(50%-0.25rem)] sm:flex-1">
            <label className="block text-[8px] sm:text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">{t('detectionHistory.class')}</label>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-[11px] text-white focus:border-cyan-800 focus:outline-none appearance-none cursor-pointer"
            >
              {CLASS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'all' ? t('detectionHistory.all') : option}
                </option>
              ))}
            </select>
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:flex-1">
            <label className="block text-[8px] sm:text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">{t('detectionHistory.threat')}</label>
            <select
              value={threatFilter}
              onChange={(e) => setThreatFilter(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-[11px] text-white focus:border-cyan-800 focus:outline-none appearance-none cursor-pointer"
            >
              {THREAT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'all'
                    ? t('detectionHistory.all')
                    : option === 'high'
                      ? t('detectionHistory.highRed')
                      : option === 'medium'
                        ? t('detectionHistory.mediumYellow')
                        : t('detectionHistory.lowGreen')}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:flex-1">
            <label className="block text-[8px] sm:text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">{t('detectionHistory.search')}</label>
            <input
              type="text"
              placeholder={t('detectionHistory.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-[11px] text-white placeholder-gray-600 focus:border-cyan-800 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredDetections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-600">
            <Icon path="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" className="w-8 h-8 mb-2" />
            <span className="text-xs">{t('detectionHistory.noDetectionsFound')}</span>
          </div>
        ) : (
          dateKeys.map(dateKey => (
            <div key={dateKey}>
              <div className="sticky top-0 bg-[#0a0a0a]/95 backdrop-blur px-3 py-1.5 border-b border-gray-800/50">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{dateKey}</span>
                <span className="text-[9px] text-gray-600 ml-2">({groupedByDate[dateKey].length})</span>
              </div>
              {groupedByDate[dateKey].map(crop => (
                <HistoryRow
                  key={crop.crop_id}
                  crop={crop}
                  onViewContext={onViewContext}
                  onFlyTo={onFlyToDetection}
                  t={t}
                  locale={locale}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
const HistoryRow = memo(({ crop, onViewContext, onFlyTo, t, locale }) => {
  const threat = getThreatInfo(crop.class, crop.accuracy);
  const time = new Date(crop.captured_time || crop.detection_time).toLocaleTimeString(locale);
  const localizedClass = localizeDetectionClassName(crop.class, t);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-900/60 cursor-pointer transition-colors border-b border-gray-800/30 group"
      onClick={() => onViewContext?.(crop)}
    >
      <div className="w-10 h-10 rounded overflow-hidden bg-gray-900 flex-shrink-0 border border-gray-800">
        <img
          src={`/api/image/crop/${crop.crop_id}`}
          className="w-full h-full object-cover"
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${THREAT_COLORS[threat.type]}`} />
          <span className="text-[11px] font-semibold text-white uppercase">{localizedClass}</span>
          <span className="text-[9px] text-gray-500 font-mono">{time}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] text-gray-500 font-mono truncate">{crop.device_id || '—'}</span>
          {crop.location?.latitude && (
            <span className="text-[8px] text-cyan-600 font-mono">
              {crop.location.latitude.toFixed(4)}, {crop.location.longitude.toFixed(4)}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-px flex-shrink-0">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={`w-1 h-2.5 rounded-sm ${i < Math.ceil(threat.level / 20) ? THREAT_COLORS[threat.type] : 'bg-gray-800/50'}`}
          />
        ))}
      </div>

      {crop.location?.latitude && (
        <button
          onClick={(e) => { e.stopPropagation(); onFlyTo?.(crop); }}
          className="p-1 rounded text-gray-600 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-all"
          title={t('detectionHistory.flyToLocation')}
        >
          <Icon path="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
});
