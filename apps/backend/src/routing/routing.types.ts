/** Routing profiles exposed by the app. Maps 1:1 to GraphHopper profiles:
 *  - bike = trekking / asphalt (avoids steep hills)
 *  - mtb  = mountain / forest / dirt tracks (uses mtb_rating)
 *  - foot = walking
 *  - car  = kept for completeness
 */
export type RoutingProfile = 'bike' | 'mtb' | 'foot' | 'car' | 'bike_touring' | 'mtb_leisure' | 'foot_scenic';

/** Public aliases map to separately configured GH profiles; legacy names remain stable. */
export const ROUTING_PROFILES: readonly RoutingProfile[] = ['bike', 'mtb', 'foot', 'car', 'bike_touring', 'mtb_leisure', 'foot_scenic'];
export const routingProfileFamily = (profile: RoutingProfile): 'bike' | 'mtb' | 'foot' | 'car' => {
  if (profile === 'bike_touring') return 'bike';
  if (profile === 'mtb_leisure') return 'mtb';
  if (profile === 'foot_scenic') return 'foot';
  return profile;
};

/** A GeoJSON Polygon for isochrone visualization. */
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][]; // [[ [lon, lat], ... ], ...] — outer ring + holes
}

/** Result of isochrone calculation (reachable area). */
export interface IsochroneResult {
  /** Bounding box for POI search. */
  bbox: [number, number, number, number];
  /** Full GeoJSON Polygon for map rendering (optional). */
  geojson?: GeoJsonPolygon | null;
  /** True when the isochrone fell back to a geometric circle approximation
   *  (GraphHopper returned an empty/degenerate polygon or errored). Candidates
   *  from an approximate isochrone require network confirmation. */
  approximate?: boolean;
}

/** A GeoJSON geometry as returned by GraphHopper when points_encoded=false. */
export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: number[][]; // [lon, lat, elevation?]
}

/** Normalized route result returned to clients (and usable directly by Leaflet). */
export interface RouteResult {
  /** GeoJSON Feature wrapping the route as a LineString (with elevation). */
  geojson: {
    type: 'Feature';
    geometry: GeoJsonLineString | null;
    properties: RouteProperties;
  };
  distance: number; // meters
  duration: number; // seconds
  ascend: number; // meters (uphill)
  descend: number; // meters (downhill)
  profile: RoutingProfile;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  /** Optional GraphHopper path-detail evidence. Omitted when not configured or unavailable. */
  roadFacts?: import('./road-facts').RoadFact[];
}

export interface RouteProperties {
  distance: number;
  duration: number;
  ascend: number;
  descend: number;
  profile: RoutingProfile;
}

export interface RoutingHealth {
  available: boolean;
  profiles: string[];
}

/** Options for the unified plan endpoint (scenario A/B/C controls). */
export interface PlanOptions {
  /** Return to the start point (closed tour). Default false (open path). */
  loop?: boolean;
  /** Reorder waypoints for a shorter tour (TSP). Default false (keep order). */
  optimize?: boolean;
  /** Request several distinct A→B paths (only applies to a single waypoint).
   *  Proxy for "pass through something beautiful / don't use the same road".
   *  True scenic scoring arrives in Phase 6. */
  alternatives?: boolean;
  /** How many alternative variants to ask for (2–4). */
  maxAlternatives?: number;
  /** Time budget in minutes for the total route. When set, the endpoint
   *  verifies the route fits in this budget and returns a friendly error
   *  with the overage if it doesn't. */
  timeBudgetMinutes?: number;
  /** Enrich the route with POIs near the user-selected waypoints.
   *  When true, after building the base route the endpoint searches for POIs
   *  within `enrichBufferMeters` of the route path, estimates the detour cost
   *  of each, and greedily adds those that fit the remaining time budget.
   *  Suggested POIs are returned in `PlanResult.suggestedPois`. */
  enrichWithPois?: boolean;
  /** Category filter for enrichment (comma-separated, same format as autoRoute).
   *  If omitted, all categories are considered. */
  enrichCategories?: string;
  /** Buffer (meters) around the route path for POI search. Default 1000. */
  enrichBufferMeters?: number;
}

/** Result of `POST /api/routing/plan`. */
export interface PlanResult {
  /** One route (or several, when `alternatives` was requested). */
  routes: RouteResult[];
  /** Visiting order of the waypoints, as 0-based indices into the request's
   *  `waypoints` array (after TSP reorder). Lets the UI number stops 1..n. */
  order: number[];
  loop: boolean;
  optimize: boolean;
  /** Geometry-derived loop quality; omitted for non-loop plans. */
  loopQuality?: { closureGapMeters: number; repeatedRoadRatio: number; outAndBackRatio: number; sharedStemMeters: number; warnings: string[] };
  /** Stable machine-readable warnings for degraded loop quality. */
  warnings?: string[];
  /** POIs suggested by `enrichWithPois` — near the route, fit in budget.
   *  Each has an estimated detour cost so the UI can show "+5 min detour". */
  suggestedPois?: Array<{
    id: string;
    name: string;
    category: string;
    lat: number;
    lon: number;
    /** Estimated extra minutes added to the route (detour + visit). */
    detourMinutes: number;
  }>;
  /** Ordered POI list for the auto-route (selected + visiting order). The Mini
   *  App preview renders these as numbered stop markers; absent for plain plan. */
  pois?: Array<{
    id: string;
    name: string;
    category: string;
    lat: number;
    lon: number;
    /** 0-based visiting order (matches `order`). */
    order: number;
  }>;
}
