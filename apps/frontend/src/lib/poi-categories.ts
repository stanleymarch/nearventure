import type { PoiCategory } from '@/api/pois';

export type { PoiCategory };

/**
 * Visual identity per POI category — SINGLE SOURCE OF TRUTH.
 *
 * Drives marker icon, layer color, filter chips and canvas-rendered pins.
 * Everything reads from this file so the map pins, the control-center chips
 * and the summary cards read as one design language — no drift between
 * "the icon on the map" and "the icon in the panel".
 *
 *   heritage → stone grey    Castle    — ОКН: castles, manors, historic buildings, ruins
 *   monument → warm orange   Trophy    — war memorials, Lenin statues, obelisks
 *   sights   → amber/gold    Telescope — viewpoints, attractions, art, sculptures
 *   religion → brick red     Church    — churches, monasteries, wayside crosses, necropolises
 *   nature   → forest green  Trees     — forests, parks, lakes, rivers, ООПТ (water → Droplets)
 *   museum   → purple        Building2 — museums, galleries, exhibitions
 *
 * The Lucide *component* per category lives in `./category-icons.ts` (kept
 * separate so this file stays free of Vue dependencies — miniapp shares the
 * same Material-Symbol `icon` name for its own Icon component). The canvas
 * pin paths below are a faithful approximation of the same Lucide glyph, used
 * by AdventureMap's teardrop-pin renderer (maplibre paint needs resolved
 * geometry, not Vue components).
 */
export interface CategoryStyle {
  key: PoiCategory;
  label: string;       // RU short label (for chips)
  labelLong: string;   // RU descriptive label (for cards)
  icon: string;        // Material Symbol name (legacy) — mapped to Lucide in <Icon>
  /** CSS color (used for marker border + glow + chip fill). */
  color: string;
  /** Softer container color for filled states. */
  container: string;
  /**
   * Resolved hex color for canvas/maplibre paint properties (which can't
   * consume CSS vars at runtime). MUST match `color` for the categories that
   * use a literal hex, and be a sensible solid for the var-backed ones so the
   * map pin and the chip never disagree in dark mode.
   */
  hex: string;
}

export const CATEGORY_STYLES: Record<PoiCategory, CategoryStyle> = {
  heritage: {
    key: 'heritage',
    label: 'Наследие',
    labelLong: 'Объекты культурного наследия',
    icon: 'account_balance',
    color: '#66736B',
    container: '#E1E8E1',
    hex: '#66736B',
  },
  monument: {
    key: 'monument',
    label: 'Памятники',
    labelLong: 'Мемориалы и памятники',
    icon: 'military_tech',
    color: '#A87545',
    container: '#EEE1D2',
    hex: '#A87545',
  },
  sights: {
    key: 'sights',
    label: 'Достопримечательности',
    labelLong: 'Интересные места',
    icon: 'landscape',
    color: '#5E7E8B',
    container: '#DCE9EA',
    hex: '#5E7E8B',
  },
  religion: {
    key: 'religion',
    label: 'Религия',
    labelLong: 'Храмы, монастыри, некрополи',
    icon: 'church',
    // Dusty brick keeps churches distinct without competing with the route.
    color: '#8D5D5B',
    container: '#E7D9D5',
    hex: '#8D5D5B',
  },
  nature: {
    key: 'nature',
    label: 'Природа',
    labelLong: 'Озёра, леса, родники, ООПТ',
    icon: 'forest',
    color: '#4F7A68',
    container: '#DCE9E1',
    hex: '#4F7A68',
  },
  museum: {
    key: 'museum',
    label: 'Музеи',
    labelLong: 'Музеи, галереи, выставки',
    icon: 'museum',
    color: '#776B8E',
    container: '#E5E0EC',
    hex: '#776B8E',
  },
};

/** Resolved hex per category (convenience accessor for maplibre paint). */
export const CATEGORY_HEX: Record<string, string> = Object.fromEntries(
  (Object.keys(CATEGORY_STYLES) as PoiCategory[]).map((k) => [k, CATEGORY_STYLES[k].hex]),
);

/**
 * Lucide SVG path data per category — canvas approximation of the exact same
 * glyph rendered by the Lucide component in the chips/cards. AdventureMap
 * strokes these into the teardrop pin head so a museum pin on the map and the
 * museum chip in the panel are the same symbol. Keep in sync with the Lucide
 * component chosen in `category-icons.ts`.
 */
export const CATEGORY_PIN_PATHS: Record<string, string[]> = {
  // Castle (heritage)
  heritage: [
    'M10 5V3', 'M14 5V3', 'M15 21v-3a3 3 0 0 0-6 0v3',
    'M18 3v8', 'M18 5H6', 'M22 11H2',
    'M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9', 'M6 3v8',
  ],
  // Trophy (monument) — matches the Lucide `Trophy` glyph used in the chips.
  monument: [
    'M6 9H4.5a2.5 2.5 0 0 1 0-5H6',
    'M18 9h1.5a2.5 2.5 0 0 0 0-5H18',
    'M4 22h16',
    'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22',
    'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22',
    'M18 2H6v7a6 6 0 0 0 12 0V2Z',
  ],
  // Telescope (sights)
  sights: [
    'm10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44',
    'm13.56 11.747 4.332-.924',
    'm16 21-3.105-6.21',
    'M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z',
    'm6.158 8.633 1.114 4.456',
    'm8 21 3.105-6.21',
  ],
  // Church (religion)
  religion: [
    'M10 9h4', 'M12 7v5', 'M14 21v-3a2 2 0 0 0-4 0v3',
    'm18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9',
    'M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14',
  ],
  // Trees (nature)
  nature: [
    'M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z',
    'M7 16v6', 'M13 19v3', 'M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5',
  ],
  // Building2 (museum) — matches the Lucide `Building2` glyph rendered in chips.
  museum: [
    'M10 12h4', 'M10 8h4', 'M14 21v-3a2 2 0 0 0-4 0v3',
    'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9',
    'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M18 21V10', 'M2 22h20',
  ],
};

/** Categories to show by default on first load (museum is opt-in). */
export const DEFAULT_ACTIVE_CATEGORIES: PoiCategory[] = [
  'heritage',
  'monument',
  'sights',
  'religion',
  'nature',
];

export const CATEGORY_ORDER: PoiCategory[] = [
  'heritage',
  'monument',
  'sights',
  'religion',
  'nature',
  'museum',
];

/** A water POI gets a distinct drop symbol + blue-green tone. */
export function isWaterPoi(
  category: PoiCategory,
  tags: Record<string, string> | null,
): boolean {
  if (category !== 'nature') return false;
  if (!tags) return false;
  return Boolean(
    tags['water'] ||
      tags['natural'] === 'water' ||
      tags['natural'] === 'spring' ||
      tags['waterway'] === 'waterfall' ||
      tags['waterway'] === 'river',
  );
}

/** Material Symbol (legacy MS name) + color for a specific POI (water-aware). */
export function poiIcon(poi: {
  category: PoiCategory;
  tags: Record<string, string> | null;
}): { icon: string; color: string } {
  const base = CATEGORY_STYLES[poi.category];
  if (isWaterPoi(poi.category, poi.tags)) {
    return { icon: 'water_drop', color: 'rgb(var(--nv-tertiary))' };
  }
  return { icon: base.icon, color: base.color };
}
