import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

/** Metadata key carrying the rate-limit action name for a handler. */
export const RATE_LIMIT_ACTION_KEY = 'rate_limit_action';

/**
 * Apply a fixed-window per-IP rate limit to a public endpoint.
 *
 * @param action Named limit bucket (see HttpRateLimiter), e.g. 'route'.
 */
export function RateLimit(action: string) {
  return applyDecorators(
    SetMetadata(RATE_LIMIT_ACTION_KEY, action),
    UseGuards(RateLimitGuard),
  );
}
