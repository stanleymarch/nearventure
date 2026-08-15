/* POI category identity — canonical source for all surfaces.
 * Merged and deduplicated from apps/frontend/src/lib/poi-categories.ts
 * and apps/miniapp/src/lib/poi-categories.ts.
 */

export interface POICategory {
  /** Stable key matching backend PoiCategory type. */
  key: PoiCategory;
  /** Russian label. */
  label: string;
  /** Category hex color (light mode). */
  color: string;
  /** Dark mode hex override (optional). */
  colorDark?: string;
  /** Lucide-vue-next icon name. */
  icon: string;
  /** Secondary/container color for chips. */
  container?: string;
  /** Short description for legend. */
  description: string;
}

export type PoiCategory = 'heritage' | 'monument' | 'sights' | 'religion' | 'nature' | 'museum';

export const POI_CATEGORIES: readonly POICategory[] = [
  {
    key: 'heritage',
    label: 'Наследие',
    color: '#b44438',
    colorDark: '#e8806e',
    icon: 'landmark',
    container: '#fce4dc',
    description: 'Усадьбы, руины, археология, крепости',
  },
  {
    key: 'monument',
    label: 'Монументы',
    color: '#8b5e34',
    colorDark: '#d4a574',
    icon: 'medal',
    container: '#f5e6d0',
    description: 'Мемориалы, памятники, обелиски',
  },
  {
    key: 'sights',
    label: 'Достопримечательности',
    color: '#6d8c3a',
    colorDark: '#a8c66a',
    icon: 'mountain',
    container: '#e8f0d8',
    description: 'Смотровые, арт-объекты, скульптуры, видовки',
  },
  {
    key: 'religion',
    label: 'Религия и некрополи',
    color: '#9068a0',
    colorDark: '#c9a6d9',
    icon: 'church',
    container: '#f0e6f4',
    description: 'Храмы, монастыри, часовни, кладбища',
  },
  {
    key: 'nature',
    label: 'Природа',
    color: '#4c8b6c',
    colorDark: '#7dbc9a',
    icon: 'tree-pine',
    container: '#d8efe4',
    description: 'Озёра, парки, родники, заповедники',
  },
  {
    key: 'museum',
    label: 'Музеи',
    color: '#6080b0',
    colorDark: '#93b3e0',
    icon: 'building2',
    container: '#dce6f4',
    description: 'Музеи, галереи, экспозиции',
  },
] as const;

export const POI_CATEGORY_MAP: Record<PoiCategory, POICategory> = Object.fromEntries(
  POI_CATEGORIES.map((c) => [c.key, c]),
) as Record<PoiCategory, POICategory>;

/** Get display properties for a category key — safe with unknown keys. */
export function categoryStyle(cat: string): { color: string; icon: string; label: string; container: string } {
  const c = POI_CATEGORY_MAP[cat as PoiCategory];
  if (c) return { color: c.color, icon: c.icon, label: c.label, container: c.container ?? '' };
  // Fallback for unknown categories
  return { color: '#888', icon: 'circle', label: cat, container: '#eee' };
}

/** Map a category key to its Lucide icon name. */
export function catIcon(cat: string): string {
  return POI_CATEGORY_MAP[cat as PoiCategory]?.icon ?? 'circle';
}
