import { describe, it, expect } from 'vitest';
import { richRouteSummary, richResetConfirm, builders } from './rich-message';

/**
 * Tests for the Rich Message builders. We assert the structural HTML
 * is well-formed (no unescaped < > & from caller inputs), uses Telegram's
 * rich tags (<h2>, <h3>, <p>, <hr/>), and respects the block count limit
 * (500 — our builders never get close, but a regression test makes
 * the contract explicit).
 */
describe('rich-message builders', () => {  describe('richRouteSummary', () => {
    it('renders distance, duration, ascent/descent and a POI list', () => {
      const msg = richRouteSummary({
        distanceKm: 12.4,
        durationMin: 72,
        ascendM: 240.7,
        descendM: 235.2,
        pois: [
          { name: 'Church', category: 'religion' },
          { name: 'Museum', category: 'museum' },
        ],
      });
      expect(msg.html).toContain('<h2>🗺 Маршрут готов</h2>');
      expect(msg.html).toContain('12.4 км');
      expect(msg.html).toContain('1 ч 12 мин');
      expect(msg.html).toContain('241 м'); // rounded
      expect(msg.html).toContain('235 м');
      expect(msg.html).toContain('<h3>По пути (2)</h3>');
      expect(msg.html).toContain('⛪'); // religion emoji
      expect(msg.html).toContain('🖼'); // museum emoji
      expect(msg.html).toContain('<b>Church</b>');
    });

    it('shows the empty-state note when no POIs are selected', () => {
      const msg = richRouteSummary({
        distanceKm: 5,
        durationMin: 30,
        ascendM: 50,
        descendM: 50,
        pois: [],
      });
      expect(msg.html).toContain('Не нашлось мест по пути');
      expect(msg.html).not.toContain('<h3>По пути');
    });

    it('stays under 500 blocks (Telegram limit)', () => {
      const msg = richRouteSummary({
        distanceKm: 1,
        durationMin: 1,
        ascendM: 0,
        descendM: 0,
        pois: Array.from({ length: 30 }, (_, i) => ({
          name: `POI ${i}`,
          category: 'heritage',
        })),
      });
      // <h2> + <hr/> + <p> + <hr/> + <h3> + 30×<p> = 35 blocks.
      const blockCount = (msg.html!.match(/<(h2|h3|p|hr)/g) || []).length;
      expect(blockCount).toBeLessThan(500);
      expect(blockCount).toBeGreaterThan(30);
    });
  });

  describe('richResetConfirm', () => {
    it('renders a concise warning', () => {
      const msg = richResetConfirm();
      expect(msg.html).toContain('Начать заново?');
    });
  });

  describe('low-level builders (escape invariants)', () => {
    it('h2 escapes caller input', () => {
      const out = builders.h2('<x>');
      expect(out).toContain('&lt;x&gt;');
    });
    it('h3 escapes caller input', () => {
      const out = builders.h3('A & B');
      expect(out).toContain('A &amp; B');
    });
    it('divider is constant', () => {
      expect(builders.divider()).toBe('<hr/>');
    });
  });
});
