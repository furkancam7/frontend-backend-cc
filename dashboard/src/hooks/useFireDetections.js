import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import useDetectionWebSocket from './useDetectionWebSocket';

const POLL_INTERVAL = 10000;
const MAX_EVENTS = 200;

export default function useFireDetections(token) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetail, setEventDetail] = useState(null);
  const [eventMedia, setEventMedia] = useState([]);

  const inFlightRef = useRef(false);

  /* ── Core fetch function (stable ref) ── */
  const loadEvents = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await api.getFireDetectionsLatest();
      if (res?.success) {
        setEvents((res.data || []).slice(0, MAX_EVENTS));
      }
    } catch (err) {
      console.error('[useFireDetections]', err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  /* ── WebSocket: re-fetch on camera detection messages ── */
  const handleWsUpdate = useCallback((data) => {
    if (data?.type === 'detection' && data?.event_id) {
      loadEvents();
    }
  }, [loadEvents]);

  const { isConnected: wsConnected } = useDetectionWebSocket(handleWsUpdate, !!token);

  /* ── Polling (no wsConnected dep → never aborts) ── */
  useEffect(() => {
    if (!token) return;
    loadEvents();
    const interval = setInterval(loadEvents, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [token, loadEvents]);

  /* ── Load single event detail ── */
  const selectEvent = useCallback(async (eventId) => {
    setSelectedEvent(eventId);
    if (!eventId) { setEventDetail(null); setEventMedia([]); return; }
    try {
      const [detailRes, mediaRes] = await Promise.all([
        api.getFireDetectionEvent(eventId),
        api.getFireDetectionMedia(eventId),
      ]);
      setEventDetail(detailRes?.success ? detailRes.data : null);
      setEventMedia(mediaRes?.success ? (mediaRes.data || []) : []);
    } catch (err) {
      console.error('[useFireDetections] detail error:', err);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEvent(null);
    setEventDetail(null);
    setEventMedia([]);
  }, []);

  const stats = {
    total: events.length,
    withDetection: events.filter(e => e.has_detection).length,
    latestTime: events[0]?.detected_at || null,
  };

  return {
    events,
    loading,
    stats,
    wsConnected,
    selectedEvent,
    eventDetail,
    eventMedia,
    selectEvent,
    clearSelection,
  };
}

