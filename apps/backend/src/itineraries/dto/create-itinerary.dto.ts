import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { BudgetMode, StopPace, TripIntent } from '../itinerary.types';
import type { RoutingProfile } from '../../routing/routing.types';

export class PointDto {
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lon: number;
}
export class CreateItineraryDto {
  @ValidateNested() @Type(() => PointDto) start: PointDto;
  @IsOptional() @ValidateNested() @Type(() => PointDto) finish?: PointDto;
  @IsIn(['bike', 'mtb', 'foot', 'car', 'bike_touring', 'mtb_leisure', 'foot_scenic']) profile: RoutingProfile;
  @IsBoolean() loop: boolean;
  @IsOptional() @IsIn(['balanced', 'more_places', 'scenic', 'training']) preset?: 'balanced' | 'more_places' | 'scenic' | 'training';
  @IsOptional() @IsIn(['auto_budget', 'destination', 'manual_collection']) intent?: TripIntent;
  @IsOptional() @IsIn(['pass_by', 'quick', 'normal']) stopPace?: StopPace;
  @IsOptional() @IsIn(['whole_trip', 'travel_only', 'unlimited']) budgetMode?: BudgetMode;
  /** A finite budget is required unless the caller explicitly selects unlimited. */
  @ValidateIf((draft: CreateItineraryDto) => draft.budgetMode !== 'unlimited')
  @IsDefined() @Type(() => Number) @IsInt() @Min(1) @Max(1440)
  budgetMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1440) reserveMinutes?: number;
}
