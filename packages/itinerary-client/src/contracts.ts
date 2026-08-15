/** Canonical itinerary contracts shared by the web app and the Telegram Mini App.
 *
 *  Pure types only — no browser globals, no Axios, no MapLibre, no Telegram SDK.
 *  Both clients import these so the draft contract can never drift between
 *  surfaces. App-level API/transport adapters live in each app. */

export type VisitMode = 'pass_by' | 'glance' | 'visit' | 'custom';
export type BudgetMode = 'whole_trip' | 'travel_only' | 'unlimited';
/** How the user started the plan; governs budget and anchor semantics. */
export type TripIntent = 'auto_budget' | 'destination' | 'manual_collection';
/** Draft-wide default for automatically selected POIs; places can override. */
export type StopPace = 'pass_by' | 'quick' | 'normal';
export type RoutingProfile = 'bike' | 'mtb' | 'foot' | 'car' | 'bike_touring' | 'mtb_leisure' | 'foot_scenic';
export type RouteQualityWarning = 'ROUTE_UNAVAILABLE' | 'ROUTE_NOT_NETWORK_CONFIRMED' | 'BUDGET_EXCEEDED' | 'LOOP_NOT_CLOSED' | 'UNAVOIDABLE_OUT_AND_BACK';
export interface RouteQuality {
  version?: string;
  verdict?: 'confirmed' | 'degraded' | 'unconfirmed';
  feasible?: boolean;
  networkConfirmed?: boolean;
  warnings?: RouteQualityWarning[];
}
export type RoadFactKind = 'road_class' | 'surface' | 'road_environment' | 'track_type';
export interface RoadFactValue { value: string; distance: number; share: number; }
export interface RoadFact { kind: RoadFactKind; values: RoadFactValue[]; }
export type AutoFillPreset = 'balanced' | 'more_places' | 'scenic' | 'training';

export interface Point { lat: number; lon: number; }

export interface ItineraryPoi {
  id: string; name: string; category: string; lat: number; lon: number; included: boolean; estimatedVisitMinutes: number;
  /** Optional backend ranking/display metadata; absent on legacy draft JSONB. */
  featured?: boolean; popularityScore?: number; notable?: boolean;
  explicitComplexId?: string; accessPoint?: Point;
}
export interface RoutePlace {
  id: string; name: string; pois: ItineraryPoi[];
  visitMode: VisitMode; customVisitMinutes?: number; dwellMinutes: number; arrivalOverheadMinutes: number;
  source: 'manual' | 'auto' | 'custom'; locked: boolean;
}

export interface ItineraryTotals {
  travelMinutes: number; stopMinutes: number; reserveMinutes: number; totalMinutes: number;
  budgetMinutes: number | null; feasible: boolean; overBudgetMinutes: number; remainingMinutes: number | null;
}

export type SmartFixKind = 'reduce_visit_mode' | 'remove_worst_unlocked' | 'make_linear' | 'increase_budget';
export interface SmartFix {
  suggestionId: string; kind: SmartFixKind; reason: string;
  previewTotals: ItineraryTotals;
  delta: Pick<ItineraryTotals, 'travelMinutes' | 'stopMinutes' | 'reserveMinutes' | 'totalMinutes' | 'overBudgetMinutes' | 'remainingMinutes'>;
  affectedIds: string[];
  targetMode?: Extract<VisitMode, 'glance' | 'pass_by'>;
  targetBudgetMinutes?: number;
  estimatedRoute?: boolean;
}

export interface ItineraryRoute {
  distance: number; duration: number; ascend: number; descend: number; profile: string;
  bbox?: [number, number, number, number];
  geojson: { type: 'Feature'; geometry: { type: string; coordinates: number[][] } | null; properties: Record<string, unknown> };
  /** Additive GraphHopper path-detail evidence, absent when the server has none. */
  roadFacts?: RoadFact[];
  /** Additive exact-route evidence, absent from legacy/manual snapshots. */
  quality?: RouteQuality;
}

export interface AutoScoreBreakdown {
  uniquePoiQuality: number; categoryDiversity: number; geographicDiversity: number;
  loopOverlap: number; profileRoadFit: number; budgetUtilization: number; elevation: number; total: number;
}

export interface AutoAlternative {
  alternativeId: string; explanation: string;
  scoreBreakdown: AutoScoreBreakdown; places: RoutePlace[]; previewTotals: ItineraryTotals;
}

/** Preview-only nearby POI offered after `Мимо`/removal frees budget, or as a
 *  swap option for one place. Nothing is added until the user accepts. */
export interface AdditionSuggestion {
  suggestionId: string; poi: ItineraryPoi; reason: string;
  detourMinutes: number; dwellMinutes: number;
  previewTotals: ItineraryTotals;
  delta: Pick<ItineraryTotals, 'travelMinutes' | 'stopMinutes' | 'totalMinutes' | 'overBudgetMinutes' | 'remainingMinutes'>;
}

export interface ItineraryAlternativePreview {
  draftId: string; version: number; alternativeId: string;
  route: ItineraryRoute; places: RoutePlace[]; totals: ItineraryTotals;
  quality?: RouteQuality; warnings: { code: string; message: string; placeIds?: string[] }[];
}

export interface ItineraryDraft {
  id: string; version: number;
  status: 'draft' | 'calculating' | 'ready' | 'error' | 'published';
  start: Point; finish?: Point;
  profile: RoutingProfile; loop: boolean; preset: AutoFillPreset;
  intent: TripIntent; stopPace: StopPace;
  budgetMode: BudgetMode; budgetMinutes: number | null; reserveMinutes: number;
  places: RoutePlace[];
  route?: ItineraryRoute; routeFingerprint?: string; publishedRouteId?: string;
  /** Exact-route quality is separate from geometry and absent when not supplied. */
  quality?: RouteQuality;
  totals: ItineraryTotals;
  warnings: { code: string; message: string; placeIds?: string[] }[];
  suggestions: SmartFix[];
  additions: AdditionSuggestion[];
  replacements: AdditionSuggestion[];
  /** Snapshot from the last automatic fill: distinct candidate clusters in
   *  the reachable area. Cleared by any manual edit. */
  autoFillSummary?: { candidateClusters: number };
  scoreBreakdown?: AutoScoreBreakdown;
  alternatives?: AutoAlternative[];
  createdAt: string; expiresAt: string;
}

export interface CreateItineraryInput {
  start: Point; finish?: Point;
  profile: RoutingProfile; loop: boolean;
  intent?: TripIntent; stopPace?: StopPace;
  budgetMode?: BudgetMode; budgetMinutes?: number; reserveMinutes?: number;
  preset?: AutoFillPreset;
}

export type Command = { expectedVersion: number; commandId: string };
