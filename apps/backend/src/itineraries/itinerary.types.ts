import type { RouteResult, RoutingProfile } from '../routing/routing.types';
import type { ItineraryQuality } from './itinerary-quality-gate.service';

export interface Point { lat: number; lon: number; }
export type VisitMode = 'pass_by' | 'glance' | 'visit' | 'custom';
export type BudgetMode = 'whole_trip' | 'travel_only' | 'unlimited';
/** How the user started the plan; it governs budget and anchor semantics. */
export type TripIntent = 'auto_budget' | 'destination' | 'manual_collection';
/** Draft-wide default for automatically selected POIs; places can override it. */
export type StopPace = 'pass_by' | 'quick' | 'normal';
export type PlaceSource = 'manual' | 'auto' | 'custom';
export type ItineraryStatus = 'draft' | 'calculating' | 'ready' | 'error' | 'published';
export type ClusterConfidence = 'explicit' | 'walkable' | 'manual';

export interface ItineraryPoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  included: boolean;
  estimatedVisitMinutes: number;
  /** Additive ranking inputs from the live POI projection. */
  featured?: boolean;
  popularityScore?: number;
  /** Exactly one child per clustered Place is the display headline. */
  notable?: boolean;
  /** Collector provenance can supply a stable complex/relation identity. */
  explicitComplexId?: string;
  accessPoint?: Point;
}
export interface RoutePlace {
  id: string;
  name: string;
  center: Point;
  accessPoint?: Point;
  pois: ItineraryPoi[];
  visitMode: VisitMode;
  customVisitMinutes?: number;
  dwellMinutes: number;
  arrivalOverheadMinutes: number;
  source: PlaceSource;
  locked: boolean;
  clusterConfidence: ClusterConfidence;
}
export interface ItineraryTotals {
  travelMinutes: number;
  stopMinutes: number;
  reserveMinutes: number;
  totalMinutes: number;
  /** Null means that the user deliberately selected an unlimited route. */
  budgetMinutes: number | null;
  feasible: boolean;
  overBudgetMinutes: number;
  remainingMinutes: number | null;
}
export interface ItineraryWarning { code: string; message: string; placeIds?: string[]; }
export type SmartFixKind = 'reduce_visit_mode' | 'remove_worst_unlocked' | 'make_linear' | 'increase_budget';
export interface SmartFix {
  suggestionId: string;
  kind: SmartFixKind;
  reason: string;
  /** Totals after this exact change; route-changing fixes are marked estimated. */
  previewTotals: ItineraryTotals;
  /** Signed change from the current totals, so clients need not infer it. */
  delta: Pick<ItineraryTotals, 'travelMinutes' | 'stopMinutes' | 'reserveMinutes' | 'totalMinutes' | 'overBudgetMinutes' | 'remainingMinutes'>;
  affectedIds: string[];
  targetMode?: Extract<VisitMode, 'glance' | 'pass_by'>;
  targetBudgetMinutes?: number;
  estimatedRoute?: boolean;
}
/** A nearby POI the user may add to fill budget freed by `Мимо` or removal.
 *  Preview-only: nothing is added until the user accepts via a versioned command. */
export interface AdditionSuggestion {
  suggestionId: string;
  poi: ItineraryPoi;
  reason: string;
  /** Estimated extra travel to insert this POI into the current route. */
  detourMinutes: number;
  /** Visit dwell at the draft's stop pace for this POI. */
  dwellMinutes: number;
  /** Totals if this single addition were accepted (geometric estimate). */
  previewTotals: ItineraryTotals;
  delta: Pick<ItineraryTotals, 'travelMinutes' | 'stopMinutes' | 'totalMinutes' | 'overBudgetMinutes' | 'remainingMinutes'>;
}
/** Transparent automatic-selection score; values are intentionally returned rather than hidden in a rank. */
export interface AutoScoreBreakdown {
  uniquePoiQuality: number; categoryDiversity: number; geographicDiversity: number;
  /** Sequence travel efficiency (0..1×weight): penalizes high inter-place
   *  variance and backtracking — a zigzag order scores lower than a smooth
   *  geographic sweep with the same Places. */
  travelEfficiency: number;
  loopOverlap: number; profileRoadFit: number; budgetUtilization: number; elevation: number; total: number;
}
/** Display-safe public summary of the automatic selection. Contains only fields
 *  that explain the selected route. No coordinates, POI ids, or operational
 *  counters are exposed through the public draft contract. */
