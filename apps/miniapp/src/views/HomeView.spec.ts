import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const mockRouter = { push: vi.fn() };
const mockHaptic = { impact: vi.fn() };
const mockHideBackButton = vi.fn();
const mockGetPoiCount = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/composables/useTelegram', () => ({
  useTelegram: () => ({
    user: null,
    haptic: mockHaptic,
    hideBackButton: mockHideBackButton,
  }),
}));

vi.mock('@/composables/useBotShortcut', () => ({
  useBotShortcut: vi.fn(),
}));

vi.mock('@/api', () => ({
  getPoiCount: () => mockGetPoiCount(),
}));

import HomeView from './HomeView.vue';

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPoiCount.mockResolvedValue({ total: 1 });
  });

  it('keeps the route builder as the actionable home entry point', async () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: { RouterLink: true },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Построить маршрут');
    expect(wrapper.text()).not.toContain('Для лучшего опыта откройте бота');
    expect(wrapper.text()).not.toContain('@nearventure_bot');
  });

  it('provides one semantic, verb-first catalog CTA', async () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a data-testid="router-link" :data-route="to.name"><slot /></a>',
          },
        },
      },
    });
    await flushPromises();

    const catalogCtas = wrapper.findAll('[data-testid="router-link"]');
    expect(catalogCtas).toHaveLength(1);
    expect(catalogCtas[0].attributes('data-route')).toBe('catalog');
    expect(catalogCtas[0].text()).toContain('Открыть каталог');
    expect(wrapper.text()).not.toContain('Листать каталог');

    await catalogCtas[0].trigger('click');
    expect(mockHaptic.impact).toHaveBeenCalledWith('light');
    expect(mockRouter.push).not.toHaveBeenCalledWith({ name: 'catalog' });
  });
});
