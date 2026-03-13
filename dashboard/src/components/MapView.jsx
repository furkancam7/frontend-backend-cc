import React, { useRef, useEffect, useCallback, useMemo, memo } from 'react'
import mapboxgl from 'mapbox-gl'
import { createRoot } from 'react-dom/client'
import { MAP_STYLES } from './map-parts/mapStyles'
import { createGeoJSONCircle } from './map-parts/mapUtils'
import { createSoloZonesGeoJSON, getZonePaintProperties, SOLO_ZONE_CONFIG } from './map-parts/sectorUtils'
import TacticalPopupContent from './map-parts/TacticalPopupContent'
import DevicePopupContent from './map-parts/DevicePopupContent'
import { createHeatmapGeoJSON, createETALineGeoJSON, haversineDistance, calculateETA, getMidpoint, spreadOverlappingDetections } from './map-parts/analysisUtils'
import ETAInfoPanel from './map-parts/ETAInfoPanel'
import { ANALYSIS } from '../constants'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ'

const DEFAULT_MAP_CENTER = [20.49456016, 44.55221753];
const DEFAULT_MAP_ZOOM = 16;
const DEFAULT_MAP_PITCH = 60;
const DEFAULT_MAP_BEARING = -17.6;

const hasValidCoordinates = (location) =>
    Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);

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
                    'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 10, 7],
                    'circle-color': ['get', 'color'],
                    'circle-stroke-width': ['case', ['boolean', ['get', 'selected'], false], 2, 1.5],
                    'circle-stroke-color': ['case', ['boolean', ['get', 'selected'], false], '#ffffff', ['get', 'borderColor']]
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
                    'text-color': ['get', 'color'],
                    'text-halo-color': '#000000',
                    'text-halo-width': 2
                }
            });
        }
    } catch (e) { console.warn('[MapLayer] Crop Layers init failed', e); }
};

