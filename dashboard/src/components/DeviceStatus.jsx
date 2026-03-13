import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { api } from '../services/api';
import { useUiTranslation } from '../i18n/useUiTranslation';
import { toIntlLocale } from '../i18n/locale';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWVyYXhlc2MiLCJhIjoiY21pOGo2Mm13MDU0cjJtcXYzOWoxcGxzdyJ9.wSG0vWOLa94To8P3lYMdxQ';



const DeviceMiniMap = memo(({ latitude, longitude, t }) => {
    if (!latitude || !longitude) {
        return (
            <div className="w-full h-full bg-black flex flex-col items-center justify-center gap-1">
                <svg className="w-4 h-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[9px] text-gray-600 font-medium tracking-wider">{t('deviceStatus.noGps')}</span>
            </div>
        );
    }

    const width = 300;
    const height = 200;
    const zoom = 14;
    const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+22d3ee(${longitude},${latitude})/${longitude},${latitude},${zoom},0/${width}x${height}?access_token=${MAPBOX_TOKEN}`;

    return (
        <div className="relative w-full h-full">
            <img
                src={staticMapUrl}
                alt={t('deviceStatus.locationAlt')}
                className="w-full h-full object-cover"
                loading="lazy"
            />
            {/* Map overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
            {/* Center marker glow */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(252,88,28,0.8)]" />
            </div>
        </div>
    );
});

const DeviceEditForm = ({ device, onSave, onCancel, t }) => {
    const [form, setForm] = useState({
        address: device.location?.address || '',
        latitude: device.location?.latitude || '',
        longitude: device.location?.longitude || ''
    });

    const handleSubmit = (e) => {
        e.stopPropagation();
        onSave(device.id, form);
    };

    return (
        <div className="space-y-2 cursor-default" onClick={e => e.stopPropagation()}>
            <input
                type="text" placeholder={t('deviceStatus.addressPlaceholder')} value={form.address}
                onChange={(e) => setForm(prev => ({ ...prev, address: e.target.value }))}
                className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none transition-colors"
                autoFocus
            />
            <div className="flex gap-2">
                <input
                    type="number" step="any" placeholder={t('deviceStatus.latitudePlaceholder')} value={form.latitude}
                    onChange={(e) => setForm(prev => ({ ...prev, latitude: e.target.value }))}
                    className="w-1/2 bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:border-gray-600 focus:outline-none transition-colors"
                />
                <input
                    type="number" step="any" placeholder={t('deviceStatus.longitudePlaceholder')} value={form.longitude}
                    onChange={(e) => setForm(prev => ({ ...prev, longitude: e.target.value }))}
                    className="w-1/2 bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:border-gray-600 focus:outline-none transition-colors"
                />
            </div>
            <div className="flex gap-2 pt-1">
                <button
                    onClick={handleSubmit}
                    className="flex-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 py-2 rounded-lg text-xs font-bold tracking-wide transition-all"
                >
                    {t('deviceStatus.save')}
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onCancel(); }}
                    className="flex-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 py-2 rounded-lg text-xs font-bold tracking-wide transition-all"
                >
                    {t('deviceStatus.cancel')}
                </button>
            </div>
        </div>
    );
};

const DeviceView = ({ device, isAdmin, onEdit, onDelete, t, locale }) => (
    <>
        {/* Location info */}
        <div className="px-3 pb-3">
            <div className="bg-black rounded-lg p-3 border border-gray-900">
                <div className="flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 text-gray-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-300 truncate">{device.location?.address || t('deviceStatus.unknownLocation')}</p>
                        <p className="text-[10px] text-cyan-400/80 font-mono mt-0.5">
                            {device.location?.latitude ? `${device.location.latitude.toFixed(5)}, ${device.location.longitude.toFixed(5)}` : t('deviceStatus.noGpsData')}
                        </p>
                    </div>
                </div>
            </div>
        </div>

        {/* Footer with timestamp and actions */}
        <div className="px-3 py-2.5 border-t border-gray-900 flex justify-between items-center bg-black/50">
            <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 bg-gray-600 rounded-full"></div>
                <span className="text-[10px] text-gray-500">
                    {t('deviceStatus.lastSeen')}: <span className="text-gray-400 font-mono">{device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString(locale) : t('deviceStatus.never')}</span>
                </span>
            </div>
            {isAdmin && (
                <div className="flex gap-1">
                    <button
                        onClick={(e) => { e.stopPropagation(); onEdit(); }}
                        className="p-1.5 rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 transition-all"
                        title={t('deviceStatus.edit')}
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(device.id); }}
                        className="p-1.5 rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-red-400 hover:border-red-900 transition-all"
                        title={t('deviceStatus.delete')}
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    </>
);

const DeviceCard = memo(({ device, isAdmin, onUpdate, onDelete, onSelect, onOpenHeartbeat, t, locale }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const handleSave = useCallback(async (id, data) => {
        await onUpdate(id, data);
        setIsEditing(false);
    }, [onUpdate]);

    return (
        <div
            className="bg-black border border-gray-900 hover:border-gray-700 cursor-pointer transition-all duration-200 rounded-xl overflow-hidden group"
        >
            {/* Card header - always visible */}
            <div
                className="px-4 py-3 flex items-center justify-between"
                onClick={() => !isEditing && setIsCollapsed(!isCollapsed)}
            >
                <div className="flex items-center gap-3">
                    {/* Collapse indicator */}
                    <svg
                        className={`w-3 h-3 text-gray-600 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-wide">{device.name}</h3>
                    </div>
                </div>
                {/* Status area with heartbeat icon */}
                <div className="flex items-center gap-2">
                    {/* Heartbeat icon button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenHeartbeat?.(device);
                        }}
                        className="p-1 rounded-md text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all"
                        title={t('deviceStatus.heartbeatConfig')}
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                    </button>
                    <div className={`w-1.5 h-1.5 rounded-full ${device.online ? 'bg-emerald-400' : 'bg-red-500'}`}
                        style={device.online ? { boxShadow: '0 0 8px rgba(52, 211, 153, 0.6)' } : {}} />
                    <span className={`text-[10px] font-bold tracking-wider ${device.online ? 'text-emerald-400' : 'text-red-500'}`}>
                        {device.online ? t('common.online') : t('common.offline')}
                    </span>
                </div>
            </div>

            {/* Expandable content */}
            {!isCollapsed && (
                <>
                    {/* Mini map section */}
                    <div className="px-4 pb-3" onClick={() => onSelect && onSelect(device)}>
                        <div className="h-20 rounded-lg overflow-hidden border border-gray-900 bg-black">
                            <DeviceMiniMap latitude={device.location?.latitude} longitude={device.location?.longitude} t={t} />
                        </div>
                    </div>

                    {/* Edit form or device info */}
                    {isEditing ? (
                        <div className="px-4 pb-4">
                            <DeviceEditForm
                                device={device}
                                onSave={handleSave}
                                onCancel={() => setIsEditing(false)}
                                t={t}
                            />
                        </div>
                    ) : (
                        <DeviceView
                            device={device}
                            isAdmin={isAdmin}
                            onEdit={() => setIsEditing(true)}
                            onDelete={onDelete}
                            t={t}
                            locale={locale}
                        />
                    )}
                </>
            )}
        </div>
    );
});

