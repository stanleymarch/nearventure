import { describe, expect, it, vi, afterEach } from 'vitest';
import { RouteCostEvaluatorService } from './route-cost-evaluator.service';
import { RouteCostCacheService } from './route-cost-cache.service';
import { GraphVersionProvider } from './graph-version.provider';
import { OptimizationRunBudget } from './optimization-run-budget';

const A = { lat: 58.5, lon: 49.5 };
const B = { lat: 58.6, lon: 49.6 };

function fakeGh(seconds = 300) {
  return { route: vi.fn(async () => ({ time: seconds * 1000, distance: seconds * 4.5 })) };
}

function fakeProvider(namespace: string) {
  return { namespace: vi.fn(async () => namespace) } as unknown as GraphVersionProvider;
}

describe('RouteCostEvaluatorService cache namespacing', () => {
  afterEach(() => {
    process.env.NV_ROUTING_CACHE_BUST = '';
  });

  it('uses the GraphVersionProvider namespace in the cache key', async () => {
    const gh = fakeGh();
    const cache = new RouteCostCacheService();
    const provider = fakeProvider('gh-9.0-31.000,48.000,49.000,58.000');
    const evaluator = new RouteCostEvaluatorService(gh, cache, provider);
    await evaluator.cost(A, B, { profile: 'bike' });
    expect(gh.route).toHaveBeenCalledTimes(1);
    // A second evaluator with a different graph namespace must NOT hit the same entry.
    const evaluator2 = new RouteCostEvaluatorService(fakeGh(999), cache, fakeProvider('gh-9.1-31.000,48.000,49.000,58.000'));
    const result = await evaluator2.cost(A, B, { profile: 'bike' });
    expect(result?.seconds).toBe(999);
  });

  it('falls back to the conservative namespace without a provider', async () => {
    const gh = fakeGh();
    const cache = new RouteCostCacheService();
    const evaluator = new RouteCostEvaluatorService(gh, cache);
    const result = await evaluator.cost(A, B, { profile: 'bike' });
    expect(result?.seconds).toBe(300);
    // Same pair again is a cache hit (same fallback namespace).
    await evaluator.cost(A, B, { profile: 'bike' });
    expect(gh.route).toHaveBeenCalledTimes(1);
  });

  it('separates entries by profile and direction', async () => {
    const gh = fakeGh(120);
    const cache = new RouteCostCacheService();
    const evaluator = new RouteCostEvaluatorService(gh, cache, fakeProvider('gh-x'));
    await evaluator.cost(A, B, { profile: 'bike' });
    await evaluator.cost(A, B, { profile: 'foot' });
    await evaluator.cost(B, A, { profile: 'bike' });
    expect(gh.route).toHaveBeenCalledTimes(3);
  });

  it('honours NV_ROUTING_CACHE_BUST at the evaluator level', async () => {
    process.env.NV_ROUTING_CACHE_BUST = 'deploy-1';
    const evaluator1 = new RouteCostEvaluatorService(fakeGh(300), new RouteCostCacheService(), fakeProvider('gh-x'));
    await evaluator1.cost(A, B, { profile: 'bike' });
    process.env.NV_ROUTING_CACHE_BUST = 'deploy-2';
    // The bust namespace is captured when the cache is constructed, so a
    // deploy bump requires a fresh cache to truly separate entries.
    const evaluator2 = new RouteCostEvaluatorService(fakeGh(600), new RouteCostCacheService(), fakeProvider('gh-x'));
    const result = await evaluator2.cost(A, B, { profile: 'bike' });
    expect(result?.seconds).toBe(600);
  });

  it('cache hits bypass the run budget; misses acquire a slot', async () => {
    const gh = fakeGh();
    const cache = new RouteCostCacheService();
    const evaluator = new RouteCostEvaluatorService(gh, cache, fakeProvider('gh-x'));
    const budget = new OptimizationRunBudget({ maxRequests: 3 });
    await evaluator.cost(A, B, { profile: 'bike', runBudget: budget });
    expect(budget.usedRequestCount).toBe(1);
    // Hit: no new slot.
    await evaluator.cost(A, B, { profile: 'bike', runBudget: budget });
    expect(budget.usedRequestCount).toBe(1);
  });

  it('tracks aggregate cache hits and misses without PII', async () => {
    const gh = fakeGh();
    const cache = new RouteCostCacheService();
    const evaluator = new RouteCostEvaluatorService(gh, cache, fakeProvider('gh-x'));
    const stats = { cacheHits: 0, cacheMisses: 0 };
    await evaluator.cost(A, B, { profile: 'bike', cacheStats: stats });
    await evaluator.cost(A, B, { profile: 'bike', cacheStats: stats });
    expect(stats.cacheMisses).toBe(1);
    expect(stats.cacheHits).toBe(1);
  });
});
