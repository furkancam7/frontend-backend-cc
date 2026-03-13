import React, { useRef, useEffect, useCallback, useMemo, memo } from 'react'
import mapboxgl from 'mapbox-gl'
import { createRoot } from 'react-dom/client'
import { MAP_STYLES } from './map-parts/mapStyles'
import { createGeoJSONCircle } from './map-parts/mapUtils'
import { createSoloZonesGeoJSON, getZonePaintProperties } from './map-parts/sectorUtils'
import TacticalPopupContent from './map-parts/TacticalPopupContent'
import DevicePopupContent from './map-parts/DevicePopupContent'
import { createHeatmapGeoJSON, createETALineGeoJSON, haversineDistance, calculateETA, getMidpoint, spreadOverlappingDetections } from './map-parts/analysisUtils'
import ETAInfoPanel from './map-parts/ETAInfoPanel'
import { ANALYSIS } from '../constants'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ'

const DEFAULT_MAP_CENTER = [19.667679,46.155854];
const DEFAULT_MAP_ZOOM = 16;
const DEFAULT_MAP_PITCH = 60;
const DEFAULT_MAP_BEARING = -17.6;
const DEVICE_COVERAGE_RADIUS_KM = 5;
const MAP_PERF_DEBUG = import.meta.env.DEV && import.meta.env.VITE_MAP_PERF_DEBUG === 'true';

const recordMapPerfSample = (label, durationMs, metadata = {}) => {
    if (!MAP_PERF_DEBUG) return;
    console.debug(`[MapPerf] ${label}: ${durationMs.toFixed(1)}ms`, metadata);
};

const toCoordinateNumber = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizeClassName = (value) => String(value ?? '').toLowerCase();

const hasValidCoordinates = (location) =>
    toCoordinateNumber(location?.latitude) !== null && toCoordinateNumber(location?.longitude) !== null;

const getLngLatFromLocation = (location) => {
    const lat = toCoordinateNumber(location?.latitude);
    const lng = toCoordinateNumber(location?.longitude);
    return lat === null || lng === null ? null : [lng, lat];
};

const getCropRenderSignature = (crop) => [
    crop?.crop_id ?? '',
    crop?.class ?? '',
    toCoordinateNumber(crop?.location?.latitude) ?? '',
    toCoordinateNumber(crop?.location?.longitude) ?? '',
].join(':');

const getHeatmapRenderSignature = (crop) => [
    crop?.crop_id ?? '',
    toCoordinateNumber(crop?.location?.latitude) ?? '',
    toCoordinateNumber(crop?.location?.longitude) ?? '',
    crop?.class ?? '',
    crop?.accuracy ?? crop?.confidence ?? ''
].join(':');

const moveLayerBeforeIfNeeded = (map, layerId, beforeLayerId) => {
    if (!beforeLayerId || !map.getLayer(layerId) || !map.getLayer(beforeLayerId)) return;

    const styleLayers = map.getStyle()?.layers || [];
    const layerIndex = styleLayers.findIndex(layer => layer.id === layerId);
    const beforeIndex = styleLayers.findIndex(layer => layer.id === beforeLayerId);

    if (layerIndex === -1 || beforeIndex === -1 || layerIndex < beforeIndex) return;
    map.moveLayer(layerId, beforeLayerId);
};

const addTerrainAndSky = (map) => {
    try {
        if (!map.getSource('mapbox-dem')) {
            map.addSource('mapbox-dem', {
                'type': 'raster-dem',
                'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                'tileSize': 512,
                'maxzoom': 14
            });
            map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
        }

        map.setFog({
            'color': 'rgb(186, 210, 235)',
            'high-color': 'rgb(36, 92, 223)',
            'horizon-blend': 0.02,
            'space-color': 'rgb(11, 11, 25)',
            'star-intensity': 0.6
        });

        if (!map.getLayer('sky')) {
            map.addLayer({
                'id': 'sky',
                'type': 'sky',
                'paint': {
                    'sky-type': 'gradient',
                    'sky-gradient': [
                        'interpolate',
                        ['linear'],
                        ['sky-radial-progress'],
                        0.0, '#0a0a12',
                        0.3, '#0d0d1a',
                        0.6, '#111122',
                        1.0, '#000008'
                    ],
                    'sky-gradient-center': [0, 0],
                    'sky-gradient-radius': 90
                }
            });
        }
    } catch (e) {
        console.warn('[MapLayer] Terrain/Sky init failed', e);
    }
};

const addCropLayers = (map) => {
    const sourceId = 'source-crops-data';
    try {
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
                cluster: true,
                clusterMaxZoom: 14,
                clusterRadius: 50
            });
        }

        if (!map.getLayer('clusters')) {
            map.addLayer({
                id: 'clusters',
                type: 'circle',
                source: sourceId,
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': '#51bbd6',
                    'circle-radius': [
                        'step',
                        ['get', 'point_count'],
                        20,
                        100,
                        30,
                        750,
                        40
                    ]
                }
            });
        }

        if (!map.getLayer('cluster-count')) {
            map.addLayer({
                id: 'cluster-count',
                type: 'symbol',
                source: sourceId,
                filter: ['has', 'point_count'],
                layout: {
                    'text-field': '{point_count_abbreviated}',
                    'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                    'text-size': 12
                }
            });
        }

        if (!map.getLayer('layer-crops-circle')) {
            map.addLayer({
                id: 'layer-crops-circle',
                type: 'circle',
                source: sourceId,
                filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 7],
                    'circle-color': ['get', 'color'],
                    // Keep hit area/interactions, but hide detection circles visually.
                    'circle-opacity': 0,
                    'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 1.5],
                    'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff', ['get', 'borderColor']],
                    'circle-stroke-opacity': 0
                }
            });
        }

        if (!map.getLayer('layer-crops-label')) {
            map.addLayer({
                id: 'layer-crops-label',
                type: 'symbol',
                source: sourceId,
                filter: ['!', ['has', 'point_count']],
                layout: {
                    'text-field': ['get', 'class'],
                    'text-size': 11,
                    'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                    'text-transform': 'uppercase',
                    'text-offset': [0, 1.2],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,
                    'text-padding': 4
                },
                paint: {
                    'text-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#FC581C', ['get', 'color']],
                    'text-halo-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff', '#000000'],
                    'text-halo-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 2]
                }
            });
        }
    } catch (e) { console.warn('[MapLayer] Crop Layers init failed', e); }
};

