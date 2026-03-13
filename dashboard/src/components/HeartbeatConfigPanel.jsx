import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';

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

function formatTs(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function normalizeOnlineStatus(onlineStatus, deviceStatus) {
  if (onlineStatus && onlineStatus !== 'unknown') return onlineStatus;
  if (deviceStatus === 'online') return 'online';
  if (deviceStatus === 'offline' || deviceStatus === 'error') return 'offline';
  return 'unknown';
}

export default function HeartbeatConfigPanel({ deviceId, deviceStatus, isActive = true }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [enabled, setEnabled] = useState(true);
  const [interval, setInterval_] = useState(30);
  const [threshold, setThreshold] = useState(90);
  const [jitter, setJitter] = useState(3);

  const [configVersion, setConfigVersion] = useState(0);
  const [ackStatus, setAckStatus] = useState('pending');
  const [lastSentAt, setLastSentAt] = useState(null);
  const [lastAckAt, setLastAckAt] = useState(null);
  const [ackErrorCode, setAckErrorCode] = useState(null);
  const [ackErrorMessage, setAckErrorMessage] = useState(null);
  const [onlineStatus, setOnlineStatus] = useState('unknown');
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(null);

  const lastLoadedDeviceRef = useRef(null);

  const applyStatus = useCallback((data) => {
    setConfigVersion(data.config_version ?? 0);
    setAckStatus(data.last_ack_status ?? 'pending');
    setLastSentAt(data.last_config_sent_at);
    setLastAckAt(data.last_config_ack_at);
    setAckErrorCode(data.last_ack_error_code);
    setAckErrorMessage(data.last_ack_error_message);
    setOnlineStatus(data.online_status ?? 'unknown');
    setLastHeartbeatAt(data.last_heartbeat_at);
  }, []);

  const applyEditableFields = useCallback((data) => {
    setEnabled(data.enabled ?? true);
    setInterval_(data.heartbeat_interval_s ?? 30);
    setThreshold(data.offline_threshold_s ?? 90);
    setJitter(data.jitter_s ?? 3);
  }, []);

  const loadInitial = useCallback(async () => {
    if (!deviceId || !isActive) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.getHeartbeatConfig(deviceId);
      if (response?.success && response.data) {
        applyEditableFields(response.data);
        applyStatus(response.data);
        lastLoadedDeviceRef.current = deviceId;
      } else {
        setError('Failed to load heartbeat config');
      }
    } catch (err) {
      setError(err?.message || 'Failed to load heartbeat config');
    } finally {
      setLoading(false);
    }
  }, [applyEditableFields, applyStatus, deviceId, isActive]);

  const pollStatus = useCallback(async () => {
    if (!deviceId || !isActive) return;

    try {
      const response = await api.getHeartbeatConfig(deviceId);
      if (response?.success && response.data) {
        applyStatus(response.data);
      }
    } catch {
      // Silent refresh keeps form edits intact.
    }
  }, [applyStatus, deviceId, isActive]);

  useEffect(() => {
    if (!deviceId) {
      setLoading(false);
      lastLoadedDeviceRef.current = null;
      return;
    }

    if (!isActive) return;

    if (lastLoadedDeviceRef.current !== deviceId) {
      setSuccessMsg('');
      loadInitial();
      return;
    }

    setLoading(false);
    pollStatus();
  }, [deviceId, isActive, loadInitial, pollStatus]);

  useEffect(() => {
    if (!deviceId || !isActive) return undefined;

    const id = window.setInterval(pollStatus, 3000);
    return () => window.clearInterval(id);
  }, [deviceId, isActive, pollStatus]);

  useEffect(() => {
    if (!deviceId || !isActive) return undefined;

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
        } catch {
          // Ignore malformed websocket payloads.
        }
      };
    } catch {
      // Websocket unavailable; polling continues.
    }

    return () => {
      if (ws) ws.close();
    };
  }, [deviceId, isActive, pollStatus]);

  const handleSave = useCallback(async () => {
    setError('');
    setSuccessMsg('');

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
    } catch (err) {
      setError(err?.data?.detail || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [configVersion, deviceId, enabled, interval, jitter, threshold]);

  if (!deviceId) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
        Invalid device selection for heartbeat config.
      </div>
    );
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Loading heartbeat config...</div>;
  }

  const displayOnlineStatus = normalizeOnlineStatus(onlineStatus, deviceStatus);
  const statusColor = STATUS_COLORS[ackStatus] || 'text-gray-400';
  const statusBg = STATUS_BG[ackStatus] || 'bg-gray-800 border-gray-700';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-900 bg-gray-950 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500">Heartbeat Config</div>
            <div className="mt-1 text-sm font-bold text-white">{deviceId}</div>
          </div>
          <span className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border uppercase ${
            displayOnlineStatus === 'online'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : displayOnlineStatus === 'offline'
                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                : 'bg-gray-800 text-gray-500 border-gray-700'
          }`}>
            {displayOnlineStatus}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-gray-900 bg-gray-950 p-3 space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Settings</div>

        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-300">Enabled</label>
          <button
            type="button"
            onClick={() => setEnabled((value) => !value)}
            className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
              enabled ? 'bg-emerald-500' : 'bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-300 block mb-1">Heartbeat Interval (s)</label>
            <input
              type="number"
              min={5}
              max={3600}
              value={interval}
              onChange={(e) => setInterval_(parseInt(e.target.value, 10) || 30)}
              className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-gray-600 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-300 block mb-1">Offline Threshold (s)</label>
            <input
              type="number"
              min={10}
              max={7200}
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 90)}
              className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-gray-600 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-300 block mb-1">Jitter (s)</label>
            <input
              type="number"
              min={0}
              max={60}
              value={jitter}
              onChange={(e) => setJitter(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-gray-600 focus:outline-none transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-900 bg-gray-950 p-3 space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Status</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Last Config Sent</span>
            <span className="text-gray-300 font-mono text-right">{formatTs(lastSentAt)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Last Config ACK</span>
            <span className="text-gray-300 font-mono text-right">{formatTs(lastAckAt)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Last Heartbeat</span>
            <span className="text-gray-300 font-mono text-right">{formatTs(lastHeartbeatAt)}</span>
          </div>
        </div>

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

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save & Publish'}
        </button>
      </div>
    </div>
  );
}
