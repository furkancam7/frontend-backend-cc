import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import mapboxgl from 'mapbox-gl';
import { useUiTranslation } from '../../i18n/useUiTranslation';

const Icon = memo(({ path, className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
  </svg>
));

function MapPicker({ initialLat, initialLng, initialZoom, onConfirm, onCancel, t }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const [picked, setPicked] = useState(
    initialLat && initialLng ? { lat: initialLat, lng: initialLng } : null
  );

  useEffect(() => {
    if (!mapContainer.current) return;

    mapboxgl.accessToken = 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ';

    const center = initialLat && initialLng
      ? [initialLng, initialLat]
      : [55.2708, 25.2048];

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center,
      zoom: initialZoom || 12,
    });

    map.current.getCanvas().style.cursor = 'crosshair';

    // Place initial marker if coordinates exist
    if (initialLat && initialLng) {
      marker.current = new mapboxgl.Marker({ color: '#00e5ff' })
        .setLngLat([initialLng, initialLat])
        .addTo(map.current);
    }

    map.current.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      setPicked({ lat, lng });

      if (marker.current) {
        marker.current.setLngLat([lng, lat]);
      } else {
        marker.current = new mapboxgl.Marker({ color: '#00e5ff' })
          .setLngLat([lng, lat])
          .addTo(map.current);
      }
    });

    return () => {
      if (marker.current) marker.current.remove();
      if (map.current) map.current.remove();
    };
  }, []);

  const handleConfirm = () => {
    if (!picked) return;
    const zoom = map.current ? map.current.getZoom() : initialZoom || 12;
    onConfirm({ latitude: picked.lat, longitude: picked.lng, zoom });
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-black">
      <div className="h-10 flex items-center justify-between px-3 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs font-bold text-white uppercase tracking-wider">{t('locationSettings.pickLocationOnMap')}</span>
        <button onClick={onCancel} className="text-gray-500 hover:text-white">
          <Icon path="M6 18L18 6M6 6l12 12" className="w-4 h-4" />
        </button>
      </div>
      <div ref={mapContainer} className="flex-1" />
      {picked && (
        <div className="text-[10px] text-cyan-400 font-mono text-center py-1 bg-black/80">
          {picked.lat.toFixed(7)}, {picked.lng.toFixed(7)}
        </div>
      )}
      <div className="flex gap-2 p-2 border-t border-gray-800 flex-shrink-0">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded text-xs font-semibold uppercase tracking-wider bg-gray-900 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
        >
          {t('locationSettings.cancel')}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!picked}
          className="flex-1 py-2 rounded text-xs font-semibold uppercase tracking-wider bg-cyan-600 text-white hover:bg-cyan-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {t('locationSettings.confirm')}
        </button>
      </div>
    </div>
  );
}

function LocationInput({ label, location, onChange, disabled, t }) {
  const [localValues, setLocalValues] = useState({
    name: location?.name || '',
    latitude: location?.latitude?.toString() || '',
    longitude: location?.longitude?.toString() || '',
    zoom: location?.zoom?.toString() || ''
  });
  const [showMapPicker, setShowMapPicker] = useState(false);

  const handleChange = (field, value) => {
    setLocalValues(prev => ({ ...prev, [field]: value }));
  };

  const handleBlur = () => {
    const lat = parseFloat(localValues.latitude);
    const lng = parseFloat(localValues.longitude);
    const zoom = parseFloat(localValues.zoom);

    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      onChange({
        name: localValues.name || label,
        latitude: lat,
        longitude: lng,
        zoom: !isNaN(zoom) && zoom >= 1 && zoom <= 22 ? zoom : 15
      });
    }
  };

  const handleMapConfirm = ({ latitude, longitude, zoom }) => {
    const newValues = {
      ...localValues,
      latitude: latitude.toFixed(7),
      longitude: longitude.toFixed(7),
      zoom: zoom.toFixed(1)
    };
    setLocalValues(newValues);
    setShowMapPicker(false);
    onChange({
      name: localValues.name || label,
      latitude,
      longitude,
      zoom: Math.round(zoom * 10) / 10
    });
  };

  return (
    <div className="bg-black border border-gray-800 rounded-lg p-4 space-y-3 relative">
      {showMapPicker && (
        <MapPicker
          initialLat={parseFloat(localValues.latitude) || null}
          initialLng={parseFloat(localValues.longitude) || null}
          initialZoom={parseFloat(localValues.zoom) || null}
          onConfirm={handleMapConfirm}
          onCancel={() => setShowMapPicker(false)}
          t={t}
        />
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">{label}</h3>
        <button
          onClick={() => setShowMapPicker(true)}
          disabled={disabled}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase tracking-wider font-semibold bg-cyan-900/30 border border-cyan-800/50 text-cyan-400 hover:bg-cyan-800/40 hover:text-cyan-300 transition-all disabled:opacity-50"
          title={t('locationSettings.pickFromMap')}
        >
          <Icon path="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" className="w-3 h-3" />
          {t('locationSettings.map')}
        </button>
      </div>
      
      <div className="space-y-2">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('locationSettings.name')}</label>
          <input
            type="text"
            value={localValues.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={handleBlur}
            disabled={disabled}
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-gray-700 focus:outline-none disabled:opacity-50"
            placeholder={t('locationSettings.locationName')}
          />
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('locationSettings.latitude')}</label>
            <input
              type="number"
              step="any"
              value={localValues.latitude}
              onChange={(e) => handleChange('latitude', e.target.value)}
              onBlur={handleBlur}
              disabled={disabled}
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:border-gray-700 focus:outline-none disabled:opacity-50"
              placeholder={t('locationSettings.latitude')}
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('locationSettings.longitude')}</label>
            <input
              type="number"
              step="any"
              value={localValues.longitude}
              onChange={(e) => handleChange('longitude', e.target.value)}
              onBlur={handleBlur}
              disabled={disabled}
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:border-gray-700 focus:outline-none disabled:opacity-50"
              placeholder={t('locationSettings.longitude')}
            />
          </div>
        </div>
        
        <div className="w-1/2">
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('locationSettings.zoomLevel')}</label>
          <input
            type="number"
            step="0.1"
            min="1"
            max="22"
            value={localValues.zoom}
            onChange={(e) => handleChange('zoom', e.target.value)}
            onBlur={handleBlur}
            disabled={disabled}
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:border-gray-700 focus:outline-none disabled:opacity-50"
            placeholder={t('locationSettings.zoomRange')}
          />
        </div>
      </div>
      
      <div className="text-[10px] text-gray-600 font-mono">
        {localValues.latitude && localValues.longitude 
          ? `${parseFloat(localValues.latitude).toFixed(6)}, ${parseFloat(localValues.longitude).toFixed(6)}`
          : t('locationSettings.enterCoordinates')}
      </div>
    </div>
  );
}

