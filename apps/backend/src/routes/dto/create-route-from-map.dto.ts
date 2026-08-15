import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ROUTING_PROFILES } from '../../routing/routing.types';

/** {lat, lon} pair (lat first — matches the /routes spec DTOs). */
export class MapPointDto {
  @IsOptional()
  @IsNumber()
  @ApiProperty({ description: 'Latitude.' })
  lat?: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ description: 'Longitude.' })
  lon?: number;
}

/**
 * Body of `POST /api/routes` — persist a route built on the map.
 *
 * Bounded so a single request cannot carry an unbounded GeoJSON/POI payload
 * (release CRIT B-03: JSON-poisoning / OOM via huge `pois` or `routeData`).
 * `whitelist: true` + `forbidNonWhitelisted: true` on the global pipe reject
 * unknown fields, and the JSON body parser in `main.ts` enforces an overall
 * size limit on top of these per-field caps.
 */
export class CreateRouteFromMapDto {
  @IsObject()
  @IsOptional()
  @ApiProperty({ description: 'Route geometry + stats (kept intact).' })
  routeData?: {
    geojson?: unknown;
    distance?: number;
    duration?: number;
    ascend?: number;
    descend?: number;
  };

  /** poi_uuid strings, or pre-enriched snapshot objects (max 1000). */
  @IsArray()
  @ArrayMaxSize(1000)
  @IsOptional()
  @ApiProperty({ description: 'Selected POI ids (poi_uuid) or snapshot objects.' })
  pois?: Array<string | Record<string, unknown>>;

  @IsIn(ROUTING_PROFILES)
  @IsOptional()
  @ApiProperty({ enum: ROUTING_PROFILES, description: 'Transport mode.' })
  profile?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @ApiProperty({ description: 'Custom route title (max 200 chars).' })
  title?: string;

  @IsObject()
  @IsOptional()
  @ApiProperty({ description: 'Route options (loop/optimize).' })
  options?: {
    loop?: boolean;
    optimize?: boolean;
  };

  @IsOptional()
  @ValidateNested()
  @Type(() => MapPointDto)
  @ApiProperty({ description: 'Start point (kept for forward compatibility).' })
  startPoint?: MapPointDto;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsOptional()
  @ApiProperty({ description: 'Waypoints (kept for forward compatibility).' })
  waypoints?: Array<Record<string, unknown>>;
}
