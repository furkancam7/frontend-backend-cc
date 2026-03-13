import { useState, useCallback, useMemo, useEffect } from 'react';
import { HQ, UAE_BOUNDS } from '../constants';

const MAP_CONFIG = {
  DEFAULT_ZOOM: 18,
  DEFAULT_PITCH: 60,
  SEARCH_ZOOM: 15
};

const MAP_STYLES = [
  { name: 'Dark', url: 'mapbox://styles/mapbox/dark-v11', id: 'dark' },
  { name: 'Satellite', url: 'mapbox://styles/mapbox/satellite-streets-v12', id: 'satellite' },
  { name: 'Streets', url: 'mapbox://styles/mapbox/streets-v12', id: 'streets' },
  { name: 'Light', url: 'mapbox://styles/mapbox/light-v11', id: 'light' },
  { name: 'Outdoors', url: 'mapbox://styles/mapbox/outdoors-v12', id: 'outdoors' },
  { name: 'Navigation Night', url: 'mapbox://styles/mapbox/navigation-night-v1', id: 'nav-night' },
];

const STORAGE_KEY = 'mapPreferences';

const loadStoredPreferences = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[useMapUI] Failed to load stored preferences:', e);
  }
  return null;
};

const createFlyToLocation = (lng, lat, zoom = MAP_CONFIG.DEFAULT_ZOOM, pitch = MAP_CONFIG.DEFAULT_PITCH, bearing = undefined) => {
  const location = { center: [lng, lat], zoom, pitch };
  if (bearing !== undefined) location.bearing = bearing;
  return location;
};

export default function useMapUI(locations = null) {
  const stored = useMemo(() => loadStoredPreferences(), []);
  
  const [mapStyle, setMapStyle] = useState(stored?.mapStyle || 'mapbox://styles/mapbox/satellite-streets-v12');
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  const [isMapToolsOpen, setIsMapToolsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [flyToLocation, setFlyToLocation] = useState(null);
  const [searchInputValue, setSearchInputValue] = useState('');
  
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mapStyle
      }));
    } catch (e) {
      console.warn('[useMapUI] Failed to save preferences:', e);
    }
  }, [mapStyle]);

  const handleSearch = useCallback((e) => {
    if (e.key === 'Enter') {
      const parts = searchInputValue.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);

        if (!isNaN(lat) && !isNaN(lng) &&
            lat >= -90 && lat <= 90 &&
            lng >= -180 && lng <= 180) {
          setFlyToLocation(createFlyToLocation(lng, lat, MAP_CONFIG.SEARCH_ZOOM, MAP_CONFIG.DEFAULT_PITCH));
        }
      }
    }
  }, [searchInputValue]);

  const handleMapStyleChange = useCallback((styleUrl) => {
    setMapStyle(styleUrl);
    setIsStyleMenuOpen(false);
  }, []);

  const toggleStyleMenu = useCallback(() => {
    setIsStyleMenuOpen(prev => !prev);
  }, []);

  const toggleMapTools = useCallback(() => {
    setIsMapToolsOpen(prev => !prev);
  }, []);

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen(prev => !prev);
  }, []);

  const flyToCoordinates = useCallback((lng, lat, zoom, pitch, bearing) => {
    setFlyToLocation(createFlyToLocation(lng, lat, zoom, pitch, bearing));
  }, []);

  const flyToDevice = useCallback((device) => {
    if (!device) return;

    const targetLat = device.location?.latitude;
    const targetLng = device.location?.longitude;

    if (targetLat && targetLng) {
      setFlyToLocation(createFlyToLocation(targetLng, targetLat, MAP_CONFIG.DEFAULT_ZOOM, MAP_CONFIG.DEFAULT_PITCH));
    }
  }, []);

  const flyToDetection = useCallback((detection) => {
    if (detection?.location?.latitude && detection?.location?.longitude) {
      setFlyToLocation(createFlyToLocation(
        detection.location.longitude,
        detection.location.latitude
      ));
    }
  }, []);

  const flyToHome = useCallback(() => {
    const home = locations?.home || { latitude: HQ.LATITUDE, longitude: HQ.LONGITUDE, zoom: HQ.ZOOM };
    setFlyToLocation(createFlyToLocation(
      home.longitude,
      home.latitude,
      home.zoom || HQ.ZOOM,
      MAP_CONFIG.DEFAULT_PITCH
    ));
  }, [locations]);

  const flyToResponsibleArea = useCallback(() => {
    const area = locations?.responsibleArea || { latitude: UAE_BOUNDS.CENTER.lat, longitude: UAE_BOUNDS.CENTER.lng, zoom: UAE_BOUNDS.ZOOM };
    setFlyToLocation({
      center: [area.longitude, area.latitude],
      zoom: area.zoom || UAE_BOUNDS.ZOOM,
      pitch: 0,
      bearing: 0
    });
  }, [locations]);

  return {
    mapStyle,
    isStyleMenuOpen,
    isMapToolsOpen,
    isFullScreen,
    flyToLocation,
    searchInputValue,
    MAP_STYLES,
    MAP_CONFIG,

    setSearchInputValue,
    setFlyToLocation,
    handleSearch,
    handleMapStyleChange,
    toggleStyleMenu,
    toggleMapTools,
    toggleFullScreen,
    flyToCoordinates,
    flyToDevice,
    flyToDetection,
    flyToHome,
    flyToResponsibleArea
  };
}
