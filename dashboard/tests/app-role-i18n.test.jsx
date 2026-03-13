import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import Login from '../src/components/Login';
import { PreferencesProvider } from '../src/context/PreferencesContext';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useDetections: vi.fn(),
  useDevices: vi.fn(),
  useMapUI: vi.fn(),
  useMapLocations: vi.fn(),
  useAnalysis: vi.fn(),
  login: vi.fn(),
  setApiToken: vi.fn(),
}));

vi.mock('../src/hooks/useAuth', () => ({
  default: () => mocks.useAuth(),
}));

vi.mock('../src/hooks/useDetections', () => ({
  default: () => mocks.useDetections(),
}));

vi.mock('../src/hooks/useDevices', () => ({
  default: () => mocks.useDevices(),
}));

vi.mock('../src/hooks/useMapUI', () => ({
  default: () => mocks.useMapUI(),
}));

vi.mock('../src/hooks/useMapLocations', () => ({
  default: () => mocks.useMapLocations(),
}));

vi.mock('../src/hooks/useAnalysis', () => ({
  default: () => mocks.useAnalysis(),
}));

vi.mock('../src/services/api', () => ({
  login: mocks.login,
  setToken: mocks.setApiToken,
}));

vi.mock('../src/components/DetectionList', () => ({ default: () => <div>DetectionList</div> }));
vi.mock('../src/components/DataTable', () => ({ default: () => <div>DataTable</div> }));
vi.mock('../src/components/HeaderClock', () => ({ default: () => <div>Clock</div> }));
vi.mock('../src/components/AlarmPanel', () => ({ default: () => null }));
vi.mock('../src/components/DetectionNotification', () => ({ default: () => null }));
vi.mock('../src/components/DeviceHealthPanel', () => ({ default: () => <div>DeviceHealthPanel</div> }));
vi.mock('../src/components/MapView', () => ({ default: () => <div>MapView</div> }));
vi.mock('../src/components/DetectionDetailView', () => ({ default: () => <div>DetectionDetail</div> }));
vi.mock('../src/components/settings/LocationSettings', () => ({ default: () => <div>LocationSettings</div> }));
vi.mock('../src/components/DetectionHistory', () => ({ default: () => <div>DetectionHistory</div> }));

function renderWithPreferences(ui) {
  return render(<PreferencesProvider>{ui}</PreferencesProvider>);
}

