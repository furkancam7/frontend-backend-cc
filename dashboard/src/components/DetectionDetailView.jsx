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
    const { activeTransfers } = useTransferUpdates(!!recordId);
    const [fallbackTime] = useState(Date.now());
    const recordCrops = useMemo(() => {
        return detections.filter(d => d.record_id === recordId);
    }, [detections, recordId]);
    
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
                    selectedCrop={selectedCrop}
                    activeTransfers={activeTransfers}
                    detectionTransferStatus={detectionTransferStatus}
                />
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
