import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes safely — shadcn-vue convention.
 * Combines clsx (conditional) with tailwind-merge (de-dupes conflicting utils).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a distance in metres to a human-readable Russian string.
 * - < 1 km → «63 м» (integer)
 * - < 10 km → «5.2 км» (one decimal)
 * - ≥ 10 km → «23 км» (integer, round)
 */
export function formatDistance(meters: number): string {
  if (meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} м`;
  const km = meters / 1000;
  return km >= 10 ? `${Math.round(km)} км` : `${km.toFixed(1)} км`;
}

/**
 * Format a duration in seconds → «2 ч 30 мин» or «45 мин».
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}
