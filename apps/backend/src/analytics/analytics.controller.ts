import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

/**
 * Analytics + feedback API.
 *
 * - Feedback is public (anyone with a share link can rate a route).
 * - The summary/recompute endpoints are admin-only (JwtAuth + AdminGuard).
 */
@ApiTags('analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Rate a stored route (the /route/:id share page's feedback form). */
  @Public()
  @Post('routes/:routeId/feedback')
  @HttpCode(HttpStatus.CREATED)
  createFeedback(
    @Param('routeId') routeId: string,
    @Body() dto: CreateFeedbackDto,
    @Headers('x-anonymous-id') anon?: string,
  ) {
    const anonId = anon && anon.length <= 40 ? anon : null;
    return this.analytics.createFeedback(routeId, dto, anonId);
  }

  /** Product-analytics summary for the admin dashboard (auth: admin). */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('analytics/summary')
  summary() {
    return this.analytics.getSummary();
  }

  /** Manually trigger a popularity recompute (auth: admin). */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('analytics/recompute')
  @HttpCode(HttpStatus.OK)
  recompute() {
    return this.analytics.recomputePopularity();
  }
}
