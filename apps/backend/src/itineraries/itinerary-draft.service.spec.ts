import { describe, expect, it, vi } from 'vitest';
import { ItineraryDraftService } from './itinerary-draft.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { VisitTimeService } from './visit-time.service';
import { PlaceClusteringService } from './place-clustering.service';

function harness(optimizer?: any) {
  let draft: any;
  const receipts = new Map<string, any>();
  const drafts: any = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => (draft = { ...value, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') })),
    findOne: vi.fn(async ({ where }: any) => draft && draft.id === where.id && draft.ownerKey === where.ownerKey ? draft : null),
    update: vi.fn(async (where: any, value: any) => {
      if (!draft || draft.id !== where.id || draft.ownerKey !== where.ownerKey || draft.version !== where.version) return { affected: 0 };
      draft = { ...draft, ...value, updatedAt: new Date('2026-01-01T00:01:00Z') }; return { affected: 1 };
    }),
    delete: vi.fn(async (where: any) => {
      if (!draft || draft.id !== where.id || draft.ownerKey !== where.ownerKey || draft.version !== where.version) return { affected: 0 };
      draft = undefined; return { affected: 1 };
    }),
  };
  const commands: any = {
    findOne: vi.fn(async ({ where }: any) => receipts.get(`${where.draftId}:${where.commandId}`) ?? null),
    insert: vi.fn(async (value: any) => receipts.set(`${value.draftId}:${value.commandId}`, value)),
  };
  drafts.manager = { transaction: vi.fn(async (work: any) => work({ getRepository: (entity: any) => entity.name === 'ItineraryDraftEntity' ? drafts : commands })) };
  const poiRegistry = [
    { id: 'poi-a', name: 'A', category: 'monument', lat: 58.6, lon: 49.6, featured: true, popularityScore: 42 },
    { id: 'poi-b', name: 'B', category: 'nature', lat: 58.6001, lon: 49.6001 },
    { id: 'poi-c', name: 'C', category: 'monument', lat: 58.63, lon: 49.63 },
  ];
  const pois: any = {
    byId: vi.fn(async (id: string) => { const found = poiRegistry.find((poi) => poi.id === id); if (!found) throw new Error('POI not found'); return found; }),
    list: vi.fn(async () => ({ items: poiRegistry.slice(1), total: poiRegistry.length - 1 })),
  };
  const routes: any = { publishFromItinerary: vi.fn(async () => ({ id: 'saved-route' })) };
  const freshRoute = { distance: 1000, duration: 600, ascend: 10, descend: 5, profile: 'foot', bbox: [0, 0, 1, 1], geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} } };
  const routing: any = { plan: vi.fn(async () => ({ routes: [freshRoute], order: [0], loop: true, optimize: false })) };
  const visitTime = new VisitTimeService();
  const service = new ItineraryDraftService(drafts, commands, pois, new ItineraryBudgetService(), visitTime, new PlaceClusteringService(visitTime), routes, routing, optimizer);
  return { service, drafts, routes, routing, freshRoute, getDraft: () => draft };
}

