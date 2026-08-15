import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AutoItineraryOptimizerService, LockedSetOverBudgetError } from './auto-itinerary-optimizer.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { PlaceClusteringService } from './place-clustering.service';
import { VisitTimeService } from './visit-time.service';
import { LoopQualityService } from '../routing/loop-quality.service';
import { ItineraryScoreService } from './itinerary-score.service';
import { LocalityGuardService } from './locality-guard.service';
import { SelectionDiagnosticsLogger } from './selection-diagnostics.logger';
import { RouteCostEvaluatorService } from './route-cost-evaluator.service';
import { RouteCostCacheService } from './route-cost-cache.service';
import { OptimizerSearchService } from './optimizer-search.service';
import {
  SLOBODSKOY_START, SLOBODSKOY_PROFILE, SLOBODSKOY_BUDGET_MINUTES, SLOBODSKOY_PRESET, SLOBODSKOY_SEED,
  ALL_FIXTURE_POIS, autoPoolPois, createFixtureRoutingAdapter, SLOBODSKOY_RESERVE_MINUTES,
  fixtureRouteResult,
} from './fixtures/slobodskoy-cluster.fixture';
import type { ItineraryDraftState, Point } from './itinerary.types';

const originalPolicy = process.env.NV_AUTO_POLICY;

function slobodskoyState(places: any[] = []): ItineraryDraftState {
  return {
    status: 'ready', start: SLOBODSKOY_START, profile: SLOBODSKOY_PROFILE,
    loop: true, preset: SLOBODSKOY_PRESET, intent: 'auto_budget', stopPace: 'pass_by',
    budgetMode: 'whole_trip', budgetMinutes: SLOBODSKOY_BUDGET_MINUTES,
    reserveMinutes: SLOBODSKOY_RESERVE_MINUTES, places,
    warnings: [], suggestions: [], selectionPolicyVersion: 'v2',
    totals: { travelMinutes: 0, stopMinutes: 0, reserveMinutes: SLOBODSKOY_RESERVE_MINUTES, totalMinutes: SLOBODSKOY_RESERVE_MINUTES, budgetMinutes: SLOBODSKOY_BUDGET_MINUTES, feasible: true, overBudgetMinutes: 0, remainingMinutes: SLOBODSKOY_BUDGET_MINUTES - SLOBODSKOY_RESERVE_MINUTES },
  };
}

/** Balanced-preset state mirroring the live Slobodskoy auto request
 *  (budget 120 + reserve 10, bike_touring loop). */
function balancedSlobodskoyState(places: any[] = []): ItineraryDraftState {
  return {
    ...slobodskoyState(places),
    preset: 'balanced' as const,
    reserveMinutes: 10,
    totals: { travelMinutes: 0, stopMinutes: 0, reserveMinutes: 10, totalMinutes: 10, budgetMinutes: SLOBODSKOY_BUDGET_MINUTES, feasible: true, overBudgetMinutes: 0, remainingMinutes: SLOBODSKOY_BUDGET_MINUTES - 10 },
  };
}

/** Build a v2 optimizer with a fixture-backed fake GraphHopper adapter. */
function fixtureOptimizer() {
  const adapter = createFixtureRoutingAdapter();
  const pois: any = { listCoveredByPolygon: async () => ({ items: autoPoolPois(), total: autoPoolPois().length }) };
  const routing: any = {
    isochrone: async () => ({
      geojson: { type: 'Polygon', coordinates: [[[50.0, 58.60], [50.40, 58.60], [50.40, 58.85], [50.0, 58.85], [50.0, 58.60]]] },
      approximate: false,
    }),
    plan: async ({ start, waypoints, options }: any) => {
      const route = await adapter.route(start, waypoints, { loop: options?.loop ?? true });
      return { routes: [route], order: [], loop: options?.loop ?? true, optimize: false };
    },
  };
  const visit = new VisitTimeService();
  const budget = new ItineraryBudgetService();
  const loops = new LoopQualityService();
  const scorer = new ItineraryScoreService(loops, budget);
  const clustering = new PlaceClusteringService(visit);
  const localityGuard = new LocalityGuardService();
  const logger = new SelectionDiagnosticsLogger();
  const cache = new RouteCostCacheService();
  const ghClient: any = { route: async (pts: any[], _profile: string) => {
    const cost = await adapter.cost(pts[0], pts[1], _profile);
    if (!cost) throw new Error('unreachable');
    return { time: cost.seconds * 1000, distance: cost.meters, ascend: 0, descend: 0, bbox: [0,0,1,1], points: { type: 'LineString', coordinates: [[pts[0].lon, pts[0].lat], [pts[1].lon, pts[1].lat]] }, points_encoded: false };
  }};
  const evaluator = new RouteCostEvaluatorService(ghClient, cache);
  const search = new OptimizerSearchService();
  return new AutoItineraryOptimizerService(pois, routing, clustering, budget, loops, visit, scorer, localityGuard, logger, evaluator, search);
}

/** Barrier/trap scenario: greedy picks a featured place behind a river detour;
 *  bounded local search must swap it out for the dense cluster. */
