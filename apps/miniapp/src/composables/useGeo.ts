/**
 * Tiny geo helpers shared across mini-app views (catalog, basket, nearby).
 * Pure functions — no side effects.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in meters between two points (haversine). */
export function haversine(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Format meters → "1.2 км" / "340 м". */
export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${Math.round(m)} м`;
}

/** Approximate bounding box of Kirov Oblast (Кировская область). */
// Region/district/city now come from the POI collector pipeline (DB columns).
// Coordinate-based region guessing was removed — see git history.

/** Format coordinates as "58.60350, 49.66790". */
export function formatCoords(
  lat: number | null | undefined,
  lon: number | null | undefined,
): string | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Format seconds → "1 ч 5 мин" / "40 мин". */
export function fmtDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} ч ${rest} мин` : `${h} ч`;
}

/** Mean travel speed (m/min) per routing profile — for rough time estimates. */
export const PROFILE_SPEED_M_PER_MIN: Record<string, number> = {
  foot: 83, // 5 km/h
  bike: 250, // 15 km/h
  mtb: 200, // 12 km/h
  car: 667, // 40 km/h
};

/** Rough extra-time estimate (minutes) to reach a point at the given distance. */
export function estExtraMinutes(distanceM: number, profile: string): number {
  const speed = PROFILE_SPEED_M_PER_MIN[profile] ?? PROFILE_SPEED_M_PER_MIN.foot;
  return Math.round(distanceM / speed);
}
