import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import InferenceConfigPanel from './InferenceConfigPanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
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
  online: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  degraded: 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10',
  offline: 'text-gray-300 border-gray-600/40 bg-gray-700/20',
  error: 'text-red-400 border-red-500/40 bg-red-500/10',
};

function formatTs(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function BoolBadge({ value, label }) {
  const cls = value === true
    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
    : value === false
      ? 'bg-red-500/15 border-red-500/40 text-red-300'
      : 'bg-gray-700/30 border-gray-600/40 text-gray-400';
  return (
    <div className={`px-2 py-1 border rounded text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {label}: {value === true ? 'OK' : value === false ? 'Fail' : 'N/A'}
    </div>
  );
}

function KeyValue({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-900/60">
      <span className="flex-1 min-w-0 text-[11px] text-gray-500 uppercase tracking-wider truncate">{label}</span>
      <span className="flex-1 min-w-0 text-xs text-gray-200 font-mono text-right break-all">{value || '—'}</span>
    </div>
  );
}

export default function DeviceHealthPanel({ devices = [], selectedDeviceId, onSelectDevice, isActive = true }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [accessHistory, setAccessHistory] = useState([]);
  const [networkHistory, setNetworkHistory] = useState([]);
  const [configs, setConfigs] = useState({ desired: [], applies: [] });
  const [commands, setCommands] = useState([]);
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
    if (!silent) setLoading(true);
    if (!silent) setError('');

    try {
      const [detailRes, accessRes, networkRes, configRes, commandRes] = await Promise.all([
        api.getDeviceManagementDetail(deviceId),
        api.getDeviceAccessHistory(deviceId, { limit: 50 }),
        api.getDeviceNetworkHistory(deviceId, { limit: 50 }),
        api.getDeviceConfigs(deviceId, { limit: 50 }),
        api.getDeviceCommands(deviceId, { limit: 100 }),
      ]);

      const detailData = detailRes?.data || null;
      setDetail(detailData);
      setAccessHistory(accessRes?.data || []);
      setNetworkHistory(networkRes?.data || []);
      setConfigs(configRes?.data || { desired: [], applies: [] });
      setCommands(commandRes?.data || []);

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
          // ignore malformed events
        }
      };
    } catch {
      // websocket unavailable; polling remains active
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
      if (commandType === 'service_restart') {
        setActionMsg(`${commandType} command published (${serviceRestartTarget})`);
      } else {
        setActionMsg(`${commandType} command published`);
      }
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

  return (
    <div className="h-full min-h-0 min-w-0 grid grid-cols-[minmax(132px,40%)_minmax(0,1fr)] bg-black overflow-hidden">
      <div className="min-w-0 border-r border-gray-900 overflow-y-auto">
        <div className="px-3 py-2 border-b border-gray-900 text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
          Health Devices ({devices.length})
        </div>
        <div className="p-2 space-y-1">
          {devices.map(device => {
            const st = device.status || 'offline';
            const active = device.id === selectedId;
            return (
              <button
                key={device.id}
                onClick={() => onSelectDevice?.(device)}
                className={`w-full text-left rounded-lg border px-2 py-2 transition-colors ${
                  active ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-gray-900 bg-gray-950 hover:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-100 truncate">{device.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase ${STATUS_CLASS[st] || STATUS_CLASS.offline}`}>
                    {st}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 mt-1 font-mono">
                  {formatTs(device.lastSeen)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex flex-col">
        <div className="border-b border-gray-900 px-3 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-sm font-bold text-white break-all leading-tight">{selectedId || 'No Device'}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded border uppercase ${STATUS_CLASS[status] || STATUS_CLASS.offline}`}>
              {status}
            </span>
          </div>
          <span className="max-w-[46%] text-[11px] text-gray-500 truncate text-right">last_seen: {formatTs(detail?.last_seen_at || selectedDevice?.lastSeen)}</span>
        </div>

        <div className="px-3 py-2 border-b border-gray-900 flex flex-wrap gap-1.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-1 text-[11px] rounded border uppercase tracking-wider ${
                activeTab === tab.id
                  ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10'
                  : 'border-gray-800 text-gray-400 hover:border-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">Loading health data...</div>
        ) : error ? (
          <div className="flex-1 p-3 text-xs text-red-300">{error}</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {activeTab === 'overview' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <BoolBadge label="MQTT" value={detail?.mqtt_ok ?? selectedDevice?.mqtt_ok} />
                  <BoolBadge label="Tailscale" value={detail?.tailscale_ok ?? selectedDevice?.tailscale_ok} />
                  <BoolBadge label="ReverseTunnel" value={detail?.reverse_tunnel_ok ?? selectedDevice?.reverse_tunnel_ok} />
                  <BoolBadge label="SSH Ready" value={detail?.ssh_ready ?? selectedDevice?.ssh_ready} />
                </div>
                <div className="bg-gray-950 border border-gray-900 rounded-lg px-3">
                  <KeyValue label="device_id" value={detail?.device_id || selectedId} />
                  <KeyValue label="current_status" value={status} />
                  <KeyValue label="primary_interface" value={detail?.primary_interface || selectedDevice?.primary_interface} />
                  <KeyValue label="public_egress_ip" value={detail?.public_egress_ip || selectedDevice?.public_egress_ip} />
                  <KeyValue label="local_ip" value={detail?.local_ip || selectedDevice?.local_ip || networkState.local_ip} />
                  <KeyValue label="tailscale_ip" value={detail?.tailscale_ip || selectedDevice?.tailscale_ip} />
                  <KeyValue label="current_config_version" value={detail?.current_config_version || selectedDevice?.current_config_version} />
                  <KeyValue label="current_inference_version" value={detail?.current_inference_config_version} />
                  <KeyValue label="current_inference_status" value={detail?.current_inference_status} />
                </div>
              </>
            )}

            {activeTab === 'access' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <BoolBadge label="MQTT" value={accessState.mqtt_ok ?? detail?.mqtt_ok} />
                  <BoolBadge label="Tailscale" value={accessState.tailscale_ok ?? detail?.tailscale_ok} />
                  <BoolBadge label="ReverseTunnel" value={accessState.reverse_tunnel_ok ?? detail?.reverse_tunnel_ok} />
                  <BoolBadge label="SSH Ready" value={accessState.ssh_ready ?? detail?.ssh_ready} />
                </div>
                <div className="bg-gray-950 border border-gray-900 rounded-lg px-3">
                  <KeyValue label="last_access_update" value={formatTs(accessState.timestamp)} />
                  <KeyValue label="last_successful_tailscale_check_at" value={formatTs(accessState.last_successful_tailscale_check_at)} />
                  <KeyValue label="last_successful_reverse_tunnel_check_at" value={formatTs(accessState.last_successful_reverse_tunnel_check_at)} />
                </div>
                <div className="bg-gray-950 border border-gray-900 rounded-lg p-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Access History</div>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {accessHistory.map(row => (
                      <div key={row.id || row.timestamp} className="grid grid-cols-1 gap-1 px-2 py-1 rounded bg-black/40 border border-gray-900 text-[11px]">
                        <span className="text-gray-300 font-mono break-all">{formatTs(row.timestamp)}</span>
                        <span className="text-gray-400 font-mono break-all">
                          m:{String(row.mqtt_ok)} t:{String(row.tailscale_ok)} r:{String(row.reverse_tunnel_ok)} s:{String(row.ssh_ready)}
                        </span>
                      </div>
                    ))}
                    {accessHistory.length === 0 && <div className="text-xs text-gray-500">No access history</div>}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'network' && (
              <>
                <div className="bg-gray-950 border border-gray-900 rounded-lg px-3">
                  <KeyValue label="primary_interface" value={networkState.primary_interface || detail?.primary_interface} />
                  <KeyValue label="default_route_interface" value={networkState.default_route_interface} />
                  <KeyValue label="public_egress_ip" value={networkState.public_egress_ip || detail?.public_egress_ip} />
                  <KeyValue label="local_ip" value={networkState.local_ip || detail?.local_ip || selectedDevice?.local_ip} />
                  <KeyValue label="tailscale_ip" value={networkState.tailscale_ip || detail?.tailscale_ip} />
                </div>
                <div className="bg-gray-950 border border-gray-900 rounded-lg p-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Interfaces</div>
                  <pre className="text-[11px] text-gray-300 whitespace-pre-wrap break-all">{JSON.stringify(networkState.interfaces || [], null, 2)}</pre>
                </div>
                <div className="bg-gray-950 border border-gray-900 rounded-lg p-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Network History</div>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {networkHistory.map(row => (
                      <div key={row.id || row.timestamp} className="px-2 py-1 rounded bg-black/40 border border-gray-900 text-[11px] text-gray-300 font-mono">
                        {formatTs(row.timestamp)} | {row.primary_interface || 'n/a'} | {row.local_ip || 'n/a'} | {row.public_egress_ip || 'n/a'}
                      </div>
                    ))}
                    {networkHistory.length === 0 && <div className="text-xs text-gray-500">No network history</div>}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'config' && (
              <>
                <form onSubmit={handleConfigSubmit} className="bg-gray-950 border border-gray-900 rounded-lg p-3 space-y-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">Publish Desired Config</div>
                  <input
                    className="w-full bg-black border border-gray-800 rounded px-2 py-1 text-xs text-gray-200"
                    placeholder="config_version (optional)"
                    value={configForm.config_version}
                    onChange={(e) => setConfigForm(prev => ({ ...prev, config_version: e.target.value }))}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-1">
                    <div className="text-[10px] text-cyan-300/90 uppercase tracking-wider">
                      heartbeat_interval_s
                    </div>
                    <div className="text-[10px] text-cyan-300/90 uppercase tracking-wider">
                      network_snapshot_interval_s
                    </div>
                    <div className="text-[10px] text-cyan-300/90 uppercase tracking-wider">
                      access_check_interval_s
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      className="bg-black border border-gray-800 rounded px-2 py-1 text-xs text-gray-200"
                      type="number"
                      min="5"
                      aria-label="heartbeat_interval_s"
                      value={configForm.heartbeat_interval_s}
                      onChange={(e) => setConfigForm(prev => ({ ...prev, heartbeat_interval_s: e.target.value }))}
                    />
                    <input
                      className="bg-black border border-gray-800 rounded px-2 py-1 text-xs text-gray-200"
                      type="number"
                      min="5"
                      aria-label="network_snapshot_interval_s"
                      value={configForm.network_snapshot_interval_s}
                      onChange={(e) => setConfigForm(prev => ({ ...prev, network_snapshot_interval_s: e.target.value }))}
                    />
                    <input
                      className="bg-black border border-gray-800 rounded px-2 py-1 text-xs text-gray-200"
                      type="number"
                      min="5"
                      aria-label="access_check_interval_s"
                      value={configForm.access_check_interval_s}
                      onChange={(e) => setConfigForm(prev => ({ ...prev, access_check_interval_s: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-300">
                    <label className="min-w-0 flex items-center gap-2">
                      <input type="checkbox" checked={!!configForm.reverse_tunnel_enabled} onChange={(e) => setConfigForm(prev => ({ ...prev, reverse_tunnel_enabled: e.target.checked }))} />
                      reverse_tunnel_enabled
                    </label>
                    <label className="min-w-0 flex items-center gap-2">
                      <input type="checkbox" checked={!!configForm.tailscale_required} onChange={(e) => setConfigForm(prev => ({ ...prev, tailscale_required: e.target.checked }))} />
                      tailscale_required
                    </label>
                  </div>
                  <button disabled={isSubmitting} className="w-full mt-1 bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 rounded px-3 py-1.5 text-xs font-semibold">
                    {isSubmitting ? 'Publishing...' : 'Publish Config'}
                  </button>
                </form>
                <div className="bg-gray-950 border border-gray-900 rounded-lg p-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Config History</div>
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {(configs.desired || []).map(row => (
                      <div key={row.id || `${row.config_version}-${row.created_at}`} className="px-2 py-1 rounded bg-black/40 border border-gray-900 text-[11px] text-gray-300">
                        {row.config_version} | {row.created_by} | {formatTs(row.created_at)}
                      </div>
                    ))}
                    {(configs.desired || []).length === 0 && <div className="text-xs text-gray-500">No config history</div>}
                  </div>
                </div>
                <div className="bg-gray-950 border border-gray-900 rounded-lg p-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Apply Results</div>
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {(configs.applies || []).map(row => (
                      <div key={row.id || `${row.config_version}-${row.applied_at}`} className="px-2 py-1 rounded bg-black/40 border border-gray-900 text-[11px] text-gray-300">
                        {row.config_version} | {row.applied ? 'applied' : 'failed'} | {formatTs(row.applied_at)}
                      </div>
                    ))}
                    {(configs.applies || []).length === 0 && <div className="text-xs text-gray-500">No apply results</div>}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'inference' && (
              <InferenceConfigPanel
                deviceId={selectedId}
                deviceStatus={status}
                mqttOk={detail?.mqtt_ok ?? selectedDevice?.mqtt_ok}
                isActive={isActive && activeTab === 'inference'}
                refreshToken={managementTick}
              />
            )}

            {activeTab === 'commands' && (
              <>
                <div className="bg-gray-950 border border-gray-900 rounded-lg p-2">
                  <label className="block text-[10px] text-cyan-300 uppercase tracking-wider mb-1">
                    Service Restart Target
                  </label>
                  <select
                    value={serviceRestartTarget}
                    onChange={(e) => setServiceRestartTarget(e.target.value)}
                    className="w-full bg-black border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200"
                    aria-label="service_restart_target"
                  >
                    {SERVICE_RESTART_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.optionText}
                      </option>
                    ))}
                  </select>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {SERVICE_RESTART_OPTIONS.find(o => o.value === serviceRestartTarget)?.description}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button disabled={isSubmitting} onClick={() => issueCommand('reboot')} className="bg-amber-500/15 border border-amber-500/40 text-amber-200 rounded px-2 py-1.5 text-xs font-semibold">Reboot</button>
                  <button disabled={isSubmitting} onClick={() => issueCommand('service_restart')} className="bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 rounded px-2 py-1.5 text-xs font-semibold">Service Restart</button>
                  <button disabled={isSubmitting} onClick={() => issueCommand('network_cycle')} className="bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-200 rounded px-2 py-1.5 text-xs font-semibold">Network Cycle</button>
                </div>
                <div className="bg-gray-950 border border-gray-900 rounded-lg p-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Command History</div>
                    <button
                      type="button"
                      title="Clear command history"
                      aria-label="clear_command_history"
                      disabled={isSubmitting || commands.length === 0}
                      onClick={clearCommandHistory}
                      className="p-1 rounded border border-gray-800 text-gray-400 hover:text-red-300 hover:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {commands.map(cmd => (
                      <div key={cmd.id || cmd.command_id} className="px-2 py-1 rounded bg-black/40 border border-gray-900 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-200">{cmd.command_type}</span>
                          <span className="text-gray-400">{cmd.status}</span>
                        </div>
                        <div className="text-gray-500 font-mono">issued_by: {cmd.issued_by || '—'}</div>
                        <div className="text-gray-500 font-mono">issued_at: {formatTs(cmd.issued_at)}</div>
                        <div className="text-gray-500 font-mono">finished_at: {formatTs(cmd.finished_at)}</div>
                        <div className="text-gray-500 font-mono break-all">result: {cmd.result_json ? JSON.stringify(cmd.result_json) : '—'}</div>
                      </div>
                    ))}
                    {commands.length === 0 && <div className="text-xs text-gray-500">No commands</div>}
                  </div>
                </div>
              </>
            )}

            {actionMsg && (
              <div className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-1">
                {actionMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


