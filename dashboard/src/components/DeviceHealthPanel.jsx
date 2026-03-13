import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import HeartbeatConfigPanel from './HeartbeatConfigPanel';
import InferenceConfigPanel, { InferenceHistoryList } from './InferenceConfigPanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'access', label: 'Access' },
  { id: 'network', label: 'Network' },
  { id: 'config', label: 'Config' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'inference', label: 'Inference' },
  { id: 'commands', label: 'Commands' },
  { id: 'history', label: 'History' },
];

const HISTORY_CATEGORIES = [
  { id: 'access', label: 'Access' },
  { id: 'network', label: 'Network' },
  { id: 'config', label: 'Config' },
  { id: 'inference', label: 'Inference' },
  { id: 'commands', label: 'Commands' },
];

const SERVICE_RESTART_OPTIONS = [
  {
    value: 'hub.service',
    label: 'hub.service',
    description: 'Restarts the Hub service (Docker container).',
    optionText: 'hub.service -> Restarts the Hub service (Docker container)',
  },
  {
    value: 'remote-agent',
    label: 'remote-agent',
    description: 'Restarts the remote agent.',
    optionText: 'remote-agent -> Restarts the remote agent',
  },
  {
    value: 'NetworkManager',
    label: 'NetworkManager',
    description: 'Resets network connectivity.',
    optionText: 'NetworkManager -> Resets network connectivity',
  },
  {
    value: 'tailscaled',
    label: 'tailscaled',
    description: 'Restarts Tailscale.',
    optionText: 'tailscaled -> Restarts Tailscale',
  },
  {
    value: 'reverse-tunnel',
    label: 'reverse-tunnel',
    description: 'Restarts the SSH reverse tunnel.',
    optionText: 'reverse-tunnel -> Restarts the SSH reverse tunnel',
  },
];

const STATUS_CLASS = {
  online: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  degraded: 'text-amber-200 border-amber-500/30 bg-amber-500/10',
  offline: 'text-gray-300 border-gray-600/40 bg-gray-700/20',
  error: 'text-red-300 border-red-500/30 bg-red-500/10',
};

const COMMAND_STATUS_CLASS = {
  success: 'text-emerald-200 border-emerald-500/30 bg-emerald-500/10',
  error: 'text-red-200 border-red-500/30 bg-red-500/10',
  failed: 'text-red-200 border-red-500/30 bg-red-500/10',
  rejected: 'text-amber-200 border-amber-500/30 bg-amber-500/10',
  pending: 'text-cyan-200 border-cyan-500/30 bg-cyan-500/10',
};

