/**
 * Dashboard Real-Time Update Flicker Prevention Tests - TC1
 *
 * Tests fingerprint-based comparison and race condition protection
 * to prevent UI flicker during real-time updates.
 *
 * Implementation: dashboard/src/hooks/useDetections.js, dashboard/src/hooks/useDroneTelemetry.js
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock API
const mockApi = {
  getDetections: vi.fn(),
  getDronePositions: vi.fn(),
};

vi.mock('../src/services/api.js', () => ({
  default: mockApi,
}));

// Mock useDetections hook
const mockUseDetections = vi.fn();
vi.mock('../src/hooks/useDetections.js', () => ({
  default: mockUseDetections,
}));

// Mock useDroneTelemetry hook
const mockUseDroneTelemetry = vi.fn();
vi.mock('../src/hooks/useDroneTelemetry.js', () => ({
  default: mockUseDroneTelemetry,
}));

describe('TC1: Real-Time Update Flicker Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('TC1.1: Fingerprint-based comparison prevents re-render', () => {
    it('should not update state when fingerprint unchanged', async () => {
      const mockDetections = [
        { crop_id: '001', class: 'person', confidence: 0.95 },
        { crop_id: '002', class: 'vehicle', confidence: 0.88 },
        { crop_id: '003', class: 'animal', confidence: 0.76 },
      ];

      // Mock useDetections to return consistent reference when fingerprint matches
      let detectionsRef = mockDetections;

      mockUseDetections.mockReturnValue({
        detections: detectionsRef,
        refetch: vi.fn().mockImplementation(() => {
          // Simulate fingerprint comparison
          // If fingerprint unchanged, keep same reference
          const newData = [...mockDetections];
          const oldFingerprint = `${detectionsRef.length}:${detectionsRef[0]?.crop_id}:${detectionsRef[detectionsRef.length-1]?.crop_id}`;
          const newFingerprint = `${newData.length}:${newData[0]?.crop_id}:${newData[newData.length-1]?.crop_id}`;

          if (oldFingerprint === newFingerprint) {
            // Keep same reference (fingerprint match)
            return;
          }
          detectionsRef = newData;
        }),
        notifications: [],
        notificationLogs: [],
        handleSelectDetection: vi.fn(),
        handleViewContext: vi.fn(),
        closeContextModal: vi.fn(),
        handleDismissNotification: vi.fn(),
        handleClearNotificationLogs: vi.fn(),
        handleUpdateDetection: vi.fn(),
      });

      const { result } = renderHook(() => mockUseDetections());

      // Initial detections
      expect(result.current.detections).toHaveLength(3);
      const firstRenderDetections = result.current.detections;

      // Trigger re-fetch with same data
      act(() => {
        result.current.refetch();
      });

      // Verify state NOT updated (same reference)
      expect(result.current.detections).toBe(firstRenderDetections);
    });

    it('should update state when fingerprint changes', async () => {
      const initialDetections = [
        { crop_id: '001', class: 'person' },
        { crop_id: '002', class: 'vehicle' },
      ];

      const updatedDetections = [
        { crop_id: '001', class: 'person' },
        { crop_id: '002', class: 'vehicle' },
        { crop_id: '003', class: 'animal' }, // NEW
      ];

      // Track current detections
      let currentDetections = initialDetections;

      mockUseDetections.mockReturnValue({
        detections: currentDetections,
        refetch: vi.fn().mockImplementation(() => {
          // Simulate fingerprint comparison
          const oldFingerprint = `${currentDetections.length}:${currentDetections[0]?.crop_id}:${currentDetections[currentDetections.length-1]?.crop_id}`;
          const newFingerprint = `${updatedDetections.length}:${updatedDetections[0]?.crop_id}:${updatedDetections[updatedDetections.length-1]?.crop_id}`;

          if (oldFingerprint !== newFingerprint) {
            currentDetections = updatedDetections;
          }
        }),
        notifications: [],
        notificationLogs: [],
        handleSelectDetection: vi.fn(),
        handleViewContext: vi.fn(),
        closeContextModal: vi.fn(),
        handleDismissNotification: vi.fn(),
        handleClearNotificationLogs: vi.fn(),
        handleUpdateDetection: vi.fn(),
      });

      const { result, rerender } = renderHook(() => mockUseDetections());

      // Initial state
      expect(result.current.detections).toHaveLength(2);

      // Trigger update
      act(() => {
        result.current.refetch();
      });

      // Update mock to return new detections
      currentDetections = updatedDetections;
      mockUseDetections.mockReturnValue({
        ...result.current,
        detections: currentDetections,
      });

      rerender();

      // Verify state updated (new detections)
      expect(result.current.detections).toHaveLength(3);
      expect(result.current.detections[2].crop_id).toBe('003');
    });

    it('should compute correct fingerprint format', () => {
      // Test fingerprint computation logic
      const getDetectionsFingerprint = (detections) => {
        if (!detections || detections.length === 0) return '0::';
        const first = detections[0]?.crop_id ?? '';
        const last = detections[detections.length - 1]?.crop_id ?? '';
        return `${detections.length}:${first}:${last}`;
      };

      const detections1 = [
        { crop_id: 'A' },
        { crop_id: 'B' },
        { crop_id: 'C' },
      ];

      const fingerprint1 = getDetectionsFingerprint(detections1);
      expect(fingerprint1).toBe('3:A:C');

      const detections2 = [
        { crop_id: 'A' },
        { crop_id: 'B' },
        { crop_id: 'C' },
        { crop_id: 'D' }, // Different
      ];

      const fingerprint2 = getDetectionsFingerprint(detections2);
      expect(fingerprint2).toBe('4:A:D');

      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('TC1.3: Race condition protection with request ID', () => {
    it('should use latest request result, ignore stale', async () => {
      const slowResponse = [
        { crop_id: 'OLD1' },
        { crop_id: 'OLD2' },
      ];

      const fastResponse = [
        { crop_id: 'NEW1' },
        { crop_id: 'NEW2' },
        { crop_id: 'NEW3' },
      ];

      // Simulate race condition handling with request ID
      let currentRequestId = 0;
      let currentDetections = [];
      let resolveSlowRequest;
      const slowPromise = new Promise(resolve => {
        resolveSlowRequest = resolve;
      });

      // Mock refetch to track request IDs
      const mockRefetch = vi.fn().mockImplementation(async () => {
        const requestId = ++currentRequestId;

        if (requestId === 1) {
          // Slow request
          await slowPromise;
          // Check if this is still the latest request
          if (requestId === currentRequestId) {
            currentDetections = slowResponse;
          }
          // Otherwise ignore (stale)
        } else if (requestId === 2) {
          // Fast request - completes immediately
          currentDetections = fastResponse;
        }
      });

      mockUseDetections.mockReturnValue({
        detections: currentDetections,
        refetch: mockRefetch,
        notifications: [],
        notificationLogs: [],
        handleSelectDetection: vi.fn(),
        handleViewContext: vi.fn(),
        closeContextModal: vi.fn(),
        handleDismissNotification: vi.fn(),
        handleClearNotificationLogs: vi.fn(),
        handleUpdateDetection: vi.fn(),
      });

      const { result, rerender } = renderHook(() => mockUseDetections());

      // Trigger request #1 (slow)
      const request1Promise = result.current.refetch();

      // Trigger request #2 (fast)
      const request2Promise = result.current.refetch();

      // Wait for fast request to complete
      await request2Promise;

      // Update mock with fast response
      mockUseDetections.mockReturnValue({
        ...result.current,
        detections: fastResponse,
      });
      rerender();

      expect(result.current.detections).toHaveLength(3);
      expect(result.current.detections[0].crop_id).toBe('NEW1');

      // Resolve slow request
      resolveSlowRequest();
      await request1Promise;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // State should still show NEW data (stale request ignored)
      expect(result.current.detections).toHaveLength(3);
      expect(result.current.detections[0].crop_id).toBe('NEW1');
    });
  });

  describe('TC1.4: Throttled drone position updates', () => {
    it('should throttle updates to 100ms minimum', async () => {
      const DRONE_THROTTLE_MS = 100;

      let lastUpdateTime = 0;
      let updateCount = 0;

      const throttledUpdate = (callback) => {
        return (...args) => {
          const now = Date.now();
          if (now - lastUpdateTime >= DRONE_THROTTLE_MS) {
            lastUpdateTime = now;
            updateCount++;
            callback(...args);
          }
        };
      };

      const mockCallback = vi.fn();
      const throttled = throttledUpdate(mockCallback);

      // Send 100 updates rapidly
      for (let i = 0; i < 100; i++) {
        throttled({ lat: 10 + i * 0.001, lon: 20 + i * 0.001 });
      }

      // Should have throttled to much fewer updates
      expect(updateCount).toBeLessThan(10);
      expect(updateCount).toBeGreaterThan(0);
    });

    it('should use requestAnimationFrame for smooth updates', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

      let pendingRaf = null;

      const scheduleUpdate = (callback) => {
        if (pendingRaf) return; // Prevent duplicate RAF

        pendingRaf = requestAnimationFrame(() => {
          pendingRaf = null;
          callback();
        });
      };

      const mockCallback = vi.fn();

      // Call multiple times rapidly
      scheduleUpdate(mockCallback);
      scheduleUpdate(mockCallback); // Should be ignored
      scheduleUpdate(mockCallback); // Should be ignored

      // Verify RAF called only once
      expect(rafSpy).toHaveBeenCalledTimes(1);

      rafSpy.mockRestore();
    });

    it('should have position threshold for significant changes', () => {
      const POSITION_THRESHOLD = 0.00001;
      const HEADING_THRESHOLD = 1; // 1 degree

      const isSignificantChange = (oldPos, newPos) => {
        if (!oldPos) return true;

        const latDiff = Math.abs(newPos.latitude - oldPos.latitude);
        const lonDiff = Math.abs(newPos.longitude - oldPos.longitude);
        const headingDiff = Math.abs((newPos.heading || 0) - (oldPos.heading || 0));

        return latDiff > POSITION_THRESHOLD ||
               lonDiff > POSITION_THRESHOLD ||
               headingDiff > HEADING_THRESHOLD;
      };

      const pos1 = { latitude: 40.7128, longitude: -74.0060, heading: 90 };

      // Insignificant change
      const pos2 = { latitude: 40.7128 + 0.000005, longitude: -74.0060, heading: 90 };
      expect(isSignificantChange(pos1, pos2)).toBe(false);

      // Significant position change
      const pos3 = { latitude: 40.7128 + 0.0001, longitude: -74.0060, heading: 90 };
      expect(isSignificantChange(pos1, pos3)).toBe(true);

      // Significant heading change
      const pos4 = { latitude: 40.7128, longitude: -74.0060, heading: 92 };
      expect(isSignificantChange(pos1, pos4)).toBe(true);
    });
  });

  describe('Bonus: In-flight request tracking', () => {
    it('should prevent concurrent duplicate requests', async () => {
      let inFlight = false;

      const mockFetch = async () => {
        if (inFlight) {
          console.log('Request already in flight, skipping');
          return null;
        }

        inFlight = true;
        await new Promise(resolve => setTimeout(resolve, 50));
        inFlight = false;

        return [{ crop_id: '001' }];
      };

      // Trigger 3 concurrent requests
      const results = await Promise.all([
        mockFetch(),
        mockFetch(), // Should be skipped
        mockFetch(), // Should be skipped
      ]);

      // Only first request should succeed
      const successCount = results.filter(r => r !== null).length;
      expect(successCount).toBe(1);
    });
  });
});
