export const TIME = {
  DETECTION_POLL_INTERVAL: 10000,
  TRANSFER_POLL_INTERVAL: 30000,
  DEVICE_STATUS_POLL_INTERVAL: 30000,
  NOTIFICATION_DURATION: 5000,
  CONNECTION_TIMEOUT: 30000,
  STALE_TRANSFER_THRESHOLD: 60000,
  PULSE_INTERVAL: 1000,
  SEARCH_DEBOUNCE: 300,
  RESIZE_DEBOUNCE: 150,
};

export const HQ = {
  LATITUDE: 44.55221753,
  LONGITUDE: 20.49456016,
  NAME: 'Headquarters',
  ZOOM: 16,
};

export const UAE_BOUNDS = {
  CENTER: { lat: 24.3004247, lng: 54.5831548 },
  ZOOM: 7.3,
  BOUNDS: [
    [51.5, 22.5],
    [56.5, 26.5]
  ]
};

export const MAP = {
  DEFAULT_CENTER: {
    lat: 44.55221753,
    lng: 20.49456016
  },
  DEFAULT_ZOOM: 16,
  MIN_ZOOM: 3,
  MAX_ZOOM: 18,
  FOCUS_ZOOM: 14,
  CLUSTER_ZOOM: 12,
  MARKER_SIZE_DEFAULT: 24,
  MARKER_SIZE_SELECTED: 32,
  MARKER_SIZE_CLUSTER: 40,
};

export const UI = {
  SIDEBAR_WIDTH: 320,
  SIDEBAR_WIDTH_COLLAPSED: 64,
  PANEL_MIN_HEIGHT: 200,
  PANEL_MAX_HEIGHT: 600,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  THUMBNAIL_WIDTH: 80,
  THUMBNAIL_HEIGHT: 80,
  PREVIEW_MAX_WIDTH: 800,
  PREVIEW_MAX_HEIGHT: 600,
  Z_INDEX: {
    DROPDOWN: 100,
    MODAL: 200,
    NOTIFICATION: 300,
    TOOLTIP: 400,
  },
};

export const DETECTION = {
  CONFIDENCE_HIGH: 0.8,
  CONFIDENCE_MEDIUM: 0.5,
  CONFIDENCE_LOW: 0.3,
  CATEGORY_COLORS: {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#22c55e',
    unknown: '#6b7280',
  },
  MAX_RECENT_DETECTIONS: 100,
  MAX_NOTIFICATION_QUEUE: 10,
};

export const BATTERY = {
  CRITICAL_THRESHOLD: 25,
  LOW_THRESHOLD: 50,
  COLORS: {
    critical: '#ef4444',
    low: '#eab308',
    good: '#22c55e',
  },
};

export const TRANSFER = {
  STATUS: {
    PENDING: 'pending',
    RECEIVING: 'receiving',
    COMPLETED: 'completed',
    FAILED: 'failed',
    STALE: 'stale',
  },
  PROGRESS_UPDATE_INTERVAL: 500,
};

export const API = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  RETRY_MULTIPLIER: 2,
  CACHE_TTL_SHORT: 30000,
  CACHE_TTL_MEDIUM: 300000,
  CACHE_TTL_LONG: 3600000,
};

export const WEBRTC = {
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],

  CONNECTION_TIMEOUT: 30000,
  RECONNECT_DELAY: 5000,
  MAX_RECONNECT_ATTEMPTS: 5,
  VIDEO_CONSTRAINTS: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
};

export const ANALYSIS = {
  RESPONSE_SPEED_KMH: 50,
  MAX_FLIGHT_MINUTES: 30,
  HEATMAP_OPACITY: 0.7,
};

export const getBatteryStatus = (percentage) => {
  if (percentage < BATTERY.CRITICAL_THRESHOLD) return 'critical';
  if (percentage < BATTERY.LOW_THRESHOLD) return 'low';
  return 'good';
};

export const getBatteryColor = (percentage) => {
  return BATTERY.COLORS[getBatteryStatus(percentage)];
};

export const getCategoryColor = (category) => {
  return DETECTION.CATEGORY_COLORS[category] || DETECTION.CATEGORY_COLORS.unknown;
};
