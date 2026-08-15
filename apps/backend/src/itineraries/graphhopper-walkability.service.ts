import { Injectable } from '@nestjs/common';
import { GraphHopperClient } from '../routing/graphhopper.client';
import type { DirectedWalkability, DirectedWalkabilityContext, Point } from './itinerary.types';
import type { RunLease } from './optimization-run-budget';

/** Bounded production foot-network decision used by Place clustering. */
@Injectable()
export class GraphHopperWalkabilityService implements DirectedWalkability {
  private readonly cache = new Map<string, { value: number | null; expiresAt: number }>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly concurrency = 4;
  private readonly timeoutMs = 5_000;
  private readonly ttlMs = 5 * 60_000;
  private readonly maxEntries = 1_000;

  constructor(private readonly graphHopper: GraphHopperClient) {}

  async minutesBetween(from: Point, to: Point, ctx?: DirectedWalkabilityContext): Promise<number | null> {
    const key = `${from.lat.toFixed(6)},${from.lon.toFixed(6)}>${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if (ctx?.counters) ctx.counters.cacheHits++;
      return cached.value;
    }
    if (ctx?.counters) ctx.counters.cacheMisses++;
    if (ctx?.signal?.aborted) return null;
    // D5: when a shared run budget is present, every miss acquires a lease
    // (request slot + concurrency). Cache hits bypass the slot entirely.
    let lease: RunLease | null = null;
    if (ctx?.runBudget) {
      lease = await ctx.runBudget.acquireLease();
      if (!lease) return null; // budget/deadline exhausted → stay separate
      if (ctx.counters) ctx.counters.graphHopperRequests++;
    } else {
      await this.acquire();
    }
    // Keep the concurrency slot until the underlying GraphHopper request
    // settles, even if the caller's bounded timeout wins first.
    const release = () => { if (lease) lease.release(); else this.release(); };
    // Only pass the signal when present: legacy 2-arg callers (v1 harnesses)
    // keep the exact `route([from,to], 'foot')` signature.
    const routePromise = (ctx?.signal
      ? this.graphHopper.route([from, to], 'foot', ctx.signal)
      : this.graphHopper.route([from, to], 'foot')
    )
      .then((path) => path.time / 60_000)
      .catch(() => null)
      .finally(release);
    const value = await Promise.race<number | null>([
      routePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), this.timeoutMs)),
    ]);
    this.put(key, value);
    return value;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) { this.active += 1; return; }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }
  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
  private put(key: string, value: number | null): void {
    if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
