import { describe, expect, it } from 'vitest';
import { AutoItineraryOptimizerService, LockedSetOverBudgetError } from './auto-itinerary-optimizer.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { PlaceClusteringService } from './place-clustering.service';
import { VisitTimeService } from './visit-time.service';
import { LoopQualityService } from '../routing/loop-quality.service';
import { ItineraryScoreService } from './itinerary-score.service';
import { LocalityGuardService } from './locality-guard.service';
import { SelectionDiagnosticsLogger } from './selection-diagnostics.logger';

const polygon = { type: 'Polygon', coordinates: [[[49, 58], [50, 58], [50, 59], [49, 59], [49, 58]]] };
const route = (count: number, duration = 600) => ({ distance: 1000 * count, duration: duration * count, ascend: 100, descend: 100, profile: 'foot', bbox: [49, 58, 50, 59] as [number, number, number, number], geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[49.5, 58.5], [49.51, 58.51], [49.5, 58.5]] }, properties: {} } });
const rows = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, category: i % 2 ? 'nature' : 'museum', lat: 58.5 + i / 1000, lon: 49.5 + i / 1000, featured: i === 0, popularityScore: 20 - i }));
function state(places: any[] = [], budgetMinutes = 180): any {
  return { status: 'ready', start: { lat: 58.5, lon: 49.5 }, profile: 'foot', loop: true, preset: 'balanced', intent: 'auto_budget', stopPace: 'quick', budgetMode: 'whole_trip', budgetMinutes, reserveMinutes: 5, places, warnings: [], suggestions: [], totals: { travelMinutes: 0, stopMinutes: 0, reserveMinutes: 5, totalMinutes: 5, budgetMinutes, feasible: true, overBudgetMinutes: 0, remainingMinutes: budgetMinutes - 5 } };
}
function optimizer(duration = 600) {
  const pois: any = { listCoveredByPolygon: async () => ({ items: rows, total: rows.length }) };
  const routing: any = { isochrone: async () => ({ geojson: polygon }), plan: async ({ waypoints }: any) => ({ routes: [route(waypoints.length, duration)], order: [], loop: true, optimize: false }) };
  const visit = new VisitTimeService();
  return new AutoItineraryOptimizerService(pois, routing, new PlaceClusteringService(visit), new ItineraryBudgetService(), new LoopQualityService(), visit, new ItineraryScoreService(new LoopQualityService(), new ItineraryBudgetService()), new LocalityGuardService(), new SelectionDiagnosticsLogger());
}

