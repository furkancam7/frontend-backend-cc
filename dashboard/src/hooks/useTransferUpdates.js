import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { getWsUrl } from '../utils/ws';

const FALLBACK_POLL_MS = 3000;

const normalizeTransfers = (transfers = []) =>
  [...transfers]
    .filter(Boolean)
    .map((transfer) => ({
      ...transfer,
      percent: Number(transfer.percent ?? 0),
      chunks_received: Number(transfer.chunks_received ?? 0),
      chunks_total: Number(transfer.chunks_total ?? transfer.chunk_total ?? 0),
      partial_percent: transfer.partial_percent == null ? null : Number(transfer.partial_percent),
    }))
    .sort((a, b) => {
      const aTime = a.started_at || '';
      const bTime = b.started_at || '';
      return bTime.localeCompare(aTime);
    });

const areTransfersEqual = (prev, next) => {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;

  return prev.every((item, index) => {
    const other = next[index];
    return (
      item.transfer_id === other.transfer_id &&
      item.status === other.status &&
      item.percent === other.percent &&
      item.chunks_received === other.chunks_received &&
      item.chunks_total === other.chunks_total &&
      item.record_id === other.record_id &&
      item.partial_percent === other.partial_percent &&
      item.partial_path === other.partial_path &&
      item.image_status === other.image_status &&
      item.updated_at === other.updated_at &&
      item.started_at === other.started_at &&
      item.filename === other.filename
    );
  });
};

const mergeTransferUpdate = (prev, update) => {
  if (!update?.transfer_id) return prev;

  const normalizedUpdate = normalizeTransfers([update])[0];
  const shouldRemove = ['completed', 'stale', 'removed'].includes(normalizedUpdate.status);
  const next = [];
  let handled = false;

  for (const item of prev) {
    if (item.transfer_id !== normalizedUpdate.transfer_id) {
      next.push(item);
      continue;
    }

    handled = true;
    if (!shouldRemove) {
      next.push({ ...item, ...normalizedUpdate });
    }
  }

  if (!handled && !shouldRemove) {
    next.push(normalizedUpdate);
  }

  return normalizeTransfers(next);
};

export default function useTransferUpdates(enabled = true) {
  const [activeTransfers, setActiveTransfers] = useState([]);
  const wsRef = useRef(null);
  const fallbackPollerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const enabledRef = useRef(enabled);
  const [isConnected, setIsConnected] = useState(false);

  const updateTransfers = useCallback((updater) => {
    setActiveTransfers(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return areTransfersEqual(prev, next) ? prev : next;
    });
  }, []);

  const refreshTransfers = useCallback(async () => {
    try {
      const response = await api.getActiveTransfers();
      const transfers = normalizeTransfers(response?.transfers || []);
      updateTransfers(transfers);
    } catch (error) {
      console.error('[TransferUpdates] Failed to refresh active transfers:', error);
    }
  }, [updateTransfers]);

  const stopFallbackPolling = useCallback(() => {
    if (fallbackPollerRef.current) {
      clearInterval(fallbackPollerRef.current);
      fallbackPollerRef.current = null;
    }
  }, []);

  const startFallbackPolling = useCallback(() => {
    if (!enabledRef.current || fallbackPollerRef.current) return;
    fallbackPollerRef.current = setInterval(() => {
      refreshTransfers();
    }, FALLBACK_POLL_MS);
  }, [refreshTransfers]);

  const disconnect = useCallback(() => {
    stopFallbackPolling();

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Transfer updates disabled');
      wsRef.current = null;
    }

    setIsConnected(false);
  }, [stopFallbackPolling]);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    try {
      const ws = new WebSocket(getWsUrl('/ws/transfers'));

      ws.onopen = () => {
        setIsConnected(true);
        stopFallbackPolling();
        refreshTransfers();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?.type !== 'transfer_update' || !message.data) return;
          updateTransfers(prev => mergeTransferUpdate(prev, message.data));
        } catch {
          // Ignore malformed websocket payloads.
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        wsRef.current = null;

        if (!enabledRef.current || event.code === 1000) return;

        startFallbackPolling();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, FALLBACK_POLL_MS);
      };

      ws.onerror = () => {
        // onclose handles the fallback path
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[TransferUpdates] WebSocket connect failed:', error);
      startFallbackPolling();
    }
  }, [refreshTransfers, startFallbackPolling, stopFallbackPolling, updateTransfers]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    refreshTransfers();
    connect();

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect, refreshTransfers]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !enabledRef.current) return;
      refreshTransfers();
      if (!wsRef.current) {
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connect, refreshTransfers]);

  return useMemo(() => ({
    activeTransfers,
    isConnected,
    refreshTransfers,
  }), [activeTransfers, isConnected, refreshTransfers]);
}
