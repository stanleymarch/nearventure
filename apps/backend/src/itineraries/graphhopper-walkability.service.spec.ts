import { describe, expect, it, vi } from 'vitest';
import { GraphHopperWalkabilityService } from './graphhopper-walkability.service';
import { PlaceClusteringService } from './place-clustering.service';
import { VisitTimeService } from './visit-time.service';
import { OptimizationRunBudget } from './optimization-run-budget';

describe('GraphHopperWalkabilityService', () => {
  it('uses foot routing and caches bounded pair decisions', async () => {
    const graphHopper = { route: vi.fn().mockResolvedValue({ time: 120_000 }) } as any;
    const service = new GraphHopperWalkabilityService(graphHopper);
    const from = { lat: 58.6, lon: 49.6 }; const to = { lat: 58.601, lon: 49.601 };
    await expect(service.minutesBetween(from, to)).resolves.toBe(2);
    await expect(service.minutesBetween(from, to)).resolves.toBe(2);
    expect(graphHopper.route).toHaveBeenCalledTimes(1);
    expect(graphHopper.route).toHaveBeenCalledWith([from, to], 'foot');
  });

  it('treats routing failure as no walkability decision', async () => {
    const service = new GraphHopperWalkabilityService({ route: vi.fn().mockRejectedValue(new Error('off graph')) } as any);
    await expect(service.minutesBetween({ lat: 1, lon: 1 }, { lat: 1.001, lon: 1.001 })).resolves.toBeNull();
  });

  it('meters every miss through the shared run budget and lets cache hits bypass it', async () => {
    const graphHopper = { route: vi.fn().mockResolvedValue({ time: 90_000 }) } as any;
    const service = new GraphHopperWalkabilityService(graphHopper);
    const { OptimizationRunBudget, OptimizationRunCounters } = await import('./optimization-run-budget');
    const budget = new OptimizationRunBudget({ maxRequests: 5, deadlineMs: 10_000, maxConcurrency: 2 });
    const counters = new OptimizationRunCounters();
    const from = { lat: 58.6, lon: 49.6 }; const to = { lat: 58.601, lon: 49.601 };
    // Miss 1: acquires a slot and counts a GraphHopper request.
    await expect(service.minutesBetween(from, to, { runBudget: budget, counters })).resolves.toBe(1.5);
    expect(budget.usedRequestCount).toBe(1);
    expect(counters.graphHopperRequests).toBe(1);
    expect(counters.cacheMisses).toBe(1);
    // Cache hit: bypasses the slot entirely (no new request, no new slot).
    await expect(service.minutesBetween(from, to, { runBudget: budget, counters })).resolves.toBe(1.5);
    expect(budget.usedRequestCount).toBe(1);
    expect(counters.cacheHits).toBe(1);
    expect(graphHopper.route).toHaveBeenCalledTimes(1);
  });

  it('stays separate when the run budget is exhausted (unknown result, not optimistic merge)', async () => {
    const graphHopper = { route: vi.fn().mockResolvedValue({ time: 60_000 }) } as any;
    const service = new GraphHopperWalkabilityService(graphHopper);
    const { OptimizationRunBudget } = await import('./optimization-run-budget');
    const budget = new OptimizationRunBudget({ maxRequests: 1, deadlineMs: 10_000, maxConcurrency: 1 });
    // First miss consumes the only slot.
    await service.minutesBetween({ lat: 1, lon: 1 }, { lat: 1.001, lon: 1.001 }, { runBudget: budget });
    // Second miss cannot acquire a slot → null (no GraphHopper call).
    const result = await service.minutesBetween({ lat: 2, lon: 2 }, { lat: 2.001, lon: 2.001 }, { runBudget: budget });
    expect(result).toBeNull();
    expect(graphHopper.route).toHaveBeenCalledTimes(1);
  });

  it('honours abort: no GraphHopper call after the signal fires', async () => {
    const graphHopper = { route: vi.fn().mockResolvedValue({ time: 60_000 }) } as any;
    const service = new GraphHopperWalkabilityService(graphHopper);
    const controller = new AbortController();
    controller.abort();
    const result = await service.minutesBetween({ lat: 1, lon: 1 }, { lat: 1.001, lon: 1.001 }, { signal: controller.signal });
    expect(result).toBeNull();
    expect(graphHopper.route).not.toHaveBeenCalled();
  });
});

/** Realistic clustering adapter: real walkability service + real shared run
 *  budget + a fake GraphHopper client, driven through PlaceClusteringService.
 *  Proves every clustering walkability miss is budgeted, concurrency-capped
 *  and deadline/abort-aware, and that unknown results stay separate. */
