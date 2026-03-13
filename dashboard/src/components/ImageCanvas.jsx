import React, { useState, useRef, useEffect, useCallback } from 'react';

const imageCache = new Map();
const MAX_CACHE_SIZE = 50;

const getCachedImage = (url) => {
    const cached = imageCache.get(url);
    if (cached) {
        imageCache.delete(url);
        imageCache.set(url, cached);
        return cached;
    }
    return null;
};

const setCachedImage = (url, img) => {
    if (imageCache.size >= MAX_CACHE_SIZE) {
        const firstKey = imageCache.keys().next().value;
        imageCache.delete(firstKey);
    }
    imageCache.set(url, img);
};

const LoadingSpinner = ({ title, subtitle, type = 'cyan' }) => {
    const colorClass = type === 'yellow' ? 'text-yellow-400' : 'text-cyan-400';
    const bgClass = type === 'yellow' ? 'bg-yellow-500' : 'bg-cyan-500';
    const borderClass = type === 'yellow' ? 'border-yellow-500/30' : 'border-cyan-500/30';

    return (
        <div className={`flex flex-col items-center gap-4 p-8 bg-[var(--bg-panel)] rounded-xl border ${borderClass}`}>
            <div className="flex items-center gap-3">
                <div className="relative">
                    <div className={`w-4 h-4 rounded-full animate-ping absolute ${bgClass}`} />
                    <div className={`w-4 h-4 rounded-full ${type === 'yellow' ? 'bg-yellow-400' : 'bg-cyan-400'}`} />
                </div>
                <span className={`text-xl font-bold tracking-wider animate-pulse ${colorClass}`}>
                    {title}
                </span>
            </div>
            {subtitle && <p className="text-sm text-[var(--text-muted)] text-center">{subtitle}</p>}
        </div>
    );
};

const TransferProgress = ({ filename, percent, chunksReceived, chunksTotal, isReceiving }) => (
    <div className="w-64">
        <div className="flex justify-between text-xs text-[var(--text-muted)] mb-2">
            <span className="truncate max-w-[180px]">{filename}</span>
            <span className="font-mono text-cyan-400">{percent}%</span>
        </div>
        <div className="h-3 bg-[var(--bg-input)] rounded-full overflow-hidden">
            <div
                className={`h-full transition-all duration-300 ${isReceiving
                        ? 'bg-gradient-to-r from-cyan-600 via-cyan-400 to-cyan-600 bg-[length:200%_100%] animate-[shimmer_2s_infinite]'
                        : 'bg-gradient-to-r from-cyan-500 to-cyan-900'
                    }`}
                style={{ width: `${percent}%` }}
            />
        </div>
        {chunksTotal && (
            <div className="text-center text-xs text-[var(--text-muted)] mt-2 font-mono">
                {chunksReceived} / {chunksTotal} chunks
            </div>
        )}
    </div>
);