function DeviceStatus({ devices, onSelectDevice, isAdmin, onDeviceUpdate, onOpenHeartbeat }) {
    const { t, i18n } = useUiTranslation(['deviceStatus', 'common']);
    const locale = toIntlLocale(i18n.resolvedLanguage);
    const [localDevices, setLocalDevices] = useState(devices || []);
    const [isAdding, setIsAdding] = useState(false);
    const [newDevice, setNewDevice] = useState({ device_id: '', address: '', latitude: '', longitude: '' });

    useEffect(() => {
        setLocalDevices(devices || []);
    }, [devices]);

    const handleUpdate = useCallback(async (id, data) => {
        const originalState = [...localDevices];
        setLocalDevices(prev => prev.map(d => d.id === id ? { ...d, location: { ...d.location, ...data } } : d));

        try {
            await api.updateDevice(id, data);
            if (onDeviceUpdate) onDeviceUpdate();
        } catch (err) {
            console.error('Update failed:', err);
            setLocalDevices(originalState);
            alert(t('deviceStatus.updateFailed'));
        }
    }, [localDevices, onDeviceUpdate, t]);

    const handleDelete = useCallback(async (id) => {
        if (!window.confirm(t('deviceStatus.deleteConfirm'))) return;

        const originalState = [...localDevices];
        setLocalDevices(prev => prev.filter(d => d.id !== id));

        try {
            await api.deleteDevice(id);
            if (onDeviceUpdate) onDeviceUpdate();
        } catch (err) {
            console.error('Delete failed:', err);
            setLocalDevices(originalState);
            alert(t('deviceStatus.deleteFailed'));
        }
    }, [localDevices, onDeviceUpdate, t]);

    const handleAddDevice = async (e) => {
        e.preventDefault();
        try {
            await api.createDevice(newDevice);
            setIsAdding(false);
            setNewDevice({ device_id: '', address: '', latitude: '', longitude: '' });
            if (onDeviceUpdate) onDeviceUpdate();
        } catch (err) {
            console.error('Add failed:', err);
            alert(t('deviceStatus.addFailed'));
        }
    };

    const filteredDevices = useMemo(() => {
        return localDevices;
    }, [localDevices]);

    if (!localDevices) return <div className="h-full flex items-center justify-center text-gray-500 bg-black text-xs">{t('deviceStatus.noData')}</div>;

    return (
        <div className="h-full flex flex-col bg-black">
            {/* Header */}
            <div className="p-3 border-b border-gray-900">
                <div className="flex bg-gray-950 rounded-lg p-1">
                    <div className="flex-1 py-2 px-3 rounded-md text-xs font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-center">
                        {t('deviceStatus.devices')} <span className="opacity-70">({filteredDevices.length})</span>
                    </div>
                </div>
            </div>

            {/* Add device button (admin only) */}
            {isAdmin && (
                <div className="px-3 py-2 border-b border-gray-900">
                    {!isAdding ? (
                        <button
                            onClick={() => setIsAdding(true)}
                            className="w-full py-2.5 bg-gray-950 hover:bg-gray-900 text-gray-400 hover:text-white border border-gray-900 hover:border-gray-800 rounded-lg text-xs font-bold tracking-wider transition-all flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            {t('deviceStatus.addNewDevice')}
                        </button>
                    ) : (
                        <form onSubmit={handleAddDevice} className="bg-gray-950 p-3 rounded-lg border border-gray-900 space-y-2">
                            <input
                                type="text"
                                placeholder={t('deviceStatus.deviceIdPlaceholder')}
                                className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-gray-700 focus:outline-none"
                                value={newDevice.device_id}
                                onChange={e => setNewDevice({ ...newDevice, device_id: e.target.value })}
                                required
                            />
                            <div className="flex gap-2">
                                <button
                                    type="submit"
                                    className="flex-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 py-2 rounded-lg text-xs font-bold tracking-wide transition-all"
                                >
                                    {t('deviceStatus.save')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsAdding(false)}
                                    className="flex-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 py-2 rounded-lg text-xs font-bold tracking-wide transition-all"
                                >
                                    {t('deviceStatus.cancel')}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )}

            {/* Device list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {filteredDevices.map(device => (
                    <DeviceCard
                        key={device.id}
                        device={device}
                        isAdmin={isAdmin}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        onSelect={onSelectDevice}
                        onOpenHeartbeat={onOpenHeartbeat}
                        t={t}
                        locale={locale}
                    />
                ))}
                {filteredDevices.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                        <svg className="w-10 h-10 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs tracking-wider">{t('deviceStatus.noDevicesFound')}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

export default React.memo(DeviceStatus);
