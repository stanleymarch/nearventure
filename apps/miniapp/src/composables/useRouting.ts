/**
 * Routing API client for the mini-app — thin wrappers over the existing
 * backend capabilities (isochrone / plan / gpx). No domain logic here;
 * everything is computed on the backend.
 *
 * IMPORTANT: the backend `/api/routing/plan` endpoint returns
 * `{ routes: RouteResult[], order, loop, optimize, ... }` (see backend
 * PlanResult). The wrapper below flattens `routes[0]` into the convenient
 * single-route shape the UI consumes, and expose `order` as `optimizedOrder`.
 * The old version read the nested response as flat → `geojson`/`distance`/
 * `duration` were all `undefined` → the wizard preview never rendered and the
 * budget bar showed "NaN".
 */
import { api } from '@/api';
import type { BuiltRoute } from '@/composables/useBuiltRoute';
import { extractLineCoordinates } from '@shared/lib/geojson-utils';
import type { RoadFact, RouteQuality, RoutingHealth, RoutingProfile } from '@shared/api/routing-contracts';
export type { RoadFact, RouteQuality, RoutingHealth, RoutingProfile } from '@shared/api/routing-contracts';

export interface Point {
  lon: number;
  lat: number;
}

export interface IsochroneResult {
  bbox: [number, number, number, number];
  geojson?: { type: string; coordinates: any };
  approximate?: boolean;
}

/** Default display allowance per route POI (minutes). */
export const VISIT_MIN_PER_POI = 5;

/** Backend RouteResult (one concrete route through the waypoints). */
interface BackendRouteResult {
  geojson: {
    type: 'Feature';
    geometry: { type: string; coordinates: number[][] } | null;
    properties: Record<string, unknown>;
  };
  distance: number;
  duration: number;
  ascend: number;
  descend: number;
  profile: string;
  bbox: [number, number, number, number];
  quality?: RouteQuality;
  roadFacts?: RoadFact[];
}

/** Backend PlanResult: one or more routes + visiting order. */
interface BackendPlanResult {
  routes: BackendRouteResult[];
  /** 0-based indices into the request's waypoints (after TSP reorder). */
  order: number[];
  loop: boolean;
  optimize: boolean;
}

/**
 * Flattened single-route shape consumed by the UI (WizardView / preview).
 * `optimizedOrder` mirrors the backend `order` so the wizard can renumber
 * cart stops in visiting order at checkout.
 */
export interface PlanResult {
  geojson: BackendRouteResult['geojson'] | null;
  distance: number;
  duration: number;
  ascend: number;
  descend: number;
  profile: string;
  bbox?: [number, number, number, number];
  optimizedOrder?: number[];
  quality?: RouteQuality;
  roadFacts?: RoadFact[];
}

/** Flatten the backend response into the UI shape (routes[0] + order). */
function toFlatPlan(
  res: BackendPlanResult,
  fallbackProfile: RoutingProfile,
): PlanResult {
  const r = res.routes[0];
  return {
    geojson: r?.geojson ?? null,
    distance: r?.distance ?? 0,
    duration: r?.duration ?? 0,
    ascend: r?.ascend ?? 0,
    descend: r?.descend ?? 0,
    profile: r?.profile ?? fallbackProfile,
    bbox: r?.bbox,
    optimizedOrder: res.order,
    quality: r?.quality,
    roadFacts: r?.roadFacts,
  };
}

/** Live GraphHopper capability discovery. Profiles are never hardcoded by the client. */
export async function getRoutingHealth(): Promise<RoutingHealth> {
  return (await api.get<RoutingHealth>('/api/routing/health')).data;
}

/** Reachable area for a time budget (returns bbox for POI search + polygon). */
export async function fetchIsochrone(
  point: Point,
  profile: RoutingProfile,
  timeMinutes: number,
): Promise<IsochroneResult> {
  const res = await api.post<IsochroneResult>('/api/routing/isochrone', {
    point,
    profile,
    timeLimitMinutes: timeMinutes,
    loop: true,
  });
  return res.data;
}

/** Build a route through selected POI waypoints (+ TSP, +loop). */
export async function planRoute(
  start: Point,
  waypoints: Point[],
  profile: RoutingProfile,
  opts: { optimize?: boolean; loop?: boolean } = {},
): Promise<PlanResult> {
  const res = await api.post<BackendPlanResult>('/api/routing/plan', {
    start,
    waypoints,
    profile,
    options: { optimize: opts.optimize ?? true, loop: opts.loop ?? true },
  });
  return toFlatPlan(res.data, profile);
}

/** Build a GPX 1.1 blob from a built route — client-side.
 *
 * The preview's primary action is "Скачать GPX". It used to POST to
 * /api/routing/gpx, but that endpoint never existed → 404 on every download.
 * Generating client-side matches the web frontend pattern and needs no
 * backend endpoint. Handles both Feature-wrapped and bare geometries. */
export function buildGpxBlob(route: BuiltRoute, name = 'Nearventure route'): Blob {
  const pts = extractLineCoordinates(route.geojson); // [lng, lat, elev?]
  // Re-attach elevation if present (extractLineCoordinates drops it).
  const geom = route.geojson as any;
  const rawCoords: number[][] =
    geom?.type === 'Feature'
      ? (geom?.geometry?.coordinates ?? [])
      : (geom?.coordinates ?? []);
  const withEle = pts.map(([lon, lat], i) => {
    const ele = rawCoords[i]?.[2];
    return [lon, lat, typeof ele === 'number' ? ele : undefined] as const;
  });

  const trkpts = withEle
    .map(
      ([lon, lat, ele]) =>
        `      <trkpt lat="${lat}" lon="${lon}">${ele != null ? `\n        <ele>${ele.toFixed(1)}</ele>` : ''}</trkpt>`,
    )
    .join('\n');

  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  for (const [lon, lat] of withEle) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  const safe = name.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
  const now = new Date().toISOString();
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Nearventure" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safe}</name>
    <time>${now}</time>
    <bounds minlat="${minLat}" minlon="${minLon}" maxlat="${maxLat}" maxlon="${maxLon}"/>
  </metadata>
  <trk>
    <name>${safe}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
  return new Blob([gpx], { type: 'application/gpx+xml' });
}

/** Fetch GPX for a built route → triggers download.
 * @deprecated kept for compatibility; prefer buildGpxBlob (client-side). */
export async function fetchGpx(route: BuiltRoute, name: string): Promise<Blob> {
  return buildGpxBlob(route, name);
}

/** Start a guide from a versioned owned itinerary draft. No route data leaves the browser. */
export async function startGuideFromMiniApp(initData: string, draftId: string, expectedVersion: number): Promise<{ ok: boolean; error?: string }> {
  const res = await api.post<{ ok: boolean; error?: string }>(
    '/api/telegram/guide/start-draft',
    { initData, draftId, expectedVersion },
  );
  return res.data;
}

/** Fetch the bot's last built route for this user (HMAC-validated via initData). */
export async function fetchLastRoute(initData: string): Promise<{ ok: boolean; route?: BuiltRoute; error?: string }> {
  const res = await api.get<{ ok: boolean; route?: BuiltRoute; error?: string }>(
    '/api/telegram/last-route',
    { params: { initData } },
  );
  return res.data;
}
