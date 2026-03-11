import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

/**
 * HeartbeatConfigModal
 *
 * Popup modal shown when the heartbeat icon is clicked on a device card.
 * Loads current settings from the API, lets the user edit them, and saves
 * via PUT.  The ACK status section is read-only and auto-refreshes.
 */

const STATUS_COLORS = {
  applied: 'text-emerald-400',
  pending: 'text-yellow-400',
  failed: 'text-red-400',
  stale: 'text-orange-400',
};

const STATUS_BG = {
  applied: 'bg-emerald-500/10 border-emerald-500/30',
  pending: 'bg-yellow-500/10 border-yellow-500/30',
  failed: 'bg-red-500/10 border-red-500/30',
  stale: 'bg-orange-500/10 border-orange-500/30',
};

function formatTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function HeartbeatConfigModal({ deviceId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Editable fields
  const [enabled, setEnabled] = useState(true);
  const [interval, setInterval_] = useState(30);
  const [threshold, setThreshold] = useState(90);
  const [jitter, setJitter] = useState(3);

  // Read-only status
  const [configVersion, setConfigVersion] = useState(0);
  const [ackStatus, setAckStatus] = useState('pending');
  const [lastSentAt, setLastSentAt] = useState(null);
  const [lastAckAt, setLastAckAt] = useState(null);
  const [ackErrorCode, setAckErrorCode] = useState(null);
  const [ackErrorMessage, setAckErrorMessage] = useState(null);
  const [onlineStatus, setOnlineStatus] = useState('unknown');
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(null);

  // ── Load ────────────────────────────────────────────────

  // Helper: apply only the read-only status fields from API response
  const applyStatus = (d) => {
    setConfigVersion(d.config_version ?? 0);
    setAckStatus(d.last_ack_status ?? 'pending');
    setLastSentAt(d.last_config_sent_at);
    setLastAckAt(d.last_config_ack_at);
    setAckErrorCode(d.last_ack_error_code);
    setAckErrorMessage(d.last_ack_error_message);
    setOnlineStatus(d.online_status ?? 'unknown');
    setLastHeartbeatAt(d.last_heartbeat_at);
  };

  // Called ONCE on mount — loads edit fields + status
  const loadInitial = useCallback(async () => {
    try {
      const data = await api.getHeartbeatConfig(deviceId);
      if (data?.success && data.data) {
        const d = data.data;
        setEnabled(d.enabled ?? true);
        setInterval_(d.heartbeat_interval_s ?? 30);
        setThreshold(d.offline_threshold_s ?? 90);
        setJitter(d.jitter_s ?? 3);
        applyStatus(d);
      }
    } catch (e) {
      setError('Failed to load heartbeat config');
    } finally {
      setLoading(false);
    }
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called every 3 s + by WebSocket — NEVER touches edit fields
  const pollStatus = useCallback(async () => {
    try {
      const data = await api.getHeartbeatConfig(deviceId);
      if (data?.success && data.data) applyStatus(data.data);
    } catch { /* silent */ }
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadInitial();
    const id = window.setInterval(pollStatus, 3000);
    return () => window.clearInterval(id);
  }, [loadInitial, pollStatus]);

  // ── WebSocket (preferred) ──────────────────────────────

  useEffect(() => {
    let ws;
    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = import.meta.env.VITE_WS_URL
        ? import.meta.env.VITE_WS_URL.replace('/ws/detections', '')
        : `${wsProtocol}//${window.location.host}`;
      ws = new WebSocket(`${wsHost}/ws/heartbeat`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'heartbeat_update' && msg.data?.device_id === deviceId) {
            pollStatus();
          }
        } catch { /* ignore parse errors */ }
      };
    } catch { /* WebSocket not available, polling fallback is fine */ }

    return () => { if (ws) ws.close(); };
  }, [deviceId, pollStatus]);

  // ── Save ───────────────────────────────────────────────

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);

    // Client-side validation
    if (threshold < 2 * interval) {
      setError(`Offline threshold (${threshold}s) must be ≥ 2 × interval (${interval}s)`);
      return;
    }

    setSaving(true);
    try {
      const res = await api.updateHeartbeatConfig(deviceId, {
        enabled,
        heartbeat_interval_s: interval,
        offline_threshold_s: threshold,
        jitter_s: jitter,
      });
      if (res?.success) {
        setSuccessMsg(res.message || 'Config saved — waiting for device ACK');
        setAckStatus('pending');
        setConfigVersion(res.data?.config_version ?? configVersion + 1);
        setLastSentAt(res.data?.last_config_sent_at ?? new Date().toISOString());
        setAckErrorCode(null);
        setAckErrorMessage(null);
      } else {
        setError(res?.detail || res?.message || 'Save failed');
      }
    } catch (e) {
      setError(e?.data?.detail || e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────

  const statusColor = STATUS_COLORS[ackStatus] || 'text-gray-400';
  const statusBg = STATUS_BG[ackStatus] || 'bg-gray-800 border-gray-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">HEARTBEAT CONFIG</h2>
            <p className="text-xs text-gray-500 mt-0.5">{deviceId}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Online badge */}
            <span className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded ${
              onlineStatus === 'online'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : onlineStatus === 'offline'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                  : 'bg-gray-800 text-gray-500 border border-gray-700'
            }`}>
              {onlineStatus.toUpperCase()}
            </span>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-gray-500 text-xs">Loading…</div>
        ) : (
          <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
            {/* ── Editable settings ──────────────────── */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-gray-500 tracking-widest uppercase">Settings</h3>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-300">Enabled</label>
                <button
                  onClick={() => setEnabled(!enabled)}
                  className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                    enabled ? 'bg-emerald-500' : 'bg-gray-700'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    enabled ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {/* Interval */}
              <div>
                <label className="text-xs text-gray-300 block mb-1">Heartbeat Interval (s)</label>
                <input
                  type="number" min={5} max={3600} value={interval}
                  onChange={(e) => setInterval_(parseInt(e.target.value) || 30)}
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-gray-600 focus:outline-none transition-colors"
                />
              </div>

              {/* Offline threshold */}
              <div>
                <label className="text-xs text-gray-300 block mb-1">Offline Threshold (s)</label>
                <input
                  type="number" min={10} max={7200} value={threshold}
                  onChange={(e) => setThreshold(parseInt(e.target.value) || 90)}
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-gray-600 focus:outline-none transition-colors"
                />
              </div>

              {/* Jitter */}
              <div>
                <label className="text-xs text-gray-300 block mb-1">Jitter (s)</label>
                <input
                  type="number" min={0} max={60} value={jitter}
                  onChange={(e) => setJitter(parseInt(e.target.value) || 0)}
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-gray-600 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* ── Status (read-only) ─────────────────── */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-gray-500 tracking-widest uppercase">Status</h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black rounded-lg p-3 border border-gray-900">
                  <p className="text-[10px] text-gray-500 mb-1">Config Version</p>
                  <p className="text-sm font-bold text-white font-mono">{configVersion}</p>
                </div>
                <div className={`rounded-lg p-3 border ${statusBg}`}>
                  <p className="text-[10px] text-gray-500 mb-1">ACK Status</p>
                  <p className={`text-sm font-bold uppercase tracking-wide ${statusColor}`}>{ackStatus}</p>
                </div>
              </div>

              <div className="bg-black rounded-lg p-3 border border-gray-900 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Config Sent</span>
                  <span className="text-gray-300 font-mono">{formatTs(lastSentAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Config ACK</span>
                  <span className="text-gray-300 font-mono">{formatTs(lastAckAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Heartbeat</span>
                  <span className="text-gray-300 font-mono">{formatTs(lastHeartbeatAt)}</span>
                </div>
              </div>

              {/* Error display */}
              {ackStatus === 'failed' && (ackErrorCode || ackErrorMessage) && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 space-y-1">
                  {ackErrorCode && (
                    <p className="text-[10px] font-bold text-red-400 tracking-wider">{ackErrorCode}</p>
                  )}
                  {ackErrorMessage && (
                    <p className="text-xs text-red-300">{ackErrorMessage}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Messages ───────────────────────────── */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-xs text-emerald-400">
                {successMsg}
              </div>
            )}

            {/* ── Actions ────────────────────────────── */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 py-2.5 rounded-lg text-xs font-bold tracking-wide transition-all"
              >
                {saving ? 'SAVING…' : 'SAVE & PUBLISH'}
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 py-2.5 rounded-lg text-xs font-bold tracking-wide transition-all"
              >
                CLOSE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
