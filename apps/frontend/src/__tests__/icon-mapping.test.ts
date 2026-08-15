// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Icon from '@/components/Icon.vue';

/**
 * The Icon component maps Material-Symbol names to Lucide glyphs and falls
 * back to MapPin for unknown names. The landing page («Укажите время»,
 * «Wikivoyage + Wikidata») and the route detail page rely on names that used
 * to fall back to a generic map pin — they must resolve to their intended
 * glyphs without triggering the dev-mode fallback warning.
 */
describe('Icon intentional mapping', () => {
  it('resolves landing/detail icon names to their intended Lucide glyphs, not the MapPin fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallback = mount(Icon, { props: { name: 'unknown_icon_name_xyz' } }).html();

    const clock = mount(Icon, { props: { name: 'clock' } });
    const menuBook = mount(Icon, { props: { name: 'menu_book' } });
    const compass = mount(Icon, { props: { name: 'compass' } });
    const mapPin = mount(Icon, { props: { name: 'map-pin' } });

    expect(clock.html()).not.toBe(fallback);
    expect(menuBook.html()).not.toBe(fallback);
    expect(compass.html()).not.toBe(fallback);

    // Explicit map-pin usage is intentional: it resolves to MapPin but must
    // not be treated as an unknown name (no fallback warning).
    expect(mapPin.html()).toBe(fallback);
    const warned = warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((m) => m.includes('clock') || m.includes('menu_book') || m.includes('compass') || m.includes('map-pin'))).toBe(false);
    warn.mockRestore();
  });
});
