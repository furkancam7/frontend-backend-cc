import React, { useState, useEffect, useCallback } from 'react';

const DevicePopupContent = ({ device, deviceCrops = [], onCropSelect, isAdmin }) => {
  const [editingAddress, setEditingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const deviceId = device?.id;
  const deviceAddress = device?.location?.address;

  useEffect(() => {
    setNewAddress(deviceAddress || 'Unknown Location');
    setEditingAddress(false);
  }, [deviceId, deviceAddress]);

  const isOnline = device?.online ?? false;
  const lastSeenTime = device?.lastSeen
    ? new Date(device.lastSeen).toLocaleTimeString()
    : 'N/A';
  const lat = device?.location?.latitude;
  const lng = device?.location?.longitude;
  const isHub = deviceId?.toLowerCase().includes('hub');

  const handleUpdateAddress = useCallback(async () => {
    if (!deviceId || !newAddress.trim()) {
      setEditingAddress(false);
      return;
    }
    try {
      const res = await fetch(`/api/device/${deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: newAddress.trim() })
      });
      if (!res.ok) console.error('Address update failed:', res.status);
    } catch (e) {
      console.error('Address update error:', e);
    } finally {
      setEditingAddress(false);
    }
  }, [deviceId, newAddress]);

  return (
    <div className="w-[calc(100vw-2rem)] max-w-64 sm:w-64 max-h-[80vh] overflow-y-auto bg-gradient-to-b from-[#111111] to-[#0a0a0a] border border-gray-800/80 rounded-xl shadow-2xl font-sans overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0f0f0f] to-[#141414] px-3 py-2.5 border-b border-gray-800/50">
        <div className="flex justify-between items-center">
          <div>
            <div className="font-bold text-white text-sm tracking-wide">{device.name}</div>
            <div className="text-gray-500 text-[9px] font-mono">{deviceId}</div>
          </div>
          <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider ${isOnline
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
            {isOnline ? '● ONLINE' : '○ OFFLINE'}
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="bg-[#0d0d0d] rounded-lg p-2.5 border border-gray-800/50">
          <div className="text-gray-500 text-[8px] font-bold tracking-widest mb-1.5">LOCATION</div>
          {editingAddress ? (
            <input
              autoFocus
              value={newAddress}
              onChange={e => setNewAddress(e.target.value)}
              onBlur={handleUpdateAddress}
              onKeyDown={e => {
                if (e.key === 'Enter') handleUpdateAddress();
                if (e.key === 'Escape') setEditingAddress(false);
              }}
              className="bg-black text-white border border-cyan-500/50 w-full text-[10px] outline-none rounded px-1.5 py-0.5"
              aria-label="Edit location address"
            />
          ) : (
            <div
              className={`text-white text-[10px] truncate ${isAdmin ? 'cursor-pointer hover:text-cyan-400' : ''}`}
              onClick={() => isAdmin && setEditingAddress(true)}
              role={isAdmin ? 'button' : undefined}
              tabIndex={isAdmin ? 0 : undefined}
              onKeyDown={isAdmin ? (e) => e.key === 'Enter' && setEditingAddress(true) : undefined}
            >
              {newAddress}
            </div>
          )}
          <div className="text-gray-600 font-mono text-[8px] truncate mt-0.5">
            {lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'N/A'}
          </div>
        </div>

        {/* Last Seen */}
        <div className="flex justify-between items-center text-[9px] px-1">
          <span className="text-gray-600 font-mono tracking-wider">LAST SEEN</span>
          <span className="text-gray-400 font-mono">{lastSeenTime}</span>
        </div>

        {/* Recent Detections - Only for SOLO */}
        {!isHub && (
          <div className="bg-[#0d0d0d] rounded-lg p-2.5 border border-gray-800/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-500 text-[8px] font-bold tracking-widest">RECENT DETECTIONS</span>
              <span className="text-cyan-400 text-[10px] font-mono font-bold bg-cyan-500/10 px-1.5 py-0.5 rounded">
                {deviceCrops.length}
              </span>
            </div>
            {deviceCrops.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                {deviceCrops.slice(0, 6).map((crop) => (
                  <button
                    key={crop.crop_id || crop.detection_id || `${crop.timestamp}-${crop.class}`}
                    onClick={(e) => { e.stopPropagation(); onCropSelect?.(crop); }}
                    className="cursor-pointer relative min-w-[2.75rem] w-11 h-11 bg-black border border-gray-700/50 rounded-lg overflow-hidden hover:border-cyan-500/70 hover:shadow-lg hover:shadow-cyan-500/10 transition-all shrink-0 p-0 group"
                    aria-label={`View ${crop.class || 'detection'} details`}
                  >
                    <img
                      src={`/api/image/crop/${crop.crop_id}`}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                      alt={crop.class || 'Detection'}
                      loading="lazy"
                      onError={(e) => { e.target.style.opacity = '0'; }}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent text-[6px] text-white text-center truncate px-0.5 py-0.5 font-medium">
                      {crop.class || '?'}
                    </div>
                  </button>
                ))}
                {deviceCrops.length > 6 && (
                  <div className="min-w-[2.75rem] w-11 h-11 bg-gray-800/50 border border-gray-700/50 rounded-lg flex items-center justify-center text-gray-400 text-[9px] font-mono">
                    +{deviceCrops.length - 6}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-600 text-[9px] italic py-2 text-center">No detections yet</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DevicePopupContent;
