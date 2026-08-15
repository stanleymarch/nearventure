// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const back = vi.fn();
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'missing-route' } }),
  useRouter: () => ({ back }),
}));
vi.mock('maplibre-gl', () => ({ default: { Map: vi.fn(), Marker: vi.fn(), NavigationControl: vi.fn(), LngLatBounds: vi.fn() } }));
vi.mock('@/api/pois', () => ({ getPois: vi.fn(), poiName: (poi: any) => poi.name }));
vi.mock('@/components/Icon.vue', () => ({ default: { props: ['name'], template: '<span aria-hidden="true" />' } }));
vi.mock('@/components/ShareButton.vue', () => ({ default: { template: '<button>Поделиться</button>' } }));

import RouteDetailView from '@/views/RouteDetailView.vue';

describe('RouteDetailView failed load', () => {
  beforeEach(() => {
    back.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a truthful not-found state and never unlocks fake route actions', async () => {
    const wrapper = mount(RouteDetailView);
    await flushPromises();

    expect(wrapper.text()).toContain('Маршрут не найден или ссылка истекла.');
    expect(wrapper.text()).not.toContain('Путешествие по Вятскому краю');
    expect(wrapper.text()).not.toContain('Слободской бор');
    expect(wrapper.findAll('button').some((button) => button.text() === 'GPX')).toBe(false);
    expect(wrapper.findAll('button').some((button) => button.text() === 'Поделиться')).toBe(false);
  });

  it('keeps route actions locked on a network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const wrapper = mount(RouteDetailView);
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось загрузить маршрут. Проверьте соединение и попробуйте позже.');
    expect(wrapper.text()).not.toContain('Путешествие по Вятскому краю');
    expect(wrapper.findAll('button').some((button) => ['GPX', 'Поделиться'].includes(button.text()))).toBe(false);
  });
});
