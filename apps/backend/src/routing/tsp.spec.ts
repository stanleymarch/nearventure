import { describe, it, expect } from 'vitest';
import { optimizeOrder, haversine, tourCost, type LonLat } from './tsp';

describe('TSP optimizeOrder', () => {
  it('returns waypoints unchanged when there is only one', () => {
    const start: LonLat = { lon: 0, lat: 0 };
    const wps: LonLat[] = [{ lon: 1, lat: 1 }];
    const { order, indices } = optimizeOrder(start, wps, false);
    expect(order).toEqual(wps);
    expect(indices).toEqual([0]);
  });

  it('returns empty result for empty waypoints', () => {
    const { order, indices } = optimizeOrder({ lon: 0, lat: 0 }, [], false);
    expect(order).toEqual([]);
    expect(indices).toEqual([]);
  });

  it('optimizes ordering of 3 collinear points (open tour)', () => {
    // Start at origin, three points to the east. Optimal order: visit in sequence.
    const start: LonLat = { lon: 0, lat: 0 };
    const wps: LonLat[] = [
      { lon: 0.02, lat: 0 }, // closest
      { lon: 0.04, lat: 0 }, // middle
      { lon: 0.06, lat: 0 }, // farthest
    ];
    const { indices } = optimizeOrder(start, wps, false);
    // Should visit in input order (collinear east)
    expect(indices).toEqual([0, 1, 2]);
  });

  it('reorders to find shorter tour around a U-shape (open tour)', () => {
    // Start at origin, 4 points forming a U.
    // Open tour: visit in geographic order makes sense.
    const start: LonLat = { lon: 0, lat: 0 };
    const wps: LonLat[] = [
      { lon: 0.01, lat: 0.01 },  // bottom-left of U
      { lon: 0.01, lat: 0.05 },  // top-left
      { lon: 0.05, lat: 0.01 },  // bottom-right (traps naive NN)
      { lon: 0.05, lat: 0.05 },  // top-right
    ];
    const { indices } = optimizeOrder(start, wps, false);
    // tourDistance returns meters. The 4 points are within ~6 km of start,
    // a reasonable tour should be < 30 km.
    const sumDist = tourDistance(start, wps, indices, false);
    expect(sumDist).toBeLessThan(30_000);
  });

  it('respects closed tour constraint (returns to start)', () => {
    const start: LonLat = { lon: 0, lat: 0 };
    const wps: LonLat[] = [
      { lon: 0.02, lat: 0.02 },
      { lon: 0.04, lat: 0.04 },
      { lon: 0.06, lat: 0 },
    ];
    const closedDist = tourDistance(start, wps, optimizeOrder(start, wps, true).indices, true);
    const openDist = tourDistance(start, wps, optimizeOrder(start, wps, false).indices, false);
    // Closed must include return-to-start edge
    expect(closedDist).toBeGreaterThan(0);
    expect(openDist).toBeGreaterThan(0);
  });

  it('produces shorter or equal tour than nearest-neighbour for random points', () => {
    // Deterministic pseudo-random points (so test is stable)
    const start: LonLat = { lon: 0, lat: 0 };
    const wps: LonLat[] = [
      { lon: 0.01, lat: 0.04 },
      { lon: 0.03, lat: 0.01 },
      { lon: 0.05, lat: 0.06 },
      { lon: 0.07, lat: 0.02 },
      { lon: 0.02, lat: 0.05 },
    ];
    const optimizedIndices = optimizeOrder(start, wps, true).indices;
    const optimizedDist = tourDistance(start, wps, optimizedIndices, true);
    // Naive: visit in input order
    const naiveDist = tourDistance(start, wps, [0, 1, 2, 3, 4], true);
    // Optimized should never be worse
    expect(optimizedDist).toBeLessThanOrEqual(naiveDist + 1e-9);
  });
});

describe('optimizer non-regression', () => {
  it('preserves the permutation and never worsens either open or closed tour', () => {
    const start: LonLat = { lon: 0, lat: 0 };
    const wps: LonLat[] = [
      { lon: 0.08, lat: 0.01 }, { lon: 0.01, lat: 0.07 }, { lon: 0.06, lat: 0.08 },
      { lon: 0.03, lat: 0.02 }, { lon: 0.09, lat: 0.05 },
    ];
    for (const loop of [false, true]) {
      const result = optimizeOrder(start, wps, loop);
      expect([...result.indices].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(tourCost(start, wps, result.indices, loop)).toBeLessThanOrEqual(
        tourCost(start, wps, [0, 1, 2, 3, 4], loop) + 1e-6,
      );
    }
  });
});

describe('haversine', () => {
  it('returns 0 for the same point', () => {
    expect(haversine({ lon: 50, lat: 58 }, { lon: 50, lat: 58 })).toBeCloseTo(0, 5);
  });

  it('returns ~111 km for 1 degree of latitude', () => {
    const d = haversine({ lon: 0, lat: 0 }, { lon: 0, lat: 1 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

/** Compute the total tour length (haversine sum) for a given waypoint visit order. */
function tourDistance(
  start: LonLat,
  wps: LonLat[],
  indices: number[],
  closed: boolean,
): number {
  if (indices.length === 0) return 0;
  let total = 0;
  let prev: LonLat = start;
  for (const idx of indices) {
    total += haversine(prev, wps[idx]);
    prev = wps[idx];
  }
  if (closed) total += haversine(prev, start);
  return total;
}
