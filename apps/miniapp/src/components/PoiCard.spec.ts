import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PoiCard from './PoiCard.vue';
import type { PoiRow } from '@/composables/usePois';

function makePoi(overrides: Partial<PoiRow> = {}): PoiRow {
  return {
    id: 'abcdef1234567890',
    name: 'Church of the Resurrection',
    category: 'religion',
    subcategory: null,
    description: 'Beautiful old church in the heart of the city.',
    imageUrl: 'https://example.com/photo.jpg',
    imageAttribution: null,
    lat: 58.6,
    lon: 49.6,
    heritageSignificance: 'federal',
    featured: false,
    popularityScore: 42,
    region: 'Kirov Oblast',
    district: 'Kirov',
    city: 'Kirov',
    year: 1650,
    year_end: null,
    yearSource: 'osm',
    descSource: null,
    ...overrides,
  };
}

describe('PoiCard', () => {
  it('renders the POI name, badge and meta', () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi(), inCart: false, distance: null },
    });
    expect(wrapper.text()).toContain('Church of the Resurrection');
    expect(wrapper.text()).toContain('Религия');
    // year text from formatYearCentury
    expect(wrapper.text()).toContain('XVII в.');
    // location
    expect(wrapper.text()).toContain('Kirov');
  });

  it('emits "open" when the card body is clicked', async () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi(), inCart: false, distance: null },
    });
    await wrapper.find('[data-testid="poi-card__open"]').trigger('click');
    expect(wrapper.emitted('open')).toBeTruthy();
    expect(wrapper.emitted('open')![0]).toEqual([expect.objectContaining({ id: 'abcdef1234567890' })]);
  });

  it('emits "toggle" (not "open") when the add/remove button is clicked', async () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi(), inCart: false, distance: null },
    });
    await wrapper.find('[data-testid="poi-card__add"]').trigger('click');
    const emitted = wrapper.emitted();
    expect(emitted.toggle).toBeTruthy();
    expect(emitted.open).toBeUndefined();
  });

  it('shows a Check icon (and aria-pressed=true) when inCart', () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi(), inCart: true, distance: null },
    });
    const btn = wrapper.find('[data-testid="poi-card__add"]');
    expect(btn.attributes('aria-pressed')).toBe('true');
    expect(btn.attributes('aria-label')).toBe('Убрать из маршрута');
  });

  it('shows a Plus icon (and aria-pressed=false) when not in cart', () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi(), inCart: false, distance: null },
    });
    const btn = wrapper.find('[data-testid="poi-card__add"]');
    expect(btn.attributes('aria-pressed')).toBe('false');
    expect(btn.attributes('aria-label')).toBe('Добавить в маршрут');
  });

  it('displays the distance when provided', () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi(), inCart: false, distance: '1.2 км' },
    });
    expect(wrapper.text()).toContain('1.2 км');
  });

  it('falls back to "Объект <id8>" when name is missing', () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi({ name: null as any }), inCart: false, distance: null },
    });
    expect(wrapper.text()).toContain('Объект abcdef12');
  });

  it('uses a category-tinted placeholder when no imageUrl', () => {
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi({ imageUrl: null as any }), inCart: false, distance: null },
    });
    // No <img> in the markup
    expect(wrapper.find('img').exists()).toBe(false);
    // The placeholder has the category style applied
    const placeholder = wrapper.find('.flex.items-center.justify-center.size-full');
    expect(placeholder.exists()).toBe(true);
  });

  it('emits "toggle" only once per click (no double-fire from bubbling)', async () => {
    // The button has @click.stop to prevent the parent card's @click.
    const wrapper = mount(PoiCard, {
      props: { poi: makePoi(), inCart: false, distance: null },
    });
    const btn = wrapper.find('[data-testid="poi-card__add"]');
    await btn.trigger('click');
    expect(wrapper.emitted('toggle')?.length).toBe(1);
    expect(wrapper.emitted('open')).toBeUndefined();
  });
});
