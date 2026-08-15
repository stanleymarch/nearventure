import {
  IsArray,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { RoutingProfile } from '../../routing/routing.types';

/** A single [lat, lon] coordinate (note: lat FIRST here, matching the spec). */
export class RoutePointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lon: number;
}

/**
 * Options for `POST /api/routes/generate`.
 *
 * Mirrors routing `PlanOptions` plus an optional `budget_minutes` (auto-pick
 * POIs to fit a time budget — implemented in a later phase; accepted now for
 * forward compatibility).
 */
export class GenerateRouteOptionsDto {
  @IsOptional() @IsBoolean() loop?: boolean;
  @IsOptional() @IsBoolean() optimize?: boolean;
  /** Future: auto-select POIs within this time budget. */
  @IsOptional() @IsNumber() @Min(5) @Max(600) budget_minutes?: number;
}

/**
 * `POST /api/routes/generate` — build a route through POI waypoints.
 *
 * This is a thin wrapper over `RoutingService.plan()`: it accepts the same
 * { start, waypoints, profile, options } shape as routing/plan, but lives under
 * /routes so the frontend spec (`docs/.../landing-and-route-details-design.md`
 * §3.1) has a single entry point for "build a route". The result is NOT
 * persisted — call `POST /api/routes` to save it and get a shareable id.
 */
export class GenerateRouteDto {
  @ValidateNested()
  @Type(() => RoutePointDto)
  start: RoutePointDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoutePointDto)
  waypoints: RoutePointDto[];

  @IsString()
  profile: RoutingProfile;

  @IsOptional()
  @ValidateNested()
  @Type(() => GenerateRouteOptionsDto)
  options?: GenerateRouteOptionsDto;
}
