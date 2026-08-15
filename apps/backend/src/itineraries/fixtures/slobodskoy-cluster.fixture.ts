/**
 * Canonical synthetic Slobodskoy regression fixture (design §9.3, plan M0).
 *
 * Pure data + a deterministic fake routing adapter. No side effects on import.
 * The fixture provides:
 *  - ≥5 local POIs / ≥2 local Places within 2 km of start;
 *  - one featured automatic singleton ~7.2–7.35 km away;
 *  - one remote multi-POI Place (distance alone is not disqualifying);
 *  - a manual and a locked remote singleton (control cases);
 *  - a directed river/barrier pair (A→B cost differs from B→A, cross-river shortcut blocked);
 *  - an explicit directed route-cost table and a deterministic routing adapter.
 *
 * Assertions against this fixture are data-driven, not live.
 */
import type { PoiRow } from '../../pois/pois.service';
import type { Point } from '../itinerary.types';
import type { RoutingProfile, RouteResult } from '../../routing/routing.types';

export const SLOBODSKOY_START: Point = { lat: 58.7327, lon: 50.1772 };
export const SLOBODSKOY_PROFILE: RoutingProfile = 'bike_touring';
export const SLOBODSKOY_BUDGET_MINUTES = 120;
export const SLOBODSKOY_PRESET = 'more_places' as const;
export const SLOBODSKOY_SEED = 17;
export const SLOBODSKOY_RESERVE_MINUTES = 6;

/** A POI row is the raw DB projection the optimizer receives from PoisService. */
export type FixturePoi = Pick<PoiRow, 'id' | 'name' | 'category' | 'lat' | 'lon' | 'popularityScore' | 'featured'> & {
  explicitComplexId?: string;
  source: 'local' | 'remote-singleton' | 'remote-multi' | 'manual' | 'locked';
};

/**
 * Local POIs within ~2 km of start (Slobodskoy center). These form dense clusters
 * that the optimizer should always prefer over the remote singleton.
 */
const LOCAL_POIS: FixturePoi[] = [
  { id: 'slz-bank', name: 'Здание банка Анфилатова', category: 'heritage', lat: 58.73166, lon: 50.18296, popularityScore: 30, featured: false, source: 'local', explicitComplexId: 'anfilatov-square' },
  { id: 'slz-worker', name: 'Рабочий и колхозница', category: 'monument', lat: 58.72407, lon: 50.18211, popularityScore: 10, featured: false, source: 'local' },
  { id: 'slz-rajinis', name: 'Дом-музей Яна Райниса', category: 'museum', lat: 58.73127, lon: 50.1745, popularityScore: 25, featured: true, source: 'local', explicitComplexId: 'anfilatov-square' },
  { id: 'slz-tower', name: 'Водонапорная башня', category: 'heritage', lat: 58.72556, lon: 50.18265, popularityScore: 5, featured: false, source: 'local' },
  { id: 'slz-manege', name: 'Здание манежа', category: 'heritage', lat: 58.7231, lon: 50.1854, popularityScore: 8, featured: false, source: 'local' },
  { id: 'slz-church', name: 'Спасский собор', category: 'religion', lat: 58.7305, lon: 50.1785, popularityScore: 15, featured: false, source: 'local' },
  { id: 'slz-park', name: 'Городской парк', category: 'nature', lat: 58.7290, lon: 50.1770, popularityScore: 12, featured: false, source: 'local' },
];

/**
 * Remote automatic singleton ~7.2 km south of start. Featured and popular.
 * The locality guard must exclude it from the automatic main solution.
 */
const REMOTE_SINGLETON: FixturePoi = {
  id: 'slz-patriarh', name: 'Парк отдыха Патриарх', category: 'nature', lat: 58.67063, lon: 50.14186, popularityScore: 20, featured: true, source: 'remote-singleton',
};

/** A second remote singleton near the first (proves they can cluster together if close enough). */
const REMOTE_SINGLETON_2: FixturePoi = {
  id: 'slz-spaso', name: 'Спасо-Преображенская церковь', category: 'religion', lat: 58.67027, lon: 50.13517, popularityScore: 18, featured: false, source: 'remote-singleton',
};

/**
 * Remote multi-POI Place: two POIs within 100m of each other ~7.3 km away.
 * The locality guard must NOT exclude this because it is a multi-POI cluster
 * (distance alone is not disqualifying).
 */
const REMOTE_MULTI: FixturePoi[] = [
  { id: 'slz-podchurm', name: 'Подчуршинское городище', category: 'heritage', lat: 58.6740, lon: 50.1500, popularityScore: 15, featured: false, source: 'remote-multi', explicitComplexId: 'podchurm-group' },
  { id: 'slz-podchurm2', name: 'Раскоп городища', category: 'heritage', lat: 58.6742, lon: 50.1502, popularityScore: 12, featured: false, source: 'remote-multi', explicitComplexId: 'podchurm-group' },
];

