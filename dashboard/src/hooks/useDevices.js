import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

const POLLING_INTERVAL = 5000;
const DEFAULT_OFFLINE_THRESHOLD_S = 90;

const getDeviceFingerprint = (d) => [
  d.id, d.status, d.online, d.lastSeen || '', d.lastHeartbeatAt || '',
  d.location?.latitude || '', d.location?.longitude || '',
  d.mqtt_ok, d.tailscale_ok, d.reverse_tunnel_ok, d.ssh_ready,
  d.primary_interface || '', d.public_egress_ip || '', d.local_ip || '', d.tailscale_ip || '',
  d.current_config_version || '',
].join(':');

const getDevicesFingerprint = (devices) => {
  if (!devices || devices.length === 0) return '';
  return devices.map(getDeviceFingerprint).sort().join('|');
};

const parseIsoDate = (value) => {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const isHeartbeatOnline = (device) => {
  const lastHeartbeatAt = device?.last_heartbeat_at ?? device?.lastHeartbeatAt;
  const heartbeatSettings = device?.heartbeat_settings ?? device?.heartbeatSettings;
  const offlineThresholdRaw = heartbeatSettings?.offline_threshold_s;
  const offlineThreshold = Number.isFinite(Number(offlineThresholdRaw))
    ? Number(offlineThresholdRaw)
    : DEFAULT_OFFLINE_THRESHOLD_S;

  const heartbeatTime = parseIsoDate(lastHeartbeatAt);
  if (!heartbeatTime) return false;

  const ageSeconds = (Date.now() - heartbeatTime.getTime()) / 1000;
  return ageSeconds <= offlineThreshold;
};

export const deriveDeviceOnline = (device) => {
  const status = device?.current_status ?? device?.status;
  if (status === 'online') return true;
  return isHeartbeatOnline(device);
};

export const normalizeSelectedDeviceId = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (value && typeof value === 'object') {
    return normalizeSelectedDeviceId(value.id ?? value.device_id ?? value.name);
  }

  return null;
};

export default function useDevices(token, onUnauthorized) {
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const devicesReqId = useRef(0);
  const devicesInFlight = useRef(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const loadDevices = async () => {
      if (devicesInFlight.current) return;
      devicesInFlight.current = true;
      const reqId = ++devicesReqId.current;

      try {
        const data = await api.getDeviceStatus();
        
        if (cancelled) return;
        if (reqId !== devicesReqId.current) return;

        if (data.success && data.devices) {
          const mappedDevices = data.devices
            .map(d => {
              const online = deriveDeviceOnline(d);

              return {
                id: d.device_id,
                name: d.device_id,
                type: d.type || 'tower',
                status: d.current_status || d.status || (online ? 'online' : 'offline'),
                online,
                lastSeen: d.last_seen_at || d.last_heartbeat_at || d.last_detection || d.last_known_location?.timestamp,
                lastHeartbeatAt: d.last_heartbeat_at,
                location: d.location,
                direction: d.direction,
                mqtt_ok: d.mqtt_ok,
                tailscale_ok: d.tailscale_ok,
                reverse_tunnel_ok: d.reverse_tunnel_ok,
                ssh_ready: d.ssh_ready,
                primary_interface: d.primary_interface,
                public_egress_ip: d.public_egress_ip,
                local_ip: d.local_ip,
                tailscale_ip: d.tailscale_ip,
                current_config_version: d.current_config_version,
                access_state: d.access_state || {},
                network_state: d.network_state || {},
                heartbeatSettings: d.heartbeat_settings || null,
                raw: d.raw
              };
            });

          mappedDevices.sort((a, b) => a.name.localeCompare(b.name));
          setDevices(prev => {
            const prevFp = getDevicesFingerprint(prev);
            const nextFp = getDevicesFingerprint(mappedDevices);
            if (prevFp === nextFp) return prev;
            return mappedDevices;
          });
        }
      } catch (err) {
        if (cancelled) return;
        if (err.message === 'Unauthorized') {
          onUnauthorizedRef.current?.();
        }
        console.error('Failed to load device status:', err);
      } finally {
        devicesInFlight.current = false;
      }
    };

    loadDevices();
    const interval = setInterval(loadDevices, POLLING_INTERVAL);
    
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  const handleSelectDevice = useCallback((deviceId) => {
    setSelectedDeviceId(normalizeSelectedDeviceId(deviceId));
  }, []);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    handleSelectDevice
  };
}
