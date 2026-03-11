import React, { useState, useEffect, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'solo_zone_settings_v2';

const DEFAULT_ZONE_CONFIG = {
  sensor: {
    angle: 120,
    radius: 30,
    color: '#22c55e',
    enabled: true
  },
  detection: {
    angle: 70,
    radius: 120,
    color: '#3b82f6',
    enabled: true
  },
  defaultHeading: 0
};

const TacticalCompass = ({ value, onChange, disabled }) => {
  const handleMouseDown = useCallback((e) => {
    if (disabled) return;
    const compass = e.currentTarget;
    const rect = compass.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const updateAngle = (clientX, clientY) => {
      const x = clientX - rect.left - centerX;
      const y = clientY - rect.top - centerY;
      let angle = Math.atan2(x, -y) * (180 / Math.PI);
      if (angle < 0) angle += 360;
      onChange(Math.round(angle));
    };
    
    updateAngle(e.clientX, e.clientY);
    
    const handleMouseMove = (e) => updateAngle(e.clientX, e.clientY);
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onChange, disabled]);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Compass container */}
      <div 
        className={`relative w-32 h-32 ${disabled ? 'opacity-50' : 'cursor-crosshair'}`}
        onMouseDown={handleMouseDown}
      >
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border border-cyan-900/50" />
        <div className="absolute inset-1 rounded-full border border-cyan-800/30" />
        
        {/* Background */}
        <div className="absolute inset-2 rounded-full bg-black/80" />
        
        {/* Degree marks */}
        {[...Array(72)].map((_, i) => {
          const isMajor = i % 18 === 0;
          const isMinor = i % 6 === 0;
          return (
            <div
              key={i}
              className="absolute left-1/2 top-2"
              style={{
                height: '60px',
                transformOrigin: 'bottom center',
                transform: `translateX(-50%) rotate(${i * 5}deg)`,
              }}
            >
              <div 
                className={`w-px mx-auto ${
                  isMajor ? 'h-2 bg-cyan-400' : isMinor ? 'h-1.5 bg-cyan-700' : 'h-1 bg-cyan-900/50'
                }`}
              />
            </div>
          );
        })}
        
        {/* Cardinal directions */}
        {[
          { label: 'N', angle: 0, color: 'text-red-500' },
          { label: 'E', angle: 90, color: 'text-cyan-500' },
          { label: 'S', angle: 180, color: 'text-cyan-500' },
          { label: 'W', angle: 270, color: 'text-cyan-500' },
        ].map(({ label, angle, color }) => (
          <button
            key={label}
            onClick={() => !disabled && onChange(angle)}
            className={`absolute text-[10px] font-bold ${color} hover:scale-110 transition-transform`}
            style={{
              left: '50%',
              top: '50%',
              transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-42px) rotate(-${angle}deg)`,
            }}
            disabled={disabled}
          >
            {label}
          </button>
        ))}
        
        {/* Heading indicator */}
        <div 
          className="absolute inset-4 transition-transform duration-75"
          style={{ transform: `rotate(${value}deg)` }}
        >
          {/* Arrow */}
          <div className="absolute left-1/2 -translate-x-1/2 top-1 w-0 h-0 
            border-l-[4px] border-r-[4px] border-b-[24px] 
            border-l-transparent border-r-transparent border-b-cyan-400
            drop-shadow-[0_0_6px_rgba(34,211,238,0.6)]" 
          />
          {/* Tail line */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-4 w-px h-8 bg-gradient-to-t from-transparent to-cyan-600/50" />
        </div>
        
        {/* Center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
      </div>
      
      {/* Digital readout */}
      <div className="flex items-center gap-2 bg-black border border-cyan-900/50 rounded px-3 py-1.5">
        <button
          onClick={() => onChange((value - 5 + 360) % 360)}
          disabled={disabled}
          className="text-cyan-600 hover:text-cyan-400 transition-colors disabled:opacity-30"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="font-mono text-lg text-cyan-400 w-12 text-center tabular-nums">
          {String(value).padStart(3, '0')}°
        </div>
        <button
          onClick={() => onChange((value + 5) % 360)}
          disabled={disabled}
          className="text-cyan-600 hover:text-cyan-400 transition-colors disabled:opacity-30"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

const ParamRow = ({ label, value, onChange, min, max, step = 1, unit, color, disabled }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-900">
    <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
    <div className="flex items-center gap-2">
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-16 h-1 bg-gray-800 rounded-full appearance-none cursor-pointer disabled:opacity-30"
        style={{
          background: disabled ? '#1f2937' : `linear-gradient(to right, ${color} 0%, ${color} ${((value - min) / (max - min)) * 100}%, #1f2937 ${((value - min) / (max - min)) * 100}%, #1f2937 100%)`
        }}
      />
      <div className="flex items-center">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = Math.min(max, Math.max(min, Number(e.target.value) || min));
            onChange(v);
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="w-14 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-right font-mono text-xs focus:outline-none focus:border-gray-700 disabled:opacity-30"
          style={{ color: disabled ? '#6b7280' : color }}
        />
        <span className="text-xs text-gray-600 ml-1 w-3">{unit}</span>
      </div>
    </div>
  </div>
);

const ZonePanel = ({ title, config, onChange, disabled }) => {
  const isEnabled = config.enabled;
  
  return (
    <div className={`border transition-all ${isEnabled ? 'border-gray-800 bg-black/40' : 'border-gray-900 bg-black/20'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-900">
        <div className="flex items-center gap-2">
          <div 
            className="w-2 h-2 rounded-full transition-all"
            style={{ 
              backgroundColor: isEnabled ? config.color : '#374151',
              boxShadow: isEnabled ? `0 0 8px ${config.color}` : 'none'
            }}
          />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{title}</span>
        </div>
        <button
          onClick={() => onChange({ ...config, enabled: !isEnabled })}
          disabled={disabled}
          className={`text-[10px] px-2 py-0.5 rounded font-medium uppercase tracking-wider transition-all ${
            isEnabled 
              ? 'bg-gray-800 text-green-400 hover:bg-gray-700' 
              : 'bg-gray-900 text-gray-600 hover:bg-gray-800 hover:text-gray-400'
          }`}
        >
          {isEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      
      {/* Parameters */}
      <div className={`px-3 py-1 transition-all ${isEnabled ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
        <ParamRow
          label="FOV"
          value={config.angle}
          onChange={(v) => onChange({ ...config, angle: v })}
          min={10}
          max={360}
          unit="°"
          color={config.color}
          disabled={disabled || !isEnabled}
        />
        <ParamRow
          label="Range"
          value={config.radius}
          onChange={(v) => onChange({ ...config, radius: v })}
          min={5}
          max={500}
          step={5}
          unit="m"
          color={config.color}
          disabled={disabled || !isEnabled}
        />
        <div className="flex items-center justify-between py-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={config.color}
              onChange={(e) => onChange({ ...config, color: e.target.value })}
              disabled={disabled || !isEnabled}
              className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer disabled:opacity-30"
            />
            <span className="font-mono text-xs text-gray-500">{config.color}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function SoloZoneSettings({ onConfigChange, onClose, devices = [] }) {
  const soloDevices = useMemo(() => 
    devices.filter(d => d.id?.toUpperCase().startsWith('SOLO')), 
    [devices]
  );
  
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    const solos = devices.filter(d => d.id?.toUpperCase().startsWith('SOLO'));
    return solos.length > 0 ? solos[0].id : '';
  });
  
  useEffect(() => {
    if (soloDevices.length > 0 && !soloDevices.find(d => d.id === selectedDeviceId)) {
      setSelectedDeviceId(soloDevices[0].id);
    }
  }, [soloDevices, selectedDeviceId]);
  
  const [allConfigs, setAllConfigs] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load stored configs:', e);
    }
    return {};
  });
  
  const config = useMemo(() => {
    return allConfigs[selectedDeviceId] || DEFAULT_ZONE_CONFIG;
  }, [allConfigs, selectedDeviceId]);
  
  const setConfig = useCallback((updater) => {
    setAllConfigs(prev => {
      const currentConfig = prev[selectedDeviceId] || DEFAULT_ZONE_CONFIG;
      const newConfig = typeof updater === 'function' ? updater(currentConfig) : updater;
      return { ...prev, [selectedDeviceId]: newConfig };
    });
  }, [selectedDeviceId]);
  
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    onConfigChange?.(allConfigs);
  }, []);

  const handleApply = () => {
    setIsSaving(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allConfigs));
    onConfigChange?.(allConfigs);
    setTimeout(() => setIsSaving(false), 300);
  };

  const handleReset = () => {
    setAllConfigs(prev => {
      const newConfigs = { ...prev };
      delete newConfigs[selectedDeviceId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfigs));
      onConfigChange?.(newConfigs);
      return newConfigs;
    });
  };

  return (
    <div className="flex flex-col h-full max-h-full min-h-0 bg-black text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Coverage Zones</h3>
          <p className="text-[10px] text-gray-600">SOLO SENSOR CONFIGURATION</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-600 hover:text-gray-400 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content - buttons included inside scroll area for tablet visibility */}
      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        {/* Device Selector */}
        <div className="px-4 py-3 border-b border-gray-900">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Select Device</span>
            <span className="text-[10px] text-gray-700">{soloDevices.length} DEVICES</span>
          </div>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50 cursor-pointer"
          >
            {soloDevices.map(device => (
              <option key={device.id} value={device.id}>
                {device.id} - {device.location?.address || 'Unknown Location'}
              </option>
            ))}
          </select>
        </div>

        {/* Heading */}
        <div className="px-4 py-4 border-b border-gray-900">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Default Heading</span>
            <span className="text-[10px] text-gray-700">BEARING</span>
          </div>
          <TacticalCompass
            value={config.defaultHeading}
            onChange={(v) => setConfig(prev => ({ ...prev, defaultHeading: v }))}
          />
        </div>

        {/* Zones */}
        <div className="p-4 space-y-3">
          <ZonePanel
            title="Sensor Zone"
            config={config.sensor}
            onChange={(v) => setConfig(prev => ({ ...prev, sensor: v }))}
          />
          <ZonePanel
            title="Detection Zone"
            config={config.detection}
            onChange={(v) => setConfig(prev => ({ ...prev, detection: v }))}
          />
        </div>

        {/* Action Buttons - inside scroll area so always reachable on tablet */}
        <div className="p-3 border-t border-gray-800 space-y-2">
          <button
            onClick={handleApply}
            disabled={isSaving}
            className="w-full py-2.5 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-white font-semibold text-xs uppercase tracking-wider rounded transition-all disabled:opacity-50"
          >
            {isSaving ? 'APPLYING...' : 'APPLY CONFIGURATION'}
          </button>
          <button
            onClick={handleReset}
            className="w-full py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-400 hover:text-white text-xs uppercase tracking-wider rounded transition-all"
          >
            Reset Defaults
          </button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_ZONE_CONFIG };
