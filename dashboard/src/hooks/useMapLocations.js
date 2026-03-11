import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { HQ, UAE_BOUNDS } from '../constants';

const STORAGE_KEY = 'mapLocations';
const CACHE_TTL = 5 * 60 * 1000; 

const DEFAULT_LOCATIONS = {
  home: {
    name: 'Headquarters',
    latitude: HQ.LATITUDE,
    longitude: HQ.LONGITUDE,
    zoom: HQ.ZOOM
  },
  responsibleArea: {
    name: 'UAE',
    latitude: UAE_BOUNDS.CENTER.lat,
    longitude: UAE_BOUNDS.CENTER.lng,
    zoom: UAE_BOUNDS.ZOOM
  }
};

const loadCachedLocations = () => {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return data;
      }
    }
  } catch (e) {
    console.warn('[useMapLocations] Failed to load cached locations:', e);
  }
  return null;
};

const saveCachedLocations = (locations) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      data: locations,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('[useMapLocations] Failed to cache locations:', e);
  }
};

export default function useMapLocations(token) {
  const [locations, setLocations] = useState(() => loadCachedLocations() || DEFAULT_LOCATIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchedRef = useRef(false);

  const fetchLocations = useCallback(async () => {
    if (!token) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await api.getMapLocations();
      if (response.success && response.data) {
        const newLocations = {
          ...DEFAULT_LOCATIONS,
          ...response.data
        };
        setLocations(newLocations);
        saveCachedLocations(newLocations);
      }
    } catch (err) {
      console.error('[useMapLocations] Failed to fetch locations:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchLocations();
    }
  }, [token, fetchLocations]);

  const updateLocations = useCallback(async (newLocations) => {
    if (!token) {
      setError('Authentication required');
      return { success: false, error: 'Authentication required' };
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await api.updateMapLocations(newLocations);
      if (response.success) {
        const updatedLocations = {
          ...locations,
          ...response.data
        };
        setLocations(updatedLocations);
        saveCachedLocations(updatedLocations);
        return { success: true };
      } else {
        throw new Error(response.message || 'Failed to update locations');
      }
    } catch (err) {
      console.error('[useMapLocations] Failed to update locations:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, [token, locations]);

  const updateLocation = useCallback(async (key, location) => {
    return updateLocations({ [key]: location });
  }, [updateLocations]);

  const resetToDefaults = useCallback(async () => {
    return updateLocations(DEFAULT_LOCATIONS);
  }, [updateLocations]);

  return {
    locations,
    isLoading,
    error,
    fetchLocations,
    updateLocations,
    updateLocation,
    resetToDefaults,
    DEFAULT_LOCATIONS
  };
}
