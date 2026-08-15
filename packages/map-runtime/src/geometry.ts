/* GeoJSON normalization and geometry utilities. */

/**
 * Normalize a route geometry value into a consistent shape.
 * Accepts: Feature<LineString>, bare LineString, FeatureCollection, or null.
 */
export interface NormalizedGeometry {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[][] | number[][][];
  } | null;
  properties?: Record<string, unknown>;
}

/**
 * Parse various GeoJSON shapes into a single NormalizedGeometry.
 * Returns null if the input is null, undefined, or not parseable.
 */
export function normalizeRouteGeometry(
  input: unknown,
): NormalizedGeometry | null {
  if (!input) return null;

  // Already a Feature
  if (isFeature(input)) {
    return {
      type: 'Feature',
      geometry: input.geometry,
      properties: (input as Record<string, unknown>).properties as Record<string, unknown> | undefined,
    };
  }

  // Bare geometry object
  if (isGeometry(input)) {
    return {
      type: 'Feature',
      geometry: input,
    };
  }

  // FeatureCollection — take first feature
  if (isCollection(input)) {
    const features = (input as { features: unknown[] }).features;
    if (features.length > 0) {
      return normalizeRouteGeometry(features[0]);
    }
    return null;
  }

  return null;
}

function isFeature(v: unknown): boolean {
  const obj = v as Record<string, unknown> | null;
  return !!obj && obj.type === 'Feature' && !!obj.geometry;
}

function isGeometry(v: unknown): boolean {
  const obj = v as Record<string, unknown> | null;
  return !!obj && typeof obj.type === 'string' && !!obj.coordinates;
}

function isCollection(v: unknown): boolean {
  const obj = v as Record<string, unknown> | null;
  return !!obj && obj.type === 'FeatureCollection' && Array.isArray(obj.features);
}

/**
 * Extract line coordinate pairs from normalized geometry.
 * Returns [lng, lat][] pairs.
 */
export function extractLineCoords(
  geo: NormalizedGeometry | null,
): [number, number][] {
  if (!geo?.geometry) return [];

  const coords = geo.geometry.coordinates;

  // LineString: [[lng, lat], ...]
  if (geo.geometry.type === 'LineString' && Array.isArray(coords[0])) {
    return coords as [number, number][];
  }

  // MultiLineString or Polygon: take first segment
  if (
    (geo.geometry.type === 'MultiLineString' || geo.geometry.type === 'Polygon') &&
    Array.isArray(coords[0]) &&
    Array.isArray((coords as unknown[][])[0][0])
  ) {
    return (coords as [number, number][][])[0];
  }

  return [];
}

/**
 * Calculate bounding box from coordinates.
 * Returns [minLng, minLat, maxLng, maxLat] or null for empty input.
 */
export function bboxFromCoords(coords: [number, number][]): [number, number, number, number] | null {
  if (coords.length === 0) return null;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}
