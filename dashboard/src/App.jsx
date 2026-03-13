import React, { Suspense, lazy, useState, useCallback, useMemo } from 'react'
import DetectionList from './components/DetectionList'
import DataTable from './components/DataTable'
import HeaderClock from './components/HeaderClock'
import AlarmPanel from './components/AlarmPanel'
import Login from './components/Login'
import DetectionNotification from './components/DetectionNotification'
import useAuth from './hooks/useAuth'
import useDetections from './hooks/useDetections'
import useDevices from './hooks/useDevices'
import useMapUI from './hooks/useMapUI'
import useMapLocations from './hooks/useMapLocations'
import useAnalysis from './hooks/useAnalysis'
import LanguageThemeControls from './components/LanguageThemeControls'
import { useUiTranslation } from './i18n/useUiTranslation'
import { toIntlLocale } from './i18n/locale'
import { localizeDetectionClassName } from './utils/detectionLabels'

const Icon = React.memo(({ path, className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
  </svg>
));
Icon.displayName = 'Icon';

const PANEL_VIEWS = ['health', 'detections'];
const LazyDeviceHealthPanel = lazy(() => import('./components/DeviceHealthPanel'));
const LazyMapView = lazy(() => import('./components/MapView'));
const LazyDetectionDetailView = lazy(() => import('./components/DetectionDetailView'));
const LazyLocationSettings = lazy(() => import('./components/settings/LocationSettings'));
const LazyDetectionHistory = lazy(() => import('./components/DetectionHistory'));

function PanelLoader({ label = 'Loading Panel' }) {
  return (
    <div className="h-full flex items-center justify-center bg-black text-[10px] text-gray-500 font-mono uppercase tracking-[0.3em]">
      {label}
    </div>
  );
}

function MapLoader({ label = 'Loading Map' }) {
  return (
    <div className="absolute inset-0 bg-[#050608] flex items-center justify-center">
      <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-cyan-500/80 animate-pulse">
        {label}
      </div>
    </div>
  );
}

function OverlayLoader({ label = 'Loading View' }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-cyan-400">
        {label}
      </div>
    </div>
  );
}

function FloatingPanelLoader({ label = 'Loading History' }) {
  return (
    <div className="absolute bottom-24 right-4 sm:right-6 z-[100] w-[calc(100vw-2rem)] sm:w-[400px] md:w-[480px] max-h-[60vh] sm:max-h-[70vh] bg-[#0a0a0a]/95 backdrop-blur-md border border-gray-800 rounded-xl shadow-2xl shadow-black/60 flex items-center justify-center p-6">
      <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-cyan-400">
        {label}
      </div>
    </div>
  );
}

