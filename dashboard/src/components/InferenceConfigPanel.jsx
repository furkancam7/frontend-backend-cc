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

const DEFAULT_SECTION_STATE = {
  runtime: true,
  model: true,
  camera: false,
  detection: false,
};

const DETECTION_SUBGROUPS = [
  { id: 'thresholds', label: 'Thresholds' },
  { id: 'motion_drift', label: 'Motion / Drift' },
  { id: 'video', label: 'Video' },
];

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

function formatValue(value, meta) {
  if (value === undefined || value === null || value === '') return '—';
  if (meta?.type === 'boolean') return value === true ? 'Enabled' : 'Disabled';
  if (meta?.type === 'array') {
    try {
      return JSON.stringify(Array.isArray(value) ? value : JSON.parse(value), null, 0);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function SummaryCard({ title, toneClass = '', children, meta }) {
  return (
    <div className={`rounded-2xl border border-gray-900 bg-gradient-to-b from-gray-950 to-[#050816] p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500">{title}</div>
          <div className="mt-2">{children}</div>
        </div>
        {meta && <div className="text-right text-[11px] font-mono text-gray-300">{meta}</div>}
      </div>
    </div>
  );
}

function LabeledValue({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-black/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">{label}</div>
      <div className={`mt-1 text-sm text-gray-200 ${mono ? 'font-mono' : 'font-medium'} break-all`}>
        {value}
      </div>
    </div>
  );
}

function CollapsibleSection({ label, description, changedCount, isOpen, onToggle, children }) {
  return (
    <section className="rounded-2xl border border-gray-900 bg-gradient-to-b from-gray-950 to-[#050816]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500">Edit Section</div>
          <div className="mt-1 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{label}</h3>
            {changedCount > 0 && (
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                {changedCount} changed
              </span>
            )}
          </div>
          {description && <p className="mt-1 text-[12px] text-gray-500">{description}</p>}
        </div>
        <span className="rounded-full border border-gray-800 bg-black/30 p-2 text-gray-400">
          <svg className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 8 5 5 5-5" />
          </svg>
        </span>
      </button>
      {isOpen && <div className="border-t border-gray-900 px-4 py-4">{children}</div>}
    </section>
  );
}

function SectionSubgroup({ label, children }) {
  return (
    <div className="space-y-3 rounded-2xl border border-gray-900/80 bg-black/20 p-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/80">{label}</div>
      {children}
    </div>
  );
}

function DirtyReview({ rows }) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
      <div className="text-[10px] uppercase tracking-[0.24em] text-cyan-200/80">Review Changes</div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map(row => (
          <div key={row.field} className="rounded-xl border border-cyan-500/15 bg-black/25 px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">{row.label}</div>
            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-start gap-2 text-sm">
              <div className="min-w-0 rounded-lg border border-gray-800 bg-gray-950 px-2 py-2 text-gray-400 break-all">
                {row.before}
              </div>
              <div className="pt-2 text-cyan-200">-&gt;</div>
              <div className="min-w-0 rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-2 py-2 text-cyan-50 break-all">
                {row.after}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvancedDisclosure({ title, isOpen, onToggle, children }) {
  return (
    <div className="rounded-2xl border border-gray-900 bg-gradient-to-b from-gray-950 to-[#050816]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500">{title}</div>
        <span className="rounded-full border border-gray-800 bg-black/30 p-2 text-gray-400">
          <svg className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 8 5 5 5-5" />
          </svg>
        </span>
      </button>
      {isOpen && <div className="border-t border-gray-900 px-4 py-4">{children}</div>}
    </div>
  );
}

function renderFieldInput({
  field,
  meta,
  value,
  isChanged,
  fieldError,
  isReachable,
  handleFieldChange,
}) {
  const inputClass = `w-full rounded-xl border bg-black px-3 py-2.5 text-sm text-gray-100 ${
    isChanged ? 'border-cyan-500/40' : 'border-gray-800'
  }`;

  return (
    <label key={field} className="block space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400">{meta.label}</span>
        {isChanged && (
          <span className="rounded-full border border-cyan-500/25 bg-cyan-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-100">
            Changed
          </span>
        )}
      </div>
      {meta.type === 'boolean' ? (
        <label className="inline-flex min-h-[44px] items-center gap-3 rounded-xl border border-gray-800 bg-black/30 px-3 py-2 text-sm text-gray-200">
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
          className={`${inputClass} min-h-[108px] font-mono`}
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
      {meta.helperText && (
        <div className="text-[11px] leading-5 text-gray-500">{meta.helperText}</div>
      )}
      {fieldError && (
        <div className="text-[11px] text-red-300">{fieldError}</div>
      )}
    </label>
  );
}

export function InferenceHistoryList({ history = [] }) {
  return (
    <div className="space-y-2">
      {history.map(row => (
        <div key={row.id || row.request_id} className="rounded-xl border border-gray-800 bg-black/40 px-3 py-3 text-[11px] text-gray-300">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">Request</div>
              <div className="mt-1 break-all font-mono">{row.request_id}</div>
            </div>
            <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-200">
              {formatStatusLabel(row.ack_status || row.request_state)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <LabeledValue label="Version" value={row.config_version ?? '—'} mono />
            <LabeledValue label="Created" value={formatTs(row.created_at)} mono />
            <LabeledValue label="Applied" value={formatTs(row.applied_at)} mono />
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
  const [expandedSections, setExpandedSections] = useState(DEFAULT_SECTION_STATE);
  const [showAdvancedDiagnostics, setShowAdvancedDiagnostics] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
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
        setExpandedSections(DEFAULT_SECTION_STATE);
        setShowAdvancedDiagnostics(false);
        setShowRawJson(false);
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

  const dirtyReviewRows = useMemo(() => patchState.changedKeys.map(field => {
    const meta = INFERENCE_FIELD_META[field];
    return {
      field,
      label: meta.label,
      before: formatValue(baseSettings[field], meta),
      after: formatValue(patchState.normalizedValues[field], meta),
    };
  }), [baseSettings, patchState.changedKeys, patchState.normalizedValues]);

  const activeStatus = summary?.pending_request ? 'pending' : (summary?.current?.status || 'none');
  const deviceCurrentStatus = summary?.device?.current_status || deviceStatus || 'offline';
  const mqttAvailable = summary?.device?.mqtt_ok ?? mqttOk;
  const isReachable = deviceCurrentStatus !== 'offline' && deviceCurrentStatus !== 'error' && mqttAvailable === true;
  const transport = summary?.transport || {};
  const current = summary?.current || {};
  const pendingRequest = summary?.pending_request;
  const requestId = pendingRequest?.request_id ?? current.request_id ?? '—';
  const requestVersion = pendingRequest?.config_version ?? current.config_version ?? '—';
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

  const toggleSection = useCallback((sectionId) => {
    setExpandedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const getChangedCount = useCallback((fields) => fields.filter(field => patchState.changedKeys.includes(field)).length, [patchState.changedKeys]);

  const renderFields = (fields) => {
    const fullWidthFields = fields.filter(field => INFERENCE_FIELD_META[field].layout === 'full');
    const halfWidthFields = fields.filter(field => INFERENCE_FIELD_META[field].layout !== 'full');

    return (
      <div className="space-y-4">
        {fullWidthFields.length > 0 && (
          <div className="space-y-4">
            {fullWidthFields.map(field => renderFieldInput({
              field,
              meta: INFERENCE_FIELD_META[field],
              value: formState[field],
              isChanged: patchState.changedKeys.includes(field),
              fieldError: fieldErrors[field],
              isReachable,
              handleFieldChange,
            }))}
          </div>
        )}

        {halfWidthFields.length > 0 && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {halfWidthFields.map(field => renderFieldInput({
              field,
              meta: INFERENCE_FIELD_META[field],
              value: formState[field],
              isChanged: patchState.changedKeys.includes(field),
              fieldError: fieldErrors[field],
              isReachable,
              handleFieldChange,
            }))}
          </div>
        )}
      </div>
    );
  };

  const renderGroupContent = (group) => {
    if (group.id !== 'detection') {
      return renderFields(group.fields);
    }

    return (
      <div className="space-y-4">
        {DETECTION_SUBGROUPS.map(subgroup => {
          const fields = group.fields.filter(field => INFERENCE_FIELD_META[field].subgroup === subgroup.id);
          if (fields.length === 0) return null;
          return (
            <SectionSubgroup key={subgroup.id} label={subgroup.label}>
              {renderFields(fields)}
            </SectionSubgroup>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Loading inference config...</div>;
  }

  return (
    <div className="space-y-4 pb-28">
      {!normalizedDeviceId && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Invalid device selection. Inference publish requires a canonical device ID string such as <span className="font-mono">TOWER-001</span>.
        </div>
      )}

      {!isReachable && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Device offline / MQTT unavailable. Settings are read-only until the device becomes reachable.
        </div>
      )}

      {publishFailed && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Backend could not confirm publish to broker.
          {lastPublishPayload?.error ? ` ${lastPublishPayload.error}` : ''}
        </div>
      )}

      {summary?.pending_request && (
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
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
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
          Confirmed ACK snapshot not found. Form is bootstrapped from the latest desired draft.
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SummaryCard
          title="Current State"
          toneClass={INFERENCE_STATUS_CLASS[activeStatus] || INFERENCE_STATUS_CLASS.none}
          meta={`v${requestVersion}`}
        >
          <div className="space-y-3">
            <div className="text-xl font-semibold">{formatStatusLabel(activeStatus)}</div>
            <div className="grid grid-cols-1 gap-2">
              <LabeledValue label="Applied Time" value={formatTs(current.applied_at)} mono />
              <LabeledValue label="Next Config Version" value={summary?.next_config_version || 1} mono />
            </div>
          </div>
        </SummaryCard>

        <SummaryCard title="Publish Health">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <LabeledValue label="Publish Result" value={publishFailed ? 'Failed' : publishConfirmed ? 'Confirmed' : 'Not Observed'} />
              <LabeledValue label="ACK Observed" value={transport?.last_ack_event?.ack_received_at ? formatTs(transport.last_ack_event.ack_received_at) : 'No'} mono />
              <LabeledValue label="Pending Age" value={formatDurationSeconds(transport?.pending_age_s)} mono />
            </div>
          </div>
        </SummaryCard>

        <SummaryCard title="Request Context" meta={requestId}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <LabeledValue label="Source" value={current.source || 'none'} />
              <LabeledValue label="Container State" value={`${current.container?.name || '—'} / ${current.container?.state || '—'}`} />
              <LabeledValue label="Changed Keys" value={pendingRequest?.changed_keys_json?.length || 0} mono />
            </div>
          </div>
        </SummaryCard>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {INFERENCE_FIELD_GROUPS.map(group => (
          <CollapsibleSection
            key={group.id}
            label={group.label}
            description={group.description}
            changedCount={getChangedCount(group.fields)}
            isOpen={!!expandedSections[group.id]}
            onToggle={() => toggleSection(group.id)}
          >
            {renderGroupContent(group)}
          </CollapsibleSection>
        ))}

        <DirtyReview rows={dirtyReviewRows} />

        <AdvancedDisclosure
          title="Advanced Diagnostics"
          isOpen={showAdvancedDiagnostics}
          onToggle={() => setShowAdvancedDiagnostics((value) => !value)}
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <LabeledValue label="Broker" value={`${transport?.broker_host || '—'}:${transport?.broker_port ?? '—'}`} mono />
            <LabeledValue label="QoS / Retain" value={`${transport?.qos ?? '—'} / ${String(transport?.retain ?? false)}`} mono />
            <LabeledValue label="Desired Topic" value={transport?.desired_topic || '—'} mono />
            <LabeledValue label="Applied Topic" value={transport?.applied_topic || '—'} mono />
            <LabeledValue label="Last Publish" value={`${formatTs(lastPublishEvent?.event_at)}${lastPublishPayload?.mid != null ? ` | mid: ${lastPublishPayload.mid}` : ''}`} mono />
            <LabeledValue label="Request ID" value={requestId} mono />
          </div>
        </AdvancedDisclosure>

        <AdvancedDisclosure
          title="Raw JSON"
          isOpen={showRawJson}
          onToggle={() => setShowRawJson((value) => !value)}
        >
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all rounded-2xl border border-gray-800 bg-black/30 p-4 text-[12px] text-gray-300">
            {JSON.stringify(summary?.current?.settings || {}, null, 2)}
          </pre>
        </AdvancedDisclosure>

        {showHistorySection && (
          <div className="rounded-2xl border border-gray-900 bg-gradient-to-b from-gray-950 to-[#050816] p-4">
            <div className="mb-3 text-[10px] uppercase tracking-[0.24em] text-gray-500">History</div>
            <InferenceHistoryList history={summary?.history || []} />
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-1 rounded-2xl border border-gray-900 bg-[#050816]/96 px-4 py-3 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-gray-400">
              {patchState.changedKeys.length > 0
                ? `${patchState.changedKeys.length} field change${patchState.changedKeys.length > 1 ? 's' : ''} ready to publish`
                : 'No unsaved changes'}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-xl border border-gray-800 bg-black px-4 py-2.5 text-sm font-semibold text-gray-300"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={saving || !normalizedDeviceId || !isReachable || !!summary?.pending_request || patchState.changedKeys.length === 0}
                className="rounded-xl border border-cyan-500/40 bg-cyan-500/12 px-4 py-2.5 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Publishing...' : 'Publish Inference Config'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
