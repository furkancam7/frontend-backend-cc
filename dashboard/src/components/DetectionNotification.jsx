import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { HQ } from '../constants';

const FireIcon = () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 23c-3.6 0-7-2.4-7-7 0-3.1 2.1-5.7 4-7.6.3-.3.8-.1.8.4v2.5c0 .3.4.5.6.3 2.3-2.1 4-5.2 4.6-8.3.1-.4.5-.5.8-.2C18 5.3 19 9 19 12c0 5.5-3.2 11-7 11z" />
    </svg>
);

const SmokeIcon = () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
    </svg>
);

const DefaultIcon = () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
);

const RAW_CATEGORIES = {
    fire: {
        name: 'Fire',
        color: '#EF4444',
        bgColor: 'rgba(239, 68, 68, 0.15)',
        borderColor: 'rgba(239, 68, 68, 0.5)',
        Icon: FireIcon,
        classes: ['fire', 'flame', 'yangin', 'ates']
    },
    smoke: {
        name: 'Smoke',
        color: '#EF4444',
        bgColor: 'rgba(239, 68, 68, 0.15)',
        borderColor: 'rgba(239, 68, 68, 0.5)',
        Icon: SmokeIcon,
        classes: ['smoke', 'duman']
    }
};

const CATEGORIES = {};
Object.entries(RAW_CATEGORIES).forEach(([key, value]) => {
    CATEGORIES[key] = { ...value, key };
});

const UNKNOWN_CATEGORY = {
    key: 'unknown',
    name: 'Detection',
    color: '#6B7280',
    bgColor: 'rgba(107, 114, 128, 0.15)',
    borderColor: 'rgba(107, 114, 128, 0.5)',
    Icon: DefaultIcon,
    classes: []
};

const CLASS_TO_CATEGORY_MAP = {};
Object.values(CATEGORIES).forEach((category) => {
    category.classes.forEach(className => {
        CLASS_TO_CATEGORY_MAP[className] = category;
    });
});

const getCategory = (className) => {
    const lowerClass = className?.toLowerCase();
    if (!lowerClass) return UNKNOWN_CATEGORY;

    if (CLASS_TO_CATEGORY_MAP[lowerClass]) {
        return CLASS_TO_CATEGORY_MAP[lowerClass];
    }

    for (const category of Object.values(CATEGORIES)) {
        if (category.classes.some(c => lowerClass.includes(c))) {
            return category;
        }
    }

    return UNKNOWN_CATEGORY;
};

