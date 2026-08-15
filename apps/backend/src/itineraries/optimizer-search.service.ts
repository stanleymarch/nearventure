import { Injectable } from '@nestjs/common';
import type { Point, RoutePlace } from './itinerary.types';
import type { RouteResult } from '../routing/routing.types';

/**
 * Bounded local-search operations for itinerary optimization (design §5.5, M3).
 *
 * All operations work on an ordered Place list and use the evaluator insertion
 * deltas for feasibility decisions. The search is bounded: only a shortlisted
 * subset of candidate moves receives exact cost checks per iteration.
 */
export interface SearchCandidate {
  places: RoutePlace[];
  route: RouteResult;
}

export interface SearchContext {
  evaluator: {
    cost(a: Point, b: Point): Promise<{ seconds: number; meters: number } | null>;
    insertionDelta(i: Point, p: Point, j: Point): Promise<number | null>;
    haversineLowerBound(a: Point, b: Point): number;
  };
  routeBuilder: (places: RoutePlace[], loop: boolean, finish?: Point) => Promise<RouteResult | null>;
  budgetSeconds: number;
  loop: boolean;
  finish?: Point;
  start: Point;
  profile: import('../routing/routing.types').RoutingProfile;
  /** Max search iterations to keep bounded. */
  maxIterations?: number;
  /** Production scorer-based improvement predicate. When present, every exact
   *  local-search move uses it instead of duration-only acceptance. */
  isBetter?: (candidate: RoutePlace[], candidateRoute: RouteResult, current: RoutePlace[], currentRoute: RouteResult) => Promise<boolean>;
}

export interface CompareInput {
  places: RoutePlace[];
  route: RouteResult;
  travelMinutes: number;
  feasible: boolean;
  localityViolations: number;
  uniquePois: number;
  preferredCategoryHits: number;
  routeOverlap: number;
  budgetMinutes: number;
}

export type CompareFn = (a: CompareInput, b: CompareInput) => number;

/**
 * Implements add/drop/swap/relocate/2-opt over an ordered Place list.
 *
 * The caller provides:
 * - `evaluator`: directed cost + insertion delta (from RouteCostEvaluatorService)
 * - `routeBuilder`: builds a complete GraphHopper route for a candidate set
 * - `compareFn`: lexicographic comparator (from ItineraryScoreService)
 * - `budgetSeconds`: hard travel-time budget
 *
 * The search keeps the best feasible candidate found and returns it. It never
 * removes manual/locked Places.
 */
@Injectable()
export class OptimizerSearchService {
  /**
   * Greedy insertion: try adding each pool Place into the current ordered list
   * at its cheapest position. Accept moves that keep the route feasible.
   */
  async greedyInsert(
    current: RoutePlace[],
    pool: RoutePlace[],
    ctx: SearchContext,
    compareFn: CompareFn,
  ): Promise<RoutePlace[]> {
    let result = [...current];
    const remaining = pool.filter((p) => !result.some((r) => r.id === p.id));
    let changed = true;
    let iterations = 0;
    const maxIter = ctx.maxIterations ?? 30;

    while (changed && iterations++ < maxIter) {
      changed = false;
      let bestMove: { place: RoutePlace; insertAfterIdx: number; deltaSec: number } | null = null;

      for (const place of remaining) {
        if (result.some((r) => r.id === place.id)) continue;
        const move = await this.cheapestInsertion(place, result, ctx);
        if (!move) continue;
        if (!bestMove || move.deltaSec < bestMove.deltaSec) {
          bestMove = { place, insertAfterIdx: move.insertAfterIdx, deltaSec: move.deltaSec };
        }
      }

      if (bestMove) {
        const candidate = [...result.slice(0, bestMove.insertAfterIdx + 1), bestMove.place, ...result.slice(bestMove.insertAfterIdx + 1)];
        const route = await ctx.routeBuilder(candidate, ctx.loop, ctx.finish);
        if (route && route.duration <= ctx.budgetSeconds) {
          result = candidate;
          changed = true;
        }
      }
    }
    return result;
  }

