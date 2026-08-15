import { describe, expect, it, vi } from 'vitest';
import { CART_KEY, MIGRATION_KEY, migrateCartToDraft } from './migrateCartToDraft';
import { replanManualDraftIfRouteMissing } from './replanManualDraftIfRouteMissing';

const draft = (version = 1) => ({ id: 'draft', version, places: [], totals: {} } as any);
const places = (ids: string[]) => ids.map((id) => ({ id, pois: [{ id, included: true }] }));
function storage() {
  const values = new Map([[CART_KEY, '[legacy]']]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), values };
}
const items = [{ id: 'a', poiId: 'a', name: 'A', category: 'museum', lat: 1, lon: 2 }, { id: 'b', poiId: 'b', name: 'B', category: 'nature', lat: 1, lon: 2 }];

/**
 * Mimics `useItineraryDraft.command()`: every mutation resolves against the
 * current `draft.value` snapshot and replaces it with the server result, so
 * the post-migration guard replans against the LAST add's version.
 */
function draftComposable(initial: any) {
  const value = { value: initial };
  const addPoi = vi.fn(async (poiId: string) => {
    const current = value.value;
    value.value = { ...current, version: current.version + 1, places: places([...current.places.map((p: any) => p.id), poiId]) };
    return value.value;
  });
  const replan = vi.fn(async () => {
    const current = value.value;
    const route = { duration: 1800, distance: 1000 };
    value.value = { ...current, version: current.version + 1, route, totals: { travelMinutes: route.duration / 60, feasible: true } };
    return value.value;
  });
  return { value, addPoi, replan };
}

describe('replanManualDraftIfRouteMissing', () => {
  it('performs two add-poi calls then exactly one replan at the last add version for a two-item cart', async () => {
    const store = storage();
    const { value, addPoi, replan } = draftComposable(draft());
    const migration = await migrateCartToDraft({ storage: store, draft: value.value, items, addPoi });
    expect(migration.migrated).toBe(true);
    expect(addPoi).toHaveBeenCalledTimes(2);
    expect(migration.draft.version).toBe(3);
    expect(migration.draft.route).toBeUndefined();

    await replanManualDraftIfRouteMissing({ routeMode: 'manual', draft: value.value, replan });

    expect(replan).toHaveBeenCalledTimes(1);
    // The replan resolved against the last add's snapshot (version 3 → 4) and
    // the current draft now exposes route-derived duration/totals.
    expect(value.value.version).toBe(4);
    expect(value.value.route).toMatchObject({ duration: 1800 });
    expect(value.value.totals.travelMinutes).toBe(30);
    // The cart was migrated once and must never be replayed as a retry vehicle.
    expect(store.getItem(CART_KEY)).toBeNull();
  });

  it('heals a hydrated legacy marker (reason: already) with exactly one replan', async () => {
    // A draft completed by the faulty release leaves a plain draft-id marker.
    const store = storage();
    store.values.set(MIGRATION_KEY, 'draft');
    const { value, addPoi, replan } = draftComposable({ ...draft(5), places: places(['a', 'b']) });
    const migration = await migrateCartToDraft({ storage: store, draft: value.value, items, addPoi });
    expect(migration).toMatchObject({ migrated: false, reason: 'already' });
    expect(addPoi).not.toHaveBeenCalled();
    expect(value.value.route).toBeUndefined();

    await replanManualDraftIfRouteMissing({ routeMode: 'manual', draft: value.value, replan });

    expect(replan).toHaveBeenCalledTimes(1);
    expect(value.value.route).toBeDefined();
    expect(value.value.version).toBe(6);
  });

  it('does not replan an empty manual draft, an auto draft, or a draft that already has a route', async () => {
    const replan = vi.fn();
    await replanManualDraftIfRouteMissing({ routeMode: 'manual', draft: draft(), replan });
    await replanManualDraftIfRouteMissing({ routeMode: 'auto', draft: { ...draft(), places: places(['a']) }, replan });
    await replanManualDraftIfRouteMissing({ routeMode: 'manual', draft: { ...draft(), places: places(['a']), route: { duration: 600 } }, replan });
    await replanManualDraftIfRouteMissing({ routeMode: 'manual', draft: null, replan });
    expect(replan).not.toHaveBeenCalled();
  });

  it('does not issue a second replan when the pending-POI addPoi → replan path already produced a route', async () => {
    const { value, addPoi, replan } = draftComposable(draft());
    // Pending POI path: WizardView.addPoi runs server addPoi then replan.
    await addPoi('p');
    await replan();
    expect(value.value.route).toBeDefined();

    // The same migration guard that ran before the pending-POI handling must
    // now see an existing route and stay silent.
    await replanManualDraftIfRouteMissing({ routeMode: 'manual', draft: value.value, replan });
    expect(replan).toHaveBeenCalledTimes(1);
  });
});