export default function App() {
  const {
    token,
    setToken,
    currentUser,
    setCurrentUser,
    setUserRole,
    isUserAdmin,
    handleLogout,
    handleUnauthorized
  } = useAuth();

  const { t, i18n } = useUiTranslation([
    'common',
    'app',
    'mapStyles',
    'notifications'
  ]);
  const locale = toIntlLocale(i18n.resolvedLanguage);

  const {
    detections,
    notifications,
    selectedContextCrop,
    fullFrameData,
    selectedDetectionId,
    handleSelectDetection,
    handleViewContext,
    closeContextModal,
    handleDismissNotification,
    handleUpdateDetection,
    setSelectedDetectionId
  } = useDetections(token, handleUnauthorized);

  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId
  } = useDevices(token, handleUnauthorized);

  const {
    locations: mapLocations,
    isLoading: locationsLoading,
    error: locationsError,
    updateLocations,
    resetToDefaults
  } = useMapLocations(token);

  const {
    mapStyle,
    isStyleMenuOpen,
    isMapToolsOpen,
    flyToLocation,
    MAP_STYLES,
    handleMapStyleChange,
    toggleStyleMenu,
    toggleMapTools,
    flyToDevice,
    flyToDetection,
    flyToHome,
    flyToResponsibleArea
  } = useMapUI(mapLocations);

  const {
    showHeatmap,
    showHistory,
    toggleHeatmap,
    toggleHistory
  } = useAnalysis();

  const [activeView, setActiveView] = useState('live');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [detailReturnView, setDetailReturnView] = useState('detections');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isAdmin = isUserAdmin;
  const [mountedPanels, setMountedPanels] = useState({
    health: false,
    detections: false,
  });
  const panelWidthClass = activeView === 'health'
    ? 'w-[min(94vw,56rem)] sm:w-[min(92vw,64rem)]'
    : 'w-80 sm:w-96';
  const hasMountedPanels = useMemo(
    () => PANEL_VIEWS.some(view => mountedPanels[view]),
    [mountedPanels]
  );

  const markPanelMounted = useCallback((view) => {
    if (!PANEL_VIEWS.includes(view)) return;
    setMountedPanels(prev => prev[view] ? prev : { ...prev, [view]: true });
  }, []);

  const openPanelView = useCallback((view) => {
    markPanelMounted(view);
    setActiveView(view);
    setIsPanelOpen(true);
  }, [markPanelMounted]);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  const closeTableView = useCallback(() => {
    setActiveView('live');
    setIsPanelOpen(false);
  }, []);

  const handleToolbarClick = useCallback((view) => {
    if (view === 'datatable') {
      if (activeView === 'datatable') {
        closeTableView();
      } else {
        setDetailReturnView('datatable');
        setActiveView('datatable');
        setIsPanelOpen(false);
      }
      return;
    }

    markPanelMounted(view);
    if (activeView === view) {
      setIsPanelOpen(prev => !prev);
    } else {
      setActiveView(view);
      setIsPanelOpen(true);
    }
  }, [activeView, closeTableView, markPanelMounted]);

  const handleNotificationClick = useCallback((notification) => {
    const recordId = notification.record_id;

    if (recordId) {
      markPanelMounted('detections');
      setSelectedRecordId(recordId);
      setDetailReturnView('detections');
      setActiveView('detail_view');
      setIsPanelOpen(false);

      if (notification.location?.latitude) {
        flyToDetection(notification);
      }
    } else {
      handleSelectDetection(notification.crop_id);
      if (notification.location?.latitude) {
        flyToDetection(notification);
      }
      const fullDetection = detections.find(d => d.crop_id === notification.crop_id);
      handleViewContext(fullDetection || { ...notification, captured_time: notification.timestamp });
    }
  }, [detections, handleSelectDetection, flyToDetection, handleViewContext, markPanelMounted]);

  const handleAcknowledgeAlarm = useCallback((alarm) => {
    setActiveAlarms(prev => prev.filter(a => a.id !== alarm.id));
    handleSelectDetection(alarm.detection.crop_id);
    flyToDetection(alarm.detection);
    handleViewContext(alarm.detection);
  }, [handleSelectDetection, flyToDetection, handleViewContext]);

  const handleSelectDevice = useCallback((device) => {
    if (!device) return;

    const deviceId = typeof device === 'string'
      ? device.trim()
      : (device.id || device.device_id || '').trim();
    if (!deviceId) return;

    const selectedDevice = typeof device === 'string'
      ? devices.find(item => item.id === deviceId)
      : device;

    if (selectedDevice) {
      flyToDevice(selectedDevice);
    }
    setSelectedDeviceId(deviceId);
  }, [devices, flyToDevice, setSelectedDeviceId]);

  const handleOpenDetail = useCallback((recordId, returnView = 'detections') => {
    if (returnView !== 'datatable') {
      markPanelMounted(returnView);
    }
    setSelectedRecordId(recordId);
    setDetailReturnView(returnView);
    setActiveView('detail_view');
    setIsPanelOpen(false);
  }, [markPanelMounted]);

  const handleCloseDetailView = useCallback(() => {
    if (detailReturnView === 'datatable') {
      setActiveView('datatable');
      setIsPanelOpen(false);
      return;
    }

    openPanelView(detailReturnView);
  }, [detailReturnView, openPanelView]);

  const handleViewOnMap = useCallback((detection) => {
    setActiveView('live');
    if (detection?.location) {
      flyToDetection(detection);
      setSelectedDetectionId(detection.crop_id);
    }
  }, [flyToDetection, setSelectedDetectionId]);

  const handleMapCropSelect = useCallback((crop) => {
    setSelectedDetectionId(crop?.crop_id || null);
  }, [setSelectedDetectionId]);

  const handleHistoryFlyTo = useCallback((detection) => {
    if (!detection?.location) return;
    flyToDetection(detection);
    setSelectedDetectionId(detection.crop_id);
  }, [flyToDetection, setSelectedDetectionId]);

  if (!token) {
    return <Login setToken={setToken} setUserRole={setUserRole} setCurrentUser={setCurrentUser} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-main)] font-sans overflow-hidden selection:bg-[var(--selection-bg)] selection:text-[var(--selection-text)]">

      { }
      <DetectionNotification
        notifications={notifications}
        onDismiss={handleDismissNotification}
        onClick={handleNotificationClick}
      />

      { }
        <header className="h-14 sm:h-16 bg-[var(--bg-header)] border-b border-[var(--border-color)] flex items-center justify-between px-2 sm:px-4 z-50 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink">
            <img src="/assets/stopfires.png?v=2" alt="StopFires" className="w-24 sm:w-32 md:w-36 h-auto object-contain" />
          </div>
          <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs font-mono flex-shrink-0 ml-2">
            {isAdmin && devices.length > 0 && (
              <div className="hidden sm:flex items-center gap-3 text-[10px]">
                {[
                  { key: 'online', label: t('app.services.mqtt') },
                  { key: 'tailscale_ok', label: t('app.services.tailscale') },
                  { key: 'ssh_ready', label: t('app.services.ssh') },
                  { key: 'reverse_tunnel_ok', label: t('app.services.bastion') },
                ].map(({ key, label }) => {
                  const allOk = devices.every(d => d[key] === true);
                  const anyOk = devices.some(d => d[key] === true);
                  const color = allOk ? 'bg-emerald-400' : anyOk ? 'bg-amber-400' : 'bg-red-400';
                  const textColor = allOk ? 'text-emerald-400' : anyOk ? 'text-amber-400' : 'text-red-400';
                  return (
                    <span key={key} className={`flex items-center gap-1 ${textColor}`} title={`${label}: ${allOk ? t('common.allOk') : anyOk ? t('common.partial') : t('common.unavailable')}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                      <span>{label}</span>
                    </span>
                  );
                })}
                <span className="text-[var(--text-muted)]">|</span>
              </div>
            )}
            {(() => {
              const selDev = devices.find(d => d.id === selectedDeviceId);
              const isOnline = selDev ? selDev.online : devices.length > 0 && devices.some(d => d.online);
              return (
                <span className={`flex items-center gap-1 sm:gap-2 ${isOnline ? 'text-green-500' : 'text-red-500'}`}>
                  <span className={`w-1.5 sm:w-2 h-1.5 sm:h-2 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'} rounded-full`}></span>
                  <span className="hidden sm:inline">{isOnline ? t('common.online') : t('common.offline')}</span>
                </span>
              );
            })()}
            <LanguageThemeControls />
            <span className="text-[var(--text-muted)]">|</span>
            <HeaderClock />
          </div>
        </header>

      <div className="flex-1 flex relative overflow-hidden">

        { }
          <aside className="w-16 bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] flex flex-col items-center py-4 gap-4 z-40 flex-shrink-0 overflow-hidden">
            <div className="flex flex-col items-center gap-4 w-full flex-1">
              {isAdmin && <NavButton icon="M3 5h18M3 12h18M3 19h18M8 5v14M16 5v14" title={t('app.health')} isActive={activeView === 'health' && isPanelOpen} activeColor="text-cyan-400" onClick={() => handleToolbarClick('health')} />}
              <NavButton icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" title={t('app.detections')} isActive={activeView === 'detections' && isPanelOpen} onClick={() => handleToolbarClick('detections')} />
              <NavButton icon="M4 6h16M4 12h16M4 18h16M8 6v12M16 6v12" title={t('app.table')} isActive={activeView === 'datatable'} activeColor="text-cyan-400" onClick={() => handleToolbarClick('datatable')} />
              {/* Detection History button hidden */}
              <div className="flex-1" />
              <div className="px-1 text-center max-w-[56px]">
                <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)]">{t('common.user')}</div>
                <div className="text-[10px] font-semibold text-[var(--text-main)] truncate" title={currentUser?.username || ''}>
                  {currentUser?.username || '---'}
                </div>
              </div>
              <button onClick={handleLogout} className="p-3 text-gray-500 hover:text-red-500 transition-colors rounded-xl hover:bg-gray-900" title={t('common.logout')}>
                <Icon path="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" className="w-6 h-6" />
              </button>
            </div>
          </aside>

        {hasMountedPanels && (
          <div className={`${isPanelOpen ? `${panelWidthClass} border-r border-[var(--border-color)]` : 'w-0 border-r-0'} bg-[var(--bg-panel)] z-30 shadow-2xl h-full flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out`}>
            {mountedPanels.health && (
              <div className={activeView === 'health' ? 'h-full' : 'hidden h-full'}>
                <PanelContainer title={t('app.health')} onClose={closePanel}>
                  <Suspense fallback={<PanelLoader label={t('app.loadingHealth')} />}>
                    <LazyDeviceHealthPanel
                      devices={devices}
                      selectedDeviceId={selectedDeviceId}
                      onSelectDevice={handleSelectDevice}
                      isActive={activeView === 'health' && isPanelOpen}
                      onFocusDevice={handleSelectDevice}
                    />
                  </Suspense>
                </PanelContainer>
              </div>
            )}

            {mountedPanels.detections && (
              <div className={activeView === 'detections' ? 'h-full' : 'hidden h-full'}>
                <PanelContainer title={t('app.detections')} onClose={closePanel}>
                  <DetectionList
                    detections={detections}
                    onSelectDetection={handleSelectDetection}
                    onViewContext={handleViewContext}
                    onOpenDetail={(recordId) => handleOpenDetail(recordId, 'detections')}
                    onUpdate={handleUpdateDetection}
                    isAdmin={isAdmin}
                    isActive={activeView === 'detections' && isPanelOpen}
                  />
                </PanelContainer>
              </div>
            )}
          </div>
        )}

        { }
        {isSettingsOpen && (
          <div className="w-80 sm:w-96 bg-[var(--bg-panel)] border-r border-[var(--border-color)] flex flex-col z-30 shadow-2xl animate-in slide-in-from-left-4 duration-200 h-full min-h-0 flex-shrink-0">
            <Suspense fallback={<PanelLoader label={t('app.loadingSettings')} />}>
              <LazyLocationSettings
                locations={mapLocations}
                onUpdate={updateLocations}
                onResetDefaults={resetToDefaults}
                isLoading={locationsLoading}
                error={locationsError}
                onClose={() => setIsSettingsOpen(false)}
              />
            </Suspense>
          </div>
        )}

        { }
        <main className="flex-1 relative bg-[var(--bg-app)] transition-all duration-200 ease-out">
          <AlarmPanel alarms={activeAlarms} onAcknowledge={handleAcknowledgeAlarm} />

          {activeView === 'detail_view' && selectedRecordId && (
            <Suspense fallback={<OverlayLoader label={t('app.loadingDetectionDetail')} />}>
              <LazyDetectionDetailView recordId={selectedRecordId} detections={detections} onClose={handleCloseDetailView} onViewOnMap={handleViewOnMap} isAdmin={isAdmin} />
            </Suspense>
          )}

          {activeView === 'datatable' && (
            <div className="absolute inset-0 z-30 flex flex-col bg-[var(--bg-app)]">
              <div className="h-14 border-b border-[var(--border-color)] bg-[var(--bg-header)] flex items-center justify-between px-4 sm:px-6 flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={closeTableView}
                    className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-900 transition-colors"
                    title={t('app.backToLiveMap')}
                  >
                    <Icon path="M15 19l-7-7 7-7" className="w-4 h-4" />
                  </button>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-main)] truncate">{t('app.tableFormat')}</h2>
                </div>

                <button
                  onClick={closeTableView}
                  className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-900 transition-colors"
                  title={t('app.closeTableView')}
                >
                  <Icon path="M6 18L18 6M6 6l12 12" className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0">
                <DataTable
                  detections={detections}
                  onOpenDetail={(recordId) => handleOpenDetail(recordId, 'datatable')}
                  onViewOnMap={handleViewOnMap}
                  isAdmin={isAdmin}
                  isActive={activeView === 'datatable'}
                />
              </div>
            </div>
          )}

          { }
          <div className="absolute inset-0 z-0">
            <Suspense fallback={<MapLoader label={t('app.loadingMap')} />}>
              <LazyMapView
                mapStyle={mapStyle}
                crops={detections}
                devices={devices}
                hqLocation={mapLocations?.home}
                selectedDetectionId={selectedDetectionId}
                flyToLocation={flyToLocation}
                onCropSelect={handleMapCropSelect}
                isAdmin={isAdmin}
                showHeatmap={showHeatmap}
              />
            </Suspense>
            
          </div>

          {showHistory && (
            <Suspense fallback={<FloatingPanelLoader label={t('app.loadingHistory')} />}>
              <LazyDetectionHistory
                detections={detections}
                onClose={toggleHistory}
                onViewContext={handleViewContext}
                onFlyToDetection={handleHistoryFlyTo}
              />
            </Suspense>
          )}

          <MapControls
            isMapToolsOpen={isMapToolsOpen}
            isStyleMenuOpen={isStyleMenuOpen}
            mapStyle={mapStyle}
            MAP_STYLES={MAP_STYLES}
            toggleMapTools={toggleMapTools}
            toggleStyleMenu={toggleStyleMenu}
            handleMapStyleChange={handleMapStyleChange}
            flyToHome={flyToHome}
            flyToResponsibleArea={flyToResponsibleArea}
            isSettingsOpen={isSettingsOpen}
            onToggleSettings={() => setIsSettingsOpen(prev => !prev)}
            isAdmin={isAdmin}
            t={t}
          />

        </main>
      </div>

      { }
      {selectedContextCrop && (
        <ContextModal crop={selectedContextCrop} fullFrameData={fullFrameData} onClose={closeContextModal} t={t} locale={locale} />
      )}
    </div>
  );
}

