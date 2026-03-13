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
const PERF_LOG_ENABLED = import.meta.env.DEV;
const METADATA_ONLY_UPDATE_KEYS = new Set([
  'record_id',
  'crop_id',
  'is_update',
  'image_status',
  'updated_at',
  'chunks_received',
  'chunks_total',
  'transfer_status',
  'partial_percent',
  'partial_path',
  'status',
  'filename',
  'started_at',
  'last_activity'
]);
const MAP_RELEVANT_UPDATE_KEYS = new Set([
  'detection_data',
  'detections',
  'location',
  'class',
  'class_name',
  'confidence',
  'accuracy',
  'device_id',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'action',
  'op',
  'deleted',
  'removed',
  'type',
  'event_id',
  'has_detection',
  'max_confidence',
  'boxes_count'
]);

const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
};

const getDetectionRecordId = (detection) =>
  detection?.record_id ?? detection?.raw?.record_id ?? detection?.crop_id ?? null;

// Invalidation boundary: map-facing sync must ignore metadata-only fields.
const getMapRelevantSignature = (detection) => [
  detection?.crop_id ?? '',
  getDetectionRecordId(detection) ?? '',
  detection?.class ?? '',
  detection?.accuracy ?? '',
  detection?.device_id ?? '',
  detection?.location?.latitude ?? '',
  detection?.location?.longitude ?? '',
  detection?.captured_time ?? detection?.detection_time ?? '',
  detection?.bbox ? JSON.stringify(detection.bbox) : ''
].join(':');

const getMapRelevantFingerprint = (detections) => {
  if (!detections || detections.length === 0) return '0::';
  const signature = detections
    .map(getMapRelevantSignature)
    .sort()
    .join('|');
  return `${detections.length}:${hashCode(signature)}`;
};

const extractDetectionMeta = (detection) => ({
  recordId: getDetectionRecordId(detection),
  imageStatus: detection?.raw?.image_status ?? detection?.image_status ?? null,
  updatedAt: detection?.raw?.updated_at ?? null
});

const buildDetectionMetaByRecordId = (detections = []) => {
  const next = {};
  detections.forEach((detection) => {
    const meta = extractDetectionMeta(detection);
    if (!meta.recordId) return;
    const key = String(meta.recordId);
    const prev = next[key];
    if (!prev) {
      next[key] = { recordId: key, imageStatus: meta.imageStatus, updatedAt: meta.updatedAt };
      return;
    }
    const incomingUpdatedAt = meta.updatedAt || '';
    const prevUpdatedAt = prev.updatedAt || '';
    if (incomingUpdatedAt >= prevUpdatedAt) {
      next[key] = { recordId: key, imageStatus: meta.imageStatus, updatedAt: meta.updatedAt };
    }
  });
  return next;
};

const getMetaFingerprint = (metaByRecordId) => {
  const entries = Object.keys(metaByRecordId || {})
    .sort()
    .map((recordId) => {
      const item = metaByRecordId[recordId] || {};
      return `${recordId}:${item.imageStatus ?? ''}:${item.updatedAt ?? ''}`;
    })
    .join('|');
  return `${Object.keys(metaByRecordId || {}).length}:${hashCode(entries)}`;
};

const patchMetadataMapByRecordId = (prevMetaByRecordId, recordId, patch) => {
  if (!recordId || (!patch?.imageStatus && !patch?.updatedAt)) return prevMetaByRecordId;
  const key = String(recordId);
  const prev = prevMetaByRecordId[key] || { recordId: key, imageStatus: null, updatedAt: null };
  const next = {
    ...prev,
    imageStatus: patch.imageStatus ?? prev.imageStatus,
    updatedAt: patch.updatedAt ?? prev.updatedAt
  };
  if (prev.imageStatus === next.imageStatus && prev.updatedAt === next.updatedAt) return prevMetaByRecordId;
  return {
    ...prevMetaByRecordId,
    [key]: next
  };
};

