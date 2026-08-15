import type { Command, CreateItineraryInput, ItineraryAlternativePreview, ItineraryDraft } from './contracts';

/** Minimal transport contract. Axios, fetch adapters, and test doubles can all
 * implement it; the shared client deliberately does not own auth or base URL. */
export interface ItineraryHttpClient {
  post<T>(url: string, data?: unknown, config?: ItineraryRequestConfig): Promise<{ data: T }>;
  get<T>(url: string, config?: ItineraryRequestConfig): Promise<{ data: T }>;
}

export interface ItineraryRequestConfig {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type ItineraryHeadersFactory = (clientId: string) => ItineraryRequestConfig;

/** Browser headers common to web and Telegram Mini App. Individual apps still
 * attach their own JWT interceptor to the injected HTTP client. */
export function itineraryHeaders(clientId: string): ItineraryRequestConfig {
  const telegram = globalThis as typeof globalThis & {
    Telegram?: { WebApp?: { initData?: string } };
  };
  const initData = telegram.Telegram?.WebApp?.initData;
  return { headers: { 'x-nv-client-id': clientId, ...(initData ? { 'x-telegram-initdata': initData } : {}) } };
}

export function createItineraryApi(
  http: ItineraryHttpClient,
  headers: ItineraryHeadersFactory = itineraryHeaders,
) {
  return {
    async createItinerary(input: CreateItineraryInput, clientId: string, signal?: AbortSignal): Promise<ItineraryDraft> {
      return (await http.post<ItineraryDraft>('/api/itineraries', input, { ...headers(clientId), signal })).data;
    },
    async getItinerary(id: string, clientId: string, signal?: AbortSignal): Promise<ItineraryDraft> {
      return (await http.get<ItineraryDraft>(`/api/itineraries/${id}`, { ...headers(clientId), signal })).data;
    },
    async itineraryCommand<T extends Command>(id: string, action: string, command: T, clientId: string, signal?: AbortSignal): Promise<ItineraryDraft> {
      return (await http.post<ItineraryDraft>(`/api/itineraries/${id}/commands/${action}`, command, { ...headers(clientId), signal })).data;
    },
    /** 204 means the unpublished draft is gone; missing/foreign ids are also a safe no-op. */
    async discardItinerary(id: string, command: Command, clientId: string, signal?: AbortSignal): Promise<void> {
      await http.post<void>(`/api/itineraries/${id}/commands/discard`, command, { ...headers(clientId), signal });
    },
    async previewAlternative(id: string, alternativeId: string, expectedVersion: number, clientId: string, signal?: AbortSignal): Promise<ItineraryAlternativePreview> {
      return (await http.get<ItineraryAlternativePreview>(`/api/itineraries/${id}/alternatives/${alternativeId}/preview?expectedVersion=${expectedVersion}`, { ...headers(clientId), signal })).data;
    },
  };
}

export function commandId(): string {
  return crypto.randomUUID();
}

/** Extract the server snapshot from a version-conflict response. Supports both
 * raw domain errors and the shape produced by the shared HTTP exception filter. */
export function conflictSnapshot(error: unknown): ItineraryDraft | null {
  type ConflictBody = { error?: { details?: { snapshot?: ItineraryDraft } }; details?: { snapshot?: ItineraryDraft }; snapshot?: ItineraryDraft };
  const failure = error as { status?: number; details?: { snapshot?: ItineraryDraft }; snapshot?: ItineraryDraft; response?: { status?: number; data?: ConflictBody } };
  const body = failure?.response?.data;
  if ((failure?.response?.status ?? failure?.status) !== 409) return null;
  return body?.error?.details?.snapshot ?? body?.details?.snapshot ?? body?.snapshot ?? failure?.details?.snapshot ?? failure?.snapshot ?? null;
}
