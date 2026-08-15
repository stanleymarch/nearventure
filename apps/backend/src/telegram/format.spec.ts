import { describe, it, expect } from 'vitest';
import { pluralPoints, fmtDistance, fmtDuration, routeSummaryHtml } from './format';

describe('format helpers', () => {
  describe('pluralPoints', () => {
    it('uses "точка" for 1, 21, 31, ...', () => {
      expect(pluralPoints(1)).toBe('точка');
      expect(pluralPoints(21)).toBe('точка');
      expect(pluralPoints(101)).toBe('точка');
    });

    it('uses "точки" for 2-4, 22-24, ...', () => {
      expect(pluralPoints(2)).toBe('точки');
      expect(pluralPoints(3)).toBe('точки');
      expect(pluralPoints(4)).toBe('точки');
      expect(pluralPoints(22)).toBe('точки');
    });

    it('uses "точек" for 0, 5-20, 25-30, ...', () => {
      expect(pluralPoints(0)).toBe('точек');
      expect(pluralPoints(5)).toBe('точек');
      expect(pluralPoints(11)).toBe('точек'); // 11 is the special "many" case
      expect(pluralPoints(15)).toBe('точек');
      expect(pluralPoints(20)).toBe('точек');
      expect(pluralPoints(25)).toBe('точек');
      expect(pluralPoints(100)).toBe('точек');
    });
  });

  describe('fmtDistance', () => {
    it('renders meters under a kilometre', () => {
      expect(fmtDistance(0)).toBe('0 м');
      expect(fmtDistance(450)).toBe('450 м');
      expect(fmtDistance(999)).toBe('999 м');
    });

    it('renders kilometres with one decimal under 10 km', () => {
      expect(fmtDistance(1_200)).toBe('1,2 км');
      expect(fmtDistance(9_990)).toBe('10,0 км');
    });

    it('drops the decimal at 10 km and beyond', () => {
      expect(fmtDistance(12_345)).toBe('12 км');
    });
  });

  describe('fmtDuration', () => {
    it('renders minutes under an hour', () => {
      expect(fmtDuration(0)).toBe('0 мин');
      expect(fmtDuration(45 * 60)).toBe('45 мин');
    });

    it('renders hours and minutes', () => {
      expect(fmtDuration(60 * 60)).toBe('1 ч 0 мин');
      expect(fmtDuration(72 * 60)).toBe('1 ч 12 мин');
      expect(fmtDuration(2 * 60 * 60 + 5 * 60)).toBe('2 ч 5 мин');
    });
  });

  describe('routeSummaryHtml', () => {
    const baseRoute = {
      distance: 4_200,
      duration: 75 * 60,
      ascend: 30,
      descend: 25,
      profile: 'foot' as const,
      pois: [
        { id: '1', name: 'Успенский собор', category: 'religion' },
        { id: '2', name: 'Музей', category: 'museum' },
      ],
    };

    it('renders header + numbered list of POIs', () => {
      const html = routeSummaryHtml(baseRoute);
      expect(html).toContain('Маршрут готов');
      expect(html).toContain('4,2 км');
      expect(html).toContain('1 ч 15 мин');
      expect(html).toContain('1. ⛪ Успенский собор');
      expect(html).toContain('2. 🖼 Музей');
      expect(html).toContain('По пути (2)');
    });

    it('falls back to a clear message when no POIs match', () => {
      const html = routeSummaryHtml({ ...baseRoute, pois: [] });
      expect(html).toContain('Не нашлось мест по пути');
    });

    it('escapes HTML-special characters in POI names', () => {
      const html = routeSummaryHtml({
        ...baseRoute,
        pois: [{ id: '1', name: 'A & B <C>', category: 'heritage' }],
      });
      // &, <, > all escaped — protects Telegram's HTML parser.
      expect(html).toContain('A &amp; B &lt;C&gt;');
      expect(html).not.toContain('A & B <C>');
    });
  });
});
