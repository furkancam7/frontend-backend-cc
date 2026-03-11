import React, { memo, useMemo, useCallback, useState } from 'react';

/* ── Icons ── */
const FireIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 23c-3.6 0-7-2.4-7-7 0-3.1 2.1-5.7 4-7.6.3-.3.8-.1.8.4v2.5c0 .3.4.5.6.3 2.3-2.1 4-5.2 4.6-8.3.1-.4.5-.5.8-.2C18 5.3 19 9 19 12c0 5.5-3.2 11-7 11z" />
  </svg>
);
const SmokeIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
  </svg>
);
const CameraIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

/* ── Helpers ── */
const formatTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
};

const formatDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
  } catch { return ''; }
};

const relativeTime = (iso) => {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

/**
 * Derive badge from boxes (which have class_name strings) or fallback to classes array.
 * DB stores classes as integer IDs ([0,1,...]) so we primarily use boxes.
 */
const getClassBadge = (classes, boxes) => {
  // Prefer boxes since they carry string class_name
  const names = (boxes || []).map(b => (b.class_name || '').toLowerCase()).filter(Boolean);
  // If no box names, try classes (might be strings in some payloads)
  const strClasses = (classes || [])
    .filter(c => typeof c === 'string')
    .map(c => c.toLowerCase());
  const all = [...names, ...strClasses];

  if (all.length === 0) return null;
  const has = (word) => all.some(c => c.includes(word));
  if (has('fire') || has('flame')) return { label: 'FIRE', color: 'text-red-400 bg-red-900/40 border-red-500/50', Icon: FireIcon };
  if (has('smoke') || has('duman')) return { label: 'SMOKE', color: 'text-yellow-400 bg-yellow-900/40 border-yellow-500/50', Icon: SmokeIcon };
  return { label: (all[0] || 'DET').toUpperCase(), color: 'text-cyan-400 bg-cyan-900/40 border-cyan-500/50', Icon: CameraIcon };
};

/* ── Single Event Row ── */
const EventRow = memo(({ event, isSelected, onSelect }) => {
  const badge = useMemo(() => getClassBadge(event.classes, event.boxes), [event.classes, event.boxes]);
  const hasDetection = event.has_detection;

  return (
    <button
      onClick={() => onSelect(event.event_id)}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-gray-800/60 transition-all group
        ${isSelected ? 'bg-gray-800/80 border-l-2 border-l-cyan-500' : 'hover:bg-gray-800/40 border-l-2 border-l-transparent'}
        ${hasDetection ? '' : 'opacity-60'}`}
    >
      {/* Status indicator */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hasDetection ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`} />

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {badge && (
            <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.color}`}>
              <badge.Icon />
              {badge.label}
            </span>
          )}
          {!hasDetection && (
            <span className="text-[9px] text-gray-500 font-mono">NO DET</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
          <span className="truncate">{event.device_id}</span>
          <span className="text-gray-600">·</span>
          <span>{event.camera_id || 'EO'}</span>
        </div>
      </div>

      {/* Confidence + Time */}
      <div className="flex-shrink-0 text-right">
        {hasDetection && (
          <div className={`text-xs font-bold tabular-nums ${event.max_confidence > 0.7 ? 'text-red-400' : 'text-yellow-400'}`}>
            {(event.max_confidence * 100).toFixed(0)}%
          </div>
        )}
        <div className="text-[9px] text-gray-500 font-mono" title={event.detected_at}>
          {relativeTime(event.detected_at)}
        </div>
      </div>
    </button>
  );
});
EventRow.displayName = 'EventRow';

/* ── Event Detail Panel ── */
const EventDetailPanel = memo(({ detail, media, onBack }) => {
  if (!detail) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500" />
      </div>
    );
  }

  const badge = getClassBadge(detail.classes, detail.boxes);
  const boxes = detail.boxes || [];
  const speed = detail.inference_json?.speed || {};

  return (
    <div className="p-3 space-y-3 animate-in fade-in slide-in-from-right-2 duration-200">
      {/* Back button + header */}
      <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white transition-colors mb-1">
        <span>←</span> <span className="uppercase tracking-wider font-bold">Back</span>
      </button>

      <div className="bg-gray-900/60 rounded-lg border border-gray-800 p-3">
        <div className="flex items-center justify-between mb-2">
          {badge && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border ${badge.color}`}>
              <badge.Icon />
              {badge.label}
            </span>
          )}
          <span className={`text-sm font-bold tabular-nums ${detail.max_confidence > 0.7 ? 'text-red-400' : detail.has_detection ? 'text-yellow-400' : 'text-gray-500'}`}>
            {detail.has_detection ? `${(detail.max_confidence * 100).toFixed(1)}%` : 'No Detection'}
          </span>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          <div>
            <span className="text-gray-500 block">Device</span>
            <span className="text-gray-300">{detail.device_id}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Camera</span>
            <span className="text-gray-300">{detail.camera_id || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Model</span>
            <span className="text-gray-300">{detail.model || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Detected</span>
            <span className="text-gray-300">{formatTime(detail.detected_at)}</span>
          </div>
        </div>
      </div>

      {/* Bounding boxes */}
      {boxes.length > 0 && (
        <div className="bg-gray-900/60 rounded-lg border border-gray-800 p-3">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Bounding Boxes ({boxes.length})</h4>
          <div className="space-y-1.5">
            {boxes.map((box, i) => (
              <div key={i} className="flex items-center justify-between bg-black/40 rounded px-2 py-1.5 text-[10px] font-mono">
                <span className={`font-bold ${box.class_name?.toLowerCase().includes('fire') ? 'text-red-400' : 'text-yellow-400'}`}>
                  {box.class_name || `class_${box.class_id}`}
                </span>
                <span className="text-gray-400">
                  {(box.confidence * 100).toFixed(1)}% · [{Math.round(box.x)},{Math.round(box.y)},{Math.round(box.w)},{Math.round(box.h)}]
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inference speed */}
      {(speed.preprocess || speed.inference || speed.postprocess) && (
        <div className="bg-gray-900/60 rounded-lg border border-gray-800 p-3">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Inference Speed</h4>
          <div className="flex gap-3 text-[10px] font-mono">
            {speed.preprocess != null && <span className="text-gray-300">Pre: <b className="text-cyan-400">{speed.preprocess.toFixed(1)}ms</b></span>}
            {speed.inference != null && <span className="text-gray-300">Inf: <b className="text-cyan-400">{speed.inference.toFixed(1)}ms</b></span>}
            {speed.postprocess != null && <span className="text-gray-300">Post: <b className="text-cyan-400">{speed.postprocess.toFixed(1)}ms</b></span>}
          </div>
        </div>
      )}

      {/* Media artefacts */}
      {media && media.length > 0 && (
        <div className="bg-gray-900/60 rounded-lg border border-gray-800 p-3">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Media ({media.length})</h4>
          <div className="space-y-1.5">
            {media.map((m, i) => (
              <div key={i} className="flex items-center justify-between bg-black/40 rounded px-2 py-1.5 text-[10px] font-mono">
                <span className="text-gray-300 truncate max-w-[160px]">{m.filename}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">{(m.size_bytes / 1024).toFixed(1)}KB</span>
                  {m.is_placeholder && <span className="text-[8px] text-yellow-500 bg-yellow-900/30 px-1 rounded">MOCK</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
EventDetailPanel.displayName = 'EventDetailPanel';

/* ── Main Panel ── */
export default function FireDetectionPanel({ events, loading, stats, wsConnected, selectedEvent, eventDetail, eventMedia, onSelectEvent, onClearSelection }) {
  const [filter, setFilter] = useState('all'); // all | detections

  const filteredEvents = useMemo(() => {
    if (filter === 'detections') return events.filter(e => e.has_detection);
    return events;
  }, [events, filter]);

  const handleSelect = useCallback((eventId) => {
    if (selectedEvent === eventId) {
      onClearSelection();
    } else {
      onSelectEvent(eventId);
    }
  }, [selectedEvent, onSelectEvent, onClearSelection]);

  // Detail view
  if (selectedEvent) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <EventDetailPanel detail={eventDetail} media={eventMedia} onBack={onClearSelection} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats bar */}
      <div className="px-3 py-2 border-b border-gray-800 bg-[#0d0d0d] flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-600'}`} />
            <span className="text-[9px] text-gray-400 font-mono uppercase tracking-wider">
              Camera Pipeline
            </span>
          </div>
          {stats.latestTime && (
            <span className="text-[9px] text-gray-500 font-mono">
              {formatDate(stats.latestTime)} {formatTime(stats.latestTime)}
            </span>
          )}
        </div>

        <div className="flex gap-3 text-[10px] font-mono">
          <span className="text-gray-400">
            Events: <b className="text-white">{stats.total}</b>
          </span>
          <span className="text-gray-400">
            Alerts: <b className="text-red-400">{stats.withDetection}</b>
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors
            ${filter === 'all' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
        >
          All ({events.length})
        </button>
        <button
          onClick={() => setFilter('detections')}
          className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors
            ${filter === 'detections' ? 'text-red-400 border-b-2 border-red-400' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Alerts ({stats.withDetection})
        </button>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <CameraIcon />
            <span className="text-[10px] mt-2 font-mono">
              {filter === 'detections' ? 'No fire/smoke alerts' : 'No camera events yet'}
            </span>
          </div>
        ) : (
          filteredEvents.map(event => (
            <EventRow
              key={event.event_id}
              event={event}
              isSelected={selectedEvent === event.event_id}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
