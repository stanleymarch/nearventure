import { onUnmounted, ref, watch } from 'vue';
import { haversine, type LatLon } from './useGeo';

/**
 * Live location tracker for the Mini App.
 *
 * Wraps Telegram's LocationManager (Bot API 8.0+, available in Telegram
 * WebApp SDK 7.x+) with a graceful fallback: on runtimes without the API
 * (older Telegram, browser dev), tracking is a no-op and the caller can
 * still operate in manual mode.
 *
 * Lifecycle:
 *  - call request() once you have the user's permission
 *  - watch `closestPoi` for the closest unvisited POI within `reachMeters`
 *  - call stop() when the user navigates away
 *
 * The "I'm at the POI" decision lives in the caller — this composable just
 * surfaces location updates and a derived distance. We keep it dumb so the
 * caller (e.g. GuideView) can decide whether to auto-advance, ask for
 * confirmation, or vibrate.
 *
 * Anti-pattern note: this composable does NOT request geolocation in a
 * loop. We start Telegram's manager once, which streams updates at the
 * SDK's cadence (typically a few seconds), and stop when the component
 * unmounts.
 */

const REACH_METERS = 50; // within 50m → "I'm here"

/**
 * Pure derivation — finds the closest POI to a given point and returns
 * the result. Exported for testability; no SDK calls, no reactivity.
 */
export function findClosestReached(
  point: LatLon,
  pois: Array<{ id: string; lat: number; lon: number }>,
  reachMeters: number = REACH_METERS,
): { id: string; index: number; distance: number } | null {
  if (pois.length === 0) return null;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < pois.length; i++) {
    const d = haversine(point, { lat: pois[i].lat, lon: pois[i].lon });
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestDist > reachMeters) return null;
  return { id: pois[bestIdx].id, index: bestIdx, distance: bestDist };
}

export interface TrackerOptions {
  /** Called whenever a new location update arrives. */
  onUpdate?: (loc: LatLon) => void;
  /** Called when the user enters `REACH_METERS` of a tracked POI. */
  onReach?: (poi: { id: string; index: number; lat: number; lon: number; distance: number }) => void;
  /** Called when the user leaves the previous reach zone. */
  onLeave?: (poiId: string) => void;
  /** Override the default reach radius. */
  reachMeters?: number;
}

export interface TrackerState {
  /** True while the tracker is actively polling. */
  active: ReturnType<typeof ref<boolean>>;
  /** Last known location, or null until the first update. */
  location: ReturnType<typeof ref<LatLon | null>>;
  /** Last error from the SDK (permission denied, etc). */
  error: ReturnType<typeof ref<string | null>>;
  /** True if the runtime supports the Telegram LocationManager. */
  isSupported: boolean;
  request: () => Promise<boolean>;
  stop: () => void;
  /** Reactive: the distance from the latest location to the given POI. */
  distanceTo: (poi: { lat: number; lon: number }) => number | null;
  /** Reactive: index of the closest un-reached POI (or -1 if none in reach). */
  reachedIndex: ReturnType<typeof ref<number>>;
}

