import type { ItineraryDraft } from '@shared/api/itineraries';
import type { CartPoi } from './useCart';

export const CART_KEY = 'nv:cart:v1';
export const MIGRATION_KEY = 'nv:cart:v1:migrated-draft';

type PendingItem = { id: string; poiId: string; commandId: string; received: boolean };
type PendingMigration = { version: 1; draftId: string; items: PendingItem[] };
type MigrationResult = { draft: ItineraryDraft; migrated: boolean; reason?: 'already' | 'custom' | 'failed' };

function parseMigration(value: string | null): PendingMigration | string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version === 1 && typeof parsed.draftId === 'string' && Array.isArray(parsed.items)) return parsed as PendingMigration;
  } catch { /* completed legacy markers are plain draft ids */ }
  return value;
}

/** Returns the draft that owns either a completed or an in-flight migration. */
export function migrationDraftId(storage: Pick<Storage, 'getItem'>): string | null {
  const record = parseMigration(storage.getItem(MIGRATION_KEY));
  return typeof record === 'string' ? record : record?.draftId ?? null;
}

function pendingFor(draft: ItineraryDraft, items: CartPoi[]): PendingMigration {
  return {
    version: 1,
    draftId: draft.id,
    // Command IDs are persisted before the first request so a reload or a
    // response lost after server commit can safely replay the same command.
    items: items.map((item) => ({ id: item.id, poiId: String(item.poiId || item.id), commandId: crypto.randomUUID(), received: false })),
  };
}

/**
 * Retry-safe legacy-cart migration. A durable pending record is written before
 * execution and each receipt is acknowledged immediately. The cart is erased
 * only after every command receipt has been received.
 */
export async function migrateCartToDraft(options: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  draft: ItineraryDraft;
  items: CartPoi[];
  addPoi: (poiId: string, commandId: string) => Promise<ItineraryDraft | null>;
}): Promise<MigrationResult> {
  const { storage, items, addPoi } = options;
  const existing = parseMigration(storage.getItem(MIGRATION_KEY));
  if (typeof existing === 'string') return { draft: options.draft, migrated: false, reason: 'already' };
  // Legacy v1 POIs predate both `kind` and `poiId`; their `id` is the POI id.
  // Only an explicit custom kind is unsafe to transfer to the server draft.
  if (items.some((item) => item.kind === 'custom')) return { draft: options.draft, migrated: false, reason: 'custom' };
  const pending = existing ?? pendingFor(options.draft, items);
  if (pending.draftId !== options.draft.id) return { draft: options.draft, migrated: false, reason: 'failed' };
  if (!existing) storage.setItem(MIGRATION_KEY, JSON.stringify(pending));

  let latest = options.draft;
  for (const item of pending.items) {
    if (item.received) continue;
    const result = await addPoi(item.poiId, item.commandId);
    if (!result) return { draft: latest, migrated: false, reason: 'failed' };
    latest = result;
    item.received = true;
    storage.setItem(MIGRATION_KEY, JSON.stringify(pending));
  }
  storage.removeItem(CART_KEY);
  // Plain draft id remains the completed-marker format for compatibility.
  storage.setItem(MIGRATION_KEY, latest.id);
  return { draft: latest, migrated: true };
}
