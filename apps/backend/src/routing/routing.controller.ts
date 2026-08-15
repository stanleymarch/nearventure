import { Controller, Get, Post, Body, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RoutingService } from './routing.service';
import { RouteRequestDto, RoundTripRequestDto, PlanRequestDto, IsochroneRequestDto } from './dto/routing.dto';
import { Public } from '../auth/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';

/**
 * Public routing API. End-users need no account — this is the MVP core:
 * click two points on the map (or ask for a loop), get a real route back.
 *
 * Every GraphHopper-backed endpoint is protected by a per-IP fixed-window
 * rate limit (@RateLimit) and a global concurrency cap in GraphHopperClient
 * (ROUTING_MAX_CONCURRENCY) so public calls cannot saturate the router.
 */
@Public()
@ApiTags('routing')
@Controller('routing')
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  /** GraphHopper availability + supported profiles (used by the map UI). */
  @Get('health')
  health() {
    return this.routingService.health();
  }

  /** Calculate isochrone (reachable area) for map visualization and POI search. */
  @RateLimit('isochrone')
  @Post('isochrone')
  async isochrone(@Body() dto: IsochroneRequestDto) {
    if (!dto.point || !dto.profile || !dto.timeLimitMinutes) {
      throw new BadRequestException('point, profile and timeLimitMinutes are required.');
    }
    return this.routingService.isochrone(dto.point, dto.profile, dto.timeLimitMinutes);
  }

  /** Scenario A — point-to-point route. */
  @RateLimit('route')
  @Post('route')
  async route(@Body() dto: RouteRequestDto) {
    if (!dto.points || dto.points.length < 2) {
      throw new BadRequestException('At least 2 points are required.');
    }
    return this.routingService.pointToPoint(dto);
  }

  /** Scenario C — generate a round-trip loop. */
  @RateLimit('round-trip')
  @Post('round-trip')
  roundTrip(@Body() dto: RoundTripRequestDto) {
    return this.routingService.roundTrip(dto);
  }

  /** Scenario A/B — plan a route through selected POI waypoints.
   *  Options: { loop, optimize (TSP), alternatives }. */
  @RateLimit('plan')
  @Post('plan')
  plan(@Body() dto: PlanRequestDto) {
    return this.routingService.plan(dto);
  }
}