describe('AutoItineraryOptimizerService', () => {
  it('treats preferred categories as a ranking signal, uses quick stop pace and keeps stable balanced scoring', async () => {
    const first = await optimizer().optimize(state(), { preferredCategories: ['nature'], seed: 7 });
    const second = await optimizer().optimize(state(), { preferredCategories: ['nature'], seed: 7 });
    expect(first.state.places.flatMap((place) => place.pois).some((poi) => poi.category === 'nature')).toBe(true);
    expect(first.state.places.every((place) => place.visitMode === 'glance')).toBe(true);
    expect(first.state.totals.travelMinutes).toBeGreaterThan(0);
    expect(first.state.totals.totalMinutes).toBeLessThanOrEqual(180);
    expect(first.state.scoreBreakdown).toEqual(second.state.scoreBreakdown);
    expect(first.state.scoreBreakdown?.total).toBeLessThanOrEqual(100);
    expect(first.state.autoFillSummary?.candidateClusters).toBeGreaterThan(0);
    expect(typeof first.state.autoFillSummary?.candidateClusters).toBe('number');
  });

  it('does not reject a reachable route when a preferred category is unavailable', async () => {
    const result = await optimizer().optimize(state(), { preferredCategories: ['heritage'] });
    expect(result.state.places.length).toBeGreaterThan(0);
    expect(result.state.places.flatMap((place) => place.pois).some((poi) => poi.category === 'heritage')).toBe(false);
  });

  it('keeps a compact Slobodskoy-style cluster instead of a distant featured singleton', async () => {
    const start = { lat: 58.7332, lon: 50.1854 };
    const slobodskoyPolygon = { type: 'Polygon', coordinates: [[[50.0, 58.60], [50.40, 58.60], [50.40, 58.85], [50.0, 58.85], [50.0, 58.60]]] };
    const dense = [
      ['near-heritage', 'heritage', 58.7334, 50.1856],
      ['near-monument', 'monument', 58.7330, 50.1859],
      ['near-sights', 'sights', 58.7329, 50.1850],
      ['near-religion', 'religion', 58.7336, 50.1852],
      ['near-nature', 'nature', 58.7331, 50.1861],
    ].map(([id, category, lat, lon]) => ({ id, name: id, category, lat, lon, featured: false, popularityScore: 4 }));
    const far = { id: 'far-museum', name: 'Far museum', category: 'museum', lat: 58.6900, lon: 50.2000, featured: true, popularityScore: 100 };
    const pois: any = { listCoveredByPolygon: async () => ({ items: [...dense, far], total: 6 }) };
    const routing: any = {
      isochrone: async () => ({ geojson: slobodskoyPolygon }),
      plan: async ({ waypoints }: any) => {
        const includesFar = waypoints.some((point: { lat: number }) => point.lat < 58.70);
        const duration = includesFar ? 52 * 60 : waypoints.length * 5 * 60;
        return { routes: [{ ...route(waypoints.length, 1), duration, profile: 'bike', geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[start.lon, start.lat], ...waypoints.map((p: any) => [p.lon, p.lat]), [start.lon, start.lat]] }, properties: {} } }], order: [], loop: true, optimize: false };
      },
    };
    const visit = new VisitTimeService();
    const service = new AutoItineraryOptimizerService(pois, routing, new PlaceClusteringService(visit), new ItineraryBudgetService(), new LoopQualityService(), visit, new ItineraryScoreService(new LoopQualityService(), new ItineraryBudgetService()));
    const result = await service.optimize({ ...state([], 60), start, profile: 'bike' }, {
      preferredCategories: ['heritage', 'monument', 'sights', 'religion', 'nature', 'museum'], seed: 17,
    });
    const ids = result.state.places.flatMap((place) => place.pois.map((poi) => poi.id));
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain('far-museum');
    expect(result.state.totals.totalMinutes).toBeLessThanOrEqual(60);
  });

  it('keeps locked/manual Places and reports their infeasible hard budget', async () => {
    const locked = { id: 'locked', name: 'Locked', center: { lat: 58.5, lon: 49.5 }, pois: [], visitMode: 'visit', dwellMinutes: 20, arrivalOverheadMinutes: 0, source: 'manual', locked: true, clusterConfidence: 'manual' };
    await expect(optimizer(7200).optimize(state([locked], 30), { categories: ['nature'] })).rejects.toBeInstanceOf(LockedSetOverBudgetError);
  });

  it('bounds a stalled routing adapter by the request deadline', async () => {
    const stalled: any = optimizer();
    (stalled as any).routing.isochrone = () => new Promise(() => undefined);
    const started = Date.now();
    await expect(stalled.optimize(state(), { deadlineMs: 1 })).rejects.toThrow('deadline');
    expect(Date.now() - started).toBeLessThan(900);
  });

  it('flags an out-and-back loop but stays silent for a genuine ring', async () => {
    // Out-and-back geometry: out along one road, back the same way.
    const outAndBack = { distance: 2000, duration: 1200, ascend: 0, descend: 0, profile: 'foot', bbox: [49, 58, 50, 59] as [number, number, number, number], geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[49.5, 58.5], [49.6, 58.5], [49.5, 58.5]] }, properties: {} } };
    // Genuine ring: a square that never retraces a segment.
    const ring = { ...outAndBack, geojson: { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[49.5, 58.5], [49.52, 58.5], [49.52, 58.52], [49.5, 58.52], [49.5, 58.5]] }, properties: {} } };
    const square = (geo: typeof outAndBack) => {
      const o: any = optimizer();
      (o as any).pois.listCoveredByPolygon = async () => ({ items: rows, total: rows.length });
      (o as any).routing.plan = async () => ({ routes: [geo], order: [0], loop: true, optimize: false });
      return o;
    };
    const bad = await square(outAndBack).optimize(state(), { preferredCategories: ['nature'], seed: 1 });
    expect(bad.state.warnings.some((w: any) => w.code === 'UNAVOIDABLE_OUT_AND_BACK')).toBe(true);
    const good = await square(ring).optimize(state(), { preferredCategories: ['nature'], seed: 1 });
    expect(good.state.warnings.some((w: any) => w.code === 'UNAVOIDABLE_OUT_AND_BACK')).toBe(false);
  });
});
