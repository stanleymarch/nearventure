/**
 * Visual identity per POI category for the mini-app.
 *
 * Mirrors the web frontend's `lib/poi-categories.ts` (same Material 3 palette +
 * Material Symbols). Kept local rather than `@shared` because the frontend
 * version imports its `PoiCategory` via the `@/api/pois` alias, which resolves
 * differently in the mini-app build (`@` → miniapp/src). The taxonomy itself is
 * small and stable — safe to duplicate.
 */

export type PoiCategory =
  | 'heritage'
  | 'monument'
  | 'sights'
  | 'religion'
  | 'nature'
  | 'museum';

export const ALL_CATEGORIES: PoiCategory[] = [
  'heritage',
  'monument',
  'sights',
  'religion',
  'nature',
  'museum',
];

export interface CategoryStyle {
  key: PoiCategory;
  label: string; // short (chips)
  labelLong: string; // descriptive (cards)
  icon: string; // Material Symbol name
  color: string; // CSS color (marker border / glow)
  container: string; // softer filled state
}

export const CATEGORY_STYLES: Record<PoiCategory, CategoryStyle> = {
  heritage: {
    key: 'heritage',
    label: 'Наследие',
    labelLong: 'Объекты культурного наследия',
    icon: 'account_balance',
    color: '#8A8175',
    container: '#E9E4DC',
  },
  monument: {
    key: 'monument',
    label: 'Монументы',
    labelLong: 'Мемориалы и памятники',
    icon: 'military_tech',
    color: '#B26A2E',
    container: '#F0DAC4',
  },
  sights: {
    key: 'sights',
    label: 'Достопримечательности',
    labelLong: 'Интересные места',
    icon: 'landscape',
    color: 'rgb(var(--nv-primary))',
    container: 'rgb(var(--nv-primary-container))',
  },
  religion: {
    key: 'religion',
    label: 'Религия',
    labelLong: 'Храмы, монастыри, некрополи',
    icon: 'church',
    color: '#A23B2E',
    container: '#E8C9C2',
  },
  nature: {
    key: 'nature',
    label: 'Природа',
    labelLong: 'Озёра, леса, родники, ООПТ',
    icon: 'forest',
    color: 'rgb(var(--nv-tertiary))',
    container: 'rgb(var(--nv-tertiary-container))',
  },
  museum: {
    key: 'museum',
    label: 'Музеи',
    labelLong: 'Музеи, галереи, выставки',
    icon: 'museum',
    color: '#8E5B9B',
    container: '#E8DAE8',
  },
};

/** Categories active by default (museum is opt-in). */
export const DEFAULT_ACTIVE_CATEGORIES: PoiCategory[] = [
  'heritage',
  'monument',
  'sights',
  'religion',
  'nature',
];

export function categoryStyle(cat: string): CategoryStyle {
  return CATEGORY_STYLES[cat as PoiCategory] ?? CATEGORY_STYLES.sights;
}

export const KIROV_CENTER = { lat: 58.6035, lon: 49.6679 };