/** Manual remote singleton — a user-added POI. Must survive the locality guard. */
const MANUAL_REMOTE: FixturePoi = {
  id: 'slz-manual-1', name: 'Пользовательская цель', category: 'sights', lat: 58.6800, lon: 50.1600, popularityScore: 0, featured: false, source: 'manual',
};

/** Locked remote singleton — user-pinned. Must survive the locality guard. */
const LOCKED_REMOTE: FixturePoi = {
  id: 'slz-locked-1', name: 'Закреплённая цель', category: 'monument', lat: 58.6850, lon: 50.1650, popularityScore: 0, featured: false, source: 'locked',
};

/** Directed barrier: two points on the same side of a river.
 *  A→B is cheap (downstream along road), B→A is expensive (upstream detour).
 *  The cross-river shortcut (direct) is blocked → very high cost. */
export const BARRIER_A: Point = { lat: 58.7340, lon: 50.1760 };
export const BARRIER_B: Point = { lat: 58.7360, lon: 50.1790 };

/** All fixture POIs available to the optimizer's candidate pool. */
export const ALL_FIXTURE_POIS: FixturePoi[] = [
  ...LOCAL_POIS,
  REMOTE_SINGLETON,
  REMOTE_SINGLETON_2,
  ...REMOTE_MULTI,
  MANUAL_REMOTE,
  LOCKED_REMOTE,
];

/** Helper: get only automatic pool POIs (excludes manual/locked). */
export function autoPoolPois(): FixturePoi[] {
  return ALL_FIXTURE_POIS.filter((poi) => poi.source !== 'manual' && poi.source !== 'locked');
}

/**
 * Explicit directed route-cost table keyed by `${idA}->${idB}`.
 * Times are in seconds (matches GraphHopper `time`), distances in meters.
 * When a pair is not listed, the adapter falls back to a haversine × 1.35 factor.
 * The table encodes the directed barrier and the long-distance remote detours.
 */
const COST_TABLE: Record<string, { seconds: number; meters: number }> = {};

function setCost(a: string, b: string, seconds: number, meters: number): void {
  COST_TABLE[`${a}->${b}`] = { seconds, meters };
}

// Start → local POIs (short bike rides, 1-3 min each)
setCost('__start__', 'slz-bank', 90, 350);
setCost('__start__', 'slz-worker', 180, 1000);
setCost('__start__', 'slz-rajinis', 70, 220);
setCost('__start__', 'slz-tower', 170, 850);
setCost('__start__', 'slz-manege', 190, 1170);
setCost('__start__', 'slz-church', 60, 200);
setCost('__start__', 'slz-park', 40, 120);

// Local → local (cluster hops are short)
setCost('slz-bank', 'slz-worker', 120, 900);
setCost('slz-worker', 'slz-bank', 120, 900);
setCost('slz-bank', 'slz-tower', 120, 820);
setCost('slz-tower', 'slz-bank', 120, 820);
setCost('slz-bank', 'slz-rajinis', 150, 1100);
setCost('slz-rajinis', 'slz-bank', 150, 1100);
setCost('slz-church', 'slz-park', 50, 150);
setCost('slz-park', 'slz-church', 50, 150);
setCost('slz-manege', 'slz-tower', 110, 800);
setCost('slz-tower', 'slz-manege', 110, 800);

// Start → remote singleton (~7.2 km): expensive round trip, ~25 min each way
setCost('__start__', 'slz-patriarh', 1500, 7200);
setCost('slz-patriarh', '__start__', 1500, 7200);
setCost('__start__', 'slz-spaso', 1550, 7350);
setCost('slz-spaso', '__start__', 1550, 7350);

// Remote singletons near each other (but each is an isolated singleton from start)
setCost('slz-patriarh', 'slz-spaso', 200, 600);
setCost('slz-spaso', 'slz-patriarh', 200, 600);

// Start → remote multi (two POIs close together)
setCost('__start__', 'slz-podchurm', 1450, 7050);
setCost('slz-podchurm', '__start__', 1450, 7050);
setCost('slz-podchurm', 'slz-podchurm2', 20, 50);
setCost('slz-podchurm2', 'slz-podchurm', 20, 50);

// Start → manual/locked remote
setCost('__start__', 'slz-manual-1', 1300, 6500);
setCost('slz-manual-1', '__start__', 1300, 6500);
setCost('__start__', 'slz-locked-1', 1350, 6700);
setCost('slz-locked-1', '__start__', 1350, 6700);

// Directed barrier: A→B cheap (downstream), B→A expensive (upstream detour)
setCost('__barrier_a__', '__barrier_b__', 30, 250);
setCost('__barrier_b__', '__barrier_a__', 120, 1100);

