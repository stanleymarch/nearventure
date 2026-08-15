import type { GeoJsonLineString } from './routing.types';

/** GraphHopper path-detail keys that this API can expose as road facts. */
export const GRAPHHOPPER_PATH_DETAIL_KINDS = [
  'road_class',
  'surface',
  'road_environment',
  'track_type',
] as const;

export type RoadFactKind = (typeof GRAPHHOPPER_PATH_DETAIL_KINDS)[number];
export type GhPathDetailInterval = readonly [from: number, to: number, value: string];
export type GhPathDetails = Partial<Record<RoadFactKind, GhPathDetailInterval[]>>;

export interface RoadFactValue {
  value: string;
  /** Geometry-derived evidence distance in metres. */
  distance: number;
  /** Geometry-derived share of the complete route, in the range 0..1. */
  share: number;
}

export interface RoadFact {
  kind: RoadFactKind;
  values: RoadFactValue[];
}

/**
 * Reads the opt-in comma-separated setting without allowing arbitrary GH
 * details through the public route contract.
 */
export function parseConfiguredPathDetails(raw: string | undefined): {
  details: RoadFactKind[];
  unsupported: string[];
} {
  const details: RoadFactKind[] = [];
  const unsupported: string[] = [];
  const allowed = new Set<string>(GRAPHHOPPER_PATH_DETAIL_KINDS);

  for (const value of (raw ?? '').split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!allowed.has(value)) {
      unsupported.push(value);
    } else if (!details.includes(value as RoadFactKind)) {
      details.push(value as RoadFactKind);
    }
  }

  return { details, unsupported };
}

/**
 * Keeps only requested categorical details with structurally valid raw GH
 * intervals. Bounds are checked later against the returned geometry.
 */
export function parseGhPathDetails(raw: unknown, requested: readonly RoadFactKind[]): GhPathDetails | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const result: GhPathDetails = {};
  for (const kind of requested) {
    const rawIntervals = (raw as Record<string, unknown>)[kind];
    if (!Array.isArray(rawIntervals) || rawIntervals.length === 0) continue;

    const intervals: GhPathDetailInterval[] = [];
    let malformed = false;
    for (const rawInterval of rawIntervals) {
      if (!Array.isArray(rawInterval) || rawInterval.length !== 3) {
        malformed = true;
        break;
      }
      const [from, to, rawValue] = rawInterval;
      if (
        !Number.isInteger(from)
        || !Number.isInteger(to)
        || typeof rawValue !== 'string'
        || !rawValue.trim()
      ) {
        malformed = true;
        break;
      }
      intervals.push([from, to, rawValue.trim()]);
    }

    // Do not retain partial evidence from a malformed fact kind.
    if (!malformed) result[kind] = intervals;
  }

  return Object.keys(result).length ? result : undefined;
}

/**
 * Converts GraphHopper point-index intervals to compact, geometry-backed
 * evidence. A malformed, overlapping, or out-of-bounds fact is omitted rather
 * than estimated. Shares use the full route geometry as their denominator, so
 * sparse details cannot be mistaken for complete coverage.
 */
export function normalizeRoadFacts(
  details: GhPathDetails | undefined,
  geometry: GeoJsonLineString | null | undefined,
): RoadFact[] | undefined {
  const coordinates = geometry?.coordinates;
  if (!details || geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) {
    return undefined;
  }

  const segmentDistances: number[] = [];
  let totalDistance = 0;
  for (let index = 0; index < coordinates.length - 1; index++) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    if (!validCoordinate(start) || !validCoordinate(end)) return undefined;
    const distance = haversineMeters(start[1], start[0], end[1], end[0]);
    if (!Number.isFinite(distance)) return undefined;
    segmentDistances.push(distance);
    totalDistance += distance;
  }
  if (!(totalDistance > 0)) return undefined;

  const facts: RoadFact[] = [];
  for (const kind of GRAPHHOPPER_PATH_DETAIL_KINDS) {
    const intervals = details[kind];
    if (!intervals?.length) continue;

    const evidence = new Map<string, number>();
    let previousEnd = 0;
    let malformed = false;
    for (const interval of intervals) {
      const [from, to, value] = interval;
      if (
        !Number.isInteger(from)
        || !Number.isInteger(to)
        || from < 0
        || to <= from
        || to > segmentDistances.length
        || from < previousEnd
        || typeof value !== 'string'
        || !value
      ) {
        malformed = true;
        break;
      }
      let intervalDistance = 0;
      for (let index = from; index < to; index++) intervalDistance += segmentDistances[index];
      if (intervalDistance > 0) evidence.set(value, (evidence.get(value) ?? 0) + intervalDistance);
      previousEnd = to;
    }

    if (malformed || evidence.size === 0) continue;
    const values = [...evidence.entries()]
      .map(([value, distance]) => ({
        value,
        distance: Math.round(distance),
        share: roundShare(distance / totalDistance),
      }))
      .filter((value) => value.distance > 0)
      .sort((a, b) => b.distance - a.distance || a.value.localeCompare(b.value));
    if (values.length) facts.push({ kind, values });
  }

  return facts.length ? facts : undefined;
}

function validCoordinate(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lon2 - lon1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function roundShare(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
