import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: { params: { id: 'draft-1' }, query: {} as Record<string, string> } as any,
  router: { push: vi.fn(), replace: vi.fn() },
  draft: { value: null as any },
  hydrate: vi.fn(),
  publish: vi.fn(),
  alert: vi.fn().mockResolvedValue(undefined),
  startGuide: vi.fn(),
  close: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => state.router,
}));
vi.mock('@/composables/useTelegram', () => ({
  useTelegram: () => ({
    showBackButton: vi.fn(() => () => {}), setMainButton: vi.fn(() => () => {}), hideMainButton: vi.fn(),
    mainButtonProgress: vi.fn(), haptic: { impact: vi.fn(), notify: vi.fn() }, alert: state.alert,
  }),
}));
vi.mock('@/composables/useBotShortcut', () => ({ useBotShortcut: vi.fn() }));
vi.mock('@/composables/useItineraryDraft', () => ({
  useItineraryDraft: () => ({
    draft: state.draft, loading: { value: false }, error: { value: null }, hydrate: state.hydrate,
    publish: state.publish, setRoutingGuard: vi.fn(), setVisitMode: vi.fn(), setLocked: vi.fn(), removePlace: vi.fn(),
    updateSettings: vi.fn(), applySmartFix: vi.fn(), acceptAddition: vi.fn(), replacePlace: vi.fn(),
    acceptReplacement: vi.fn(), selectAlternative: vi.fn(), autoFill: vi.fn(), undo: vi.fn(),
  }),
}));
vi.mock('@/composables/useRouting', () => ({
  VISIT_MIN_PER_POI: 10,
  fetchGpx: vi.fn(),
  getRoutingHealth: vi.fn().mockResolvedValue({ available: true, profiles: ['foot'] }),
  startGuideFromMiniApp: state.startGuide,
}));
vi.mock('@shared/api/routing-contracts', () => ({
  createLatestRequestGate: () => ({ begin: () => 1, isCurrent: () => true }),
  isRoutingProfileAvailable: () => true,
}));
vi.mock('@/components/ui/button', () => ({ Button: { template: '<button v-bind="$attrs"><slot /></button>' } }));
vi.mock('@/components/PreviewMap.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@shared/components/route/RouteEvidence.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/itinerary/ItinerarySummary.vue', () => ({
  default: { emits: ['publish'], template: '<button data-test="publish" @click="$emit(\'publish\')">Publish</button>' },
}));

import RoutePreviewView from './RoutePreviewView.vue';

function canonicalDraft(publishedRouteId?: string) {
  return {
    id: 'draft-1', version: 3, publishedRouteId, profile: 'foot', budgetMode: 'whole_trip',
    totals: { feasible: true, totalMinutes: 30, travelMinutes: 20, stopMinutes: 10, budgetMinutes: 60, overBudgetMinutes: 0 },
    places: [{ name: 'Stop', pois: [{ id: 'poi-1', name: 'Stop', category: 'heritage', lat: 58.61, lon: 49.61 }] }],
    route: {
      distance: 1_000, duration: 600, ascend: 10, descend: 10, profile: 'foot',
      geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] }, properties: {} },
    },
  };
}

async function mountPreview() {
  const wrapper = mount(RoutePreviewView);
  await flushPromises();
  return wrapper;
}

function action(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
  if (!button) throw new Error(`Missing ${label} action`);
  return button;
}

describe('RoutePreviewView canonical guide and share boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.route = { params: { id: 'draft-1' }, query: {} };
    state.draft.value = canonicalDraft();
    state.hydrate.mockImplementation(async () => state.draft.value);
    state.publish.mockImplementation(async () => {
      state.draft.value = { ...state.draft.value, publishedRouteId: 'public-route-42' };
      return state.draft.value;
    });
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: { initData: 'signed-init-data', close: state.close } } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requires publication before sharing and shares only the public route id', async () => {
    const wrapper = await mountPreview();

    await action(wrapper, 'Поделиться').trigger('click');
    expect(state.alert).toHaveBeenCalledWith(expect.stringContaining('Сначала сохраните'));
    expect(navigator.share).not.toHaveBeenCalled();

    await wrapper.get('[data-test="publish"]').trigger('click');
    expect(state.publish).toHaveBeenCalledOnce();
    await action(wrapper, 'Поделиться').trigger('click');

    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
      url: `${window.location.origin}/#/route/public-route-42`,
    }));
    expect((navigator.share as any).mock.calls[0][0].url).not.toContain('draft-1');
  });

  it('does not render guide or share actions for a volatile manual route without a canonical draft', async () => {
    state.route = { params: {}, query: {} };
    state.draft.value = null;
    const wrapper = await mountPreview();

    expect(wrapper.text()).toContain('Маршрут не найден');
    expect(wrapper.text()).not.toContain('Поделиться');
    expect(wrapper.text()).not.toContain('Экскурсия');
    expect(state.startGuide).not.toHaveBeenCalled();
    expect(navigator.share).not.toHaveBeenCalled();
  });
});