  /**
   * Drop: remove the least-useful unlocked automatic Place if the route
   * exceeds the budget. Returns the reduced list (or original if nothing
   * droppable). Manual/locked Places are never removed.
   */
  async dropOverBudget(
    places: RoutePlace[],
    routeDurationSec: number,
    budgetSeconds: number,
  ): Promise<RoutePlace[]> {
    if (routeDurationSec <= budgetSeconds) return places;
    const droppable = places.filter((p) => p.source !== 'manual' && !p.locked);
    if (droppable.length === 0) return places;
    // Drop the one with the fewest POIs (least utility).
    droppable.sort((a, b) => a.pois.length - b.pois.length);
    const toDrop = droppable[0];
    return places.filter((p) => p.id !== toDrop.id);
  }

  /**
   * Relocate: try moving each Place to a different position in the order.
   * Accept feasible moves that improve the configured candidate policy.
   * A null route means the shared route-build budget is exhausted — the whole
   * search stops and keeps the best order found so far instead of spinning on
   * candidates that can no longer be confirmed.
   */
  async relocate(
    places: RoutePlace[],
    ctx: SearchContext,
  ): Promise<RoutePlace[]> {
    let best = [...places];
    let bestRoute = await ctx.routeBuilder(best, ctx.loop, ctx.finish);
    if (!bestRoute) return places;
    let iterations = 0;
    const maxIter = ctx.maxIterations ?? 20;

    for (let iter = 0; iter < maxIter; iter++) {
      let improved = false;
      for (let i = 0; i < best.length; i++) {
        // Fixed anchors (manual/locked) are never moved: moving one would
        // reorder user-fixed Places relative to each other.
        if (best[i].source === 'manual' || best[i].locked) continue;
        for (let j = 0; j < best.length; j++) {
          if (i === j) continue;
          const candidate = [...best];
          const [moved] = candidate.splice(i, 1);
          candidate.splice(j, 0, moved);
          const route = await ctx.routeBuilder(candidate, ctx.loop, ctx.finish);
          if (!route) return best; // shared build budget exhausted
          if (bestRoute && await this.acceptsCandidate(candidate, route, best, bestRoute, ctx)) {
            best = candidate;
            bestRoute = route;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (!improved) break;
    }
    return best;
  }

  /**
   * Swap: try exchanging a selected automatic Place with an unselected pool
   * Place if it improves the lexicographic score while staying feasible.
   * Uses `ctx.isBetter` (production scorer) when provided, otherwise the
   * compareFn fallback.
   */
  async swap(
    selected: RoutePlace[],
    pool: RoutePlace[],
    ctx: SearchContext,
    compareFn: CompareFn,
  ): Promise<RoutePlace[]> {
    let best = [...selected];
    let bestRoute = await ctx.routeBuilder(best, ctx.loop, ctx.finish);
    if (!bestRoute) return selected;
    const bestInput = this.toCompareInput(best, bestRoute, ctx);
    let iterations = 0;
    const maxIter = ctx.maxIterations ?? 15;

    outer: for (const poolPlace of pool) {
      if (iterations++ >= maxIter) break;
      if (best.some((p) => p.id === poolPlace.id)) continue;
      for (let i = 0; i < best.length; i++) {
        if (best[i].source === 'manual' || best[i].locked) continue;
        const candidate = [...best];
        candidate[i] = poolPlace;
        const route = await ctx.routeBuilder(candidate, ctx.loop, ctx.finish);
        if (!route) return best; // shared build budget exhausted
        if (route.duration > ctx.budgetSeconds) continue;
        const accepted = ctx.isBetter
          ? await ctx.isBetter(candidate, route, best, bestRoute)
          : compareFn(this.toCompareInput(candidate, route, ctx), bestInput) < 0;
        if (accepted) {
          best = candidate;
          bestRoute = route;
          break outer;
        }
      }
    }
    return best;
  }

  /**
   * 2-opt: reverse segments of the ordered list to reduce route cost.
   * Only applies to segments that don't contain a locked/manual Place at
   * their boundaries (which would change user-intended ordering).
   *
   * The candidate sweep is GEOMETRIC (haversine tour length, loop closing
   * edge always included) so every segment reversal is ranked for free; only
   * the few most promising reversals per pass get an exact route confirmation.
   * This lets 2-opt run enough passes to eliminate back-and-forth patterns
   * without burning the shared GraphHopper build budget on rejected moves.
   */
  async twoOpt(
    places: RoutePlace[],
    ctx: SearchContext,
  ): Promise<RoutePlace[]> {
    let best = [...places];
    let bestRoute = await ctx.routeBuilder(best, ctx.loop, ctx.finish);
    if (!bestRoute) return places;
    let bestGeom = this.geometricTourLength(best, ctx);
    const maxIter = Math.max(1, ctx.maxIterations ?? 15);
    // Exact confirms per improvement pass: the geometric sweep is free, so the
    // build budget is spent only on the top geometrically-improving reversals.
    const confirmLimit = 3;

    for (let iter = 0; iter < maxIter; iter++) {
      const candidates: { places: RoutePlace[]; geom: number }[] = [];
      for (let i = 1; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          // Never reverse a segment that contains a manual/locked Place
          // anywhere inside it: reversing would reorder user-fixed Places
          // relative to each other (endpoint checks alone are not enough).
          const hasFixedAnchor = best.slice(i, k + 1).some((p) => p.locked || p.source === 'manual');
          if (hasFixedAnchor) continue;
          const candidate = [...best];
          const segment = candidate.slice(i, k + 1).reverse();
          candidate.splice(i, k - i + 1, ...segment);
          const geom = this.geometricTourLength(candidate, ctx);
          if (geom < bestGeom - 1e-6) candidates.push({ places: candidate, geom });
        }
      }
      if (candidates.length === 0) break;
      candidates.sort((a, b) => a.geom - b.geom);

      let improved = false;
      for (const cand of candidates.slice(0, confirmLimit)) {
        const route = await ctx.routeBuilder(cand.places, ctx.loop, ctx.finish);
        if (!route) return best; // shared build budget exhausted
        if (bestRoute && await this.acceptsCandidate(cand.places, route, best, bestRoute, ctx)) {
          best = cand.places;
          bestRoute = route;
          bestGeom = cand.geom;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
    return best;
  }

  /**
   * Or-opt: move a segment of 1-3 Places to a better position in the order.
   * Handles the zigzags that pure segment reversal (2-opt) cannot: a Place
   * (or small block) that belongs earlier/later in the tour is relocated as a
   * block. Same geometric-first evaluation as 2-opt: all candidate moves are
   * ranked by haversine tour length (loop closing edge included) and only the
   * top few are confirmed with exact route builds. Manual/locked segments are
   * never moved.
   */
  async orOpt(
    places: RoutePlace[],
    ctx: SearchContext,
  ): Promise<RoutePlace[]> {
    let best = [...places];
    let bestRoute = await ctx.routeBuilder(best, ctx.loop, ctx.finish);
    if (!bestRoute) return places;
    let bestGeom = this.geometricTourLength(best, ctx);
    const maxIter = Math.max(1, ctx.maxIterations ?? 10);
    const confirmLimit = 3;

    for (let iter = 0; iter < maxIter; iter++) {
      const candidates: { places: RoutePlace[]; geom: number }[] = [];
      for (let segLen = 1; segLen <= 3 && segLen < best.length; segLen++) {
        for (let i = 0; i + segLen <= best.length; i++) {
          const segment = best.slice(i, i + segLen);
          if (segment.some((p) => p.locked || p.source === 'manual')) continue;
          const rest = [...best.slice(0, i), ...best.slice(i + segLen)];
          for (let j = 0; j <= rest.length; j++) {
            if (j === i) continue; // no-op reinsertion
            const candidate = [...rest.slice(0, j), ...segment, ...rest.slice(j)];
            const geom = this.geometricTourLength(candidate, ctx);
            if (geom < bestGeom - 1e-6) candidates.push({ places: candidate, geom });
          }
        }
      }
      if (candidates.length === 0) break;
      candidates.sort((a, b) => a.geom - b.geom);

      let improved = false;
      for (const cand of candidates.slice(0, confirmLimit)) {
        const route = await ctx.routeBuilder(cand.places, ctx.loop, ctx.finish);
        if (!route) return best; // shared build budget exhausted
        if (bestRoute && await this.acceptsCandidate(cand.places, route, best, bestRoute, ctx)) {
          best = cand.places;
          bestRoute = route;
          bestGeom = cand.geom;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
    return best;
  }

  /**
   * Geometric nearest-neighbor initialization: order `places` into a
   * geographically sensible sequence — each next stop is the closest unvisited
   * one to the current position. Used BEFORE greedy insertion so the tour grows
   * as a smooth sweep instead of in compactness-rank order (the source of the
   * reported zigzag). Manual/locked anchors are never moved; they are inserted
   * at their best geometric detour position preserving their relative order.
   * Purely geometric (haversine) — spends no routing budget.
   */
  nearestNeighborOrder(start: Point, places: RoutePlace[], ctx: SearchContext): RoutePlace[] {
    if (places.length <= 1) return [...places];
    const anchors = places.filter((p) => p.locked || p.source === 'manual');
    const free = places.filter((p) => !p.locked && p.source !== 'manual');
    const remaining = [...free];
    const ordered: RoutePlace[] = [];
    let current: Point = start;
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = ctx.evaluator.haversineLowerBound(current, remaining[i].accessPoint ?? remaining[i].center);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      ordered.push(remaining[bestIdx]);
      current = remaining[bestIdx].accessPoint ?? remaining[bestIdx].center;
      remaining.splice(bestIdx, 1);
    }
    let result = ordered;
    let minimumInsertIdx = 0;
    for (const anchor of anchors) {
      // Every following anchor may only be inserted after the preceding one.
      // This preserves the user-provided manual/locked sequence even when its
      // geometrically cheapest detour would otherwise put it before an anchor.
      result = this.insertAtBestDetour(anchor, result, ctx, minimumInsertIdx);
      minimumInsertIdx = result.findIndex((place) => place.id === anchor.id) + 1;
    }
    return result;
  }

  /**
   * Bounded local search: repeated 2-opt → or-opt → swap → relocate passes until
   * no change or the pass budget is consumed. Ordering moves run FIRST because
   * they are geometric-first (few exact route builds), so the bounded build
   * budget is spent on the reported zigzag problem before the more expensive
   * set-level swap / exact relocate. Never removes manual/locked Places.
   * Returns the best ordered list found plus its confirmed route (null when the
   * budget/cap starved the final rebuild).
   */
  async localSearch(
    selected: RoutePlace[],
    pool: RoutePlace[],
    ctx: SearchContext,
    compareFn: CompareFn,
  ): Promise<{ places: RoutePlace[]; route: RouteResult | null }> {
    let places = [...selected];
    const maxPasses = Math.max(1, ctx.maxIterations ?? 3);
    for (let pass = 0; pass < maxPasses; pass++) {
      const before = places.map((p) => p.id).join('|');
      places = await this.twoOpt(places, ctx);
      places = await this.orOpt(places, ctx);
      const swapped = await this.swap(places, pool, ctx, compareFn);
      const relocated = await this.relocate(swapped, ctx);
      places = relocated;
      const after = places.map((p) => p.id).join('|');
      if (after === before) break;
    }
    const route = await ctx.routeBuilder(places, ctx.loop, ctx.finish);
    return { places, route };
  }

  /** Insert a place at the geometric best position of an ordered tour
   *  (loop-aware: the closing edge is a candidate slot too). `minimumInsertIdx`
   *  prevents a later fixed anchor from being placed before an earlier one. */
  private insertAtBestDetour(place: RoutePlace, ordered: RoutePlace[], ctx: SearchContext, minimumInsertIdx = 0): RoutePlace[] {
    if (ordered.length === 0) return [place];
    const maxInsertIdx = ctx.loop || ctx.finish ? ordered.length : ordered.length - 1;
    // An open route without a finish has no final edge to score. Appending is
    // the only way to satisfy the anchor-order constraint in that case.
    if (minimumInsertIdx > maxInsertIdx) return [...ordered, place];

    const insertPoint = place.accessPoint ?? place.center;
    const points: Point[] = [ctx.start, ...ordered.map((p) => p.accessPoint ?? p.center)];
    if (ctx.loop) points.push(ctx.start);
    else if (ctx.finish) points.push(ctx.finish);
    let bestDetour = Infinity;
    let bestIdx = minimumInsertIdx;
    for (let i = minimumInsertIdx; i <= maxInsertIdx; i++) {
      const a = points[i];
      const b = points[i + 1];
      const detour = ctx.evaluator.haversineLowerBound(a, insertPoint)
        + ctx.evaluator.haversineLowerBound(insertPoint, b)
        - ctx.evaluator.haversineLowerBound(a, b);
      if (detour < bestDetour) {
        bestDetour = detour;
        bestIdx = i;
      }
    }
    return [...ordered.slice(0, bestIdx), place, ...ordered.slice(bestIdx)];
  }

  /**
   * Geometric tour length in meters: haversine over the ordered places
   * including the closing edge (loop) or finish point (open routes). Free —
   * never spends routing budget. Used to rank candidate reorderings before
   * exact confirmation, so every 2-opt/or-opt evaluation includes the loop's
   * closing edge by construction.
   */
  private geometricTourLength(places: RoutePlace[], ctx: SearchContext): number {
    if (places.length === 0) return 0;
    const points: Point[] = [ctx.start, ...places.map((p) => p.accessPoint ?? p.center)];
    if (ctx.loop) points.push(ctx.start);
    else if (ctx.finish) points.push(ctx.finish);
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      total += ctx.evaluator.haversineLowerBound(points[i], points[i + 1]);
    }
    return total;
  }

  /** Cheapest insertion of a place into an ordered list. Returns the position and delta in seconds. */
  private async cheapestInsertion(
    place: RoutePlace,
    ordered: RoutePlace[],
    ctx: SearchContext,
  ): Promise<{ insertAfterIdx: number; deltaSec: number } | null> {
    if (ordered.length === 0) {
      // Insert at position 0; cost is start→place (+ place→start if loop)
      return { insertAfterIdx: -1, deltaSec: 0 };
    }

    const insertPoint = place.accessPoint ?? place.center;
    let bestDelta = Infinity;
    let bestIdx = 0;
    const points = [ctx.start, ...ordered.map((p) => p.accessPoint ?? p.center)];
    if (ctx.loop) points.push(ctx.start);
    else if (ctx.finish) points.push(ctx.finish);

    for (let i = 0; i < points.length - 1; i++) {
      const delta = await ctx.evaluator.insertionDelta(points[i], insertPoint, points[i + 1]);
      // Fallback to haversine lower bound if network unavailable
      const effectiveDelta = delta ?? (() => {
        const a = points[i], b = points[i + 1];
        const detour = ctx.evaluator.haversineLowerBound(a, insertPoint) + ctx.evaluator.haversineLowerBound(insertPoint, b) - ctx.evaluator.haversineLowerBound(a, b);
        return detour / 4.5; // rough seconds from meters at ~4.5 m/s
      })();
      if (effectiveDelta < bestDelta) {
        bestDelta = effectiveDelta;
        bestIdx = i;
      }
    }
    return { insertAfterIdx: bestIdx, deltaSec: bestDelta };
  }

  /** Evaluate an exactly routed local-search move with the caller's full
   * policy. The duration fallback retains legacy callers that do not provide
   * a scorer, while v2 supplies its quality-aware `isBetter` predicate. */
  private async acceptsCandidate(candidate: RoutePlace[], candidateRoute: RouteResult, current: RoutePlace[], currentRoute: RouteResult, ctx: SearchContext): Promise<boolean> {
    if (candidateRoute.duration > ctx.budgetSeconds) return false;
    return ctx.isBetter
      ? ctx.isBetter(candidate, candidateRoute, current, currentRoute)
      : candidateRoute.duration < currentRoute.duration;
  }

  private toCompareInput(places: RoutePlace[], route: RouteResult, ctx: SearchContext): CompareInput {
    const uniquePois = places.reduce((s, p) => s + p.pois.filter((poi) => poi.included).length, 0);
    return {
      places,
      route,
      travelMinutes: route.duration / 60,
      feasible: route.duration <= ctx.budgetSeconds,
      localityViolations: 0,
      uniquePois,
      preferredCategoryHits: 0,
      routeOverlap: 0,
      budgetMinutes: ctx.budgetSeconds / 60,
    };
  }
}