export default function LocationSettings({ locations, onUpdate, onResetDefaults, isLoading, error, onClose }) {
  const { t } = useUiTranslation(['locationSettings']);
  const [homeLocation, setHomeLocation] = useState(locations?.home || {});
  const [responsibleArea, setResponsibleArea] = useState(locations?.responsibleArea || {});
  const [saveStatus, setSaveStatus] = useState(null);

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    const result = await onUpdate({
      home: homeLocation,
      responsibleArea: responsibleArea
    });
    
    if (result.success) {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } else {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  }, [homeLocation, responsibleArea, onUpdate]);

  const handleReset = useCallback(async () => {
    if (window.confirm(t('locationSettings.resetConfirm'))) {
      const result = await onResetDefaults();
      if (result.success) {
        setHomeLocation(locations?.home || {});
        setResponsibleArea(locations?.responsibleArea || {});
      }
    }
  }, [onResetDefaults, locations, t]);

  return (
    <div className="flex flex-col h-full max-h-full min-h-0 bg-black">
      {}
      <div className="h-12 border-b border-gray-800 flex items-center justify-between px-4 bg-black flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="hover:bg-gray-900 p-1 rounded text-gray-400 hover:text-white">
            <Icon path="M15 19l-7-7 7-7" className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">{t('locationSettings.title')}</h2>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <Icon path="M6 18L18 6M6 6l12 12" />
        </button>
      </div>

      {}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 bg-black min-h-0">
        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg px-4 py-2 text-red-400 text-sm">
            {error}
          </div>
        )}

        <LocationInput
          label={t('locationSettings.homeLocation')}
          location={homeLocation}
          onChange={setHomeLocation}
          disabled={isLoading}
          t={t}
        />

        <LocationInput
          label={t('locationSettings.responsibleArea')}
          location={responsibleArea}
          onChange={setResponsibleArea}
          disabled={isLoading}
          t={t}
        />

        {}
        <div className="pt-2 pb-1 space-y-2">
          <button
            onClick={handleSave}
            disabled={isLoading || saveStatus === 'saving'}
            className={`w-full py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
              saveStatus === 'saved'
                ? 'bg-green-600 text-white'
                : saveStatus === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-gray-900 border border-gray-700 text-white hover:bg-gray-800'
            } disabled:opacity-50`}
          >
            {isLoading || saveStatus === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                {t('locationSettings.applying')}
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Icon path="M5 13l4 4L19 7" className="w-4 h-4" />
                {t('locationSettings.saved')}
              </>
            ) : saveStatus === 'error' ? (
              t('locationSettings.failedToSave')
            ) : (
              t('locationSettings.applyConfiguration')
            )}
          </button>

          <button
            onClick={handleReset}
            disabled={isLoading}
            className="w-full py-2 rounded text-xs uppercase tracking-wider bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800 transition-all disabled:opacity-50"
          >
            {t('locationSettings.resetDefaults')}
          </button>
        </div>
      </div>
    </div>
  );
}
