const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const IS_DEV = import.meta.env.DEV;

let cachedToken = null;
let unauthorizedCallback = null;
let unauthorizedFired = false; 


const initToken = () => {
  if (typeof window === 'undefined') return;
  cachedToken = localStorage.getItem('token') || null;
};

if (typeof window !== 'undefined') {
  initToken();
  window.addEventListener('storage', (e) => {
    if (e.key === 'token') {
      cachedToken = e.newValue;
      if (e.newValue) unauthorizedFired = false;
    }
  });
}

const getToken = () => cachedToken;

const setToken = (token) => {
  cachedToken = token;
  unauthorizedFired = false; 
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
};


export const onUnauthorized = (callback) => {
  unauthorizedCallback = callback;
};


class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

const extractErrorMessage = (data, fallback) => {
  if (!data) return fallback;
  return (
    data.error ||
    data.message ||
    data.detail ||
    data.title ||
    (Array.isArray(data.errors) && data.errors[0]?.message) ||
    (Array.isArray(data.errors) && data.errors[0]) ||
    fallback
  );
};

const isAbortError = (err) => {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err instanceof DOMException && err.code === 20) return true;
  return false;
};

const normalizeHeaders = (headers) => {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return headers;
};

const request = async (endpoint, options = {}, config = {}) => {
  const { auth = true, signal, fallback } = config;
  const url = `${API_BASE_URL}${endpoint}`;
  const hasFallback = 'fallback' in config;
  const hasBody = options.body != null;

  const headers = {};
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...normalizeHeaders(options.headers) },
      ...(signal && { signal })
    });

    if (response.status === 401 && auth) {
      const error = new ApiError('Unauthorized', 401);

      if (!unauthorizedFired && unauthorizedCallback) {
        unauthorizedFired = true;
        unauthorizedCallback(error);
      }

      setToken(null);

      if (hasFallback) return fallback;
      throw error;
    }

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    const hasResponseBody = response.status !== 204 && response.status !== 205;

    if (hasResponseBody) {
      if (contentType.includes('json')) {
        try {
          data = await response.json();
        } catch {
          data = null;
        }
      } else {
        try {
          const text = await response.text();
          if (text) {
            data = response.ok ? text : { message: text };
          }
        } catch {
          data = null;
        }
      }
    }

    if (!response.ok) {
      if (hasFallback) {
        if (IS_DEV) {
          console.debug(`[API] ${endpoint} failed, using fallback:`, response.status);
        }
        return fallback;
      }
      const message = extractErrorMessage(data, `Request failed: ${response.status}`);
      throw new ApiError(message, response.status, data);
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if (isAbortError(err)) {
      throw err; 
    }

    if (hasFallback) {
      if (IS_DEV) {
        console.debug(`[API] ${endpoint} network error, using fallback:`, err.message);
      }
      return fallback;
    }
    throw new ApiError(err.message || 'Network error', 0);
  }
};


const get = (endpoint, config) =>
  request(endpoint, {}, config);

const post = (endpoint, body, config) =>
  request(endpoint, { method: 'POST', body: JSON.stringify(body) }, config);

const put = (endpoint, body, config) =>
  request(endpoint, { method: 'PUT', body: JSON.stringify(body) }, config);

const del = (endpoint, config) =>
  request(endpoint, { method: 'DELETE' }, config);


