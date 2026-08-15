import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  RoutingProfile,
  routingProfileFamily,
  GeoJsonLineString,
  RoutingHealth,
} from './routing.types';
import {
  GhPathDetails,
  parseConfiguredPathDetails,
  parseGhPathDetails,
  RoadFactKind,
} from './road-facts';
import { Semaphore, SemaphoreBusyError } from '../common/concurrency/semaphore';
import { maxRoutingConcurrency, maxRoutingQueue } from '../common/app-config';

/**
 * Low-level GraphHopper HTTP client. Talks to the self-hosted GraphHopper
 * container (docker-compose, default http://localhost:8981).
 *
 * We request `points_encoded=false` so `points` comes back as a ready-to-use
 * GeoJSON LineString (with a third elevation coordinate when elevation=true) —
 * no polyline decoding needed on client or server.
 */

interface GhPoint {
  coordinates: [number, number] | [number, number, number];
}

interface GhPath {
  distance: number;
  time: number; // ms
  ascend: number;
  descend: number;
  bbox: [number, number, number, number];
  points: GeoJsonLineString; // points_encoded=false
  points_encoded: false;
  /** Requested, structurally valid GraphHopper path details (if any). */
  details?: GhPathDetails;
}

interface GhRouteResponse {
  paths: GhPath[];
}

interface GhInfoResponse {
  version?: unknown;
  bbox?: unknown;
  profiles?: unknown;
  elevation?: unknown;
}

@Injectable()
export class GraphHopperClient {
  private readonly logger = new Logger(GraphHopperClient.name);
  private readonly baseUrl: string;
  private readonly pathDetails: RoadFactKind[];
  /**
   * Bounds concurrent outbound GraphHopper requests app-wide (public routing
   * endpoints, bot flows, itinerary optimization) so a burst of public calls
   * cannot saturate the routing engine. Tune via ROUTING_MAX_CONCURRENCY and
   * ROUTING_MAX_QUEUE. Health probes are intentionally NOT gated — liveness
   * must never queue.
   */
  private readonly semaphore = new Semaphore(maxRoutingConcurrency(), maxRoutingQueue());

  constructor() {
    this.baseUrl =
      process.env.GRAPHHOPPER_URL?.replace(/\/$/, '') || 'http://localhost:8981';
    const configured = parseConfiguredPathDetails(process.env.GRAPHHOPPER_PATH_DETAILS);
    this.pathDetails = configured.details;
    if (configured.unsupported.length) {
      this.logger.warn(
        `Ignoring unsupported GRAPHHOPPER_PATH_DETAILS value(s): ${configured.unsupported.join(', ')}. `
        + 'Use a comma-separated subset of: road_class, surface, road_environment, track_type.',
      );
    }
  }

  /** Point-to-point (or multi-point) route with elevation. */
  async route(
    points: { lon: number; lat: number }[],
    profile: RoutingProfile,
    signal?: AbortSignal,
  ): Promise<GhPath> {
    const paths = await this.routeMulti(points, profile, { signal });
    return paths[0];
  }