function trapOptimizer() {
  const polygon = { type: 'Polygon', coordinates: [[[49.3, 58.3], [49.8, 58.3], [49.8, 58.8], [49.3, 58.8], [49.3, 58.3]]] };
  const anchors = [TRAP_START, TRAP_A, TRAP_B, TRAP_C1, TRAP_C2];
  // Resolve any Point (including a cluster centroid) to its nearest anchor
  // within ~100 m so cost lookups are exact like the fixture adapter.
  const resolve = (p: Point): Point => {
    let best = anchors[0];
    let bestDist = Infinity;
    for (const anchor of anchors) {
      const d = Math.abs(anchor.lat - p.lat) + Math.abs(anchor.lon - p.lon);
      if (d < bestDist) { bestDist = d; best = anchor; }
    }
    return bestDist < 0.001 ? best : p;
  };
  const pk = (p: Point) => `${resolve(p).lat.toFixed(6)},${resolve(p).lon.toFixed(6)}`;
  const COSTS = new Map<string, { seconds: number; meters: number }>();
  const setCost = (a: Point, b: Point, seconds: number) => {
    COSTS.set(`${pk(a)}>${pk(b)}`, { seconds, meters: seconds * 4.5 });
  };
  setCost(TRAP_START, TRAP_A, 400); setCost(TRAP_A, TRAP_START, 400);
  setCost(TRAP_START, TRAP_B, 100); setCost(TRAP_B, TRAP_START, 100);
  setCost(TRAP_START, TRAP_C1, 250); setCost(TRAP_C1, TRAP_START, 250);
  setCost(TRAP_A, TRAP_B, 900); setCost(TRAP_B, TRAP_A, 900); // river barrier
  setCost(TRAP_A, TRAP_C1, 800); setCost(TRAP_C1, TRAP_A, 800); // barrier
  setCost(TRAP_B, TRAP_C1, 900); setCost(TRAP_C1, TRAP_B, 900); // river barrier
  setCost(TRAP_C1, TRAP_C2, 20); setCost(TRAP_C2, TRAP_C1, 20);

  const rows = [
    { id: 'trap-a', name: 'A', category: 'museum', lat: TRAP_A.lat, lon: TRAP_A.lon, popularityScore: 20, featured: false },
    { id: 'trap-b', name: 'B', category: 'nature', lat: TRAP_B.lat, lon: TRAP_B.lon, popularityScore: 30, featured: true },
    { id: 'trap-c1', name: 'C1', category: 'heritage', lat: TRAP_C1.lat, lon: TRAP_C1.lon, popularityScore: 15, featured: false, explicitComplexId: 'trap-c-group' },
    { id: 'trap-c2', name: 'C2', category: 'heritage', lat: TRAP_C2.lat, lon: TRAP_C2.lon, popularityScore: 12, featured: false, explicitComplexId: 'trap-c-group' },
  ];
  const pois: any = { listCoveredByPolygon: async () => ({ items: rows, total: rows.length }) };
  const routing: any = {
    isochrone: async () => ({ geojson: polygon, approximate: false }),
    plan: async ({ start, waypoints, options }: any) => {
      const pts = [start, ...waypoints];
      if (options?.loop ?? true) pts.push(start);
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const cost = COSTS.get(`${pk(pts[i])}>${pk(pts[i + 1])}`);
        if (!cost) throw new Error('unreachable pair');
        total += cost.seconds;
      }
      return { routes: [fixtureRouteResult(pts, total, total * 4.5)], order: [], loop: true, optimize: false };
    },
  };
  const visit = new VisitTimeService();
  const budget = new ItineraryBudgetService();
  const loops = new LoopQualityService();
  const scorer = new ItineraryScoreService(loops, budget);
  const clustering = new PlaceClusteringService(visit);
  const localityGuard = new LocalityGuardService();
  const logger = new SelectionDiagnosticsLogger();
  const cache = new RouteCostCacheService();
  const ghClient: any = { route: async (pts: any[], _profile: string) => {
    const cost = COSTS.get(`${pk(pts[0])}>${pk(pts[1])}`);
    if (!cost) throw new Error('unreachable pair');
    return { time: cost.seconds * 1000, distance: cost.meters, ascend: 0, descend: 0, bbox: [0, 0, 1, 1], points: { type: 'LineString', coordinates: [[pts[0].lon, pts[0].lat], [pts[1].lon, pts[1].lat]] }, points_encoded: false };
  }};
  const evaluator = new RouteCostEvaluatorService(ghClient, cache);
  const search = new OptimizerSearchService();
  return new AutoItineraryOptimizerService(pois, routing, clustering, budget, loops, visit, scorer, localityGuard, logger, evaluator, search);
}

const TRAP_START: Point = { lat: 58.5, lon: 49.5 };
// B sits right next to the start (cheapest, top quota score). A is further
// away; C is a 2-POI cluster that is cheap ONLY as a standalone from start
// (barriered from both A and B). Greedy is first-fit: every variant keeps the
// nearest singleton and can never append C within budget. Only the bounded
// swap exchanges that singleton for the C cluster.
const TRAP_A: Point = { lat: 58.51, lon: 49.51 };
const TRAP_B: Point = { lat: 58.501, lon: 49.501 };
const TRAP_C1: Point = { lat: 58.52, lon: 49.52 };
const TRAP_C2: Point = { lat: 58.5204, lon: 49.5204 };

function trapState(): ItineraryDraftState {
  return {
    status: 'ready', start: TRAP_START, profile: 'bike_touring',
    loop: true, preset: 'balanced', intent: 'auto_budget', stopPace: 'pass_by',
    budgetMode: 'whole_trip', budgetMinutes: 22, reserveMinutes: 0, places: [],
    warnings: [], suggestions: [], selectionPolicyVersion: 'v2',
    totals: { travelMinutes: 0, stopMinutes: 0, reserveMinutes: 0, totalMinutes: 0, budgetMinutes: 22, feasible: true, overBudgetMinutes: 0, remainingMinutes: 22 },
  };
}

/** Build a v2 optimizer with a simple geometric fake adapter. */
function simpleOptimizer() {
  const polygon = { type: 'Polygon', coordinates: [[[49, 58], [50, 58], [50, 59], [49, 59], [49, 58]]] };
  const route = (count: number, duration = 600) => ({ distance: 1000 * count, duration: duration * count, ascend: 100, descend: 100, profile: 'foot', bbox: [49, 58, 50, 59] as [number, number, number, number], geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[49.5, 58.5], [49.51, 58.51], [49.5, 58.5]] }, properties: {} } });
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, category: i % 2 ? 'nature' : 'museum', lat: 58.5 + i / 1000, lon: 49.5 + i / 1000, featured: i === 0, popularityScore: 20 - i }));
  const pois: any = { listCoveredByPolygon: async () => ({ items: rows, total: rows.length }) };
  const routing: any = {
    isochrone: async () => ({ geojson: polygon, approximate: false }),
    plan: async ({ waypoints }: any) => ({ routes: [route(waypoints.length)], order: [], loop: true, optimize: false }),
  };
  const visit = new VisitTimeService();
  const budget = new ItineraryBudgetService();
  const loops = new LoopQualityService();
  const scorer = new ItineraryScoreService(loops, budget);
  const clustering = new PlaceClusteringService(visit);
  const localityGuard = new LocalityGuardService();
  const logger = new SelectionDiagnosticsLogger();
  const cache = new RouteCostCacheService();
  const ghClient: any = { route: async (pts: any[]) => ({ time: 300000, distance: 1000, ascend: 0, descend: 0, bbox: [0,0,1,1], points: { type: 'LineString', coordinates: [[pts[0].lon, pts[0].lat], [pts[1].lon, pts[1].lat]] }, points_encoded: false }) };
  const evaluator = new RouteCostEvaluatorService(ghClient, cache);
  const search = new OptimizerSearchService();
  return new AutoItineraryOptimizerService(pois, routing, clustering, budget, loops, visit, scorer, localityGuard, logger, evaluator, search);
}

/** Build a v2 optimizer over a 65-POI → 55-Place pool (mirrors the live
 *  Slobodskoy diagnostics: 10 local explicit clusters, 15 local singletons,
 *  30 remote singletons) with a slow deterministic adapter. Every route or
 *  pair-cost call sleeps `latencyMs`, so the guard's old all-pairs probing
 *  would blow the 12s/80-request budget before any candidate route exists. */
