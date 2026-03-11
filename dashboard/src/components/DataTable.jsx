import React, { useMemo, useState, useEffect, useCallback } from 'react';
import useTransferUpdates from '../hooks/useTransferUpdates';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ';

const apiReq = async (url, options = {}) => {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        throw new Error(`API Request failed: ${res.status} ${res.statusText}`);
    }

    if (res.status === 204) return null;

    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
        return res.json();
    }
    return res.text(); 
};

const FullImageCell = React.memo(({ row, activeTransfer, hasAnyActiveTransfer, onViewOnMap }) => {
    const [imgError, setImgError] = useState(false);
    
    useEffect(() => {
        setImgError(false);
    }, [row.record_id]);

    const isReceiving = activeTransfer || (hasAnyActiveTransfer && row.crops[0]?.raw?.is_partial);
    const imageUrl = useMemo(() => {
        if (imgError) return 'https://placehold.co/300x200/000000/666?text=No+Image';
        return `/api/image/fullframe/${row.record_id}?t=${encodeURIComponent(row.captured_time || Date.now())}`;
    }, [row.record_id, row.captured_time, imgError]);

    const handleClick = useCallback(() => {
        if (onViewOnMap && row.crops.length > 0) {
            onViewOnMap(row.crops[0]);
        }
    }, [onViewOnMap, row]);

    if (isReceiving || (imgError && hasAnyActiveTransfer)) {
        return (
             <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-cyan-900/30 to-black border border-cyan-500/30">
                <div className="flex items-center gap-1 mb-1">
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-ping"></span>
                    <span className="text-[10px] font-bold text-cyan-400 animate-pulse">RECEIVING</span>
                </div>
                {activeTransfer && (
                    <>
                        <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                                style={{ width: `${activeTransfer.percent}%` }}
                            />
                        </div>
                        <span className="text-[9px] text-gray-400 mt-1 font-mono">{activeTransfer.percent}%</span>
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="w-32 h-20 bg-black rounded overflow-hidden border border-gray-700 group relative">
            <img
                src={imageUrl}
                alt="Full Frame"
                className="w-full h-full object-cover group-hover:scale-110 transition-transform cursor-pointer"
                onClick={handleClick}
                onError={() => setImgError(true)}
                loading="lazy"
            />
             <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center pointer-events-none transition-opacity">
                <span className="text-xs text-white font-bold">LOCATE</span>
            </div>
        </div>
    );
});

const LocationCell = React.memo(({ location, row, onViewOnMap }) => {
    const hasLocation = location && location.latitude && location.longitude;
    
    const mapUrl = useMemo(() => {
        if (!hasLocation) return null;
        return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+06b6d4(${location.longitude},${location.latitude})/${location.longitude},${location.latitude},12,0/300x200?access_token=${MAPBOX_TOKEN}`;
    }, [location, hasLocation]);

    const handleClick = useCallback(() => {
        if (onViewOnMap && row.crops.length > 0) {
            onViewOnMap(row.crops[0]);
        }
    }, [onViewOnMap, row]);

    if (!hasLocation) {
        return (
            <div className="w-32 h-20 bg-gray-900/50 rounded border border-gray-800 flex items-center justify-center text-gray-600 text-xs">
                No Signal
            </div>
        );
    }

    return (
        <div className="w-32 h-20 bg-black rounded overflow-hidden border border-gray-700 relative group">
            <img
                src={mapUrl}
                alt="Location"
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={handleClick}
                loading="lazy"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-gray-300 px-1 py-0.5 font-mono truncate">
                {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </div>
        </div>
    );
});

const CropItem = React.memo(({ crop, isAdmin, editingCropId, setEditingCropId, onUpdateCrop }) => {
    const [editVal, setEditVal] = useState(crop.class);
    
    useEffect(() => {
        setEditVal(crop.class);
    }, [crop.class]);

    const handleSave = () => onUpdateCrop(crop.crop_id, editVal);

    return (
        <div className="w-12 h-12 flex-shrink-0 bg-black rounded border border-gray-700 relative group cursor-help" title={`${crop.class} (${crop.accuracy}%)`}>
            <img
                src={`/api/image/crop/${crop.crop_id}`}
                alt={crop.class}
                className="w-full h-full object-cover"
                onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'https://placehold.co/100x100/000000/FFF?text=No+Img';
                }}
                loading="lazy"
            />
            {isAdmin && editingCropId === crop.crop_id ? (
                <input
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={e => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') setEditingCropId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="absolute inset-0 bg-black/90 text-white text-[8px] text-center w-full h-full outline-none border border-cyan-500"
                />
            ) : (
                <div
                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[8px] text-white font-bold transition-opacity cursor-pointer"
                    onClick={(e) => {
                        if (isAdmin) {
                            e.stopPropagation();
                            setEditingCropId(crop.crop_id);
                            setEditVal(crop.class);
                        }
                    }}
                >
                    {crop.class} {isAdmin && <span className="text-cyan-500 ml-0.5">✎</span>}
                </div>
            )}
        </div>
    );
});

const CropsCell = React.memo(({ crops, isAdmin, editingCropId, setEditingCropId, onUpdateCrop }) => {
    return (
        <div className="flex gap-2 overflow-x-auto max-w-xs custom-scrollbar pb-1">
            {crops.map(crop => (
                <CropItem 
                    key={crop.crop_id} 
                    crop={crop}
                    isAdmin={isAdmin}
                    editingCropId={editingCropId}
                    setEditingCropId={setEditingCropId}
                    onUpdateCrop={onUpdateCrop}
                />
            ))}
        </div>
    );
});

const DeviceIdCell = React.memo(({ row, isAdmin, editingRecordId, setEditingRecordId, onUpdateRecord, onViewOnMap }) => {
    const [editVal, setEditVal] = useState(row.device_id || '');
    
    useEffect(() => {
        setEditVal(row.device_id || '');
    }, [row.device_id]);

    const handleSave = () => onUpdateRecord(row.record_id, editVal);

    const handleClick = useCallback(() => {
        if (!editingRecordId && onViewOnMap && row.crops.length > 0) {
            onViewOnMap(row.crops[0]);
        }
    }, [editingRecordId, onViewOnMap, row]);

    return (
        <div 
            className="p-3 font-mono text-cyan-400 font-bold hover:text-white cursor-pointer transition-colors relative group"
            onClick={handleClick}
        >
            {isAdmin && editingRecordId === row.record_id ? (
                <input
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={e => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') setEditingRecordId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="bg-black/90 text-white text-sm w-24 outline-none border border-cyan-500 px-1"
                />
            ) : (
                <div className="flex items-center gap-1">
                    {row.device_id || 'UNK'}
                    {isAdmin && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setEditingRecordId(row.record_id);
                                setEditVal(row.device_id || '');
                            }}
                            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-cyan-500 transition-opacity"
                        >
                            ✎
                        </button>
                    )}
                </div>
            )}
        </div>
    );
});

function DataTable({ detections = [], onOpenDetail, onViewOnMap, isAdmin, onRefresh, isActive = true }) {
    const [editingCropId, setEditingCropId] = useState(null);
    const [editingRecordId, setEditingRecordId] = useState(null);
    const { activeTransfers } = useTransferUpdates(isActive);

    const activeTransfersByRecordId = useMemo(() => {
        const transfersMap = new Map();
        activeTransfers.forEach((transfer) => {
            if (transfer.record_id) {
                transfersMap.set(transfer.record_id, transfer);
            }
        });
        return transfersMap;
    }, [activeTransfers]);

    const hasAnyActiveTransfer = activeTransfers.length > 0;
    const groupedData = useMemo(() => {
        const groups = {};
        for (const det of detections) {
            if (!groups[det.record_id]) {
                groups[det.record_id] = {
                    record_id: det.record_id,
                    device_id: det.device_id,
                    captured_time: det.captured_time,
                    location: det.location,
                    crops: []
                };
            }
            groups[det.record_id].crops.push(det);
        }
        return Object.values(groups).sort((a, b) => new Date(b.captured_time) - new Date(a.captured_time));
    }, [detections]);

    const handleDeleteRecord = useCallback(async (row, e) => {
        e.stopPropagation();
        if (window.confirm(`Are you sure you want to delete this record and all ${row.crops.length} detections?`)) {
            try {
                await Promise.all(row.crops.map(crop =>
                    apiReq(`/api/crop/${crop.crop_id}`, { method: 'DELETE' })
                ));
                if (onRefresh) onRefresh();
            } catch (err) {
                console.error('Delete failed:', err);
                alert('Failed to delete record');
            }
        }
    }, [onRefresh]);

    const handleUpdateCrop = useCallback(async (cropId, newClass) => {
        try {
            await apiReq(`/api/crop/${cropId}`, {
                method: 'PUT',
                body: JSON.stringify({ class: newClass })
            });
            setEditingCropId(null);
            if (onRefresh) onRefresh();
        } catch (err) {
            alert('Failed to update crop');
        }
    }, [onRefresh]);

    const handleUpdateRecord = useCallback(async (recordId, newDeviceId) => {
        try {
            await apiReq(`/api/record/${recordId}`, {
                method: 'PUT',
                body: JSON.stringify({ device_id: newDeviceId })
            });
            setEditingRecordId(null);
            if (onRefresh) onRefresh();
        } catch (err) {
            alert('Failed to update record');
        }
    }, [onRefresh]);

    return (
        <div className="h-full flex flex-col bg-black text-gray-300 font-sans animate-in fade-in duration-300">
            {/* Header */}
            <div className="p-4 border-b border-gray-900 bg-black flex justify-between items-center">
                <h2 className="flex items-center gap-3">
                    <div className="w-1 h-6 bg-cyan-500 rounded-full"></div>
                    <span className="text-sm font-bold text-white uppercase tracking-wider">Table Format</span>
                    <span className="text-xs text-gray-600 font-mono bg-gray-950 px-2 py-1 rounded">({groupedData.length} Records)</span>
                    {onRefresh && (
                        <button 
                            onClick={onRefresh}
                            className="ml-2 px-3 py-1.5 text-xs bg-gray-950 hover:bg-gray-900 rounded-lg text-gray-500 hover:text-white border border-gray-900 hover:border-gray-800 transition-all"
                        >
                            ↻ Refresh
                        </button>
                    )}
                </h2>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4" style={{ maxHeight: 'calc(100vh - 100px)' }}>
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="bg-gray-950 text-gray-500 border-b border-gray-900">
                            <th className="p-3 text-left text-[10px] font-bold uppercase tracking-wider">Full Frame</th>
                            <th className="p-3 text-left text-[10px] font-bold uppercase tracking-wider">Location</th>
                            <th className="p-3 text-left text-[10px] font-bold uppercase tracking-wider">Detected Objects</th>
                            <th className="p-3 text-left text-[10px] font-bold uppercase tracking-wider">Device ID</th>
                            <th className="p-3 text-left text-[10px] font-bold uppercase tracking-wider">Captured Time</th>
                            <th className="p-3 text-center text-[10px] font-bold uppercase tracking-wider">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedData.map((row) => {
                            const activeTransfer = activeTransfersByRecordId.get(row.record_id);
                            
                            return (
                                <tr key={row.record_id} className="border-b border-gray-900 hover:bg-gray-950 transition-colors">
                                    {}
                                    <td className="p-3">
                                        <FullImageCell 
                                            row={row} 
                                            activeTransfer={activeTransfer} 
                                            hasAnyActiveTransfer={hasAnyActiveTransfer}
                                            onViewOnMap={onViewOnMap}
                                        />
                                    </td>

                                    {}
                                    <td className="p-3">
                                        <LocationCell 
                                            location={row.location} 
                                            row={row}
                                            onViewOnMap={onViewOnMap}
                                        />
                                    </td>

                                    {}
                                    <td className="p-3">
                                        <CropsCell 
                                            crops={row.crops}
                                            isAdmin={isAdmin}
                                            editingCropId={editingCropId}
                                            setEditingCropId={setEditingCropId}
                                            onUpdateCrop={handleUpdateCrop}
                                        />
                                    </td>

                                    {}
                                    <td>
                                        <DeviceIdCell 
                                            row={row}
                                            isAdmin={isAdmin}
                                            editingRecordId={editingRecordId}
                                            setEditingRecordId={setEditingRecordId}
                                            onUpdateRecord={handleUpdateRecord}
                                            onViewOnMap={onViewOnMap}
                                        />
                                    </td>

                                    {}
                                    <td className="p-3 font-mono text-gray-400">
                                        {row.captured_time ? new Date(row.captured_time).toLocaleString() : 'N/A'}
                                    </td>

                                    {}
                                    <td className="p-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => onOpenDetail && onOpenDetail(row.record_id)}
                                                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-gray-800 text-gray-400 hover:bg-cyan-900 hover:text-cyan-400"
                                                title="View Details"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                            </button>
                                            {isAdmin && (
                                                <button
                                                    onClick={(e) => handleDeleteRecord(row, e)}
                                                    className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-gray-800 text-red-500 hover:bg-red-900/50 hover:text-red-400"
                                                    title="Delete Record"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default React.memo(DataTable);
