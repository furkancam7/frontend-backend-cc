import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { DETECTION } from '../constants';
import useDetectionWebSocket from './useDetectionWebSocket';

// Alarm sound for fire/smoke detections
const ALARM_CLASSES = ['fire', 'flame', 'yangin', 'ates', 'smoke', 'duman'];
let alarmAudio = null;
const getAlarmAudio = () => {
  if (!alarmAudio) {
    alarmAudio = new Audio('/assets/alarm.mp3');
    alarmAudio.loop = true;
  }
  return alarmAudio;
};

const SAFETY_REVALIDATE_INTERVAL = 60000;
const MAX_NOTIFICATIONS = DETECTION.MAX_NOTIFICATION_QUEUE;
const MAX_NOTIFICATION_LOGS = DETECTION.MAX_RECENT_DETECTIONS;
const MAX_PROCESSED_IDS = 10000; 
const DETECTIONS_CACHE_KEY = 'detectionsCache';
const CACHE_TTL = 2 * 60 * 1000; 
const UPDATE_DEBOUNCE_MS = 1000;

const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
};

const getDetectionSignature = (detection) => [
  detection?.crop_id ?? '',
  detection?.record_id ?? '',
  detection?.class ?? '',
  detection?.accuracy ?? '',
  detection?.device_id ?? '',
  detection?.location?.latitude ?? '',
  detection?.location?.longitude ?? '',
  detection?.captured_time ?? detection?.detection_time ?? '',
  detection?.raw?.updated_at ?? '',
  detection?.raw?.image_status ?? detection?.image_status ?? ''
].join(':');

const getDetectionsFingerprint = (detections) => {
  if (!detections || detections.length === 0) return '0::';
  const signature = detections
    .map(getDetectionSignature)
    .sort()
    .join('|');
  return `${detections.length}:${hashCode(signature)}`;
};

const loadCachedDetections = () => {
  try {
    const cached = sessionStorage.getItem(DETECTIONS_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return data;
      }
    }
  } catch (e) {
    console.warn('[useDetections] Failed to load cached detections:', e);
  }
  return [];
};

const saveCachedDetections = (detections) => {
  try {
    if (detections && detections.length > 0) {
      sessionStorage.setItem(DETECTIONS_CACHE_KEY, JSON.stringify({
        data: detections.slice(0, 50),
        timestamp: Date.now()
      }));
    }
  } catch (e) {
    console.warn('[useDetections] Failed to cache detections:', e);
  }
};