describe('PlaceClustering adapter (shared run budget)', () => {
  const poi = (id: string, lat: number, lon: number) => ({ id, name: id, category: 'monument', lat, lon, included: true, estimatedVisitMinutes: 0 });

  it('caps total GraphHopper calls at the run budget (no optimistic merge after cap)', async () => {
    const graphHopper = { route: vi.fn().mockResolvedValue({ time: 60_000 }) } as any;
    const walk = new GraphHopperWalkabilityService(graphHopper);
    const clustering = new PlaceClusteringService(new VisitTimeService(), walk);
    // 5 POIs within ~115 m of each other would need ~20 directed calls to
    // complete-link-verify; the budget only allows 6. After the cap the
    // remaining pairs must stay separate, never optimistically merged.
    const budget = new OptimizationRunBudget({ maxRequests: 6, deadlineMs: 30_000, maxConcurrency: 3 });
    const pois = [0, 1, 2, 3, 4].map((i) => poi(`q${i}`, 58.7, 49.7 + i * 0.0005));
    const result = await clustering.cluster(pois, 'foot', walk, { runBudget: budget });
    expect(graphHopper.route).toHaveBeenCalledTimes(6);
    expect(budget.usedRequestCount).toBeLessThanOrEqual(6);
    // The verified prefix merged; the budget-starved tail stayed separate.
    expect(result.length).toBeGreaterThan(1);
    expect(result.some((place) => place.pois.length > 1)).toBe(true);
  });

  it('enforces the shared maxConcurrency across concurrent misses', async () => {
    const pending: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const graphHopper = {
      route: vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => pending.push(resolve));
        inFlight--;
        return { time: 60_000 };
      }),
    } as any;
    const walk = new GraphHopperWalkabilityService(graphHopper);
    const clustering = new PlaceClusteringService(new VisitTimeService(), walk);
    const budget = new OptimizationRunBudget({ maxRequests: 20, deadlineMs: 30_000, maxConcurrency: 2 });
    const pois = [0, 1, 2, 3].map((i) => poi(`c${i}`, 58.7, 49.7 + i * 0.0005));
    const run = clustering.cluster(pois, 'foot', walk, { runBudget: budget });
    // Drain: release completed waiters every few ms until the run settles.
    const timer = setInterval(() => { while (pending.length) pending.shift()!(); }, 5);
    const result = await run;
    clearInterval(timer);
    while (pending.length) pending.shift()!();
    // Real semaphore: never more than maxConcurrency GraphHopper calls in flight.
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
    // With walkable pairs all 4 merge into one Place.
    expect(result).toHaveLength(1);
  });

  it('never starts a GraphHopper call after the run deadline while waiting for a slot', async () => {
    const graphHopper = {
      route: vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); return { time: 60_000 }; }),
    } as any;
    const walk = new GraphHopperWalkabilityService(graphHopper);
    const clustering = new PlaceClusteringService(new VisitTimeService(), walk);
    // maxConcurrency=1 and a 50 ms deadline: the first directed call holds the
    // only slot for 500 ms; the reverse call waits for the slot and must give
    // up at the deadline WITHOUT ever calling GraphHopper.
    const budget = new OptimizationRunBudget({ maxRequests: 20, deadlineMs: 50, maxConcurrency: 1 });
    const pois = [0, 1, 2].map((i) => poi(`w${i}`, 58.7, 49.7 + i * 0.0005));
    const result = await clustering.cluster(pois, 'foot', walk, { runBudget: budget });
    // Only the very first directed call was started; nothing after the deadline.
    expect(graphHopper.route).toHaveBeenCalledTimes(1);
    expect(budget.wasDeadlineExceeded()).toBe(true);
    // Unknown (never-verified) results stay separate — no optimistic merge.
    expect(result).toHaveLength(3);
  });

  it('keeps off-network/unknown pairs separate while staying bounded', async () => {
    const graphHopper = { route: vi.fn().mockRejectedValue(new Error('off graph')) } as any;
    const walk = new GraphHopperWalkabilityService(graphHopper);
    const clustering = new PlaceClusteringService(new VisitTimeService(), walk);
    const budget = new OptimizationRunBudget({ maxRequests: 10, deadlineMs: 5_000, maxConcurrency: 2 });
    const pois = [0, 1, 2].map((i) => poi(`u${i}`, 58.7, 49.7 + i * 0.0005));
    const result = await clustering.cluster(pois, 'foot', walk, { runBudget: budget });
    // Every pair is unknown → every POI is its own Place (never optimistically merged).
    expect(result).toHaveLength(3);
    // The run stayed within the request budget (no unbounded retry loop).
    expect(graphHopper.route.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