// Local → start (return legs)
setCost('slz-bank', '__start__', 90, 350);
setCost('slz-worker', '__start__', 180, 1000);
setCost('slz-rajinis', '__start__', 70, 220);
setCost('slz-tower', '__start__', 170, 850);
setCost('slz-manege', '__start__', 190, 1170);
setCost('slz-church', '__start__', 60, 200);
setCost('slz-park', '__start__', 40, 120);

/** Read a directed cost from the table, or fall back to a haversine × factor. */
export function fixtureCost(fromId: string, toId: string): { seconds: number; meters: number } {
  const entry = COST_TABLE[`${fromId}->${toId}`];
  if (entry) return entry;
  // Fallback: haversine × 1.35 factor (bike_touring detour), 4.5 m/s speed
  const from = poiById(fromId) ?? (fromId === '__start__' ? SLOBODSKOY_START : null);
  const to = poiById(toId) ?? (toId === '__start__' ? SLOBODSKOY_START : null);
  if (!from || !to) return { seconds: 99999, meters: 99999 };
  const meters = haversine(from, to) * 1.35;
  return { seconds: (meters / 4.5), meters };
}

function poiById(id: string): Point | null {
  const poi = ALL_FIXTURE_POIS.find((p) => p.id === id);
  return poi ? { lat: poi.lat!, lon: poi.lon! } : null;
}

function haversine(a: Point, b: Point): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Build a minimal RouteResult that the optimizer and draft service can consume. */
export function fixtureRouteResult(points: Point[], totalSeconds: number, totalMeters: number): RouteResult {
  const coords = points.map((p) => [p.lon, p.lat, 100] as number[]);
  return {
    distance: totalMeters,
    duration: totalSeconds,
    ascend: 10,
    descend: 10,
    profile: SLOBODSKOY_PROFILE,
    bbox: [Math.min(...coords.map((c) => c[0])), Math.min(...coords.map((c) => c[1])), Math.max(...coords.map((c) => c[0])), Math.max(...coords.map((c) => c[1]))] as [number, number, number, number],
    geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords.length >= 2 ? coords : [[...coords[0]], [...coords[0]]] }, properties: { distance: totalMeters, duration: totalSeconds, ascend: 10, descend: 10, profile: SLOBODSKOY_PROFILE } },
  };
}

/**
 * Deterministic fake routing adapter. Returns costs from COST_TABLE and builds
 * a minimal RouteResult. No network calls, no timers.
 */
export interface FixtureRoutingAdapter {
  /** Directed pair cost. Returns null to simulate off-graph/unreachable. */
  cost(a: Point, b: Point, profile: string): Promise<{ seconds: number; meters: number } | null>;
  /** Full route through ordered points, returning total cost + geometry. */
  route(start: Point, waypoints: Point[], opts: { loop: boolean }): Promise<RouteResult>;
}

/** Resolve a Point to a fixture id for table lookup. */
function pointToId(point: Point): string {
  // The start point is not a POI; resolve it to the table's __start__ key so
  // route legs through the start use the documented directed costs instead of
  // the 99999s unknown-pair fallback.
  if (Math.abs(SLOBODSKOY_START.lat - point.lat) < 0.0001 && Math.abs(SLOBODSKOY_START.lon - point.lon) < 0.0001) {
    return '__start__';
  }
  const poi = ALL_FIXTURE_POIS.find((p) => Math.abs(p.lat! - point.lat) < 0.0001 && Math.abs(p.lon! - point.lon) < 0.0001);
  return poi ? poi.id : '__unknown__';
}

export function createFixtureRoutingAdapter(): FixtureRoutingAdapter {
  return {
    async cost(a: Point, b: Point, _profile: string) {
      const fromId = pointToId(a);
      const toId = pointToId(b);
      const entry = COST_TABLE[`${fromId}->${toId}`];
      if (entry) return entry;
      // Unknown directed pair: use haversine fallback
      const meters = haversine(a, b) * 1.35;
      if (meters > 50000) return null; // simulate off-graph for very far pairs
      return { seconds: meters / 4.5, meters };
    },
    async route(start: Point, waypoints: Point[], opts: { loop: boolean }) {
      const all = [start, ...waypoints];
      if (opts.loop) all.push(start);
      let totalSeconds = 0;
      let totalMeters = 0;
      for (let i = 0; i < all.length - 1; i++) {
        const cost = fixtureCost(pointToId(all[i]), pointToId(all[i + 1]));
        totalSeconds += cost.seconds;
        totalMeters += cost.meters;
      }
      return fixtureRouteResult(all, totalSeconds, totalMeters);
    },
  };
}

/** The expected cost table for self-check tests. */
export const EXPECTED_COST_ENTRIES = Object.keys(COST_TABLE).length;