function setupBaseMocks({ isAdmin = false, username = 'operator01' } = {}) {
  mocks.useAuth.mockReturnValue({
    token: 'token-1',
    setToken: vi.fn(),
    currentUser: { username, role: isAdmin ? 'admin' : 'viewer' },
    setCurrentUser: vi.fn(),
    setUserRole: vi.fn(),
    isUserAdmin: isAdmin,
    handleLogout: vi.fn(),
    handleUnauthorized: vi.fn(),
  });

  mocks.useDetections.mockReturnValue({
    detections: [],
    notifications: [],
    selectedContextCrop: null,
    fullFrameData: null,
    selectedDetectionId: null,
    handleSelectDetection: vi.fn(),
    handleViewContext: vi.fn(),
    closeContextModal: vi.fn(),
    handleDismissNotification: vi.fn(),
    handleUpdateDetection: vi.fn(),
    setSelectedDetectionId: vi.fn(),
  });

  mocks.useDevices.mockReturnValue({
    devices: [
      {
        id: 'TOWER-1',
        online: true,
        mqtt_ok: true,
        tailscale_ok: true,
        ssh_ready: true,
        reverse_tunnel_ok: true,
      },
    ],
    selectedDeviceId: 'TOWER-1',
    setSelectedDeviceId: vi.fn(),
  });

  mocks.useMapLocations.mockReturnValue({
    locations: {},
    isLoading: false,
    error: null,
    updateLocations: vi.fn(),
    resetToDefaults: vi.fn(),
  });

  mocks.useMapUI.mockReturnValue({
    mapStyle: 'mapbox://styles/mapbox/dark-v11',
    isStyleMenuOpen: false,
    isMapToolsOpen: true,
    flyToLocation: null,
    MAP_STYLES: [
      { id: 'dark', name: 'Dark', url: 'mapbox://styles/mapbox/dark-v11' },
      { id: 'light', name: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
    ],
    handleMapStyleChange: vi.fn(),
    toggleStyleMenu: vi.fn(),
    toggleMapTools: vi.fn(),
    flyToDevice: vi.fn(),
    flyToDetection: vi.fn(),
    flyToHome: vi.fn(),
    flyToResponsibleArea: vi.fn(),
  });

  mocks.useAnalysis.mockReturnValue({
    showHeatmap: false,
    showHistory: false,
    toggleHeatmap: vi.fn(),
    toggleHistory: vi.fn(),
  });
}

describe('App role-based and i18n behavior', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows current username above logout button', () => {
    setupBaseMocks({ isAdmin: false, username: 'alice' });
    renderWithPreferences(<App />);
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('keeps notifications toolbar hidden for non-admin and admin', () => {
    setupBaseMocks({ isAdmin: false });
    const { rerender } = renderWithPreferences(<App />);
    expect(screen.queryByTitle(/NOTIFICATIONS/i)).not.toBeInTheDocument();

    setupBaseMocks({ isAdmin: true });
    rerender(
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    );
    expect(screen.queryByTitle(/NOTIFICATIONS/i)).not.toBeInTheDocument();
  });

  it('shows only ONLINE/OFFLINE summary for non-admin', () => {
    setupBaseMocks({ isAdmin: false });
    renderWithPreferences(<App />);
    expect(screen.getByText('ONLINE')).toBeInTheDocument();
    expect(screen.queryByText('MQTT')).not.toBeInTheDocument();
    expect(screen.queryByText('Tailscale')).not.toBeInTheDocument();
    expect(screen.queryByText('SSH')).not.toBeInTheDocument();
    expect(screen.queryByText('Bastion')).not.toBeInTheDocument();
  });

  it('keeps full health chips for admin', () => {
    setupBaseMocks({ isAdmin: true });
    renderWithPreferences(<App />);
    expect(screen.getByText('MQTT')).toBeInTheDocument();
    expect(screen.getByText('Tailscale')).toBeInTheDocument();
    expect(screen.getByText('SSH')).toBeInTheDocument();
    expect(screen.getByText('Bastion')).toBeInTheDocument();
  });

  it('hides responsible area button for non-admin and shows for admin', () => {
    setupBaseMocks({ isAdmin: false });
    const { rerender } = renderWithPreferences(<App />);
    expect(screen.queryByTitle('Responsible Area (UAE)')).not.toBeInTheDocument();

    setupBaseMocks({ isAdmin: true });
    rerender(
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    );
    expect(screen.getByTitle('Responsible Area (UAE)')).toBeInTheDocument();
  });

  it('updates app labels when language changes', () => {
    setupBaseMocks({ isAdmin: false });
    renderWithPreferences(<App />);
    expect(screen.getByTitle('Table')).toBeInTheDocument();
    fireEvent.change(screen.getByTitle('Language'), { target: { value: 'tr' } });
    expect(screen.getByTitle('Tablo')).toBeInTheDocument();
  });
});

describe('Login i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.login.mockResolvedValue({ message: 'error' });
  });

  it('updates login labels when language changes', () => {
    renderWithPreferences(
      <Login setToken={vi.fn()} setUserRole={vi.fn()} setCurrentUser={vi.fn()} />
    );
    expect(screen.getByText('Authenticate')).toBeInTheDocument();
    fireEvent.change(screen.getByTitle('Language'), { target: { value: 'tr' } });
    expect(screen.getByText('Giris Yap')).toBeInTheDocument();
  });
});
