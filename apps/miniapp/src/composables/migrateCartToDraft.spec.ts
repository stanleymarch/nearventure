import { describe, expect, it, vi } from 'vitest';
import { CART_KEY, MIGRATION_KEY, migrateCartToDraft, migrationDraftId } from './migrateCartToDraft';
const draft = (version = 1) => ({ id: 'draft', version, places: [], totals: {} } as any);
function storage() { const values = new Map([[CART_KEY, '[legacy]']]); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), values }; }
const items = [{ id: 'a', poiId: 'a', name: 'A', category: 'museum', lat: 1, lon: 2 }, { id: 'b', poiId: 'b', name: 'B', category: 'nature', lat: 1, lon: 2 }];

describe('migrateCartToDraft', () => {
  it('persists per-item command ids before execution and clears legacy storage only after all receipts', async () => {
    const store = storage(); const addPoi = vi.fn().mockResolvedValueOnce(draft(2)).mockResolvedValueOnce(draft(3));
    const result = await migrateCartToDraft({ storage: store, draft: draft(), items, addPoi });
    expect(result).toMatchObject({ migrated: true, draft: { version: 3 } });
    expect(addPoi).toHaveBeenCalledTimes(2); expect(store.getItem(CART_KEY)).toBeNull(); expect(store.getItem(MIGRATION_KEY)).toBe('draft');
    expect(addPoi.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resumes a partial migration after reload with the same command ids', async () => {
    const store = storage();
    const first = vi.fn().mockResolvedValueOnce(draft(2)).mockResolvedValueOnce(null);
    await expect(migrateCartToDraft({ storage: store, draft: draft(), items, addPoi: first })).resolves.toMatchObject({ reason: 'failed' });
    const pending = JSON.parse(store.getItem(MIGRATION_KEY)!);
    expect(pending).toMatchObject({ draftId: 'draft', items: [{ id: 'a', received: true }, { id: 'b', received: false }] });
    expect(store.getItem(CART_KEY)).toBe('[legacy]');
    expect(migrationDraftId(store)).toBe('draft');

    const resumed = vi.fn().mockResolvedValue(draft(3));
    await expect(migrateCartToDraft({ storage: store, draft: draft(2), items, addPoi: resumed })).resolves.toMatchObject({ migrated: true, draft: { version: 3 } });
    expect(resumed).toHaveBeenCalledWith('b', pending.items[1].commandId);
    expect(store.getItem(CART_KEY)).toBeNull(); expect(store.getItem(MIGRATION_KEY)).toBe('draft');
  });

  it('migrates exact old-format POIs without kind or poiId using their ids', async () => {
    const store = storage(); const addPoi = vi.fn().mockResolvedValue(draft(2));
    const oldFormatItems = [{ id: 'legacy-poi-id', name: 'Legacy POI', category: 'museum', lat: 1, lon: 2 }];
    await expect(migrateCartToDraft({ storage: store, draft: draft(), items: oldFormatItems, addPoi })).resolves.toMatchObject({ migrated: true, draft: { version: 2 } });
    expect(addPoi).toHaveBeenCalledWith('legacy-poi-id', expect.any(String));
    expect(store.getItem(CART_KEY)).toBeNull();
  });

  it('keeps the cart as safe fallback for custom pins', async () => {
    const customStore = storage(); const addPoi = vi.fn();
    expect(await migrateCartToDraft({ storage: customStore, draft: draft(), items: [{ id: 'custom', kind: 'custom', poiId: null, name: 'Pin', category: 'custom', lat: 1, lon: 2 }], addPoi })).toMatchObject({ migrated: false, reason: 'custom' });
    expect(customStore.getItem(CART_KEY)).toBe('[legacy]');
  });
});
