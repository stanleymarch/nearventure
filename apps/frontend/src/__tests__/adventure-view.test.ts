// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const routerMock = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {} }),
  useRouter: () => routerMock,
}));

vi.mock('maplibre-gl', () => ({
  default: { Map: class {}, Marker: class {}, NavigationControl: class {}, LngLatBounds: class {} },
}));

vi.mock('motion-v', () => ({
  Motion: { template: '<div><slot /></div>' },
  AnimatePresence: { template: '<div><slot /></div>' },
}));

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/components/AdventureMap.vue', () => ({
  default: {
    name: 'AdventureMap',
    template: '<div data-test="map" />',
    methods: {
      drawRoutePreview() {}, clearRoutePreview() {}, flyToBounds() {},
      panTo() {}, drawIsochrone() {}, clearIsochrone() {},
    },
  },
}));
vi.mock('@/components/OnboardingCarousel.vue', () => ({ default: { name: 'OnboardingCarousel', template: '<div />' } }));
vi.mock('@/components/DragRail.vue', () => ({ default: { name: 'DragRail', template: '<div />' } }));
vi.mock('@/components/Icon.vue', () => ({ default: { props: ['name'], template: '<span aria-hidden="true" />' } }));

vi.mock('@/api/pois', () => ({
  getPois: vi.fn(),
  poiName: (p: any) => p?.name || 'Без названия',
  poiAttribution: () => null,
  poiHasExternalLinks: () => false,
  isVkUrl: () => false,
  poiMediaUrlById: () => '',
  SOURCE_LABELS: {},
  HERITAGE_LABELS: {},
}));

vi.mock('@/api/routing', () => ({
  planRoute: vi.fn(),
  getRoutingHealth: vi.fn(),
  downloadGpx: vi.fn(),
  getIsochrone: vi.fn(),
  formatDistance: (m: number) => `${Math.round(m)} м`,
  formatDuration: (m: number) => `${Math.round(m)} мин`,
  straightDistance: () => 0,
}));

vi.mock('@/api/routes', () => ({
  createRoute: vi.fn(),
  toCreateRouteDto: vi.fn((args: any) => args),
}));

vi.mock('@/composables/useGeolocation', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue');
  const locate = vi.fn();
  return {
    useGeolocation: () => ({ locate, loading: vue.ref(false), error: vue.ref(null), lastKnown: vue.ref(null) }),
    budgetToDistance: (minutes: number, profile: string) =>
      Math.round((({ bike: 15, mtb: 12, foot: 5, car: 40 } as Record<string, number>)[profile] ?? 15) * (minutes / 60) * 1000),
    formatMinutes: (mins: number) => `${mins} МИН`,
    __locate: locate,
  };
});

vi.mock('@/composables/useTheme', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue');
  return {
    useTheme: () => ({ isDark: vue.ref(false), toggleTheme: vi.fn(), setTheme: vi.fn() }),
  };
});

vi.mock('@/composables/useItineraryDraft', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue');
  const draft = vue.ref<any>(null);
  const api = {
    draft,
    hasDraft: vue.computed(() => !!draft.value),
    loading: vue.ref(false),
    error: vue.ref<string | null>(null),
    offline: vue.ref(false),
    impactLoading: vue.ref(false),
    impactError: vue.ref(null),
    preview: vue.ref(null),
    setRoutingGuard: vi.fn(),
    create: vi.fn(),
    hydrate: vi.fn(),
    command: vi.fn(),
    addPoi: vi.fn(),
    removePlace: vi.fn(),
    setVisitMode: vi.fn(),
    setLocked: vi.fn(),
    reorder: vi.fn(),
    autoFill: vi.fn(),
    applySmartFix: vi.fn(),
    acceptAddition: vi.fn(),
    replacePlace: vi.fn(),
    acceptReplacement: vi.fn(),
    selectAlternative: vi.fn(),
    showAlternativePreview: vi.fn(),
    clearAlternativePreview: vi.fn(),
    discard: vi.fn(),
    cancelImpact: vi.fn(),
    replan: vi.fn(),
    undo: vi.fn(),
    publish: vi.fn(),
    routeImpact: vi.fn(),
  };
  return { useItineraryDraft: () => api, __itinerary: api };
});

vi.mock('@/lib/map-styles', () => ({
  DEFAULT_STYLE_CONFIG: { base: 'light', overlays: { cycling: false, hiking: false, hillshade: false, contours: false } },
  buildStyle: () => ({}),
}));

import AdventureView from '@/views/AdventureView.vue';
import { createRoute } from '@/api/routes';
import { getRoutingHealth } from '@/api/routing';

const { __itinerary } = (await import('@/composables/useItineraryDraft')) as any;
const { __locate } = (await import('@/composables/useGeolocation')) as any;

