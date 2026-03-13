import React, { useState, useEffect, useMemo } from 'react';
import ImageCanvas from './ImageCanvas';
import DetectionSidebar from './DetectionSidebar';
import useTransferUpdates from '../hooks/useTransferUpdates';

export default function DetectionDetailView({
    recordId,
    detections,
    onClose,
    onViewOnMap,
    isAdmin,
    onRefresh
}) {
    const [selectedCrop, setSelectedCrop] = useState(null);
    const [showBbox, setShowBbox] = useState(true);
    const { activeTransfers } = useTransferUpdates(!!recordId);
    const [fallbackTime] = useState(Date.now());
    const recordCrops = useMemo(() => {
        return detections.filter(d => d.record_id === recordId);
    }, [detections, recordId]);

    // Auto-select first crop so bbox is drawn by default
    useEffect(() => {
        if (recordCrops.length > 0 && !selectedCrop) {
            setSelectedCrop(recordCrops[0]);
        }
    }, [recordCrops, selectedCrop]);
    
    const firstCrop = recordCrops[0];
    const isPartial = firstCrop?.raw?.is_partial;
    const updatedAt = useMemo(() => {
        return firstCrop?.raw?.updated_at || firstCrop?.captured_time || fallbackTime;
    }, [firstCrop?.raw?.updated_at, firstCrop?.captured_time, fallbackTime]);

    const activeTransfer = useMemo(
        () => activeTransfers.find((transfer) => transfer.record_id === recordId) || null,
        [activeTransfers, recordId]
    );
    const detectionTransferStatus = useMemo(() => (
        activeTransfer
            ? {
                success: true,
                status: 'receiving',
                transfer: activeTransfer,
            }
            : {
                success: true,
                status: 'completed',
                transfer: null,
            }
    ), [activeTransfer]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col md:flex-row bg-black overflow-auto md:overflow-hidden">
            {}
            <div className="absolute top-2 right-2 md:top-0 md:left-0 md:right-96 z-50 md:p-4 flex justify-end md:justify-between items-start pointer-events-none">
                <div className="pointer-events-auto hidden md:block">
                    {}
                </div>
                <button
                    onClick={onClose}
                    className="pointer-events-auto bg-black/70 hover:bg-red-900/80 text-white rounded-full p-2 transition-colors border border-white/20"
                >
                    <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {}
            <div className="relative bg-[#0a0a0a] h-[35vh] md:h-auto md:flex-1 flex-shrink-0">
                <ImageCanvas
                    recordId={recordId}
                    isPartial={isPartial}
                    updatedAt={updatedAt}
                    selectedCrop={showBbox ? selectedCrop : null}
                    activeTransfers={activeTransfers}
                    detectionTransferStatus={detectionTransferStatus}
                />
                {selectedCrop && (
                    <button
                        onClick={() => setShowBbox(prev => !prev)}
                        className={`absolute top-3 left-3 z-30 w-8 h-8 flex items-center justify-center rounded-lg border transition-all ${showBbox ? 'bg-cyan-900/80 border-cyan-500 text-cyan-300' : 'bg-gray-900/80 border-gray-600 text-gray-400 hover:text-white'}`}
                        title={showBbox ? 'Hide bounding box' : 'Show bounding box'}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {showBbox ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                            )}
                        </svg>
                    </button>
                )}
            </div>

            {}
            <div className="w-full md:w-96 flex-shrink-0 z-20 md:h-full bg-[#0f0f0f] overflow-auto">
                <DetectionSidebar
                    recordId={recordId}
                    detections={recordCrops}
                    selectedCrop={selectedCrop}
                    onSelectCrop={setSelectedCrop}
                    isAdmin={isAdmin}
                    onViewOnMap={onViewOnMap}
                    onRefresh={onRefresh}
                    detectionTransferStatus={detectionTransferStatus}
                    recordMetadata={firstCrop}
                />
            </div>
        </div>
    );
}
