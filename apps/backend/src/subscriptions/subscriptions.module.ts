import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';
import { TelegramChannelsService } from './telegram-channels.service';
import { NotificationService } from './notification.service';

/**
 * Подписки на каналы + единый notify-слой исходящих уведомлений.
 *
 * `NotificationService` — архитектурный шов под очередь (ADR-010): все исходящие
 * Telegram-сообщения идут через него. Сегодня — синхронные вызовы с ретраями,
 * завтра — BullMQ (тело методов меняется в одной точке).
 *
 * Импортируется `AppModule` (контроллер/сервис подписок) и `AnalyticsModule`
 * (пуш дайджеста и отзывов в админ-чат через `NotificationService`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionEntity])],
  providers: [SubscriptionsService, TelegramChannelsService, NotificationService],
  exports: [SubscriptionsService, TelegramChannelsService, NotificationService],
})
export class SubscriptionsModule {}
