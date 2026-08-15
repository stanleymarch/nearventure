import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { findClosestReached, useLocationTracker } from './useLocationTracker';

const POI = [
  { id: 'a', lat: 58.6000, lon: 49.6000 },
  { id: 'b', lat: 58.6050, lon: 49.6050 },
  { id: 'c', lat: 58.6100, lon: 49.6100 },
];

describe('findClosestReached', () => {
  it('returns the closest POI within reach', () => {
    // ~5m south of POI a
    const r = findClosestReached({ lat: 58.59996, lon: 49.6000 }, POI, 50);
    expect(r?.id).toBe('a');
    expect(r?.index).toBe(0);
    expect(r?.distance).toBeLessThan(10);
  });

  it('returns null when no POI is within reach', () => {
    // Kirov center, ~5km from the first POI
    const r = findClosestReached({ lat: 58.6035, lon: 49.6679 }, POI, 50);
    expect(r).toBeNull();
  });

  it('respects custom reach radius', () => {
    // ~210m from b, ~460m from c, ~815m from a — closer to b.
    // With reach=200, no POI is "reached"; with reach=500, b is.
    const near = { lat: 58.6060, lon: 49.6080 };
    expect(findClosestReached(near, POI, 200)).toBeNull();
    expect(findClosestReached(near, POI, 500)?.id).toBe('b');
  });

  it('returns null for empty POI list', () => {
    expect(findClosestReached({ lat: 58.6, lon: 49.6 }, [], 50)).toBeNull();
  });

  it('finds the nearer of two equally-reachable POIs', () => {
    const r = findClosestReached({ lat: 58.6051, lon: 49.6051 }, POI, 50);
    // On the dot of POI b → distance 0
    expect(r?.id).toBe('b');
  });
});

describe('useLocationTracker lifecycle (P0-2 regression: battery drain on unmount)', () => {
  let origWindow: any;
  beforeEach(() => {
    // Mock Telegram WebApp with a controllable LocationManager.
    origWindow = (globalThis as any).window;
    const requestLocation = vi.fn();
    const stopTracking = vi.fn();
    const lm = {
      isInited: true,
      isAccessGranted: true,
      init: vi.fn().mockResolvedValue(undefined),
      requestLocation: requestLocation,
      stopTracking: stopTracking,
    };
    (globalThis as any).window = {
      Telegram: { WebApp: { LocationManager: lm } },
    };
  });
  afterEach(() => {
    (globalThis as any).window = origWindow;
  });

  it('stops polling and clears timers on component unmount', async () => {
    const tracker = ref<any>(null);
    const host = defineComponent({
      setup() {
        const t = useLocationTracker(
          () => [{ id: 'a', lat: 58.6, lon: 49.6 }],
          { onUpdate: () => {} },
        );
        tracker.value = t;
        return () => h('div');
      },
    });
    const wrapper = mount(host);
    await nextTick();

    // Activate the tracker
    await tracker.value.request();
    expect(tracker.value.active).toBe(true);

    // Unmount — the composable's onUnmounted cleanup should fire.
    wrapper.unmount();
    await nextTick();

    // After unmount: active flag flipped off, any scheduled timer cleared.
    expect(tracker.value.active).toBe(false);
  });
});
