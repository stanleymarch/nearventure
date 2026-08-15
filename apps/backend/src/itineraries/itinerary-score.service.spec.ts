import { describe, expect, it } from 'vitest';
import { ItineraryScoreService, type ScoreInput } from './itinerary-score.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { LoopQualityService } from '../routing/loop-quality.service';
import type { RoutePlace } from './itinerary.types';

const scorer = new ItineraryScoreService(new LoopQualityService(), new ItineraryBudgetService());

/** A minimal place at a given coordinate; poiQuality grows with extra pois. */
function place(id: string, category: string, lat = 58.5, lon = 49.5): RoutePlace {
  return { id, name: id, center: { lat, lon }, pois: [{ id, name: id, category, lat, lon, included: true, estimatedVisitMinutes: 0 }], visitMode: 'visit', dwellMinutes: 20, arrivalOverheadMinutes: 5, source: 'manual', locked: false, clusterConfidence: 'manual' };
}
/** Non-overlapping triangle route ≈ a real loop; out-and-back reuses one point. */
function route(repeated: boolean) {
  const coords = repeated ? [[49.5, 58.5], [49.6, 58.6], [49.5, 58.5]] : [[49.5, 58.5], [49.6, 58.6], [49.7, 58.5], [49.5, 58.5]];
  return { distance: 3000, duration: 1200, ascend: 100, descend: 100, profile: 'foot' as const, bbox: [49.5, 58.5, 49.7, 58.6] as [number, number, number, number], geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties: {} } };
}
function input(overrides: Partial<ScoreInput>): ScoreInput {
  return { places: [], route: route(false), start: { lat: 58.5, lon: 49.5 }, profile: 'foot', preset: 'balanced', preferredCategories: [], budgetMinutes: 120, budgetMode: 'whole_trip', reserveMinutes: 5, ...overrides };
}

describe('ItineraryScoreService', () => {
  it('ranks a dense local cluster above a single distant featured POI', () => {
    // Five nearby places share the start sector; the singleton sits far away.
    const cluster = [place('a', 'monument', 58.5, 49.5), place('b', 'nature', 58.501, 49.5), place('c', 'museum', 58.5, 49.501), place('d', 'religion', 58.501, 49.501), place('e', 'sights', 58.5005, 49.5005)];
    const singleton = [place('far', 'monument', 59.5, 50.5)];
    const clusterScore = scorer.score(input({ places: cluster })).score.total;
    const singletonScore = scorer.score(input({ places: singleton })).score.total;
    expect(clusterScore).toBeGreaterThan(singletonScore);
  });

  it('rewards visiting preferred categories without making them hard constraints', () => {
    const base = [place('a', 'nature'), place('b', 'museum')];
    const withoutPref = scorer.score(input({ places: base, preferredCategories: [] })).score.total;
    const withPref = scorer.score(input({ places: base, preferredCategories: ['nature', 'museum'] })).score.total;
    expect(withPref).toBeGreaterThan(withoutPref);
    // A route that misses every preferred category still scores — preferences
    // only add, they never zero a feasible plan.
    const miss = scorer.score(input({ places: base, preferredCategories: ['religion', 'heritage'] })).score.total;
    expect(miss).toBeGreaterThan(0);
  });

  it('penalizes a route whose profile does not match the request', () => {
    const places = [place('a', 'monument')];
    const matching = scorer.score(input({ places, profile: 'foot', route: { ...route(false), profile: 'foot' } })).score;
    const mismatched = scorer.score(input({ places, profile: 'bike', route: { ...route(false), profile: 'foot' } })).score;
    expect(matching.profileRoadFit).toBeGreaterThan(0);
    expect(mismatched.profileRoadFit).toBe(0);
    expect(matching.total).toBeGreaterThan(mismatched.total);
  });

  it('penalizes an unavoidable out-and-back versus a clean loop', () => {
    const places = [place('a', 'monument', 58.55, 49.55)];
    const loop = scorer.score(input({ places, route: route(false) })).score;
    const outAndBack = scorer.score(input({ places, route: route(true) })).score;
    expect(loop.loopOverlap).toBeGreaterThanOrEqual(outAndBack.loopOverlap);
    expect(loop.total).toBeGreaterThanOrEqual(outAndBack.total);
  });

  it('normalizes budget utilization so a fuller feasible plan is preferred', () => {
    const places = [place('a', 'monument'), place('b', 'nature'), place('c', 'museum')];
    const slim = scorer.score(input({ places, route: { ...route(false), duration: 300 } }));
    const full = scorer.score(input({ places, route: { ...route(false), duration: 6000 } }));
    expect(full.score.budgetUtilization).toBeGreaterThan(slim.score.budgetUtilization);
  });

  it('travelEfficiency penalizes a zigzag order and is included in the total', () => {
    // The same five places on a line: a smooth sweep vs a back-and-forth bounce.
    const line = [place('a', 'monument', 58.50, 49.50), place('b', 'monument', 58.501, 49.501), place('c', 'monument', 58.502, 49.502), place('d', 'monument', 58.503, 49.503), place('e', 'monument', 58.504, 49.504)];
    const smooth = scorer.score(input({ places: line })).score.travelEfficiency;
    const zigzag = scorer.score(input({ places: [line[0], line[3], line[1], line[4], line[2]] })).score.travelEfficiency;
    expect(smooth).toBeGreaterThan(zigzag);
    // The component is part of the reported breakdown and total.
    const full = scorer.score(input({ places: line })).score;
    expect(full.total).toBeCloseTo(full.uniquePoiQuality + full.categoryDiversity + full.geographicDiversity + full.travelEfficiency + full.loopOverlap + full.profileRoadFit + full.budgetUtilization + full.elevation, 6);
    // A uniform sweep scores near the top of its weight for balanced (5).
    expect(smooth).toBeGreaterThan(3);
  });
});

