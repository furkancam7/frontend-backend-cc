import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import {
  buildInferencePatch,
  formatStatusLabel,
  INFERENCE_FIELD_GROUPS,
  INFERENCE_FIELD_META,
  INFERENCE_STATUS_CLASS,
  toInferenceFormState,
} from '../constants/inferenceConfig';

function formatTs(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatDurationSeconds(value) {
  if (!Number.isFinite(value) || value == null) return '—';
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function normalizeDeviceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function makeRequestId(deviceId) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `req-${deviceId}-${stamp}-${suffix}`;
}

function AckStatusCard({ summary }) {
  const current = summary?.current || {};
  const pendingRequest = summary?.pending_request;
  const displayStatus = pendingRequest ? 'pending' : (current.status || 'none');
  const statusClass = INFERENCE_STATUS_CLASS[displayStatus] || INFERENCE_STATUS_CLASS.none;
  const changedKeys = pendingRequest?.changed_keys_json || [];
  const errors = current.errors || [];
  const container = current.container || {};

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${statusClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Config Status</div>
          <div className="text-sm font-bold">{formatStatusLabel(displayStatus)}</div>
        </div>
        <div className="text-right text-[11px] font-mono">
          <div>version: {pendingRequest?.config_version ?? current.config_version ?? '—'}</div>
          <div>request: {pendingRequest?.request_id ?? current.request_id ?? '—'}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-200">
        <div className="rounded border border-gray-800 bg-black/30 px-2 py-1.5">
          applied_at: {formatTs(current.applied_at)}
        </div>
        <div className="rounded border border-gray-800 bg-black/30 px-2 py-1.5">
          source: {current.source || 'none'}
        </div>
      </div>
      <div className="text-[11px] text-gray-300">
        container: {container.name || '—'} / {container.state || '—'}
      </div>
      {changedKeys.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {changedKeys.map(key => (
            <span key={key} className="px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-200">
              {key}
            </span>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-200 whitespace-pre-wrap break-words">
          {errors.map(err => (typeof err === 'string' ? err : JSON.stringify(err))).join('\n')}
        </div>
      )}
    </div>
  );
}

function TransportDiagnosticsCard({ transport }) {
  const publishEvent = transport?.last_publish_event;
  const publishPayload = publishEvent?.payload_json || {};
  const ackEvent = transport?.last_ack_event;
  const publishConfirmed = publishEvent?.event_type === 'inference_config_publish_confirmed';
  const publishFailed = publishEvent?.event_type === 'inference_config_publish_failed';

  return (
    <div className="rounded-lg border border-gray-900 bg-gray-950 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">Transport Diagnostics</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-gray-200">
        <div className="rounded border border-gray-800 bg-black/30 px-2 py-1.5">
          broker: {transport?.broker_host || '—'}:{transport?.broker_port ?? '—'}
        </div>
        <div className="rounded border border-gray-800 bg-black/30 px-2 py-1.5">
          publish: {publishFailed ? 'failed' : publishConfirmed ? 'confirmed' : 'not observed'}
        </div>
        <div className="rounded border border-gray-800 bg-black/30 px-2 py-1.5">
          qos/retain: {transport?.qos ?? '—'} / {String(transport?.retain ?? false)}
        </div>
        <div className="rounded border border-gray-800 bg-black/30 px-2 py-1.5">
          pending age: {formatDurationSeconds(transport?.pending_age_s)}
        </div>
      </div>
      <div className="space-y-1 text-[11px] text-gray-300">
        <div>
          device: <span className="font-mono break-all">{publishPayload?.device_id || '—'}</span>
        </div>
        <div>
          request: <span className="font-mono break-all">{publishPayload?.request_id || '—'}</span>
        </div>
        <div>
          desired: <span className="font-mono break-all">{transport?.desired_topic || '—'}</span>
        </div>
        <div>
          applied: <span className="font-mono break-all">{transport?.applied_topic || '—'}</span>
        </div>
        <div>
          last publish: {formatTs(publishEvent?.event_at)}{publishPayload?.mid != null ? ` | mid: ${publishPayload.mid}` : ''}
        </div>
        <div>
          ack observed: {ackEvent?.ack_received_at ? formatTs(ackEvent.ack_received_at) : 'no'}
        </div>
      </div>
      {publishPayload?.error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-200 whitespace-pre-wrap break-words">
          {publishPayload.error}
        </div>
      )}
    </div>
  );
}

export function InferenceHistoryList({ history = [], maxHeightClass = 'max-h-64' }) {
  return (
    <div className="space-y-2">
      {history.map(row => (
        <div key={row.id || row.request_id} className="rounded-xl border border-gray-800 bg-black/40 px-3 py-3 text-[11px] text-gray-300">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">Request</div>
              <div className={`mt-1 break-all font-mono ${maxHeightClass ? '' : ''}`}>{row.request_id}</div>
            </div>
            <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-200">
              {formatStatusLabel(row.ack_status || row.request_state)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Version</div>
              <div className="mt-1 text-sm font-semibold text-white font-mono">{row.config_version ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Created</div>
              <div className="mt-1 text-xs text-gray-200 font-mono">{formatTs(row.created_at)}</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Applied</div>
              <div className="mt-1 text-xs text-gray-200 font-mono">{formatTs(row.applied_at)}</div>
            </div>
          </div>
        </div>
      ))}
      {history.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/60 px-4 py-8 text-center text-[12px] text-gray-500">
          No inference config history
        </div>
      )}
    </div>
  );
}

export default function InferenceConfigPanel({
  deviceId,
  deviceStatus,
  mqttOk,
  isActive = true,
  refreshToken = 0,
  showHistorySection = true,
}) {
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState(null);
  const [formState, setFormState] = useState(() => toInferenceFormState());
  const [fieldErrors, setFieldErrors] = useState({});
  const lastDeviceRef = useRef(null);

  const loadConfig = useCallback(async ({ silent = false, resetForm = false } = {}) => {
    if (!normalizedDeviceId || !isActive) return;
    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const res = await api.getInferenceConfig(normalizedDeviceId, { limit: 20 });
      const data = res?.data || null;
      setSummary(data);

      if (resetForm || lastDeviceRef.current !== normalizedDeviceId) {
        setFormState(toInferenceFormState(data?.current?.settings || {}));
        setFieldErrors({});
        lastDeviceRef.current = normalizedDeviceId;
      }
    } catch (err) {
      if (!silent) {
        setError(err?.message || 'Failed to load inference config');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [normalizedDeviceId, isActive]);

  useEffect(() => {
    if (!normalizedDeviceId || !isActive) {
      setLoading(false);
      return;
    }
  }, [normalizedDeviceId, isActive]);

  useEffect(() => {
    if (!normalizedDeviceId || !isActive) return;
    loadConfig({ resetForm: true });
  }, [normalizedDeviceId, isActive, loadConfig]);

  useEffect(() => {
    if (!normalizedDeviceId || !isActive || refreshToken === 0) return;
    loadConfig({ silent: true });
  }, [normalizedDeviceId, isActive, refreshToken, loadConfig]);

  useEffect(() => {
    if (!normalizedDeviceId || !isActive || !summary?.pending_request) return undefined;
    const id = window.setInterval(() => loadConfig({ silent: true }), 3000);
    return () => window.clearInterval(id);
  }, [normalizedDeviceId, isActive, summary?.pending_request, loadConfig]);

  const baseSettings = summary?.current?.settings || {};
  const patchState = useMemo(
    () => buildInferencePatch(baseSettings, formState),
    [baseSettings, formState]
  );
  const activeStatus = summary?.pending_request ? 'pending' : (summary?.current?.status || 'none');
  const deviceCurrentStatus = summary?.device?.current_status || deviceStatus || 'offline';
  const mqttAvailable = summary?.device?.mqtt_ok ?? mqttOk;
  const isReachable = deviceCurrentStatus !== 'offline' && deviceCurrentStatus !== 'error' && mqttAvailable === true;
  const transport = summary?.transport || {};
  const lastPublishEvent = transport?.last_publish_event;
  const lastPublishPayload = lastPublishEvent?.payload_json || {};
  const publishConfirmed = lastPublishEvent?.event_type === 'inference_config_publish_confirmed';
  const publishFailed = lastPublishEvent?.event_type === 'inference_config_publish_failed';

  const handleFieldChange = useCallback((field, value) => {
    setFormState(prev => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [fieldErrors]);

  const handleReset = useCallback(() => {
    setFormState(toInferenceFormState(baseSettings));
    setFieldErrors({});
    setNotice('');
    setError('');
  }, [baseSettings]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    if (!normalizedDeviceId) {
      setError('Invalid device ID for inference publish');
      return;
    }

    if (!isReachable) {
      setError('Device offline / MQTT unavailable');
      return;
    }

    if (summary?.pending_request) {
      setError('Another inference config request is still pending');
      return;
    }

    if (patchState.changedKeys.length === 0) {
      setError('No settings changes to publish');
      return;
    }

    if (Object.keys(patchState.errors).length > 0) {
      setFieldErrors(patchState.errors);
      setError('Please fix validation errors before publishing');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const payload = {
        request_id: makeRequestId(normalizedDeviceId),
        config_version: summary?.next_config_version || 1,
        settings: patchState.patch,
      };
      const res = await api.publishInferenceConfig(normalizedDeviceId, payload);
      setNotice(res?.message || 'Inference config published');
      await loadConfig({ silent: true });
    } catch (err) {
      setError(err?.message || 'Inference config publish failed');
    } finally {
      setSaving(false);
    }
  }, [normalizedDeviceId, isReachable, summary, patchState, loadConfig]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Loading inference config...</div>;
  }

  return (
    <div className="space-y-3">
      {!normalizedDeviceId && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          Invalid device selection. Inference publish requires a canonical device ID string such as <span className="font-mono">TOWER-001</span>.
        </div>
      )}

      {!isReachable && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          Device offline / MQTT unavailable. Settings are read-only until the device becomes reachable.
        </div>
      )}

      {publishFailed && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          Backend could not confirm publish to broker.
          {lastPublishPayload?.error ? ` ${lastPublishPayload.error}` : ''}
        </div>
      )}

      {summary?.pending_request && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200">
          {publishConfirmed ? (
            <>
              Backend publish confirmed to broker, but no ACK has been observed on <span className="font-mono break-all">{transport?.applied_topic || `devices/${normalizedDeviceId || deviceId}/inference/config/applied`}</span>.
              If no ACK arrives within {summary?.ack_timeout_s || 120}s the request will be marked timed out.
            </>
          ) : (
            <>
              Waiting for device ACK. Backend has not yet recorded a broker-confirmed publish event.
              Publish confirm timeout is {transport?.publish_confirm_timeout_s || 2}s and ACK timeout is {summary?.ack_timeout_s || 120}s.
            </>
          )}
        </div>
      )}

      {summary?.current?.source === 'draft_desired' && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
          Confirmed ACK snapshot not found. Form is bootstrapped from the latest desired draft.
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          {error}
        </div>
      )}

      <AckStatusCard summary={summary} />
      <TransportDiagnosticsCard transport={transport} />

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-lg border border-gray-900 bg-gray-950 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Next Config Version</div>
            <div className="text-sm font-bold text-white font-mono">{summary?.next_config_version || 1}</div>
          </div>
          <div className={`rounded-lg border px-3 py-2 ${INFERENCE_STATUS_CLASS[activeStatus] || INFERENCE_STATUS_CLASS.none}`}>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Current State</div>
            <div className="text-sm font-bold">{formatStatusLabel(activeStatus)}</div>
          </div>
        </div>

        {INFERENCE_FIELD_GROUPS.map(group => (
          <div key={group.id} className="rounded-lg border border-gray-900 bg-gray-950 p-3 space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300">{group.label}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {group.fields.map(field => {
                const meta = INFERENCE_FIELD_META[field];
                const value = formState[field];
                const isChanged = patchState.changedKeys.includes(field);
                const inputClass = `w-full rounded border bg-black px-2 py-1.5 text-xs text-gray-100 ${
                  isChanged ? 'border-cyan-500/40' : 'border-gray-800'
                }`;

                return (
                  <label key={field} className="block space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-gray-400">{meta.label}</span>
                      {isChanged && (
                        <span className="text-[10px] text-cyan-300 uppercase tracking-wider">changed</span>
                      )}
                    </div>
                    {meta.type === 'boolean' ? (
                      <label className="inline-flex items-center gap-2 text-xs text-gray-200">
                        <input
                          type="checkbox"
                          checked={value === true}
                          disabled={!isReachable}
                          onChange={(e) => handleFieldChange(field, e.target.checked)}
                        />
                        {value === true ? 'Enabled' : value === false ? 'Disabled' : 'Not Set'}
                      </label>
                    ) : meta.type === 'array' ? (
                      <textarea
                        className={`${inputClass} min-h-[88px] font-mono`}
                        value={value}
                        disabled={!isReachable}
                        onChange={(e) => handleFieldChange(field, e.target.value)}
                      />
                    ) : (
                      <input
                        className={inputClass}
                        type={meta.type === 'text' ? 'text' : 'number'}
                        value={value}
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        disabled={!isReachable}
                        onChange={(e) => handleFieldChange(field, e.target.value)}
                      />
                    )}
                    {fieldErrors[field] && (
                      <div className="text-[11px] text-red-300">{fieldErrors[field]}</div>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-gray-900 bg-gray-950 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Changed Fields</div>
          {patchState.changedKeys.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {patchState.changedKeys.map(key => (
                <span key={key} className="px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-200">
                  {key}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-gray-500">No unsaved changes</div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || !normalizedDeviceId || !isReachable || !!summary?.pending_request || patchState.changedKeys.length === 0}
            className="flex-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Publishing...' : 'Publish Inference Config'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-gray-800 bg-black px-3 py-2 text-xs font-semibold text-gray-300"
          >
            Reset
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-gray-900 bg-gray-950 p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Current Effective Settings</div>
        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-all text-[11px] text-gray-300">
          {JSON.stringify(summary?.current?.settings || {}, null, 2)}
        </pre>
      </div>

      {showHistorySection && (
        <div className="rounded-lg border border-gray-900 bg-gray-950 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">History</div>
          <InferenceHistoryList history={summary?.history || []} />
        </div>
      )}
    </div>
  );
}
