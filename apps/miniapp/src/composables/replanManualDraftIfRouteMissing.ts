import type { ItineraryDraft } from '@/api/itineraries';

export type RouteMode = 'auto' | 'manual';

/**
 * Post-migration guard for the manual wizard flow.
 *
 * `add-poi` is deliberately a structural-only command: it persists the manual
 * places and invalidates any old route, but never issues a GraphHopper request
 * (`apps/backend/src/itineraries/itinerary-draft.service.ts`). The interactive
 * paths therefore always follow `add-poi` with an explicit `replan`. A legacy
 * cart migration replays the same `add-poi` protocol for every cart item, so a
 * completed migration is left with places but no route. This guard performs the
 * missing follow-up replan — exactly once, only when a manual draft has places
 * and still no route (which also heals drafts completed by the faulty release,
 * where `migrateCartToDraft` returned `reason: 'already'`).
 *
 * It is a no-op for an empty draft, auto mode, or a draft whose route was
 * already produced (for example by the pending-POI `addPoi` → `replan` path),
 * so a migrated N-item cart costs one GraphHopper request, never one per item.
 */
export async function replanManualDraftIfRouteMissing(options: {
  routeMode: RouteMode;
  draft: ItineraryDraft | null;
  replan: () => Promise<ItineraryDraft | null>;
}): Promise<void> {
  const { routeMode, draft, replan } = options;
  if (routeMode !== 'manual' || !draft || draft.places.length === 0 || draft.route) return;
  await replan();
}
