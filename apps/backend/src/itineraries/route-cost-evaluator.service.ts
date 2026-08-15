import { Injectable, Logger, Optional } from '@nestjs/common';
import { GraphHopperClient } from '../routing/graphhopper.client';
import type { Point } from './itinerary.types';
import type { RoutingProfile } from '../routing/routing.types';
import type { OptimizationRunBudget } from './optimization-run-budget';
import { RouteCostCacheService, type CachedRouteCost } from './route-cost-cache.service';
import { GraphVersionProvider, FALLBACK_NAMESPACE } from './graph-version.provider';

export interface DirectedCost {
  seconds: number;
  meters: number;
}

export interface EvaluatorContext {
  profile: RoutingProfile;
  signal?: AbortSignal;
  runBudget?: OptimizationRunBudget;
  /** Aggregate cache counters for run diagnostics (no PII). */
  cacheStats?: { cacheHits: number; cacheMisses: number };
  /** Mutable flag set to true whenever a real directed network cost is
   *  returned (cache hit or fresh GraphHopper call). Used for the truthful
   *  networkConfidence summary: 'verified' requires at least one actual
   *  confirmation used by selection/locality. */
  networkConfirmed?: { value: boolean };
}

/**
 * Bounded directed route-cost evaluator (design §5.4, M2).
 *
 * Provides `cost(a, b)` and `insertionDelta(i, p, j)` using the shared run
 * budget and a graph/model-versioned cache. Key rules:
 *
 * - Geometric haversine lower bound prunes obviously-bad insertions without
 *   spending any budget.
 * - Only shortlisted candidates get exact directed `GraphHopperClient.route`
 *   calls, each consuming a slot from the shared `OptimizationRunBudget`.
 * - Cache hits bypass the budget (free); every miss acquires a slot.
 * - On timeout/off-graph/error: returns `null` (non-confirmation), NEVER an
 *   optimistic replacement cost. The locality guard and optimizer treat null
 *   as "cannot displace a confirmed local group".
 */
@Injectable()
export class RouteCostEvaluatorService {
  private readonly logger = new Logger(RouteCostEvaluatorService.name);
  private readonly modelVersion = 'nv-routing-v1';

  constructor(
    private readonly graphHopper: GraphHopperClient,
    private readonly cache: RouteCostCacheService,
    @Optional() private readonly graphVersionProvider?: GraphVersionProvider,
  ) {}

  /**
   * Directed network cost from A to B, or null if unreachable/unknown.
   * Geometric fallback only for pruning; the returned value is never used
   * as a confirmed cost unless it came from the cache or GraphHopper.
   */
  async cost(a: Point, b: Point, ctx: EvaluatorContext): Promise<DirectedCost | null> {
    if (samePoint(a, b)) return { seconds: 0, meters: 0 };
    const directedEndpoints = endpointKey(a, b);
    const cacheKey = {
      profile: ctx.profile,
      directedEndpoints,
      graphVersion: await this.graphNamespace(),
      modelVersion: this.modelVersion,
    };

    // 1. Cache hit — free, bypasses budget. A cached value IS a real directed
    //    network cost (confirmed earlier, still within TTL/namespace).
    const cached = this.cache.get(cacheKey);
    if (cached.hit) {
      if (ctx.cacheStats) ctx.cacheStats.cacheHits++;
      if (cached.value && ctx.networkConfirmed) ctx.networkConfirmed.value = true;
      return cached.value ? { seconds: cached.value.seconds, meters: cached.value.meters } : null;
    }
    if (ctx.cacheStats) ctx.cacheStats.cacheMisses++;

    // 2. Budget gate — every miss acquires a concurrency+request lease.
    const lease = ctx.runBudget ? await ctx.runBudget.acquireLease() : null;
    if (ctx.runBudget && !lease) return null;

    // 3. Exact directed GraphHopper call with in-flight coalescing.
    try {
      const result = await this.cache.coalesce(cacheKey, () => this.fetchRouteCost(a, b, ctx));
      if (result && ctx.networkConfirmed) ctx.networkConfirmed.value = true;
      return result ? { seconds: result.seconds, meters: result.meters } : null;
    } catch {
      return null;
    } finally {
      lease?.release();
    }
  }

  /**
   * Marginal insertion delta: cost(i→p) + cost(p→j) - cost(i→j).
   * Returns null if any leg is unconfirmed; the caller must treat null as
   * non-confirmation (cannot displace a confirmed alternative).
   */
  async insertionDelta(i: Point, p: Point, j: Point, ctx: EvaluatorContext): Promise<number | null> {
    const [ip, pj, ij] = await Promise.all([
      this.cost(i, p, ctx),
      this.cost(p, j, ctx),
      this.cost(i, j, ctx),
    ]);
    if (ip == null || pj == null || ij == null) return null;
    return ip.seconds + pj.seconds - ij.seconds;
  }

  /** Haversine lower bound (meters), never used as a confirmed cost. */
  haversineLowerBound(a: Point, b: Point): number {
    const R = 6_371_000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Current graph namespace used for cache keys (diagnostics). */
  async graphNamespace(): Promise<string> {
    if (!this.graphVersionProvider) return FALLBACK_NAMESPACE;
    return this.graphVersionProvider.namespace();
  }

  private async fetchRouteCost(a: Point, b: Point, ctx: EvaluatorContext): Promise<CachedRouteCost | null> {
    try {
      const path = await this.graphHopper.route([a, b], ctx.profile, ctx.signal);
      if (!path || !Number.isFinite(path.time) || !Number.isFinite(path.distance)) return null;
      return { seconds: path.time / 1000, meters: path.distance };
    } catch (err: any) {
      if (ctx.signal?.aborted) throw err;
      // GraphHopper returns errors for off-graph/unreachable pairs; treat as null.
      return null;
    }
  }
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}

function endpointKey(a: Point, b: Point): string {
  return `${a.lat.toFixed(6)},${a.lon.toFixed(6)}>${b.lat.toFixed(6)},${b.lon.toFixed(6)}`;
}
