import { describe, expect, it, vi } from 'vitest';
import { RoutesService } from '../routes/routes.service';

describe('RoutesService itinerary publication', () => {
  it('writes sourceDraftId and an immutable full itinerary snapshot', async () => {
    const repo: any = { create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
    const service = new RoutesService(repo, {} as any);
    const draft: any = {
      id: '11111111-1111-4111-8111-111111111111', version: 4, status: 'ready', profile: 'foot', loop: false, budgetMinutes: 60,
      totals: { feasible: true }, route: { distance: 1000, duration: 600, ascend: 10, descend: 5, geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} } },
      places: [{ pois: [{ id: 'p', name: 'POI', category: 'museum', lat: 1, lon: 1, included: true }] }],
    };
    const saved = await service.publishFromItinerary(draft, 'client:owner');
    draft.places[0].pois[0].name = 'mutated';
    expect(saved.sourceDraftId).toBe(draft.id);
    expect((saved.itinerarySnapshot as any).places[0].pois[0].name).toBe('POI');
    expect((saved.itinerarySnapshot as any).version).toBe(4);
    expect((saved.itinerarySnapshot as any).route.geojson).toEqual(draft.route.geojson);
    expect(saved).toMatchObject({ status: 'published', createdBy: 'client:owner', isPublished: true, loop: false });
  });

  it('rejects unrouted or infeasible drafts', async () => {
    const service = new RoutesService({} as any, {} as any);
    await expect(service.publishFromItinerary({ totals: { feasible: false } } as any, 'owner')).rejects.toThrow('feasible routed');
  });
});