const addRadarLayers = (map) => {
    const deviceSource = 'device-radars';
    try {
        if (!map.getSource(deviceSource)) {
            map.addSource(deviceSource, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer('device-radars-layer')) {
            map.addLayer({
                id: 'device-radars-layer',
                type: 'fill',
                source: deviceSource,
                paint: { 'fill-color': '#06b6d4', 'fill-opacity': 0.1 }
            });
        }
        if (!map.getLayer('device-radars-outline')) {
            map.addLayer({
                id: 'device-radars-outline',
                type: 'line',
                source: deviceSource,
                paint: { 'line-color': '#06b6d4', 'line-width': 1, 'line-dasharray': [2, 2] }
            });
        }
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
    showHubs = true,
    showSolos = true,
    showDetections = true,
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
    const dataRef = useRef({ devices, crops, showDetections, selectedDetectionId, isAdmin, showHubs, showSolos, soloZoneConfig, showHeatmap, showETA, etaTarget, hqLocation, analysisMode });
    const lastCropsFingerprintRef = useRef('');
    const lastDevicesFingerprintRef = useRef('');
    const lastMarkersFingerprintRef = useRef('');
    const lastSoloZonesFingerprintRef = useRef('');
    const lastHeatmapFingerprintRef = useRef('');
    const lastEtaFingerprintRef = useRef('');
    const etaPopupRef = useRef(null);
    const etaPopupRootRef = useRef(null);
    const onMapAnalysisClickRef = useRef(onMapAnalysisClick);

    useEffect(() => { onCropSelectRef.current = onCropSelect; }, [onCropSelect]);
    useEffect(() => { onMapAnalysisClickRef.current = onMapAnalysisClick; }, [onMapAnalysisClick]);
    useEffect(() => {
        dataRef.current = { devices, crops, showDetections, selectedDetectionId, isAdmin, showHubs, showSolos, soloZoneConfig, showHeatmap, showETA, etaTarget, hqLocation, analysisMode };
    }, [devices, crops, showDetections, selectedDetectionId, isAdmin, showHubs, showSolos, soloZoneConfig, showHeatmap, showETA, etaTarget, hqLocation, analysisMode]);

    const markersRef = useRef({});
    const popupRef = useRef(null);
    const popupRootRef = useRef(null);
    const devicePopupRef = useRef(null);
    const lastFlyToId = useRef(null);
    const lastActiveCropFingerprintRef = useRef('');
    const initialView = hasValidCoordinates(hqLocation)
        ? {
            center: [hqLocation.longitude, hqLocation.latitude],
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
            const cropId = feature.properties.id;
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
            .setLngLat([freshDevice.location.longitude, freshDevice.location.latitude])
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
    const triggerCropUpdate = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        const currentCrops = dataRef.current.crops || [];
        const currentShowDetections = dataRef.current.showDetections;
        const currentSelectedDetectionId = dataRef.current.selectedDetectionId;

        if (!currentShowDetections || !currentCrops.length) {
            if (lastCropsFingerprintRef.current !== 'empty') {
                lastCropsFingerprintRef.current = 'empty';
                const source = map.current.getSource('source-crops-data');
                if (source) source.setData({ type: 'FeatureCollection', features: [] });
            }
            return;
        }

        const fingerprint = currentCrops
            .map(c => [
                c.crop_id,
                c.class || '',
                c.location?.latitude ?? '',
                c.location?.longitude ?? '',
                c.raw?.updated_at || '',
                c.raw?.image_status || '',
            ].join(':'))
            .sort()
            .join('|');
        const nextFingerprint = `${currentShowDetections}:${currentSelectedDetectionId}:${fingerprint}`;
        if (nextFingerprint === lastCropsFingerprintRef.current) {
            return;
        }
        lastCropsFingerprintRef.current = nextFingerprint;
        const validCrops = currentCrops.filter(c => c && c.location?.latitude && c.location?.longitude);
        const spreadMap = spreadOverlappingDetections(validCrops, 30);
        const features = validCrops
            .map(c => {
                let color = '#4ade80';
                let borderColor = '#22c55e';
                const cls = (c.class || '').toLowerCase();
                if (['person', 'human'].includes(cls)) { color = '#f87171'; borderColor = '#ef4444'; }
                else if (['car', 'truck', 'bus'].includes(cls)) { color = '#facc15'; borderColor = '#eab308'; }

                const offset = spreadMap.get(c.crop_id);
                const lng = offset ? offset.lng : c.location.longitude;
                const lat = offset ? offset.lat : c.location.latitude;

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: {
                        id: c.crop_id,
                        class: (c.class || 'UNK').toUpperCase(),
                        color,
                        borderColor,
                        selected: currentSelectedDetectionId === c.crop_id
                    }
                };
            });

        const source = map.current.getSource('source-crops-data');
        if (source) {
            source.setData({ type: 'FeatureCollection', features });
        }
    }, []);

    const updateDeviceRadars = useCallback(() => {
        if (!map.current) return;
        
        const source = map.current.getSource('device-radars');
        if (!source) return;
        
        const currentDevices = dataRef.current.devices || [];
        const shouldShowHubs = dataRef.current.showHubs !== false;
        
        if (!shouldShowHubs) {
            source.setData({ type: 'FeatureCollection', features: [] });
            lastDevicesFingerprintRef.current = 'hidden';
            return;
        }
        
        const coverageDevices = currentDevices.filter(d => {
            if (!d?.location?.latitude || !d?.location?.longitude) return false;
            const deviceId = String(d.id || '').toUpperCase();
            return !deviceId.startsWith('SOLO');
        });
        
        const fingerprint = `visible:${coverageDevices.map(d => `${d.id}:${d.location.longitude}:${d.location.latitude}`).join('|')}`;
        if (fingerprint === lastDevicesFingerprintRef.current) return;
        lastDevicesFingerprintRef.current = fingerprint;
        
        const features = coverageDevices.map(d =>
            createGeoJSONCircle([d.location.longitude, d.location.latitude], 10, 16)
        );
        
        source.setData({ type: 'FeatureCollection', features });
    }, []);
    
    const updateSoloZones = useCallback(() => {
        if (!map.current || !map.current.isStyleLoaded()) return;
        
        const currentDevices = dataRef.current.devices || [];
        const shouldShowSolos = dataRef.current.showSolos;
        const allConfigs = dataRef.current.soloZoneConfig; 
        const soloDevices = shouldShowSolos ? currentDevices.filter(d => 
            d.id?.toUpperCase().startsWith('SOLO') && 
            d.location?.latitude && 
            d.location?.longitude
        ) : [];
        const fingerprint = `${shouldShowSolos}:${soloDevices.map(d => `${d.id}:${d.location.longitude}:${d.location.latitude}`).join('|')}:${JSON.stringify(allConfigs || {})}`;
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
        const { crops: cropsData, showDetections: showDet, showHeatmap: showHeat } = dataRef.current;
        if (!showHeat || !showDet || !cropsData?.length) {
            if (lastHeatmapFingerprintRef.current !== 'empty') {
                lastHeatmapFingerprintRef.current = 'empty';
                source.setData({ type: 'FeatureCollection', features: [] });
            }
            return;
        }
        const fingerprint = `${cropsData.length}:${cropsData.map(c => `${c.crop_id}:${c.raw?.updated_at || ''}:${c.raw?.image_status || ''}`).join('|')}`;
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
        const currentShowHubs = dataRef.current.showHubs;
        const currentShowSolos = dataRef.current.showSolos;
        const visibleDevices = currentDevices.filter(device => {
            if (!device.location) return false;
            const isHub = device.id.toLowerCase().includes('hub');
            const isSolo = device.id.toLowerCase().includes('solo');
            if (isHub && !currentShowHubs) return false;
            if (isSolo && !currentShowSolos) return false;
            return true;
        });

        const fingerprint = `${currentShowHubs}:${currentShowSolos}:${visibleDevices.map(device => `${device.id}:${device.name}:${device.location.longitude}:${device.location.latitude}`).join('|')}`;
        if (fingerprint === lastMarkersFingerprintRef.current) return;
        lastMarkersFingerprintRef.current = fingerprint;

        const newActiveIds = new Set();
        visibleDevices.forEach(device => {
            const id = `device-${device.id}`;
            newActiveIds.add(id);

            if (markersRef.current[id]) {
                markersRef.current[id].setLngLat([device.location.longitude, device.location.latitude]);
                return;
            }

            const el = document.createElement('div');
            el.className = 'device-marker cursor-pointer flex flex-col items-center';
            el.dataset.deviceId = device.id;

            const icon = document.createElement('div');
            icon.className = "w-6 h-6 rounded-full border-2 border-cyan-500 bg-black/80 flex items-center justify-center shadow-[0_0_10px_rgba(6,182,212,0.4)]";
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
                .setLngLat([device.location.longitude, device.location.latitude])
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
        mapSyncFrameRef.current = null;

        if (!map.current || !mapLoadedRef.current || !map.current.isStyleLoaded()) return;

        const tasks = Array.from(pendingMapSyncTasksRef.current);
        pendingMapSyncTasksRef.current.clear();
        tasks.forEach((task) => {
            switch (task) {
                case 'markers':
                    syncDeviceMarkers();
                    break;
                case 'radars':
                    updateDeviceRadars();
                    break;
                case 'soloZones':
                    updateSoloZones();
                    break;
                case 'crops':
                    triggerCropUpdate();
                    break;
                case 'heatmap':
                    updateHeatmap();
                    break;
                case 'eta':
                    updateETALine();
                    break;
                default:
                    break;
            }
        });
    }, [syncDeviceMarkers, triggerCropUpdate, updateDeviceRadars, updateETALine, updateHeatmap, updateSoloZones]);

    const scheduleMapSync = useCallback((...tasks) => {
        if (!map.current || !mapLoadedRef.current) return;

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
        if (!mapInst || !mapInst.isStyleLoaded()) return;
        addTerrainAndSky(mapInst);
        addHeatmapLayer(mapInst);
        addRadarLayers(mapInst);
        addSoloZoneLayers(mapInst);
        addCropLayers(mapInst);
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

    }, [onCropClick, onClusterClick, setPointer, resetPointer, onAnalysisClick]);

    useEffect(() => {
        if (map.current) return;
        let resizeRaf = null;
        let resizeObserver = null;

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

            map.current.addControl(new mapboxgl.NavigationControl(), 'top-left');
            map.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
            map.current.on('load', () => {
                mapLoadedRef.current = true;
                lastCropsFingerprintRef.current = '';
                lastDevicesFingerprintRef.current = '';
                lastMarkersFingerprintRef.current = '';
                lastSoloZonesFingerprintRef.current = '';
                lastHeatmapFingerprintRef.current = '';
                lastEtaFingerprintRef.current = '';
                ensureMapLayers(map.current);
                scheduleMapSync('markers', 'radars', 'soloZones', 'crops', 'heatmap', 'eta');
            });
            
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
                if (mapSyncFrameRef.current) {
                    cancelAnimationFrame(mapSyncFrameRef.current);
                    mapSyncFrameRef.current = null;
                }
                map.current.remove();
                map.current = null;
            }
        };
    }, [ensureMapLayers, scheduleMapSync]);

    useEffect(() => {
        if (!map.current || !hasValidCoordinates(hqLocation) || flyToLocation) return;

        map.current.jumpTo({
            center: [hqLocation.longitude, hqLocation.latitude],
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
        map.current.setStyle(mapStyle);
        const onStyleLoad = () => {
            lastCropsFingerprintRef.current = '';
            lastDevicesFingerprintRef.current = '';
            lastMarkersFingerprintRef.current = '';
            lastSoloZonesFingerprintRef.current = '';
            lastHeatmapFingerprintRef.current = '';
            lastEtaFingerprintRef.current = '';
            ensureMapLayersRef.current(map.current);
            scheduleMapSync('markers', 'radars', 'soloZones', 'crops', 'heatmap', 'eta');
        };
        map.current.once('style.load', onStyleLoad);
        return () => {
            if (map.current) map.current.off('style.load', onStyleLoad);
        };
    }, [mapStyle, scheduleMapSync]);

    const cropsFingerprint = useMemo(() => {
        if (!crops || !crops.length) return 'empty';
        return crops
            .map(c => [
                c.crop_id,
                c.class || '',
                c.location?.latitude ?? '',
                c.location?.longitude ?? '',
                c.raw?.updated_at || '',
                c.raw?.image_status || '',
            ].join(':'))
            .sort()
            .join('|');
    }, [crops]);

    useEffect(() => {
        scheduleMapSync('crops');
    }, [cropsFingerprint, scheduleMapSync, selectedDetectionId, showDetections]);

    const devicesFingerprint = useMemo(() => {
        if (!devices || !devices.length) return 'empty';
        return devices
            .filter(d => d.location)
            .map(d => `${d.id}:${d.name || ''}:${d.location.longitude}:${d.location.latitude}`)
            .join('|');
    }, [devices]);

    useEffect(() => {
        scheduleMapSync('markers', 'radars', 'soloZones');
    }, [devicesFingerprint, scheduleMapSync, showHubs, showSolos]);

    useEffect(() => {
        scheduleMapSync('soloZones');
    }, [scheduleMapSync, soloZoneConfig]);

    useEffect(() => {
        scheduleMapSync('heatmap');
    }, [cropsFingerprint, scheduleMapSync, showDetections, showHeatmap]);

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

        if (activeCrop && activeCrop.location) {
            const activeCropFingerprint = `${activeCrop.crop_id}:${activeCrop.class}:${activeCrop.accuracy}:${activeCrop.location.latitude}:${activeCrop.location.longitude}:${activeCrop.raw?.updated_at || ''}:${activeCrop.raw?.image_status || ''}`;
            if (activeCropFingerprint === lastActiveCropFingerprintRef.current) {
                return;
            }
            lastActiveCropFingerprintRef.current = activeCropFingerprint;

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
                .setLngLat([activeCrop.location.longitude, activeCrop.location.latitude])
                .setDOMContent(container)
                .addTo(map.current);

            if (activeCrop.crop_id !== lastFlyToId.current) {
                map.current.flyTo({ center: [activeCrop.location.longitude, activeCrop.location.latitude], zoom: 19, speed: 2 });
                lastFlyToId.current = activeCrop.crop_id;
            }
        } else {
            cleanupTacticalPopup();
            lastFlyToId.current = null;
            lastActiveCropFingerprintRef.current = '';
        }

    }, [activeCrop, isAdmin, cleanupDevicePopup, cleanupTacticalPopup]);


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
            } catch (e) {
                console.error('[MapView] FlyTo error:', e);
            }
        }
    }, [flyToLocation]);

    return (
        <div className="absolute inset-0 w-full h-full">
            <style>{MAP_STYLES}</style>
            <div ref={mapContainer} className="w-full h-full bg-black" />

        </div>
    )
}

export default memo(MapView);
