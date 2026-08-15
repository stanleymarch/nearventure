import { Module, forwardRef } from '@nestjs/common';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';
import { GraphHopperClient } from './graphhopper.client';
import { LoopQualityService } from './loop-quality.service';
import { PoisModule } from '../pois/pois.module';
import { HttpRateLimiter } from '../common/rate-limit/http-rate-limiter';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';

@Module({
  imports: [forwardRef(() => PoisModule)],
  controllers: [RoutingController],
  providers: [GraphHopperClient, LoopQualityService, RoutingService, HttpRateLimiter, RateLimitGuard],
  exports: [RoutingService, GraphHopperClient, LoopQualityService],
})
export class RoutingModule {}
