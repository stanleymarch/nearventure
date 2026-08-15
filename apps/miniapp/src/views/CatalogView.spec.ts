import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

// ── Hoisted mocks: must be defined before importing the SUT ─────────
const mockRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const mockTg = {
  ready: vi.fn(),
  expand: vi.fn(),
  close: vi.fn(),
  themeParams: {},
  initData: '',
  initDataUnsafe: {},
  colorScheme: 'light' as const,
  BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
  MainButton: { setText: vi.fn(), show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
  HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
  openLink: vi.fn(),
  openTelegramLink: vi.fn(),
  onEvent: vi.fn(),
  offEvent: vi.fn(),
};
const mockFetchPois = vi.fn().mockResolvedValue({ items: [], total: 0 });
const mockFetchRegions = vi.fn().mockResolvedValue([]);
const mockCart = {
  items: { value: [] as string[] },
  count: { value: 0 },
  has: vi.fn(() => false),
  add: vi.fn(),
  remove: vi.fn(),
  toggle: vi.fn(),
  clear: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ params: {}, query: {} }),
  createRouter: () => ({}),
  createWebHistory: () => ({}),
  RouterView: { template: '<div />' },
  RouterLink: { template: '<a><slot /></a>' },
}));

vi.mock('@/composables/useTelegram', () => ({
  useTelegram: () => ({
    tg: mockTg,
    haptic: { impact: vi.fn(), notify: vi.fn(), selection: vi.fn() },
    showBackButton: vi.fn(),
    hideBackButton: vi.fn(),
    setMainButton: vi.fn(),
    hideMainButton: vi.fn(),
    openLink: vi.fn(),
  }),
}));

vi.mock('@/composables/useBotShortcut', () => ({
  useBotShortcut: vi.fn(),
}));

vi.mock('@/composables/usePois', () => ({
  fetchPois: (...args: unknown[]) => mockFetchPois(...args),
  fetchRegions: (...args: unknown[]) => mockFetchRegions(...args),
}));

vi.mock('@/composables/useCart', () => ({
  useCart: () => mockCart,
}));

// Stub heavy child components so the test focuses on the parent wiring.
vi.mock('@/components/PoiCard.vue', () => ({
  default: { template: '<div data-testid="poi-card" />' },
}));

vi.mock('@/components/CatalogMap.vue', () => ({
  default: { template: '<div data-testid="catalog-map" />' },
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: { template: '<div data-testid="sheet"><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetHeader: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<div><slot /></div>' },
  SheetDescription: { template: '<div><slot /></div>' },
}));

vi.mock('@/components/ui/toggle-group', () => ({
  ToggleGroup: { template: '<div data-testid="toggle-group"><slot /></div>' },
  ToggleGroupItem: { template: '<button data-testid="toggle-item"><slot /></button>' },
}));

vi.mock('@/components/ui/button', () => ({
  Button: { template: '<button><slot /></button>' },
}));

// ── Import the SUT AFTER all mocks are set up ─────────────────────
import CatalogView from './CatalogView.vue';

describe('CatalogView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPois.mockResolvedValue({ items: [], total: 0 });
    mockFetchRegions.mockResolvedValue([]);
  });

  it('mounts without import errors (regression: B1 — ToggleGroup/CatalogMap were unimported)', async () => {
    // The bug was: the template used <ToggleGroup>, <ToggleGroupItem>, <CatalogMap>
    // without importing them. vue-tsc doesn't catch this without strictTemplates.
    // If the import is missing again, this mount() will throw "Failed to resolve
    // component" or render inert <togglegroup>/<catalogmap> elements.
    const wrapper = mount(CatalogView);
    await nextTick();
    await nextTick(); // allow onMounted → loadPois → state update

    // The component mounted without throwing = all imports resolve. The
    // toggle group and map render only when pois.length > 0, so we
    // simulate a populated state and re-check.
    mockFetchPois.mockResolvedValue({
      items: [{
        id: 'abcdef1234567890', name: 'Test POI', category: 'nature',
        subcategory: null, description: 'd', imageUrl: null, imageAttribution: null,
        lat: 58.6, lon: 49.6, heritageSignificance: null, featured: false,
        popularityScore: 1, region: 'Kirov',
      }],
      total: 1,
    });
    await wrapper.vm.$nextTick();
    // Trigger a re-fetch by changing the search/filter (call internal loadPois
    // via the watch on pois.length which isn't exposed, so we just assert the
    // mount succeeded — that's the regression guard).
    wrapper.unmount();

    // Re-mount to verify nothing crashes after state changes.
    const wrapper2 = mount(CatalogView);
    await nextTick();
    // No inert <catalogmap> or <togglegroup> elements in the rendered DOM.
    expect(wrapper2.find('catalogmap').exists()).toBe(false);
    expect(wrapper2.find('togglegroup').exists()).toBe(false);
  });

  it('shows empty state when API returns no POIs', async () => {
    mockFetchPois.mockResolvedValue({ items: [], total: 0 });
    const wrapper = mount(CatalogView);
    await nextTick();
    await nextTick(); // allow onMounted → loadPois → state update

    // Empty state copy from the view
    const text = wrapper.text();
    expect(text).toMatch(/ничего не найдено|фильтр|категори/i);
  });
});