const patchDetectionsMetadataByRecordId = (prevDetections, recordId, patch) => {
  if (!recordId || (!patch?.imageStatus && !patch?.updatedAt)) return prevDetections;
  const key = String(recordId);
  let changed = false;
  const next = prevDetections.map((detection) => {
    if (String(getDetectionRecordId(detection) ?? '') !== key) return detection;

    const nextRaw = detection?.raw ? { ...detection.raw } : {};
    let itemChanged = false;
    if (patch.imageStatus && nextRaw.image_status !== patch.imageStatus) {
      nextRaw.image_status = patch.imageStatus;
      itemChanged = true;
    }
    if (patch.updatedAt && nextRaw.updated_at !== patch.updatedAt) {
      nextRaw.updated_at = patch.updatedAt;
      itemChanged = true;
    }

    const nextTopLevelStatus = patch.imageStatus ?? detection.image_status;
    if (itemChanged || detection.image_status !== nextTopLevelStatus) {
      changed = true;
      return {
        ...detection,
        raw: nextRaw,
        image_status: nextTopLevelStatus
      };
    }
    return detection;
  });
  return changed ? next : prevDetections;
};

const mergeMetadataFromCollection = (prevDetections, incomingDetections) => {
  if (!prevDetections?.length || !incomingDetections?.length) return prevDetections;
  const incomingByCropId = new Map(
    incomingDetections.map((detection) => [String(detection?.crop_id ?? ''), extractDetectionMeta(detection)])
  );

  let changed = false;
  const next = prevDetections.map((detection) => {
    const incomingMeta = incomingByCropId.get(String(detection?.crop_id ?? ''));
    if (!incomingMeta) return detection;

    const nextRaw = detection?.raw ? { ...detection.raw } : {};
    let itemChanged = false;

    if (incomingMeta.imageStatus != null && nextRaw.image_status !== incomingMeta.imageStatus) {
      nextRaw.image_status = incomingMeta.imageStatus;
      itemChanged = true;
    }
    if (incomingMeta.updatedAt != null && nextRaw.updated_at !== incomingMeta.updatedAt) {
      nextRaw.updated_at = incomingMeta.updatedAt;
      itemChanged = true;
    }
    if (!itemChanged && detection.image_status === incomingMeta.imageStatus) {
      return detection;
    }

    changed = true;
    return {
      ...detection,
      raw: nextRaw,
      image_status: incomingMeta.imageStatus ?? detection.image_status
    };
  });

  return changed ? next : prevDetections;
};

const normalizeWebSocketUpdate = (payload) => {
  const nested = payload?.data && typeof payload.data === 'object' ? payload.data : null;
  const source = nested || payload || {};
  return {
    rawPayload: source,
    recordId: source.record_id ?? payload?.record_id ?? null,
    cropId: source.crop_id ?? payload?.crop_id ?? null,
    imageStatus: source.image_status ?? payload?.image_status ?? null,
    updatedAt: source.updated_at ?? payload?.updated_at ?? null,
    isUpdate: typeof source.is_update === 'boolean'
      ? source.is_update
      : (typeof payload?.is_update === 'boolean' ? payload.is_update : null),
    className: source.class ?? source.class_name ?? null,
    accuracy: source.accuracy ?? source.confidence ?? null,
    location: source.location ?? null
  };
};

const isMetadataOnlyUpdate = (rawPayload) => {
  if (!rawPayload || typeof rawPayload !== 'object') return false;
  const keys = Object.keys(rawPayload).filter((key) => rawPayload[key] !== undefined);
  if (!keys.length) return false;
  if (!rawPayload.record_id && !rawPayload.crop_id) return false;
  if (keys.some((key) => MAP_RELEVANT_UPDATE_KEYS.has(key))) return false;
  return keys.every((key) => METADATA_ONLY_UPDATE_KEYS.has(key));
};