export type SelectionNetworkConfidence = 'verified' | 'approximate_isochrone' | 'best_confirmed';
export interface SelectionSummary {
  candidateClusters: number;
  selectedPlaces: number;
  selectedUniquePois: number;
  localityGuardApplied: boolean;
  unusedBudgetIntentional: boolean;
  /** Confidence in directed network costs used to qualify the selection pool.
   *  This is intentionally distinct from quality.networkConfirmed, which
   *  describes whether the returned route geometry came from GraphHopper. */
  networkConfidence: SelectionNetworkConfidence;
  maxAutomaticExcursionMinutes: number | null;
}
/** A persisted, lightweight selectable candidate. Route geometry is rebuilt on select. */
export interface AutoAlternative {
  alternativeId: string;
  explanation: string;
  scoreBreakdown: AutoScoreBreakdown;
  places: RoutePlace[];
  previewTotals: ItineraryTotals;
  selectionSummary?: SelectionSummary;
  /** Exact-route quality evidence for this selectable auto candidate. */
  quality?: ItineraryQuality;
}
export interface ItineraryDraft {
  id: string;
  version: number;
  status: ItineraryStatus;
  start: Point;
  finish?: Point;
  profile: RoutingProfile;
  loop: boolean;
  preset: 'balanced' | 'more_places' | 'scenic' | 'training';
  intent: TripIntent;
  stopPace: StopPace;
  budgetMode: BudgetMode;
  /** Null only when budgetMode is unlimited. */
  budgetMinutes: number | null;
  reserveMinutes: number;
  places: RoutePlace[];
  route?: RouteResult;
  /** Fingerprint of the exact ordered route inputs used for this geometry. */
  routeFingerprint?: string;
  /** Immutable saved route created by the versioned publish command. */
  publishedRouteId?: string;
  totals: ItineraryTotals;
  warnings: ItineraryWarning[];
  suggestions: SmartFix[];
  /** Preview-only nearby POIs offered after `Мимо`/removal frees budget. */
  additions: AdditionSuggestion[];
  /** Preview-only swap options for a single place (Этап 3.3). */
  replacements: AdditionSuggestion[];
  /** Selection policy version. Write-once at create time: new drafts get 'v2'
   *  (pass_by default). Legacy snapshots lacking this field are treated as 'v1'
   *  (quick default) so persisted drafts are never silently reinterpreted. */
  selectionPolicyVersion?: string;
  /** Snapshot from the last automatic fill: a display-safe public summary that
   *  explains the selected route. Set only by auto-fill/regenerate and cleared
   *  by any manual edit so it never describes a stale pool. The UI renders it
   *  verbatim and never infers locality/feasibility itself. */
  autoFillSummary?: SelectionSummary;
  /** Additive quality-gate result. Absent from legacy and manually edited snapshots. */
  quality?: ItineraryQuality;
  scoreBreakdown?: AutoScoreBreakdown;
  alternatives?: AutoAlternative[];
  createdAt: string;
  expiresAt: string;
}

/** State persisted in JSONB; immutable lifecycle columns live on the entity. */
export type ItineraryDraftState = Omit<ItineraryDraft, 'id' | 'version' | 'createdAt' | 'expiresAt'>;
export interface ItineraryPoiProjection extends ItineraryPoi {}

/** Shared-budget context for directed walkability decisions (D5). Cache hits
 *  bypass the request slot; every miss must acquire a lease. */
export interface DirectedWalkabilityContext {
  runBudget?: import('./optimization-run-budget').OptimizationRunBudget;
  signal?: AbortSignal;
  counters?: import('./optimization-run-budget').OptimizationRunCounters;
}

export interface DirectedWalkability {
  /** Network time, never a radius estimate, when a routing adapter is available. */
  minutesBetween(from: Point, to: Point, ctx?: DirectedWalkabilityContext): Promise<number | null>;
}