function NavButton({ icon, title, isActive, activeColor = 'text-white', onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl transition-all duration-200 group relative ${isActive ? `bg-gray-800 ${activeColor} shadow-lg` : 'text-gray-500 hover:text-white hover:bg-gray-900'}`}
      title={title}
    >
      <Icon path={icon} className="w-6 h-6" />
      {badge}
      <span className="absolute left-14 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 border border-gray-700">{title}</span>
    </button>
  );
}

function PanelContainer({ title, titleColor = 'text-white', badge, onClose, children }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="h-12 border-b border-[var(--border-color)] flex items-center justify-between px-4 bg-[var(--bg-panel-header)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="hover:bg-gray-800 p-1 rounded text-gray-400 hover:text-white">
            <Icon path="M15 19l-7-7 7-7" className="w-4 h-4" />
          </button>
          <h2 className={`text-sm font-bold uppercase tracking-wider ${titleColor} text-[var(--text-main)]`}>{title}</h2>
          {badge && <span className="bg-green-900 text-green-400 text-[10px] px-1 rounded border border-green-700">{badge}</span>}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <Icon path="M6 18L18 6M6 6l12 12" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function getLocalizedMapStyleName(style, t) {
  const keyMap = {
    dark: 'mapStyles.dark',
    satellite: 'mapStyles.satellite',
    streets: 'mapStyles.streets',
    light: 'mapStyles.light',
    outdoors: 'mapStyles.outdoors',
    'nav-night': 'mapStyles.navNight',
  };
  const key = keyMap[style.id];
  return key ? t(key) : style.name;
}

function MapControls({ isMapToolsOpen, isStyleMenuOpen, mapStyle, MAP_STYLES, toggleMapTools, toggleStyleMenu, handleMapStyleChange, flyToHome, flyToResponsibleArea, isSettingsOpen, onToggleSettings, isAdmin, t }) {
  return (
    <>
      <div className="absolute top-4 z-[15] transition-all duration-300 left-14 sm:left-16">
        <button onClick={toggleMapTools} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border rounded flex items-center justify-center transition-all ${isMapToolsOpen ? 'border-cyan-500 text-cyan-400' : 'border-gray-700 text-gray-400 hover:text-white'}`} title={t('app.mapTools')}>
          <Icon path={isMapToolsOpen ? "M6 18L18 6M6 6l12 12" : "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"} />
        </button>
        {isMapToolsOpen && (
          <div className="mt-2 flex flex-col gap-1.5 sm:gap-2 animate-fadeIn">
            <div className="relative">
              <button onClick={toggleStyleMenu} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border border-gray-700 rounded flex items-center justify-center ${isStyleMenuOpen ? 'text-white border-gray-500 bg-gray-800' : 'text-gray-400 hover:text-white'}`} title={t('app.mapStyle')}>
                <Icon path="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </button>
              {isStyleMenuOpen && (
                <div className="absolute left-12 top-0 w-48 bg-[#111]/95 backdrop-blur border border-gray-700 rounded shadow-xl overflow-hidden z-50">
                  <div className="p-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-800">{t('app.mapLayers')}</div>
                  {MAP_STYLES.map((style) => (
                    <button key={style.id} onClick={() => handleMapStyleChange(style.url)} className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-800 ${mapStyle === style.url ? 'text-fuchsia-500 font-medium' : 'text-gray-300'}`}>
                      {getLocalizedMapStyleName(style, t)}
                      {mapStyle === style.url && <Icon path="M5 13l4 4L19 7" className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isAdmin && (
              <button onClick={onToggleSettings} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border rounded flex items-center justify-center transition-all ${isSettingsOpen ? 'border-cyan-500 text-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.4)]' : 'border-gray-700 text-gray-400 hover:text-white'}`} title={t('app.locationSettings')}>
                <Icon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              </button>
            )}
            <button onClick={flyToHome} className="w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border border-gray-700 rounded flex items-center justify-center text-gray-400 hover:text-cyan-400 hover:border-cyan-500 transition-all" title={t('app.homeLocation')}>
              <Icon path="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </button>
            {isAdmin && (
              <button onClick={flyToResponsibleArea} className="w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border border-gray-700 rounded flex items-center justify-center text-gray-400 hover:text-amber-400 hover:border-amber-500 transition-all" title={t('app.responsibleArea')}>
                <Icon path="M4 6h16M4 12h16M4 18h16" />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ContextModal({ crop, fullFrameData, onClose, t, locale }) {
  const localizedClass = localizeDetectionClassName(crop.class, t);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90 p-8" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-gray-700 rounded-lg max-w-full md:max-w-6xl w-full max-h-full flex flex-col overflow-hidden mx-2 md:mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <div>
            <h2 className="text-xl font-bold text-white">{t('app.detectionContext')}</h2>
            <p className="text-sm text-gray-400">
              {localizedClass} ({(crop.accuracy || 0).toFixed(2)}%) - {crop.captured_time || crop.detection_time ? new Date(crop.captured_time || crop.detection_time).toLocaleString(locale) : t('app.unknownTime')}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>
        <div className="flex-1 bg-black relative flex items-center justify-center overflow-auto p-2 md:p-4">
          {fullFrameData ? (
            <div className="relative inline-block">
              <img src={`/api/image/fullframe/${fullFrameData.record_id}`} alt={t('app.detectionContext')} className="max-h-[80vh] object-contain" />
              {fullFrameData.dimensions && crop.bbox && (() => {
                const { width, height } = fullFrameData.dimensions;
                const { x1, y1, x2, y2 } = crop.bbox;
                return (
                  <div className="absolute border-2 border-red-500 bg-red-500 bg-opacity-20" style={{ left: `${(x1 / width) * 100}%`, top: `${(y1 / height) * 100}%`, width: `${((x2 - x1) / width) * 100}%`, height: `${((y2 - y1) / height) * 100}%` }}>
                    <span className="bg-red-600 text-white text-xs px-1 font-bold">{localizedClass} {(crop.accuracy || 0).toFixed(2)}%</span>
                  </div>
                );
              })()}
            </div>
          ) : crop.image_path ? (
            <div className="relative inline-block">
              <img src={crop.image_path.startsWith('http') ? crop.image_path : `/api${crop.image_path}`} alt={t('notifications.cropAlt')} className="max-h-[80vh] object-contain rounded-lg" />
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 px-2 py-1 rounded text-sm text-white">{localizedClass} - {Math.round((crop.accuracy || 0) * 100)}%</div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
              <p className="text-gray-400">{t('app.loadingImage')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
