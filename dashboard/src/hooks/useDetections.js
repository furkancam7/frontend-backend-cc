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
const METADATA_KEY_MAP = {
  image_status: 'imageStatus',
  updated_at: 'updatedAt',
  is_partial: 'isPartial',
  transfer_status: 'transferStatus',
  chunks_received: 'chunksReceived',
  chunks_total: 'chunksTotal',
  partial_percent: 'partialPercent',
  partial_path: 'partialPath',
  started_at: 'startedAt',
  last_activity: 'lastActivity',
  meta_data: 'metaData'
};
const WEBSOCKET_METADATA_IGNORE_KEYS = new Set([
  'record_id',
  'crop_id',
  'is_update'
]);

const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
};

const serializeMetaValue = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value);
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

const countMapRelevantItemChanges = (prevDetections = [], nextDetections = []) => {
  const prevByCropId = new Map(
    prevDetections.map((detection) => [String(detection?.crop_id ?? ''), getMapRelevantSignature(detection)])
  );
  let changedCount = 0;
  nextDetections.forEach((detection) => {
    const cropKey = String(detection?.crop_id ?? '');
    if (!cropKey) return;
    const prevSignature = prevByCropId.get(cropKey);
    const nextSignature = getMapRelevantSignature(detection);
    if (prevSignature !== nextSignature) {
      changedCount += 1;
    }
  });
  return changedCount;
};

const extractDetectionMeta = (detection) => {
  const recordId = getDetectionRecordId(detection);
  const raw = (detection?.raw && typeof detection.raw === 'object') ? detection.raw : {};
  const meta = { recordId };

  Object.entries(raw).forEach(([rawKey, value]) => {
    const mappedKey = METADATA_KEY_MAP[rawKey];
    if (!mappedKey || value === undefined) return;
    meta[mappedKey] = value;
  });

  if (meta.imageStatus == null && detection?.image_status != null) {
    meta.imageStatus = detection.image_status;
  }

  // Poll payloads may expose metadata at top-level instead of raw; prefer raw when both exist.
  Object.entries(METADATA_KEY_MAP).forEach(([rawKey, mappedKey]) => {
    if (meta[mappedKey] == null && detection?.[rawKey] !== undefined) {
      meta[mappedKey] = detection[rawKey];
    }
  });

  return meta;
};

const buildDetectionMetaByRecordId = (detections = []) => {
  const next = {};
  detections.forEach((detection) => {
    const meta = extractDetectionMeta(detection);
    if (!meta.recordId) return;
    const key = String(meta.recordId);
    const prev = next[key];
    if (!prev) {
      next[key] = { ...meta, recordId: key };
      return;
    }
    const incomingUpdatedAt = meta.updatedAt ?? '';
    const prevUpdatedAt = prev.updatedAt ?? '';
    next[key] = incomingUpdatedAt >= prevUpdatedAt
      ? { ...meta, recordId: key }
      : prev;
  });
  return next;
};

const getMetaFingerprint = (metaByRecordId) => {
  const entries = Object.keys(metaByRecordId || {})
    .sort()
    .map((recordId) => {
      const item = metaByRecordId[recordId] || {};
      const itemEntries = Object.keys(item)
        .filter((key) => key !== 'recordId')
        .sort()
        .map((key) => `${key}:${serializeMetaValue(item[key])}`)
        .join(',');
      return `${recordId}:${itemEntries}`;
    })
    .join('|');
  return `${Object.keys(metaByRecordId || {}).length}:${hashCode(entries)}`;
};

