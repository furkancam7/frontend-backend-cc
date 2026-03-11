import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import useTransferUpdates from '../hooks/useTransferUpdates';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ';
const FALLBACK_THUMBNAIL_URL = 'https://placehold.co/100x100/000000/FFF?text=No+Img';

const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
};

const TransferProgressBar = memo(({ percent, label, subLabel }) => (
    <div className="w-full">
        {(label || subLabel) && (
            <div className="flex justify-between text-[10px] mb-1">
                {label && <span className="text-cyan-400 flex items-center gap-1">{label}</span>}
                {subLabel && <span className="text-gray-400 font-mono">{subLabel}</span>}
                <span className="text-cyan-400 font-mono ml-auto">{percent}%</span>
            </div>
        )}
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                style={{ width: `${percent}%` }}
            />
        </div>
    </div>
));

const TransferProgressBanner = memo(({ transfers }) => {
    if (!transfers || transfers.length === 0) return null;

    return (
        <div className="bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border-b border-cyan-500/30 p-3">
            <div className="text-xs text-cyan-400 font-semibold mb-2 flex items-center gap-2">
                <span className="animate-pulse text-lg">●</span>
                ACTIVE TRANSFER {transfers.length > 1 ? `(${transfers.length})` : ''}
            </div>
            {transfers.map(t => (
                <div key={t.transfer_id} className="mb-2 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300 truncate max-w-[150px]">{t.filename}</span>
                    </div>
                    <TransferProgressBar
                        percent={t.percent}
                        subLabel={`${t.chunks_received.toLocaleString()} / ${t.chunks_total.toLocaleString()} chunks`}
                    />
                </div>
            ))}
        </div>
    );
});

