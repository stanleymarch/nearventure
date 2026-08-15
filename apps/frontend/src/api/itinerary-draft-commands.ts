/**
 * Public itinerary draft command surface exposed by the REST controller.
 *
 * Keep this inventory in sync with `ItineraryController`: client capability
 * guards use it to prevent draft actions that need routing while health is
 * known unavailable. Direct server APIs remain intentionally unchanged.
 */
export const PUBLIC_ITINERARY_DRAFT_COMMANDS = [
  'add-poi',
  'remove-place',
  'set-visit-mode',
  'set-locked',
  'reorder',
  'update-settings',
  'auto-fill',
  'regenerate',
  'select-alternative',
  'apply-smart-fix',
  'accept-addition',
  'replace-place',
  'accept-replacement',
  'replan',
  'undo',
  'publish',
  'discard',
] as const;

export type ItineraryDraftCommand = (typeof PUBLIC_ITINERARY_DRAFT_COMMANDS)[number];

/**
 * Commands that route directly, or invalidate a route in the client flow and
 * therefore require routing before their result can be used. This boundary is
 * deliberately conservative for unavailable routing health.
 */
export const ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS: readonly ItineraryDraftCommand[] = [
  'add-poi',
  'remove-place',
  'reorder',
  'update-settings',
  'auto-fill',
  'regenerate',
  'apply-smart-fix',
  'accept-addition',
  'accept-replacement',
  'select-alternative',
  'replan',
  'publish',
];

/** Public commands that leave existing route geometry usable without routing. */
export const NON_ROUTING_ITINERARY_DRAFT_COMMANDS: readonly ItineraryDraftCommand[] = [
  'set-visit-mode',
  'set-locked',
  'replace-place',
  'undo',
  'discard',
];

const routingCapableCommands = new Set<string>(ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS);

export function isRoutingCapableItineraryDraftCommand(action: ItineraryDraftCommand): boolean {
  return routingCapableCommands.has(action);
}