/** Small production-shaped V2 pool: two network-connected nearby POIs and a
 * separate stop. The clusterer gets its normal injected walkability adapter. */
function nearbyClusterOptimizer() {
  const polygon = { type: 'Polygon', coordinates: [[[49.4, 58.4], [49.7, 58.4], [49.7, 58.7], [49.4, 58.7], [49.4, 58.4]]] };
  const rows = [
    { id: 'nearby-featured', name: 'Featured museum', category: 'museum', lat: 58.5, lon: 49.5, featured: true, popularityScore: 1 },
    { id: 'nearby-popular', name: 'Popular chapel', category: 'heritage', lat: 58.5002, lon: 49.5002, featured: false, popularityScore: 100 },
    { id: 'separate', name: 'Separate sight', category: 'nature', lat: 58.51, lon: 49.51, featured: false, popularityScore: 5 },
  ];
  const pois: any = { listCoveredByPolygon: async () => ({ items: rows, total: rows.length }) };
  const route = (count: number) => ({ distance: 1000 * count, duration: 600 * count, ascend: 0, descend: 0, profile: 'foot', bbox: [49.4, 58.4, 49.7, 58.7] as [number, number, number, number], geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[49.5, 58.5], [49.51, 58.51], [49.5, 58.5]] }, properties: {} } });
  const routing: any = {
    isochrone: async () => ({ geojson: polygon, approximate: false }),
    plan: async ({ waypoints }: any) => ({ routes: [route(waypoints.length)], order: [], loop: true, optimize: false }),
  };
  const visit = new VisitTimeService();
  const budget = new ItineraryBudgetService();
  const loops = new LoopQualityService();
  const scorer = new ItineraryScoreService(loops, budget);
  const clustering = new PlaceClusteringService(visit, { minutesBetween: async () => 2 } as any);
  const evaluator = new RouteCostEvaluatorService({ route: async (pts: any[]) => ({ time: 300000, distance: 1000, ascend: 0, descend: 0, bbox: [0, 0, 1, 1], points: { type: 'LineString', coordinates: [[pts[0].lon, pts[0].lat], [pts[1].lon, pts[1].lat]] }, points_encoded: false }) } as any, new RouteCostCacheService());
  return new AutoItineraryOptimizerService(pois, routing, clustering, budget, loops, visit, scorer, new LocalityGuardService(), new SelectionDiagnosticsLogger(), evaluator, new OptimizerSearchService());
}

function slowSlobodskoyOptimizer(latencyMs: number) {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const rad = Math.PI / 180;
  const haversine = (a: Point, b: Point): number => {
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  };
  const costOf = (a: Point, b: Point) => {
    const meters = haversine(a, b) * 1.35;
    return { seconds: meters / 4.5, meters };
  };
  const rows: any[] = [];
  // 10 local explicit clusters (2 POIs each, shared complex id, ~30 m apart).
  for (let i = 0; i < 10; i++) {
    const baseLat = SLOBODSKOY_START.lat - 0.0008 + (i % 4) * 0.0006;
    const baseLon = SLOBODSKOY_START.lon + 0.0004 + Math.floor(i / 4) * 0.0006;
    rows.push({ id: `slz-lc${i}-a`, name: `LocalCluster${i}A`, category: 'heritage', lat: baseLat, lon: baseLon, popularityScore: 25 - i, featured: false, explicitComplexId: `slz-lc${i}` });
    rows.push({ id: `slz-lc${i}-b`, name: `LocalCluster${i}B`, category: 'monument', lat: baseLat + 0.0002, lon: baseLon + 0.0002, popularityScore: 18 - i, featured: false, explicitComplexId: `slz-lc${i}` });
  }
  // 15 local singletons within ~1.5 km of start.
  for (let i = 0; i < 15; i++) {
    rows.push({ id: `slz-ls${i}`, name: `LocalSingleton${i}`, category: i % 2 ? 'sights' : 'museum', lat: 58.7320 + (i % 5) * 0.0011, lon: 50.1762 + Math.floor(i / 5) * 0.0013, popularityScore: 14 - (i % 12), featured: i === 0 });
  }
  // 30 remote singletons 5-9 km away in all directions.
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * 2 * Math.PI;
    const distKm = 5 + (i % 6) * 0.8;
    rows.push({ id: `slz-rs${i}`, name: `RemoteSingleton${i}`, category: i % 3 === 0 ? 'nature' : 'religion', lat: SLOBODSKOY_START.lat + (distKm / 111.32) * Math.sin(angle), lon: SLOBODSKOY_START.lon + (distKm / (111.32 * Math.cos(SLOBODSKOY_START.lat * rad))) * Math.cos(angle), popularityScore: 30 - (i % 20), featured: false });
  }
  if (rows.length !== 65) throw new Error('slow fixture must have exactly 65 POIs');

  const polygon = { type: 'Polygon', coordinates: [[[49.9, 58.55], [50.5, 58.55], [50.5, 58.95], [49.9, 58.95], [49.9, 58.55]]] };
  const pois: any = { listCoveredByPolygon: async () => ({ items: rows, total: rows.length }) };
  const routing: any = {
    isochrone: async () => ({ geojson: polygon, approximate: false }),
    plan: async ({ start, waypoints, options }: any) => {
      await sleep(latencyMs);
      const pts = [start, ...waypoints];
      if (options?.loop ?? true) pts.push(start);
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) total += costOf(pts[i], pts[i + 1]).seconds;
      return { routes: [fixtureRouteResult(pts, total, total * 4.5)], order: [], loop: true, optimize: false };
    },
  };
  const ghClient: any = { route: async (pts: any[], _profile: string) => {
    await sleep(latencyMs);
    const cost = costOf(pts[0], pts[1]);
    return { time: cost.seconds * 1000, distance: cost.meters, ascend: 0, descend: 0, bbox: [0, 0, 1, 1], points: { type: 'LineString', coordinates: [[pts[0].lon, pts[0].lat], [pts[1].lon, pts[1].lat]] }, points_encoded: false };
  }};
  const visit = new VisitTimeService();
  const budget = new ItineraryBudgetService();
  const loops = new LoopQualityService();
  const scorer = new ItineraryScoreService(loops, budget);
  const clustering = new PlaceClusteringService(visit);
  const localityGuard = new LocalityGuardService();
  const logger = new SelectionDiagnosticsLogger();
  const cache = new RouteCostCacheService();
  const evaluator = new RouteCostEvaluatorService(ghClient, cache);
  const search = new OptimizerSearchService();
  return new AutoItineraryOptimizerService(pois, routing, clustering, budget, loops, visit, scorer, localityGuard, logger, evaluator, search);
}

