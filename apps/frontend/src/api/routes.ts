import api from './index';
import type { RouteResult, RoutingProfile } from './routing';

/** {lat, lon} pair (lat first — matches the /routes spec DTOs). */
export interface RoutePointDto {
  lat: number;
  lon: number;
}

/** Persisted route geometry + stats (opaque GeoJSON, kept intact). */
export interface RouteDataDto {
  geojson: object;
  distance: number;
  duration: number;
  ascend: number;
  descend: number;
}

export interface StoredRouteOptions {
  loop: boolean;
  optimize: boolean;
}

/** Body for `POST /api/routes` — persist a built route, get a shareable id. */
export interface CreateRouteDto {
  routeData: RouteDataDto;
  /** poi_uuid strings (poi_product.poi_uuid) — NOT integer ids. */
  pois: string[];
  profile: RoutingProfile;
  options: StoredRouteOptions;
  title?: string;
  startPoint: RoutePointDto;
  waypoints: RoutePointDto[];
}

export interface CreateRouteResponse {
  id: string;
  createdAt: string;
}

/**
 * Persist a route built on the map. Returns the shareable id.
 *
 * Logged-in users (JWT present) keep the route under their account; anonymous
 * visitors get userId=null but still receive a working share link.
 */
export const createRoute = async (dto: CreateRouteDto): Promise<CreateRouteResponse> => {
  const res = await api.post<CreateRouteResponse>('/api/routes', dto);
  return res.data;
};

/**
 * Build a CreateRouteDto from a live route + the POIs the user picked.
 *
 * `pois` come in as whatever the map holds (Poi objects with an `id` that is
 * actually the poi_uuid string at runtime — the API returns `poi_uuid AS id`).
 */
export function toCreateRouteDto(args: {
  route: RouteResult;
  poiUuids: string[];
  profile: RoutingProfile;
  startPoint: RoutePointDto;
  waypoints: RoutePointDto[];
  options?: Partial<StoredRouteOptions>;
  title?: string;
}): CreateRouteDto {
  const { route, poiUuids, profile, startPoint, waypoints, options, title } = args;
  return {
    routeData: {
      geojson: route.geojson,
      distance: route.distance,
      duration: route.duration,
      ascend: route.ascend,
      descend: route.descend,
    },
    // de-dup + drop empty, keep insertion order
    pois: Array.from(new Set(poiUuids.filter(Boolean))),
    profile,
    options: {
      loop: options?.loop ?? false,
      optimize: options?.optimize ?? false,
    },
    title,
    startPoint,
    waypoints,
  };
}