const commandId = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, '0')}`;

describe('ItineraryDraftService', () => {
  it('defaults new v2 drafts to pass_by and preserves legacy quick for unversioned snapshots', async () => {
    const { service, getDraft } = harness();
    const created = await service.create('client:test-user', {
      start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100,
    } as any);
    // New drafts are v2 → pass_by (design D1)
    expect(created).toMatchObject({ intent: 'auto_budget', stopPace: 'pass_by', selectionPolicyVersion: 'v2' });
    // Simulate a legacy snapshot: strip version and stopPace entirely
    delete getDraft().state.intent;
    delete getDraft().state.stopPace;
    delete getDraft().state.selectionPolicyVersion;
    const legacy = await service.get('client:test-user', created.id);
    expect(legacy).toMatchObject({ intent: 'auto_budget', stopPace: 'quick' });
  });

  it('discards only a current unpublished owner draft and makes retries/foreign ids safe no-ops', async () => {
    const { service, getDraft } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    await service.discard('client:other-user', created.id, { expectedVersion: 1, commandId: commandId('discard-other') });
    expect(getDraft()).toBeDefined();
    await service.discard('client:test-user', created.id, { expectedVersion: 1, commandId: commandId('discard') });
    expect(getDraft()).toBeUndefined();
    await expect(service.discard('client:test-user', created.id, { expectedVersion: 1, commandId: commandId('discard-retry') })).resolves.toBeUndefined();
  });

  it('reports a machine-readable published discard conflict', async () => {
    const { service, getDraft } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true } as any);
    getDraft().state.status = 'published';
    await expect(service.discard('client:test-user', created.id, { expectedVersion: 1, commandId: commandId('published') }))
      .rejects.toMatchObject({ response: { details: { code: 'PUBLISHED_ITINERARY_IMMUTABLE' } } });
  });

  it('returns a receipt for an idempotent retry, isolates owner, and rejects stale mutation', async () => {
    const { service, drafts } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const command = { poiId: 'poi-a', expectedVersion: created.version, commandId: commandId('1') };
    const added = await service.addPoi('client:test-user', created.id, command);
    const retried = await service.addPoi('client:test-user', created.id, command);
    expect(added).toEqual(retried); expect(added.version).toBe(2); expect(added.places).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(added))).toEqual(added); expect((added as any).history).toBeUndefined();
    expect(drafts.manager.transaction).toHaveBeenCalledTimes(1);
    await expect(service.get('client:other-user', created.id)).rejects.toThrow('not found');
    await expect(service.setLocked('client:test-user', created.id, { placeId: 'poi_poi-a', locked: true, expectedVersion: 1, commandId: commandId('2') }))
      .rejects.toMatchObject({ response: { details: { code: 'ITINERARY_VERSION_CONFLICT', snapshot: { version: 2 } } } });
  });

  it('respects pass_by stopPace and retains ranking inputs when adding a manual POI', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, intent: 'manual_collection', budgetMode: 'unlimited' } as any);
    expect(created.stopPace).toBe('pass_by');
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: created.version, commandId: commandId('pb1') });
    expect(added.places[0].visitMode).toBe('pass_by');
    expect(added.places[0].dwellMinutes).toBe(0);
    expect(added.places[0].pois[0]).toMatchObject({ featured: true, popularityScore: 42, notable: true });
  });

  it('clusters four manual POIs in one explicit square and preserves locked custom state on replan', async () => {
    const { service, getDraft, routing } = harness();
    const pois = [
      { id: 'a', name: 'A', category: 'monument', lat: 58.6, lon: 49.6, explicitComplexId: 'square', popularityScore: 1 },
      { id: 'b', name: 'B', category: 'monument', lat: 58.6001, lon: 49.6001, explicitComplexId: 'square', featured: true, popularityScore: 2 },
      { id: 'c', name: 'C', category: 'monument', lat: 58.6001, lon: 49.6, explicitComplexId: 'square' },
      { id: 'd', name: 'D', category: 'monument', lat: 58.6, lon: 49.6001, explicitComplexId: 'square' },
    ];
    (service as any).pois.byId.mockImplementation(async (poiId: string) => pois.find((poi) => poi.id === poiId));
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    let current = created;
    for (const poi of pois) current = await service.addPoi('client:test-user', current.id, { poiId: poi.id, expectedVersion: current.version, commandId: commandId(`square-${poi.id}`) });
    expect(current.places).toHaveLength(1); expect(current.places[0].pois).toHaveLength(4);
    expect(current.places[0].name).toBe('B');
    expect(current.places[0].pois.filter((poi) => poi.notable).map((poi) => poi.id)).toEqual(['b']);
    current = await service.setLocked('client:test-user', current.id, { placeId: current.places[0].id, locked: true, expectedVersion: current.version, commandId: commandId('square-lock') });
    current = await service.setVisitMode('client:test-user', current.id, { placeId: current.places[0].id, mode: 'custom', customVisitMinutes: 42, expectedVersion: current.version, commandId: commandId('square-mode') });
    const replanned = await service.replan('client:test-user', current.id, { expectedVersion: current.version, commandId: commandId('square-replan') });
    expect(replanned.places[0]).toMatchObject({ locked: true, visitMode: 'custom', customVisitMinutes: 42 });
    expect(replanned.places[0].pois).toHaveLength(4); expect(routing.plan).toHaveBeenCalled(); expect(getDraft().state.places[0].locked).toBe(true);
  });

  it('invalidates route and fingerprint on reorder and remove structural commands', async () => {
    const { service, freshRoute, getDraft } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('10') });
    getDraft().state.route = freshRoute; getDraft().state.routeFingerprint = 'old';
    const reordered = await service.reorder('client:test-user', created.id, { orderedPlaceIds: [added.places[0].id], expectedVersion: 2, commandId: commandId('11') });
    expect(reordered.route).toBeUndefined(); expect(reordered.routeFingerprint).toBeUndefined();
    getDraft().state.route = freshRoute; getDraft().state.routeFingerprint = 'old';
    const removed = await service.removePlace('client:test-user', created.id, { placeId: added.places[0].id, expectedVersion: 3, commandId: commandId('12') });
    expect(removed.route).toBeUndefined(); expect(removed.routeFingerprint).toBeUndefined();
  });

  it('updates budget settings without dropping places and invalidates geometry only for routing inputs', async () => {
    const { service, freshRoute, getDraft } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('30') });
    getDraft().state.route = freshRoute;
    const budget = await service.updateSettings('client:test-user', created.id, { budgetMode: 'travel_only', budgetMinutes: 45, expectedVersion: added.version, commandId: commandId('31') });
    expect(budget).toMatchObject({ budgetMode: 'travel_only', budgetMinutes: 45, loop: true, profile: 'foot' });
    expect(budget.places).toHaveLength(1);
    expect(budget.route).toEqual(freshRoute);
    const routing = await service.updateSettings('client:test-user', created.id, { loop: false, profile: 'bike', expectedVersion: budget.version, commandId: commandId('32') });
    expect(routing).toMatchObject({ loop: false, profile: 'bike', places: [{ id: 'poi_poi-a' }] });
    expect(routing.route).toBeUndefined();
  });

  it('undoes the previous persisted state with a new version and idempotent receipt', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('20') });
    const command = { expectedVersion: 2, commandId: commandId('21') };
    const undone = await service.undo('client:test-user', created.id, command);
    expect(undone).toMatchObject({ version: 3, places: [] });
    expect(await service.undo('client:test-user', created.id, command)).toEqual(undone);
  });

  it('undo restores historical route totals, quality, and matching warning evidence', async () => {
    const { service, freshRoute, getDraft } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const historicalQuality = {
      version: 'graphhopper-quality-core-v1', verdict: 'degraded', feasible: true, networkConfirmed: true,
      warnings: ['UNAVOIDABLE_OUT_AND_BACK'],
      metrics: { requestedLoop: true, routeAvailable: true, stopCount: 0, uniquePoiCount: 0, clusteredStopCount: 0 },
    } as const;
    getDraft().state = {
      ...getDraft().state,
      route: freshRoute,
      routeFingerprint: 'historical-route',
      warnings: [{ code: 'UNAVOIDABLE_OUT_AND_BACK', message: 'Historical route warning' }],
      quality: historicalQuality,
    };
    const historicalTotals = (service as any).withTotals(getDraft().state).totals;
    const changed = await service.updateSettings('client:test-user', created.id, { budgetMinutes: 90, expectedVersion: created.version, commandId: commandId('undo-quality-change') });
    expect(changed.quality).toBeUndefined();

    const undone = await service.undo('client:test-user', created.id, { expectedVersion: changed.version, commandId: commandId('undo-quality') });
    expect(undone.route).toEqual(freshRoute);
    expect(undone.totals).toEqual(historicalTotals);
    expect(undone.quality).toEqual(historicalQuality);
    expect(undone.warnings).toEqual([{ code: 'UNAVOIDABLE_OUT_AND_BACK', message: 'Historical route warning' }]);
  });

  it('invalidates stale geometry, publishes a freshly routed snapshot, and makes publication irreversible', async () => {
    const { service, routes, routing, freshRoute, getDraft } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    getDraft().state.route = { ...freshRoute, distance: 999999 };
    getDraft().state.routeFingerprint = 'stale';
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('3') });
    expect(added.route).toBeUndefined(); expect(added.routeFingerprint).toBeUndefined();

    const publishCommand = { expectedVersion: 2, commandId: commandId('4') };
    const published = await service.publish('client:test-user', created.id, publishCommand);
    expect(routing.plan).toHaveBeenCalledWith({ start: created.start, waypoints: [added.places[0].center], profile: 'foot', options: { loop: true, optimize: false } });
    expect(published).toMatchObject({ version: 3, status: 'published', publishedRouteId: 'saved-route', route: freshRoute });
    expect(published.routeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(getDraft().state.history).toHaveLength(1);
    expect((routes.publishFromItinerary.mock.calls[0][0] as any).route.distance).toBe(1000);
    expect(await service.publish('client:test-user', created.id, publishCommand)).toEqual(published);
    expect(routing.plan).toHaveBeenCalledTimes(1); expect(routes.publishFromItinerary).toHaveBeenCalledTimes(1);
    await expect(service.undo('client:test-user', created.id, { expectedVersion: 3, commandId: commandId('5') })).rejects.toThrow('immutable');
    await expect(service.removePlace('client:test-user', created.id, { placeId: 'poi_poi-a', expectedVersion: 3, commandId: commandId('6') })).rejects.toThrow('immutable');
  });

  it('replans an editable draft with real travel totals and permits overbudget', async () => {
    const { service, routing, freshRoute } = harness();
    routing.plan.mockResolvedValueOnce({ routes: [{ ...freshRoute, duration: 7200 }], order: [0], loop: true, optimize: false });
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 10 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('40') });
    const replanned = await service.replan('client:test-user', created.id, { expectedVersion: added.version, commandId: commandId('41') });
    expect(replanned).toMatchObject({ version: 3, status: 'ready', route: { duration: 7200 }, totals: { travelMinutes: 120, feasible: false } });
    expect(replanned.routeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    // A manual replan produces route evidence only: no auto quality, pool
    // alternatives or score breakdown, and the overbudget draft stays editable.
    expect(replanned.quality).toBeUndefined();
    expect(replanned.alternatives).toBeUndefined();
    expect(replanned.scoreBreakdown).toBeUndefined();
    const editable = await service.setVisitMode('client:test-user', created.id, { placeId: added.places[0].id, mode: 'pass_by', expectedVersion: replanned.version, commandId: commandId('42') });
    expect(editable).toMatchObject({ version: 4, status: 'ready' });
  });

  it('keeps auto quality/alternatives exclusive to autoFill while manual replan stays clean', async () => {
    const budget = new ItineraryBudgetService();
    const makePlace = (id: string, name: string, lat: number, lon: number, poiId: string) => ({
      id, name, center: { lat, lon },
      pois: [{ id: poiId, name, category: 'monument', lat, lon, included: true, estimatedVisitMinutes: 0 }],
      visitMode: 'pass_by', dwellMinutes: 0, arrivalOverheadMinutes: 0, source: 'auto', locked: false, clusterConfidence: 'walkable',
    });
    const winnerPlaces = [makePlace('p-win-1', 'W1', 58.61, 49.61, 'poi-w1'), makePlace('p-win-2', 'W2', 58.62, 49.62, 'poi-w2')];
    const altPlaces = [makePlace('p-alt-1', 'A1', 58.63, 49.63, 'poi-a1')];
    const totalsFor = (places: any[]) => budget.calculate({ travelMinutes: 600 / 60, places, budgetMinutes: 100, budgetMode: 'whole_trip', reserveMinutes: 5 });
    const quality = { version: 'graphhopper-quality-core-v1', verdict: 'confirmed', feasible: true, networkConfirmed: true, warnings: [], metrics: { requestedLoop: true, routeAvailable: true, stopCount: 2, uniquePoiCount: 2, clusteredStopCount: 2 } } as const;
    const scoreBreakdown = { uniquePoiQuality: 4, categoryDiversity: 2, geographicDiversity: 2, loopOverlap: 0, profileRoadFit: 2, budgetUtilization: 1, elevation: 0, total: 11 };
    const alternatives = [{ alternativeId: 'auto-1', explanation: 'compact', scoreBreakdown, places: altPlaces, previewTotals: totalsFor(altPlaces), selectionSummary: { candidateClusters: 2, selectedPlaces: 1, selectedUniquePois: 1, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified', maxAutomaticExcursionMinutes: 3 }, quality }];
    const optimizer: any = { optimize: async (state: any) => ({
      state: { ...state, places: winnerPlaces, status: 'ready', warnings: [], quality, scoreBreakdown, autoFillSummary: { candidateClusters: 2, selectedPlaces: 2, selectedUniquePois: 2, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified', maxAutomaticExcursionMinutes: 3 }, alternatives },
      alternatives,
    }) };
    const { service } = harness(optimizer);
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const filled = await service.autoFill('client:test-user', created.id, { preferredCategories: [], expectedVersion: created.version, commandId: commandId('af-contract') });
    // Auto-fill is the sole producer of quality/alternatives/score breakdown.
    expect(filled.quality).toBeDefined();
    expect(filled.scoreBreakdown).toBeDefined();
    expect(filled.alternatives).toHaveLength(1);
    expect(filled.autoFillSummary).toBeDefined();
  });

  it('invalidates stale auto-selection artifacts on manual structural edits', async () => {
    const { service, getDraft, freshRoute } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('stale-0') });
    const quality = { version: 'graphhopper-quality-core-v1', verdict: 'confirmed', feasible: true, networkConfirmed: true, warnings: [], metrics: { requestedLoop: true, routeAvailable: true, stopCount: 1, uniquePoiCount: 1, clusteredStopCount: 1 } } as const;
    const scoreBreakdown = { uniquePoiQuality: 4, categoryDiversity: 2, geographicDiversity: 2, loopOverlap: 0, profileRoadFit: 2, budgetUtilization: 1, elevation: 0, total: 11 };
    // A completed auto-fill left its candidate pool and evidence on the draft.
    getDraft().state = {
      ...getDraft().state,
      route: freshRoute,
      routeFingerprint: 'auto-fill-fingerprint',
      quality,
      scoreBreakdown,
      autoFillSummary: { candidateClusters: 2, selectedPlaces: 1, selectedUniquePois: 1, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified', maxAutomaticExcursionMinutes: null },
      alternatives: [{ alternativeId: 'auto-1', explanation: 'stale pool', scoreBreakdown, places: [], previewTotals: created.totals, selectionSummary: { candidateClusters: 2, selectedPlaces: 1, selectedUniquePois: 1, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified', maxAutomaticExcursionMinutes: null }, quality }],
    };
    // A manual structural edit must invalidate every auto-selection artifact.
    const edited = await service.addPoi('client:test-user', created.id, { poiId: 'poi-b', expectedVersion: added.version, commandId: commandId('stale-1') });
    expect(edited.route).toBeUndefined();
    expect(edited.routeFingerprint).toBeUndefined();
    expect(edited.quality).toBeUndefined();
    expect(edited.alternatives).toBeUndefined();
    expect(edited.scoreBreakdown).toBeUndefined();
    expect(edited.autoFillSummary).toBeUndefined();
  });

  it('replans the route and surfaces additions + loop warning after removing a place', async () => {
    const { service, routing, freshRoute, getDraft } = harness();
    routing.plan.mockResolvedValueOnce({ routes: [freshRoute], order: [0, 1], loop: true, optimize: false, warnings: ['UNAVOIDABLE_OUT_AND_BACK'] });
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    let current = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('rm1') });
    current = await service.addPoi('client:test-user', current.id, { poiId: 'poi-c', expectedVersion: current.version, commandId: commandId('rm2') });
    expect(current.places).toHaveLength(2);
    const removed = await service.removePlace('client:test-user', current.id, { placeId: current.places[1].id, expectedVersion: current.version, commandId: commandId('rm3') });
    expect(routing.plan).toHaveBeenCalled();
    expect(removed.route).toEqual(freshRoute);
    expect(removed.routeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(removed.places).toHaveLength(1);
    expect(removed.additions.length).toBeGreaterThan(0);
    expect(removed.warnings).toContainEqual({ code: 'UNAVOIDABLE_OUT_AND_BACK', message: expect.any(String) });
    expect(getDraft().state.additions.length).toBeGreaterThan(0);
  });

  it('clears the auto-fill supply snapshot on any manual edit so it never describes a stale pool', async () => {
    const { service, getDraft } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    getDraft().state.autoFillSummary = { candidateClusters: 2 };
    const updated = await service.updateSettings('client:test-user', created.id, { budgetMinutes: 90, expectedVersion: created.version, commandId: commandId('af-clear') });
    expect(updated.autoFillSummary).toBeUndefined();
  });

  it('rejects a freshly routed overbudget itinerary without persisting a Route', async () => {
    const { service, routes, routing } = harness();
    routing.plan.mockResolvedValueOnce({ routes: [{ distance: 1000, duration: 10_000_000, ascend: 0, descend: 0, profile: 'foot', bbox: [0, 0, 1, 1], geojson: { type: 'Feature', geometry: null, properties: {} } }] });
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 10 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('7') });
    await expect(service.publish('client:test-user', created.id, { expectedVersion: added.version, commandId: commandId('8') })).rejects.toThrow('infeasible');
    expect(routing.plan).toHaveBeenCalledTimes(1); expect(routes.publishFromItinerary).not.toHaveBeenCalled();
  });

  it('surfaces transparent additions after `Мимо` frees stop budget', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('a1') });
    const placeId = added.places[0].id;
    const replanned = await service.replan('client:test-user', created.id, { expectedVersion: added.version, commandId: commandId('a2') });
    expect(replanned.route).toBeDefined();
    // `Мимо` (pass_by) frees the visit dwell and must surface a nearby addition
    // the user can accept — never auto-added.
    const bypassed = await service.setVisitMode('client:test-user', created.id, { placeId, mode: 'pass_by', expectedVersion: replanned.version, commandId: commandId('a3') });
    expect(bypassed.additions.length).toBeGreaterThan(0);
    expect(bypassed.additions[0].suggestionId).toBe('add:poi-b');
    expect(bypassed.additions[0].previewTotals.feasible).toBe(true);
    expect(bypassed.places.flatMap((p) => p.pois).map((c) => c.id)).toEqual(['poi-a']);
  });

  it('accepts an addition as a manual anchor and replans for real', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('b1') });
    const replanned = await service.replan('client:test-user', created.id, { expectedVersion: added.version, commandId: commandId('b2') });
    const bypassed = await service.setVisitMode('client:test-user', created.id, { placeId: added.places[0].id, mode: 'pass_by', expectedVersion: replanned.version, commandId: commandId('b3') });
    const accepted = await service.acceptAddition('client:test-user', created.id, { suggestionId: 'add:poi-b', expectedVersion: bypassed.version, commandId: commandId('b4') });
    expect(accepted.places.flatMap((p) => p.pois).some((c) => c.id === 'poi-b')).toBe(true);
    // poi-b is now included → no stale addition for it remains.
    expect(accepted.additions.some((s) => s.suggestionId === 'add:poi-b')).toBe(false);
  });

  it('clears stale additions on any command that did not recompute them', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('c1') });
    const replanned = await service.replan('client:test-user', created.id, { expectedVersion: added.version, commandId: commandId('c2') });
    const bypassed = await service.setVisitMode('client:test-user', created.id, { placeId: added.places[0].id, mode: 'pass_by', expectedVersion: replanned.version, commandId: commandId('c3') });
    expect(bypassed.additions.length).toBeGreaterThan(0);
    const locked = await service.setLocked('client:test-user', created.id, { placeId: added.places[0].id, locked: true, expectedVersion: bypassed.version, commandId: commandId('c4') });
    expect(locked.additions).toEqual([]);
  });

  it('previews replacements excluding current POIs and leaves other anchors intact', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 240 } as any);
    let cur = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('r1') });
    cur = await service.addPoi('client:test-user', created.id, { poiId: 'poi-c', expectedVersion: cur.version, commandId: commandId('r2') });
    cur = await service.replan('client:test-user', created.id, { expectedVersion: cur.version, commandId: commandId('r3') });
    expect(cur.places.length).toBeGreaterThanOrEqual(2);
    const targetPlace = cur.places.find((p) => p.pois.some((c) => c.id === 'poi-a'))!;
    const previewed = await service.replacePlace('client:test-user', created.id, { placeId: targetPlace.id, expectedVersion: cur.version, commandId: commandId('r4') });
    // Options exclude every POI already in the route (poi-a, poi-c) → only poi-b.
    expect(previewed.replacements.length).toBeGreaterThan(0);
    expect(previewed.replacements.every((r) => r.poi.id === 'poi-b')).toBe(true);
    expect(previewed.replacements[0].suggestionId).toContain(`replace:${targetPlace.id}:`);
    // Preview does not mutate the route; the other anchor (poi-c) is untouched.
    expect(previewed.places.flatMap((p) => p.pois).map((c) => c.id).sort()).toEqual(['poi-a', 'poi-c']);
  });

  it('accepts a replacement by swapping the target POI for the candidate', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 240 } as any);
    let cur = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('s1') });
    cur = await service.addPoi('client:test-user', created.id, { poiId: 'poi-c', expectedVersion: cur.version, commandId: commandId('s2') });
    cur = await service.replan('client:test-user', created.id, { expectedVersion: cur.version, commandId: commandId('s3') });
    const targetPlace = cur.places.find((p) => p.pois.some((c) => c.id === 'poi-a'))!;
    const previewed = await service.replacePlace('client:test-user', created.id, { placeId: targetPlace.id, expectedVersion: cur.version, commandId: commandId('s4') });
    const accepted = await service.acceptReplacement('client:test-user', created.id, { suggestionId: previewed.replacements[0].suggestionId, expectedVersion: previewed.version, commandId: commandId('s5') });
    const ids = accepted.places.flatMap((p) => p.pois).map((c) => c.id);
    expect(ids).not.toContain('poi-a');
    expect(ids).toContain('poi-b');
    expect(ids).toContain('poi-c');
  });

  it('returns a batch route-impact preview without mutating the draft', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 240 } as any);
    const added = await service.addPoi('client:test-user', created.id, { poiId: 'poi-a', expectedVersion: 1, commandId: commandId('i1') });
    const replanned = await service.replan('client:test-user', created.id, { expectedVersion: added.version, commandId: commandId('i2') });
    const versionBefore = replanned.version;
    const impact = await service.routeImpact('client:test-user', created.id, ['poi-b', 'poi-c', 'missing']);
    expect(impact).toHaveLength(3);
    expect(impact.find((r) => r.poiId === 'poi-b')?.available).toBe(true);
    expect(impact.find((r) => r.poiId === 'poi-b')?.estimate).toBeDefined();
    expect(impact.find((r) => r.poiId === 'missing')?.available).toBe(false);
    // Read-only: the draft version is untouched.
    const after = await service.get('client:test-user', created.id);
    expect(after.version).toBe(versionBefore);
  });

  it('allows loop/profile/stopPace changes on an unlimited draft', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMode: 'unlimited', intent: 'manual_collection' } as any);
    expect(created.budgetMinutes).toBeNull();
    expect(created.budgetMode).toBe('unlimited');
    // Change loop to false — must not throw despite budgetMinutes being null.
    const updated = await service.updateSettings('client:test-user', created.id, { loop: false, expectedVersion: created.version, commandId: commandId('ul-1') });
    expect(updated.loop).toBe(false);
    expect(updated.budgetMinutes).toBeNull();
    expect(updated.budgetMode).toBe('unlimited');
    // Change profile — must work.
    const updatedProfile = await service.updateSettings('client:test-user', created.id, { profile: 'bike', expectedVersion: updated.version, commandId: commandId('ul-2') });
    expect(updatedProfile.profile).toBe('bike');
    // Change stopPace — must work.
    const updatedPace = await service.updateSettings('client:test-user', created.id, { stopPace: 'quick', expectedVersion: updatedProfile.version, commandId: commandId('ul-3') });
    expect(updatedPace.stopPace).toBe('quick');
  });

  it('updates, clears and replans an optional finish only for linear routes', async () => {
    const { service, routing } = harness();
    const start = { lat: 58.6, lon: 49.6 };
    const finish = { lat: 58.62, lon: 49.64 };
    const created = await service.create('client:test-user', { start, profile: 'foot', loop: false, budgetMode: 'unlimited', intent: 'manual_collection' } as any);
    const updated = await service.updateSettings('client:test-user', created.id, { finish, expectedVersion: created.version, commandId: commandId('finish-1') });
    expect(updated.finish).toEqual(finish);
    expect(updated.route).toBeUndefined();

    const replanned = await service.replan('client:test-user', created.id, { expectedVersion: updated.version, commandId: commandId('finish-2') });
    expect(replanned.route).toBeDefined();
    expect(routing.plan).toHaveBeenLastCalledWith({ start, waypoints: [finish], profile: 'foot', options: { loop: false, optimize: false } });

    const cleared = await service.updateSettings('client:test-user', created.id, { finish: null, expectedVersion: replanned.version, commandId: commandId('finish-3') });
    expect(cleared.finish).toBeUndefined();
    expect(cleared.route).toBeUndefined();

    await expect(service.updateSettings('client:test-user', created.id, { loop: true, finish, expectedVersion: cleared.version, commandId: commandId('finish-4') }))
      .rejects.toThrow('finish is available only for a linear route');
    const looped = await service.updateSettings('client:test-user', created.id, { loop: true, expectedVersion: cleared.version, commandId: commandId('finish-5') });
    expect(looped.loop).toBe(true);
    expect(looped.finish).toBeUndefined();
  });

  it('keeps reserve 0 and remaining null for unlimited drafts', async () => {
    const { service } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMode: 'unlimited', intent: 'manual_collection' } as any);
    expect(created.reserveMinutes).toBe(0);
    expect(created.totals.remainingMinutes).toBeNull();
    expect(created.totals.feasible).toBe(true);
  });

  it('rejects autoFill on an unlimited draft without mutation', async () => {
    const { service, drafts } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMode: 'unlimited', intent: 'manual_collection' } as any);
    const versionBefore = created.version;
    await expect(service.autoFill('client:test-user', created.id, { preferredCategories: ['nature'], expectedVersion: created.version, commandId: commandId('ul-af') })).rejects.toThrow();
    // Draft should not be mutated.
    const after = await service.get('client:test-user', created.id);
    expect(after.version).toBe(versionBefore);
  });

  it('previews an alternative without mutating the owned draft and rejects foreign or stale reads', async () => {
    const { service, getDraft, routing, freshRoute, drafts } = harness();
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const alternativePlaces = [{
      id: 'alt-place', name: 'Alternative', center: { lat: 58.61, lon: 49.61 },
      pois: [{ id: 'poi-b', name: 'B', category: 'nature', lat: 58.6001, lon: 49.6001, included: true, estimatedVisitMinutes: 0 }],
      visitMode: 'pass_by', dwellMinutes: 0, arrivalOverheadMinutes: 0, source: 'auto', locked: false, clusterConfidence: 'walkable',
    }];
    getDraft().state.alternatives = [{
      alternativeId: 'alt-1', explanation: 'Alternative', places: alternativePlaces,
      previewTotals: created.totals, scoreBreakdown: {}, selectionSummary: { candidateClusters: 1 },
    }];
    routing.plan.mockResolvedValue({ routes: [freshRoute], order: [0], loop: true, optimize: false });
    const beforeState = JSON.parse(JSON.stringify(getDraft().state));
    const beforeVersion = getDraft().version;

    const preview = await service.previewAlternative('client:test-user', created.id, 'alt-1', created.version);

    expect(preview).toMatchObject({ draftId: created.id, version: created.version, alternativeId: 'alt-1', route: freshRoute, places: alternativePlaces });
    expect(JSON.parse(JSON.stringify(getDraft().state))).toEqual(beforeState);
    expect(getDraft().version).toBe(beforeVersion);
    expect(drafts.update).not.toHaveBeenCalled();
    await expect(service.previewAlternative('client:other-user', created.id, 'alt-1', created.version)).rejects.toThrow('not found');
    await expect(service.previewAlternative('client:test-user', created.id, 'alt-1', created.version + 1))
      .rejects.toMatchObject({ response: { details: { code: 'ITINERARY_VERSION_CONFLICT' } } });
  });

  it('selectAlternative recomputes fresh quality and replaces primary warnings', async () => {
    // The alternative is routed again at selection time. Its fresh verdict,
    // rather than primary-route warnings or an old preview verdict, must be
    // persisted with that rebuilt geometry.
    const budget = new ItineraryBudgetService();
    const makePlace = (id: string, name: string, lat: number, lon: number, poiId: string) => ({
      id, name, center: { lat, lon },
      pois: [{ id: poiId, name, category: 'monument', lat, lon, included: true, estimatedVisitMinutes: 0 }],
      visitMode: 'pass_by', dwellMinutes: 0, arrivalOverheadMinutes: 0, source: 'auto', locked: false, clusterConfidence: 'walkable',
    });
    const winnerPlaces = [makePlace('p-win-1', 'W1', 58.61, 49.61, 'poi-w1'), makePlace('p-win-2', 'W2', 58.62, 49.62, 'poi-w2')];
    const altPlaces = [makePlace('p-alt-1', 'A1', 58.63, 49.63, 'poi-a1'), makePlace('p-alt-2', 'A2', 58.64, 49.64, 'poi-a2')];
    const totalsFor = (places: any[]) => budget.calculate({ travelMinutes: 600 / 60, places, budgetMinutes: 100, budgetMode: 'whole_trip', reserveMinutes: 5 });
    const winnerSummary = { candidateClusters: 2, selectedPlaces: 2, selectedUniquePois: 2, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified' as const, maxAutomaticExcursionMinutes: 3 };
    const altSummary = { candidateClusters: 2, selectedPlaces: 2, selectedUniquePois: 2, localityGuardApplied: true, unusedBudgetIntentional: true, networkConfidence: 'verified' as const, maxAutomaticExcursionMinutes: 4 };
    const altScore = { uniquePoiQuality: 4, categoryDiversity: 2, geographicDiversity: 2, loopOverlap: 0, profileRoadFit: 2, budgetUtilization: 1, elevation: 0, total: 11 };
    const winnerScore = { ...altScore, total: 12 };
    const primaryQuality = { version: 'graphhopper-quality-core-v1', verdict: 'degraded', feasible: true, networkConfirmed: true, warnings: ['UNAVOIDABLE_OUT_AND_BACK'], metrics: { requestedLoop: true, routeAvailable: true, stopCount: 2, uniquePoiCount: 2, clusteredStopCount: 2 } } as const;
    const alternativeQuality = { ...primaryQuality, verdict: 'confirmed' as const, warnings: [] };
    const alternatives = [{ alternativeId: 'auto-1', explanation: 'Компактный маршрут: 2 места, 2 объекта', scoreBreakdown: altScore, places: altPlaces, previewTotals: totalsFor(altPlaces), selectionSummary: altSummary, quality: alternativeQuality }];
    const optimizer: any = { optimize: async (state: any) => ({
      state: { ...state, places: winnerPlaces, status: 'ready', warnings: [{ code: 'UNAVOIDABLE_OUT_AND_BACK', message: 'primary only' }], quality: primaryQuality, scoreBreakdown: winnerScore, autoFillSummary: winnerSummary, alternatives },
      alternatives,
    }) };
    const { service, routing, freshRoute } = harness(optimizer);
    // Unlike the degraded primary preview, the exact rebuilt alternative is a
    // clean closed triangle.
    routing.plan.mockResolvedValue({ routes: [{ ...freshRoute, geojson: { ...freshRoute.geojson, geometry: { type: 'LineString', coordinates: [[49.6, 58.6], [49.7, 58.6], [49.65, 58.7], [49.6, 58.6]] } } }], order: [0], loop: true, optimize: false });
    const created = await service.create('client:test-user', { start: { lat: 58.6, lon: 49.6 }, profile: 'foot', loop: true, budgetMinutes: 100 } as any);
    const filled = await service.autoFill('client:test-user', created.id, { preferredCategories: [], expectedVersion: created.version, commandId: commandId('af-alt') });
    expect(filled.alternatives).toHaveLength(1);
    expect(filled.autoFillSummary).toEqual(winnerSummary);

    const selected = await service.selectAlternative('client:test-user', created.id, { alternativeId: 'auto-1', expectedVersion: filled.version, commandId: commandId('sel-alt') });
    // Matching Places: the alternative's own ordered Place set, restored.
    expect(selected.places.map((p) => p.id)).toEqual(['p-alt-1', 'p-alt-2']);
    // Exact totals: recomputed from the freshly routed alternative geometry and
    // equal to the alternative's previewTotals (selection consistency).
    expect(selected.totals).toEqual(alternatives[0].previewTotals);
    expect(selected.totals.feasible).toBe(true);
    // ScoreBreakdown and SelectionSummary travel with the alternative.
    expect(selected.scoreBreakdown).toEqual(altScore);
    expect(selected.autoFillSummary).toEqual(altSummary);
    // The chosen alternative is no longer offered; its geometry and fresh
    // quality replace the stale primary evidence.
    expect(selected.alternatives).toEqual([]);
    expect(selected.route).toBeDefined();
    expect(selected.quality).toMatchObject({ verdict: 'confirmed', warnings: [], networkConfirmed: true });
    expect(selected.warnings).toEqual([]);
    expect(selected.warnings).not.toEqual([{ code: 'UNAVOIDABLE_OUT_AND_BACK', message: 'primary only' }]);
    // A retry returns the persisted selection receipt: it neither reroutes the
    // alternative nor loses its freshly derived quality/warnings.
    expect(await service.selectAlternative('client:test-user', created.id, { alternativeId: 'auto-1', expectedVersion: filled.version, commandId: commandId('sel-alt') })).toEqual(selected);
    expect(routing.plan).toHaveBeenCalledTimes(1);
  });
});