const hasMapRelevantPayload = (normalizedUpdate) => {
  const hasCoords = Number.isFinite(Number(normalizedUpdate?.location?.latitude))
    && Number.isFinite(Number(normalizedUpdate?.location?.longitude));
  return hasCoords || normalizedUpdate?.className != null || normalizedUpdate?.accuracy != null;
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
  const [detectionMetaByRecordId, setDetectionMetaByRecordId] = useState(() =>
    buildDetectionMetaByRecordId(loadCachedDetections())
  );
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
  const perfCountersRef = useRef({
    websocketDetectionUpdatesReceived: 0,
    metadataOnlyUpdatesReceived: 0,
    mapRelevantUpdatesReceived: 0,
    fullDetectionsReloadCount: 0
  });

  const bumpPerfCounter = useCallback((counterKey, details = {}) => {
    if (!PERF_LOG_ENABLED) return;
    const next = (perfCountersRef.current[counterKey] || 0) + 1;
    perfCountersRef.current[counterKey] = next;
    console.debug(`[perf][detections] ${counterKey}`, { count: next, ...details });
  }, []);

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
    const update = normalizeWebSocketUpdate(data);
    bumpPerfCounter('websocketDetectionUpdatesReceived', {
      recordId: update.recordId,
      isUpdate: update.isUpdate
    });

    if (update.imageStatus === 'ready' && update.recordId) {
      contextCache.current.delete(update.recordId);
    }

    const metadataOnlyUpdate = isMetadataOnlyUpdate(update.rawPayload);

    // Update routing:
    // - metadata-only update => patch metadata state only, no full collection reload.
    // - map-relevant/unknown update => debounce full collection reload for correctness.
    if (!metadataOnlyUpdate) {
      bumpPerfCounter('mapRelevantUpdatesReceived', {
        reason: update.isUpdate === false
          ? 'insert'
          : (hasMapRelevantPayload(update) ? 'map_relevant_payload' : 'unknown_payload')
      });
      scheduleDetectionsRefresh(UPDATE_DEBOUNCE_MS);
      return;
    }

    const metadataTargetId = update.recordId || update.cropId;
    if (!metadataTargetId) return;

    bumpPerfCounter('metadataOnlyUpdatesReceived', {
      recordId: metadataTargetId,
      imageStatus: update.imageStatus
    });

    const metadataPatch = {
      imageStatus: update.imageStatus ?? null,
      updatedAt: update.updatedAt ?? null
    };

    setDetectionMetaByRecordId((prevMetaByRecordId) =>
      patchMetadataMapByRecordId(prevMetaByRecordId, metadataTargetId, metadataPatch)
    );
    setDetections((prevDetections) =>
      patchDetectionsMetadataByRecordId(prevDetections, metadataTargetId, metadataPatch)
    );
  }, [bumpPerfCounter, scheduleDetectionsRefresh]);
  
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
            const prevMapFingerprint = getMapRelevantFingerprint(prev);
            const nextMapFingerprint = getMapRelevantFingerprint(newDetections);
            if (prevMapFingerprint === nextMapFingerprint) {
              return mergeMetadataFromCollection(prev, newDetections);
            }
            bumpPerfCounter('fullDetectionsReloadCount', {
              prevCount: prev.length,
              nextCount: newDetections.length
            });
            saveCachedDetections(newDetections);
            return newDetections;
          });

          setDetectionMetaByRecordId((prevMetaByRecordId) => {
            const nextMetaByRecordId = buildDetectionMetaByRecordId(newDetections);
            if (getMetaFingerprint(prevMetaByRecordId) === getMetaFingerprint(nextMetaByRecordId)) {
              return prevMetaByRecordId;
            }
            return nextMetaByRecordId;
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
  }, [token, bumpPerfCounter]);

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
    detectionMetaByRecordId,

    handleSelectDetection,
    handleViewContext,
    closeContextModal,
    handleDismissNotification,
    handleClearNotificationLogs,
    handleUpdateDetection,
    setSelectedDetectionId
  };
}
