import api from './index';
import {
  commandId,
  conflictSnapshot as sharedConflictSnapshot,
  createItineraryApi,
  itineraryHeaders,
} from '@nearventure/itinerary-client/api';
import type { AdditionSuggestion as SharedAdditionSuggestion } from '@nearventure/itinerary-client/contracts';
import type { Command, CreateItineraryInput, ItineraryDraft } from './itinerary-contracts';

/**
 * Web transport adapter for the shared itinerary client. The backend contract
 * is additive; local display types mirror it until the deleted shared package
 * is reconciled by its owner.
 */
export type {
  AdditionSuggestion, AutoAlternative, AutoFillPreset, AutoScoreBreakdown, BudgetMode,
  ClusterConfidence, Command, CreateItineraryInput, ItineraryDraft, ItineraryPoi,
  ItineraryRoute, ItineraryTotals, Point, RoutePlace, RoutingProfile, SelectionNetworkConfidence,
  SelectionSummary, SmartFix, SmartFixKind, StopPace, TripIntent, VisitMode,
} from './itinerary-contracts';
export { commandId };

const sharedApi = createItineraryApi(api);

export async function createItinerary(
  input: CreateItineraryInput,
  clientId: string,
  signal?: AbortSignal,
): Promise<ItineraryDraft> {
  return sharedApi.createItinerary(input, clientId, signal) as Promise<ItineraryDraft>;
}

export async function getItinerary(
  id: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<ItineraryDraft> {
  return sharedApi.getItinerary(id, clientId, signal) as Promise<ItineraryDraft>;
}

export async function itineraryCommand<T extends Command>(
  id: string,
  action: string,
  payload: T,
  clientId: string,
  signal?: AbortSignal,
): Promise<ItineraryDraft> {
  return sharedApi.itineraryCommand(id, action, payload, clientId, signal) as Promise<ItineraryDraft>;
}

export async function discardItinerary(
  id: string,
  payload: Command,
  clientId: string,
  signal?: AbortSignal,
): Promise<void> {
  await sharedApi.discardItinerary(id, payload, clientId, signal);
}

export async function previewAlternative(id: string, alternativeId: string, expectedVersion: number, clientId: string, signal?: AbortSignal) {
  return sharedApi.previewAlternative(id, alternativeId, expectedVersion, clientId, signal) as Promise<import('@nearventure/itinerary-client/contracts').ItineraryAlternativePreview>;
}

export function conflictSnapshot(error: unknown): ItineraryDraft | null {
  return sharedConflictSnapshot(error) as ItineraryDraft | null;
}

export interface RouteImpactItem {
  poiId: string;
  available: boolean;
  estimate?: SharedAdditionSuggestion;
}

/** Read-only POI-shop preview; it never mutates or versions the draft. */
export async function getRouteImpact(
  id: string,
  poiIds: string[],
  clientId: string,
  signal?: AbortSignal,
): Promise<RouteImpactItem[]> {
  const response = await api.post<RouteImpactItem[]>(
    `/api/itineraries/${id}/route-impact`,
    { poiIds },
    { ...itineraryHeaders(clientId), signal },
  );
  return response.data;
}
