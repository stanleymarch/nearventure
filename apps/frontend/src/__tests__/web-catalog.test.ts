// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import WebCatalogView from '@/views/WebCatalogView.vue';
import { getPois, getRegions } from '@/api/pois';

const routerPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/api/pois', () => ({
  getPois: vi.fn(),
  getRegions: vi.fn(),
  poiName: (poi: any) => poi.name || 'Без названия',
  poiMediaUrlById: () => '',
  poiSourceLabel: () => 'OpenStreetMap',
  isVkUrl: () => false,
  sourceEntries: () => [],
  HERITAGE_LABELS: {},
}));

const poi: any = {
  id: 'poi-1',
  name: 'Успенский собор',
  category: 'religion',
  lat: 58.6,
  lon: 49.68,
  year: 1689,
  region: 'Кировская область',
  source: 'osm',
  is_protected: false,
  descRu: 'Древнейший каменный храм Вятки',
  tags: {},
  imageUrl: null,
  featured: false,
  popularityScore: 0,
};

describe('WebCatalogView accessible catalog controls', () => {
  beforeEach(() => {
    vi.mocked(routerPush).mockReset();
    vi.mocked(getPois).mockResolvedValue({ items: [poi], total: 1 });
    vi.mocked(getRegions).mockResolvedValue(['Кировская область']);
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('associates labels and identifiers with catalog form controls', async () => {
    const wrapper = mount(WebCatalogView, { attachTo: document.body });
    await flushPromises();

    const controls = [
      { id: 'catalog-search', tag: 'input', label: 'Поиск' },
      { id: 'catalog-region', tag: 'select', label: 'Регион' },
      { id: 'catalog-sort', tag: 'select', label: 'Сортировка' },
    ];
    const ids = new Set<string>();
    for (const { id, tag, label } of controls) {
      const control = wrapper.get(`${tag}#${id}`);
      const nativeControl = control.element as HTMLInputElement | HTMLSelectElement;
      expect(control.attributes('name')).toBe(id);
      expect(wrapper.get(`label[for="${id}"]`).text()).toContain(label);
      expect(nativeControl.labels).toHaveLength(1);
      expect(nativeControl.labels?.[0]?.textContent).toContain(label);
      ids.add(control.attributes('id')!);
    }
    expect(ids.size).toBe(controls.length);
    expect(wrapper.findAll('label:not([for])')).toHaveLength(0);
    expect(wrapper.get('label[for="catalog-has-description"]').text()).toContain('С описанием');
    expect(wrapper.get('button#catalog-has-description').attributes('id')).toBe('catalog-has-description');
    expect(wrapper.get('label[for="catalog-has-photo"]').text()).toContain('С фото');
    expect(wrapper.get('button#catalog-has-photo').attributes('id')).toBe('catalog-has-photo');

    // Century sliders are revealed by their labelled toggle (exact text,
    // not the «Фильтры» drawer trigger).
    const centuryToggle = wrapper.findAll('button').find((b) => b.text().trim() === 'Фильтр')!;
    await centuryToggle.trigger('click');
    expect(wrapper.get('label[for="catalog-century-min"]').text()).toBe('Минимальный век');
    expect(wrapper.get('input#catalog-century-min').attributes('name')).toBe('catalog-century-min');
    expect(wrapper.get('label[for="catalog-century-max"]').text()).toBe('Максимальный век');
    expect(wrapper.get('input#catalog-century-max').attributes('name')).toBe('catalog-century-max');
  });

  it('exposes pressed state on category and source filter toggles', async () => {
    const wrapper = mount(WebCatalogView, { attachTo: document.body });
    await flushPromises();

    const categoryButtons = wrapper.findAll('[data-testid="category-btn"]');
    expect(categoryButtons.length).toBeGreaterThan(0);
    for (const button of categoryButtons) expect(button.attributes('aria-pressed')).toBe('false');

    await categoryButtons[0].trigger('click');
    expect(wrapper.findAll('[data-testid="category-btn"]')[0].attributes('aria-pressed')).toBe('true');

    const osmChip = wrapper.findAll('button').find((b) => b.text().includes('OpenStreetMap'))!;
    const wikivoyageChip = wrapper.findAll('button').find((b) => b.text().includes('Wikivoyage'))!;
    expect(osmChip.attributes('aria-pressed')).toBe('false');
    await osmChip.trigger('click');
    expect(osmChip.attributes('aria-pressed')).toBe('true');
    expect(wikivoyageChip.attributes('aria-pressed')).toBe('false');
  });

  it('closes the mobile filter drawer on Escape and restores focus to its trigger', async () => {
    const wrapper = mount(WebCatalogView, { attachTo: document.body });
    await flushPromises();

    const trigger = wrapper.get('button[aria-controls="catalog-filters"]');
    expect(trigger.attributes('aria-expanded')).toBe('false');

    await trigger.trigger('click');
    expect(trigger.attributes('aria-expanded')).toBe('true');

    // Focus is inside the open drawer; pressing Escape must close it and
    // return focus to the trigger button (native dialog semantics).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();

    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger.element);
  });
});
