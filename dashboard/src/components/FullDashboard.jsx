import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import mapboxgl from 'mapbox-gl';
import api from '../services/api';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ';

const FIRE_SMOKE_CLASSES = ['fire', 'flame', 'yangin', 'ates', 'smoke', 'duman'];

const getThreatInfo = (cls, accuracy) => {
    const c = cls?.toLowerCase() || '';
    let level = Number(accuracy);
    if (Number.isFinite(level)) {
        if (level > 0 && level <= 1) level *= 100;
        level = Math.max(0, Math.min(100, level));
    } else {
        level = 0;
    }

    if (FIRE_SMOKE_CLASSES.includes(c)) return { level, type: 'red', color: '#ef4444' };
    return { level, type: 'green', color: '#22c55e' };
};

const SafeImage = memo(({ src, className, alt, fallbackSrc = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSIjMWExYTFhIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzQ0NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgYWxpZ25tZW50LWJhc2VsaW5lPSJtaWRkbGUiPk5PIElNRzwvdGV4dD48L3N2Zz4=' }) => {
    return (
        <img
            src={src}
            className={className}
            alt={alt}
            loading="lazy"
            onError={(e) => {
                if (e.currentTarget.src !== fallbackSrc) {
                    e.currentTarget.src = fallbackSrc;
                }
            }}
        />
    );
});

const THREAT_COLORS = {
    red: 'bg-red-500',
    yellow: 'bg-yellow-500', 
    green: 'bg-green-500'
};

const ThreatLevelBar = memo(({ level, threatType }) => {
    const activeCount = Math.ceil(level / 10);
    const activeClass = THREAT_COLORS[threatType] || THREAT_COLORS.green;

    return (
        <div className="flex items-center gap-0.5">
            {[...Array(10)].map((_, i) => (
                <div
                    key={i}
                    className={`w-2 h-3 rounded-sm transition-all ${i < activeCount ? `${activeClass} opacity-100` : 'bg-gray-800 opacity-30'}`}
                />
            ))}
        </div>
    );
});

const TransferProgressBar = memo(({ transfers }) => {
    if (!transfers || transfers.length === 0) return null;

    return (
        <div className="bg-gray-900/90 border border-cyan-500/30 rounded-lg p-3 mb-3">
            <div className="text-xs text-cyan-400 font-semibold mb-2 flex items-center gap-2">
                <span className="animate-pulse">●</span> ACTIVE TRANSFERS
            </div>
            {transfers.map(t => (
                <div key={t.transfer_id} className="mb-2 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300">{t.filename}</span>
                        <span className="text-cyan-400">{t.percent}% [{t.chunks_received}/{t.chunks_total}]</span>
                    </div>
                    <div className="progress-bar-container">
                        <div className="progress-bar-fill" style={{ width: `${t.percent}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
});

const DetectionCard = memo(({ crop, onViewDetails, onViewContext, onFlyToLocation }) => {
    const threat = useMemo(() => getThreatInfo(crop.class, crop.accuracy), [crop.class, crop.accuracy]);
    const timeStr = useMemo(() => new Date(crop.captured_time).toLocaleTimeString(), [crop.captured_time]);

    const handleCardClick = (e) => {
        if (e.target.closest('button')) return;
        if (onFlyToLocation && crop.location?.latitude && crop.location?.longitude) {
            onFlyToLocation(crop.location.longitude, crop.location.latitude, crop);
        }
    };

    return (
        <div 
            className="bg-black border border-gray-900 rounded-xl overflow-hidden hover:border-gray-700 transition-all duration-200 group cursor-pointer"
            onClick={handleCardClick}
        >
            {}
            <div className="min-h-[2rem] px-2 sm:px-3 border-b border-gray-900 flex justify-between items-center bg-gray-950 gap-1 py-1">
                <div className="flex items-center gap-1 min-w-0 flex-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${threat.color === '#ef4444' ? 'bg-red-500' : threat.color === '#eab308' ? 'bg-yellow-500' : 'bg-green-500'}`}></span>
                    <span className="text-[9px] sm:text-[10px] font-bold text-white uppercase tracking-wider truncate">{crop.class}</span>
                </div>
                <span className="text-[8px] sm:text-[9px] font-mono text-gray-500 flex-shrink-0 whitespace-nowrap ml-1">{timeStr}</span>
            </div>

            {}
            <div className="h-20 grid grid-cols-2 border-b border-gray-800">
                <div className="relative border-r border-gray-800 bg-black overflow-hidden">
                    <SafeImage
                        src={`/api/image/crop/${crop.crop_id}`}
                        className="w-full h-full object-contain"
                        alt="Crop"
                    />
                    <span className="absolute bottom-0.5 left-0.5 text-[7px] bg-black/70 text-gray-400 px-0.5 rounded uppercase">Crop</span>
                </div>
                <div className="relative bg-black overflow-hidden">
                    <SafeImage
                        src={`/api/image/fullframe/${crop.record_id}`}
                        className="w-full h-full object-cover"
                        alt="Full"
                    />
                    <span className="absolute bottom-0.5 left-0.5 text-[7px] bg-black/70 text-gray-400 px-0.5 rounded uppercase">Full</span>
                </div>
            </div>

            {}
            <div className="p-2 space-y-1 text-[10px]">
                <div className="flex justify-between">
                    <span className="text-gray-500">ID</span>
                    <span className="text-cyan-400 font-mono text-[9px]">#{crop.crop_id?.slice(0, 12)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Device</span>
                    <span className="text-white font-mono">{crop.device_id || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Location</span>
                    <span className="text-cyan-400 font-mono text-[9px]">{crop.location?.latitude?.toFixed(4)}, {crop.location?.longitude?.toFixed(4)}</span>
                </div>
                <div className="pt-1.5 mt-1 border-t border-gray-800/50">
                    <div className="flex justify-between items-center">
                        <span className="text-[8px] text-gray-600 uppercase">Threat Level</span>
                        <ThreatLevelBar level={threat.level} threatType={threat.type} />
                    </div>
                </div>
            </div>

            {}
            <div className="p-1.5 border-t border-gray-800">
                <button
                    onClick={() => onViewDetails ? onViewDetails(crop) : onViewContext(crop)}
                    className="w-full py-1.5 bg-gray-800/50 hover:bg-cyan-900/30 text-gray-400 hover:text-cyan-400 rounded text-[10px] font-medium transition-all border border-transparent hover:border-cyan-800"
                >
                    VIEW DETAILS
                </button>
            </div>
        </div>
    );
});

const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
};

export default function FullDashboard({ detections = [], onClose, onViewContext, onViewDetails, onViewOnMap, isAdmin }) {
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300); 
    const [visibleCount, setVisibleCount] = useState(48); 
    const observerTarget = useRef(null);
    const mapContainer = useRef(null);
    const map = useRef(null);
    const popupRef = useRef(null);
    const didFitBounds = useRef(false);
    const markersRef = useRef([]);
    const mapLoadedRef = useRef(false); 
    const mapEventsBoundRef = useRef(false); 
    const [activeTransfers, setActiveTransfers] = useState([]);
    const detectionsRef = useRef(detections);
    const filteredDetectionsRef = useRef([]);
    const geoJsonDataRef = useRef(null); 
    const filteredDetections = useMemo(() => {
        const term = debouncedSearchTerm.toLowerCase();
        return detections.filter(d =>
            d.class?.toLowerCase().includes(term) ||
            d.crop_id?.toString().toLowerCase().includes(term) ||
            d.device_id?.toLowerCase().includes(term)
        );
    }, [detections, debouncedSearchTerm]);

    const visibleDetections = useMemo(() => filteredDetections.slice(0, visibleCount), [filteredDetections, visibleCount]);
    const hasMore = visibleDetections.length < filteredDetections.length;
    const geoJsonData = useMemo(() => ({
        type: 'FeatureCollection',
        features: filteredDetections
            .filter(d => d.location?.latitude && d.location?.longitude)
            .map(d => {
                const threat = getThreatInfo(d.class, d.accuracy);
                let score = 1;
                if (threat.type === 'red') score = 3;
                else if (threat.type === 'yellow') score = 2;

                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [d.location.longitude, d.location.latitude]
                    },
                    properties: {
                        id: d.crop_id,
                        class: d.class,
                        accuracy: d.accuracy,
                        color: threat.color,
                        threat_score: score
                    }
                };
            })
    }), [filteredDetections]);


    useEffect(() => {
        detectionsRef.current = detections;
    }, [detections]);

    useEffect(() => {
        filteredDetectionsRef.current = filteredDetections;
    }, [filteredDetections]);

    useEffect(() => {
        geoJsonDataRef.current = geoJsonData;
    }, [geoJsonData]);

    useEffect(() => {
        const controller = new AbortController();
        
        const pollTransfers = async () => {
            if (document.hidden) return; 

            try {
                const data = await api.getActiveTransfers(controller.signal);
                setActiveTransfers(prev => {
                    const next = data.transfers || [];
                    const getHash = (arr) => [...arr]
                        .sort((a,b) => String(a.transfer_id).localeCompare(String(b.transfer_id)))
                        .map(t => `${t.transfer_id}:${t.percent}:${t.chunks_received}:${t.chunks_total}:${t.filename}`)
                        .join('|');
                    
                    return getHash(prev) === getHash(next) ? prev : next;
                });
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error('Transfer polling error:', e);
                }
            }
        };

        pollTransfers();
        const interval = setInterval(pollTransfers, 5000); 
        return () => {
            controller.abort();
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        setVisibleCount(48);
        didFitBounds.current = false;
    }, [debouncedSearchTerm, detections.length]);

    const observerRef = useRef(null);

    useEffect(() => {
        observerRef.current = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    const total = filteredDetectionsRef.current.length;
                    setVisibleCount(prev => Math.min(prev + 48, total));
                }
            },
            { threshold: 0.1 }
        );

        return () => observerRef.current?.disconnect();
    }, []);

    useEffect(() => {
        const target = observerTarget.current;
        const obs = observerRef.current;
        
        if (target && obs) {
            obs.observe(target);
            return () => obs.unobserve(target);
        }
    }, [hasMore, visibleDetections.length]); 

    const updateMarkers = () => {
        if (!map.current || !mapLoadedRef.current) return;

        markersRef.current.forEach(marker => marker.remove());
        markersRef.current = [];
        const currentDetections = detectionsRef.current;
        const currentGeoJson = geoJsonDataRef.current || { type: 'FeatureCollection', features: [] };
        const locationGroups = {};
        currentGeoJson.features.forEach(feature => {
            const cropId = feature.properties.id;
            const detection = currentDetections.find(d => String(d.crop_id) === String(cropId));
            if (!detection || !detection.location) return;
            
            const locKey = `${detection.location.latitude.toFixed(5)}_${detection.location.longitude.toFixed(5)}`;
            if (!locationGroups[locKey]) {
                locationGroups[locKey] = [];
            }
            locationGroups[locKey].push({ feature, detection, cropId });
        });

        Object.values(locationGroups).forEach(group => {
            const count = group.length;
            const baseLat = group[0].detection.location.latitude;
            const baseLng = group[0].detection.location.longitude;
            
            const offsetRadius = 0.0003; 
            
            group.forEach((item, index) => {
                const { detection, cropId } = item;
                let finalLat = baseLat;
                let finalLng = baseLng;
                
                if (count > 1) {
                    const angle = (2 * Math.PI * index) / count - Math.PI / 2; 
                    finalLat = baseLat + offsetRadius * Math.sin(angle);
                    finalLng = baseLng + offsetRadius * Math.cos(angle);
                }

                const threat = getThreatInfo(detection.class, detection.accuracy);
                const el = document.createElement('div');
                el.className = 'crop-map-marker-container';
                const markerClass = threat.type === 'red' ? 'crop-map-marker-red' :
                                   threat.type === 'yellow' ? 'crop-map-marker-yellow' : 'crop-map-marker-green';

                const visual = document.createElement('div');
                visual.className = `crop-map-marker ${markerClass}`;

                const img = document.createElement('img');
                img.src = `/api/image/crop/${cropId}`;
                img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                img.onerror = () => {
                    img.style.display = 'none';
                    visual.innerHTML = `<div class="crop-map-marker-fallback">NO IMG</div>`;
                };
                visual.appendChild(img);
                el.appendChild(visual);
                el.addEventListener('mouseenter', () => {
                    el.style.zIndex = '100';
                });
                el.addEventListener('mouseleave', () => {
                    el.style.zIndex = 'auto';
                });
                el.addEventListener('click', () => {
                    if (onViewOnMap) onViewOnMap(detection);
                });

                const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
                    .setLngLat([finalLng, finalLat])
                    .addTo(map.current);

                markersRef.current.push(marker);
            });
        });
    };

    useEffect(() => {
        if (!map.current || !mapLoadedRef.current) return;
        
        const source = map.current.getSource('detections');
        if (source) {
            source.setData(geoJsonData);
        }

        updateMarkers();

        if (!didFitBounds.current && geoJsonData.features.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            geoJsonData.features.forEach(feature => bounds.extend(feature.geometry.coordinates));
            if (!bounds.isEmpty()) {
                setTimeout(() => {
                    if (map.current) {
                        map.current.fitBounds(bounds, { padding: 50, maxZoom: 15 });
                        didFitBounds.current = true;
                    }
                }, 100);
            }
        }
    }, [geoJsonData, onViewOnMap]);

    useEffect(() => {
        if (!mapContainer.current || map.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            center: [35.2433, 38.9637],
            zoom: 6,
            attributionControl: false
        });

        map.current.addControl(new mapboxgl.NavigationControl(), 'top-left');

        map.current.on('load', () => {
            if (mapEventsBoundRef.current) return; 
            mapEventsBoundRef.current = true;
            mapLoadedRef.current = true;
            const initialData = geoJsonDataRef.current || { type: 'FeatureCollection', features: [] };

            map.current.addSource('detections', {
                type: 'geojson',
                data: initialData,
                cluster: false 
            });

        
            updateMarkers();
            
            if (initialData.features.length > 0) {
                const bounds = new mapboxgl.LngLatBounds();
                initialData.features.forEach(feature => bounds.extend(feature.geometry.coordinates));
                if (!bounds.isEmpty()) {
                    map.current.fitBounds(bounds, { padding: 50, maxZoom: 15 });
                    didFitBounds.current = true;
                }
            }
        });

        return () => {
            markersRef.current.forEach(marker => marker.remove());
            markersRef.current = [];
            
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
            popupRef.current?.remove();
        };
    }, []); 

    return (
        <div className="absolute inset-0 z-50 bg-black flex flex-col animate-in fade-in duration-200">
            {}
            <div className="h-14 border-b border-gray-900 flex items-center justify-between px-6 bg-black shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-1.5 h-6 bg-cyan-500 rounded-full"></div>
                    <h1 className="text-sm font-bold text-white tracking-wider uppercase">Analytics</h1>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[10px] text-gray-600 font-mono bg-gray-950 px-2 py-1 rounded">TOTAL: {detections.length}</span>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search ID, Class, Device..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-60 bg-gray-950 border border-gray-900 rounded-lg px-4 py-2 text-xs text-gray-300 focus:border-gray-700 focus:outline-none transition-colors placeholder-gray-600"
                        />
                        <svg className="w-4 h-4 text-gray-600 absolute right-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-950 hover:bg-gray-900 border border-gray-900 hover:border-gray-800 rounded-lg transition-colors text-gray-500 hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {}
            <div className="h-80 border-b border-gray-900 relative shrink-0">
                <div ref={mapContainer} className="w-full h-full" />
            </div>

            {}
            <div className="flex-1 overflow-y-auto p-4 bg-black custom-scrollbar">
                <TransferProgressBar transfers={activeTransfers} />

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                    {visibleDetections.map((crop) => (
                        <DetectionCard 
                            key={crop.crop_id}
                            crop={crop}
                            onViewDetails={onViewDetails}
                            onViewContext={onViewContext}
                            onFlyToLocation={(lng, lat, detection) => {
                                if (map.current) {
                                    map.current.flyTo({
                                        center: [lng, lat],
                                        zoom: 18,
                                        duration: 1500,
                                        essential: true
                                    });
                                }
                            }}
                        />
                    ))}
                </div>
                
                {}
                {visibleDetections.length < filteredDetections.length && (
                    <div ref={observerTarget} className="h-10 flex items-center justify-center text-gray-600 text-xs tracking-wider">
                        LOADING MORE...
                    </div>
                )}
            </div>
        </div>
    );
}
