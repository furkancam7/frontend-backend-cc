import React, { useState, useMemo, useCallback, memo } from 'react';
import { getCategory } from './DetectionNotification';

const NotificationLog = ({ logs = [], onItemClick, handleClearLogs }) => {
  const [filter, setFilter] = useState('all');

  const onSafeClear = useCallback(() => {
    if (typeof window !== 'undefined' && handleClearLogs) {
      if (window.confirm("Are you sure you want to clear all notifications?")) {
        handleClearLogs();
      }
    }
  }, [handleClearLogs]);

  const toggleFilter = useCallback((key) => setFilter(prev => prev === key ? 'all' : key), []);
  const { filteredLogs, stats, categoryByClass } = useMemo(() => {
    const calculatedStats = { fire: 0, smoke: 0, unknown: 0 };
    const filtered = [];
    const catByClass = {};
    for (const log of logs) {
      const cls = String(log.class ?? 'unknown');
      if (!catByClass[cls]) {
        catByClass[cls] = getCategory(cls);
      }
      const category = catByClass[cls];
      const categoryKey = category.key || 'unknown';
      calculatedStats[categoryKey] = (calculatedStats[categoryKey] ?? 0) + 1;
      if (filter === 'all' || categoryKey === filter) {
        filtered.push(log);
      }
    }

    return { filteredLogs: filtered, stats: calculatedStats, categoryByClass: catByClass };
  }, [logs, filter]);

  const handleItemClick = useCallback((log) => {
    onItemClick?.(log);
  }, [onItemClick]);

  return (
    <div className="flex flex-col h-full bg-black text-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-950 rounded-lg flex items-center justify-center border border-gray-900">
            <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <div>
            <span className="font-bold text-xs uppercase tracking-wider text-white">Detection Notifications</span>
            <span className="ml-2 bg-gray-950 px-2 py-0.5 rounded text-[10px] text-gray-500 font-mono border border-gray-900">
              {logs.length}
            </span>
          </div>
        </div>
        <button
          onClick={onSafeClear}
          disabled={!logs.length}
          className="text-gray-600 hover:text-white bg-gray-950 hover:bg-gray-900 text-[10px] px-3 py-1.5 rounded-lg transition-all border border-gray-900 hover:border-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Clear all notifications"
        >
          Clear All
        </button>
      </div>

      {/* Filter Badges */}
      <div className="px-3 py-2 flex gap-1.5 border-b border-gray-900 shrink-0 overflow-x-auto bg-gray-950 scrollbar-none">
        <StatBadge
          label="Fire"
          count={stats.fire}
          color="text-red-500"
          active={filter === 'fire'}
          onClick={() => toggleFilter('fire')}
        />
        <StatBadge
          label="Smoke"
          count={stats.smoke}
          color="text-red-500"
          active={filter === 'smoke'}
          onClick={() => toggleFilter('smoke')}
        />
      </div>

      {/* Log Items */}
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-gray-900 bg-black">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] text-gray-700">
            <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <span className="text-xs text-gray-600">No detections logged</span>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <LogItem
              key={log.id || log.crop_id || log.track_id || log.detection_id || `${log.timestamp}-${log.device_id}-${log.class}`}
              log={log}
              category={categoryByClass[String(log.class ?? 'unknown')]}
              onItemClick={handleItemClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

const StatBadge = memo(({ label, count, color, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer
      ${active ? `${color} border-current/30 bg-current/10` : 'border-gray-900 text-gray-600 bg-black hover:bg-gray-900 hover:text-gray-400'}`}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-current' : 'bg-gray-700'}`} />
    {label}
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${active ? 'bg-current/20 text-white' : 'bg-gray-900 text-gray-500'}`}>
      {count}
    </span>
  </button>
));

const formatAccuracy = (acc) => {
  if (acc == null) return 'N/A';
  const val = Number(acc);
  if (isNaN(val)) return 'N/A';
  return `${(val > 1 ? val : val * 100).toFixed(1)}%`;
};

const LogItem = memo(({ log, category, onItemClick }) => {
  const timeAgo = getTimeAgo(log.timestamp);
  const [imgError, setImgError] = useState(false);
  const handleClick = useCallback(() => onItemClick(log), [onItemClick, log]);

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      className="flex items-center gap-3 p-3 mb-2 rounded-xl bg-gray-950 hover:bg-gray-900 cursor-pointer transition-all border border-gray-900 hover:border-gray-800 outline-none focus:ring-1 focus:ring-gray-700 overflow-hidden"
    >
      {/* Thumbnail */}
      <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-black flex items-center justify-center border border-gray-900" style={{ borderColor: `${category?.color}30` }}>
        {!imgError && log.crop_id ? (
          <img
            src={`/api/image/crop/${encodeURIComponent(log.crop_id)}`}
            alt={`${log.class} detection`}
            loading="lazy"
            className="w-full h-full object-cover animate-fade-in"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="opacity-50" style={{ color: category?.color }}>
            {category?.icon}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[11px] font-semibold uppercase truncate max-w-[80px]" style={{ color: category?.color }}>
            {category?.name || log.class}
          </span>
          {(category?.key === 'fire' || category?.key === 'smoke') && (
            <span className="bg-red-500 text-white text-[8px] px-1 rounded font-bold shrink-0">!</span>
          )}
        </div>
        <div className="text-xs text-zinc-200 truncate">
          {log.class} <span className="text-zinc-500 mx-1">-</span> {formatAccuracy(log.accuracy)}
        </div>
        <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-0.5 truncate">
          <span className={`truncate ${log.device_id ? 'text-cyan-400' : 'text-zinc-500'}`}>
            {log.device_id || 'Unknown'}
          </span>
          <span className="shrink-0">•</span>
          <span className="shrink-0">{timeAgo}</span>
        </div>
      </div>

      <svg className="w-4 h-4 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
});

const getTimeAgo = (timestamp) => {
  if (!timestamp) return 'Unknown';

  try {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    if (isNaN(time)) return 'Invalid';
    const diff = Math.max(0, Math.floor((now - time) / 1000));
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(time).toLocaleDateString();
  } catch {
    return 'Unknown';
  }
};

export default NotificationLog;
