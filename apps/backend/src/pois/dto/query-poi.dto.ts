import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { POI_CATEGORIES } from '../entities/poi.entity';

/**
 * Parse a boolean query param that arrives as a string ("true"/"false"/"1"/"0").
 * `class-transformer`'s `@Type(() => Boolean)` would coerce any non-empty
 * string (incl. "false") to true, so we transform explicitly.
 */
function toBool({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1' || value === 1;
}

/**
 * Query params for `GET /api/pois`.
 *
 * Filters:
 *  - category: one or multiple (comma-separated)
 *  - hasDescription: only POIs with a non-empty description
 *  - hasPhoto: only POIs with a non-empty image_url
 *  - search:  substring match in name or description
 *  - heritage: filter by heritage significance (federal,regional,local,all)
 *  - region: reserved for reverse-geocoded region filter (no backing column yet)
 *  - lat,lng,radius: spatial filter (radius in meters, max ~500 km)
 *  - bbox: "minLng,minLat,maxLng,maxLat"
 *  - limit:   max results per page (capped at 200)
 *  - offset:  pagination offset
 */
export class QueryPoiDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(toBool)
  hasDescription?: boolean;

  @IsOptional()
  @Transform(toBool)
  hasPhoto?: boolean;

  /** Administrative-location filters (poi_product.region/district/city,
   * populated by the collector's admin-boundary step since 2026-07-07). */
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  city?: string;

  /** Century filter (comma-separated, e.g. '19,20' → XIX + XX века).
   *  Converts to WHERE ((year-1)/100+1) IN (19,20). */
  @IsOptional()
  @IsString()
  century?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  heritage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  /** Meters. Max ~500 km. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500_000)
  radius?: number;

  /** "minLng,minLat,maxLng,maxLat" */
  @IsOptional()
  @IsString()
  bbox?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  /** Origin pipeline filter: comma-separated (osm,egrkn,wikivoyage). */
  @IsOptional()
  @IsString()
  source?: string;

  /** Sort order: 'popularity' (popularity_score DESC) or 'name' (name ASC).
   *  Omit for the default (poi_uuid DESC). */
  @IsOptional()
  @IsString()
  sort?: 'popularity' | 'name';
}

export function isValidCategory(value?: string): boolean {
  return !!value && (POI_CATEGORIES as readonly string[]).includes(value);
}