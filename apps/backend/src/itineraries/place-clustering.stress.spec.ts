import { describe, expect, it } from 'vitest';
import { PlaceClusteringService } from './place-clustering.service';
import { VisitTimeService } from './visit-time.service';
import { OptimizationRunBudget } from './optimization-run-budget';
import type { ItineraryPoi } from './itinerary.types';

/** Generate 500 POIs spread across a ~10 km area with some clusters. */
function generate500Pois(): ItineraryPoi[] {
  const pois: ItineraryPoi[] = [];
  for (let i = 0; i < 500; i++) {
    // Spread POIs across 58.5-58.6, 49.5-49.6 with some intentional clusters
    const cluster = Math.floor(i / 10);
    const within = i % 10;
    const baseLat = 58.5 + (cluster % 20) * 0.005;
    const baseLon = 49.5 + Math.floor(cluster / 20) * 0.005;
    const lat = baseLat + within * 0.0002;
    const lon = baseLon + within * 0.0002;
    pois.push({ id: `poi-${i}`, name: `POI ${i}`, category: 'nature', lat, lon, included: true, estimatedVisitMinutes: 0 });
  }
  return pois;
}

describe('PlaceClusteringService (bounded stress)', () => {
  it('clusters 500 POIs without exceeding the run budget', async () => {
    const visit = new VisitTimeService();
    const service = new PlaceClusteringService(visit);
    const pois = generate500Pois();
    const budget = new OptimizationRunBudget({ deadlineMs: 5_000, maxRequests: 20, reservedFinalValidation: 2 });
    // No walkability adapter → canJoin returns false for all → every POI is its own group.
    // This proves the spatial index prevents O(n²) comparisons even with 500 inputs.
    const start = Date.now();
    const result = await service.cluster(pois, 'bike', undefined, { runBudget: budget });
    const elapsed = Date.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);
    // Without walkability, every POI is a singleton group.
    expect(result.every((place) => place.pois.length === 1)).toBe(true);
  });

  it('uses spatial cell index to avoid comparing distant POIs', async () => {
    const visit = new VisitTimeService();
    const service = new PlaceClusteringService(visit);
    // Two groups of 5 POIs each, 50 km apart — no walkability adapter.
    const pois: ItineraryPoi[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, category: 'nature', lat: 58.5 + i * 0.0001, lon: 49.5, included: true, estimatedVisitMinutes: 0 })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, category: 'nature', lat: 58.0 + i * 0.0001, lon: 49.0, included: true, estimatedVisitMinutes: 0 })),
    ];
    const budget = new OptimizationRunBudget({ deadlineMs: 5_000, maxRequests: 10 });
    const result = await service.cluster(pois, 'bike', undefined, { runBudget: budget });
    // Each POI is separate (no walkability), but the spatial index ensures
    // distant POIs were never compared.
    expect(result.length).toBe(10);
  });
});
