import {
  IsArray,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ROUTING_PROFILES, RoutingProfile } from '../routing.types';

/**
 * Coordinate-array caps for the public routing endpoints (DoS guard). A 5 MB
 * accepted body must not translate into an unbounded point list forwarded to
 * GraphHopper — oversize arrays are rejected by DTO validation (400) before
 * any outbound routing call.
 */
export const MAX_ROUTE_POINTS = 100;
export const MAX_PLAN_WAYPOINTS = 50;

/** A single [lon, lat] coordinate. */
export class PointDto {
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;
}

/**
 * `POST /api/routing/route` — point-to-point (scenario A).
 * Points are [lon,lat] pairs; at least two required.
 */
export class RouteRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_ROUTE_POINTS)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points: PointDto[];

  @IsString()
  profile: RoutingProfile;

  static isValidProfile(p: string): p is RoutingProfile {
    return (ROUTING_PROFILES as readonly string[]).includes(p);
  }
}

/**
 * `POST /api/routing/round-trip` — scenario C ("I have ~this much distance").
 */
export class RoundTripRequestDto {
  @ValidateNested()
  @Type(() => PointDto)
  start: PointDto;

  @IsString()
  profile: RoutingProfile;

  /** Approximate loop length in meters. Default 10 km, capped at 200 km. */
  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(200_000)
  distance?: number;

  /** Optional randomness seed to get a different variant of the loop. */
  @IsOptional()
  @IsNumber()
  seed?: number;

  /**
   * Number of loop variants to generate. Each variant uses a different seed,
   * so they explore different road networks. The best (lowest self-overlap)
   * is returned. Default 1.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8)
  variants?: number;

  /**
   * If true, include up to 2 alternative loops in the response (rank 2 and 3).
   */
  @IsOptional()
  @IsBoolean()
  includeAlternatives?: boolean;
}

/**
 * `POST /api/routing/plan` — unified scenario A/B planning.
 *
 * Routes from `start` through the selected POI `waypoints`. Options control
 * loop closure (return to start), TSP reordering, and (for a single waypoint)
 * alternative distinct paths.
 */
export class PlanOptionsDto {
  /** Return to the start point (closed tour). */
  @IsOptional() @IsBoolean() loop?: boolean;
  /** Reorder waypoints for a shorter tour (nearest-neighbour + 2-opt). */
  @IsOptional() @IsBoolean() optimize?: boolean;
  /** Request distinct A→B variants (single waypoint only). */
  @IsOptional() @IsBoolean() alternatives?: boolean;
  /** Number of variants (2–4). */
  @IsOptional() @IsNumber() @Min(2) @Max(4) maxAlternatives?: number;
  /** Time budget in minutes. If set and the resulting route exceeds it,
   *  the endpoint returns a friendly error with the overage. */
  @IsOptional() @IsNumber() @Min(5) @Max(480) timeBudgetMinutes?: number;
  /** Enrich the route with POIs near user-selected waypoints that fit in
   *  the remaining budget. Suggested POIs returned in `suggestedPois`. */
  @IsOptional() @IsBoolean() enrichWithPois?: boolean;
  /** Category filter for enrichment (comma-separated). */
  @IsOptional() @IsString() enrichCategories?: string;
  /** Buffer (meters) around route for POI search. Default 1000. */
  @IsOptional() @IsNumber() @Min(100) @Max(5000) enrichBufferMeters?: number;
}

export class PlanRequestDto {
  @ValidateNested()
  @Type(() => PointDto)
  start: PointDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PLAN_WAYPOINTS)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  waypoints: PointDto[];

  @IsString()
  profile: RoutingProfile;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlanOptionsDto)
  options?: PlanOptionsDto;
}

/** `POST /api/routing/isochrone` — calculate reachable area for map viz. */
export class IsochroneRequestDto {
  @ValidateNested()
  @Type(() => PointDto)
  point: PointDto;

  @IsString()
  profile: RoutingProfile;

  @IsNumber()
  @Min(1)
  @Max(480) // up to 8 hours
  timeLimitMinutes: number;

  @IsOptional()
  @IsString()
  categories?: string; // comma-separated POI categories

  @IsOptional()
  @IsBoolean()
  loop?: boolean; // return to start (default true)
}