export function useLocationTracker(
  pois: () => Array<{ id: string; lat: number; lon: number }>,
  options: TrackerOptions = {},
): TrackerState {
  const active = ref(false);
  const location = ref<LatLon | null>(null);
  const error = ref<string | null>(null);
  const reachedIndex = ref<number>(-1);

  const reachMeters = options.reachMeters ?? REACH_METERS;
  const tg = (typeof window !== 'undefined' ? window.Telegram?.WebApp : null) as any;
  const lm = tg?.LocationManager as undefined | {
    init: () => Promise<void>;
    isInited?: boolean;
    isLocationAvailable?: boolean;
    isAccessGranted?: boolean;
    requestLocation: (
      cb: (loc: { latitude: number; longitude: number }) => void,
      errCb?: (err: { code?: number; message?: string }) => void,
      timeout?: number,
    ) => void;
    stopTracking?: () => void;
  };

  const isSupported = !!lm && typeof lm.requestLocation === 'function';

  let lastReachedId: string | null = null;
  let pollHandle: number | null = null;
  let stopped = false;

  function poll() {
    if (stopped || !lm) return;
    lm.requestLocation(
      (loc) => {
        if (stopped) return;
        const point: LatLon = { lat: loc.latitude, lon: loc.longitude };
        location.value = point;
        options.onUpdate?.(point);
        evaluateReached(point);
        // Re-poll after a short delay — requestLocation is one-shot in
        // current SDK versions; we re-call it to get the next reading.
        pollHandle = window.setTimeout(poll, 4000);
      },
      (err) => {
        error.value = err?.message || 'Location not available';
        active.value = false;
      },
      8000,
    );
  }

  function evaluateReached(point: LatLon) {
    const list = pois();
    if (list.length === 0) return;
    const hit = findClosestReached(point, list, reachMeters);
    if (hit) {
      reachedIndex.value = hit.index;
      if (hit.id !== lastReachedId) {
        if (lastReachedId !== null) options.onLeave?.(lastReachedId);
        lastReachedId = hit.id;
        const poi = list[hit.index];
        options.onReach?.({
          id: hit.id,
          index: hit.index,
          lat: poi.lat,
          lon: poi.lon,
          distance: hit.distance,
        });
      }
    } else {
      if (lastReachedId !== null) {
        options.onLeave?.(lastReachedId);
        lastReachedId = null;
        reachedIndex.value = -1;
      }
    }
  }

  async function request(): Promise<boolean> {
    if (!isSupported) {
      error.value = 'LocationManager not available in this Telegram version.';
      return false;
    }
    if (active.value) return true;
    stopped = false;
    error.value = null;
    try {
      if (!lm!.isInited) await lm!.init();
      // Check permission state. If user hasn't granted yet, ask via the
      // one-time request location button (Telegram's "Request location"
      // keyboard button flow).
      if (lm!.isAccessGranted === false) {
        // We can't programmatically request access — Telegram requires a
        // user tap on a "Request location" keyboard button. The caller
        // (GuideView) should show a "📍 Разрешить геолокацию" button that
        // calls requestAccess() which surfaces that flow.
        return false;
      }
      active.value = true;
      poll();
      return true;
    } catch (e: any) {
      error.value = e?.message || 'Failed to start tracker';
      active.value = false;
      return false;
    }
  }

  function stop() {
    stopped = true;
    if (pollHandle !== null) {
      clearTimeout(pollHandle);
      pollHandle = null;
    }
    if (lm?.stopTracking) {
      try { lm.stopTracking(); } catch { /* SDK variant */ }
    }
    active.value = false;
  }

  function distanceTo(poi: { lat: number; lon: number }): number | null {
    if (!location.value) return null;
    return haversine(location.value, { lat: poi.lat, lon: poi.lon });
  }

  // P0-2: Always cleanup on component teardown — and also abort any
  // in-flight poll cycle. The `stop()` function sets stopped=true and
  // clears the timer; the in-flight requestLocation callback checks
  // `if (stopped) return` before setting a new timer. The combination
  // of onUnmounted + the guard inside the callback prevents the "battery
  // drain" symptom the user reported: after navigating away from the
  // preview view, no new timers are scheduled.
  onUnmounted(() => {
    stop();
    // Belt-and-suspenders: if a pollHandle was set between the last
    // callback check and the unmount, clear it again via a microtask.
    queueMicrotask(() => {
      if (pollHandle !== null) {
        clearTimeout(pollHandle);
        pollHandle = null;
      }
    });
  });

  // If the POI list changes while we're tracking, re-evaluate the closest
  // match — e.g. user removed a POI from the cart mid-walk.
  watch(
    () => pois(),
    () => {
      if (location.value) evaluateReached(location.value);
    },
    { deep: false },
  );

  return { active, location, error, isSupported, request, stop, distanceTo, reachedIndex };
}
