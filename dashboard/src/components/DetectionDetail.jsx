import React, { useState, useEffect } from 'react';
import api from '../services/api';

const SafeImage = ({ src, alt, className, iconClassName = "w-8 h-8", ...props }) => {
    const [status, setStatus] = useState('loading'); 

    useEffect(() => {
        if (!src) {
            setStatus('error');
        } else {
            setStatus('loading');
        }
    }, [src]);

    const handleLoad = () => setStatus('loaded');
    const handleError = () => setStatus('error');

    if (status === 'error') {
        return (
            <div className={`flex flex-col items-center justify-center w-full h-full bg-zinc-950/30 text-zinc-700 ${className}`}>
                <svg 
                    className={`opacity-20 mb-1 ${iconClassName}`}
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-[10px] font-mono">No Image</span>
            </div>
        );
    }

    return (
        <>
            {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-zinc-950/50">
                     <svg className="w-5 h-5 text-zinc-600 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                     </svg>
                </div>
            )}
            <img
                src={src}
                alt={alt}
                className={`${className} transition-opacity duration-300 ${status === 'loading' ? 'opacity-0' : 'opacity-100'}`}
                onLoad={handleLoad}
                onError={handleError}
                loading="lazy"
                {...props}
            />
        </>
    );
};

const DetectionCard = React.memo(({ detection }) => {
    return (
        <div className="bg-gray-950 rounded-xl p-3 border border-gray-900 hover:border-gray-800 transition-all duration-300 group">
            <div className="mb-3 flex justify-between items-start">
                <span className="inline-block bg-gray-900 text-cyan-400 border border-gray-800 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                    {detection.class_name}
                </span>
                <span className={`text-[10px] font-mono font-bold ${detection.confidence > 0.8 ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {detection.formattedConfidence}%
                </span>
            </div>

            <div className="w-full h-32 bg-black rounded-lg mb-3 border border-gray-900 flex items-center justify-center overflow-hidden relative">
                <SafeImage
                    src={detection.fullCropUrl}
                    alt={detection.class_name}
                    className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-105"
                    iconClassName="w-6 h-6"
                />
            </div>

            <div className="text-[9px] text-gray-600 space-y-1 font-mono bg-black p-2 rounded-lg border border-gray-900">
                <div className="flex justify-between">
                    <span>X:</span> <span className="text-gray-400">{Math.round(detection.bbox_x1)} - {Math.round(detection.bbox_x2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>Y:</span> <span className="text-gray-400">{Math.round(detection.bbox_y1)} - {Math.round(detection.bbox_y2)}</span>
                </div>
            </div>
        </div>
    );
});

const DetailHeader = ({ recordId, createdAt, onBack }) => (
    <div className="flex items-center justify-between mb-8 sticky top-0 bg-black/95 backdrop-blur z-10 py-3 border-b border-gray-900">
        <button 
            onClick={onBack} 
            className="flex items-center gap-2 px-4 py-2 bg-gray-950 hover:bg-gray-900 text-gray-400 hover:text-white rounded-lg transition-all border border-gray-900 hover:border-gray-800"
        >
            <span className="text-lg">←</span> <span className="text-xs font-bold uppercase tracking-wider">Back</span>
        </button>
        <div className="text-right">
            <h1 className="text-sm font-bold text-white tracking-wider uppercase">Record <span className="text-cyan-500 font-mono">#{recordId}</span></h1>
            <span className="text-[10px] text-gray-600 font-mono block mt-1">
                 {new Date(createdAt).toLocaleString()}
            </span>
        </div>
    </div>
);

const DetailImage = ({ fullImageUrl }) => {
    return (
        <div className="lg:col-span-2 bg-gray-950 rounded-xl border border-gray-900 overflow-hidden">
            <div className="p-4 border-b border-gray-900 flex justify-between items-center bg-black">
                 <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                     Full Frame Capture
                </h3>
                <span className="text-[9px] text-gray-600 bg-gray-950 px-2 py-1 rounded border border-gray-900 font-mono">Original Resolution</span>
            </div>
           
            <div className="relative aspect-video bg-black flex items-center justify-center group">
                <SafeImage 
                    src={fullImageUrl} 
                    alt="Original" 
                    className="w-full h-full object-contain"
                    iconClassName="w-12 h-12"
                />
            </div>
        </div>
    );
};

const DetailMetadata = ({ record, detectionCount }) => (
    <div className="bg-gray-950 rounded-xl border border-gray-900 p-0 flex flex-col h-full">
         <div className="p-4 border-b border-gray-900 bg-black">
             <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                 Analysis Data
            </h3>
        </div>
        
        <div className="p-6 flex-1 flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-5">
                <div className="bg-black p-3 rounded-lg border border-gray-900">
                    <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold block mb-1">Device ID</span>
                    <p className="text-cyan-400 font-mono font-bold text-lg">{record.device_id || 'N/A'}</p>
                </div>
                
                <div className="flex gap-4">
                    <div className="flex-1">
                        <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold block mb-1">Location</span>
                        <p className="text-zinc-300 font-mono text-sm break-words">{record.location || 'Unknown'}</p>
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-900">
                    <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold block mb-2">Detections Found</span>
                    <div className="flex items-end gap-2">
                        <p className="text-white text-4xl font-bold leading-none">{detectionCount}</p>
                        <span className="text-sm text-gray-600 mb-1">objects</span>
                    </div>
                </div>
            </div>
        </div>
        
        {/* Footer */}
        <div className="bg-black p-3 border-t border-gray-900">
            <p className="text-gray-700 text-[9px] font-mono text-center break-all select-all cursor-text">
                UUID: {record.record_id || record.id}
            </p>
        </div>
    </div>
);

export default function DetectionDetail({ detectionId, onBack }) {
    const [state, setState] = useState({
        details: null,
        loading: true,
        error: null
    });

    useEffect(() => {
        const controller = new AbortController();
        
        const loadDetails = async () => {
            setState(prev => ({ ...prev, loading: true, error: null }));
            try {
                const data = await api.getDetectionDetails(detectionId, { signal: controller.signal });
    
                if (data) {
                    if (data.record) {
                        const filename = data.record.original_image_path ? data.record.original_image_path.split('/').pop() : null;
                        data.record.fullImageUrl = filename ? api.getImageUrl(filename) : null;
                    }
                    if (data.detections) {
                        data.detections = data.detections.map(d => ({
                            ...d,
                            formattedConfidence: (d.confidence * 100).toFixed(1),
                            fullCropUrl: d.crop_path ? api.getCropUrl(d.crop_path.split('/').pop()) : null
                        }));
                    }
                }

                setState({ details: data, loading: false, error: null });
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error("Detail load error:", err);
                    setState({
                        details: null,
                        loading: false,
                        error: err.message || "Failed to load detection details."
                    });
                }
            }
        };

        if (detectionId) loadDetails();

        return () => controller.abort();
    }, [detectionId]);

    const { details, loading, error } = state;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
                    <span className="text-zinc-400 animate-pulse text-sm font-mono">Loading details...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 h-full flex flex-col items-center justify-center">
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-8 max-w-md w-full text-center backdrop-blur-sm">
                    <h3 className="text-red-400 text-lg font-bold mb-2">Failed to Load Record</h3>
                    <p className="text-zinc-400 mb-6 text-sm">{error}</p>
                    <button 
                        onClick={onBack} 
                        className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors border border-zinc-700 font-medium text-sm"
                    >
                        ← Return to List
                    </button>
                </div>
            </div>
        );
    }

    if (!details) return null;

    const { record, detections } = details;

    return (
        <div className="p-6 h-full bg-black text-gray-300 animate-in fade-in slide-in-from-bottom-4 duration-300 overflow-y-auto custom-scrollbar">
            
            <DetailHeader 
                recordId={record.record_id || record.id} 
                createdAt={record.created_at} 
                onBack={onBack} 
            />

            <div className="grid lg:grid-cols-3 gap-6 mb-8">
                <DetailImage fullImageUrl={record.fullImageUrl} />
                <DetailMetadata record={record} detectionCount={detections.length} />
            </div>

            <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <span>Detected Objects</span>
                    </h3>
                </div>

                {detections.length === 0 ? (
                    <div className="bg-zinc-900/50 rounded-xl border border-dashed border-zinc-800 p-12 text-center">
                        <p className="text-zinc-400 font-medium">No objects were detected in this frame.</p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                        {detections.map((detection) => (
                            <DetectionCard key={detection.id} detection={detection} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
