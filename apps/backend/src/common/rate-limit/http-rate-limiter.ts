import { Injectable } from '@nestjs/common';

/**
 * In-memory fixed-window HTTP rate limiter for public, expensive endpoints.
 *
 * Follows the existing `BotRateLimiter` pattern (per-key fixed window, no
 * persistence — a restart resets buckets, which is acceptable for anti-abuse).
 * Keyed by client IP per endpoint action.
 *
 * Limits are tunable via env:
 *   HTTP_RATE_LIMIT_MAX           — max requests per window per IP (default 60)
 *   HTTP_RATE_LIMIT_WINDOW_MS     — window length in ms (default 60_000)
 *   HTTP_RATE_LIMIT_MAX_BUCKETS   — hard cap on tracked keys (default 10_000)
 *
 * The bucket map is BOUNDED: expired buckets are pruned opportunistically
 * when a new key arrives at the cap, and brand-new keys are refused (429)
 * once the map is saturated — spoofed/unique keys cannot grow memory without
 * bound.
 */

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the bucket resets (0 when allowed). */
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Endpoint actions that are rate-limited (must match @RateLimit() names). */
const RATE_LIMITED_ACTIONS = [
  'route',
  'plan',
  'round-trip',
  'isochrone',
] as const;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

@Injectable()
export class HttpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limits = new Map<string, RateLimitOptions>();
  private readonly defaultLimit: RateLimitOptions;
  private readonly maxBuckets: number;

  constructor() {
    this.defaultLimit = {
      max: envInt('HTTP_RATE_LIMIT_MAX', 60),
      windowMs: envInt('HTTP_RATE_LIMIT_WINDOW_MS', 60_000),
    };
    this.maxBuckets = envInt('HTTP_RATE_LIMIT_MAX_BUCKETS', 10_000);
    for (const action of RATE_LIMITED_ACTIONS) {
      this.limits.set(action, this.defaultLimit);
    }
  }

  private limitFor(action: string): RateLimitOptions {
    return this.limits.get(action) ?? this.defaultLimit;
  }

  /**
   * Record one attempt for `key` under `action`. Returns whether it is
   * allowed and, when not, how long the caller must wait.
   */
  try(key: string, action: string): RateLimitDecision {
    const lim = this.limitFor(action);
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      // New key: prune expired buckets first, then refuse new keys if the
      // map is still saturated — never grow without bound.
      if (this.buckets.size >= this.maxBuckets) {
        this.pruneExpired();
      }
      if (this.buckets.size >= this.maxBuckets) {
        return { allowed: false, retryAfterMs: lim.windowMs };
      }
      bucket = { count: 0, resetAt: now + lim.windowMs };
      this.buckets.set(key, bucket);
    } else if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + lim.windowMs;
    }
    if (bucket.count >= lim.max) {
      return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Number of tracked buckets (test/debug introspection). */
  get size(): number {
    return this.buckets.size;
  }

  /** Prune expired buckets to keep the map bounded under long uptimes. */
  pruneExpired(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
