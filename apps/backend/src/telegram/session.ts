/**
 * Telegram bot session (FSM state for the route wizard).
 *
 * Lives in an in-memory Map keyed by chatId (good enough for a single-process
 * bot on a small VPS). Persisted across messages within a session, cleared on
 * /start, /cancel, or flow-timeout (5 min idle — flow-patterns P4).
 */

export type Step =
  | 'WELCOME'
  | 'ROUTE_LOCATION'
  | 'ROUTE_LOCATION_TEXT'
  | 'ROUTE_TRANSPORT'
  | 'ROUTE_BIKETYPE'
  | 'ROUTE_BIKE_SUBTYPE'
  | 'ROUTE_TIME'
  | 'ROUTE_CATEGORIES'
  | 'ROUTE_MODE'
  | 'ROUTE_BUILDING'
  | 'NEARBY_LOCATION'
  | 'NEARBY_SETUP'
  | 'NEARBY_LIST'
  | 'NEARBY_CARD'
  | 'IDLE'
  | 'GUIDE_WALKING'
  | 'GUIDE_DONE';

export type Transport = 'foot' | 'bike' | 'mtb' | 'car';

export interface ManualPoi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
}

export interface BotSession {
  step: Step;
  updatedAt: number;
  /** Last wizard message id — we edit-in-place to avoid message spam. */
  menuMessageId?: number;

  // Route inputs
  start?: { lat: number; lon: number; label?: string };
  transport?: Transport;
  bikeSubtype?: Transport;
  timeMinutes?: number;
  categories: string[];
  loopRoute: boolean;

  // Built route (kept for GPX download without re-routing)
  lastRoute?: {
    geojson: { type: string; coordinates: number[][] | number[][][] } | null;
    distance: number;
    duration: number;
    ascend: number;
    descend: number;
    profile?: string;
    pois: Array<{ id: string; name: string; lat: number; lon: number; category: string }>;
  };

  // Draft itinerary integration (Task 17)
  draftId?: string;
  draftVersion?: number;
  /** Preset used for auto-fill; saved for regeneration. */
  draftPreset?: 'balanced' | 'more_places' | 'scenic' | 'training';

  // Guide (экскурсовод) state
  guideIndex?: number;
  guideMessageId?: number;

  // Nearby paging
  nearbyLocation?: { lat: number; lon: number };
  nearbyOffset?: number;
  nearbyPois?: ManualPoi[];
  nearbyRadius?: number;
  nearbyCategories?: string[];
  /**
   * The "Где вы сейчас?" prompt that holds the request_location
   * reply-keyboard. We delete it once the user actually shares their
   * location — otherwise the button stays in the chat forever and the
   * "бот завис" feedback is unavoidable.
   */
  nearbyPromptId?: number;
  /** Inline message with "Назад к фильтрам" — paired with nearbyPromptId. */
  nearbyPromptInlineId?: number;
  /** Message id of the map pin sent alongside a POI card; deleted on back. */
  nearbyCardPinId?: number;
  /**
   * Same idea for the route wizard's "Откуда стартуем?" prompt.
   * Stored so we can delete it after the location is in.
   */
  routeLocationPromptId?: number;
}

export function freshSession(): BotSession {
  return {
    step: 'IDLE',
    updatedAt: Date.now(),
    categories: ['heritage', 'monument', 'sights', 'religion', 'nature', 'museum'],
    loopRoute: true,
  };
}

/** Flow timeout — reset stale wizard sessions (flow-patterns P4). */
export const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Guide (экскурсовод) walks 10–30 min between points — the 5-min flow timeout
 * would kill an active walk. Guide steps are exempted in SessionService and get
 * this longer TTL instead.
 */
export const GUIDE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

export function isStale(session: BotSession): boolean {
  return Date.now() - session.updatedAt >= FLOW_TIMEOUT_MS;
}
