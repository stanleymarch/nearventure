import { api } from './index';
import {
  commandId,
  conflictSnapshot as sharedConflictSnapshot,
  createItineraryApi,
} from '@nearventure/itinerary-client/api';
import type { Command, CreateItineraryInput, ItineraryDraft } from '@shared/api/itinerary-contracts';
import type { ItineraryAlternativePreview } from '@nearventure/itinerary-client';

/** Mini App transport adapter over the same versioned itinerary capability. */
export type {
  AdditionSuggestion, AutoAlternative, AutoFillPreset, AutoScoreBreakdown, BudgetMode,
  ClusterConfidence, Command, CreateItineraryInput, ItineraryDraft, ItineraryPoi,
  ItineraryRoute, ItineraryTotals, Point, RoutePlace, RoutingProfile, SelectionNetworkConfidence,
  SelectionSummary, SmartFix, SmartFixKind, StopPace, TripIntent, VisitMode,
} from '@shared/api/itinerary-contracts';
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

export async function discardItinerary(id: string, command: Command, clientId: string, signal?: AbortSignal): Promise<void> {
  await sharedApi.discardItinerary(id, command, clientId, signal);
}

export async function previewAlternative(id: string, alternativeId: string, expectedVersion: number, clientId: string, signal?: AbortSignal): Promise<ItineraryAlternativePreview> {
  return sharedApi.previewAlternative(id, alternativeId, expectedVersion, clientId, signal) as Promise<ItineraryAlternativePreview>;
}

export function conflictSnapshot(error: unknown): ItineraryDraft | null {
  return sharedConflictSnapshot(error) as ItineraryDraft | null;
}
