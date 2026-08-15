import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { RoutePlace, Point, RouteResult } from './itinerary.types';
import { OptimizerSearchService, type SearchContext, type CompareFn } from './optimizer-search.service';
import { ItineraryQualityGateService } from './itinerary-quality-gate.service';
import { LoopQualityService } from '../routing/loop-quality.service';

function makePlace(id: string, lat = 58.5, lon = 49.5, source: RoutePlace['source'] = 'auto'): RoutePlace {
  return {
    id, name: id, center: { lat, lon }, pois: [{ id: `${id}-poi`, name: id, category: 'nature', lat, lon, included: true, estimatedVisitMinutes: 0 }],
    visitMode: 'pass_by', dwellMinutes: 0, arrivalOverheadMinutes: 0, source, locked: false, clusterConfidence: 'walkable',
  };
}

function makeRoute(seconds: number): RouteResult {
  return { distance: seconds * 4.5, duration: seconds, ascend: 0, descend: 0, profile: 'bike', bbox: [49, 58, 50, 59], geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[49.5, 58.5], [49.51, 58.51]] }, properties: {} } };
}

function simpleCtx(budgetSeconds: number, routeCosts: Map<string, number>): SearchContext {
  const evaluator = {
    async cost(a: Point, b: Point) {
      const key = `${a.lat},${a.lon}>${b.lat},${b.lon}`;
      const val = routeCosts.get(key);
      if (val == null) return null;
      return { seconds: val, meters: val * 4.5 };
    },
    async insertionDelta(i: Point, p: Point, j: Point) {
      const cip = await this.cost(i, p);
      const cpj = await this.cost(p, j);
      const cij = await this.cost(i, j);
      if (cip == null || cpj == null || cij == null) return null;
      return cip.seconds + cpj.seconds - cij.seconds;
    },
    haversineLowerBound(a: Point, b: Point) {
      const R = 6371000, rad = Math.PI / 180;
      const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    },
  };
  return {
    evaluator, profile: 'bike', budgetSeconds, loop: true, start: { lat: 58.5, lon: 49.5 },
    routeBuilder: async (places: RoutePlace[], _loop: boolean) => makeRoute(places.length * 300),
  };
}

