import { describe, it, expect } from 'vitest';
import { centuryOf, romanCentury, formatYearCentury, formatLocation } from '@/lib/poi-meta';

describe('poi-meta', () => {
  describe('centuryOf', () => {
    it.each([
      [1801, 19],
      [1900, 19],
      [1901, 20],
      [2000, 20],
      [2001, 21],
      [1850, 19],
      [1, 1],
      [100, 1],
      [101, 2],
    ])('year %i → century %i', (year, century) => {
      expect(centuryOf(year)).toBe(century);
    });
  });

  describe('romanCentury', () => {
    it.each([
      [1, 'I'],
      [18, 'XVIII'],
      [19, 'XIX'],
      [20, 'XX'],
      [21, 'XXI'],
    ])('century %i → %s', (century, roman) => {
      expect(romanCentury(century)).toBe(roman);
    });
  });

  describe('formatYearCentury', () => {
    it('returns null for empty input', () => {
      expect(formatYearCentury(null)).toBeNull();
      expect(formatYearCentury(undefined)).toBeNull();
      expect(formatYearCentury(0)).toBeNull();
    });

    it('shows century for historical single years (< 1950)', () => {
      expect(formatYearCentury(1850)).toBe('XIX в.');
      expect(formatYearCentury(1801)).toBe('XIX в.');
      expect(formatYearCentury(1900)).toBe('XIX в.');
      expect(formatYearCentury(1949)).toBe('XX в.');
    });

    it('shows year for modern single years (>= 1950)', () => {
      expect(formatYearCentury(1973)).toBe('1973 г.');
      expect(formatYearCentury(1950)).toBe('1950 г.');
      expect(formatYearCentury(2020)).toBe('2020 г.');
    });

    it('shows centuries for wide ranges (>= 80 years)', () => {
      expect(formatYearCentury(1801, 1900)).toBe('XIX в.'); // same century
      expect(formatYearCentury(1801, 1950)).toBe('XIX–XX вв.');
      expect(formatYearCentury(1700, 1850)).toBe('XVII–XIX вв.');
    });

    it('shows years for narrow ranges (< 80 years)', () => {
      expect(formatYearCentury(1970, 1975)).toBe('1970–1975 гг.');
      expect(formatYearCentury(1850, 1900)).toBe('1850–1900 гг.');
    });

    it('ignores yearEnd when not greater than year', () => {
      expect(formatYearCentury(1973, 1973)).toBe('1973 г.');
      expect(formatYearCentury(1973, 1970)).toBe('1973 г.');
    });
  });

  describe('formatLocation', () => {
    it('returns null when all empty', () => {
      expect(formatLocation(null, null, null)).toBeNull();
      expect(formatLocation('', '', '')).toBeNull();
    });

    it('joins city, district, region', () => {
      expect(formatLocation('Кировская область', 'Слободской район', 'Слободской'))
        .toBe('Слободской, Слободской район, Кировская область');
    });

    it('drops duplicate parts (city === district)', () => {
      expect(formatLocation('Кировская область', 'Слободской район', 'Слободской район'))
        .toBe('Слободской район, Кировская область');
    });

    it('drops region === city duplicates', () => {
      expect(formatLocation('Нижний Новгород', 'Нижний Новгород', 'Нижний Новгород'))
        .toBe('Нижний Новгород');
    });

    it('handles partial data', () => {
      expect(formatLocation('Кировская область', null, null)).toBe('Кировская область');
      expect(formatLocation(null, 'Слободской район', null)).toBe('Слободской район');
    });
  });
});
