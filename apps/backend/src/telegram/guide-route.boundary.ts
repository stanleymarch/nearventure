import type { CachedRoute } from './last-route.service';

/**
 * The only boundary through which a route may enter Telegram guide state.
 * It deliberately produces the legacy cache shape too, so bot flows and Mini
 * App handoffs cannot silently apply different filtering or validation rules.
 */
const GUIDE_PROFILES = new Set([
  'bike', 'mtb', 'foot', 'car', 'bike_touring', 'mtb_leisure', 'foot_scenic',
]);

type GuidePoi = CachedRoute['pois'][number];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasGuidePoiFields(value: unknown): value is Omit<GuidePoi, 'order'> {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && value.id.trim().length > 0 &&
    typeof value.name === 'string' && value.name.trim().length > 0 &&
    typeof value.category === 'string' && value.category.trim().length > 0 &&
    isFiniteNumber(value.lat) && Math.abs(value.lat) <= 90 &&
    isFiniteNumber(value.lon) && Math.abs(value.lon) <= 180;
}

function hasLineStringCoordinates(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length >= 2 && value.every((position) =>
    Array.isArray(position) && position.length >= 2 &&
    position.every(isFiniteNumber) &&
    Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90,
  );
}

/** Normalize and validate the route format that is persisted for Telegram. */
export function guideRouteFromCache(value: unknown): CachedRoute | null {
  if (!isRecord(value) || typeof value.profile !== 'string' || !GUIDE_PROFILES.has(value.profile) ||
    !isFiniteNumber(value.distance) || value.distance < 0 ||
    !isFiniteNumber(value.duration) || value.duration < 0 ||
    !isFiniteNumber(value.ascend) || value.ascend < 0 ||
    !isFiniteNumber(value.descend) || value.descend < 0 ||
    !isRecord(value.geojson) || value.geojson.type !== 'LineString' ||
    !hasLineStringCoordinates(value.geojson.coordinates) || !Array.isArray(value.pois) ||
    value.pois.length === 0 || !value.pois.every(hasGuidePoiFields)) {
    return null;
  }

  // Reassign sequential order here rather than trusting a persisted value.
  // This is deterministic for both individual and clustered itinerary places.
  return {
    distance: value.distance,
    duration: value.duration,
    ascend: value.ascend,
    descend: value.descend,
    profile: value.profile,
    geojson: { type: 'LineString', coordinates: value.geojson.coordinates },
    pois: value.pois.map((poi, index) => ({
      id: poi.id,
      name: poi.name,
      category: poi.category,
      lat: poi.lat,
      lon: poi.lon,
      order: index + 1,
    })),
  };
}

/**
 * Filter canonical draft children in itinerary order, then validate the exact
 * route snapshot that will be cached and used by the guide. Excluded children
 * deliberately do not become guide stops and therefore do not affect it.
 */
export function guideRouteFromDraft(draft: unknown): CachedRoute | null {
  if (!isRecord(draft) || (draft.status !== 'ready' && draft.status !== 'published') ||
    !isRecord(draft.totals) || draft.totals.feasible !== true ||
    !Array.isArray(draft.places) || !isRecord(draft.route) ||
    !isRecord(draft.route.geojson) || !isRecord(draft.route.geojson.geometry)) {
    return null;
  }

  const pois: unknown[] = [];
  for (const place of draft.places) {
    if (!isRecord(place) || !Array.isArray(place.pois)) return null;
    for (const poi of place.pois) {
      // A child must state inclusion explicitly; otherwise a corrupted draft
      // could disappear from the guide through a permissive truthy filter.
      if (!isRecord(poi) || typeof poi.included !== 'boolean') return null;
      if (poi.included) pois.push(poi);
    }
  }

  return guideRouteFromCache({
    distance: draft.route.distance,
    duration: draft.route.duration,
    ascend: draft.route.ascend,
    descend: draft.route.descend,
    profile: draft.route.profile,
    geojson: draft.route.geojson.geometry,
    pois,
  });
}