describe('OptimizerSearchService', () => {
  it('greedy insertion adds feasible places', async () => {
    const search = new OptimizerSearchService();
    const ctx = simpleCtx(3600, new Map());
    const current = [makePlace('a', 58.5, 49.5)];
    const pool = [makePlace('b', 58.51, 49.51), makePlace('c', 58.52, 49.52)];
    const result = await search.greedyInsert(current, pool, ctx, () => 0);
    expect(result.length).toBeGreaterThanOrEqual(current.length);
  });

  it('drop removes the least useful auto place when over budget', async () => {
    const search = new OptimizerSearchService();
    const places = [makePlace('a'), makePlace('b'), makePlace('c')];
    const result = await search.dropOverBudget(places, 7200, 3600);
    expect(result.length).toBe(2);
  });

  it('drop never removes manual/locked places', async () => {
    const search = new OptimizerSearchService();
    const manual = { ...makePlace('m'), source: 'manual' as const, locked: true };
    const auto = makePlace('a');
    const result = await search.dropOverBudget([manual, auto], 7200, 3600);
    expect(result.some((p) => p.id === 'm')).toBe(true);
    expect(result.some((p) => p.id === 'a')).toBe(false);
  });

  it('relocate improves ordering', async () => {
    const search = new OptimizerSearchService();
    const ctx = simpleCtx(3600, new Map());
    // Set up a route builder that returns different durations for different orders
    ctx.routeBuilder = async (places: RoutePlace[]) => {
      const key = places.map((p) => p.id).join(',');
      const costs: Record<string, number> = { 'a,b,c': 900, 'b,a,c': 600, 'a,c,b': 1000 };
      return makeRoute(costs[key] ?? 800);
    };
    const result = await search.relocate([makePlace('a'), makePlace('b'), makePlace('c')], ctx);
    expect(result.map((p) => p.id)).toContain('b');
  });

  it('2-opt runs without error on a small list', async () => {
    const search = new OptimizerSearchService();
    const ctx = simpleCtx(3600, new Map());
    const result = await search.twoOpt([makePlace('a'), makePlace('b'), makePlace('c')], ctx);
    expect(result.length).toBe(3);
  });

  it('v2 local search accepts a slightly longer clean exact route over a degraded one', async () => {
    const search = new OptimizerSearchService();
    const qualityGate = new ItineraryQualityGateService(new LoopQualityService());
    const ctx = simpleCtx(1000, new Map());
    ctx.start = { lat: 0, lon: 0 };
    const a = makePlace('a', 0.01, 0.01);
    const b = makePlace('b', 0.01, 0.02);
    const c = makePlace('c', 0.01, 0.03);
    const d = makePlace('d', 0.01, 0.04);
    const degraded = {
      ...makeRoute(600),
      geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[0, 0], [0.01, 0], [0.02, 0], [0.01, 0]] }, properties: {} },
    };
    const clean = {
      ...makeRoute(630),
      geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]] }, properties: {} },
    };
    const qualityRank = (route: RouteResult) => {
      const verdict = qualityGate.assess({ route, totals: { feasible: true }, requestedLoop: true, places: [a, b, c, d], networkConfirmed: true }).verdict;
      return verdict === 'confirmed' ? 2 : verdict === 'degraded' ? 1 : 0;
    };
    const routeCalls: string[] = [];
    ctx.maxIterations = 1;
    ctx.routeBuilder = async (places: RoutePlace[]) => {
      const ids = places.map((place) => place.id).join(',');
      routeCalls.push(ids);
      return ids === 'a,c,b,d' ? degraded : ids === 'a,b,c,d' ? clean : degraded;
    };
    ctx.isBetter = async (_candidate, candidateRoute, _current, currentRoute) => qualityRank(candidateRoute) > qualityRank(currentRoute);

    const result = await search.localSearch([a, c, b, d], [], ctx, () => 0);
    expect(routeCalls).toContain('a,b,c,d'); // enters the exact 2-opt confirmation path
    expect(result.places.map((place) => place.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.route?.duration).toBe(630);
    expect(result.route!.duration).toBeGreaterThan(degraded.duration);
    expect(qualityRank(result.route!)).toBeGreaterThan(qualityRank(degraded));
  });

  it('relocate never moves manual/locked anchors and preserves their relative order', async () => {
    const search = new OptimizerSearchService();
    const ctx = simpleCtx(3600, new Map());
    const m1 = { ...makePlace('m1'), source: 'manual' as const };
    const m2 = { ...makePlace('m2'), locked: true };
    const a = makePlace('a');
    const b = makePlace('b');
    // The globally cheapest order [m2,a,m1,b] would require MOVING an anchor
    // (m2 to the front, m1 later) — relocate must never even consider it.
    // A legitimate improvement [m1,b,m2,a] (moving only auto places) must be found.
    ctx.routeBuilder = async (places: RoutePlace[]) => {
      const key = places.map((p) => p.id).join(',');
      const costs: Record<string, number> = {
        'm1,a,m2,b': 1200, 'a,m1,m2,b': 1100, 'm1,m2,a,b': 900, 'm1,b,m2,a': 800,
        'm2,a,m1,b': 400, 'm1,m2,b,a': 1000, 'b,m1,m2,a': 950,
      };
      return makeRoute(costs[key] ?? 2000);
    };
    const result = await search.relocate([m1, a, m2, b], ctx);
    const ids = result.map((p) => p.id);
    // Anchors keep their relative order m1 before m2 in the final solution.
    expect(ids.indexOf('m1')).toBeLessThan(ids.indexOf('m2'));
    // The anchor-moving "improvement" is never chosen.
    expect(ids.join(',')).not.toBe('m2,a,m1,b');
    // The search still improved by relocating only automatic places.
    expect(ids.join(',')).toBe('m1,b,m2,a');
  });

  it('2-opt never reverses a segment with a manual/locked anchor inside it', async () => {
    const search = new OptimizerSearchService();
    const ctx = simpleCtx(3600, new Map());
    const m = { ...makePlace('m'), source: 'manual' as const };
    const a = makePlace('a');
    const x = makePlace('x');
    const y = makePlace('y');
    // Reversing [x, m, y] → [y, m, x] would cut duration from 1000 to 300, but
    // the anchor sits INSIDE the segment (not at either boundary), so 2-opt
    // must skip it and keep the user-intended ordering.
    ctx.routeBuilder = async (places: RoutePlace[]) => {
      const key = places.map((p) => p.id).join(',');
      const costs: Record<string, number> = {
        'a,x,m,y': 1000, 'a,y,m,x': 300, 'a,m,x,y': 2000, 'x,a,m,y': 2000, 'a,x,y,m': 2000,
      };
      return makeRoute(costs[key] ?? 2000);
    };
    const result = await search.twoOpt([a, x, m, y], ctx);
    expect(result.map((p) => p.id).join(',')).toBe('a,x,m,y');
    // Same guarantee for a locked (non-manual) anchor.
    const locked = { ...makePlace('m'), locked: true };
    const lockedCtx = simpleCtx(3600, new Map());
    lockedCtx.routeBuilder = async (places: RoutePlace[]) => {
      const key = places.map((p) => p.id).join(',');
      const costs: Record<string, number> = {
        'a,x,m,y': 1000, 'a,y,m,x': 300, 'a,m,x,y': 2000, 'x,a,m,y': 2000, 'a,x,y,m': 2000,
      };
      return makeRoute(costs[key] ?? 2000);
    };
    const lockedResult = await search.twoOpt([a, x, locked, y], lockedCtx);
    expect(lockedResult.map((p) => p.id).join(',')).toBe('a,x,m,y');
  });

  it('localSearch swaps out a poor greedy place and improves ordering', async () => {
    const search = new OptimizerSearchService();
    // Costs: a→b is a huge barrier detour, b→a likewise; c is cheap next to a.
    const costs = new Map<string, number>([
      ['58.5,49.5>58.51,49.51', 100], // start→a
      ['58.51,49.51>58.5,49.5', 100], // a→start
      ['58.5,49.5>58.6,49.6', 300],   // start→b
      ['58.6,49.6>58.5,49.5', 300],   // b→start
      ['58.51,49.51>58.6,49.6', 900], // a→b barrier
      ['58.6,49.6>58.51,49.51', 900], // b→a barrier
      ['58.5,49.5>58.52,49.52', 250], // start→c
      ['58.52,49.52>58.5,49.5', 250], // c→start
      ['58.51,49.51>58.52,49.52', 80],// a→c cheap
      ['58.52,49.52>58.51,49.51', 80],// c→a cheap
      ['58.6,49.6>58.52,49.52', 900], // b→c barrier
      ['58.52,49.52>58.6,49.6', 900], // c→b barrier
    ]);
    const ctx = simpleCtx(1320, costs);
    // Honest route builder: sum directed leg costs from the map (barrier-aware).
    ctx.routeBuilder = async (places: RoutePlace[]) => {
      const pts: Point[] = [{ lat: 58.5, lon: 49.5 }, ...places.map((p) => p.center)];
      pts.push({ lat: 58.5, lon: 49.5 }); // loop
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const key = `${pts[i].lat},${pts[i].lon}>${pts[i + 1].lat},${pts[i + 1].lon}`;
        const leg = costs.get(key);
        if (leg == null) return null;
        total += leg;
      }
      return makeRoute(total);
    };
    const a = { ...makePlace('a', 58.51, 49.51), pois: [{ id: 'a-poi', name: 'A', category: 'nature', lat: 58.51, lon: 49.51, included: true, estimatedVisitMinutes: 0 }] };
    const b = { ...makePlace('b', 58.6, 49.6), pois: [{ id: 'b-poi', name: 'B', category: 'nature', lat: 58.6, lon: 49.6, included: true, estimatedVisitMinutes: 0 }] };
    const c = { ...makePlace('c', 58.52, 49.52), pois: [
      { id: 'c1', name: 'C1', category: 'heritage', lat: 58.52, lon: 49.52, included: true, estimatedVisitMinutes: 0 },
      { id: 'c2', name: 'C2', category: 'heritage', lat: 58.5205, lon: 49.5205, included: true, estimatedVisitMinutes: 0 },
    ] };
    // Greedy selected [a, b] (barrier detour = 1300s); c cannot be appended
    // within the 1320s budget ([a,b,c] ≈ 100+900+900+250 = 2150s).
    const selected = [a, b];
    const pool = [a, b, c];
    const isBetter = async (cand: RoutePlace[], candRoute: any, cur: RoutePlace[], curRoute: any) => {
      const candPois = cand.reduce((s, p) => s + p.pois.length, 0);
      const curPois = cur.reduce((s, p) => s + p.pois.length, 0);
      if (candPois !== curPois) return candPois > curPois;
      return candRoute.duration < curRoute.duration;
    };
    const result = await search.localSearch(selected, pool, { ...ctx, isBetter }, () => 0);
    const ids = result.places.map((p) => p.id);
    expect(ids).toContain('c');
    expect(ids).not.toContain('b');
    // The returned route must be feasible and better than the greedy one.
    expect(result.route).not.toBeNull();
    expect(result.route!.duration).toBeLessThan(1300);
  });

  it('2-opt eliminates a back-and-forth (segment reversal) pattern', async () => {
    const search = new OptimizerSearchService();
    const start = { lat: 58.5, lon: 49.5 };
    // Four places on a line NE of the start.
    const a = makePlace('a', 58.501, 49.501);
    const b = makePlace('b', 58.502, 49.502);
    const c = makePlace('c', 58.503, 49.503);
    const d = makePlace('d', 58.504, 49.504);
    // Honest route builder: straight-line legs + loop closing edge, so the
    // exact confirmation agrees with the geometric ranking.
    const ctx = geometricCtx(start, true);
    // Zigzag: [a, c, b, d] bounces back and forth; the reversal [c, b]→[b, c]
    // produces the geographically ordered [a, b, c, d].
    const zigzag = [a, c, b, d];
    const ordered = await search.twoOpt(zigzag, ctx);
    expect(ordered.map((p) => p.id).join(',')).toBe('a,b,c,d');
    const zigzagLen = geometricLen(start, zigzag, true);
    const orderedLen = geometricLen(start, ordered, true);
    expect(orderedLen).toBeLessThan(zigzagLen);
  });

  it('or-opt relocates a mid-tour place to its geographically ordered slot', async () => {
    const search = new OptimizerSearchService();
    const start = { lat: 58.49, lon: 49.49 };
    // Four places on a NE line; d belongs AFTER c, but the tour visits it early.
    const a = makePlace('a', 58.50, 49.50);
    const b = makePlace('b', 58.501, 49.501);
    const c = makePlace('c', 58.502, 49.502);
    const d = makePlace('d', 58.503, 49.503);
    const ctx = geometricCtx(start, false); // open route: no closing edge
    const zigzag = [a, d, b, c];
    const zigzagLen = geometricLen(start, zigzag, false);
    const afterOrOpt = await search.orOpt(zigzag, ctx);
    // Moving d from index 1 to the end yields the geographically ordered line.
    expect(afterOrOpt.map((p) => p.id).join(',')).toBe('a,b,c,d');
    const orOptLen = geometricLen(start, afterOrOpt, false);
    expect(orOptLen).toBeLessThan(zigzagLen);
  });

  it('nearestNeighborOrder produces a geographic sequence and preserves anchors', async () => {
    const search = new OptimizerSearchService();
    const start = { lat: 58.5, lon: 49.5 };
    const ctx = geometricCtx(start, true);
    const a = makePlace('a', 58.501, 49.501);
    const b = makePlace('b', 58.502, 49.502);
    const c = makePlace('c', 58.503, 49.503);
    const d = makePlace('d', 58.504, 49.504);
    // Feed a deliberately scrambled set: NN must reorder it geographically.
    const order = search.nearestNeighborOrder(start, [d, b, a, c], ctx);
    expect(order.map((p) => p.id).join(',')).toBe('a,b,c,d');
    // Manual/locked anchors keep their relative order.
    const m1 = { ...makePlace('m1', 58.505, 49.505), source: 'manual' as const };
    const m2 = { ...makePlace('m2', 58.506, 49.506), locked: true };
    // The input deliberately puts m2 before m1 although geometry favors m1
    // first. Nearest-neighbor may move automatic Places only: fixed anchors
    // must retain this exact input-relative sequence.
    const anchored = search.nearestNeighborOrder(start, [d, m2, a, m1, c, b], ctx);
    const anchoredIds = anchored.map((p) => p.id);
    expect(anchored.filter((p) => p.source === 'manual' || p.locked).map((p) => p.id)).toEqual(['m2', 'm1']);
    expect(anchoredIds.length).toBe(6);
  });
});

/** Straight-line tour length in meters (loop closing edge optional). */
function geometricLen(start: Point, places: RoutePlace[], loop: boolean): number {
  const pts = [start, ...places.map((p) => p.center)];
  if (loop) pts.push(start);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += haversineMeters(pts[i], pts[i + 1]);
  return total;
}

function haversineMeters(a: Point, b: Point): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Search context whose routeBuilder returns the honest straight-line cost. */
function geometricCtx(start: Point, loop: boolean): SearchContext {
  return {
    evaluator: {
      async cost(a: Point, b: Point) {
        return { seconds: haversineMeters(a, b) / 4.5, meters: haversineMeters(a, b) };
      },
      async insertionDelta() { return null; },
      haversineLowerBound: haversineMeters,
    },
    profile: 'bike',
    budgetSeconds: 4 * 3600,
    loop,
    start,
    routeBuilder: async (places: RoutePlace[]) => makeRoute(Math.round(geometricLen(start, places, loop) / 4.5)),
  };
}