  /**
   * Multi-point route, optionally returning several distinct variants.
   *
   * - `alternatives` is honoured ONLY for a single A→B leg (2 points): it uses
   *   GraphHopper's `algorithm=alternative_route` with a low `max_share_factor`
   *   so the variants follow visibly different roads (the "don't take the same
   *   road" / "something scenic" proxy). With ≥3 points alternatives are ignored
   *   (GraphHopper restricts alternative_route to 2-point queries).
   */
  async routeMulti(
    points: { lon: number; lat: number }[],
    profile: RoutingProfile,
    opts: { alternatives?: boolean; maxAlternatives?: number; flexible?: boolean; signal?: AbortSignal },
  ): Promise<GhPath[]> {
    const needsFlexible = opts.alternatives || opts.flexible;
    const body: Record<string, unknown> = {
      points: points.map((p) => [p.lon, p.lat]),
      profile,
      elevation: true,
      points_encoded: false,
      instructions: false,
    };
    if (this.pathDetails.length) body.details = this.pathDetails;
    // CH (Contraction Hierarchies) is only prepared for 'car' on our GraphHopper
    // instance (preparing it for bike/mtb/foot on the full-region graph is too
    // costly in RAM/time). Keep CH for plain car routing (10-100× faster), but
    // disable it for every other profile AND for any flexible request
    // (alternatives / round_trip / multi-point optimize / non-loop plans).
    // Otherwise GH returns: "Cannot find CH preparation for the requested
    // profile: 'bike' … available CH profiles: [car]".
    const useCH = profile === 'car' && !needsFlexible;
    if (!useCH) {
      body['ch.disable'] = true;
    }
    if (opts.alternatives && points.length === 2) {
      body.algorithm = 'alternative_route';
      body['alternative_route.max_paths'] = Math.min(opts.maxAlternatives ?? 3, 4);
      // Keep alternatives genuinely different (default 0.6 → tighter here).
      body['alternative_route.max_share_factor'] = 0.5;
      body['alternative_route.max_weight_factor'] = 1.7;
    }
    const res = await this.post('/route', body, opts.signal);
    const json = (await res.json()) as GhRouteResponse & GhError;
    this.throwIfError(json, res.status);
    if (!json.paths?.length) throw new GraphHopperError('GraphHopper returned no paths.', res.status);
    json.paths.forEach((path) => {
      this.assertValidPath(path);
      path.details = parseGhPathDetails(path.details, this.pathDetails);
    });
    return json.paths;
  }

  /** Generate a round-trip loop from a start + approximate distance. */
  async roundTrip(
    start: { lon: number; lat: number },
    profile: RoutingProfile,
    distance: number,
    seed?: number,
    signal?: AbortSignal,
  ): Promise<GhPath> {
    const body: Record<string, unknown> = {
      points: [[start.lon, start.lat]],
      profile,
      elevation: true,
      points_encoded: false,
      instructions: false,
      'ch.disable': true, // required for round_trip
      algorithm: 'round_trip',
      'round_trip.distance': distance,
    };
    if (this.pathDetails.length) body.details = this.pathDetails;
    if (seed != null) body['round_trip.seed'] = seed;
    const res = await this.post('/route', body, signal);
    const json = (await res.json()) as GhRouteResponse & GhError;
    this.throwIfError(json, res.status);
    const path = json.paths?.[0];
    if (!path) throw new GraphHopperError('GraphHopper returned no paths.', res.status);
    this.assertValidPath(path);
    path.details = parseGhPathDetails(path.details, this.pathDetails);
    return path;
  }

