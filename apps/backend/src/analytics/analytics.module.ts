import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AnalyticsEventEntity } from './entities/analytics-event.entity';
import { RouteFeedbackEntity } from './entities/route-feedback.entity';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

/**
 * Anonymous product analytics + route feedback.
 *
 * - Writes analytics events from routes/pois modules (record()).
 * - Owns route feedback + the admin summary.
 * - Pushes feedback + a daily digest to the admin Telegram (when
 *   ADMIN_TELEGRAM_CHAT_ID is set). Does NOT import RoutesModule — route
 *   existence is checked via DataSource to avoid a circular dependency.
 *
 * Imported by AppModule (controller) and by Routes/Pois modules (service).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AnalyticsEventEntity, RouteFeedbackEntity]),
    // UsersModule provides UsersService, which AdminGuard (used by the summary
    // / recompute endpoints) depends on.
    UsersModule,
  ],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
