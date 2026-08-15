import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PoisModule } from '../pois/pois.module';
import { RoutingModule } from '../routing/routing.module';
import { RoutesModule } from '../routes/routes.module';
import { TelegramAuthService } from '../telegram/telegram-auth.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { ItineraryScoreService } from './itinerary-score.service';
import { ItineraryCleanupService } from './itinerary-cleanup.service';
import { ItineraryController } from './itinerary.controller';
import { ItineraryDraftService } from './itinerary-draft.service';
import { ItineraryOwnerService } from './itinerary-owner.service';
import { PlaceClusteringService } from './place-clustering.service';
import { VisitTimeService } from './visit-time.service';
import { ItineraryCommandEntity } from './entities/itinerary-command.entity';
import { ItineraryDraftEntity } from './entities/itinerary-draft.entity';
import { GraphHopperWalkabilityService } from './graphhopper-walkability.service';
import { AutoItineraryOptimizerService } from './auto-itinerary-optimizer.service';
import { LocalityGuardService } from './locality-guard.service';
import { SelectionDiagnosticsLogger } from './selection-diagnostics.logger';
import { RouteCostEvaluatorService } from './route-cost-evaluator.service';
import { RouteCostCacheService } from './route-cost-cache.service';
import { OptimizerSearchService } from './optimizer-search.service';
import { GraphVersionProvider } from './graph-version.provider';
import { ItineraryQualityGateService } from './itinerary-quality-gate.service';
@Module({
  // TelegramModule is intentionally NOT imported here — it would create a
  // circular dependency (TelegramModule imports ItineraryModule for bot route
  // handlers). Instead, TelegramAuthService is registered as a local provider
  // since it is stateless (only reads TELEGRAM_BOT_TOKEN from env).
  imports: [TypeOrmModule.forFeature([ItineraryDraftEntity, ItineraryCommandEntity]), PoisModule, RoutingModule, RoutesModule],
  controllers: [ItineraryController],
  providers: [AutoItineraryOptimizerService, GraphHopperWalkabilityService, ItineraryBudgetService, ItineraryCleanupService, ItineraryDraftService, ItineraryOwnerService, ItineraryScoreService, PlaceClusteringService, VisitTimeService, TelegramAuthService, LocalityGuardService, SelectionDiagnosticsLogger, RouteCostEvaluatorService, RouteCostCacheService, OptimizerSearchService, GraphVersionProvider, ItineraryQualityGateService],
  exports: [ItineraryBudgetService, ItineraryDraftService, ItineraryOwnerService, PlaceClusteringService, VisitTimeService],
})
export class ItineraryModule {}