  /** Calculate isochrone (reachable area) from a point.
   *  Returns bounding box for POI search and optional GeoJSON Polygon for map rendering.
   */
  async isochrone(
    point: { lon: number; lat: number },
    profile: RoutingProfile,
    timeLimitMinutes: number,
    signal?: AbortSignal,
  ): Promise<{ bbox: [number, number, number, number]; geojson?: any; approximate?: boolean }> {
    // GraphHopper isochrone only accepts GET with query params (lat,lon format)
    // Apply a conservatism factor: GraphHopper's pure-travel isochrone assumes
    // continuous fast cycling. Real micro-adventures include POI stops, terrain,
    // crossings, and a leisurely pace — so the effective reach is smaller.
    const conservatism: Record<string, number> = { foot: 0.75, bike: 0.65, mtb: 0.6, car: 0.9 };
    const factor = conservatism[routingProfileFamily(profile)] ?? 0.7;
    const effectiveSeconds = Math.round(timeLimitMinutes * 60 * factor);
    const params = new URLSearchParams({
      point: `${point.lat},${point.lon}`,
      profile,
      time_limit: `${effectiveSeconds}`, // seconds
      buckets: '1',
    });

    try {
      const res = await this.withCapacity(() =>
        fetch(`${this.baseUrl}/isochrone?${params}`, {
          signal: this.requestSignal(signal),
        }),
      );
      if (!res.ok) {
        // Non-200 → fallback
        throw new GraphHopperError(`HTTP ${res.status}`, res.status);
      }
      const json = (await res.json()) as any;
      const polygon = json.polygons?.[0]?.geometry;

      // GraphHopper can return HTTP 200 with an empty `polygons` array when the
      // start point is off the road graph (water/field/unmapped area), the
      // time_limit is too small to build a polygon, or the point lies outside
      // the graph bbox. In that case `polygon` is undefined and the old code
      // computed bbox [0,0,0,0] → "No POIs found in the reachable area".
      // Fall back to a circle approximating the reachable radius.
      if (!polygon || !polygon.coordinates?.length || !polygon.coordinates[0]?.length) {
        this.logger.warn(
          `Isochrone returned empty polygon for profile=${profile} time=${timeLimitMinutes}min — using circle fallback.`,
        );
        return this.circleIsochrone(point, profile, timeLimitMinutes);
      }

      const bbox = polygon.bbox || this.calculateBbox(polygon.coordinates[0]);

      // Zero-area bbox (degenerate polygon) → also fall back to circle.
      const [minLon, minLat, maxLon, maxLat] = bbox;
      if (minLon === maxLon || minLat === maxLat) {
        this.logger.warn(
          `Isochrone returned degenerate bbox (zero-area polygon) for profile=${profile} time=${timeLimitMinutes}min — using circle fallback.`,
        );
        return this.circleIsochrone(point, profile, timeLimitMinutes);
      }

      return { bbox: bbox as [number, number, number, number], geojson: polygon, approximate: false };
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError') ||
        error instanceof ServiceUnavailableException // capacity rejection — fail loudly, no circle fallback
      ) {
        throw error;
      }
      this.logger.warn(`Isochrone calculation failed: ${error}`);
      return this.circleIsochrone(point, profile, timeLimitMinutes);
    }
  }

  /**
   * Circle fallback when GraphHopper isochrone is unavailable or empty.
   * Approximates the reachable area as a circle of radius = speed × time.
   */
  private circleIsochrone(
    point: { lon: number; lat: number },
    profile: RoutingProfile,
    timeLimitMinutes: number,
  ): { bbox: [number, number, number, number]; geojson: any; approximate: boolean } {
    const speedMap: Record<string, number> = { foot: 4, bike: 11, mtb: 9, car: 36 };
    const speedKmH = speedMap[routingProfileFamily(profile)] ?? 11;
    const radius = (speedKmH * timeLimitMinutes) / 60;
    return {
      bbox: this.calculateCircleBbox(point, radius),
      geojson: this.createCirclePolygon(point, radius),
      approximate: true,
    };
  }

  /** Calculate bounding box from polygon coordinates */
  private calculateBbox(coordinates: number[][]): [number, number, number, number] {
    if (!coordinates || coordinates.length === 0) {
      return [0, 0, 0, 0];
    }

    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

    for (const [lon, lat] of coordinates) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }

    return [minLon, minLat, maxLon, maxLat];
  }

  /** Calculate circle bounding box */
  private calculateCircleBbox(
    center: { lon: number; lat: number },
    radiusKm: number,
  ): [number, number, number, number] {
    const latDeg = radiusKm / 111; // 1 degree ≈ 111 km
    const lonDeg = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));

    return [
      center.lon - lonDeg,
      center.lat - latDeg,
      center.lon + lonDeg,
      center.lat + latDeg,
    ];
  }

  /** Create an approximate circle polygon (32 points) */
  private createCirclePolygon(
    center: { lon: number; lat: number },
    radiusKm: number,
  ): any {
    const latDeg = radiusKm / 111;
    const lonDeg = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
    const points: number[][] = [];
    
    for (let i = 0; i <= 32; i++) {
      const angle = (i * 2 * Math.PI) / 32;
      points.push([
        center.lon + lonDeg * Math.cos(angle),
        center.lat + latDeg * Math.sin(angle),
      ]);
    }
    
    return {
      type: 'Polygon',
      coordinates: [points],
    };
  }

  /**
   * Reject partial GraphHopper success responses before they reach a map.
   * A `200` response without a usable LineString must never be rendered as a
   * waypoint-to-waypoint fallback: it is a routing failure, not a route.
   */
  private assertValidPath(path: unknown): asserts path is GhPath {
    const candidate = path as Partial<GhPath> | null;
    const geometry = candidate?.points;
    const coordinates = geometry?.coordinates;
    const validCoordinate = (coordinate: unknown): coordinate is number[] =>
      Array.isArray(coordinate)
      && coordinate.length >= 2
      && Number.isFinite(coordinate[0])
      && Number.isFinite(coordinate[1])
      && coordinate[0] >= -180 && coordinate[0] <= 180
      && coordinate[1] >= -90 && coordinate[1] <= 90
      && (coordinate.length < 3 || coordinate[2] === undefined || Number.isFinite(coordinate[2]));

    if (
      geometry?.type !== 'LineString'
      || !Array.isArray(coordinates)
      || coordinates.length < 2
      || !coordinates.every(validCoordinate)
      || !Number.isFinite(candidate?.distance)
      || !Number.isFinite(candidate?.time)
      || !Array.isArray(candidate?.bbox)
      || candidate.bbox.length !== 4
      || !candidate.bbox.every(Number.isFinite)
    ) {
      throw new GraphHopperError('GraphHopper returned an invalid route geometry.', 502);
    }
  }

  /** Health/metadata from GraphHopper `/info`. */
  async health(): Promise<RoutingHealth> {
    try {
      const info = await this.fetchInfo();
      return {
        available: true,
        // /info is the sole profile source: health never substitutes product defaults
        // or performs a route probe. Internal details (base URL, version, bbox) are
        // deliberately not exposed to public clients.
        profiles: this.extractInfoProfiles(info.profiles),
      };
    } catch (err: any) {
      this.logger.debug(`GraphHopper /info failed: ${err.message}`);
      return { available: false, profiles: [] };
    }
  }

  /**
   * Internal-only full metadata (version, bbox, base URL). Never exposed via
   * public endpoints; used for cache namespace derivation.
   */
  async graphMetadata(): Promise<{ version?: string; bbox?: number[] }> {
    try {
      const info = await this.fetchInfo();
      return {
        version: typeof info.version === 'string' ? info.version : undefined,
        bbox: Array.isArray(info.bbox) && info.bbox.every(Number.isFinite) ? info.bbox : undefined,
      };
    } catch (err: any) {
      this.logger.debug(`GraphHopper /info metadata failed: ${err.message}`);
      return {};
    }
  }

  private async fetchInfo(): Promise<GhInfoResponse> {
    const res = await fetch(`${this.baseUrl}/info`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      throw new Error(`GraphHopper /info returned ${res.status}`);
    }
    return (await res.json()) as GhInfoResponse;
  }

  /** Extract only usable names actually advertised by the live /info response. */
  private extractInfoProfiles(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const profiles: string[] = [];
    for (const profile of raw) {
      const name = profile && typeof profile === 'object'
        ? (profile as Record<string, unknown>).name
        : undefined;
      if (typeof name === 'string' && name.trim() && !profiles.includes(name.trim())) {
        profiles.push(name.trim());
      }
    }
    return profiles;
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return this.withCapacity(() =>
      fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.requestSignal(signal),
      }),
    );
  }

  /**
   * Acquire a GraphHopper slot. When the queue is full, reject with 503
   * (bounded waiting) instead of queueing indefinitely — the caller gets a
   * clear capacity signal and never piles up behind a saturated router.
   */
  private withCapacity<T>(fn: () => Promise<T>): Promise<T> {
    return this.semaphore.run(fn).catch((err) => {
      if (err instanceof SemaphoreBusyError) {
        throw new ServiceUnavailableException(
          'Routing capacity is exhausted, please retry shortly.',
        );
      }
      throw err;
    });
  }

  /** Client cancellation and the defensive GH timeout are both honoured. */
  private requestSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(30_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /** Translate a GraphHopper error body into a thrown Error with a message. */
  private throwIfError(json: GhError, status: number): void {
    if (status >= 400 || json.message) {
      const msg = json.message || `GraphHopper returned HTTP ${status}`;
      const hint = json.hints?.[0]?.message;
      throw new GraphHopperError(hint ? `${msg} (${hint})` : msg, status);
    }
  }
}

interface GhError {
  message?: string;
  hints?: { message?: string }[];
}

export class GraphHopperError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GraphHopperError';
  }
}

export type { GhPath, GhPoint };
