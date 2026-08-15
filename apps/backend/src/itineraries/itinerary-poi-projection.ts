import type { ItineraryPoi, Point } from './itinerary.types';

/**
 * POI fields that are safe to snapshot into an itinerary. This deliberately
 * does not infer complex identity: optional identity/access data is only
 * retained when an upstream caller already supplied it.
 */
export interface ItineraryPoiSource {
  id: string;
  name?: string | null;
  category?: string | null;
  lat?: number | null;
  lon?: number | null;
  featured?: boolean | null;
  popularityScore?: number | null;
  explicitComplexId?: string;
  accessPoint?: Point;
}

/** Keep auto, direct-add, and preview POI snapshots consistent. */
export function projectItineraryPoi(poi: ItineraryPoiSource): ItineraryPoi {
  return {
    id: poi.id,
    name: poi.name || 'Без названия',
    category: poi.category || 'sights',
    lat: poi.lat ?? 0,
    lon: poi.lon ?? 0,
    included: true,
    estimatedVisitMinutes: 0,
    featured: poi.featured ?? undefined,
    popularityScore: poi.popularityScore ?? undefined,
    explicitComplexId: poi.explicitComplexId,
    accessPoint: poi.accessPoint,
  };
}
