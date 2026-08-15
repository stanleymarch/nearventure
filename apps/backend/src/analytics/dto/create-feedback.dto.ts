import {
  IsInt,
  IsString,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

/**
 * `POST /api/routes/:routeId/feedback` — public feedback on a shareable route.
 *
 * Rating is the only required field. The OSM-contribution questions are
 * optional but feed the "public-good impact" metric in the admin summary.
 *
 * `anonymousId` (front localStorage UUID) is used to dedup: one review per
 * anonymous visitor per route.
 */
export class CreateFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;

  /** "Did you contribute to OSM / other open-data services?" */
  @IsOptional()
  @IsBoolean()
  osmContributor?: boolean;

  /** "Do you plan to contribute / any note about open data?" */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  osmContributionNote?: string;

  /** Front localStorage UUID. Optional but enables dedup. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  anonymousId?: string;
}