describe('ItineraryScoreService.compare (lexicographic)', () => {
  function totals(feasible: boolean, travel = 60, budget = 120) {
    return { travelMinutes: travel, stopMinutes: 10, reserveMinutes: 5, totalMinutes: travel + 15, budgetMinutes: budget, feasible, overBudgetMinutes: feasible ? 0 : 20, remainingMinutes: feasible ? Math.max(0, budget - travel - 15) : 0 } as any;
  }
  const routeA = route(false);
  const routeB = route(true);

  it('level 1: a feasible solution beats an infeasible one regardless of POI value', () => {
    const a = { places: [place('a', 'monument')], route: routeA, totals: totals(true), localityViolations: 0, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    const b = { places: [place('x', 'monument'), place('y', 'museum'), place('z', 'nature')], route: routeA, totals: totals(false), localityViolations: 0, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    expect(scorer.compare(a as any, b as any)).toBe(-1);
  });

  it('level 2: fewer locality violations wins even with identical feasibility', () => {
    const a = { places: [place('a', 'monument')], route: routeA, totals: totals(true), localityViolations: 0, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    const b = { places: [place('x', 'monument'), place('y', 'museum')], route: routeA, totals: totals(true), localityViolations: 1, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    expect(scorer.compare(a as any, b as any)).toBe(-1);
  });

  it('level 3: more unique POIs wins at equal feasibility and locality', () => {
    const a = { places: [place('a', 'monument'), place('b', 'nature'), place('c', 'museum')], route: routeA, totals: totals(true), localityViolations: 0, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    const b = { places: [place('x', 'monument')], route: routeA, totals: totals(true), localityViolations: 0, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    expect(scorer.compare(a as any, b as any)).toBe(-1);
  });

  it('level 7: budget utilization cannot compensate for a locality violation', () => {
    // b fills the budget completely but has a locality violation; a has spare budget but is clean.
    const a = { places: [place('a', 'monument')], route: routeA, totals: totals(true, 50), localityViolations: 0, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    const b = { places: [place('x', 'monument'), place('y', 'museum'), place('z', 'nature')], route: routeA, totals: totals(true, 110), localityViolations: 1, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    expect(scorer.compare(a as any, b as any)).toBe(-1);
  });

  it('returns 0 for identical solutions', () => {
    const a = { places: [place('a', 'monument')], route: routeA, totals: totals(true), localityViolations: 0, budgetMinutes: 120, start: { lat: 58.5, lon: 49.5 } };
    expect(scorer.compare(a as any, { ...a } as any)).toBe(0);
  });
});
