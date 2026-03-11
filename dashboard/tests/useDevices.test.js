import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDeviceOnline, isHeartbeatOnline } from '../src/hooks/useDevices';

describe('device online derivation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T08:20:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the device online when heartbeat is recent even if current_status is offline', () => {
    const device = {
      current_status: 'offline',
      last_heartbeat_at: '2026-03-11T08:19:42Z',
      heartbeat_settings: {
        offline_threshold_s: 90
      }
    };

    expect(isHeartbeatOnline(device)).toBe(true);
    expect(deriveDeviceOnline(device)).toBe(true);
  });

  it('marks the device offline when the heartbeat is older than the configured threshold', () => {
    const device = {
      current_status: 'offline',
      last_heartbeat_at: '2026-03-11T08:17:00Z',
      heartbeat_settings: {
        offline_threshold_s: 90
      }
    };

    expect(isHeartbeatOnline(device)).toBe(false);
    expect(deriveDeviceOnline(device)).toBe(false);
  });

  it('keeps explicit online status online even without heartbeat data', () => {
    expect(deriveDeviceOnline({ current_status: 'online' })).toBe(true);
  });
});