export default function useDetections(token, onUnauthorized) {
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const [detections, setDetections] = useState(() => loadCachedDetections());
  const [notifications, setNotifications] = useState([]);
  const [notificationLogs, setNotificationLogs] = useState([]);
  const [selectedContextCrop, setSelectedContextCrop] = useState(null);
  const [fullFrameData, setFullFrameData] = useState(null);
  const [selectedDetectionId, setSelectedDetectionId] = useState(null);
  const detectionsReqId = useRef(0);
  const detectionsInFlight = useRef(false);
  const contextReqId = useRef(0);
  const contextCache = useRef(new Map());
  const processedDetectionIds = useRef(new Set());
  const isFirstLoad = useRef(true);
  const notificationIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const updateDebounceRef = useRef(null);
  const loadDetectionsRef = useRef(null);

  const scheduleDetectionsRefresh = useCallback((delay = 0) => {
    if (updateDebounceRef.current) {
      clearTimeout(updateDebounceRef.current);
      updateDebounceRef.current = null;
    }

    updateDebounceRef.current = setTimeout(() => {
      updateDebounceRef.current = null;
      loadDetectionsRef.current?.();
    }, delay);
  }, []);
  
  const handleWebSocketUpdate = useCallback((data) => {
    const imageStatus = data.image_status || data.data?.image_status;
    const recordId = data.record_id || data.data?.record_id;
    if (imageStatus === 'ready' && recordId) {
      contextCache.current.delete(recordId);
    }

    scheduleDetectionsRefresh(UPDATE_DEBOUNCE_MS);
  }, [scheduleDetectionsRefresh]);
  
  const { isConnected: wsConnected } = useDetectionWebSocket(handleWebSocketUpdate, !!token, {
    onOpen: () => scheduleDetectionsRefresh(0),
  });
  
  useEffect(() => {
    if (!token) return;
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    const loadDetections = async () => {
      if (detectionsInFlight.current) return;
      detectionsInFlight.current = true;
      const reqId = ++detectionsReqId.current;

      try {
        const data = await api.getDetections(signal);

        if (signal.aborted) return;
        if (reqId !== detectionsReqId.current) return;
        if (data.success) {
          const newDetections = data.crops || [];

          setDetections(prev => {
            const prevFingerprint = getDetectionsFingerprint(prev);
            const newFingerprint = getDetectionsFingerprint(newDetections);
            if (prevFingerprint === newFingerprint) return prev;
            saveCachedDetections(newDetections);
            return newDetections;
          });

          newDetections.forEach(det => {
            if (!processedDetectionIds.current.has(det.crop_id)) {
              if (processedDetectionIds.current.size >= MAX_PROCESSED_IDS) {
                processedDetectionIds.current.clear();
              }
              processedDetectionIds.current.add(det.crop_id);

              if (!isFirstLoad.current) {
                notificationIdRef.current += 1;
                const newNotification = {
                  id: notificationIdRef.current,
                  crop_id: det.crop_id,
                  class: det.class,
                  accuracy: det.accuracy,
                  device_id: det.device_id,
                  location: det.location,
                  timestamp: det.captured_time || det.detection_time || new Date().toISOString(),
                  image_path: det.crop_image_path || det.image_path,
                  record_id: det.record_id
                };

                setNotifications(prev => [newNotification, ...prev].slice(0, MAX_NOTIFICATIONS));
                setNotificationLogs(prev => [newNotification, ...prev].slice(0, MAX_NOTIFICATION_LOGS));

                // Play alarm sound for fire/smoke detections
                if (ALARM_CLASSES.includes(det.class?.toLowerCase())) {
                  try {
                    const audio = getAlarmAudio();
                    if (audio.paused) {
                      audio.currentTime = 0;
                      audio.play().catch(() => {});
                    }
                  } catch (e) {
                    // Audio play may fail if user hasn't interacted with page yet
                  }
                }
              }
            }
          });

          if (isFirstLoad.current) {
            isFirstLoad.current = false;
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err.name === 'AbortError') return;
        if (err.message === 'Unauthorized') {
          onUnauthorizedRef.current?.();
        }
        console.error('Error loading detections:', err);
      } finally {
        detectionsInFlight.current = false;
      }
    };

    loadDetectionsRef.current = loadDetections;
    loadDetections();
    const interval = setInterval(loadDetections, SAFETY_REVALIDATE_INTERVAL);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (updateDebounceRef.current) {
        clearTimeout(updateDebounceRef.current);
        updateDebounceRef.current = null;
      }
      clearInterval(interval);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      scheduleDetectionsRefresh(0);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [token, scheduleDetectionsRefresh]);

  useEffect(() => {
    if (!token || !wsConnected) return;
    scheduleDetectionsRefresh(0);
  }, [token, wsConnected, scheduleDetectionsRefresh]);

  const handleSelectDetection = useCallback((id) => {
    setSelectedDetectionId(id);
  }, []);

  const handleViewContext = useCallback(async (crop) => {
    if (!crop?.record_id) return;
    setSelectedContextCrop(crop);
    if (contextCache.current.has(crop.record_id)) {
      setFullFrameData(contextCache.current.get(crop.record_id));
      return;
    }
    const reqId = ++contextReqId.current;
    try {
      const data = await api.getDetectionDetails(crop.record_id);
      if (reqId !== contextReqId.current) return;
      if (data.success) {
        contextCache.current.set(crop.record_id, data.fullframe);
        if (contextCache.current.size > 50) {
          const firstKey = contextCache.current.keys().next().value;
          contextCache.current.delete(firstKey);
        }
        setFullFrameData(data.fullframe);
      }
    } catch (error) {
      console.error('Error fetching full frame:', error);
    }
  }, []);

  const closeContextModal = useCallback(() => {
    setSelectedContextCrop(null);
    setFullFrameData(null);
  }, []);

  const handleDismissNotification = useCallback((notificationId) => {
    setNotifications(prev => {
      const next = prev.filter(n => n.id !== notificationId);
      // Stop alarm sound when all notifications are dismissed
      if (next.length === 0 && alarmAudio && !alarmAudio.paused) {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
      }
      return next;
    });
  }, []);

  const handleClearNotificationLogs = useCallback(() => {
    setNotificationLogs([]);
  }, []);

  const handleUpdateDetection = useCallback((cropId, newData) => {
    setDetections(prev => prev.map(d => {
      if (d.crop_id === cropId) {
        return {
          ...d,
          class: newData.class || d.class,
          accuracy: newData.accuracy || d.accuracy,
          device_id: newData.device_id || d.device_id
        };
      }
      return d;
    }));
  }, []);

  return {
    detections,
    notifications,
    notificationLogs,
    selectedContextCrop,
    fullFrameData,
    selectedDetectionId,

    handleSelectDetection,
    handleViewContext,
    closeContextModal,
    handleDismissNotification,
    handleClearNotificationLogs,
    handleUpdateDetection,
    setSelectedDetectionId
  };
}
