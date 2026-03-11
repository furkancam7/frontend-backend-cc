import { useEffect, useRef, useCallback, useState } from 'react';
import { getWsUrl } from '../utils/ws';

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;
const VISIBILITY_COOLDOWN = 60000; 

export default function useDetectionWebSocket(onDetectionUpdate, enabled = true, options = {}) {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxAttemptsReachedAt = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const onDetectionUpdateRef = useRef(onDetectionUpdate);
  const onOpenRef = useRef(options.onOpen);
  const onCloseRef = useRef(options.onClose);
  const enabledRef = useRef(enabled);

  useEffect(() => { onDetectionUpdateRef.current = onDetectionUpdate; }, [onDetectionUpdate]);
  useEffect(() => { onOpenRef.current = options.onOpen; }, [options.onOpen]);
  useEffect(() => { onCloseRef.current = options.onClose; }, [options.onClose]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const getReconnectDelay = useCallback(() => {
    return Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current),
      MAX_RECONNECT_DELAY
    );
  }, []);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const wsUrl = getWsUrl('/ws/detections');

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[DetectionWS] Connected');
        setIsConnected(true);
        reconnectAttempts.current = 0;
        maxAttemptsReachedAt.current = null;
        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'detection_update' && onDetectionUpdateRef.current) {
            onDetectionUpdateRef.current(message.data);
          }
        } catch (e) {
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        wsRef.current = null;
        onCloseRef.current?.(event);

        if (event.code === 1000) return;

        if (enabledRef.current && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay();
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        } else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          maxAttemptsReachedAt.current = Date.now();
          console.warn('[DetectionWS] Max reconnect attempts reached. Will retry on tab focus after cooldown.');
        }
      };

      ws.onerror = () => {
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[DetectionWS] Connection failed:', error);
    }
  }, [getReconnectDelay]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }
    return () => disconnect();
  }, [enabled, connect, disconnect]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!enabledRef.current) return;
      if (wsRef.current) return; 

      if (maxAttemptsReachedAt.current) {
        const elapsed = Date.now() - maxAttemptsReachedAt.current;
        if (elapsed < VISIBILITY_COOLDOWN) {
          return; 
        }
      }

      reconnectAttempts.current = 0;
      maxAttemptsReachedAt.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      connect();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connect]);

  useEffect(() => {
    if (!isConnected) return;
    const heartbeatInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, 30000);
    return () => clearInterval(heartbeatInterval);
  }, [isConnected]);

  return {
    isConnected,
    connect,
    disconnect,
    reconnectAttempts: reconnectAttempts.current
  };
}
