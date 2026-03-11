import React, { Suspense, lazy, useState, useCallback, useMemo } from 'react'
import DetectionList from './components/DetectionList'
import DeviceStatus from './components/DeviceStatus'
import HeaderClock from './components/HeaderClock'
import AlarmPanel from './components/AlarmPanel'
import Login from './components/Login'
import DetectionNotification from './components/DetectionNotification'
import NotificationLog from './components/NotificationLog'
import useAuth from './hooks/useAuth'
import useDetections from './hooks/useDetections'
import useDevices from './hooks/useDevices'
import useMapUI from './hooks/useMapUI'
import useMapLocations from './hooks/useMapLocations'
import useAnalysis from './hooks/useAnalysis'

const Icon = React.memo(({ path, className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
  </svg>
));
Icon.displayName = 'Icon';

const PANEL_VIEWS = ['devices', 'health', 'detections', 'notificationlog'];
const LazyDeviceHealthPanel = lazy(() => import('./components/DeviceHealthPanel'));
const LazyMapView = lazy(() => import('./components/MapView'));
const LazyDataTable = lazy(() => import('./components/DataTable'));
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

function MapLoader() {
  return (
    <div className="absolute inset-0 bg-[#050608] flex items-center justify-center">
      <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-cyan-500/80 animate-pulse">
        Loading Map
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
    setUserRole,
    isUserAdmin,
    handleLogout,
    handleUnauthorized
  } = useAuth();

  const {
    detections,
    notifications,
    notificationLogs,
    selectedContextCrop,
    fullFrameData,
    selectedDetectionId,
    handleSelectDetection,
    handleViewContext,
    closeContextModal,
    handleDismissNotification,
    handleClearNotificationLogs,
    handleUpdateDetection,
    setSelectedDetectionId
  } = useDetections(token, handleUnauthorized);

  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId
  } = useDevices(token, handleUnauthorized);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
    isFullScreen,
    showHubs,
    showSolos,
    showDetections,
    flyToLocation,
    searchInputValue,
    mapFlags,
    MAP_STYLES,
    setSearchInputValue,
    handleSearch,
    handleMapStyleChange,
    toggleStyleMenu,
    toggleMapTools,
    toggleFullScreen,
    toggleHubs,
    toggleSolos,
    toggleDetections,
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isAdmin = isUserAdmin;
  const [mountedPanels, setMountedPanels] = useState({
    devices: false,
    health: false,
    detections: false,
    notificationlog: false,
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

  const handleToolbarClick = useCallback((view) => {
    markPanelMounted(view);
    if (activeView === view) {
      setIsPanelOpen(prev => !prev);
    } else {
      setActiveView(view);
      setIsPanelOpen(true);
    }
  }, [activeView, markPanelMounted]);

  const handleLogItemClick = useCallback((log) => {
    const fullDetection = detections.find(d => d.crop_id === log.crop_id);
    if (log.location?.latitude) {
      flyToDetection(log);
    }
    handleViewContext(fullDetection || { ...log, captured_time: log.timestamp });
  }, [detections, flyToDetection, handleViewContext]);

  const handleNotificationClick = useCallback((notification) => {
    const recordId = notification.record_id;

    if (recordId) {
      markPanelMounted('detections');
      setSelectedRecordId(recordId);
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
    flyToDevice(device);
    setSelectedDeviceId(device.id);
  }, [flyToDevice, setSelectedDeviceId]);

  const handleOpenDetail = useCallback((recordId) => {
    markPanelMounted('detections');
    setSelectedRecordId(recordId);
    setActiveView('detail_view');
    setIsPanelOpen(false);
  }, [markPanelMounted]);

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

  const handleToggleDevices = useCallback(() => {
    toggleHubs();
    toggleSolos();
  }, [toggleHubs, toggleSolos]);

  if (!token) {
    return <Login setToken={setToken} setUserRole={setUserRole} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-black text-gray-300 font-sans overflow-hidden selection:bg-fuchsia-500 selection:text-white">

      { }
      <DetectionNotification
        notifications={notifications}
        onDismiss={handleDismissNotification}
        onClick={handleNotificationClick}
      />

      { }
      {!isFullScreen && (
        <header className="h-10 bg-[#0a0a0a] border-b border-gray-800 flex items-center justify-between px-2 sm:px-4 z-50 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink">
            <img src="/assets/roboteye.png?v=2" alt="RobotEye" className="h-6 sm:h-8 w-auto max-w-[120px] sm:max-w-none object-contain" />
          </div>
          <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs font-mono text-green-500 flex-shrink-0 ml-2">
            <span className="flex items-center gap-1 sm:gap-2">
              <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="hidden sm:inline">ONLINE</span>
            </span>
            <span className="text-gray-500">|</span>
            <HeaderClock />
          </div>
        </header>
      )}

      <div className="flex-1 flex relative overflow-hidden">

        { }
        {!isFullScreen && (
          <aside className={`${isSidebarOpen ? 'w-16' : 'w-8'} bg-[#0a0a0a] border-r border-gray-800 flex flex-col items-center py-4 gap-4 z-40 flex-shrink-0 transition-all duration-300 overflow-hidden`}>
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
              className="mt-0 text-gray-500 hover:text-white transition-colors"
              title={isSidebarOpen ? "Menüyü Daralt" : "Menüyü Genişlet"}
            >
              <Icon path={isSidebarOpen ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} className="w-4 h-4" />
            </button>

            <div className={`flex flex-col items-center gap-4 w-full flex-1 transition-opacity duration-200 ${isSidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible h-0'}`}>
              <NavButton icon="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" title="Devices" isActive={activeView === 'devices' && isPanelOpen} onClick={() => handleToolbarClick('devices')} />
              <NavButton icon="M3 5h18M3 12h18M3 19h18M8 5v14M16 5v14" title="Health" isActive={activeView === 'health' && isPanelOpen} activeColor="text-cyan-400" onClick={() => handleToolbarClick('health')} />
              <NavButton icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" title="Detections" isActive={activeView === 'detections' && isPanelOpen} onClick={() => handleToolbarClick('detections')} />
              <NavButton icon="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" title="Table" isActive={activeView === 'datatable'} activeColor="text-emerald-500" onClick={() => { setActiveView('datatable'); setIsPanelOpen(false); }} />
              <NavButton icon="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" title="Settings" isActive={isSettingsOpen} activeColor="text-cyan-500" onClick={() => setIsSettingsOpen(!isSettingsOpen)} />
              <NavButton icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" title="Detection History" isActive={showHistory} activeColor="text-cyan-500" onClick={toggleHistory} />
              <NavButton icon="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" title="Detection Log" isActive={activeView === 'notificationlog' && isPanelOpen} activeColor="text-orange-500" onClick={() => handleToolbarClick('notificationlog')} badge={notificationLogs.length > 0 && <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{notificationLogs.length > 99 ? '99+' : notificationLogs.length}</span>} />

              <div className="flex-1" />
              <button onClick={handleLogout} className="p-3 text-gray-500 hover:text-red-500 transition-colors rounded-xl hover:bg-gray-900" title="Logout">
                <Icon path="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" className="w-6 h-6" />
              </button>
            </div>
          </aside>
        )}

        {!isFullScreen && hasMountedPanels && (
          <div className={`${isPanelOpen ? `${panelWidthClass} border-r border-gray-800` : 'w-0 border-r-0'} bg-[#0f0f0f] z-30 shadow-2xl h-full flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out`}>
            {mountedPanels.devices && (
              <div className={activeView === 'devices' ? 'h-full' : 'hidden h-full'}>
                <PanelContainer title="System Devices" onClose={closePanel}>
                  <DeviceStatus devices={devices} onSelectDevice={handleSelectDevice} isAdmin={isAdmin} />
                </PanelContainer>
              </div>
            )}

            {mountedPanels.health && (
              <div className={activeView === 'health' ? 'h-full' : 'hidden h-full'}>
                <PanelContainer title="Health" onClose={closePanel}>
                  <Suspense fallback={<PanelLoader label="Loading Health" />}>
                    <LazyDeviceHealthPanel
                      devices={devices}
                      selectedDeviceId={selectedDeviceId}
                      onSelectDevice={handleSelectDevice}
                      isActive={activeView === 'health' && isPanelOpen}
                    />
                  </Suspense>
                </PanelContainer>
              </div>
            )}

            {mountedPanels.detections && (
              <div className={activeView === 'detections' ? 'h-full' : 'hidden h-full'}>
                <PanelContainer title="Detections" onClose={closePanel}>
                  <DetectionList
                    detections={detections}
                    onSelectDetection={handleSelectDetection}
                    onViewContext={handleViewContext}
                    onOpenDetail={handleOpenDetail}
                    onUpdate={handleUpdateDetection}
                    isAdmin={isAdmin}
                    isActive={activeView === 'detections' && isPanelOpen}
                  />
                </PanelContainer>
              </div>
            )}

            {mountedPanels.notificationlog && (
              <div className={activeView === 'notificationlog' ? 'h-full' : 'hidden h-full'}>
                <PanelContainer title="Detection Log" onClose={closePanel}>
                  <NotificationLog logs={notificationLogs} onItemClick={handleLogItemClick} handleClearLogs={handleClearNotificationLogs} />
                </PanelContainer>
              </div>
            )}
          </div>
        )}

        { }
        {isSettingsOpen && !isFullScreen && (
          <div className="w-80 sm:w-96 bg-[#0f0f0f] border-r border-gray-800 flex flex-col z-30 shadow-2xl animate-in slide-in-from-left-4 duration-200 h-full min-h-0 flex-shrink-0">
            <Suspense fallback={<PanelLoader label="Loading Settings" />}>
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
        <main className="flex-1 relative bg-black transition-all duration-200 ease-out">
          <AlarmPanel alarms={activeAlarms} onAcknowledge={handleAcknowledgeAlarm} />

          <div className={`absolute inset-0 z-20 bg-[#09090b] flex flex-col transition-opacity duration-200 ${activeView === 'datatable' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none hidden'}`}>
              {activeView === 'datatable' && (
                <Suspense fallback={<OverlayLoader label="Loading Table" />}>
                  <LazyDataTable
                    detections={detections}
                    onOpenDetail={handleOpenDetail}
                    onViewOnMap={handleViewOnMap}
                    isAdmin={isAdmin}
                    isActive
                  />
                </Suspense>
              )}
              {activeView === 'datatable' && (
                <button onClick={() => setActiveView('live')} className="absolute top-4 right-4 text-gray-400 hover:text-white bg-black/50 p-2 rounded-full hover:bg-red-900/50 transition-colors z-50">
                  <Icon path="M6 18L18 6M6 6l12 12" className="w-6 h-6" />
                </button>
              )}
          </div>

          {activeView === 'detail_view' && selectedRecordId && (
            <Suspense fallback={<OverlayLoader label="Loading Detection Detail" />}>
              <LazyDetectionDetailView recordId={selectedRecordId} detections={detections} onClose={() => openPanelView('detections')} onViewOnMap={handleViewOnMap} isAdmin={isAdmin} />
            </Suspense>
          )}

          { }
          <div className="absolute inset-0 z-0">
            <Suspense fallback={<MapLoader />}>
              <LazyMapView
                mapStyle={mapStyle}
                crops={detections}
                devices={devices}
                hqLocation={mapLocations?.home}
                selectedDetectionId={selectedDetectionId}
                flyToLocation={flyToLocation}
                onCropSelect={handleMapCropSelect}
                isAdmin={isAdmin}
                showHubs={mapFlags.showHubs}
                showSolos={mapFlags.showSolos}
                showDetections={mapFlags.showDetections}
                showHeatmap={showHeatmap}
              />
            </Suspense>
            
          </div>

          {showHistory && (
            <Suspense fallback={<FloatingPanelLoader label="Loading History" />}>
              <LazyDetectionHistory
                detections={detections}
                onClose={toggleHistory}
                onViewContext={handleViewContext}
                onFlyToDetection={handleHistoryFlyTo}
              />
            </Suspense>
          )}

          <MapControls
            searchInputValue={searchInputValue}
            setSearchInputValue={setSearchInputValue}
            handleSearch={handleSearch}
            isFullScreen={isFullScreen}
            isMapToolsOpen={isMapToolsOpen}
            isStyleMenuOpen={isStyleMenuOpen}
            mapStyle={mapStyle}
            showDevices={showHubs && showSolos}
            showDetections={showDetections}
            MAP_STYLES={MAP_STYLES}
            toggleMapTools={toggleMapTools}
            toggleFullScreen={toggleFullScreen}
            toggleStyleMenu={toggleStyleMenu}
            handleMapStyleChange={handleMapStyleChange}
            toggleDevices={handleToggleDevices}
            toggleDetections={toggleDetections}
            flyToHome={flyToHome}
            flyToResponsibleArea={flyToResponsibleArea}
            hasSidePanel={(isPanelOpen || isSettingsOpen) && !isFullScreen}
            showHeatmap={showHeatmap}
            toggleHeatmap={toggleHeatmap}
          />

        </main>
      </div>

      { }
      {selectedContextCrop && (
        <ContextModal crop={selectedContextCrop} fullFrameData={fullFrameData} onClose={closeContextModal} />
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
      <div className="h-12 border-b border-gray-800 flex items-center justify-between px-4 bg-[#111] flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="hover:bg-gray-800 p-1 rounded text-gray-400 hover:text-white">
            <Icon path="M15 19l-7-7 7-7" className="w-4 h-4" />
          </button>
          <h2 className={`text-sm font-bold uppercase tracking-wider ${titleColor}`}>{title}</h2>
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

function MapControls({ searchInputValue, setSearchInputValue, handleSearch, isFullScreen, isMapToolsOpen, isStyleMenuOpen, mapStyle, showDevices, showDetections, MAP_STYLES, toggleMapTools, toggleFullScreen, toggleStyleMenu, handleMapStyleChange, toggleDevices, toggleDetections, flyToHome, flyToResponsibleArea, hasSidePanel, showHeatmap, toggleHeatmap }) {
  return (
    <>
      <div className={`absolute top-14 sm:top-4 z-[10] w-[calc(100%-5rem)] max-w-80 sm:w-80 transition-all duration-200 ${hasSidePanel ? 'left-[calc(50%+1rem)] -translate-x-1/2' : 'left-1/2 -translate-x-1/2 ml-6 sm:ml-0'}`}>
        <div className="bg-[#111]/90 backdrop-blur border border-gray-700 rounded flex items-center px-2 sm:px-3 py-2 w-full shadow-lg">
          <Icon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
          <input type="text" placeholder="e.g. 25.20, 55.27" className="bg-transparent border-none outline-none text-xs sm:text-sm text-white w-full placeholder-gray-600 font-mono" value={searchInputValue} onChange={(e) => setSearchInputValue(e.target.value)} onKeyDown={handleSearch} />
        </div>
      </div>
      <div className={`absolute top-24 sm:top-4 z-[15] transition-all duration-300 ${isFullScreen ? 'left-4' : 'left-14 sm:left-16'}`}>
        <button onClick={toggleMapTools} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border rounded flex items-center justify-center transition-all ${isMapToolsOpen ? 'border-cyan-500 text-cyan-400' : 'border-gray-700 text-gray-400 hover:text-white'}`} title="Map Tools">
          <Icon path={isMapToolsOpen ? "M6 18L18 6M6 6l12 12" : "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"} />
        </button>
        {isMapToolsOpen && (
          <div className="mt-2 flex flex-col gap-1.5 sm:gap-2 animate-fadeIn">
            <button onClick={toggleFullScreen} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border border-gray-700 rounded flex items-center justify-center ${isFullScreen ? 'text-fuchsia-500 border-fuchsia-500' : 'text-gray-400 hover:text-white'}`} title="Full Screen">
              <Icon path={isFullScreen ? "M4 14h6v6M20 10h-6V4M14 4h6v6M10 20H4v-6" : "M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v-4h-4"} />
            </button>
            <div className="relative">
              <button onClick={toggleStyleMenu} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border border-gray-700 rounded flex items-center justify-center ${isStyleMenuOpen ? 'text-white border-gray-500 bg-gray-800' : 'text-gray-400 hover:text-white'}`} title="Map Style">
                <Icon path="M4 6h16M4 12h16M4 18h16" />
              </button>
              {isStyleMenuOpen && (
                <div className="absolute left-12 top-0 w-48 bg-[#111]/95 backdrop-blur border border-gray-700 rounded shadow-xl overflow-hidden z-50">
                  <div className="p-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-800">Map Layers</div>
                  {MAP_STYLES.map((style) => (
                    <button key={style.id} onClick={() => handleMapStyleChange(style.url)} className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-800 ${mapStyle === style.url ? 'text-fuchsia-500 font-medium' : 'text-gray-300'}`}>
                      {style.name}
                      {mapStyle === style.url && <Icon path="M5 13l4 4L19 7" className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={toggleDevices} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border rounded flex items-center justify-center ${showDevices ? 'border-green-500 text-green-400 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'border-gray-700 text-gray-600'}`} title="Devices"><span className="text-[8px] sm:text-[9px] font-bold">DEV</span></button>
            <button onClick={toggleDetections} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border rounded flex items-center justify-center ${showDetections ? 'border-cyan-500 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'border-gray-700 text-gray-600'}`} title="Detections"><Icon path="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></button>
            <button onClick={flyToHome} className="w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border border-gray-700 rounded flex items-center justify-center text-gray-400 hover:text-cyan-400 hover:border-cyan-500 transition-all" title="Home Location">
              <Icon path="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </button>
            <button onClick={flyToResponsibleArea} className="w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border border-gray-700 rounded flex items-center justify-center text-gray-400 hover:text-amber-400 hover:border-amber-500 transition-all" title="Responsible Area (UAE)">
              <Icon path="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </button>
            <button onClick={toggleHeatmap} className={`w-9 h-9 sm:w-10 sm:h-10 bg-[#111]/90 border rounded flex items-center justify-center transition-all ${showHeatmap ? 'border-orange-500 text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.4)]' : 'border-gray-700 text-gray-600 hover:text-orange-400'}`} title="Density Heatmap">
              <Icon path="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function ContextModal({ crop, fullFrameData, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90 p-8" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-gray-700 rounded-lg max-w-full md:max-w-6xl w-full max-h-full flex flex-col overflow-hidden mx-2 md:mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <div>
            <h2 className="text-xl font-bold text-white">Detection Context</h2>
            <p className="text-sm text-gray-400">
              {crop.class} ({(crop.accuracy || 0).toFixed(2)}%) - {crop.captured_time || crop.detection_time ? new Date(crop.captured_time || crop.detection_time).toLocaleString() : 'Unknown Time'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">×</button>
        </div>
        <div className="flex-1 bg-black relative flex items-center justify-center overflow-auto p-2 md:p-4">
          {fullFrameData ? (
            <div className="relative inline-block">
              <img src={`/api/image/fullframe/${fullFrameData.record_id}`} alt="Full Context" className="max-h-[80vh] object-contain" />
              {fullFrameData.dimensions && crop.bbox && (() => {
                const { width, height } = fullFrameData.dimensions;
                const { x1, y1, x2, y2 } = crop.bbox;
                return (
                  <div className="absolute border-2 border-red-500 bg-red-500 bg-opacity-20" style={{ left: `${(x1 / width) * 100}%`, top: `${(y1 / height) * 100}%`, width: `${((x2 - x1) / width) * 100}%`, height: `${((y2 - y1) / height) * 100}%` }}>
                    <span className="bg-red-600 text-white text-xs px-1 font-bold">{crop.class} {(crop.accuracy || 0).toFixed(2)}%</span>
                  </div>
                );
              })()}
            </div>
          ) : crop.image_path ? (
            <div className="relative inline-block">
              <img src={crop.image_path.startsWith('http') ? crop.image_path : `/api${crop.image_path}`} alt="Detection Crop" className="max-h-[80vh] object-contain rounded-lg" />
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 px-2 py-1 rounded text-sm text-white">{crop.class} - {Math.round((crop.accuracy || 0) * 100)}%</div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
              <p className="text-gray-400">Loading image...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