const getMapboxStaticUrl = (lat, lon) => {
    if (!lat || !lon || !MAPBOX_TOKEN) return '';
    return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon},${lat},15,0/120x80@2x?access_token=${MAPBOX_TOKEN}&attribution=false&logo=false`;
};

const DetectionMiniMap = memo(({ latitude, longitude }) => {
    if (!latitude || !longitude) return null;

    const staticMapUrl = getMapboxStaticUrl(latitude, longitude);
    const [imgError, setImgError] = useState(false);

    useEffect(() => {
        setImgError(false);
    }, [staticMapUrl]);

    return (
        <div className="w-full h-full rounded overflow-hidden relative bg-gray-900 border border-gray-700/50">
            {!imgError ? (
                <img
                    src={staticMapUrl}
                    alt="Location"
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                    loading="lazy"
                    onError={() => setImgError(true)}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-800/50">
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 ring-1.5 ring-white shadow-sm"></span>
                </span>
            </div>
        </div>
    );
});

const DetectionThumbnail = memo(({ src, crop, onOpenDetail, onViewContext }) => {
    const [imgError, setImgError] = useState(false);

    useEffect(() => {
        setImgError(false);
    }, [src]);

    return (
        <div
            className="relative w-20 h-20 bg-black rounded overflow-hidden border border-gray-800 flex-shrink-0 group-hover:border-cyan-900/50 transition-colors cursor-pointer"
            onClick={(e) => {
                e.stopPropagation();
                onOpenDetail?.(crop.record_id);
            }}
        >
            <img
                src={imgError ? FALLBACK_THUMBNAIL_URL : src}
                alt=""
                className="w-full h-full object-contain"
                loading="lazy"
                onError={() => setImgError(true)}
            />
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onViewContext(crop); }}
                className="absolute bottom-0.5 right-0.5 w-5 h-5 bg-black/80 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-cyan-600"
                title="View Context"
            >
                <svg className="w-3 h-3 text-cyan-400 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>
        </div>
    );
});

const DetectionItem = memo(({
    crop,
    activeTransfer,
    isEditing,
    isAdmin,
    onSelect,
    onViewContext,
    onOpenDetail,
    onEditStart,
    onSave,
    onCancelEdit,
    onDelete
}) => {
    const [localForm, setLocalForm] = useState({
        class: crop.class || '',
        device_id: crop.device_id || '',
        accuracy: crop.accuracy || ''
    });

    const prevEditing = useRef(isEditing);
    useEffect(() => {
        if (isEditing && !prevEditing.current) {
            setLocalForm({
                class: crop.class || '',
                device_id: crop.device_id || '',
                accuracy: crop.accuracy || ''
            });
        }
        prevEditing.current = isEditing;
    }, [isEditing, crop.class, crop.device_id, crop.accuracy]);

    const isReceiving = !!activeTransfer;
    const isPartial = !isReceiving && crop.raw?.is_partial;
    const imageUrl = useMemo(() => {
        const timestamp = crop.captured_time || 'static';
        return `/api/image/crop/${crop.crop_id}?t=${encodeURIComponent(timestamp)}`;
    }, [crop.crop_id, crop.captured_time]);

    const handleSelect = useCallback(() => onSelect(crop.crop_id), [crop.crop_id, onSelect]);
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(crop.crop_id);
        }
    }, [crop.crop_id, onSelect]);

    const handleSaveClick = (e) => {
        e.stopPropagation();
        onSave(crop, localForm);
    };

    const handleCancelClick = (e) => {
        e.stopPropagation();
        onCancelEdit();
    };

    const handleMapClick = (e) => {
        e.stopPropagation();
        onSelect(crop.crop_id);
    };

    const handleMapKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onSelect(crop.crop_id);
        }
    };

    return (
        <div
            className={`group bg-black hover:bg-gray-950 border border-gray-900 hover:border-gray-800 rounded-xl p-2.5 transition-all duration-200 relative ${isEditing ? 'h-auto min-h-[98px] z-50 shadow-2xl ring-1 ring-gray-700 overflow-visible' : 'h-[98px] overflow-hidden'
                }`}
            onClick={handleSelect}
        >
            {/* Hover accent */}
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity rounded-l-xl"></div>

            <div className="flex gap-3 h-full">
                <DetectionThumbnail
                    src={imageUrl}
                    crop={crop}
                    onOpenDetail={onOpenDetail}
                    onViewContext={onViewContext}
                />

                { }
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                    {isEditing ? (
                        <div className="flex flex-col h-full justify-between gap-1" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-1">
                                <input
                                    type="text"
                                    value={localForm.class}
                                    onChange={e => setLocalForm(prev => ({ ...prev, class: e.target.value }))}
                                    className="flex-[2] bg-black border border-gray-700 rounded px-1 text-[10px] h-6 text-white focus:border-cyan-500 outline-none"
                                    placeholder="Class"
                                    autoFocus
                                />
                                <input
                                    type="number"
                                    value={localForm.accuracy}
                                    onChange={e => setLocalForm(prev => ({ ...prev, accuracy: e.target.value }))}
                                    className="w-10 bg-black border border-gray-700 rounded px-1 text-[10px] h-6 text-white focus:border-cyan-500 outline-none text-center"
                                    placeholder="%"
                                />
                            </div>
                            <input
                                type="text"
                                value={localForm.device_id}
                                onChange={e => setLocalForm(prev => ({ ...prev, device_id: e.target.value }))}
                                className="w-full bg-black border border-gray-700 rounded px-1 text-[10px] h-6 text-white focus:border-cyan-500 outline-none"
                                placeholder="Device ID"
                            />
                            <div className="flex gap-1 mt-auto">
                                <button onClick={handleSaveClick} className="flex-1 bg-green-900/30 text-green-500 hover:text-green-400 text-[9px] h-5 rounded flex items-center justify-center font-bold tracking-wider">SAVE</button>
                                <button onClick={handleCancelClick} className="flex-1 bg-red-900/30 text-red-500 hover:text-red-400 text-[9px] h-5 rounded flex items-center justify-center font-bold tracking-wider">CANCEL</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex justify-between items-start">
                                <div>
                                    {isReceiving && (
                                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 mb-1 inline-block animate-pulse">
                                            RECEIVING
                                        </span>
                                    )}
                                    {isPartial && (
                                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 mb-1 inline-block">
                                            PARTIAL
                                        </span>
                                    )}
                                    <h3 className="text-sm font-bold text-gray-200 group-hover:text-cyan-400 truncate capitalize transition-colors">{crop.class}</h3>
                                    <p className="text-[10px] text-gray-500 font-mono truncate">Device: {crop.device_id}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-black text-white border-gray-700">
                                        {crop.accuracy}%
                                    </span>
                                    {isAdmin && (
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onEditStart(crop); }}
                                                className="text-cyan-500 hover:text-cyan-400 hover:bg-cyan-900/20 p-1 rounded transition-colors"
                                                title="Edit"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDelete(crop); }}
                                                className="text-red-500 hover:text-red-400 hover:bg-red-900/20 p-1 rounded transition-colors"
                                                title="Delete"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2 mt-2">
                                <div className="flex flex-col gap-0.5 flex-1">
                                    <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                        <span className="font-mono text-gray-400">
                                            {crop.location && typeof crop.location.latitude === 'number'
                                                ? `${crop.location.latitude.toFixed(4)}, ${crop.location.longitude.toFixed(4)}`
                                                : <span className="text-gray-600 italic">No Signal</span>
                                            }
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-[10px] text-gray-600">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <span>{new Date(crop.captured_time).toLocaleTimeString()}</span>
                                    </div>
                                </div>
                                {crop.location?.latitude && (
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className="w-16 h-10 rounded overflow-hidden border border-gray-700 hover:border-cyan-500 cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-cyan-500 shadow-sm"
                                        onClick={handleMapClick}
                                        onKeyDown={handleMapKeyDown}
                                        title="Click to view on map"
                                        aria-label={`View detection at ${crop.location.latitude}, ${crop.location.longitude} on map`}
                                    >
                                        <DetectionMiniMap
                                            latitude={crop.location.latitude}
                                            longitude={crop.location.longitude}
                                        />
                                    </div>
                                )}
                            </div>

                            {activeTransfer && (
                                <div className="mt-2 pt-2 border-t border-cyan-500/20">
                                    <TransferProgressBar
                                        percent={activeTransfer.percent}
                                        label={
                                            <>
                                                <span className="animate-pulse">●</span> Receiving...
                                            </>
                                        }
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
});

function DetectionList({
    detections = [],
    onSelectDetection,
    onViewContext,
    onOpenDetail,
    onUpdate,
    isAdmin,
    isActive = true
}) {
    const [filter, setFilter] = useState('');
    const [editingId, setEditingId] = useState(null);
    const ITEM_HEIGHT = 106;
    const VISIBLE_BUFFER = 5;
    const parentRef = useRef(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(600);
    const { activeTransfers } = useTransferUpdates(isActive);

    useEffect(() => {
        if (!isActive || !parentRef.current) return;

        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });
        resizeObserver.observe(parentRef.current);
        return () => resizeObserver.disconnect();
    }, [isActive]);

    const handleScroll = useCallback((e) => {
        if (!isActive) return;

        const target = e.currentTarget;
        requestAnimationFrame(() => {
            setScrollTop(target.scrollTop);
        });
    }, [isActive]);

    const filteredDetections = useMemo(() => {
        const lowerFilter = filter.toLowerCase();
        return detections.filter(d =>
            d.class.toLowerCase().includes(lowerFilter) ||
            (d.device_id && d.device_id.toLowerCase().includes(lowerFilter))
        );
    }, [detections, filter]);

    const handleEditStart = useCallback((crop) => {
        setEditingId(crop.crop_id);
    }, []);

    const handleSave = useCallback(async (crop, newData) => {
        try {
            if (newData.class !== crop.class || newData.accuracy !== crop.accuracy) {
                await fetch(`/api/crop/${crop.crop_id}`, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        class: newData.class,
                        confidence: newData.accuracy
                    })
                });
            }
            if (newData.device_id !== crop.device_id) {
                await fetch(`/api/record/${crop.record_id}`, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ device_id: newData.device_id })
                });
            }

            if (onUpdate) {
                onUpdate(crop.crop_id, newData);
            }

            setEditingId(null);
        } catch (err) {
            console.error('Failed to update detection:', err);
        }
    }, [onUpdate]);

    const handleDelete = useCallback(async (crop) => {
        if (window.confirm(`Are you sure you want to delete this detection (${crop.class})?`)) {
            try {
                await fetch(`/api/crop/${crop.crop_id}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });
            } catch (err) {
                console.error('Failed to delete detection:', err);
                alert('Failed to delete detection');
            }
        }
    }, []);

    const handleCancelEdit = useCallback(() => setEditingId(null), []);
    const activeTransfersByRecordId = useMemo(() => {
        const transfersMap = new Map();
        activeTransfers.forEach((transfer) => {
            if (transfer.record_id) {
                transfersMap.set(transfer.record_id, transfer);
            }
        });
        return transfersMap;
    }, [activeTransfers]);
    const totalContentHeight = filteredDetections.length * ITEM_HEIGHT;
    const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const endIndex = Math.min(
        filteredDetections.length,
        Math.floor((scrollTop + containerHeight) / ITEM_HEIGHT) + VISIBLE_BUFFER
    );

    const visibleStartIndex = Math.max(0, startIndex - VISIBLE_BUFFER);
    const visibleItems = filteredDetections.slice(visibleStartIndex, endIndex);
    const getVirtualRowStyle = (top, isEditing) => ({
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${ITEM_HEIGHT - 8}px`,
        transform: `translateY(${top}px)`,
        zIndex: isEditing ? 50 : 1
    });

    return (
        <div className="h-full flex flex-col bg-black">
            <TransferProgressBanner transfers={activeTransfers} />

            {/* Header */}
            <div className="p-4 border-b border-gray-900 flex flex-col gap-3 bg-black sticky top-0 z-10">
                <div className="flex justify-between items-center">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span>
                        Active
                        <span className="text-gray-600 font-mono">[{filteredDetections.length}]</span>
                    </h2>
                </div>

                {/* Filter */}
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Filter detections..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-900 rounded-lg px-3 py-2 text-xs text-gray-300 focus:border-gray-700 focus:outline-none transition-colors placeholder-gray-700"
                    />
                    <svg className="w-3.5 h-3.5 text-gray-700 absolute right-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
            </div>

            { }
            <div
                ref={parentRef}
                className="flex-1 overflow-y-auto custom-scrollbar relative isolate"
                onScroll={handleScroll}
            >
                <div style={{ height: `${totalContentHeight}px`, width: '100%', position: 'relative' }}>
                    {visibleItems.map((crop, index) => {
                        const actualIndex = visibleStartIndex + index;
                        const topPosition = actualIndex * ITEM_HEIGHT;
                        const isEditingItem = editingId === crop.crop_id;

                        return (
                            <div
                                key={crop.crop_id}
                                style={getVirtualRowStyle(topPosition, isEditingItem)}
                                className="px-2"
                            >
                                <DetectionItem
                                    crop={crop}
                                    activeTransfer={activeTransfersByRecordId.get(crop.record_id)}
                                    isEditing={isEditingItem}
                                    isAdmin={isAdmin}
                                    onSelect={onSelectDetection}
                                    onViewContext={onViewContext}
                                    onOpenDetail={onOpenDetail}
                                    onEditStart={handleEditStart}
                                    onSave={handleSave}
                                    onCancelEdit={handleCancelEdit}
                                    onDelete={handleDelete}
                                />
                            </div>
                        );
                    })}
                </div>

                {filteredDetections.length === 0 && (
                    <div className="text-center py-10 text-gray-600 text-xs absolute top-0 w-full">
                        No detections found
                    </div>
                )}
            </div>
        </div>
    );
}

export default React.memo(DetectionList);
