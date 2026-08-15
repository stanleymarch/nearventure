import { computed, ref } from 'vue';
import { conflictSnapshot, createItinerary, discardItinerary, getItinerary, itineraryCommand, previewAlternative, commandId } from '@/api/itineraries';
import type { ItineraryAlternativePreview } from '@nearventure/itinerary-client';
import type { CreateItineraryInput, ItineraryDraft, VisitMode, AutoFillPreset } from '@/api/itineraries';
import { isRoutingCapableItineraryDraftCommand, type ItineraryDraftCommand } from '@shared/api/itinerary-draft-commands';

const OWNER_KEY = 'nv:client-id:v1';
function clientId(): string {
  try {
    let id = localStorage.getItem(OWNER_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(OWNER_KEY, id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

export function useItineraryDraft() {
  const draft = ref<ItineraryDraft | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const offline = ref(false);
  const preview = ref<ItineraryAlternativePreview | null>(null);
  let request: AbortController | null = null;
  let requestToken = 0;
  const owner = clientId();
  let canRoute: (() => boolean) | null = null;
  let onRoutingBlocked: (() => void) | null = null;
  /** Central boundary for commands that issue, or are immediately followed by, routing. */
  function setRoutingGuard(available: () => boolean, blocked: () => void) {
    canRoute = available;
    onRoutingBlocked = blocked;
  }

  async function run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    request?.abort();
    request = new AbortController();
    const current = request;
    const token = ++requestToken;
    loading.value = true;
    error.value = null;
    try {
      offline.value = false;
      const result = await work(current.signal);
      return token === requestToken ? result : null;
    } catch (e: any) {
      if (token !== requestToken || e?.name === 'CanceledError' || e?.name === 'AbortError') return null;
      const fresh = conflictSnapshot(e);
      if (fresh) {
        draft.value = fresh;
        error.value = 'Маршрут обновлён в другой сессии. Показана свежая версия.';
        return null;
      }
      offline.value = !e?.response;
      error.value = offline.value ? 'Нет сети — показываем последнюю версию.' : (e?.response?.data?.message || 'Не удалось обновить маршрут.');
      return null;
    } finally {
      if (token === requestToken && request === current) loading.value = false;
    }
  }
  async function create(input: CreateItineraryInput) { const value = await run(signal => createItinerary(input, owner, signal)); if (value) draft.value = value; return value; }
  async function hydrate(id: string) { const value = await run(signal => getItinerary(id, owner, signal)); if (value) draft.value = value; return value; }
  async function command(action: ItineraryDraftCommand, payload: Record<string, unknown> = {}, stableCommandId?: string) {
    if (!draft.value) return null;
    if (isRoutingCapableItineraryDraftCommand(action) && canRoute && !canRoute()) {
      onRoutingBlocked?.();
      return null;
    }
    const snapshot = draft.value;
    const value = await run(signal => itineraryCommand(snapshot.id, action, { ...payload, expectedVersion: snapshot.version, commandId: stableCommandId ?? commandId() }, owner, signal));
    if (value) draft.value = value; return value;
  }
  async function discard() {
    const snapshot = draft.value; if (!snapshot) return false;
    const ok = await run(async signal => { await discardItinerary(snapshot.id, { expectedVersion: snapshot.version, commandId: commandId() }, owner, signal); return snapshot; });
    if (ok) { draft.value = null; preview.value = null; return true; } return false;
  }
  async function showAlternativePreview(alternativeId: string) {
    const snapshot = draft.value; if (!snapshot) return null;
    const value = await run(signal => previewAlternative(snapshot.id, alternativeId, snapshot.version, owner, signal));
    if (value) preview.value = value; return preview.value;
  }
  const clearAlternativePreview = () => { preview.value = null; };
  return {
    draft, loading, error, offline, preview, hasDraft: computed(() => !!draft.value), setRoutingGuard, create, hydrate, command, discard, showAlternativePreview, clearAlternativePreview,
    addPoi: (poiId: string, stableCommandId?: string) => command('add-poi', { poiId }, stableCommandId),
    removePlace: (placeId: string) => command('remove-place', { placeId }),
    setVisitMode: (placeId: string, mode: VisitMode, customVisitMinutes?: number) => command('set-visit-mode', { placeId, mode, ...(mode === 'custom' ? { customVisitMinutes } : {}) }),
    setLocked: (placeId: string, locked: boolean) => command('set-locked', { placeId, locked }),
    reorder: (orderedPlaceIds: string[]) => command('reorder', { orderedPlaceIds }),
    updateSettings: (settings: Record<string, unknown>) => command('update-settings', settings),
    autoFill: (preferredCategories: string[], seed?: number, preset?: AutoFillPreset) => command('auto-fill', { preferredCategories, ...(seed === undefined ? {} : { seed }), ...(preset ? { preset } : {}) }),
    applySmartFix: (suggestionId: string) => command('apply-smart-fix', { suggestionId }),
    acceptAddition: (suggestionId: string) => command('accept-addition', { suggestionId }),
    replacePlace: (placeId: string) => command('replace-place', { placeId }),
    acceptReplacement: (suggestionId: string) => command('accept-replacement', { suggestionId }),
    selectAlternative: (alternativeId: string) => command('select-alternative', { alternativeId }),
    replan: () => command('replan'),
    undo: () => command('undo'),
    publish: () => command('publish'),
  };
}
