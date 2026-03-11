import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import api from '../services/api';

const Icon = memo(({ path, className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
  </svg>
));

/**
 * Compass-style direction picker for SOLO devices
 * Allows setting the facing direction of a device (0-360 degrees)
 */
export default function DeviceDirectionEditor({ device, onUpdate, onClose }) {
  const [direction, setDirection] = useState(device?.direction ?? device?.raw?.direction ?? 0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const compassRef = useRef(null);

  // Calculate direction from mouse/touch position
  const calculateDirection = useCallback((clientX, clientY) => {
    if (!compassRef.current) return;
    
    const rect = compassRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    
    // Calculate angle in degrees (0 = North, clockwise)
    let angle = Math.atan2(deltaX, -deltaY) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    
    // Round to nearest degree
    setDirection(Math.round(angle));
  }, []);

  // Mouse event handlers
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    calculateDirection(e.clientX, e.clientY);
  }, [calculateDirection]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    calculateDirection(e.clientX, e.clientY);
  }, [isDragging, calculateDirection]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch event handlers
  const handleTouchStart = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    const touch = e.touches[0];
    calculateDirection(touch.clientX, touch.clientY);
  }, [calculateDirection]);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    calculateDirection(touch.clientX, touch.clientY);
  }, [isDragging, calculateDirection]);

  // Global mouse/touch up listener
  useEffect(() => {
    const handleGlobalUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('touchend', handleGlobalUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchend', handleGlobalUp);
    };
  }, []);

  // Save direction to backend
  const handleSave = useCallback(async () => {
    if (!device?.id && !device?.device_id) return;
    
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      const deviceId = device.id || device.device_id;
      const response = await api.updateDeviceDirection(deviceId, direction);
      
      if (response.success) {
        setSaveStatus('success');
        if (onUpdate) {
          onUpdate({ ...device, direction });
        }
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        throw new Error(response.message || 'Failed to save');
      }
    } catch (err) {
      console.error('[DeviceDirectionEditor] Save error:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setIsSaving(false);
    }
  }, [device, direction, onUpdate]);

  // Get cardinal direction label
  const getCardinalLabel = (deg) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
  };

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-cyan-500 rounded-full"></div>
          <h3 className="text-sm font-bold text-white">Direction Editor</h3>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <Icon path="M6 18L18 6M6 6l12 12" className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {/* Device Info */}
      <div className="px-4 py-2 bg-black/30 text-xs text-gray-400">
        <span className="text-cyan-400 font-mono">{device?.id || device?.device_id || 'Unknown'}</span>
      </div>
      
      {/* Compass */}
      <div className="p-6 flex flex-col items-center gap-4">
        <div 
          ref={compassRef}
          className={`relative w-48 h-48 rounded-full border-2 ${isDragging ? 'border-cyan-500' : 'border-gray-700'} bg-black/50 cursor-pointer select-none transition-colors`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
        >
          {/* Cardinal direction markers */}
          {['N', 'E', 'S', 'W'].map((label, i) => {
            const angle = i * 90;
            const isNorth = label === 'N';
            return (
              <div
                key={label}
                className={`absolute text-xs font-bold ${isNorth ? 'text-red-500' : 'text-gray-500'}`}
                style={{
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-88px) rotate(-${angle}deg)`
                }}
              >
                {label}
              </div>
            );
          })}
          
          {/* Degree markers */}
          {[...Array(36)].map((_, i) => {
            const deg = i * 10;
            const isMajor = deg % 90 === 0;
            const isMinor = deg % 30 === 0;
            return (
              <div
                key={deg}
                className={`absolute ${isMajor ? 'w-0.5 h-3 bg-gray-500' : isMinor ? 'w-px h-2 bg-gray-600' : 'w-px h-1.5 bg-gray-700'}`}
                style={{
                  left: '50%',
                  top: '6px',
                  transformOrigin: '50% 90px',
                  transform: `translateX(-50%) rotate(${deg}deg)`
                }}
              />
            );
          })}
          
          {/* Direction indicator (arrow) */}
          <div
            className="absolute left-1/2 top-1/2 w-1 h-20 -ml-0.5 -mt-20 origin-bottom transition-transform"
            style={{ transform: `rotate(${direction}deg)` }}
          >
            <div className="w-0 h-0 border-l-4 border-r-4 border-b-8 border-l-transparent border-r-transparent border-b-cyan-500 -ml-1.5" />
            <div className="w-1 h-16 bg-gradient-to-b from-cyan-500 to-cyan-500/30 rounded-b" />
          </div>
          
          {/* Center dot */}
          <div className="absolute left-1/2 top-1/2 w-4 h-4 -ml-2 -mt-2 bg-cyan-500 rounded-full border-2 border-cyan-300 shadow-lg shadow-cyan-500/50" />
          
          {/* Direction value display */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 translate-y-8 text-center">
            <div className="text-2xl font-bold text-white font-mono">{direction}°</div>
            <div className="text-xs text-cyan-400">{getCardinalLabel(direction)}</div>
          </div>
        </div>
        
        {/* Manual input */}
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="360"
            value={direction}
            onChange={(e) => {
              let val = parseInt(e.target.value, 10);
              if (isNaN(val)) val = 0;
              if (val < 0) val = 0;
              if (val > 360) val = 360;
              setDirection(val);
            }}
            className="w-20 bg-black/50 border border-gray-700 rounded px-2 py-1.5 text-center text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
          />
          <span className="text-gray-500 text-sm">degrees</span>
        </div>
        
        {/* Quick direction buttons */}
        <div className="flex gap-1.5">
          {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
            <button
              key={deg}
              onClick={() => setDirection(deg)}
              className={`w-8 h-8 rounded text-[10px] font-bold transition-all ${
                direction === deg 
                  ? 'bg-cyan-500 text-black' 
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {deg}°
            </button>
          ))}
        </div>
      </div>
      
      {/* Footer with save button */}
      <div className="px-4 py-3 border-t border-gray-800 flex gap-2">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            saveStatus === 'success'
              ? 'bg-green-500 text-black'
              : saveStatus === 'error'
              ? 'bg-red-500 text-white'
              : 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-black hover:from-cyan-400 hover:to-cyan-500'
          } disabled:opacity-50`}
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
              Saving...
            </>
          ) : saveStatus === 'success' ? (
            <>
              <Icon path="M5 13l4 4L19 7" className="w-4 h-4" />
              Saved!
            </>
          ) : saveStatus === 'error' ? (
            'Failed'
          ) : (
            'Save Direction'
          )}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-all"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
