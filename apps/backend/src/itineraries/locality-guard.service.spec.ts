import { describe, expect, it } from 'vitest';
import { LocalityGuardService } from './locality-guard.service';
import type { RoutePlace } from './itinerary.types';

const START = { lat: 58.7327, lon: 50.1772 };

function makePlace(id: string, lat: number, lon: number, opts: Partial<RoutePlace> = {}): RoutePlace {
  return {
    id, name: id, center: { lat, lon }, pois: [{ id: `${id}-poi`, name: id, category: 'heritage', lat, lon, included: true, estimatedVisitMinutes: 0 }],
    visitMode: 'pass_by', dwellMinutes: 0, arrivalOverheadMinutes: 0, source: 'auto', locked: false, clusterConfidence: 'walkable',
    ...opts,
  };
}

function makeCluster(id: string, lat: number, lon: number): RoutePlace {
  return {
    ...makePlace(id, lat, lon),
    pois: [
      { id: `${id}-a`, name: `${id}-a`, category: 'heritage', lat, lon, included: true, estimatedVisitMinutes: 0 },
      { id: `${id}-b`, name: `${id}-b`, category: 'monument', lat: lat + 0.0001, lon: lon + 0.0001, included: true, estimatedVisitMinutes: 0 },
    ],
  };
}

describe('LocalityGuardService', () => {
  const guard = new LocalityGuardService();

  it('excludes an automatic isolated singleton when a dense local offer exists', async () => {
    const places = [
      makePlace('local-1', 58.7330, 50.1770),
      makePlace('local-2', 58.7325, 50.1775),
      makePlace('local-3', 58.7320, 50.1780),
      makePlace('remote-single', 58.6706, 50.1419), // ~7.2 km away
    ];
    const result = await guard.guard(places, START);
    expect(result.applied).toBe(true);
    expect(result.excluded.map((p) => p.id)).toContain('remote-single');
    expect(result.admissible.map((p) => p.id)).not.toContain('remote-single');
    expect(result.admissible.length).toBe(3);
  });

  it('keeps a remote multi-POI cluster (distance alone is not disqualifying)', async () => {
    const places = [
      makePlace('local-1', 58.7330, 50.1770),
      makePlace('local-2', 58.7325, 50.1775),
      makeCluster('remote-cluster', 58.6740, 50.1500), // ~7 km but 2 POIs
    ];
    const result = await guard.guard(places, START);
    expect(result.applied).toBe(false);
    expect(result.admissible.map((p) => p.id)).toContain('remote-cluster');
  });

  it('never excludes manual or locked places', async () => {
    const places = [
      makePlace('local-1', 58.7330, 50.1770),
      makePlace('local-2', 58.7325, 50.1775),
      makePlace('manual-remote', 58.6800, 50.1600, { source: 'manual' }),
      makePlace('locked-remote', 58.6850, 50.1650, { locked: true }),
    ];
    const result = await guard.guard(places, START);
    expect(result.excluded.length).toBe(0);
    expect(result.admissible.map((p) => p.id)).toContain('manual-remote');
    expect(result.admissible.map((p) => p.id)).toContain('locked-remote');
  });

  it('featured/popular status does not override the guard', async () => {
    const places = [
      makePlace('local-1', 58.7330, 50.1770),
      makePlace('local-2', 58.7325, 50.1775),
      makePlace('featured-remote', 58.6706, 50.1419, { pois: [{ id: 'featured-remote-poi', name: 'Featured', category: 'nature', lat: 58.6706, lon: 50.1419, included: true, estimatedVisitMinutes: 0 }] }),
    ];
    const result = await guard.guard(places, START);
    expect(result.excluded.map((p) => p.id)).toContain('featured-remote');
  });

  it('does not apply the guard when there is no dense local offer', async () => {
    const places = [
      makePlace('remote-1', 58.6706, 50.1419),
      makePlace('remote-2', 58.6800, 50.1600),
    ];
    const result = await guard.guard(places, START);
    expect(result.applied).toBe(false);
    expect(result.admissible.length).toBe(2);
  });

  it('uses a network cost function when provided', async () => {
    const places = [
      makePlace('local-1', 58.7330, 50.1770),
      makePlace('local-2', 58.7325, 50.1775),
      makePlace('remote-single', 58.6706, 50.1419),
    ];
    // Simulate a high network cost for the remote singleton.
    const costFn = async (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const dy = Math.abs(a.lat - b.lat);
      return dy > 0.05 ? 999999 : Math.abs(a.lat - b.lat) + Math.abs(a.lon - b.lon);
    };
    const result = await guard.guard(places, START, costFn);
    expect(result.applied).toBe(true);
    expect(result.excluded.map((p) => p.id)).toContain('remote-single');
  });

  it('returns an empty result for an empty input', async () => {
    const result = await guard.guard([], START);
    expect(result.admissible).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.applied).toBe(false);
  });
});
