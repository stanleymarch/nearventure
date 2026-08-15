import type {
  AdditionSuggestion,
  AutoAlternative as SharedAutoAlternative,
  AutoFillPreset,
  AutoScoreBreakdown,
  BudgetMode,
  Command,
  CreateItineraryInput,
  ItineraryDraft as SharedItineraryDraft,
  ItineraryPoi as SharedItineraryPoi,
  ItineraryRoute,
  ItineraryTotals,
  Point,
  RoutePlace as SharedRoutePlace,
  RoutingProfile,
  SmartFix,
  SmartFixKind,
  StopPace,
  TripIntent,
  VisitMode,
} from '@nearventure/itinerary-client/contracts';

/**
 * Temporary client projection of the additive backend itinerary fields.
 * `apps/backend/src/itineraries/itinerary.types.ts` is canonical. Keep this
 * adapter local until the owner resolves the deleted shared-package tree.
 */
export type {
  AdditionSuggestion,
  AutoFillPreset,
  AutoScoreBreakdown,
  BudgetMode,
  Command,
  CreateItineraryInput,
  ItineraryRoute,
  ItineraryTotals,
  Point,
  RoutingProfile,
  SmartFix,
  SmartFixKind,
  StopPace,
  TripIntent,
  VisitMode,
};

export type ClusterConfidence = 'explicit' | 'walkable' | 'manual';
export type SelectionNetworkConfidence = 'verified' | 'approximate_isochrone' | 'best_confirmed';

export interface SelectionSummary {
  candidateClusters: number;
  selectedPlaces: number;
  selectedUniquePois: number;
  localityGuardApplied: boolean;
  unusedBudgetIntentional: boolean;
  networkConfidence: SelectionNetworkConfidence;
  maxAutomaticExcursionMinutes: number | null;
}

export type ItineraryPoi = SharedItineraryPoi;

export type RoutePlace = Omit<SharedRoutePlace, 'pois'> & {
  center: Point;
  accessPoint?: Point;
  pois: ItineraryPoi[];
  clusterConfidence: ClusterConfidence;
};

export type AutoAlternative = Omit<SharedAutoAlternative, 'places'> & {
  places: RoutePlace[];
  selectionSummary?: SelectionSummary;
};

export type ItineraryDraft = Omit<SharedItineraryDraft, 'places' | 'alternatives' | 'autoFillSummary'> & {
  finish?: Point;
  places: RoutePlace[];
  alternatives?: AutoAlternative[];
  autoFillSummary?: SelectionSummary;
  selectionPolicyVersion?: string;
};