const patchMetadataMapByRecordId = (prevMetaByRecordId, recordId, patch) => {
  if (!recordId || !patch || Object.keys(patch).length === 0) return prevMetaByRecordId;
  const key = String(recordId);
  const prev = prevMetaByRecordId[key] || { recordId: key };
  const next = { ...prev, ...patch, recordId: key };
  const prevFingerprint = getMetaFingerprint({ [key]: prev });
  const nextFingerprint = getMetaFingerprint({ [key]: next });
  if (prevFingerprint === nextFingerprint) return prevMetaByRecordId;
  return {
    ...prevMetaByRecordId,
    [key]: next
  };
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

const buildMetadataPatchFromUpdate = (normalizedUpdate) => {
  const patch = {};
  const rawPayload = normalizedUpdate?.rawPayload || {};

  Object.entries(rawPayload).forEach(([rawKey, value]) => {
    if (value === undefined) return;
    if (WEBSOCKET_METADATA_IGNORE_KEYS.has(rawKey)) return;
    if (MAP_RELEVANT_UPDATE_KEYS.has(rawKey)) return;
    const mappedKey = METADATA_KEY_MAP[rawKey] || rawKey;
    patch[mappedKey] = value;
  });

  if (normalizedUpdate?.imageStatus != null) patch.imageStatus = normalizedUpdate.imageStatus;
  if (normalizedUpdate?.updatedAt != null) patch.updatedAt = normalizedUpdate.updatedAt;

  return patch;
};

const classifyWebSocketUpdate = (rawPayload) => {
  if (!rawPayload || typeof rawPayload !== 'object') return 'map-relevant';
  const keys = Object.keys(rawPayload).filter((key) => rawPayload[key] !== undefined);
  if (!keys.length) return 'map-relevant';
  if (rawPayload.is_update === false) return 'map-relevant';
  if (keys.some((key) => MAP_RELEVANT_UPDATE_KEYS.has(key))) return 'map-relevant';

  // Future-proof boundary:
  // known map/collection keys trigger refresh; unknown keys with record identity stay metadata-only.
  const hasIdentity = rawPayload.record_id != null || rawPayload.crop_id != null;
  return hasIdentity ? 'metadata-only' : 'map-relevant';
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
  const detectionMetaRef = useRef(detectionMetaByRecordId);
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
    metadataPatchedWithoutDetectionsMutation: 0,
    pollMetadataOnlyMergeCount: 0,
    stableDetectionsNoOpEvents: 0,
    detectionsCollectionReplacements: 0,
    detectionsItemReplacements: 0
  });

  useEffect(() => {
    detectionMetaRef.current = detectionMetaByRecordId;
  }, [detectionMetaByRecordId]);

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

    const updateType = classifyWebSocketUpdate(update.rawPayload);

    // Update routing:
    // - metadata-only update => patch metadata state only, no full collection reload.
    // - map-relevant/unknown update => debounce full collection reload for correctness.
    if (updateType !== 'metadata-only') {
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

    const metadataPatch = buildMetadataPatchFromUpdate(update);
    const nextMetaByRecordId = patchMetadataMapByRecordId(
      detectionMetaRef.current,
      metadataTargetId,
      metadataPatch
    );

    if (nextMetaByRecordId === detectionMetaRef.current) {
      bumpPerfCounter('stableDetectionsNoOpEvents', {
        source: 'websocket_metadata_noop',
        recordId: metadataTargetId
      });
      return;
    }

    detectionMetaRef.current = nextMetaByRecordId;
    setDetectionMetaByRecordId(nextMetaByRecordId);
    bumpPerfCounter('metadataPatchedWithoutDetectionsMutation', {
      recordId: metadataTargetId,
      patchedKeys: Object.keys(metadataPatch)
    });
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
              bumpPerfCounter('pollMetadataOnlyMergeCount', {
                prevCount: prev.length,
                nextCount: newDetections.length
              });
              bumpPerfCounter('stableDetectionsNoOpEvents', {
                source: 'poll_map_fingerprint_stable'
              });
              return prev;
            }
            const changedItems = countMapRelevantItemChanges(prev, newDetections);
            bumpPerfCounter('detectionsCollectionReplacements', {
              prevCount: prev.length,
              nextCount: newDetections.length,
              changedItems
            });
            bumpPerfCounter('detectionsItemReplacements', {
              count: changedItems
            });
            saveCachedDetections(newDetections);
            return newDetections;
          });

          const nextMetaByRecordId = buildDetectionMetaByRecordId(newDetections);
          if (getMetaFingerprint(detectionMetaRef.current) !== getMetaFingerprint(nextMetaByRecordId)) {
            detectionMetaRef.current = nextMetaByRecordId;
            setDetectionMetaByRecordId(nextMetaByRecordId);
          } else {
            bumpPerfCounter('stableDetectionsNoOpEvents', {
              source: 'poll_metadata_fingerprint_stable'
            });
          }

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
    setDetections(prev => {
      let changedCount = 0;
      const next = prev.map(d => {
        if (d.crop_id !== cropId) return d;
        const nextClass = newData.class || d.class;
        const nextAccuracy = newData.accuracy || d.accuracy;
        const nextDeviceId = newData.device_id || d.device_id;
        if (d.class === nextClass && d.accuracy === nextAccuracy && d.device_id === nextDeviceId) {
          return d;
        }
        changedCount += 1;
        return {
          ...d,
          class: nextClass,
          accuracy: nextAccuracy,
          device_id: nextDeviceId
        };
      });

      if (changedCount === 0) {
        bumpPerfCounter('stableDetectionsNoOpEvents', {
          source: 'manual_update_noop',
          cropId
        });
        return prev;
      }

      bumpPerfCounter('detectionsCollectionReplacements', {
        source: 'manual_update',
        prevCount: prev.length,
        nextCount: next.length,
        changedItems: changedCount
      });
      bumpPerfCounter('detectionsItemReplacements', {
        source: 'manual_update',
        count: changedCount
      });
      return next;
    });
  }, [bumpPerfCounter]);

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
