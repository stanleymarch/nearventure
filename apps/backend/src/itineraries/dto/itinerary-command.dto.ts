import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, registerDecorator, ValidateNested, ValidationArguments, ValidationOptions } from 'class-validator';
import type { StopPace, VisitMode } from '../itinerary.types';
import { PointDto } from './create-itinerary.dto';

function IsConditionalCustomMinutes(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => registerDecorator({
    name: 'isConditionalCustomMinutes', target: target.constructor, propertyName: propertyName.toString(), options,
    validator: {
      validate(value: unknown, args: ValidationArguments): boolean {
        const mode = (args.object as SetVisitModeCommandDto).mode;
        return mode === 'custom'
          ? Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 480
          : value === undefined;
      },
      defaultMessage(): string { return 'customVisitMinutes is required only for custom mode and must be an integer between 1 and 480'; },
    },
  });
}

export class CommandDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsUUID() commandId: string;
}
export class AddPoiCommandDto extends CommandDto { @IsString() poiId: string; }
export class RemovePlaceCommandDto extends CommandDto { @IsString() placeId: string; }
export class SetVisitModeCommandDto extends CommandDto {
  @IsString() placeId: string;
  @IsIn(['pass_by', 'glance', 'visit', 'custom']) mode: VisitMode;
  @Type(() => Number) @IsConditionalCustomMinutes() customVisitMinutes?: number;
}
export class SetLockedCommandDto extends CommandDto { @IsString() placeId: string; @IsBoolean() locked: boolean; }
export class ReorderCommandDto extends CommandDto { @IsArray() @IsString({ each: true }) orderedPlaceIds: string[]; }
/** Category preferences rank automatic candidates; they are not hard constraints. */
export class AutoFillCommandDto extends CommandDto {
  /** @deprecated Compatibility input; treated as preferredCategories. */
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) preferredCategories?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) seed?: number;
  @IsOptional() @IsIn(['balanced', 'more_places', 'scenic', 'training']) preset?: 'balanced' | 'more_places' | 'scenic' | 'training';
}
export class SelectAlternativeCommandDto extends CommandDto { @IsString() alternativeId: string; }
/** Permanently removes an unpublished draft. The published route snapshot is never affected. */
export class DiscardItineraryCommandDto extends CommandDto {}
export class ApplySmartFixCommandDto extends CommandDto { @IsString() suggestionId: string; }
/** Accept a previewed `additions` suggestion; adds the POI and replans. */
export class AcceptAdditionCommandDto extends CommandDto { @IsString() suggestionId: string; }
/** Preview swap options for a single place. */
export class ReplacePlaceCommandDto extends CommandDto { @IsString() placeId: string; }
/** Apply a previewed replacement (suggestionId encodes the target place). */
export class AcceptReplacementCommandDto extends CommandDto { @IsString() suggestionId: string; }
/** Batch route-impact preview for a POI shop (read-only). */
export class RouteImpactDto { @IsArray() @IsString({ each: true }) poiIds: string[]; }

/** Narrow settings command used by manual clients; it never changes Places. */
export class UpdateSettingsCommandDto extends CommandDto {
  @IsOptional() @IsIn(['whole_trip', 'travel_only', 'unlimited']) budgetMode?: 'whole_trip' | 'travel_only' | 'unlimited';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) budgetMinutes?: number;
  @IsOptional() @IsBoolean() loop?: boolean;
  /** Open-route finish. Null explicitly clears it; non-null is valid only when the resulting route is linear. */
  @IsOptional() @ValidateNested() @Type(() => PointDto) finish?: PointDto | null;
  @IsOptional() @IsIn(['bike', 'mtb', 'foot', 'car', 'bike_touring', 'mtb_leisure', 'foot_scenic']) profile?: import('../../routing/routing.types').RoutingProfile;
  @IsOptional() @IsIn(['pass_by', 'quick', 'normal']) stopPace?: StopPace;
}
