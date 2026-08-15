import { describe, expect, it } from 'vitest';
import { RouteCostCacheService, type RouteCostCacheKey } from './route-cost-cache.service';

function key(profile: string, ep: string, gv = 'v1', mv = 'm1'): RouteCostCacheKey {
  return { profile, directedEndpoints: ep, graphVersion: gv, modelVersion: mv };
}

describe('RouteCostCacheService', () => {
  it('stores and retrieves confirmed costs', () => {
    const cache = new RouteCostCacheService();
    const k = key('bike', '58.5,49.5>58.6,49.6');
    cache.set(k, { seconds: 300, meters: 1200 });
    const result = cache.get(k);
    expect(result.hit).toBe(true);
    if (result.hit) expect(result.value).toEqual({ seconds: 300, meters: 1200 });
  });

  it('stores and retrieves null (unreachable) results', () => {
    const cache = new RouteCostCacheService();
    const k = key('bike', '58.5,49.5>58.6,49.6');
    cache.set(k, null);
    const result = cache.get(k);
    expect(result.hit).toBe(true);
    if (result.hit) expect(result.value).toBeNull();
  });

  it('returns miss for unknown keys', () => {
    const cache = new RouteCostCacheService();
    const result = cache.get(key('bike', '99,99>88,88'));
    expect(result.hit).toBe(false);
  });

  it('coalesces concurrent identical requests', async () => {
    const cache = new RouteCostCacheService();
    const k = key('bike', '58.5,49.5>58.6,49.6');
    let calls = 0;
    const producer = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { seconds: 200, meters: 800 };
    };
    const [a, b, c] = await Promise.all([cache.coalesce(k, producer), cache.coalesce(k, producer), cache.coalesce(k, producer)]);
    expect(calls).toBe(1);
    expect(a).toEqual({ seconds: 200, meters: 800 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('invalidates on graph/model version change', () => {
    const cache = new RouteCostCacheService();
    const k1 = key('bike', '58.5,49.5>58.6,49.6', 'graph-v1', 'model-v1');
    cache.set(k1, { seconds: 300, meters: 1200 });
    const k2 = key('bike', '58.5,49.5>58.6,49.6', 'graph-v2', 'model-v1');
    expect(cache.get(k2).hit).toBe(false);
  });

  it('separates cache entries by routing profile', () => {
    const cache = new RouteCostCacheService();
    const ep = '58.5,49.5>58.6,49.6';
    cache.set(key('bike', ep), { seconds: 300, meters: 1200 });
    expect(cache.get(key('foot', ep)).hit).toBe(false);
    expect(cache.get(key('mtb', ep)).hit).toBe(false);
    expect(cache.get(key('bike', ep)).hit).toBe(true);
  });

  it('separates directed endpoints (a→b differs from b→a)', () => {
    const cache = new RouteCostCacheService();
    const ab = '58.5,49.5>58.6,49.6';
    const ba = '58.6,49.6>58.5,49.5';
    cache.set(key('bike', ab), { seconds: 300, meters: 1200 });
    expect(cache.get(key('bike', ba)).hit).toBe(false);
    expect(cache.get(key('bike', ab)).hit).toBe(true);
  });

  it('separates cache entries by model version', () => {
    const cache = new RouteCostCacheService();
    const ep = '58.5,49.5>58.6,49.6';
    cache.set(key('bike', ep, 'g1', 'model-a'), { seconds: 300, meters: 1200 });
    expect(cache.get(key('bike', ep, 'g1', 'model-b')).hit).toBe(false);
  });

  it('respects NV_ROUTING_CACHE_BUST namespace', () => {
    process.env.NV_ROUTING_CACHE_BUST = 'bust-1';
    const cache1 = new RouteCostCacheService();
    const k = key('bike', '58.5,49.5>58.6,49.6');
    cache1.set(k, { seconds: 300, meters: 1200 });
    process.env.NV_ROUTING_CACHE_BUST = 'bust-2';
    const cache2 = new RouteCostCacheService();
    expect(cache2.get(k).hit).toBe(false);
    process.env.NV_ROUTING_CACHE_BUST = '';
  });

  it('FIFO-bounds the cache size', () => {
    const cache = new RouteCostCacheService();
    // Fill beyond maxEntries
    for (let i = 0; i < 2100; i++) {
      cache.set(key('bike', `58.${i},49.5>58.6,49.6`), { seconds: 1, meters: 1 });
    }
    expect(cache.size).toBeLessThanOrEqual(2000);
  });
});
