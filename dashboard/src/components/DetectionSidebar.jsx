import React, { useState, useCallback, memo, useEffect } from 'react';
import api from '../services/api';
import { useUiTranslation } from '../i18n/useUiTranslation';
import { localizeDetectionClassName } from '../utils/detectionLabels';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ';

const EditableField = memo(({
    field,
    value,
    isEditing,
    isAdmin,
    onStartEdit,
    onSave,
    onCancel,
    inputClassName,
    children
}) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        if (isEditing) {
            setLocalValue(value);
        }
    }, [isEditing, value]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') onSave(field, localValue);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
    };

    if (isAdmin && isEditing) {
        return (
            <input
                autoFocus
                value={localValue}
                onChange={e => setLocalValue(e.target.value)}
                onBlur={() => onSave(field, localValue)}
                onKeyDown={handleKeyDown}
                onClick={e => e.stopPropagation()}
                className={inputClassName}
            />
        );
    }

    return (
        <div className="flex items-center gap-2 group">
            {children}
            {isAdmin && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onStartEdit(field);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-cyan-500 text-xs transition-opacity"
                >
                    ✎
                </button>
            )}
        </div>
    );
});

const DetectionItem = memo(({ crop, isSelected, isAdmin, editingField, onSelect, onEditStart, onEditSave, onEditCancel, onDelete }) => {
    const { t } = useUiTranslation(['detectionDetail']);
    const localizedClass = localizeDetectionClassName(crop.class, t);
    const handleStartEdit = useCallback((field) => {
        onEditStart({ id: crop.crop_id, field });
    }, [onEditStart, crop.crop_id]);

    const handleSave = useCallback((field, val) => {
        onEditSave(crop.crop_id, field, val);
    }, [onEditSave, crop.crop_id]);

    return (
        <div
            onClick={() => onSelect(crop)}
            className={`relative flex items-center gap-3 p-3 rounded border cursor-pointer transition-all group ${isSelected ? 'bg-gray-800 border-cyan-500 ring-1 ring-cyan-500' : 'bg-[#18181b] border-gray-700 hover:border-gray-600'}`}
        >
            <div className="w-16 h-16 bg-black rounded overflow-hidden flex-shrink-0 border border-gray-700">
                <img
                    src={`/api/image/crop/${crop.crop_id}`}
                    loading="lazy"
                    alt={localizedClass}
                    className="w-full h-full object-cover"
                />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                    { }
                    <EditableField
                        field="class"
                        value={crop.class}
                        isEditing={editingField === 'class'}
                        isAdmin={isAdmin}
                        onStartEdit={handleStartEdit}
                        onSave={handleSave}
                        onCancel={onEditCancel}
                        inputClassName="bg-black text-white border border-cyan-500 w-24 px-1 outline-none text-sm font-bold"
                    >
                        <span className="text-base font-bold text-white truncate">{localizedClass}</span>
                    </EditableField>

                    { }
                    <EditableField
                        field="accuracy"
                        value={crop.accuracy}
                        isEditing={editingField === 'accuracy'}
                        isAdmin={isAdmin}
                        onStartEdit={handleStartEdit}
                        onSave={handleSave}
                        onCancel={onEditCancel}
                        inputClassName="bg-black text-white border border-cyan-500 w-12 px-1 outline-none text-xs font-mono text-right"
                    >
                        <span className={`text-xs font-mono ${crop.accuracy > 80 ? 'text-green-400' : 'text-yellow-400'}`}>
                            {crop.accuracy}%
                        </span>
                    </EditableField>
                </div>
                <div className="text-xs text-gray-500 font-mono truncate">
                    {t('detectionDetail.idPrefix')}: {String(crop.crop_id).substring(0, 8)}...
                </div>
            </div>

            {isAdmin && (
                <button
                    onClick={(e) => onDelete(crop.crop_id, e)}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 p-1 transition-opacity"
                    title={t('detectionDetail.deleteDetection')}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
        </div>
    );
});

export default function DetectionSidebar({
    recordId,
    detections,
    selectedCrop,
    onSelectCrop,
    isAdmin,
    onViewOnMap,
    onRefresh,
    detectionTransferStatus,
    recordMetadata
}) {
    const { t } = useUiTranslation(['detectionDetail']);
    const [editMode, setEditMode] = useState(null);
    const [editValue, setEditValue] = useState('');
    const metadata = recordMetadata || (detections.length > 0 ? detections[0] : null);
    const handleEditCancel = useCallback(() => {
        setEditMode(null);
    }, []);

    const handleEditStart = useCallback((mode) => {
        setEditMode(mode);
    }, []);

    const handleSave = useCallback(async (id, field, value) => {
        setEditMode(null);
        if (value === undefined || value === null) return;

        try {
            if (field === 'device_id') {
                await api.updateRecord(recordId, { device_id: value });
            } else if (field === 'class') {
                await api.updateCrop(id, { class: value });
            } else if (field === 'accuracy') {
                const numVal = parseFloat(value);
                if (isNaN(numVal)) return;
                await api.updateCrop(id, { confidence: numVal });
            }
            if (onRefresh) onRefresh();
        } catch (err) {
            console.error(`Failed to update ${field}:`, err);
        }
    }, [recordId, onRefresh]);

    const handleDelete = useCallback(async (cropId, e) => {
        e.stopPropagation();
        if (window.confirm(t('detectionDetail.deleteConfirm'))) {
            try {
                await api.deleteCrop(cropId);
                if (onRefresh) onRefresh();
            } catch (err) {
                console.error('Failed to delete crop:', err);
            }
        }
    }, [onRefresh, t]);

    const isEditingRecord = editMode?.id === 'record';

    return (
        <div className="flex flex-col md:h-full border-l border-gray-800 bg-[#0f0f0f]">
            { }
            {detectionTransferStatus?.status === 'receiving' && detectionTransferStatus?.transfer && (
                <div className="p-3 border-b border-cyan-500/30 bg-gradient-to-r from-cyan-900/20 to-transparent">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="animate-pulse text-cyan-400">●</span>
                        <span className="text-xs font-bold text-cyan-400">{t('detectionDetail.imageTransferInProgress')}</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                            style={{ width: `${detectionTransferStatus.transfer.percent}%` }}
                        />
                    </div>
                </div>
            )}

            { }
            <div className="p-4 border-b border-gray-800 bg-[#18181b] space-y-4">
                {metadata ? (
                    <>
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">{t('detectionDetail.deviceInfo')}</h3>
                            <div className="grid grid-cols-1 gap-2 text-sm">
                                <div>
                                    <span className="text-gray-500 block text-xs">{t('detectionDetail.deviceId')}</span>
                                    {isAdmin && isEditingRecord ? (
                                        <input
                                            autoFocus
                                            value={editValue}
                                            onChange={e => setEditValue(e.target.value)}
                                            onBlur={() => handleSave(recordId, 'device_id', editValue)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleSave(recordId, 'device_id', editValue);
                                                if (e.key === 'Escape') setEditMode(null);
                                            }}
                                            className="bg-black text-white border border-cyan-500 w-full px-1 outline-none font-mono font-bold"
                                        />
                                    ) : (
                                        <div className="flex items-center gap-2 group">
                                            <span className="text-cyan-400 font-mono font-bold">{metadata.device_id || metadata.solo_id || t('detectionDetail.unknown')}</span>
                                            {isAdmin && (
                                                <button
                                                    onClick={() => {
                                                        setEditMode({ id: 'record', field: 'device_id' });
                                                        setEditValue(metadata.device_id || metadata.solo_id || '');
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-cyan-500"
                                                >

                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">{t('detectionDetail.location')}</h3>
                            <div className="space-y-1">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">{t('detectionDetail.coordinates')}:</span>
                                    <span className="text-gray-300 font-mono">
                                        {metadata.location ? `${metadata.location.latitude?.toFixed(5)}, ${metadata.location.longitude?.toFixed(5)}` : t('detectionDetail.na')}
                                    </span>
                                </div>
                                {metadata.location?.address && (
                                    <div className="text-xs text-gray-400 truncate" title={metadata.location.address}>
                                        {metadata.location.address}
                                    </div>
                                )}

                                {metadata.location && metadata.location.latitude && (
                                    <div className="mt-3 w-full h-24 bg-black rounded overflow-hidden border border-gray-800 relative group">
                                        <img
                                            src={`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+06b6d4(${metadata.location.longitude},${metadata.location.latitude})/${metadata.location.longitude},${metadata.location.latitude},12,0/300x200?access_token=${MAPBOX_TOKEN}`}
                                            alt={t('detectionDetail.locationAlt')}
                                            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer"
                                            onClick={() => onViewOnMap && onViewOnMap(metadata)}
                                        />
                                    </div>
                                )}

                                { }
                                {metadata.location && (
                                    <button
                                        onClick={() => onViewOnMap && onViewOnMap(metadata)}
                                        className="w-full mt-2 bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-400 text-xs font-bold py-2 px-3 rounded border border-cyan-900/50 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        {t('detectionDetail.seeOnMap')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-gray-500 text-sm">{t('detectionDetail.noRecordInformation')}</div>
                )}
            </div>

            <div className="p-4 border-b border-gray-800 bg-[#18181b]">
                <h3 className="font-bold text-white mb-1">{t('detectionDetail.detectedObjects')}</h3>
                <p className="text-sm text-gray-500">{t('detectionDetail.objectsFoundInFrame', { count: detections.length })}</p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                {detections.length === 0 ? (
                    <div className="text-gray-500 text-center py-8 text-sm italic">
                        {t('detectionDetail.noObjectsDetectedShort')}
                    </div>
                ) : (
                    detections.map(crop => (
                        <DetectionItem
                            key={crop.crop_id}
                            crop={crop}
                            isSelected={selectedCrop?.crop_id === crop.crop_id}
                            isAdmin={isAdmin}
                            editingField={editMode?.id === crop.crop_id ? editMode.field : null}
                            onSelect={onSelectCrop}
                            onEditStart={handleEditStart}
                            onEditSave={handleSave}
                            onEditCancel={handleEditCancel}
                            onDelete={handleDelete}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