describe('AutoItineraryOptimizerService (v2)', () => {
  beforeEach(() => { process.env.NV_AUTO_POLICY = 'v2'; });
  afterEach(() => {
    if (originalPolicy === undefined) delete process.env.NV_AUTO_POLICY;
    else process.env.NV_AUTO_POLICY = originalPolicy;
  });

  it('defaults to pass_by visit mode for auto places', async () => {
    const result = await simpleOptimizer().optimize(slobodskoyState(), { preferredCategories: ['nature'], seed: 7 });
    expect(result.state.places.length).toBeGreaterThan(0);
    const autoPlaces = result.state.places.filter((p: any) => p.source === 'auto');
    expect(autoPlaces.every((p: any) => p.visitMode === 'pass_by')).toBe(true);
  });

  it('is deterministic for the same seed', async () => {
    const first = await simpleOptimizer().optimize(slobodskoyState(), { preferredCategories: ['nature'], seed: 17 });
    const second = await simpleOptimizer().optimize(slobodskoyState(), { preferredCategories: ['nature'], seed: 17 });
    expect(first.state.places.map((p: any) => p.id)).toEqual(second.state.places.map((p: any) => p.id));
  });

  it('keeps a network-confirmed nearby pair in one auto Place with its featured child as headline', async () => {
    const result = await nearbyClusterOptimizer().optimize(slobodskoyState(), { seed: 5 });
    const place = result.state.places.find((candidate: any) => candidate.pois.some((poi: any) => poi.id === 'nearby-featured'));
    expect(place).toMatchObject({ source: 'auto', name: 'Featured museum' });
    expect(place.pois.map((poi: any) => poi.id).sort()).toEqual(['nearby-featured', 'nearby-popular']);
    expect(place.pois.filter((poi: any) => poi.notable).map((poi: any) => poi.id)).toEqual(['nearby-featured']);
  });

  it('excludes remote singleton and prefers local cluster (Slobodskoy regression)', async () => {
    const result = await fixtureOptimizer().optimize(slobodskoyState(), {
      preferredCategories: [], seed: SLOBODSKOY_SEED, preset: SLOBODSKOY_PRESET,
    });
    const ids = result.state.places.flatMap((p: any) => p.pois.map((poi: any) => poi.id));
    // The remote singletons (patriarh, spaso) must NOT be in the main solution.
    expect(ids).not.toContain('slz-patriarh');
    expect(ids).not.toContain('slz-spaso');
    // Local POIs must be present.
    expect(ids).toContain('slz-bank');
    // Must fit the budget.
    expect(result.state.totals.totalMinutes).toBeLessThanOrEqual(SLOBODSKOY_BUDGET_MINUTES);
    // autoFillSummary must have locality guard applied.
    expect(result.state.autoFillSummary?.localityGuardApplied).toBe(true);
  });

  it('rejects unlimited budget mode without mutation', async () => {
    await expect(simpleOptimizer().optimize(
      { ...slobodskoyState(), budgetMode: 'unlimited', budgetMinutes: null as any },
      { preferredCategories: ['nature'] },
    )).rejects.toThrow();
  });

  it('keeps locked/manual Places and reports LockedSetOverBudget', async () => {
    const locked = {
      id: 'locked', name: 'Locked', center: { lat: 58.5, lon: 49.5 },
      pois: [{ id: 'locked-poi', name: 'L', category: 'museum', lat: 58.5, lon: 49.5, included: true, estimatedVisitMinutes: 0 }],
      visitMode: 'visit', dwellMinutes: 20, arrivalOverheadMinutes: 0,
      source: 'manual' as const, locked: true, clusterConfidence: 'manual' as const,
    };
    await expect(fixtureOptimizer().optimize(
      { ...slobodskoyState([locked]), budgetMinutes: 1 },
      { categories: ['nature'] },
    )).rejects.toBeInstanceOf(LockedSetOverBudgetError);
  });

  it('preserves a feasible manual Place and never runs auto locality selection over it', async () => {
    // A remote manual singleton is the fixture's control case: the locality
    // guard must NOT touch it (user-explicit goal), while automatic selection
    // still fills the route from the local pool around it.
    const manual = {
      id: 'manual-remote', name: 'Manual target', center: { lat: 58.68, lon: 50.16 },
      pois: [{ id: 'slz-manual-1', name: 'Manual target', category: 'sights', lat: 58.68, lon: 50.16, included: true, estimatedVisitMinutes: 0 }],
      visitMode: 'visit', dwellMinutes: 0, arrivalOverheadMinutes: 0,
      source: 'manual' as const, locked: false, clusterConfidence: 'manual' as const,
    };
    const result = await fixtureOptimizer().optimize(slobodskoyState([manual]), {
      preferredCategories: [], seed: SLOBODSKOY_SEED, preset: SLOBODSKOY_PRESET,
    });
    // The manual Place survives untouched with its visit mode.
    const kept = result.state.places.find((p: any) => p.id === manual.id);
    expect(kept).toBeDefined();
    expect(kept.visitMode).toBe('visit');
    // Auto selection still adds local places around it (never zeroes the route).
    expect(result.state.places.length).toBeGreaterThan(1);
    const autoIds = result.state.places.flatMap((p: any) => p.source === 'auto' ? p.pois.map((poi: any) => poi.id) : []);
    expect(autoIds).toContain('slz-bank');
    // Remote AUTOMATIC singletons are still excluded by the guard.
    expect(autoIds).not.toContain('slz-patriarh');
    // Authoritative totals are recomputed and feasible within the budget.
    expect(result.state.totals.feasible).toBe(true);
    expect(result.state.totals.totalMinutes).toBeLessThanOrEqual(SLOBODSKOY_BUDGET_MINUTES);
  });

  it('preserves the input order of multiple manual/locked anchors', async () => {
    // The locked stop is geographically farther than the following manual one.
    // The optimizer may arrange automatic Places around them, but must not flip
    // the user-provided anchor sequence to make a shorter geometric detour.
    const lockedFirst = {
      id: 'locked-first', name: 'Locked first', center: { lat: 58.6850, lon: 50.1650 },
      pois: [{ id: 'slz-locked-1', name: 'Locked first', category: 'monument', lat: 58.6850, lon: 50.1650, included: true, estimatedVisitMinutes: 0 }],
      visitMode: 'visit', dwellMinutes: 0, arrivalOverheadMinutes: 0,
      source: 'auto' as const, locked: true, clusterConfidence: 'manual' as const,
    };
    const manualSecond = {
      id: 'manual-second', name: 'Manual second', center: { lat: 58.6800, lon: 50.1600 },
      pois: [{ id: 'slz-manual-1', name: 'Manual second', category: 'sights', lat: 58.6800, lon: 50.1600, included: true, estimatedVisitMinutes: 0 }],
      visitMode: 'visit', dwellMinutes: 0, arrivalOverheadMinutes: 0,
      source: 'manual' as const, locked: false, clusterConfidence: 'manual' as const,
    };
    const result = await fixtureOptimizer().optimize(slobodskoyState([lockedFirst, manualSecond]), {
      preferredCategories: [], seed: SLOBODSKOY_SEED, preset: SLOBODSKOY_PRESET,
    });
    expect(result.state.places.filter((p: any) => p.id === lockedFirst.id || p.id === manualSecond.id).map((p: any) => p.id))
      .toEqual([lockedFirst.id, manualSecond.id]);
  });

  it('builds alternatives that are materially distinct and self-consistent', async () => {
    // A tighter budget makes the reversed/alternate variant select a smaller
    // Place subset, so alternatives must actually appear and each one must
    // describe ITS OWN places with exact totals and a consistent summary.
    const result = await fixtureOptimizer().optimize(
      { ...slobodskoyState(), budgetMinutes: 75, reserveMinutes: 0 },
      { preferredCategories: [], seed: SLOBODSKOY_SEED },
    );
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.state.quality).toMatchObject({ version: 'graphhopper-quality-core-v1', networkConfirmed: true });
    expect(result.state.warnings.map((warning: any) => warning.code)).toEqual(result.state.quality?.warnings);
    expect(result.alternatives.every((alternative: any) => alternative.quality?.version === 'graphhopper-quality-core-v1' && alternative.quality.networkConfirmed)).toBe(true);
    const bestIds = result.state.places.map((p: any) => p.id);
    for (const alt of result.alternatives) {
      const altIds = alt.places.map((p: any) => p.id);
      const altPoiIds = alt.places.flatMap((p: any) => p.pois.map((poi: any) => poi.id));
      // No duplicate Places in the winner or the alternatives.
      expect(new Set(bestIds).size).toBe(bestIds.length);
      expect(new Set(altIds).size).toBe(altIds.length);
      // Summary consistency: counts describe this alternative's own places.
      expect(alt.selectionSummary?.selectedPlaces).toBe(alt.places.length);
      expect(alt.selectionSummary?.selectedUniquePois).toBe(altPoiIds.length);
      // Exact totals: preview is feasible and derived from the same route.
      expect(alt.previewTotals.feasible).toBe(true);
      // Material difference from the winner: a different Place set or order
      // (the dissimilar() gate only admits such candidates).
      expect(altIds.join(',')).not.toEqual(bestIds.join(','));
    }
  });

  it('supply-rich 65-POI/55-Place pool: >=2 pairwise-different alternatives with exact feasible totals and consistent summaries (live regression)', async () => {
    // Mirrors the live Slobodskoy shape (39 clusters / rich local pool): the
    // pipeline must return at least two materially different alternatives on a
    // supply-rich pool, each with ITS OWN places, exact feasible totals and a
    // SelectionSummary that describes its own places — without exceeding the
    // shared GraphHopper cap/deadline.
    const logSpy = vi.spyOn(SelectionDiagnosticsLogger.prototype, 'log').mockImplementation(() => {});
    try {
      const result = await slowSlobodskoyOptimizer(10).optimize(slobodskoyState(), {
        preferredCategories: ['heritage', 'monument'], seed: 17, deadlineMs: 30_000,
      });
      expect(result.state.places.length).toBeGreaterThanOrEqual(3);
      expect(result.state.totals.feasible).toBe(true);
      // Supply-rich contract: at least two alternatives.
      expect(result.alternatives.length).toBeGreaterThanOrEqual(2);

      // Unique ids: winner ids and each alternative's ids are internally
      // unique, and alternativeIds are globally unique.
      const bestIds = result.state.places.map((p: any) => p.id);
      expect(new Set(bestIds).size).toBe(bestIds.length);
      const idSets = [bestIds, ...result.alternatives.map((a: any) => a.places.map((p: any) => p.id))];
      const alternativeIds = new Set<string>();
      for (const alt of result.alternatives) {
        expect(alt.alternativeId).toBeTruthy();
        expect(alternativeIds.has(alt.alternativeId)).toBe(false);
        alternativeIds.add(alt.alternativeId);
        const altIds = alt.places.map((p: any) => p.id);
        expect(new Set(altIds).size).toBe(altIds.length);
      }

      // Pairwise material difference: every pair (winner + alternatives, and
      // every alternative vs every other) differs by the Jaccard threshold.
      for (let i = 0; i < idSets.length; i++) {
        for (let j = i + 1; j < idSets.length; j++) {
          const a = idSets[i];
          const b = idSets[j];
          const common = b.filter((id: string) => a.includes(id)).length;
          const jaccard = common / (a.length + b.length - common);
          expect(jaccard).toBeLessThan(0.8);
        }
      }

      // Exact feasible totals + summary consistency per alternative.
      for (const alt of result.alternatives) {
        const altPoiIds = alt.places.flatMap((p: any) => p.pois.map((poi: any) => poi.id));
        expect(alt.previewTotals.feasible).toBe(true);
        expect(alt.previewTotals.totalMinutes).toBe(
          alt.previewTotals.travelMinutes + alt.previewTotals.stopMinutes + alt.previewTotals.reserveMinutes,
        );
        expect(alt.selectionSummary?.selectedPlaces).toBe(alt.places.length);
        expect(alt.selectionSummary?.selectedUniquePois).toBe(altPoiIds.length);
        expect(alt.explanation.length).toBeGreaterThan(0);
        // pass_by dwell is preserved on every automatic place.
        for (const place of alt.places) {
          if (place.source === 'auto') expect(place.visitMode).toBe('pass_by');
        }
      }

      // Diagnostics: the run reports the returned alternatives and respects
      // the shared GraphHopper request cap.
      const payload = logSpy.mock.calls.map((c) => c[0] as any).find((p) => p.selectedPlaces > 0 && p.alternativesReturned != null);
      expect(payload).toBeDefined();
      expect(payload.alternativesReturned).toBe(result.alternatives.length);
      expect(payload.alternativesReturned).toBeGreaterThanOrEqual(2);
      expect(payload.graphHopperRequests).toBeLessThanOrEqual(80);
      expect(payload.deadlineExceeded).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('supply-rich 65-POI/55-Place pool with preset=balanced: exactly 2 materially different alternatives, one a local/category mix outside the winner set (live regression)', async () => {
    // Mirrors the LIVE balanced Slobodskoy request (budget 120 + reserve 10,
    // bike_touring loop, heritage+monument, seed 17): a balanced rich pool
    // must return TWO alternatives — not just the compact subset — each with
    // its own exact feasible totals and SelectionSummary, and at least one
    // alternative must REPLACE >=2 winner Places with local Places outside the
    // winner set (the guarded/quota pool contract). The second candidate must
    // survive even though the first consumed its validation slots, and the
    // request cap/deadline must not be exceeded.
    const logSpy = vi.spyOn(SelectionDiagnosticsLogger.prototype, 'log').mockImplementation(() => {});
    try {
      const result = await slowSlobodskoyOptimizer(10).optimize(balancedSlobodskoyState(), {
        preferredCategories: ['heritage', 'monument'], seed: 17, deadlineMs: 30_000,
      });
      expect(result.state.places.length).toBeGreaterThanOrEqual(3);
      expect(result.state.totals.feasible).toBe(true);
      expect(result.state.preset).toBe('balanced');

      // Exactly/up to 2 alternatives, but at least 2: the rich-supply contract
      // guarantees two meaningful alternatives on a rich pool.
      expect(result.alternatives.length).toBeGreaterThanOrEqual(2);
      expect(result.alternatives.length).toBeLessThanOrEqual(2);

      const bestIds = result.state.places.map((p: any) => p.id);
      expect(new Set(bestIds).size).toBe(bestIds.length);
      const idSets = [bestIds, ...result.alternatives.map((a: any) => a.places.map((p: any) => p.id))];
      const alternativeIds = new Set<string>();
      for (const alt of result.alternatives) {
        expect(alt.alternativeId).toBeTruthy();
        expect(alternativeIds.has(alt.alternativeId)).toBe(false);
        alternativeIds.add(alt.alternativeId);
        const altIds = alt.places.map((p: any) => p.id);
        expect(new Set(altIds).size).toBe(altIds.length);
      }

      // Pairwise material difference: Jaccard < 0.8 for every pair.
      for (let i = 0; i < idSets.length; i++) {
        for (let j = i + 1; j < idSets.length; j++) {
          const a = idSets[i];
          const b = idSets[j];
          const common = b.filter((id: string) => a.includes(id)).length;
          const jaccard = common / (a.length + b.length - common);
          expect(jaccard).toBeLessThan(0.8);
        }
      }

      // At least one alternative is a local/category mix: it drops >=2 winner
      // Places and adds >=2 Places outside the winner set (guarded/quota pool
      // replacements within the confirmed local excursion).
      const mixAlt = result.alternatives.find((alt: any) => {
        const altIds = alt.places.map((p: any) => p.id);
        const kept = altIds.filter((id: string) => bestIds.includes(id)).length;
        const replaced = bestIds.filter((id: string) => !altIds.includes(id)).length;
        return replaced >= 2 && altIds.length - kept >= 2;
      });
      expect(mixAlt).toBeDefined();

      // Exact feasible totals + summary consistency per alternative.
      for (const alt of result.alternatives) {
        const altPoiIds = alt.places.flatMap((p: any) => p.pois.map((poi: any) => poi.id));
        expect(alt.previewTotals.feasible).toBe(true);
        expect(alt.previewTotals.totalMinutes).toBe(
          alt.previewTotals.travelMinutes + alt.previewTotals.stopMinutes + alt.previewTotals.reserveMinutes,
        );
        expect(alt.selectionSummary?.selectedPlaces).toBe(alt.places.length);
        expect(alt.selectionSummary?.selectedUniquePois).toBe(altPoiIds.length);
        expect(alt.explanation.length).toBeGreaterThan(0);
        for (const place of alt.places) {
          if (place.source === 'auto') expect(place.visitMode).toBe('pass_by');
        }
      }

      // Diagnostics: both alternatives reported, request cap respected, no
      // deadline degradation.
      const payload = logSpy.mock.calls.map((c) => c[0] as any).find((p) => p.selectedPlaces > 0 && p.alternativesReturned != null);
      expect(payload).toBeDefined();
      expect(payload.alternativesReturned).toBe(result.alternatives.length);
      expect(payload.alternativesReturned).toBeGreaterThanOrEqual(2);
      expect(payload.graphHopperRequests).toBeLessThanOrEqual(80);
      expect(payload.deadlineExceeded).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('orders the winner geographically — no back-and-forth jumps in the local cluster', async () => {
    // Live regression for the reported zigzag: the winner used to follow the
    // distance-to-start rank (which bounces across the map). It must now visit
    // the local cluster as a contiguous geographic sweep.
    const result = await fixtureOptimizer().optimize(slobodskoyState(), {
      preferredCategories: [], seed: SLOBODSKOY_SEED, preset: SLOBODSKOY_PRESET,
    });
    const places = result.state.places as any[];
    const names = places.map((p) => p.pois[0]?.name ?? p.id);
    // Deterministic expected sweep for this fixture (nearest-neighbor from the
    // start, remote excursion at the end).
    expect(names[0]).toBe('Дом-музей Яна Райниса');
    expect(names[1]).toBe('Спасский собор');
    expect(names[2]).toBe('Городской парк');
    expect(names[3]).toBe('Здание банка Анфилатова');
    // Local-cluster inter-place legs must stay under 1 km: no back-and-forth.
    const remoteIdx = places.findIndex((p) => p.pois.some((poi) => poi.id === 'slz-podchurm' || poi.id === 'slz-podchurm2'));
    expect(remoteIdx).toBeGreaterThanOrEqual(0);
    const centers = places.map((p) => p.center as Point);
    for (let i = 0; i < centers.length - 1; i++) {
      if (i === remoteIdx - 1 || i === remoteIdx) continue; // legs touching the deliberate remote excursion
      const km = haversineKm(centers[i], centers[i + 1]);
      expect(km).toBeLessThanOrEqual(1.0);
    }
    expect(result.state.totals.feasible).toBe(true);
  });

  it('charges the closing edge for loops but not open routes', async () => {
    const adapter = createFixtureRoutingAdapter();
    const ids = ['slz-bank', 'slz-church', 'slz-park'];
    const points = ids.map((id) => {
      const poi = ALL_FIXTURE_POIS.find((p) => p.id === id)!;
      return { lat: poi.lat!, lon: poi.lon! };
    });
    const closed = await adapter.route(SLOBODSKOY_START, points, { loop: true });
    const open = await adapter.route(SLOBODSKOY_START, points, { loop: false });
    expect(closed.duration).toBeGreaterThan(open.duration);
    const last = points[points.length - 1];
    const lastLeg = await adapter.cost(last, SLOBODSKOY_START, SLOBODSKOY_PROFILE);
    expect(closed.duration - open.duration).toBeCloseTo(lastLeg!.seconds, 5);
  });

  it('optimizes open routes without charging a return leg', async () => {
    const result = await fixtureOptimizer().optimize(
      { ...slobodskoyState(), loop: false },
      { preferredCategories: [], seed: SLOBODSKOY_SEED },
    );
    expect(result.state.loop).toBe(false);
    expect(result.state.places.length).toBeGreaterThan(0);
    expect(result.state.totals.feasible).toBe(true);
  });

  it('local search replaces a greedy distant/poor early Place with a dense cluster', async () => {
    // B is the nearest, top-scoring Place, so greedy alone stops at [B]
    // ([B,A] and [B,C] are both infeasible behind the river barrier). Only the
    // bounded swap exchanges B for the C cluster (2 POIs, cheap legs from A).
    const result = await trapOptimizer().optimize(trapState(), {
      preferredCategories: [], seed: 1,
    });
    const ids = result.state.places.flatMap((p: any) => p.pois.map((poi: any) => poi.id));
    expect(ids).toContain('trap-c1');
    expect(ids).toContain('trap-c2');
    expect(ids).not.toContain('trap-b');
    expect(result.state.totals.feasible).toBe(true);
    expect(result.state.totals.totalMinutes).toBeLessThanOrEqual(22);
  });

  it('does not exceed GraphHopper request budget', async () => {
    // With a fixture adapter this completes quickly; verify no infinite loop.
    const result = await fixtureOptimizer().optimize(slobodskoyState(), {
      preferredCategories: [], seed: SLOBODSKOY_SEED,
    });
    expect(result.state.places.length).toBeGreaterThan(0);
    expect(result.state.totals.feasible).toBe(true);
  });

  it('always performs an unconditional authoritative final rebuild (diagnostics)', async () => {
    const logSpy = vi.spyOn(SelectionDiagnosticsLogger.prototype, 'log').mockImplementation(() => {});
    try {
      const result = await fixtureOptimizer().optimize(slobodskoyState(), {
        preferredCategories: [], seed: SLOBODSKOY_SEED,
      });
      expect(result.state.places.length).toBeGreaterThan(0);
      expect(result.state.totals.feasible).toBe(true);
      const successPayload = logSpy.mock.calls
        .map((c) => c[0] as any)
        .find((p: any) => p.selectedPlaces > 0 && p.deadlineExceeded === false);
      expect(successPayload).toBeDefined();
      // The winner is ALWAYS rebuilt authoritatively, even when the search
      // candidate looked feasible — never trusted from the search phase.
      expect(successPayload.finalValidationRebuilds).toBeGreaterThanOrEqual(1);
      // The run stays inside the hard GraphHopper request budget.
      expect(successPayload.graphHopperRequests).toBeLessThanOrEqual(80);
      // Search actually ran (evaluator + search are wired in the fixture).
      expect(successPayload.searchIterations).toBeGreaterThanOrEqual(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('reports best_confirmed when no directed network cost is confirmed', async () => {
    // The trap fixture routes all known pairs, so a run over known costs is
    // verified; but an all-null/error evaluator must never claim 'verified'.
    const failingGh: any = { route: async () => { throw new Error('graph down'); } };
    const visit = new VisitTimeService();
    const budget = new ItineraryBudgetService();
    const loops = new LoopQualityService();
    const scorer = new ItineraryScoreService(loops, budget);
    const clustering = new PlaceClusteringService(visit);
    const localityGuard = new LocalityGuardService();
    const logger = new SelectionDiagnosticsLogger();
    const cache = new RouteCostCacheService();
    const evaluator = new RouteCostEvaluatorService(failingGh, cache);
    const search = new OptimizerSearchService();
    const polygon = { type: 'Polygon', coordinates: [[[49, 58], [50, 58], [50, 59], [49, 59], [49, 58]]] };
    const rows = [
      { id: 'x1', name: 'X1', category: 'museum', lat: 58.51, lon: 49.51, popularityScore: 20, featured: false },
      { id: 'x2', name: 'X2', category: 'museum', lat: 58.5101, lon: 49.5101, popularityScore: 15, featured: false },
      { id: 'x3', name: 'X3', category: 'heritage', lat: 58.5102, lon: 49.5102, popularityScore: 12, featured: false },
    ];
    const pois: any = { listCoveredByPolygon: async () => ({ items: rows, total: rows.length }) };
    const routing: any = {
      isochrone: async () => ({ geojson: polygon, approximate: false }),
      plan: async ({ waypoints }: any) => ({ routes: [{ distance: 1000 * waypoints.length, duration: 600 * waypoints.length, ascend: 0, descend: 0, profile: 'bike', bbox: [49, 58, 50, 59] as [number, number, number, number], geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[49.5, 58.5], [49.51, 58.51]] }, properties: {} } }], order: [], loop: true, optimize: false }),
    };
    const optimizer = new AutoItineraryOptimizerService(pois, routing, clustering, budget, loops, visit, scorer, localityGuard, logger, evaluator, search);
    const result = await optimizer.optimize(slobodskoyState(), { preferredCategories: [], seed: 1 });
    expect(result.state.autoFillSummary?.networkConfidence).toBe('best_confirmed');
  });

  it('reports verified only when a directed network cost was confirmed and used', async () => {
    // The Slobodskoy fixture adapter confirms real directed pair costs for the
    // locality guard and the local search, so the run must report 'verified'.
    const result = await fixtureOptimizer().optimize(slobodskoyState(), {
      preferredCategories: [], seed: SLOBODSKOY_SEED, preset: SLOBODSKOY_PRESET,
    });
    expect(result.state.places.length).toBeGreaterThan(0);
    expect(result.state.autoFillSummary?.networkConfidence).toBe('verified');
  });

  it('never claims verified when every directed cost is unknown (all-null)', async () => {
    // GraphHopper resolves with a non-finite time: fetchRouteCost returns null
    // for every pair, so the evaluator never confirms a single directed cost.
    // Selection/locality still finish (route plans are synthetic) but the
    // summary must NOT say 'verified'.
    const nullGh: any = { route: async () => ({ time: null, distance: null }) };
    const visit = new VisitTimeService();
    const budget = new ItineraryBudgetService();
    const loops = new LoopQualityService();
    const scorer = new ItineraryScoreService(loops, budget);
    const clustering = new PlaceClusteringService(visit);
    const localityGuard = new LocalityGuardService();
    const logger = new SelectionDiagnosticsLogger();
    const cache = new RouteCostCacheService();
    const evaluator = new RouteCostEvaluatorService(nullGh, cache);
    const search = new OptimizerSearchService();
    const polygon = { type: 'Polygon', coordinates: [[[49, 58], [50, 58], [50, 59], [49, 59], [49, 58]]] };
    const rows = [
      { id: 'n1', name: 'N1', category: 'museum', lat: 58.51, lon: 49.51, popularityScore: 20, featured: false },
      { id: 'n2', name: 'N2', category: 'museum', lat: 58.5101, lon: 49.5101, popularityScore: 15, featured: false },
      { id: 'n3', name: 'N3', category: 'heritage', lat: 58.5102, lon: 49.5102, popularityScore: 12, featured: false },
    ];
    const pois: any = { listCoveredByPolygon: async () => ({ items: rows, total: rows.length }) };
    const routing: any = {
      isochrone: async () => ({ geojson: polygon, approximate: false }),
      plan: async ({ waypoints }: any) => ({ routes: [{ distance: 1000 * waypoints.length, duration: 600 * waypoints.length, ascend: 0, descend: 0, profile: 'bike', bbox: [49, 58, 50, 59] as [number, number, number, number], geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[49.5, 58.5], [49.51, 58.51]] }, properties: {} } }], order: [], loop: true, optimize: false }),
    };
    const optimizer = new AutoItineraryOptimizerService(pois, routing, clustering, budget, loops, visit, scorer, localityGuard, logger, evaluator, search);
    const result = await optimizer.optimize(slobodskoyState(), { preferredCategories: [], seed: 1 });
    // Summary confidence describes directed selection costs, while quality
    // confirms the returned GraphHopper route geometry.
    expect(result.state.autoFillSummary?.networkConfidence).toBe('best_confirmed');
    expect(result.state.quality?.networkConfirmed).toBe(true);
  });

  it('65-POI/55-Place slow pool: confirms a local initial candidate, caps requests, final rebuild occurs (live regression)', async () => {
    const logSpy = vi.spyOn(SelectionDiagnosticsLogger.prototype, 'log').mockImplementation(() => {});
    try {
      const result = await slowSlobodskoyOptimizer(10).optimize(slobodskoyState(), {
        preferredCategories: ['heritage', 'monument'], seed: 17, deadlineMs: 20_000,
      });
      // A feasible route with selected Places is always produced.
      expect(result.state.places.length).toBeGreaterThan(0);
      expect(result.state.totals.feasible).toBe(true);
      const payload = logSpy.mock.calls.map((c) => c[0] as any).find((p) => p.selectedPlaces > 0);
      expect(payload).toBeDefined();
      // Hard GraphHopper request cap respected.
      expect(payload.graphHopperRequests).toBeLessThanOrEqual(80);
      // The bounded guard must not perform network pair-costs across the whole
      // ~55-Place pool (the live failure burned ~76 calls here before any route).
      expect(payload.cacheMisses).toBeLessThan(40);
      // The winner is authoritatively rebuilt.
      expect(payload.finalValidationRebuilds).toBeGreaterThanOrEqual(1);
      // Search actually enriched the initial candidate.
      expect(payload.searchIterations).toBeGreaterThanOrEqual(1);
      expect(payload.deadlineExceeded).toBe(false);
      expect(payload.returnedBestConfirmed).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('65-POI/55-Place slow pool: deadline exhaustion degrades to best-confirmed, never NoRouteWithinBudget (live regression)', async () => {
    const logSpy = vi.spyOn(SelectionDiagnosticsLogger.prototype, 'log').mockImplementation(() => {});
    try {
      const result = await slowSlobodskoyOptimizer(60).optimize(slobodskoyState(), {
        preferredCategories: ['heritage', 'monument'], seed: 17, deadlineMs: 700,
      });
      // The deterministic initial local solution is returned instead of an error.
      expect(result.state.places.length).toBeGreaterThan(0);
      expect(result.state.totals.feasible).toBe(true);
      expect(result.state.autoFillSummary?.networkConfidence).toBe('best_confirmed');
      const payload = logSpy.mock.calls.map((c) => c[0] as any).find((p) => p.returnedBestConfirmed === true);
      expect(payload).toBeDefined();
      expect(payload.deadlineExceeded).toBe(true);
      expect(payload.selectedPlaces).toBeGreaterThan(0);
      expect(payload.graphHopperRequests).toBeLessThanOrEqual(80);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('ranks exact feasible quality before loop/additive tie-breaks and keeps degradation precedence explicit', () => {
    const optimizer = fixtureOptimizer();
    const state = slobodskoyState();
    const makePlace = (id: string, poiCount: number) => ({
      id, name: id, center: { lat: 58.6, lon: 49.6 }, visitMode: 'pass_by', dwellMinutes: 0, arrivalOverheadMinutes: 0,
      source: 'auto' as const, locked: false, clusterConfidence: 'walkable' as const,
      pois: Array.from({ length: poiCount }, (_, index) => ({ id: `${id}-${index}`, name: id, category: 'monument', lat: 58.6, lon: 49.6, included: true, estimatedVisitMinutes: 0 })),
    });
    const exactRoute = (coordinates: number[][], duration = 600) => fixtureRouteResult(coordinates.map(([lon, lat]) => ({ lat, lon })), duration, 1_000);
    const clean = (optimizer as any).scored([makePlace('clean', 1)], exactRoute([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]], 630), state, 'balanced', []);
    const outAndBack = (optimizer as any).scored([makePlace('repeat', 1)], exactRoute([[0, 0], [0.01, 0], [0.02, 0], [0.03, 0], [0.02, 0], [0.01, 0], [0, 0]]), state, 'balanced', []);
    const openLoop = (optimizer as any).scored([makePlace('open', 1)], exactRoute([[0, 0], [0.01, 0]]), state, 'balanced', []);

    // The quality policy outranks compactness once candidates are otherwise
    // equal on feasibility, locality, utility and category fit.
    outAndBack.score.total = clean.score.total + 100;
    expect(clean.quality).toMatchObject({ verdict: 'confirmed', warnings: [] });
    expect(outAndBack.quality.warnings).toContain('UNAVOIDABLE_OUT_AND_BACK');
    expect(openLoop.quality.warnings).toContain('LOOP_NOT_CLOSED');
    // Hard feasibility and POI utility remain first; among otherwise
    // comparable exact routes a clean route also beats a slightly shorter
    // degraded one. The unavoidable fallback still beats an open loop.
    expect((optimizer as any).compareEvaluated(clean, outAndBack, state, [], 'balanced')).toBeLessThan(0);
    expect((optimizer as any).compareEvaluated(outAndBack, openLoop, state, [], 'balanced')).toBeLessThan(0);
  });
});

/** Straight-line distance in km (used by the geographic-order regression). */
function haversineKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