const formatAccuracy = (accuracy) => {
    if (accuracy == null) return '';
    if (typeof accuracy !== 'number') return accuracy;
    return accuracy > 1 ? accuracy.toFixed(0) : (accuracy * 100).toFixed(0);
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const formatDistance = (distance) => {
    if (distance === null) return 'Unknown';
    if (distance < 1) return `${Math.round(distance * 1000)}m`;
    return `${distance.toFixed(1)}km`;
};

const NotificationItem = React.memo(({ notification, onDismiss, onClick, zIndex = 1 }) => {
    const [isExiting, setIsExiting] = useState(false);
    const category = getCategory(notification.class);
    const isFireCategory = category.key === 'fire' || category.key === 'smoke';
    const distance = useMemo(() => {
        if (notification.location?.latitude && notification.location?.longitude) {
            return calculateDistance(
                HQ.LATITUDE,
                HQ.LONGITUDE,
                notification.location.latitude,
                notification.location.longitude
            );
        }
        return null;
    }, [notification.location]);

    const handleDismiss = useCallback(() => {
        setIsExiting(true);
        setTimeout(() => onDismiss(notification.id), 300);
    }, [onDismiss, notification.id]);

    // Fire and smoke are critical - no auto-dismiss
    // No auto-dismiss timer needed since only fire/smoke notifications exist

    const handleClick = (e) => {
        e.stopPropagation();
        onClick(notification);
        handleDismiss();
    };

    return (
        <div
            className={`
                relative mb-2 rounded-lg overflow-hidden cursor-pointer
                transition-all duration-300 ease-out
                ${isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
            `}
            style={{
                background: 'linear-gradient(135deg, rgba(30, 30, 30, 0.95) 0%, rgba(15, 15, 15, 0.98) 100%)',
                backdropFilter: 'blur(10px)',
                border: isFireCategory ? '1px solid rgba(239, 68, 68, 1)' : '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: isFireCategory
                    ? '0 0 15px rgba(239, 68, 68, 0.6)'
                    : '0 4px 20px rgba(0, 0, 0, 0.5)',
                zIndex
            }}
            onClick={handleClick}
            role="alert"
        >
            {}
            {isFireCategory && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-600 via-red-500 to-red-600 animate-pulse" />
            )}

            <div className="p-2 sm:p-3">
                {}
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-gray-300 text-[10px] sm:text-xs font-bold tracking-wider pl-1 truncate">{notification.device_id || 'Unknown Device'}</span>
                    {isFireCategory && (
                        <span className="px-1 py-0.5 bg-red-600/80 text-white text-[7px] sm:text-[8px] font-bold rounded tracking-wider animate-pulse flex-shrink-0">
                            CRITICAL
                        </span>
                    )}
                </div>

                {}
                <div className="flex items-start gap-2 sm:gap-3">
                    {}
                    <div className="flex-shrink-0">
                        {notification.image_path ? (
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg overflow-hidden border border-gray-600 bg-gray-800">
                                <img
                                    src={notification.image_path.startsWith('http') ? notification.image_path : `/api${notification.image_path}`}
                                    alt="Crop"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        ) : (
                            <div
                                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center border"
                                style={{
                                    backgroundColor: `${category.color}20`,
                                    borderColor: `${category.color}50`
                                }}
                            >
                                <div style={{ color: category.color }}>
                                    <category.Icon />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5">
                        {}
                        <div className="text-white font-bold text-[11px] sm:text-sm mb-0.5 uppercase tracking-wide truncate">
                            {notification.class} DETECTED
                        </div>

                        {}
                        <div className="text-red-400 text-[10px] sm:text-xs font-medium flex items-center gap-1">
                            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {formatDistance(distance)} away
                        </div>

                        {}
                        <div className="flex items-center gap-1 sm:gap-2 mt-1 text-[9px] sm:text-[10px] text-gray-500">
                            <span className="capitalize truncate">{notification.class}</span>
                            <span>-</span>
                            <span className="flex-shrink-0">{formatAccuracy(notification.accuracy)}%</span>
                        </div>
                    </div>

                    {}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDismiss();
                        }}
                        className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                        aria-label="Dismiss notification"
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
});

const DetectionNotification = ({ notifications, onDismiss, onClick }) => {
    const displayNotifications = useMemo(() => {
        const LIMIT = 50;
        const count = notifications.length;
        const start = Math.max(0, count - LIMIT);
        const subset = notifications.slice(start, count);
        return subset.reverse();
    }, [notifications]);

    return (
        <div className="fixed top-28 sm:top-16 md:top-20 right-2 sm:right-4 left-auto w-[calc(100vw-6rem)] max-w-[280px] sm:max-w-[300px] sm:w-[300px] z-[9999] pointer-events-none flex flex-col">
            <div className="max-h-[calc(100vh-120px)] overflow-y-auto overflow-x-hidden pointer-events-auto flex flex-col w-full py-2 custom-scrollbar no-scrollbar">
                {displayNotifications.map((notification, index) => (
                    <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onDismiss={onDismiss}
                        onClick={onClick}
                        zIndex={displayNotifications.length - index}
                    />
                ))}
            </div>
        </div>
    );
};

export { DetectionNotification, getCategory, CATEGORIES };
export default React.memo(DetectionNotification);
