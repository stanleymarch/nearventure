import { IsOptional, IsString, IsObject, MaxLength, IsUrl } from 'class-validator';

/**
 * DTO for admin POI editing (PATCH /api/admin/pois/:id).
 * All fields are optional — only provided fields are upserted.
 * Pass explicit `null` to clear a previously overridden field
 * (revert to pipeline value).
 */
export class UpdatePoiDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  display_name?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  image_url?: string | null;

  @IsOptional()
  @IsObject()
  image_attribution?: Record<string, any> | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  osm_contributor?: string | null;
}
