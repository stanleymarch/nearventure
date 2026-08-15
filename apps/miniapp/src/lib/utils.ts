import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes safely — shadcn-vue convention.
 * Combines clsx (conditional) with tailwind-merge (de-dupes conflicting utils).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
