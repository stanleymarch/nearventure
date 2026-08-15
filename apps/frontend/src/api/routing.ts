import api from './index';
import type { RoadFact, RouteQuality, RoutingHealth, RoutingProfile } from './routing-contracts';

export type { RoadFact, RoadFactKind, RoadFactValue, RouteQuality, RouteQualityWarning, RoutingHealth, RoutingProfile } from './routing-contracts';

export interface LatLng {
  lon: number;
  lat: number;
}

export interface RouteResult {
  geojson: {
    type: 'Feature';
    geometry: {
      type: 'LineString';
      coordinates: number[][]; // [lon, lat, elevation?]
    } | null;
    properties: {
      distance: number;
      duration: number;
      ascend: number;
      descend: number;
      profile: RoutingProfile;
    };
  };
  distance: number; // meters
  duration: number; // seconds
  ascend: number; // meters
  descend: number; // meters
  profile: RoutingProfile;
  bbox: [number, number, number, number];
  /** Additive backend route-quality evidence; omitted by older/plain responses. */
  quality?: RouteQuality;
  /** Additive GraphHopper path-detail evidence; omitted when not configured. */
  roadFacts?: RoadFact[];
}

export const getRoutingHealth = async (): Promise<RoutingHealth> => {
  const res = await api.get<RoutingHealth>('/api/routing/health');
  return res.data;
};

/** Scenario A — point-to-point (or multi-point) route. */
export const buildRoute = async (
  points: LatLng[],
  profile: RoutingProfile,
): Promise<RouteResult> => {
  const res = await api.post<RouteResult>('/api/routing/route', {
    points,
    profile,
  });
  return res.data;
};

/** Scenario C — generate a round-trip loop from a start + distance budget. */
export const buildRoundTrip = async (
  start: LatLng,
  profile: RoutingProfile,
  distance = 10_000,
  seed?: number,
): Promise<RouteResult> => {
  const res = await api.post<RouteResult>('/api/routing/round-trip', {
    start,
    profile,
    distance,
    seed,
  });
  return res.data;
};

export interface PlanOptions {
  loop?: boolean;
  optimize?: boolean;
  alternatives?: boolean;
  maxAlternatives?: number;
  /** Time budget in minutes. When set, the endpoint verifies the route fits
   *  and returns a friendly error with the overage if it doesn't. */
  timeBudgetMinutes?: number;
  /** Enrich the route with POIs near user-selected waypoints that fit in
   *  the remaining budget. Suggested POIs returned in `suggestedPois`. */
  enrichWithPois?: boolean;
  /** Category filter for enrichment (comma-separated, e.g. "nature,museum"). */
  enrichCategories?: string;
  /** Buffer (meters) around the route path for POI search. Default 1000. */
  enrichBufferMeters?: number;
}

export interface SuggestedPoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  /** Estimated extra minutes added to the route (detour + visit). */
  detourMinutes: number;
}

export interface PlanResult {
  routes: RouteResult[];
  /** 0-based indices of the submitted waypoints, after TSP reorder. */
  order: number[];
  loop: boolean;
  optimize: boolean;
  /** POIs suggested by `enrichWithPois` — near the route, fit in budget.
   *  Each has an estimated detour cost so the UI can show "+5 min detour". */
  suggestedPois?: SuggestedPoi[];
}

export interface IsochroneResult {
  bbox: [number, number, number, number];
  /** True when the backend returned a geometric fallback instead of a road-network polygon. */
  approximate?: boolean;
  geojson?: {
    type: 'Polygon';
    coordinates: number[][][];
  } | null;
}

/** Calculate isochrone (reachable area) for map visualization. */
export const getIsochrone = async (
  point: LatLng,
  profile: RoutingProfile,
  timeLimitMinutes: number,
): Promise<IsochroneResult> => {
  const res = await api.post<IsochroneResult>('/api/routing/isochrone', {
    point,
    profile,
    timeLimitMinutes,
  });
  return res.data;
};

/** Scenario A/B — route from `start` through selected POI waypoints.
 *  Rebuilds live as the selection changes. */
export const planRoute = async (
  start: LatLng,
  waypoints: LatLng[],
  profile: RoutingProfile,
  options: PlanOptions = {},
): Promise<PlanResult> => {
  const res = await api.post<PlanResult>('/api/routing/plan', {
    start,
    waypoints,
    profile,
    options,
  });
  return res.data;
};

/** GPX export from a route GeoJSON (moment-of-truth #1 for a bike app). */
export function routeToGpx(route: RouteResult, name = 'Nearventure route'): string {
  const coords = route.geojson.geometry?.coordinates ?? [];
  const trkpts = coords
    .map(
      ([lon, lat, ele]) =>
        `      <trkpt lat="${lat}" lon="${lon}">${ele != null ? `<ele>${ele}</ele>` : ''}</trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Nearventure" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}

/** Trigger a browser download of a GPX file. */
export function downloadGpx(route: RouteResult, name?: string): void {
  const fileName = name ?? generateGpxFileName(route);
  const gpx = routeToGpx(route, fileName.replace('.gpx', ''));
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName + '.gpx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Generate a human-friendly filename for GPX. */
function generateGpxFileName(route: RouteResult): string {
  const profile = route.profile ?? 'bike';
  const dist = formatDistance(route.distance).replace(' ', '-');
  return `kirov-${dist}-${profile.toLowerCase()}`;
}

// --- Formatting helpers (shared by UI) ---

export const formatDistance = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} км` : `${Math.round(m)} м`;

export const formatDuration = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
};

/** Straight-line distance (m) — used for "X km" chips on POI cards. */
export const straightDistance = (
  a: LatLng,
  b: LatLng,
): number => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