const PATHS = {
  login: '/login',
  crops: '/crops',
  crop: (id) => `/crop/${id}`,
  fullframe: (id) => `/fullframe/${id}`,
  devices: '/devices',
  device: (id) => `/device/${id}`,
  deviceDirection: (id) => `/device/${id}/direction`,
  deviceManagement: (id) => `/devices/${id}`,
  deviceAccessHistory: (id) => `/devices/${id}/access-history`,
  deviceNetworkHistory: (id) => `/devices/${id}/network-history`,
  deviceConfigs: (id) => `/devices/${id}/configs`,
  deviceInferenceConfig: (id) => `/devices/${id}/inference-config`,
  deviceCommands: (id) => `/devices/${id}/commands`,
  deviceConfigPublish: (id) => `/devices/${id}/config`,
  deviceCommandReboot: (id) => `/devices/${id}/commands/reboot`,
  deviceCommandServiceRestart: (id) => `/devices/${id}/commands/service-restart`,
  deviceCommandNetworkCycle: (id) => `/devices/${id}/commands/network-cycle`,
  deviceHeartbeatConfig: (id) => `/devices/${id}/heartbeat-config`,
  heartbeatSettings: '/heartbeat/settings',
  record: (id) => `/record/${id}`,
  transfersActive: '/transfers/active',
  transferStatus: (id) => `/transfers/status/${id}`,
  settingsLocations: '/settings/locations',
  settings: '/settings',
  // EO/IR fire detection events
  detectionsLatest: '/detections/latest',
  deviceDetections: (deviceId) => `/devices/${deviceId}/detections`,
  detectionEvent: (eventId) => `/detections/${eventId}`,
  detectionMedia: (eventId) => `/detections/${eventId}/media`,
};

