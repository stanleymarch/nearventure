import { computed, ref } from 'vue';
import { conflictSnapshot, createItinerary, discardItinerary, getItinerary, getRouteImpact, itineraryCommand, previewAlternative, commandId, type CreateItineraryInput, type ItineraryDraft, type VisitMode, type AutoFillPreset, type RouteImpactItem } from '@/api/itineraries';
import { useClientId } from './useClientId';
import { isRoutingCapableItineraryDraftCommand, type ItineraryDraftCommand } from '@/api/itinerary-draft-commands';

/** Versioned draft state. A newer request cancels its predecessor so late data
 * cannot repaint the map/rail with an older geometry. */
export function useItineraryDraft() {
  const draft = ref<ItineraryDraft | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const offline = ref(false);
  const preview = ref<Awaited<ReturnType<typeof previewAlternative>> | null>(null);
  let previewController: AbortController | null = null;
  const impactLoading = ref(false);
  const impactError = ref<string | null>(null);
  let controller: AbortController | null = null;
  let requestToken = 0;
  let impactController: AbortController | null = null;
  const clientId = useClientId();
  const hasDraft = computed(() => !!draft.value);
  let canRoute: (() => boolean) | null = null;
  let onRoutingBlocked: (() => void) | null = null;
  function setRoutingGuard(available: () => boolean, blocked: () => void) {
    canRoute = available;
    onRoutingBlocked = blocked;
  }

  async function run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    controller?.abort();
    controller = new AbortController();
    const current = controller;
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
        error.value = 'Черновик изменён в другой вкладке — показана свежая версия.';
        return null;
      }
      offline.value = !e?.response;
      error.value = offline.value ? 'Нет сети. Последний маршрут оставлен на карте.' : (e?.response?.data?.message || 'Не удалось обновить путешествие.');
      return null;
    } finally {
      if (token === requestToken && controller === current) loading.value = false;
    }
  }
  async function create(input: CreateItineraryInput) { const next = await run((signal) => createItinerary(input, clientId, signal)); if (next) draft.value = next; return next; }
  async function hydrate(id: string) { const next = await run((signal) => getItinerary(id, clientId, signal)); if (next) draft.value = next; return next; }
  async function command(action: ItineraryDraftCommand, payload: Record<string, unknown> = {}) {
    if (!draft.value) return null;
    if (isRoutingCapableItineraryDraftCommand(action) && canRoute && !canRoute()) {
      onRoutingBlocked?.();
      return null;
    }
    const current = draft.value;
    const next = await run((signal) => itineraryCommand(current.id, action, { ...payload, expectedVersion: current.version, commandId: commandId() }, clientId, signal));
    if (next) draft.value = next;
    return next;
  }
  const addPoi = (poiId: string) => command('add-poi', { poiId });
  const removePlace = (placeId: string) => command('remove-place', { placeId });
  const setVisitMode = (placeId: string, mode: VisitMode, customVisitMinutes?: number) => command('set-visit-mode', { placeId, mode, ...(mode === 'custom' ? { customVisitMinutes } : {}) });
  const setLocked = (placeId: string, locked: boolean) => command('set-locked', { placeId, locked });
  const reorder = (orderedPlaceIds: string[]) => command('reorder', { orderedPlaceIds });
  const autoFill = (preferredCategories: string[], seed?: number, preset?: AutoFillPreset) => command('auto-fill', { preferredCategories, ...(seed === undefined ? {} : { seed }), ...(preset ? { preset } : {}) });
  const applySmartFix = (suggestionId: string) => command('apply-smart-fix', { suggestionId });
  const acceptAddition = (suggestionId: string) => command('accept-addition', { suggestionId });
  const replacePlace = (placeId: string) => command('replace-place', { placeId });
  const acceptReplacement = (suggestionId: string) => command('accept-replacement', { suggestionId });
  const selectAlternative = (alternativeId: string) => command('select-alternative', { alternativeId });
  const replan = () => command('replan');
  const undo = () => command('undo');
  async function showAlternativePreview(alternativeId: string) {
    if (!draft.value) return null;
    // Never leave a previous alternative on the map while a new one is loading.
    clearAlternativePreview(); previewController = new AbortController();
    const current = draft.value; const controller = previewController;
    try {
      const result = await previewAlternative(current.id, alternativeId, current.version, clientId, controller.signal);
      if (controller === previewController && draft.value?.id === current.id && draft.value.version === current.version) preview.value = result;
      return preview.value;
    } catch { if (controller === previewController) preview.value = null; return null; }
  }
  function clearAlternativePreview() { previewController?.abort(); previewController = null; preview.value = null; }
  const publish = () => command('publish');
  async function discard(): Promise<boolean> {
    const current = draft.value;
    if (!current) return true;
    const done = await run(async (signal) => {
      await discardItinerary(current.id, { expectedVersion: current.version, commandId: commandId() }, clientId, signal);
      return true;
    });
    if (!done) return false;
    // Only a confirmed 204 may remove the local snapshot. Network/conflict
    // errors remain visible and leave the current route intact for retry.
    if (draft.value?.id === current.id) draft.value = null;
    return true;
  }
  async function routeImpact(poiIds: string[]): Promise<RouteImpactItem[]> {
    if (!draft.value?.route || !poiIds.length) return [];
    impactController?.abort();
    impactController = new AbortController();
    const current = impactController;
    impactLoading.value = true;
    impactError.value = null;
    try {
      return await getRouteImpact(draft.value.id, poiIds, clientId, current.signal);
    } catch (e: any) {
      if (e?.name === 'CanceledError' || e?.name === 'AbortError') return [];
      impactError.value = e?.response ? 'Не удалось оценить влияние точки.' : 'Нет сети: оценка точки недоступна.';
      return [];
    } finally {
      if (impactController === current) impactLoading.value = false;
    }
  }
  function cancelImpact() { impactController?.abort(); impactController = null; impactLoading.value = false; }
  return { draft, hasDraft, loading, error, offline, impactLoading, impactError, preview, setRoutingGuard, create, hydrate, command, addPoi, removePlace, setVisitMode, setLocked, reorder, autoFill, applySmartFix, acceptAddition, replacePlace, acceptReplacement, selectAlternative, showAlternativePreview, clearAlternativePreview, replan, undo, publish, discard, cancelImpact, routeImpact };
}
