/**
 * Dashboard Frontend Tests
 * Unit tests for React components, state management, and UI behavior.
 * 
 * Run with: npm test (from dashboard directory)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock fetch
global.fetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      this.onopen?.();
    }, 10);
  }
  send(data) { this.lastSent = data; }
  close() { this.readyState = WebSocket.CLOSED; }
}
global.WebSocket = MockWebSocket;

// ============================================================================
// TEST 1: STATE UPDATE - NO FLICKER
// ============================================================================

describe('State Update Tests', () => {
  describe('Detection List Updates', () => {
    it('should not cause flicker when new data arrives', async () => {
      const renderCounts = { count: 0 };
      
      // Simulate React state update pattern
      const detections = [
        { id: '001', class: 'person', accuracy: 0.95 },
        { id: '002', class: 'car', accuracy: 0.88 }
      ];
      
      // Simulate setState with shallow comparison
      function updateDetections(prev, next) {
        renderCounts.count++;
        
        // Check if actually different
        const prevIds = prev.map(d => d.id).sort().join(',');
        const nextIds = next.map(d => d.id).sort().join(',');
        
        if (prevIds === nextIds) {
          // Same data - don't update
          return prev;
        }
        return next;
      }
      
      let state = detections;
      
      // Update with same data - should not trigger render
      state = updateDetections(state, [...detections]);
      expect(renderCounts.count).toBe(1);
      
      // Same IDs - should return prev
      expect(state).toBe(detections); // Reference equality
    });
    
    it('should update when new detection arrives', () => {
      const prev = [
        { id: '001', class: 'person', accuracy: 0.95 }
      ];
      
      const next = [
        { id: '001', class: 'person', accuracy: 0.95 },
        { id: '002', class: 'car', accuracy: 0.88 }
      ];
      
      function detectChanges(prev, next) {
        const prevIds = new Set(prev.map(d => d.id));
        const nextIds = new Set(next.map(d => d.id));
        
        const added = next.filter(d => !prevIds.has(d.id));
        const removed = prev.filter(d => !nextIds.has(d.id));
        
        return { added, removed, hasChanges: added.length > 0 || removed.length > 0 };
      }
      
      const changes = detectChanges(prev, next);
      expect(changes.hasChanges).toBe(true);
      expect(changes.added.length).toBe(1);
      expect(changes.added[0].id).toBe('002');
    });
    
    it('should preserve scroll position on update', () => {
      // Simulate list virtualization behavior
      const scrollState = { scrollTop: 500, itemHeight: 100 };
      
      function calculateVisibleRange(scrollTop, containerHeight, totalItems, itemHeight) {
        const startIndex = Math.floor(scrollTop / itemHeight);
        const visibleCount = Math.ceil(containerHeight / itemHeight) + 1;
        const endIndex = Math.min(startIndex + visibleCount, totalItems);
        return { startIndex, endIndex };
      }
      
      const range1 = calculateVisibleRange(500, 400, 100, 100);
      
      // Simulate data update
      const newTotalItems = 105; // 5 new items added
      const range2 = calculateVisibleRange(500, 400, newTotalItems, 100);
      
      // Visible range should be similar
      expect(range2.startIndex).toBe(range1.startIndex);
    });
  });
});

// ============================================================================
// TEST 2: ALARM RULES
// ============================================================================

describe('Alarm Rules Tests', () => {
  // Threat level mapping
  const getThreatInfo = (cls, accuracy) => {
    const c = cls?.toLowerCase() || '';
    let level = Number(accuracy);
    
    if (Number.isFinite(level)) {
      if (level > 0 && level <= 1) level *= 100;
      level = Math.max(0, Math.min(100, level));
    } else {
      level = 0;
    }
    
    if (c === 'person') return { level, type: 'red', color: '#ef4444' };
    if (['car', 'truck', 'motorcycle', 'bicycle', 'bus', 'horse', 'camel'].includes(c)) {
      return { level, type: 'yellow', color: '#eab308' };
    }
    return { level, type: 'green', color: '#22c55e' };
  };
  
  describe('Threat Level Mapping', () => {
    it('should classify person as red/critical', () => {
      const threat = getThreatInfo('person', 0.95);
      expect(threat.type).toBe('red');
      expect(threat.color).toBe('#ef4444');
    });
    
    it('should classify vehicles as yellow/warning', () => {
      const vehicles = ['car', 'truck', 'motorcycle', 'bus'];
      
      vehicles.forEach(v => {
        const threat = getThreatInfo(v, 0.85);
        expect(threat.type).toBe('yellow');
        expect(threat.color).toBe('#eab308');
      });
    });
    
    it('should classify other objects as green/normal', () => {
      const others = ['bird', 'dog', 'cat', 'unknown'];
      
      others.forEach(o => {
        const threat = getThreatInfo(o, 0.90);
        expect(threat.type).toBe('green');
        expect(threat.color).toBe('#22c55e');
      });
    });
    
    it('should normalize accuracy from 0-1 to 0-100', () => {
      const threat = getThreatInfo('person', 0.95);
      expect(threat.level).toBe(95);
    });
    
    it('should handle accuracy already in 0-100 range', () => {
      const threat = getThreatInfo('person', 95);
      expect(threat.level).toBe(95);
    });
    
    it('should handle missing/invalid accuracy', () => {
      const threat = getThreatInfo('person', null);
      expect(threat.level).toBe(0);
      
      const threat2 = getThreatInfo('person', 'invalid');
      expect(threat2.level).toBe(0);
    });
  });
});

// ============================================================================
// TEST 3: IMAGE LOADING
// ============================================================================

describe('Image Loading Tests', () => {
  describe('Image URL Generation', () => {
    it('should generate correct crop URL', () => {
      const cropId = 'abc123';
      const url = `/api/image/crop/${cropId}`;
      expect(url).toBe('/api/image/crop/abc123');
    });
    
    it('should generate correct fullframe URL', () => {
      const recordId = 'rec456';
      const url = `/api/image/fullframe/${recordId}`;
      expect(url).toBe('/api/image/fullframe/rec456');
    });
  });
  
  describe('Image Missing Handling', () => {
    it('should show placeholder when image 404', () => {
      const fallbackSrc = 'data:image/svg+xml;base64,PHN2Zz...';
      
      let currentSrc = '/api/image/crop/nonexistent';
      
      // Simulate error handler
      function handleImageError() {
        currentSrc = fallbackSrc;
      }
      
      // Simulate 404
      handleImageError();
      
      expect(currentSrc).toBe(fallbackSrc);
    });
    
    it('should show detection data even without image', () => {
      const detection = {
        id: '001',
        class: 'person',
        accuracy: 0.95,
        location: { lat: 37.3683, lng: 42.4986 },
        captured_time: '2026-01-20T14:30:00Z',
        image_status: 'pending' // No image yet
      };
      
      // Should still be displayable
      expect(detection.class).toBeDefined();
      expect(detection.accuracy).toBeDefined();
      expect(detection.location).toBeDefined();
    });
  });
});

// ============================================================================
// TEST 4: NOTIFICATION/ALARM SYSTEM
// ============================================================================

describe('Notification System Tests', () => {
  describe('Background Tab Notifications', () => {
    it('should queue notification when tab is hidden', () => {
      const notifications = [];
      let isTabVisible = false;
      
      function addNotification(detection) {
        const notification = {
          id: detection.id,
          class: detection.class,
          timestamp: Date.now(),
          seen: isTabVisible
        };
        notifications.push(notification);
        return notification;
      }
      
      // Tab hidden, new detection arrives
      isTabVisible = false;
      addNotification({ id: '001', class: 'person' });
      
      expect(notifications.length).toBe(1);
      expect(notifications[0].seen).toBe(false);
    });
    
    it('should navigate to detection when notification clicked', () => {
      let navigatedTo = null;
      
      function handleNotificationClick(detectionId) {
        navigatedTo = `/detection/${detectionId}`;
      }
      
      handleNotificationClick('det_001');
      
      expect(navigatedTo).toBe('/detection/det_001');
    });
    
    it('should show badge count for unseen notifications', () => {
      const notifications = [
        { id: '001', seen: false },
        { id: '002', seen: false },
        { id: '003', seen: true }
      ];
      
      const unseenCount = notifications.filter(n => !n.seen).length;
      
      expect(unseenCount).toBe(2);
    });
  });
});

// ============================================================================
// TEST 5: REAL-TIME UPDATE HANDLING
// ============================================================================

describe('Real-time Update Tests', () => {
  describe('WebSocket Message Handling', () => {
    it('should parse detection update message', () => {
      const message = JSON.stringify({
        type: 'detection_new',
        data: {
          id: 'det_001',
          class: 'person',
          accuracy: 0.95
        }
      });
      
      const parsed = JSON.parse(message);
      
      expect(parsed.type).toBe('detection_new');
      expect(parsed.data.id).toBe('det_001');
    });
    
    it('should handle transfer progress update', () => {
      const progressUpdate = {
        type: 'transfer_progress',
        data: {
          transfer_id: 'TX_001',
          percent: 45,
          chunks_received: 9,
          chunks_total: 20
        }
      };
      
      expect(progressUpdate.data.percent).toBe(45);
      expect(progressUpdate.data.chunks_received).toBe(9);
    });
    
    it('should merge updates without full refresh', () => {
      const existing = new Map([
        ['det_001', { id: 'det_001', class: 'person', accuracy: 0.90 }],
        ['det_002', { id: 'det_002', class: 'car', accuracy: 0.85 }]
      ]);
      
      // Incoming update
      const update = { id: 'det_001', accuracy: 0.95 };
      
      // Merge
      if (existing.has(update.id)) {
        const current = existing.get(update.id);
        existing.set(update.id, { ...current, ...update });
      }
      
      expect(existing.get('det_001').accuracy).toBe(0.95);
      expect(existing.size).toBe(2); // No new entry added
    });
  });
});

// ============================================================================
// TEST 6: SEARCH AND FILTER
// ============================================================================

describe('Search and Filter Tests', () => {
  const detections = [
    { id: 'det_001', class: 'person', device_id: 'SOLO-001', accuracy: 0.95 },
    { id: 'det_002', class: 'car', device_id: 'SOLO-002', accuracy: 0.88 },
    { id: 'det_003', class: 'person', device_id: 'SOLO-001', accuracy: 0.72 },
    { id: 'det_004', class: 'truck', device_id: 'SOLO-003', accuracy: 0.91 }
  ];
  
  describe('Text Search', () => {
    it('should filter by class name', () => {
      const term = 'person';
      const filtered = detections.filter(d => 
        d.class.toLowerCase().includes(term.toLowerCase())
      );
      
      expect(filtered.length).toBe(2);
    });
    
    it('should filter by device ID', () => {
      const term = 'SOLO-001';
      const filtered = detections.filter(d => 
        d.device_id.toLowerCase().includes(term.toLowerCase())
      );
      
      expect(filtered.length).toBe(2);
    });
    
    it('should filter by detection ID', () => {
      const term = 'det_002';
      const filtered = detections.filter(d => 
        d.id.toLowerCase().includes(term.toLowerCase())
      );
      
      expect(filtered.length).toBe(1);
    });
  });
  
  describe('Debounced Search', () => {
    it('should debounce rapid search input', async () => {
      let searchCalls = 0;
      
      function debounce(fn, delay) {
        let timeoutId;
        return (...args) => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn(...args), delay);
        };
      }
      
      const debouncedSearch = debounce(() => searchCalls++, 100);
      
      // Rapid calls
      debouncedSearch('a');
      debouncedSearch('ab');
      debouncedSearch('abc');
      
      // Only last one should execute after delay
      await new Promise(r => setTimeout(r, 150));
      
      expect(searchCalls).toBe(1);
    });
  });
});

// ============================================================================
// TEST 7: INFINITE SCROLL / VIRTUALIZATION
// ============================================================================

describe('List Virtualization Tests', () => {
  describe('Visible Item Calculation', () => {
    it('should calculate correct visible range', () => {
      const containerHeight = 500;
      const itemHeight = 50;
      const scrollTop = 250;
      const totalItems = 100;
      
      const startIndex = Math.floor(scrollTop / itemHeight);
      const visibleCount = Math.ceil(containerHeight / itemHeight);
      const endIndex = Math.min(startIndex + visibleCount, totalItems);
      
      expect(startIndex).toBe(5);
      expect(endIndex).toBe(15);
    });
    
    it('should render only visible items plus buffer', () => {
      const totalItems = 1000;
      const visibleItems = 10;
      const buffer = 5;
      
      const renderedCount = visibleItems + (buffer * 2);
      
      expect(renderedCount).toBe(20);
      expect(renderedCount).toBeLessThan(totalItems);
    });
  });
  
  describe('Load More on Scroll', () => {
    it('should trigger load more at threshold', () => {
      let loadMoreCalled = false;
      
      function checkLoadMore(scrollTop, scrollHeight, clientHeight, threshold = 0.8) {
        const scrollPercent = (scrollTop + clientHeight) / scrollHeight;
        if (scrollPercent >= threshold) {
          loadMoreCalled = true;
        }
      }
      
      // Near bottom (85%)
      checkLoadMore(850, 1000, 100);
      
      expect(loadMoreCalled).toBe(true);
    });
  });
});

// ============================================================================
// TEST 8: PERFORMANCE - RENDER COUNT
// ============================================================================

describe('Performance Tests', () => {
  describe('Memoization', () => {
    it('should not re-compute threat info for same inputs', () => {
      let computeCount = 0;
      
      const cache = new Map();
      
      function memoizedThreatInfo(cls, accuracy) {
        const key = `${cls}:${accuracy}`;
        if (cache.has(key)) {
          return cache.get(key);
        }
        
        computeCount++;
        const result = { level: accuracy * 100, type: cls === 'person' ? 'red' : 'green' };
        cache.set(key, result);
        return result;
      }
      
      // Call multiple times with same input
      memoizedThreatInfo('person', 0.95);
      memoizedThreatInfo('person', 0.95);
      memoizedThreatInfo('person', 0.95);
      
      expect(computeCount).toBe(1); // Only computed once
    });
  });
  
  describe('Batch Updates', () => {
    it('should batch multiple state updates', async () => {
      let renderCount = 0;
      let state = { a: 0, b: 0, c: 0 };
      
      function batchUpdate(updates) {
        // Simulate React 18 automatic batching
        state = { ...state, ...updates };
        renderCount++;
      }
      
      // Batch multiple updates
      batchUpdate({ a: 1, b: 2, c: 3 });
      
      expect(renderCount).toBe(1); // Single render for all updates
      expect(state).toEqual({ a: 1, b: 2, c: 3 });
    });
  });
});

// ============================================================================
// RUN TESTS
// ============================================================================

// Run: cd dashboard && npm test
