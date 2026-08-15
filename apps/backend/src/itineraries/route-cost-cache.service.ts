import { Injectable, Logger } from '@nestjs/common';

/**
 * Cache key components for a directed route cost.
 *
 * Directed endpoints are rounded to 6 decimal places (~0.1 m) and keyed as
 * `lat,lon>lat,lon`. The graph and model versions namespace the cache so a
 * PBF re-import or custom-model change invalidates stale entries.
 */
export interface RouteCostCacheKey {
  profile: string;
  directedEndpoints: string;
  graphVersion: string;
  modelVersion: string;
}

export interface CachedRouteCost {
  seconds: number;
  meters: number;
}

interface CacheEntry {
  value: CachedRouteCost | null; // null = confirmed unreachable/off-graph
  expiresAt: number;
}

/**
 * Graph/model-versioned, in-flight-coalescing directed route-cost cache (D5, M2).
 *
 * - Cache key includes profile, directed endpoints (6 dp), graph version and
 *   model version so a PBF re-import or custom-model change invalidates stale
 *   costs.
 * - In-flight same-key requests coalesce to a single GraphHopper call.
 * - Positive TTL for confirmed costs; a shorter TTL for null (unreachable)
 *   results prevents permanent pessimism on transient graph issues.
 * - FIFO-bounded to a configurable maximum.
 * - `NV_ROUTING_CACHE_BUST` appends an extra namespace segment so deploys
 *   can force a clean cache without restarting.
 */
@Injectable()
export class RouteCostCacheService {
  private readonly logger = new Logger(RouteCostCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly positiveTtlMs = 5 * 60_000; // 5 min for confirmed costs
  private readonly nullTtlMs = 30_000; // 30 s for confirmed-unreachable
  private readonly maxEntries = 2_000;
  private readonly inFlight = new Map<string, Promise<CachedRouteCost | null>>();
  private readonly bustNamespace = process.env.NV_ROUTING_CACHE_BUST ?? '';

  constructor() {}

  /**
   * Get a cached cost or coalesce an in-flight producer.
   * Returns `undefined` on a hard miss (producer must be called),
   * `null` on a cached-unreachable, or a `CachedRouteCost`.
   */
  get(key: RouteCostCacheKey): { hit: true; value: CachedRouteCost | null } | { hit: false } {
    const k = this.serialize(key);
    const entry = this.cache.get(k);
    if (entry && entry.expiresAt > Date.now()) {
      return { hit: true, value: entry.value };
    }
    if (entry) this.cache.delete(k); // expired
    return { hit: false };
  }

  /** Coalesce an in-flight producer so identical concurrent requests share one call. */
  async coalesce(
    key: RouteCostCacheKey,
    producer: () => Promise<CachedRouteCost | null>,
  ): Promise<CachedRouteCost | null> {
    const k = this.serialize(key);
    const existing = this.inFlight.get(k);
    if (existing) return existing;
    const promise = producer().then(
      (value) => {
        this.put(k, value);
        return value;
      },
      (err) => {
        // On error, do not cache; just propagate and clear in-flight.
        throw err;
      },
    ).finally(() => {
      this.inFlight.delete(k);
    });
    this.inFlight.set(k, promise);
    return promise;
  }

  set(key: RouteCostCacheKey, value: CachedRouteCost | null): void {
    this.put(this.serialize(key), value);
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /** Current entry count (for diagnostics). */
  get size(): number {
    return this.cache.size;
  }

  private serialize(key: RouteCostCacheKey): string {
    return `${key.profile}|${key.directedEndpoints}|${key.graphVersion}|${key.modelVersion}|${this.bustNamespace}`;
  }

  private put(k: string, value: CachedRouteCost | null): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    const expiresAt = Date.now() + (value == null ? this.nullTtlMs : this.positiveTtlMs);
    this.cache.set(k, { value, expiresAt });
  }
}
