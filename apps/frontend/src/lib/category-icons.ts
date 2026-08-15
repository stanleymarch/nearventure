import { Castle, Trophy, Telescope, Church, Trees, Building2, Droplets } from 'lucide-vue-next';
import type { Component } from 'vue';
import type { PoiCategory } from './poi-categories';
import { isWaterPoi } from './poi-categories';

/**
 * Lucide component per POI category — the crisp-vector counterpart of the
 * canvas pin paths in `poi-categories.ts > CATEGORY_PIN_PATHS`.
 *
 * ONE symbol per category shared by the map pins, the layer chips, the POI
 * cards and the summary carousel, so "museum on the map" and "museum in the
 * panel" are the same glyph. Water-subset POIs (lakes/rivers/springs) fall
 * back to Droplets regardless of category.
 *
 *   heritage → Castle     castles, manors, historic buildings, ruins
 *   monument → Trophy     war memorials, statues, obelisks
 *   sights   → Telescope  viewpoints, attractions, panoramas
 *   religion → Church     churches, monasteries, wayside crosses
 *   nature   → Trees      forests, parks, ООПТ (water subset → Droplets)
 *   museum   → Building2  museums, galleries, exhibitions
 */
export const CATEGORY_LUCIDE: Record<PoiCategory, Component> = {
  heritage: Castle,
  monument: Trophy,
  sights: Telescope,
  religion: Church,
  nature: Trees,
  museum: Building2,
};

/** Water-aware Lucide component for a single POI (lakes/rivers/springs → Droplets). */
export function poiLucideIcon(p: {
  category: PoiCategory;
  tags: Record<string, string> | null;
}): Component {
  return isWaterPoi(p.category, p.tags) ? Droplets : CATEGORY_LUCIDE[p.category];
}

export { Droplets };