const addRadarLayers = (map) => {
    const deviceSource = 'device-radars';
    const beforeDetectionLayer = map.getLayer('layer-crops-circle') ? 'layer-crops-circle' : undefined;
    try {
        if (!map.getSource(deviceSource)) {
            map.addSource(deviceSource, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer('device-radars-layer')) {
            const fillLayer = {
                id: 'device-radars-layer',
                type: 'fill',
                source: deviceSource,
                paint: {
                    'fill-color': '#10302C',
                    'fill-opacity': 0.18
                }
            };
            if (beforeDetectionLayer) {
                map.addLayer(fillLayer, beforeDetectionLayer);
            } else {
                map.addLayer(fillLayer);
            }
        }
        if (!map.getLayer('device-radars-outline')) {
            const outlineLayer = {
                id: 'device-radars-outline',
                type: 'line',
                source: deviceSource,
                paint: {
                    'line-color': '#FC581C',
                    'line-width': 3,
                    'line-opacity': 0.95,
                    'line-dasharray': [2, 2]
                }
            };
            if (beforeDetectionLayer) {
                map.addLayer(outlineLayer, beforeDetectionLayer);
            } else {
                map.addLayer(outlineLayer);
            }
        }

        moveLayerBeforeIfNeeded(map, 'device-radars-layer', beforeDetectionLayer);
        moveLayerBeforeIfNeeded(map, 'device-radars-outline', beforeDetectionLayer);
    } catch (e) { console.warn('[MapLayer] Device Radar init failed', e); }
};

const addHeatmapLayer = (map) => {
    const sourceId = 'source-heatmap-data';
    try {
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }
        if (!map.getLayer('heatmap-layer')) {
            map.addLayer({
                id: 'heatmap-layer',
                type: 'heatmap',
                source: sourceId,
                paint: {
                    'heatmap-weight': ['get', 'weight'],
                    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 2, 15, 3, 20, 5],
                    'heatmap-color': [
                        'interpolate', ['linear'], ['heatmap-density'],
                        0, 'rgba(0,0,0,0)',
                        0.15, 'rgba(0,0,255,0.4)',
                        0.3, 'rgba(0,200,255,0.5)',
                        0.5, 'rgba(0,255,0,0.6)',
                        0.7, 'rgba(255,255,0,0.7)',
                        0.85, 'rgba(255,128,0,0.8)',
                        1.0, 'rgba(255,0,0,0.9)'
                    ],
                    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 5, 10, 20, 15, 40, 20, 60],
                    'heatmap-opacity': ANALYSIS.HEATMAP_OPACITY
                }
            });
        }
    } catch (e) { console.warn('[MapLayer] Heatmap init failed', e); }
};

const addETALayer = (map) => {
    const sourceId = 'source-eta-line';
    try {
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }
        if (!map.getLayer('eta-line-layer')) {
            map.addLayer({
                id: 'eta-line-layer',
                type: 'line',
                source: sourceId,
                paint: {
                    'line-color': ['case', ['get', 'reachable'], '#22c55e', '#ef4444'],
                    'line-width': 2,
                    'line-dasharray': [4, 4],
                    'line-opacity': 0.8
                }
            });
        }
    } catch (e) { console.warn('[MapLayer] ETA line init failed', e); }
};