/** Minimal feasible routed draft in the shape the view expects. */
function routedDraft(publishedRouteId?: string) {
  return {
    id: 'draft-1',
    version: 1,
    status: publishedRouteId ? 'published' : 'ready',
    publishedRouteId,
    profile: 'foot',
    start: { lat: 58.6, lon: 49.68 },
    loop: true,
    intent: 'manual_collection',
    budgetMode: 'whole_trip',
    budgetMinutes: 60,
    places: [],
    totals: { travelMinutes: 10, stopMinutes: 0, reserveMinutes: 0, totalMinutes: 10, budgetMinutes: 60, feasible: true, overBudgetMinutes: 0, remainingMinutes: 50 },
    route: {
      geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[49.68, 58.6], [49.69, 58.61]] } },
      distance: 1200,
      duration: 15,
      ascend: 10,
      descend: 5,
    },
  };
}

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = '';
  thresholds = [];
}

describe('AdventureView published-route share and start-point semantics', () => {
  beforeEach(() => {
    vi.mocked(routerMock.push).mockReset();
    vi.mocked(createRoute).mockReset();
    vi.mocked(getRoutingHealth).mockReset();
    vi.mocked(getRoutingHealth).mockResolvedValue({ available: true, profiles: ['bike', 'foot'] });
    __locate.mockReset();
    __itinerary.draft.value = null;
    __itinerary.publish.mockReset();
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('hides desktop share for an unpublished draft while keeping GPX', async () => {
    __itinerary.draft.value = routedDraft();
    const wrapper = mount(AdventureView, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[aria-label="Поделиться маршрутом"]').exists()).toBe(false);
    // The route summary card keeps GPX and offers an explicit save instead.
    expect(wrapper.text()).toContain('GPX');
    expect(wrapper.text()).toContain('Сохранить маршрут');
    expect(wrapper.text()).not.toContain('Telegram');
  });

  it('sends a legacy no-draft route to the planner instead of persisting on share', async () => {
    const wrapper = mount(AdventureView, { attachTo: document.body });
    await flushPromises();
    const vm = wrapper.vm as any;
    vm.activeRoute = routedDraft().route;
    await nextTick();

    expect(wrapper.find('[aria-label="Поделиться маршрутом"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Сохранить маршрут');

    // Defend the handler itself as well as the hidden UI entry point.
    await vm.shareCurrentRoute();
    await vm.shareToTelegram();
    vm.summaryRoute = routedDraft().route;
    await vm.shareRoute();
    await vm.shareSummaryToTelegram();
    expect(createRoute).not.toHaveBeenCalled();
    expect(vm.plannerOpen).toBe(true);
  });

  it('shares the published route id instead of creating a copy', async () => {
    __itinerary.draft.value = routedDraft('pub-route-1');
    const wrapper = mount(AdventureView, { attachTo: document.body });
    await flushPromises();

    const share = wrapper.get('[aria-label="Поделиться маршрутом"]');
    await share.trigger('click');
    await flushPromises();

    expect(createRoute).not.toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith('/route/pub-route-1');
  });

  it('uses an explicit save, not share persistence, for an unpublished auto summary', async () => {
    __itinerary.draft.value = routedDraft();
    const wrapper = mount(AdventureView, { attachTo: document.body });
    await flushPromises();
    const vm = wrapper.vm as any;
    vm.summaryRoute = routedDraft().route;
    await nextTick();

    // Summary sharing is guarded too: without a published id it only points
    // to the explicit flow. The summary's visible CTA calls publishDraft.
    expect(vm.canShareSummary).toBe(false);
    await vm.shareRoute();
    await vm.shareSummaryToTelegram();
    expect(createRoute).not.toHaveBeenCalled();

    await vm.publishDraft();
    expect(__itinerary.publish).toHaveBeenCalledOnce();
  });

  it('clears only a stale geolocation error once the user picks a manual start', async () => {
    __locate.mockRejectedValueOnce(new Error('Доступ к геолокации запрещён'));
    const wrapper = mount(AdventureView, { attachTo: document.body });
    await flushPromises();

    const vm = wrapper.vm as any;
    await vm.useMyLocation();
    await nextTick();
    expect(wrapper.text()).toContain('Доступ к геолокации запрещён');

    // The user then selects a start point manually on the map — the
    // misleading geolocation banner must disappear.
    vm.setStart({ lat: 58.6, lon: 49.68 }, 'Своя точка');
    await nextTick();
    expect(wrapper.text()).not.toContain('Доступ к геолокации запрещён');

    vm.error = 'Маршрутизатор недоступен';
    vm.setStart({ lat: 58.61, lon: 49.69 }, 'Другая точка');
    await nextTick();
    expect(wrapper.text()).toContain('Маршрутизатор недоступен');
  });
});
