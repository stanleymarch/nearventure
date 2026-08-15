/** POI construction-date and administrative-location formatting shared by web
 * and Mini App display surfaces. */

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

/** 1-based century number for a year (1801 → 19, 1900 → 19, 1901 → 20). */
export function centuryOf(year: number): number {
  return Math.max(1, Math.floor((year - 1) / 100) + 1);
}

/** Roman numeral for a century, e.g. 19 → "XIX". */
export function romanCentury(century: number): string {
  return ROMAN[century] ?? String(century);
}

/** Human-readable construction / inception date, or null when absent. */
export function formatYearCentury(
  year: number | null | undefined,
  yearEnd?: number | null | undefined,
): string | null {
  if (!year) return null;
  const end = yearEnd && yearEnd > year ? yearEnd : null;
  if (end) {
    if (end - year >= 80) {
      const first = centuryOf(year);
      const last = centuryOf(end);
      return first === last ? `${romanCentury(first)} в.` : `${romanCentury(first)}–${romanCentury(last)} вв.`;
    }
    return `${year}–${end} гг.`;
  }
  return year < 1950 ? `${romanCentury(centuryOf(year))} в.` : `${year} г.`;
}

/** One-line administrative location, dropping duplicate city/district names. */
export function formatLocation(
  region: string | null | undefined,
  district: string | null | undefined,
  city: string | null | undefined,
): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of [city, district, region]) {
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }
  return parts.length ? parts.join(', ') : null;
}