export default function ImageCanvas({
    recordId,
    isPartial,
    updatedAt,
    selectedCrop,
    activeTransfers = [],
    detectionTransferStatus = null
}) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const imageRef = useRef(null); 
    const [hasImage, setHasImage] = useState(false); 
    const transformRef = useRef({ x: 0, y: 0, scale: 1 });
    const dragStartRef = useRef({ x: 0, y: 0 });
    const isDraggingRef = useRef(false);
    const [uiScale, setUiScale] = useState(1);
    const pendingImageRef = useRef(null);
    const isFirstLoadRef = useRef(true);
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imageRef.current;
        if (!canvas || !img) return;

        const ctx = canvas.getContext('2d');
        const { x, y, scale } = transformRef.current;
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        if (selectedCrop) {
            const { x1, y1, x2, y2 } = selectedCrop.bbox;
            const scaledLineWidth = 2 / scale;
            const fontSize = 14 / scale;
            const padding = 4 / scale;
            ctx.strokeStyle = '#FC581C';
            ctx.lineWidth = scaledLineWidth;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            ctx.fillStyle = 'rgba(16,48,44,0.2)';
            ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
            ctx.font = `bold ${fontSize}px sans-serif`;
            const text = `${selectedCrop.class} (${selectedCrop.accuracy}%)`;
            const textMetrics = ctx.measureText(text);
            const textHeight = fontSize;
            ctx.fillStyle = '#10302C';
            ctx.fillRect(x1, y1 - textHeight - padding * 2, textMetrics.width + padding * 2, textHeight + padding * 2);
            ctx.fillStyle = 'white';
            ctx.fillText(text, x1 + padding, y1 - padding);
        }

        ctx.restore();
    }, [selectedCrop]);

    const drawRef = useRef(null);
    useEffect(() => {
        drawRef.current = draw;
    }, [draw]);

    const fitImageToContainer = useCallback((img, container) => {
        if (!img || !container) return;
        const { clientWidth, clientHeight } = container;
        const scaleX = clientWidth / img.naturalWidth;
        const scaleY = clientHeight / img.naturalHeight;
        const fitScale = Math.min(scaleX, scaleY);
        const scaledW = img.naturalWidth * fitScale;
        const scaledH = img.naturalHeight * fitScale;
        transformRef.current = {
            scale: fitScale,
            x: (clientWidth - scaledW) / 2,
            y: (clientHeight - scaledH) / 2
        };

        setUiScale(fitScale);
        if (drawRef.current) {
            requestAnimationFrame(drawRef.current);
        }
    }, []);

    const [imageVersion, setImageVersion] = useState(0);
    const prevTransferStatusRef = useRef(null);
    const prevUpdatedAtRef = useRef(updatedAt);

    useEffect(() => {
        isFirstLoadRef.current = true;
        pendingImageRef.current = null;
        imageRef.current = null;
        setHasImage(false);
        prevUpdatedAtRef.current = null;
    }, [recordId]);

    useEffect(() => {
        if (updatedAt && updatedAt !== prevUpdatedAtRef.current) {
            prevUpdatedAtRef.current = updatedAt;
            if (imageRef.current) {
                setImageVersion(v => v + 1);
            }
        }
    }, [updatedAt]);

    useEffect(() => {
        const prevStatus = prevTransferStatusRef.current;
        const currentStatus = detectionTransferStatus?.status;

        if (prevStatus === 'receiving' && currentStatus !== 'receiving') {
            setImageVersion(v => v + 1);
        }

        prevTransferStatusRef.current = currentStatus;
    }, [detectionTransferStatus?.status]);


    const prevChunksRef = useRef(0);
    useEffect(() => {
        const currentChunks = detectionTransferStatus?.transfer?.chunks_received || 0;
        const prevChunks = prevChunksRef.current;

        if (currentChunks > prevChunks && currentChunks > 0) {
            setImageVersion(v => v + 1);
        }

        prevChunksRef.current = currentChunks;
    }, [detectionTransferStatus?.transfer?.chunks_received]);

    const prevIsPartialRef = useRef(isPartial);
    useEffect(() => {
        if (prevIsPartialRef.current === true && isPartial === false) {
            setImageVersion(v => v + 1);
        }
        prevIsPartialRef.current = isPartial;
    }, [isPartial]);

    useEffect(() => {
        let isMounted = true;
        const isTransferring = detectionTransferStatus?.status === 'receiving';

        const loadImage = () => {
            const shouldSkipCache = isPartial || isTransferring;
            const cacheKey = updatedAt ? new Date(updatedAt).getTime() : 0;
            const bustParam = shouldSkipCache ? `&_=${Date.now()}` : '';
            const imgUrl = `/api/image/fullframe/${recordId}?t=${cacheKey}&v=${imageVersion}${bustParam}`;
            
            if (!shouldSkipCache) {
                const cached = getCachedImage(imgUrl);
                if (cached && cached.complete) {
                    imageRef.current = cached;
                    if (isFirstLoadRef.current) {
                        isFirstLoadRef.current = false;
                        setHasImage(true);
                        if (containerRef.current) {
                            fitImageToContainer(cached, containerRef.current);
                        }
                    } else {
                        requestAnimationFrame(() => {
                            if (drawRef.current) drawRef.current();
                        });
                    }
                    return;
                }
            }

            const img = new Image();
            pendingImageRef.current = img;
            img.src = imgUrl;

            img.onload = () => {
                if (!isMounted) return;
                if (pendingImageRef.current !== img) return;

                if (!shouldSkipCache) {
                    setCachedImage(imgUrl, img);
                }
                imageRef.current = img;

                if (isFirstLoadRef.current) {
                    isFirstLoadRef.current = false;
                    setHasImage(true); 
                    if (containerRef.current) {
                        fitImageToContainer(img, containerRef.current);
                    }
                } else {
                    requestAnimationFrame(() => {
                        if (drawRef.current) drawRef.current();
                    });
                }
            };
            img.onerror = (e) => {
                console.error('[ImageCanvas] Image Load Error', e);
            };
        };

        loadImage();

        let interval;
        if (isPartial || isTransferring) {
            const refreshRate = isTransferring ? 1500 : 3000;
            interval = setInterval(loadImage, refreshRate);
        }

        return () => {
            isMounted = false;
            if (interval) clearInterval(interval);
        };
    }, [recordId, updatedAt, isPartial, fitImageToContainer, imageVersion, detectionTransferStatus?.status]);

    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver(() => {
            if (containerRef.current && canvasRef.current) {
                canvasRef.current.width = containerRef.current.clientWidth;
                canvasRef.current.height = containerRef.current.clientHeight;
                requestAnimationFrame(draw);
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [draw]);

    const handleWindowMove = useCallback((e) => {
        if (!isDraggingRef.current) return;
        e.preventDefault();

        const newX = e.clientX - dragStartRef.current.x;
        const newY = e.clientY - dragStartRef.current.y;

        transformRef.current.x = newX;
        transformRef.current.y = newY;

        requestAnimationFrame(draw);
    }, [draw]);

    const handleWindowUp = useCallback(() => {
        isDraggingRef.current = false;
        window.removeEventListener('mousemove', handleWindowMove);
        window.removeEventListener('mouseup', handleWindowUp);
    }, [handleWindowMove]);

    const handleMouseDown = (e) => {
        e.preventDefault();
        isDraggingRef.current = true;
        dragStartRef.current = {
            x: e.clientX - transformRef.current.x,
            y: e.clientY - transformRef.current.y
        };

        window.addEventListener('mousemove', handleWindowMove);
        window.addEventListener('mouseup', handleWindowUp);
    };

    const handleWheel = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const { scale, x, y } = transformRef.current;
        const zoomIntensity = 0.1;
        const delta = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
        const newScale = Math.min(Math.max(0.01, scale * delta), 50);
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const worldX = (mouseX - x) / scale;
        const worldY = (mouseY - y) / scale;
        const newX = mouseX - worldX * newScale;
        const newY = mouseY - worldY * newScale;
        transformRef.current = { scale: newScale, x: newX, y: newY };
        setUiScale(newScale);
        requestAnimationFrame(draw);
    };

    const resetZoom = (e) => {
        if (e) e.stopPropagation();
        if (imageRef.current && containerRef.current) {
            fitImageToContainer(imageRef.current, containerRef.current);
        }
    };

    const renderOverlays = () => {
        if (detectionTransferStatus?.status === 'receiving' && detectionTransferStatus?.transfer) {
            const { transfer } = detectionTransferStatus;
            return (
                <div className="flex flex-col items-center gap-4 p-8 bg-[var(--bg-panel)] rounded-xl border border-cyan-500/30">
                    <LoadingSpinner title="RECEIVING" type="cyan" />
                    <TransferProgress
                        filename={transfer.filename}
                        percent={transfer.percent}
                        chunksReceived={transfer.chunks_received}
                        chunksTotal={transfer.chunks_total}
                        isReceiving={true}
                    />
                </div>
            );
        }

        if (hasImage) return null;

        if (isPartial) {
            return (
                <LoadingSpinner
                    title="PARTIAL IMAGE"
                    subtitle={<span>Image transfer incomplete<br /><span className="text-xs text-[var(--text-muted)]">Waiting for remaining data...</span></span>}
                    type="yellow"
                />
            );
        }

        if (activeTransfers.length > 0) {
            return (
                <div className="flex flex-col items-center gap-4 p-8 bg-[var(--bg-panel)] rounded-xl border border-cyan-500/30">
                    <LoadingSpinner title="TRANSFER IN PROGRESS" type="cyan" />
                    <div className="space-y-4">
                        {activeTransfers.map(t => (
                            <TransferProgress
                                key={t.transfer_id}
                                filename={t.filename}
                                percent={t.percent}
                                isReceiving={false}
                            />
                        ))}
                    </div>
                </div>
            );
        }

        return <div className="text-[var(--text-muted)] animate-pulse">Loading Image...</div>;
    };

    return (
        <div
            ref={containerRef}
            className="flex-1 bg-[var(--bg-deep)] relative flex items-center justify-center overflow-hidden border-r border-[var(--border-color)] cursor-move h-full w-full"
        >
            <canvas
                ref={canvasRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                className="block absolute inset-0"
            />

            { }
            {hasImage && (
                <div className="absolute bottom-12 left-2 sm:bottom-6 sm:left-6 flex gap-1.5 sm:gap-2 z-20" onMouseDown={e => e.stopPropagation()}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            transformRef.current.scale = Math.min(transformRef.current.scale * 1.2, 50);
                            setUiScale(transformRef.current.scale);
                            requestAnimationFrame(draw);
                        }}
                        className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-[var(--bg-panel)] border border-[var(--border-color)] text-[var(--text-main)] rounded hover:bg-[var(--bg-hover)] hover:border-cyan-500 transition-colors font-bold text-sm sm:text-base"
                    >
                        +
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            transformRef.current.scale = Math.max(transformRef.current.scale / 1.2, 0.01);
                            setUiScale(transformRef.current.scale);
                            requestAnimationFrame(draw);
                        }}
                        className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-[var(--bg-panel)] border border-[var(--border-color)] text-[var(--text-main)] rounded hover:bg-[var(--bg-hover)] hover:border-cyan-500 transition-colors font-bold text-sm sm:text-base"
                    >
                        -
                    </button>
                    <button
                        onClick={resetZoom}
                        className="px-2 sm:px-3 h-7 sm:h-8 flex items-center justify-center bg-[var(--bg-panel)] border border-[var(--border-color)] text-[var(--text-main)] rounded hover:bg-[var(--bg-hover)] hover:border-cyan-500 transition-colors text-[10px] sm:text-xs font-bold tracking-wider"
                    >
                        RESET
                    </button>
                    <div className="px-2 sm:px-3 h-7 sm:h-8 flex items-center justify-center bg-[var(--bg-input)] border border-[var(--border-color)] text-cyan-500 rounded text-[10px] sm:text-xs font-mono min-w-[50px] sm:min-w-[60px]">
                        {Math.round(uiScale * 100)}%
                    </div>
                </div>
            )}

            { }
            {!hasImage && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
                    {renderOverlays()}
                </div>
            )}
        </div>
    );
}