const addSoloZoneLayers = (map) => {
    const sensorPaint = getZonePaintProperties('sensor');
    const detectionPaint = getZonePaintProperties('detection');
    const detectionSource = 'solo-detection-zones';
    try {
        if (!map.getSource(detectionSource)) {
            map.addSource(detectionSource, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer('solo-detection-fill')) {
            map.addLayer({
                id: 'solo-detection-fill',
                type: 'fill',
                source: detectionSource,
                paint: detectionPaint.fill
            });
        }
        if (!map.getLayer('solo-detection-outline')) {
            map.addLayer({
                id: 'solo-detection-outline',
                type: 'line',
                source: detectionSource,
                paint: detectionPaint.outline
            });
        }
    } catch (e) { console.warn('[MapLayer] SOLO Detection Zone init failed', e); }
    
    const sensorSource = 'solo-sensor-zones';
    try {
        if (!map.getSource(sensorSource)) {
            map.addSource(sensorSource, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer('solo-sensor-fill')) {
            map.addLayer({
                id: 'solo-sensor-fill',
                type: 'fill',
                source: sensorSource,
                paint: sensorPaint.fill
            });
        }
        if (!map.getLayer('solo-sensor-outline')) {
            map.addLayer({
                id: 'solo-sensor-outline',
                type: 'line',
                source: sensorSource,
                paint: sensorPaint.outline
            });
        }
    } catch (e) { console.warn('[MapLayer] SOLO Sensor Zone init failed', e); }
};

const MapView = ({
    devices = [],
    crops = [],
    selectedCrop,
    onCropSelect,
    mapStyle,
    selectedDetectionId,
    flyToLocation,
    isAdmin,
    soloZoneConfig = null,
    showHeatmap = false,
    showETA = false,
    etaTarget = null,
    analysisMode = null,
    hqLocation = null,
    onMapAnalysisClick = null
}) => {
    const mapContainer = useRef(null)
    const map = useRef(null)
    const mapLoadedRef = useRef(false)
    const mapSyncFrameRef = useRef(null)
    const pendingMapSyncTasksRef = useRef(new Set())
    const onCropSelectRef = useRef(onCropSelect);
    const dataRef = useRef({ devices, crops, selectedDetectionId, isAdmin, soloZoneConfig, showHeatmap, showETA, etaTarget, hqLocation, analysisMode });
    const lastCropsFingerprintRef = useRef('');
    const lastDevicesFingerprintRef = useRef('');
    const lastMarkersFingerprintRef = useRef('');
    const lastSoloZonesFingerprintRef = useRef('');
    const lastHeatmapFingerprintRef = useRef('');
    const lastEtaFingerprintRef = useRef('');
    const selectedFeatureIdRef = useRef(null);
    const lastReportedCropsFingerprintRef = useRef('');
    const etaPopupRef = useRef(null);
    const etaPopupRootRef = useRef(null);
    const onMapAnalysisClickRef = useRef(onMapAnalysisClick);
    const perfCountersRef = useRef({
        cropsFingerprintChangeCount: 0,
        cropSourceSyncCount: 0,
        selectedHighlightUpdateCount: 0,
        popupRecreateCount: 0,
        flyToCount: 0
    });

    useEffect(() => { onCropSelectRef.current = onCropSelect; }, [onCropSelect]);
    useEffect(() => { onMapAnalysisClickRef.current = onMapAnalysisClick; }, [onMapAnalysisClick]);
    useEffect(() => {
        dataRef.current = { devices, crops, selectedDetectionId, isAdmin, soloZoneConfig, showHeatmap, showETA, etaTarget, hqLocation, analysisMode };
    }, [devices, crops, selectedDetectionId, isAdmin, soloZoneConfig, showHeatmap, showETA, etaTarget, hqLocation, analysisMode]);

    const markersRef = useRef({});
    const popupRef = useRef(null);
    const popupRootRef = useRef(null);
    const devicePopupRef = useRef(null);
    const lastFlyToId = useRef(null);
    const lastActiveCropFingerprintRef = useRef('');

    const bumpPerfCounter = useCallback((scope, key, details = {}) => {
        if (!import.meta.env.DEV) return;
        const next = (perfCountersRef.current[key] || 0) + 1;
        perfCountersRef.current[key] = next;
        console.debug(`[perf][${scope}] ${key}`, { count: next, ...details });
    }, []);
    const hqCoords = getLngLatFromLocation(hqLocation);
    const initialView = hasValidCoordinates(hqLocation)
        ? {
            center: hqCoords,
            zoom: hqLocation.zoom || DEFAULT_MAP_ZOOM
        }
        : {
            center: DEFAULT_MAP_CENTER,
            zoom: DEFAULT_MAP_ZOOM
        };

    const cleanupDevicePopup = useCallback(() => {
        const popup = devicePopupRef.current;
        if (popup) {
            devicePopupRef.current = null;

            if (popup.reactRoot) {
                const root = popup.reactRoot;
                popup.reactRoot = null;
                setTimeout(() => { try { root.unmount(); } catch (e) { } }, 0);
            }
            popup.remove();
        }
    }, []);

    const cleanupTacticalPopup = useCallback(() => {
        if (popupRootRef.current) {
            const root = popupRootRef.current;
            popupRootRef.current = null;
            setTimeout(() => { try { root.unmount(); } catch (e) { } }, 0);
        }
        if (popupRef.current) {
            popupRef.current.remove();
            popupRef.current = null;
        }
    }, []);

    const onClusterClick = useCallback((e) => {
        if (!map.current) return;
        const mapInst = map.current;
        const features = mapInst.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features.length) return;

        const clusterId = features[0].properties.cluster_id;
        mapInst.getSource('source-crops-data').getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            mapInst.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
        });
    }, []);

    const onCropClick = useCallback((e) => {
        if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            if (feature.properties.point_count) return;
            e.originalEvent.stopPropagation();
            const cropId = feature.properties?.id ?? feature.id;
            const currentCrops = dataRef.current.crops || [];
            const crop = currentCrops.find(c => c.crop_id === cropId);
            if (crop && onCropSelectRef.current) {
                onCropSelectRef.current(crop);
            }
        }
    }, []);

    const onMarkerClick = useCallback((e) => {
        e.stopPropagation();
        const deviceId = e.currentTarget.dataset.deviceId;
        if (!deviceId) return;
        const currentDevices = dataRef.current.devices || [];
        const freshDevice = currentDevices.find(d => d.id === deviceId);
        if (!freshDevice) return;
        const deviceCoords = getLngLatFromLocation(freshDevice.location);
        if (!deviceCoords) return;
        if (onCropSelectRef.current) onCropSelectRef.current(null);
        cleanupDevicePopup();
        const dCrops = (dataRef.current.crops || []).filter(c =>
            c.device_id === freshDevice.id
        );

        const container = document.createElement('div');
        const root = createRoot(container);

        root.render(<DevicePopupContent
            device={freshDevice}
            deviceCrops={dCrops}
            onCropSelect={onCropSelectRef.current}
            isAdmin={dataRef.current.isAdmin}
            zoneConfig={dataRef.current.soloZoneConfig}
        />);

        const popup = new mapboxgl.Popup({
            closeButton: false, closeOnClick: true, maxWidth: 'none',
            className: 'device-popup-wrapper', offset: 20
        })
            .setLngLat(deviceCoords)
            .setDOMContent(container)
            .addTo(map.current);
        popup.reactRoot = root;
        popup.on('close', () => {
            if (devicePopupRef.current === popup) {
                cleanupDevicePopup();
            }
        });
        devicePopupRef.current = popup;
    }, [cleanupDevicePopup]);

    const setPointer = useCallback(() => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; }, []);
    const resetPointer = useCallback(() => { if (map.current) map.current.getCanvas().style.cursor = ''; }, [])
    const syncSelectedFeatureState = useCallback((force = false) => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        if (!map.current.getSource('source-crops-data')) return;

        const nextSelectedId = dataRef.current.selectedDetectionId ?? null;
        const prevSelectedId = selectedFeatureIdRef.current;

        if (!force && prevSelectedId === nextSelectedId) return;
        let didUpdate = false;

        if (prevSelectedId != null && prevSelectedId !== nextSelectedId) {
            try {
                map.current.removeFeatureState({ source: 'source-crops-data', id: prevSelectedId }, 'selected');
            } catch (e) { }
            didUpdate = true;
        }

        if (nextSelectedId != null && (force || prevSelectedId !== nextSelectedId)) {
            try {
                map.current.setFeatureState(
                    { source: 'source-crops-data', id: nextSelectedId },
                    { selected: true }
                );
            } catch (e) { }
            didUpdate = true;
        }

        selectedFeatureIdRef.current = nextSelectedId;
        if (didUpdate) {
            bumpPerfCounter('map', 'selectedHighlightUpdateCount', {
                selectedDetectionId: nextSelectedId,
                mode: force ? 'reapply' : 'transition'
            });
        }
    }, [bumpPerfCounter]);

    const triggerCropUpdate = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        const currentCrops = dataRef.current.crops || [];

        if (!currentCrops.length) {
            if (lastCropsFingerprintRef.current !== 'empty') {
                lastCropsFingerprintRef.current = 'empty';
                const source = map.current.getSource('source-crops-data');
                if (source) {
                    source.setData({ type: 'FeatureCollection', features: [] });
                    bumpPerfCounter('map', 'cropSourceSyncCount', { featureCount: 0, reason: 'empty' });
                }
            }
            syncSelectedFeatureState(true);
            return;
        }

        const fingerprint = currentCrops
            .map(getCropRenderSignature)
            .sort()
            .join('|');
        if (fingerprint === lastCropsFingerprintRef.current) {
            return;
        }
        lastCropsFingerprintRef.current = fingerprint;
        const validCrops = currentCrops.filter(c => c && hasValidCoordinates(c.location));
        const spreadMap = spreadOverlappingDetections(validCrops, 30);
        const features = validCrops
            .map(c => {
                let color = '#4ade80';
                let borderColor = '#22c55e';
                const cls = normalizeClassName(c.class);
                if (['person', 'human'].includes(cls)) { color = '#f87171'; borderColor = '#ef4444'; }
                else if (['car', 'truck', 'bus'].includes(cls)) { color = '#facc15'; borderColor = '#eab308'; }

                const offset = spreadMap.get(c.crop_id);
                const baseCoords = getLngLatFromLocation(c.location);
                if (!baseCoords) return null;
                const lng = offset ? offset.lng : baseCoords[0];
                const lat = offset ? offset.lat : baseCoords[1];

                return {
                    type: 'Feature',
                    id: c.crop_id,
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: {
                        id: c.crop_id,
                        class: (String(c.class ?? 'UNK') || 'UNK').toUpperCase(),
                        color,
                        borderColor
                    }
                };
            })
            .filter(Boolean);

        const source = map.current.getSource('source-crops-data');
        if (source) {
            source.setData({ type: 'FeatureCollection', features });
            bumpPerfCounter('map', 'cropSourceSyncCount', { featureCount: features.length, reason: 'crops_fingerprint' });
        }
        syncSelectedFeatureState(true);
    }, [bumpPerfCounter, syncSelectedFeatureState]);

    const updateDeviceRadars = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;

        const source = map.current.getSource('device-radars');
        if (!source) return;

        const currentDevices = dataRef.current.devices || [];

        const coverageDevices = currentDevices.filter(d => {
            if (!hasValidCoordinates(d?.location)) return false;
            const deviceId = String(d.id || '').toUpperCase();
            return !deviceId.startsWith('SOLO');
        });

        const fingerprint = `visible:${coverageDevices.map(d => {
            const coords = getLngLatFromLocation(d.location);
            return coords ? `${d.id}:${coords[0]}:${coords[1]}` : `${d.id}:invalid`;
        }).join('|')}`;
        if (fingerprint === lastDevicesFingerprintRef.current) return;
        lastDevicesFingerprintRef.current = fingerprint;

        const features = coverageDevices
            .map(device => {
                const coords = getLngLatFromLocation(device.location);
                if (!coords) return null;
                return createGeoJSONCircle(coords, DEVICE_COVERAGE_RADIUS_KM, 64);
            })
            .filter(Boolean);

        source.setData({ type: 'FeatureCollection', features });
    }, []);
    
    const updateSoloZones = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        
        const currentDevices = dataRef.current.devices || [];
        const allConfigs = dataRef.current.soloZoneConfig; 
        const soloDevices = currentDevices.filter(d => 
            String(d.id ?? '').toUpperCase().startsWith('SOLO') &&
            hasValidCoordinates(d.location)
        );
        const fingerprint = `${soloDevices.map(d => {
            const coords = getLngLatFromLocation(d.location);
            return coords ? `${d.id}:${coords[0]}:${coords[1]}` : `${d.id}:invalid`;
        }).join('|')}:${JSON.stringify(allConfigs || {})}`;
        if (fingerprint === lastSoloZonesFingerprintRef.current) return;
        lastSoloZonesFingerprintRef.current = fingerprint;
        
        const sensorZonesData = createSoloZonesGeoJSON(soloDevices, 'sensor', allConfigs);
        const sensorSource = map.current.getSource('solo-sensor-zones');
        if (sensorSource) {
            sensorSource.setData(sensorZonesData);
        }
        
        const detectionZonesData = createSoloZonesGeoJSON(soloDevices, 'detection', allConfigs);
        const detectionSource = map.current.getSource('solo-detection-zones');
        if (detectionSource) {
            detectionSource.setData(detectionZonesData);
        }
        
        if (map.current.getLayer('solo-sensor-fill')) {
            map.current.setPaintProperty('solo-sensor-fill', 'fill-color', ['get', 'color']);
            map.current.setPaintProperty('solo-sensor-outline', 'line-color', ['get', 'color']);
        }
        if (map.current.getLayer('solo-detection-fill')) {
            map.current.setPaintProperty('solo-detection-fill', 'fill-color', ['get', 'color']);
            map.current.setPaintProperty('solo-detection-outline', 'line-color', ['get', 'color']);
        }
    }, []);

    const cleanupETAPopup = useCallback(() => {
        if (etaPopupRootRef.current) {
            const root = etaPopupRootRef.current;
            etaPopupRootRef.current = null;
            setTimeout(() => { try { root.unmount(); } catch (e) { } }, 0);
        }
        if (etaPopupRef.current) {
            etaPopupRef.current.remove();
            etaPopupRef.current = null;
        }
    }, []);

    const updateHeatmap = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        const source = map.current.getSource('source-heatmap-data');
        if (!source) return;
        const { crops: cropsData, showHeatmap: showHeat } = dataRef.current;
        if (!showHeat || !cropsData?.length) {
            if (lastHeatmapFingerprintRef.current !== 'empty') {
                lastHeatmapFingerprintRef.current = 'empty';
                source.setData({ type: 'FeatureCollection', features: [] });
            }
            return;
        }
        const fingerprint = `${cropsData.length}:${cropsData.map(getHeatmapRenderSignature).sort().join('|')}`;
        if (fingerprint === lastHeatmapFingerprintRef.current) return;
        lastHeatmapFingerprintRef.current = fingerprint;
        source.setData(createHeatmapGeoJSON(cropsData));
    }, []);

    const updateETALine = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        const source = map.current.getSource('source-eta-line');
        if (!source) return;
        const { etaTarget: target, hqLocation: hq, devices: devList, showETA: shouldShowETA } = dataRef.current;

        if (!shouldShowETA || !target || !hq?.latitude || !hq?.longitude) {
            if (lastEtaFingerprintRef.current !== 'empty') {
                lastEtaFingerprintRef.current = 'empty';
                source.setData({ type: 'FeatureCollection', features: [] });
                cleanupETAPopup();
            }
            return;
        }

        let batteryPct = 100;
        if (devList?.length) {
            const withBattery = devList.filter(d => d.battery?.percentage != null);
            if (withBattery.length > 0) {
                batteryPct = Math.max(...withBattery.map(d => d.battery.percentage));
            }
        }
        const fingerprint = `${target.lat}:${target.lng}:${hq.latitude}:${hq.longitude}:${batteryPct}`;
        if (fingerprint === lastEtaFingerprintRef.current) return;
        lastEtaFingerprintRef.current = fingerprint;

        const dist = haversineDistance(hq.latitude, hq.longitude, target.lat, target.lng);
        const etaResult = calculateETA(dist, ANALYSIS.RESPONSE_SPEED_KMH, batteryPct);
        source.setData(createETALineGeoJSON(hq.latitude, hq.longitude, target.lat, target.lng, etaResult.isReachable));
        cleanupETAPopup();
        const mid = getMidpoint(hq.latitude, hq.longitude, target.lat, target.lng);
        const container = document.createElement('div');
        const root = createRoot(container);
        etaPopupRootRef.current = root;
        root.render(<ETAInfoPanel
            distance={etaResult.distanceKm}
            eta={etaResult.etaFormatted}
            isReachable={etaResult.isReachable}
            maxRange={etaResult.maxRangeKm}
        />);
        etaPopupRef.current = new mapboxgl.Popup({
            closeButton: false, closeOnClick: false, maxWidth: 'none',
            className: 'eta-popup-wrapper', offset: 10
        })
            .setLngLat([mid.lng, mid.lat])
            .setDOMContent(container)
            .addTo(map.current);
    }, [cleanupETAPopup]);

    const syncDeviceMarkers = useCallback(() => {
        if (!map.current) return;

        const currentDevices = dataRef.current.devices || [];
        const visibleDevices = currentDevices.filter(device =>
            hasValidCoordinates(device?.location)
        );

        const fingerprint = visibleDevices.map(device => {
            const coords = getLngLatFromLocation(device.location);
            return coords ? `${device.id}:${device.name}:${coords[0]}:${coords[1]}` : `${device.id}:${device.name}:invalid`;
        }).join('|');
        if (fingerprint === lastMarkersFingerprintRef.current) return;
        lastMarkersFingerprintRef.current = fingerprint;

        const newActiveIds = new Set();
        visibleDevices.forEach(device => {
            const id = `device-${device.id}`;
            newActiveIds.add(id);

            if (markersRef.current[id]) {
                const existingCoords = getLngLatFromLocation(device.location);
                if (existingCoords) {
                    markersRef.current[id].setLngLat(existingCoords);
                }
                return;
            }

            const deviceCoords = getLngLatFromLocation(device.location);
            if (!deviceCoords) return;

            const el = document.createElement('div');
            el.className = 'device-marker cursor-pointer flex flex-col items-center';
            el.dataset.deviceId = device.id;

            const icon = document.createElement('div');
            icon.className = "w-6 h-6 rounded-full border-2 border-cyan-500 bg-black/80 flex items-center justify-center shadow-[0_0_10px_rgba(252,88,28,0.4)]";
            const dot = document.createElement('div');
            dot.className = "w-2 h-2 bg-cyan-400 rounded-full animate-pulse";
            icon.appendChild(dot);
            el.appendChild(icon);

            const label = document.createElement('div');
            label.className = "mt-1 bg-black/80 text-cyan-400 text-[9px] px-1 rounded border border-cyan-900 font-mono font-bold tracking-wider whitespace-nowrap";
            label.textContent = device.name;
            el.appendChild(label);

            el.__onClick = onMarkerClick;
            el.addEventListener('click', el.__onClick);

            const marker = new mapboxgl.Marker(el)
                .setLngLat(deviceCoords)
                .addTo(map.current);

            markersRef.current[id] = marker;
        });

        Object.keys(markersRef.current).forEach(id => {
            if (newActiveIds.has(id)) return;

            const marker = markersRef.current[id];
            const el = marker.getElement();
            if (el && el.__onClick) {
                el.removeEventListener('click', el.__onClick);
                delete el.__onClick;
            }
            marker.remove();
            delete markersRef.current[id];
        });
    }, [onMarkerClick]);

    const runPendingMapSync = useCallback(() => {
        const startedAt = performance.now();
        mapSyncFrameRef.current = null;

        if (!map.current) return;

        const tasks = Array.from(pendingMapSyncTasksRef.current);
        if (!tasks.length) return;

        pendingMapSyncTasksRef.current.clear();

        const styleReady = mapLoadedRef.current && map.current.isStyleLoaded();

        tasks.forEach((task) => {
            switch (task) {
                case 'markers':
                    syncDeviceMarkers();
                    break;
                case 'radars':
                    if (styleReady) updateDeviceRadars();
                    else pendingMapSyncTasksRef.current.add(task);
                    break;
                case 'soloZones':
                    if (styleReady) updateSoloZones();
                    else pendingMapSyncTasksRef.current.add(task);
                    break;
                case 'crops':
                    if (styleReady) triggerCropUpdate();
                    else pendingMapSyncTasksRef.current.add(task);
                    break;
                case 'selection':
                    if (styleReady) syncSelectedFeatureState();
                    else pendingMapSyncTasksRef.current.add(task);
                    break;
                case 'heatmap':
                    if (styleReady) updateHeatmap();
                    else pendingMapSyncTasksRef.current.add(task);
                    break;
                case 'eta':
                    if (styleReady) updateETALine();
                    else pendingMapSyncTasksRef.current.add(task);
                    break;
                default:
                    break;
            }
        });

        // If tasks were deferred, schedule a retry
        if (pendingMapSyncTasksRef.current.size > 0 && !mapSyncFrameRef.current) {
            setTimeout(() => {
                if (map.current && pendingMapSyncTasksRef.current.size > 0 && !mapSyncFrameRef.current) {
                    mapSyncFrameRef.current = requestAnimationFrame(() => {
                        runPendingMapSync();
                    });
                }
            }, 250);
        }

        recordMapPerfSample('runPendingMapSync', performance.now() - startedAt, {
            taskCount: tasks.length,
            deferredTaskCount: pendingMapSyncTasksRef.current.size
        });
    }, [syncDeviceMarkers, syncSelectedFeatureState, triggerCropUpdate, updateDeviceRadars, updateETALine, updateHeatmap, updateSoloZones]);

    const scheduleMapSync = useCallback((...tasks) => {
        if (!map.current) return;

        tasks.forEach(task => pendingMapSyncTasksRef.current.add(task));
        if (mapSyncFrameRef.current) return;

        mapSyncFrameRef.current = requestAnimationFrame(() => {
            runPendingMapSync();
        });
    }, [runPendingMapSync]);

    const onAnalysisClick = useCallback((e) => {
        const mode = dataRef.current.analysisMode;
        if (!mode) return;
        const features = map.current.queryRenderedFeatures(e.point, { layers: ['layer-crops-circle', 'clusters'] });
        if (features.length > 0) return;

        if (onMapAnalysisClickRef.current) {
            onMapAnalysisClickRef.current(e.lngLat);
        }
    }, []);

    const ensureMapLayers = useCallback((mapInst) => {
        const startedAt = performance.now();
        if (!mapInst || !mapInst.isStyleLoaded()) return;
        addTerrainAndSky(mapInst);
        addHeatmapLayer(mapInst);
        addCropLayers(mapInst);
        addRadarLayers(mapInst);
        addSoloZoneLayers(mapInst);
        addETALayer(mapInst);
        try {
            mapInst.off('click', 'layer-crops-circle', onCropClick);
            mapInst.off('mouseenter', 'layer-crops-circle', setPointer);
            mapInst.off('mouseleave', 'layer-crops-circle', resetPointer);
            mapInst.off('click', 'clusters', onClusterClick);
            mapInst.off('mouseenter', 'clusters', setPointer);
            mapInst.off('mouseleave', 'clusters', resetPointer);

            if (mapInst.getLayer('layer-crops-circle')) {
                mapInst.on('click', 'layer-crops-circle', onCropClick);
                mapInst.on('mouseenter', 'layer-crops-circle', setPointer);
                mapInst.on('mouseleave', 'layer-crops-circle', resetPointer);
            }

            if (mapInst.getLayer('clusters')) {
                mapInst.on('click', 'clusters', onClusterClick);
                mapInst.on('mouseenter', 'clusters', setPointer);
                mapInst.on('mouseleave', 'clusters', resetPointer);
            }

            mapInst.off('click', onAnalysisClick);
            mapInst.on('click', onAnalysisClick);

        } catch (e) { console.warn('Failed to attach listeners or update layers', e); }

        recordMapPerfSample('ensureMapLayers', performance.now() - startedAt, {
            layerCount: mapInst.getStyle()?.layers?.length || 0
        });

    }, [onCropClick, onClusterClick, setPointer, resetPointer, onAnalysisClick]);

    useEffect(() => {
        if (map.current) return;
        let resizeRaf = null;
        let resizeObserver = null;
        let styleReadyHandled = false;
        let handleStyleReady = null;
        const mapInitStartedAt = performance.now();

        try {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: mapStyle || 'mapbox://styles/mapbox/standard',
                center: initialView.center,
                zoom: initialView.zoom,
                pitch: DEFAULT_MAP_PITCH,
                bearing: DEFAULT_MAP_BEARING,
                antialias: true,
                attributionControl: false,
                projection: 'globe'
            });

            map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
            map.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
            handleStyleReady = () => {
                if (styleReadyHandled) return;
                if (!map.current || !map.current.isStyleLoaded()) return;
                styleReadyHandled = true;
                mapLoadedRef.current = true;
                lastCropsFingerprintRef.current = '';
                lastDevicesFingerprintRef.current = '';
                lastMarkersFingerprintRef.current = '';
                lastSoloZonesFingerprintRef.current = '';
                lastHeatmapFingerprintRef.current = '';
                lastEtaFingerprintRef.current = '';
                selectedFeatureIdRef.current = null;
                ensureMapLayers(map.current);
                // Ensure all tasks are queued for initial processing
                ['markers', 'radars', 'soloZones', 'crops', 'selection', 'heatmap', 'eta'].forEach(
                    task => pendingMapSyncTasksRef.current.add(task)
                );
                runPendingMapSync();
                recordMapPerfSample('mapInitialStyleReady', performance.now() - mapInitStartedAt, {
                    style: currentStyleRef.current || mapStyle || 'default'
                });
            };

            map.current.on('load', handleStyleReady);
            map.current.once('style.load', handleStyleReady);
            scheduleMapSync('markers', 'radars', 'soloZones', 'crops', 'selection', 'heatmap', 'eta');
            
            resizeObserver = new ResizeObserver(() => {
                // Immediate resize via rAF for smooth visual update
                if (resizeRaf) cancelAnimationFrame(resizeRaf);
                resizeRaf = requestAnimationFrame(() => {
                    if (map.current) map.current.resize();
                });
            });
            if (mapContainer.current) {
                resizeObserver.observe(mapContainer.current);
            }

        } catch (error) { console.error('Map init error:', error); }

        return () => {
            resizeObserver?.disconnect();
            if (resizeRaf) {
                cancelAnimationFrame(resizeRaf);
                resizeRaf = null;
            }
            cleanupDevicePopup();
            cleanupTacticalPopup();
            cleanupETAPopup();

            Object.values(markersRef.current).forEach(marker => {
                const el = marker.getElement();
                if (el && el.__onClick) {
                    el.removeEventListener('click', el.__onClick);
                    delete el.__onClick;
                }
                marker.remove();
            });
            markersRef.current = {};

            if (map.current) {
                mapLoadedRef.current = false;
                selectedFeatureIdRef.current = null;
                if (mapSyncFrameRef.current) {
                    cancelAnimationFrame(mapSyncFrameRef.current);
                    mapSyncFrameRef.current = null;
                }
                if (handleStyleReady) {
                    map.current.off('load', handleStyleReady);
                    map.current.off('style.load', handleStyleReady);
                }
                map.current.remove();
                map.current = null;
            }
        };
    }, [ensureMapLayers, runPendingMapSync, scheduleMapSync]);

    useEffect(() => {
        if (!map.current || !hasValidCoordinates(hqLocation) || flyToLocation) return;
        const targetCoords = getLngLatFromLocation(hqLocation);
        if (!targetCoords) return;

        map.current.jumpTo({
            center: targetCoords,
            zoom: hqLocation.zoom || DEFAULT_MAP_ZOOM,
            pitch: DEFAULT_MAP_PITCH,
            bearing: DEFAULT_MAP_BEARING
        });
    }, [flyToLocation, hqLocation?.latitude, hqLocation?.longitude, hqLocation?.zoom]);

    const ensureMapLayersRef = useRef(ensureMapLayers);
    useEffect(() => { ensureMapLayersRef.current = ensureMapLayers; }, [ensureMapLayers]);
    const currentStyleRef = useRef(mapStyle);
    useEffect(() => {
        if (!map.current || !mapStyle || currentStyleRef.current === mapStyle) return;
        currentStyleRef.current = mapStyle;
        mapLoadedRef.current = false;
        map.current.setStyle(mapStyle);
        scheduleMapSync('markers', 'radars', 'soloZones', 'crops', 'selection', 'heatmap', 'eta');
        let styleHandled = false;
        const styleReloadStartedAt = performance.now();
        const onStyleLoad = () => {
            if (styleHandled) return;
            styleHandled = true;
            mapLoadedRef.current = true;
            lastCropsFingerprintRef.current = '';
            lastDevicesFingerprintRef.current = '';
            lastMarkersFingerprintRef.current = '';
            lastSoloZonesFingerprintRef.current = '';
            lastHeatmapFingerprintRef.current = '';
            lastEtaFingerprintRef.current = '';
            selectedFeatureIdRef.current = null;
            ensureMapLayersRef.current(map.current);
            // Force full resync of all data after style reload
            ['markers', 'radars', 'soloZones', 'crops', 'selection', 'heatmap', 'eta'].forEach(
                task => pendingMapSyncTasksRef.current.add(task)
            );
            runPendingMapSync();
            recordMapPerfSample('mapStyleReload', performance.now() - styleReloadStartedAt, {
                style: mapStyle
            });
        };
        map.current.once('style.load', onStyleLoad);
        // Fallback: 'idle' fires after the map finishes rendering the new style,
        // guaranteeing sources/layers can be safely added even if style.load was too early.
        const onIdle = () => {
            if (!map.current) return;
            ensureMapLayersRef.current(map.current);
            lastCropsFingerprintRef.current = '';
            lastDevicesFingerprintRef.current = '';
            lastMarkersFingerprintRef.current = '';
            lastSoloZonesFingerprintRef.current = '';
            lastHeatmapFingerprintRef.current = '';
            lastEtaFingerprintRef.current = '';
            selectedFeatureIdRef.current = null;
            ['markers', 'radars', 'soloZones', 'crops', 'selection', 'heatmap', 'eta'].forEach(
                task => pendingMapSyncTasksRef.current.add(task)
            );
            runPendingMapSync();
        };
        map.current.once('idle', onIdle);
        return () => {
            if (map.current) {
                map.current.off('style.load', onStyleLoad);
                map.current.off('idle', onIdle);
            }
        };
    }, [mapStyle, runPendingMapSync, scheduleMapSync]);

    const cropsFingerprint = useMemo(() => {
        if (!crops || !crops.length) return 'empty';
        return crops
            .map(getCropRenderSignature)
            .sort()
            .join('|');
    }, [crops]);
    const heatmapFingerprint = useMemo(() => {
        if (!crops || !crops.length) return 'empty';
        return crops
            .map(getHeatmapRenderSignature)
            .sort()
            .join('|');
    }, [crops]);

    useEffect(() => {
        if (cropsFingerprint !== lastReportedCropsFingerprintRef.current) {
            lastReportedCropsFingerprintRef.current = cropsFingerprint;
            bumpPerfCounter('map', 'cropsFingerprintChangeCount', {
                fingerprint: cropsFingerprint
            });
        }
        scheduleMapSync('crops');
    }, [bumpPerfCounter, cropsFingerprint, scheduleMapSync]);

    useEffect(() => {
        scheduleMapSync('selection');
    }, [scheduleMapSync, selectedDetectionId]);

    const devicesFingerprint = useMemo(() => {
        if (!devices || !devices.length) return 'empty';
        return devices
            .filter(d => hasValidCoordinates(d.location))
            .map(d => {
                const coords = getLngLatFromLocation(d.location);
                return coords ? `${d.id}:${d.name || ''}:${coords[0]}:${coords[1]}` : null;
            })
            .filter(Boolean)
            .join('|');
    }, [devices]);

    useEffect(() => {
        scheduleMapSync('markers', 'radars', 'soloZones');
    }, [devicesFingerprint, scheduleMapSync]);

    useEffect(() => {
        scheduleMapSync('soloZones');
    }, [scheduleMapSync, soloZoneConfig]);

    useEffect(() => {
        scheduleMapSync('heatmap');
    }, [heatmapFingerprint, scheduleMapSync, showHeatmap]);

    useEffect(() => {
        scheduleMapSync('eta');
    }, [etaTarget?.lat, etaTarget?.lng, scheduleMapSync, showETA]);

    useEffect(() => {
        if (!showETA) {
            lastEtaFingerprintRef.current = 'empty';
            cleanupETAPopup();
            if (map.current && map.current.isStyleLoaded()) {
                const source = map.current.getSource('source-eta-line');
                if (source) source.setData({ type: 'FeatureCollection', features: [] });
            }
        }
    }, [showETA, cleanupETAPopup]);

    const activeCrop = useMemo(() => {
        return selectedCrop || (selectedDetectionId && crops ? crops.find(c => c.crop_id === selectedDetectionId) : null);
    }, [selectedCrop, selectedDetectionId, crops]);

    useEffect(() => {
        if (!map.current) return;

        if (activeCrop && hasValidCoordinates(activeCrop.location)) {
            const activeCropFingerprint = `${activeCrop.crop_id}:${activeCrop.class}:${activeCrop.accuracy}:${toCoordinateNumber(activeCrop.location.latitude) ?? ''}:${toCoordinateNumber(activeCrop.location.longitude) ?? ''}`;
            if (activeCropFingerprint === lastActiveCropFingerprintRef.current) {
                return;
            }
            lastActiveCropFingerprintRef.current = activeCropFingerprint;
            const activeCropCoords = getLngLatFromLocation(activeCrop.location);
            if (!activeCropCoords) return;

            cleanupDevicePopup();
            cleanupTacticalPopup();
            const container = document.createElement('div');
            const root = createRoot(container);
            popupRootRef.current = root;
            root.render(<TacticalPopupContent crop={activeCrop} isAdmin={isAdmin} />);
            popupRef.current = new mapboxgl.Popup({
                closeButton: false, closeOnClick: false, maxWidth: '300px',
                className: 'tactical-popup-wrapper', offset: [10, 0]
            })
                .setLngLat(activeCropCoords)
                .setDOMContent(container)
                .addTo(map.current);
            bumpPerfCounter('popup', 'popupRecreateCount', {
                cropId: activeCrop.crop_id
            });

            if (activeCrop.crop_id !== lastFlyToId.current) {
                map.current.flyTo({ center: activeCropCoords, zoom: 19, speed: 2 });
                lastFlyToId.current = activeCrop.crop_id;
                bumpPerfCounter('map', 'flyToCount', {
                    reason: 'active_crop_selection',
                    cropId: activeCrop.crop_id
                });
            }
        } else {
            cleanupTacticalPopup();
            lastFlyToId.current = null;
            lastActiveCropFingerprintRef.current = '';
        }

    }, [activeCrop, isAdmin, bumpPerfCounter, cleanupDevicePopup, cleanupTacticalPopup]);


    useEffect(() => {
        if (map.current && flyToLocation) {
            console.log('[MapView] Flying to:', flyToLocation);

            if (!flyToLocation.center ||
                !Array.isArray(flyToLocation.center) ||
                flyToLocation.center.length !== 2 ||
                !Number.isFinite(flyToLocation.center[0]) ||
                !Number.isFinite(flyToLocation.center[1])) {
                console.warn('[MapView] Invalid center coordinates for flyTo:', flyToLocation);
                return;
            }

            const flyOptions = {
                center: flyToLocation.center,
                zoom: flyToLocation.zoom || 15,
                speed: 1.5,
                essential: true
            };

            if (flyToLocation.pitch !== undefined) {
                flyOptions.pitch = flyToLocation.pitch;
            }

            if (flyToLocation.bearing !== undefined) {
                flyOptions.bearing = flyToLocation.bearing;
            }

            try {
                map.current.flyTo(flyOptions);
                bumpPerfCounter('map', 'flyToCount', {
                    reason: 'external_flyTo',
                    center: flyOptions.center
                });
            } catch (e) {
                console.error('[MapView] FlyTo error:', e);
            }
        }
    }, [bumpPerfCounter, flyToLocation]);

    return (
        <div className="absolute inset-0 w-full h-full">
            <style>{MAP_STYLES}</style>
            <div ref={mapContainer} className="w-full h-full bg-black" />

        </div>
    )
}

export default memo(MapView);
