/**
 * GeoJSON coordinate extraction utilities shared by the web map and Mini App.
 *
 * Routes API returns a Feature while routing previews may return bare geometry;
 * these helpers normalise both shapes into one coordinate array.
 */
export type LatLng = [number, number]; // [lng, lat]

export interface BareGeometry {
  type: string;
  coordinates: number[][] | number[][][];
}

export interface FeatureGeometry {
  type: 'Feature';
  geometry: BareGeometry | null;
}

export type AnyGeoJSON = BareGeometry | FeatureGeometry | null | undefined;

/** Unwrap a GeoJSON Feature to its geometry, or return bare geometry as-is. */
export function unwrapGeometry(input: AnyGeoJSON): BareGeometry | null {
  if (!input) return null;
  if ((input as FeatureGeometry).type === 'Feature') return (input as FeatureGeometry).geometry ?? null;
  return input as BareGeometry;
}

/**
 * Extract a flat list of [lng, lat] coordinates from LineString,
 * MultiLineString, or nested coordinate arrays. Returns [] for invalid input.
 */
export function extractLineCoordinates(input: AnyGeoJSON): LatLng[] {
  const geom = unwrapGeometry(input);
  if (!geom?.coordinates || !Array.isArray(geom.coordinates)) return [];

  const flat: number[][] = geom.type === 'MultiLineString'
    ? (geom.coordinates as number[][][]).flat()
    : (geom.coordinates as number[][]);

  const points: LatLng[] = [];
  for (const coord of flat) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isNaN(lon) && !Number.isNaN(lat)) points.push([lon, lat]);
  }
  return points;
}