export const api = {
  
  async login(username, password) {
    const data = await post(PATHS.login, { username, password }, { auth: false });
    if (data?.access_token) setToken(data.access_token);
    return data;
  },

  logout() {
    setToken(null);
  },

  refreshToken() {
    initToken();
  },

  getDetections: (signal) =>
    get(PATHS.crops, { signal }),

  getDetection: (id, signal) =>
    get(PATHS.crop(id), { signal }),

  getDetectionDetails: (id, signal) =>
    get(PATHS.fullframe(id), { signal }),

  updateCrop: (id, data) =>
    put(PATHS.crop(id), data),

  deleteCrop: (id) =>
    del(PATHS.crop(id)),

  getDeviceStatus: (signal) =>
    get(PATHS.devices, { signal }),

  getDeviceManagementDetail: (deviceId, signal) =>
    get(PATHS.deviceManagement(deviceId), { signal, fallback: null }),

  getDeviceAccessHistory: (deviceId, { limit = 100 } = {}, signal) => {
    const params = new URLSearchParams({ limit });
    return get(`${PATHS.deviceAccessHistory(deviceId)}?${params}`, { signal, fallback: { success: true, data: [] } });
  },

  getDeviceNetworkHistory: (deviceId, { limit = 100 } = {}, signal) => {
    const params = new URLSearchParams({ limit });
    return get(`${PATHS.deviceNetworkHistory(deviceId)}?${params}`, { signal, fallback: { success: true, data: [] } });
  },

  getDeviceConfigs: (deviceId, { limit = 100 } = {}, signal) => {
    const params = new URLSearchParams({ limit });
    return get(`${PATHS.deviceConfigs(deviceId)}?${params}`, { signal, fallback: { success: true, data: { desired: [], applies: [] } } });
  },

  getInferenceConfig: (deviceId, { limit = 20 } = {}, signal) => {
    const params = new URLSearchParams({ limit });
    return get(`${PATHS.deviceInferenceConfig(deviceId)}?${params}`, {
      signal,
      fallback: {
        success: true,
        data: {
          device_id: deviceId,
          device: { current_status: 'offline', mqtt_ok: false, last_seen_at: null },
          current: { source: 'none', is_confirmed: false, settings: {}, container: {}, errors: [] },
          pending_request: null,
          history: [],
          next_config_version: 1,
          ack_timeout_s: 120,
          transport: {
            desired_topic: `devices/${deviceId}/inference/config/desired`,
            applied_topic: `devices/${deviceId}/inference/config/applied`,
            broker_host: null,
            broker_port: null,
            qos: 1,
            retain: false,
            publish_confirm_timeout_s: 2,
            pending_age_s: null,
            last_publish_event: null,
            last_ack_event: null,
          },
        },
      },
    });
  },

  getDeviceCommands: (deviceId, { limit = 100 } = {}, signal) => {
    const params = new URLSearchParams({ limit });
    return get(`${PATHS.deviceCommands(deviceId)}?${params}`, { signal, fallback: { success: true, data: [] } });
  },
  clearDeviceCommands: (deviceId) =>
    del(PATHS.deviceCommands(deviceId)),

  publishDeviceConfig: (deviceId, data) =>
    post(PATHS.deviceConfigPublish(deviceId), data),

  publishInferenceConfig: (deviceId, data) =>
    post(PATHS.deviceInferenceConfig(deviceId), data),

  sendDeviceRebootCommand: (deviceId, payload = {}) =>
    post(PATHS.deviceCommandReboot(deviceId), { payload }),

  sendDeviceServiceRestartCommand: (deviceId, payload = {}) =>
    post(PATHS.deviceCommandServiceRestart(deviceId), { payload }),

  sendDeviceNetworkCycleCommand: (deviceId, payload = {}) =>
    post(PATHS.deviceCommandNetworkCycle(deviceId), { payload }),

  createDevice: (data) =>
    post(PATHS.devices, data),

  updateDevice: (id, data) =>
    put(PATHS.device(id), data),

  deleteDevice: (id) =>
    del(PATHS.device(id)),

  updateRecord: (id, data) =>
    put(PATHS.record(id), data),

  getActiveTransfers: (signal) =>
    get(PATHS.transfersActive, { signal, fallback: { transfers: [] } }),

  getTransferStatus: (recordId, signal) =>
    get(PATHS.transferStatus(recordId), { signal, fallback: null }),

  getImageUrl: (recordId) =>
    `${API_BASE_URL}/image/fullframe/${recordId}`,

  getCropUrl: (cropId) =>
    `${API_BASE_URL}/image/crop/${cropId}`,

  getMapLocations: (signal) =>
    get(PATHS.settingsLocations, { signal, fallback: { success: true, data: null } }),

  updateMapLocations: (data) =>
    put(PATHS.settingsLocations, data),

  getSettings: (signal) =>
    get(PATHS.settings, { signal, fallback: { success: true, data: {} } }),

  updateDeviceDirection: (deviceId, direction) =>
    put(PATHS.deviceDirection(deviceId), { direction }),

  getHeartbeatConfig: (deviceId, signal) =>
    get(PATHS.deviceHeartbeatConfig(deviceId), { signal, fallback: null }),

  updateHeartbeatConfig: (deviceId, data) =>
    put(PATHS.deviceHeartbeatConfig(deviceId), data),

  getAllHeartbeatSettings: (signal) =>
    get(PATHS.heartbeatSettings, { signal, fallback: { success: true, data: [] } }),

  // ── EO/IR Fire Detection Events ──────────────────────────────
  getFireDetectionsLatest: (signal) =>
    get(PATHS.detectionsLatest, { signal, fallback: { success: true, data: [] } }),

  getDeviceFireDetections: (deviceId, { limit = 50, offset = 0, has_detection, camera_id } = {}, signal) => {
    const params = new URLSearchParams({ limit, offset });
    if (has_detection !== undefined) params.append('has_detection', has_detection);
    if (camera_id) params.append('camera_id', camera_id);
    return get(`${PATHS.deviceDetections(deviceId)}?${params}`, { signal, fallback: { success: true, data: [], total: 0 } });
  },

  getFireDetectionEvent: (eventId, signal) =>
    get(PATHS.detectionEvent(eventId), { signal, fallback: null }),

  getFireDetectionMedia: (eventId, signal) =>
    get(PATHS.detectionMedia(eventId), { signal, fallback: { success: true, data: [] } }),
};

export const login = api.login.bind(api);

export { ApiError, setToken, API_BASE_URL };
export default api;
