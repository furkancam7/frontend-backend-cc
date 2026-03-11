export function getWsBaseUrl() {
  const wsHost = import.meta.env.VITE_WS_URL;
  if (wsHost) {
    return wsHost.replace(/\/ws\/[^/]+$/, '');
  }

  if (window.location.hostname === 'dashboard.roboteye.ai') {
    return 'wss://dashboard-ws.roboteye.ai';
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}`;
}

export function getWsUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getWsBaseUrl()}${normalizedPath}`;
}