function formatTs(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatBoolState(value) {
  if (value === true) return 'OK';
  if (value === false) return 'Fail';
  return 'N/A';
}

function formatInterfaceStatus(value) {
  if (!value) return 'unknown';
  return String(value).toLowerCase();
}

function formatCommandResult(value) {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getHistoryDefault(commands) {
  return commands.length > 0 ? 'commands' : 'access';
}

function TabButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-all ${
        active
          ? 'border-cyan-400/60 bg-cyan-400/14 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.14)]'
          : 'border-gray-800 bg-gray-950/80 text-gray-400 hover:border-gray-700 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

function SectionCard({ eyebrow, title, description, actions, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-gray-900 bg-gradient-to-b from-gray-950 to-[#050816] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${className}`}>
      {(eyebrow || title || description || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.26em] text-gray-500">{eyebrow}</div>
            )}
            {title && (
              <h3 className="mt-1 text-sm font-semibold text-white">{title}</h3>
            )}
            {description && (
              <p className="mt-1 text-[12px] text-gray-500">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function StatusMetric({ label, value }) {
  const tone = value === true
    ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200'
    : value === false
      ? 'border-red-500/25 bg-red-500/8 text-red-200'
      : 'border-gray-800 bg-gray-950 text-gray-400';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${
          value === true ? 'bg-emerald-400' : value === false ? 'bg-red-400' : 'bg-gray-600'
        }`} />
        <span className="text-sm font-semibold">{formatBoolState(value)}</span>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, detail, mono = false, toneClass = '' }) {
  return (
    <div className={`rounded-2xl border border-gray-800 bg-black/30 px-4 py-3 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">{label}</div>
      <div className={`mt-2 text-sm font-semibold text-white ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
      {detail && <div className="mt-1 text-[11px] text-gray-500">{detail}</div>}
    </div>
  );
}

function KeyValueGrid({ items }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(item => (
        <div key={item.label} className="rounded-2xl border border-gray-800 bg-black/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">{item.label}</div>
          <div className={`mt-2 text-sm text-gray-100 ${item.mono ? 'font-mono' : 'font-medium'} break-all`}>
            {item.value || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-800 bg-black/20 px-4 py-8 text-center text-[12px] text-gray-500">
      {text}
    </div>
  );
}

function HistoryCategoryButton({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all ${
        active
          ? 'border-cyan-400/50 bg-cyan-400/12 text-cyan-100'
          : 'border-gray-800 bg-gray-950 text-gray-400 hover:border-gray-700 hover:text-gray-200'
      }`}
    >
      {label}
      <span className="ml-2 rounded-full bg-black/30 px-1.5 py-0.5 text-[10px] text-gray-400">{count}</span>
    </button>
  );
}

export default function DeviceHealthPanel({
  devices = [],
  selectedDeviceId,
  onSelectDevice,
  isActive = true,
  onFocusDevice,
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [historyCategory, setHistoryCategory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [accessHistory, setAccessHistory] = useState([]);
  const [networkHistory, setNetworkHistory] = useState([]);
  const [configs, setConfigs] = useState({ desired: [], applies: [] });
  const [commands, setCommands] = useState([]);
  const [inferenceSummary, setInferenceSummary] = useState(null);
  const [actionMsg, setActionMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serviceRestartTarget, setServiceRestartTarget] = useState('hub.service');
  const [managementTick, setManagementTick] = useState(0);
  const refreshTimerRef = useRef(null);

  const [configForm, setConfigForm] = useState({
    heartbeat_interval_s: 30,
    network_snapshot_interval_s: 60,
    access_check_interval_s: 30,
    reverse_tunnel_enabled: true,
    tailscale_required: true,
    config_version: '',
  });

  const selectedId = selectedDeviceId || devices[0]?.id || null;
  const selectedDevice = useMemo(
    () => devices.find(d => d.id === selectedId) || null,
    [devices, selectedId]
  );

  const refreshDevice = useCallback(async (deviceId, { silent = false } = {}) => {
    if (!deviceId) return;
    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const [
        detailRes,
        accessRes,
        networkRes,
        configRes,
        commandRes,
        inferenceRes,
      ] = await Promise.all([
        api.getDeviceManagementDetail(deviceId),
        api.getDeviceAccessHistory(deviceId, { limit: 50 }),
        api.getDeviceNetworkHistory(deviceId, { limit: 50 }),
        api.getDeviceConfigs(deviceId, { limit: 50 }),
        api.getDeviceCommands(deviceId, { limit: 100 }),
        api.getInferenceConfig(deviceId, { limit: 20 }),
      ]);

      const detailData = detailRes?.data || null;
      setDetail(detailData);
      setAccessHistory(accessRes?.data || []);
      setNetworkHistory(networkRes?.data || []);
      setConfigs(configRes?.data || { desired: [], applies: [] });
      setCommands(commandRes?.data || []);
      setInferenceSummary(inferenceRes?.data || null);

      if (detailData?.network_state && !silent) {
        setConfigForm(prev => ({
          ...prev,
          config_version: prev.config_version || '',
        }));
      }
    } catch (e) {
      if (!silent) {
        setError(e?.message || 'Failed to load health data');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId || !isActive) return;
    refreshDevice(selectedId);
  }, [selectedId, refreshDevice, isActive]);

  useEffect(() => {
    if (!selectedId || !isActive) return;
    const id = window.setInterval(() => refreshDevice(selectedId, { silent: true }), 10000);
    return () => window.clearInterval(id);
  }, [selectedId, refreshDevice, isActive]);

  useEffect(() => {
    if (!selectedId || !onSelectDevice) return;
    if (!selectedDevice && devices[0]) {
      onSelectDevice(devices[0].id);
    }
  }, [selectedId, selectedDevice, devices, onSelectDevice]);

  useEffect(() => {
    setHistoryCategory(null);
  }, [selectedId]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    const nextDefault = getHistoryDefault(commands);
    setHistoryCategory((prev) => {
      if (!prev) return nextDefault;
      if (prev === 'commands' && commands.length === 0) return nextDefault;
      return prev;
    });
  }, [activeTab, commands.length]);

  useEffect(() => {
    if (!isActive) return undefined;

    let ws;
    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = import.meta.env.VITE_WS_URL
        ? import.meta.env.VITE_WS_URL.replace('/ws/detections', '')
        : `${wsProtocol}//${window.location.host}`;
      ws = new WebSocket(`${wsHost}/ws/management`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type !== 'remote_management_update') return;
          const payload = msg?.data || {};
          if (payload.device_id !== selectedId) return;

          if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
          }
          refreshTimerRef.current = setTimeout(() => {
            refreshDevice(selectedId, { silent: true });
          }, 400);
          setManagementTick(prev => prev + 1);
        } catch {
          // Ignore malformed events.
        }
      };
    } catch {
      // Websocket unavailable; polling remains active.
    }

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (ws) ws.close();
    };
  }, [selectedId, refreshDevice, isActive]);

  const handleConfigSubmit = async (e) => {
    e.preventDefault();
    if (!selectedId) return;
    setIsSubmitting(true);
    setActionMsg('');

    try {
      const payload = {
        config_version: configForm.config_version || undefined,
        heartbeat_interval_s: Number(configForm.heartbeat_interval_s),
        network_snapshot_interval_s: Number(configForm.network_snapshot_interval_s),
        access_check_interval_s: Number(configForm.access_check_interval_s),
        reverse_tunnel_enabled: !!configForm.reverse_tunnel_enabled,
        tailscale_required: !!configForm.tailscale_required,
      };
      const res = await api.publishDeviceConfig(selectedId, payload);
      setActionMsg(res?.message || 'Config published');
      refreshDevice(selectedId, { silent: true });
    } catch (e2) {
      setActionMsg(e2?.message || 'Config publish failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const issueCommand = async (commandType) => {
    if (!selectedId) return;
    setIsSubmitting(true);
    setActionMsg('');
    try {
      if (commandType === 'reboot') {
        await api.sendDeviceRebootCommand(selectedId);
      } else if (commandType === 'service_restart') {
        await api.sendDeviceServiceRestartCommand(selectedId, { service_name: serviceRestartTarget });
      } else if (commandType === 'network_cycle') {
        await api.sendDeviceNetworkCycleCommand(selectedId);
      }
      setActionMsg(
        commandType === 'service_restart'
          ? `${commandType} command published (${serviceRestartTarget})`
          : `${commandType} command published`
      );
      refreshDevice(selectedId, { silent: true });
    } catch (e) {
      setActionMsg(e?.message || 'Command publish failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearCommandHistory = async () => {
    if (!selectedId || isSubmitting) return;
    if (!window.confirm(`Clear command history for ${selectedId}?`)) return;

    setIsSubmitting(true);
    setActionMsg('');
    try {
      const res = await api.clearDeviceCommands(selectedId);
      const deletedCount = res?.data?.deleted_count ?? 0;
      setCommands([]);
      setActionMsg(`Command history cleared (${deletedCount} records deleted)`);
      refreshDevice(selectedId, { silent: true });
    } catch (e) {
      setActionMsg(e?.message || 'Failed to clear command history');
    } finally {
      setIsSubmitting(false);
    }
  };

  const status = detail?.current_status || selectedDevice?.status || 'offline';
  const accessState = detail?.access_state || selectedDevice?.access_state || {};
  const networkState = detail?.network_state || selectedDevice?.network_state || {};
  const latestDesired = configs?.desired?.[0] || null;
  const latestApply = configs?.applies?.[0] || null;
  const interfaceRows = Array.isArray(networkState.interfaces) ? networkState.interfaces : [];

  const historyCounts = useMemo(() => ({
    access: accessHistory.length,
    network: networkHistory.length,
    config: (configs?.desired?.length || 0) + (configs?.applies?.length || 0),
    inference: inferenceSummary?.history?.length || 0,
    commands: commands.length,
  }), [accessHistory.length, networkHistory.length, configs, inferenceSummary, commands.length]);

  const renderOverviewTab = () => (
    <>
      <SectionCard
        eyebrow="Live Health"
        title="Connection Signals"
        description="Jetson device connection statuses — MQTT, Tailscale, Reverse Tunnel and SSH."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusMetric label="MQTT" value={detail?.mqtt_ok ?? selectedDevice?.mqtt_ok} />
          <StatusMetric label="Tailscale" value={detail?.tailscale_ok ?? selectedDevice?.tailscale_ok} />
          <StatusMetric label="Reverse Tunnel" value={detail?.reverse_tunnel_ok ?? selectedDevice?.reverse_tunnel_ok} />
          <StatusMetric label="SSH Ready" value={detail?.ssh_ready ?? selectedDevice?.ssh_ready} />
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Device Snapshot"
        title="Current Runtime State"
        description="Key identity, interface, and network data currently reported by the device."
      >
        <KeyValueGrid
          items={[
            { label: 'Device ID', value: detail?.device_id || selectedId, mono: true },
            { label: 'Current Status', value: status },
            { label: 'Primary Interface', value: detail?.primary_interface || selectedDevice?.primary_interface, mono: true },
            { label: 'Public Egress IP', value: detail?.public_egress_ip || selectedDevice?.public_egress_ip, mono: true },
            { label: 'Local IP', value: detail?.local_ip || selectedDevice?.local_ip || networkState.local_ip, mono: true },
            { label: 'Tailscale IP', value: detail?.tailscale_ip || selectedDevice?.tailscale_ip, mono: true },
            { label: 'Current Config Version', value: detail?.current_config_version || selectedDevice?.current_config_version, mono: true },
            { label: 'Current Inference Version', value: detail?.current_inference_config_version, mono: true },
            { label: 'Current Inference Status', value: detail?.current_inference_status },
          ]}
        />
      </SectionCard>
    </>
  );

  const renderAccessTab = () => (
    <>
      <SectionCard
        eyebrow="Access Health"
        title="Current Access Checks"
        description="Access status from Jetson device — MQTT, Tailscale, Reverse Tunnel and SSH."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusMetric label="MQTT" value={accessState.mqtt_ok ?? detail?.mqtt_ok} />
          <StatusMetric label="Tailscale" value={accessState.tailscale_ok ?? detail?.tailscale_ok} />
          <StatusMetric label="Reverse Tunnel" value={accessState.reverse_tunnel_ok ?? detail?.reverse_tunnel_ok} />
          <StatusMetric label="SSH Ready" value={accessState.ssh_ready ?? detail?.ssh_ready} />
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Latest Timestamps"
        title="Recent Access Checkpoints"
        description="Most recent successful observations without historical logs."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryTile label="Last Access Update" value={formatTs(accessState.timestamp)} mono />
          <SummaryTile label="Last Tailscale Check" value={formatTs(accessState.last_successful_tailscale_check_at)} mono />
          <SummaryTile label="Last Reverse Tunnel Check" value={formatTs(accessState.last_successful_reverse_tunnel_check_at)} mono />
        </div>
      </SectionCard>
    </>
  );

  const renderNetworkTab = () => (
    <>
      <SectionCard
        eyebrow="Network Snapshot"
        title="Current Network State"
        description="Active interfaces and routing details reported by the device."
      >
        <KeyValueGrid
          items={[
            { label: 'Primary Interface', value: networkState.primary_interface || detail?.primary_interface, mono: true },
            { label: 'Default Route Interface', value: networkState.default_route_interface, mono: true },
            { label: 'Public Egress IP', value: networkState.public_egress_ip || detail?.public_egress_ip, mono: true },
            { label: 'Local IP', value: networkState.local_ip || detail?.local_ip || selectedDevice?.local_ip, mono: true },
            { label: 'Tailscale IP', value: networkState.tailscale_ip || detail?.tailscale_ip, mono: true },
          ]}
        />
      </SectionCard>

      <SectionCard
        eyebrow="Interfaces"
        title="Interface Inventory"
        description="Structured interface list instead of raw JSON for easier inspection."
      >
        {interfaceRows.length === 0 ? (
          <EmptyState text="No interface data available." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-3 border-b border-gray-800 bg-gray-950/90 px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-gray-500">
              <span>Name</span>
              <span>IPv4</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-gray-900">
              {interfaceRows.map((row, index) => {
                const state = formatInterfaceStatus(row.status);
                const stateTone = state === 'up'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-gray-700 bg-gray-950 text-gray-300';
                return (
                  <div key={`${row.name || 'iface'}-${index}`} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-3 px-4 py-3 text-sm">
                    <span className="text-gray-100 font-medium break-all">{row.name || '—'}</span>
                    <span className="font-mono text-gray-300 break-all">{row.ipv4 || '—'}</span>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${stateTone}`}>
                      {state}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>
    </>
  );

  const renderConfigTab = () => (
    <>
      <SectionCard
        eyebrow="Desired Config"
        title="Publish Device Config"
        description="Send the next desired device configuration without exposing history here."
      >
        <form onSubmit={handleConfigSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Config Version</label>
            <input
              className="w-full rounded-xl border border-gray-800 bg-black px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none"
              placeholder="optional"
              value={configForm.config_version}
              onChange={(e) => setConfigForm(prev => ({ ...prev, config_version: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Heartbeat Interval</label>
              <input
                className="w-full rounded-xl border border-gray-800 bg-black px-3 py-2.5 text-sm text-gray-100 focus:border-cyan-500/40 focus:outline-none"
                type="number"
                min="5"
                aria-label="heartbeat_interval_s"
                value={configForm.heartbeat_interval_s}
                onChange={(e) => setConfigForm(prev => ({ ...prev, heartbeat_interval_s: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Network Snapshot Interval</label>
              <input
                className="w-full rounded-xl border border-gray-800 bg-black px-3 py-2.5 text-sm text-gray-100 focus:border-cyan-500/40 focus:outline-none"
                type="number"
                min="5"
                aria-label="network_snapshot_interval_s"
                value={configForm.network_snapshot_interval_s}
                onChange={(e) => setConfigForm(prev => ({ ...prev, network_snapshot_interval_s: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Access Check Interval</label>
              <input
                className="w-full rounded-xl border border-gray-800 bg-black px-3 py-2.5 text-sm text-gray-100 focus:border-cyan-500/40 focus:outline-none"
                type="number"
                min="5"
                aria-label="access_check_interval_s"
                value={configForm.access_check_interval_s}
                onChange={(e) => setConfigForm(prev => ({ ...prev, access_check_interval_s: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-black/30 px-3 py-2.5 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={!!configForm.reverse_tunnel_enabled}
                onChange={(e) => setConfigForm(prev => ({ ...prev, reverse_tunnel_enabled: e.target.checked }))}
              />
              Reverse tunnel enabled
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-black/30 px-3 py-2.5 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={!!configForm.tailscale_required}
                onChange={(e) => setConfigForm(prev => ({ ...prev, tailscale_required: e.target.checked }))}
              />
              Tailscale required
            </label>
          </div>
          <button
            disabled={isSubmitting}
            className="w-full rounded-xl border border-cyan-500/40 bg-cyan-500/12 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Publishing...' : 'Publish Config'}
          </button>
        </form>
      </SectionCard>

      <SectionCard
        eyebrow="Current Summary"
        title="Latest Config Events"
        description="Most recent desired publish and apply result without showing full history."
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <SummaryTile
            label="Latest Desired Config"
            value={latestDesired ? `v${latestDesired.config_version}` : 'No desired config'}
            detail={latestDesired ? `${latestDesired.created_by || 'system'} | ${formatTs(latestDesired.created_at)}` : null}
            mono={!!latestDesired}
          />
          <SummaryTile
            label="Latest Apply Result"
            value={latestApply ? (latestApply.applied ? 'Applied' : 'Failed') : 'No apply result'}
            detail={latestApply ? `v${latestApply.config_version} | ${formatTs(latestApply.applied_at)}` : null}
            toneClass={latestApply?.applied ? 'border-emerald-500/20 bg-emerald-500/8' : latestApply ? 'border-red-500/20 bg-red-500/8' : ''}
          />
        </div>
      </SectionCard>
    </>
  );

  const renderCommandsTab = () => (
    <>
      <SectionCard
        eyebrow="Remote Actions"
        title="Command Console"
        description="Trigger one-off operational commands. Historical runs are available only in the History tab."
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">
              Service Restart Target
            </label>
            <select
              value={serviceRestartTarget}
              onChange={(e) => setServiceRestartTarget(e.target.value)}
              className="w-full rounded-xl border border-gray-800 bg-black px-3 py-2.5 text-sm text-gray-100"
              aria-label="service_restart_target"
            >
              {SERVICE_RESTART_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.optionText}
                </option>
              ))}
            </select>
            <div className="mt-2 text-[12px] text-gray-500">
              {SERVICE_RESTART_OPTIONS.find(o => o.value === serviceRestartTarget)?.description}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <button
              disabled={isSubmitting}
              onClick={() => issueCommand('reboot')}
              className="rounded-xl border border-amber-500/35 bg-amber-500/12 px-4 py-2.5 text-sm font-semibold text-amber-100 disabled:opacity-50"
            >
              Reboot
            </button>
            <button
              disabled={isSubmitting}
              onClick={() => issueCommand('service_restart')}
              className="rounded-xl border border-cyan-500/35 bg-cyan-500/12 px-4 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-50"
            >
              Service Restart
            </button>
            <button
              disabled={isSubmitting}
              onClick={() => issueCommand('network_cycle')}
              className="rounded-xl border border-fuchsia-500/35 bg-fuchsia-500/12 px-4 py-2.5 text-sm font-semibold text-fuchsia-100 disabled:opacity-50"
            >
              Network Cycle
            </button>
          </div>
        </div>
      </SectionCard>
    </>
  );

  const renderHistoryContent = () => {
    const activeCategory = historyCategory || getHistoryDefault(commands);

    if (activeCategory === 'access') {
      return (
        <SectionCard eyebrow="Access History" title="Access Timeline" description="Recent access state snapshots for MQTT, Tailscale, reverse tunnel, and SSH.">
          {accessHistory.length === 0 ? (
            <EmptyState text="No access history available." />
          ) : (
            <div className="space-y-3">
              {accessHistory.map(row => (
                <div key={row.id || row.timestamp} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">Recorded At</div>
                      <div className="mt-1 text-sm font-semibold text-white font-mono">{formatTs(row.timestamp)}</div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <StatusMetric label="MQTT" value={row.mqtt_ok} />
                    <StatusMetric label="Tailscale" value={row.tailscale_ok} />
                    <StatusMetric label="Reverse Tunnel" value={row.reverse_tunnel_ok} />
                    <StatusMetric label="SSH Ready" value={row.ssh_ready} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }

    if (activeCategory === 'network') {
      return (
        <SectionCard eyebrow="Network History" title="Network Timeline" description="Recent network snapshots with interface and IP context.">
          {networkHistory.length === 0 ? (
            <EmptyState text="No network history available." />
          ) : (
            <div className="space-y-3">
              {networkHistory.map(row => (
                <div key={row.id || row.timestamp} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                    <SummaryTile label="Recorded At" value={formatTs(row.timestamp)} mono />
                    <SummaryTile label="Primary Interface" value={row.primary_interface || '—'} mono />
                    <SummaryTile label="Local IP" value={row.local_ip || '—'} mono />
                    <SummaryTile label="Public Egress IP" value={row.public_egress_ip || '—'} mono />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }

    if (activeCategory === 'config') {
      return (
        <div className="space-y-4">
          <SectionCard eyebrow="Desired Config History" title="Published Desired Configs">
            {(configs.desired || []).length === 0 ? (
              <EmptyState text="No config publish history available." />
            ) : (
              <div className="space-y-3">
                {(configs.desired || []).map(row => (
                  <div key={row.id || `${row.config_version}-${row.created_at}`} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <SummaryTile label="Config Version" value={`v${row.config_version}`} mono />
                      <SummaryTile label="Created By" value={row.created_by || '—'} />
                      <SummaryTile label="Created At" value={formatTs(row.created_at)} mono />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard eyebrow="Apply Results" title="Applied Config Results">
            {(configs.applies || []).length === 0 ? (
              <EmptyState text="No apply results available." />
            ) : (
              <div className="space-y-3">
                {(configs.applies || []).map(row => (
                  <div key={row.id || `${row.config_version}-${row.applied_at}`} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <SummaryTile label="Config Version" value={`v${row.config_version}`} mono />
                      <SummaryTile
                        label="Result"
                        value={row.applied ? 'Applied' : 'Failed'}
                        toneClass={row.applied ? 'border-emerald-500/20 bg-emerald-500/8' : 'border-red-500/20 bg-red-500/8'}
                      />
                      <SummaryTile label="Applied At" value={formatTs(row.applied_at)} mono />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      );
    }

    if (activeCategory === 'inference') {
      return (
        <SectionCard eyebrow="Inference History" title="Inference Config Timeline" description="Published inference config requests and their latest observed states.">
          <InferenceHistoryList history={inferenceSummary?.history || []} />
        </SectionCard>
      );
    }

    return (
      <SectionCard
        eyebrow="Command History"
        title="Executed Commands"
        description="Operational command history is shown only here."
        actions={(
          <button
            type="button"
            title="Clear command history"
            aria-label="clear_command_history"
            disabled={isSubmitting || commands.length === 0}
            onClick={clearCommandHistory}
            className="rounded-xl border border-gray-800 px-3 py-2 text-[11px] font-medium text-gray-300 hover:border-red-500/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear History
          </button>
        )}
      >
        {commands.length === 0 ? (
          <EmptyState text="No commands available." />
        ) : (
          <div className="space-y-3">
            {commands.map(cmd => {
              const statusClass = COMMAND_STATUS_CLASS[cmd.status] || 'text-gray-200 border-gray-700 bg-gray-900/70';
              return (
                <div key={cmd.id || cmd.command_id} className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">Command</div>
                      <div className="mt-1 text-sm font-semibold text-white">{cmd.command_type}</div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusClass}`}>
                      {cmd.status || 'unknown'}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <SummaryTile label="Issued By" value={cmd.issued_by || '—'} />
                    <SummaryTile label="Issued At" value={formatTs(cmd.issued_at)} mono />
                    <SummaryTile label="Finished At" value={formatTs(cmd.finished_at)} mono />
                  </div>
                  <div className="mt-3 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Result</div>
                    <div className="mt-2 break-all font-mono text-[12px] text-gray-200">
                      {formatCommandResult(cmd.result_json)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    );
  };

  return (
    <div className="h-full min-h-0 min-w-0 bg-black overflow-hidden flex flex-col">
      <div className="border-b border-gray-900 bg-gradient-to-r from-[#07131f] via-[#070b15] to-black px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.26em] text-gray-500">Device Health</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-white break-all">{selectedId || 'No Device'}</span>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${STATUS_CLASS[status] || STATUS_CLASS.offline}`}>
                {status}
              </span>
              <button
                type="button"
                onClick={() => selectedDevice && onFocusDevice?.(selectedDevice)}
                disabled={!selectedDevice}
                className="rounded-full border border-gray-800 bg-black/40 p-2 text-gray-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                title="Show on Map"
                aria-label="show_on_map"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </button>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Last Seen</div>
            <div className="mt-1 text-xs font-mono text-gray-300">{formatTs(detail?.last_seen_at || selectedDevice?.lastSeen)}</div>
          </div>
        </div>
      </div>

      <div className="border-b border-gray-900 bg-black/70 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => (
            <TabButton
              key={tab.id}
              label={tab.label}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Loading health data...</div>
      ) : error ? (
        <div className="flex-1 p-4 text-sm text-red-300">{error}</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto w-full max-w-[1120px] space-y-4">
            {activeTab === 'overview' && renderOverviewTab()}
            {activeTab === 'access' && renderAccessTab()}
            {activeTab === 'network' && renderNetworkTab()}
            {activeTab === 'config' && renderConfigTab()}
            {activeTab === 'heartbeat' && (
              <HeartbeatConfigPanel
                deviceId={selectedId}
                deviceStatus={status}
                isActive={isActive && activeTab === 'heartbeat'}
              />
            )}
            {activeTab === 'inference' && (
              <InferenceConfigPanel
                deviceId={selectedId}
                deviceStatus={status}
                mqttOk={detail?.mqtt_ok ?? selectedDevice?.mqtt_ok}
                isActive={isActive && activeTab === 'inference'}
                refreshToken={managementTick}
                showHistorySection={false}
              />
            )}
            {activeTab === 'commands' && renderCommandsTab()}
            {activeTab === 'history' && (
              <>
                <SectionCard
                  eyebrow="History Center"
                  title="Historical Logs"
                  description="Browse historical records by category without mixing them into the live operational tabs."
                >
                  <div className="flex flex-wrap gap-2">
                    {HISTORY_CATEGORIES.map(category => (
                      <HistoryCategoryButton
                        key={category.id}
                        label={category.label}
                        count={historyCounts[category.id] || 0}
                        active={(historyCategory || getHistoryDefault(commands)) === category.id}
                        onClick={() => setHistoryCategory(category.id)}
                      />
                    ))}
                  </div>
                </SectionCard>
                {renderHistoryContent()}
              </>
            )}

            {actionMsg && (
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                {actionMsg}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
