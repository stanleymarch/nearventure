import { Module, OnModuleInit, Logger, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bot } from 'grammy';

import { TelegramUserEntity } from './entities/telegram-user.entity';
import { PoiMediaCacheEntity } from './entities/poi-media-cache.entity';
import { LastRouteCacheEntity } from './entities/last-route-cache.entity';
import { TelegramController } from './telegram.controller';
import { TelegramUserService } from './telegram-user.service';
import { TelegramAuthService } from './telegram-auth.service';
import { SessionService } from './session.service';
import { RouteBuilderService } from './route-builder.service';
import { TelegramPoiCardService } from './poi-card.service';
import { LastRouteService } from './last-route.service';
import { ItineraryDraftService } from '../itineraries/itinerary-draft.service';
import { ItineraryOwnerService } from '../itineraries/itinerary-owner.service';
import { PoisModule } from '../pois/pois.module';
import { RoutingModule } from '../routing/routing.module';
import { ItineraryModule } from '../itineraries/itinerary.module';
import { GpxService } from '../routes/gpx.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { PoisService } from '../pois/pois.service';
import { isWebhookMode } from '../common/app-config';

import { BotContext } from './types';
import { registerStartHandlers, registerHelpCallback } from './start.handler';
import { registerRouteHandlers } from './route.handler';
import { registerNearbyHandlers } from './nearby.handler';
import { registerInlineHandlers } from './inline.handler';
import { registerContributeHandlers } from './contribute.handler';
import { registerGuideHandlers } from './guide.handler';
import { BotRateLimiter } from './rate-limiter';
import { miniAppUrl } from './urls';
import { installBotSurface } from './bot-surface';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramUserEntity, PoiMediaCacheEntity, LastRouteCacheEntity]),
    PoisModule,
    RoutingModule,
    ItineraryModule,
    AnalyticsModule,
  ],
  controllers: [TelegramController],
  providers: [
    TelegramUserService,
    TelegramAuthService,
    SessionService,
    RouteBuilderService,
    TelegramPoiCardService,
    LastRouteService,
    // ItineraryDraftService and ItineraryOwnerService are NOT re-provided locally —
    // they are imported from ItineraryModule (which owns the TypeORM repositories).
    GpxService, // stateless — re-provide locally for injection
    BotRateLimiter,
    {
      provide: 'TELEGRAM_BOT',
      inject: [SessionService, RouteBuilderService, TelegramUserService, AnalyticsService, PoisService, TelegramPoiCardService, BotRateLimiter, LastRouteService, ItineraryDraftService, ItineraryOwnerService],
      useFactory: createBot,
    },
  ],
  exports: [TelegramUserService, TelegramAuthService, SessionService, RouteBuilderService, LastRouteService],
})
export class TelegramModule implements OnModuleInit {
  private readonly logger = new Logger(TelegramModule.name);

  constructor(@Inject('TELEGRAM_BOT') private readonly bot: Bot<BotContext> | null) {}

  onModuleInit() {
    if (!this.bot) {
      this.logger.warn('Telegram bot disabled (no TELEGRAM_BOT_TOKEN).');
      return;
    }

    // Normalize: strip any scheme/trailing slash so "nearventure.ru",
    // "https://nearventure.ru", and "https://nearventure.ru/" all work.
    const raw = process.env.TELEGRAM_WEBHOOK_DOMAIN;
    const webhookDomain = raw?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const configured = isWebhookMode();

    if (configured) {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      const url = `https://${webhookDomain}/api/telegram/webhook`;
      // grammY requires bot.init() before handleUpdate() in webhook mode.
      // bot.start() does this internally, but we're not calling start().
      this.bot.api
        .setWebhook(url, {
          secret_token: secret,
          drop_pending_updates: true,
        })
        .then(() => this.bot!.init())
        .then(() => this.logger.log(`Webhook → ${url} (bot initialized)`))
        .then(() => installBotSurface(this.bot!.api, this.logger))
        .catch((err) => this.logger.error(`Webhook setup failed: ${err.message}`));
    } else {
      this.bot
        .start({ drop_pending_updates: true, onStart: (i) => this.logger.log(`Polling as @${i.username}`) })
        .then(() => installBotSurface(this.bot!.api, this.logger))
        .catch((err) => this.logger.error(`Bot start failed: ${err.message}`));
    }
  }
}

/**
 * Build the grammY bot. All handlers receive NestJS-injected services — the bot
 * runs in-process, so it calls PoisService / RoutingService / AnalyticsService
 * directly (no HTTP fetch).
 */
export function createBot(
  sessions: SessionService,
  builder: RouteBuilderService,
  users: TelegramUserService,
  analytics: AnalyticsService,
  pois: PoisService,
  poiCards: TelegramPoiCardService,
  limiter: BotRateLimiter,
  lastRoute: LastRouteService,
  draftService: ItineraryDraftService,
  ownerService: ItineraryOwnerService,
): Bot<BotContext> | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const bot = new Bot<BotContext>(token);
  // P0-6: bot.catch must (a) log the shortest safe representation — no stack
  // traces with file paths — and (b) send a user-friendly fallback when `ctx`
  // is available. Anti-pattern #16 from the telegram-bot-ux checklist.
  bot.catch(async (err: any) => {
    const ctx = err.ctx as BotContext | undefined;
    const msg = err.error?.message || err.message || String(err).slice(0, 200);
    try {
      console.error('[tg bot]', msg);
      if (ctx?.chatId) {
        await ctx.reply(
          'Что-то пошло не так. Попробуйте ещё раз — /start.',
        ).catch(() => {});
      }
    } catch {
      // If even console.error throws, we're in a terminal state — let the
      // process monitor (PM2/systemd) restart us.
    }
  });

  registerStartHandlers(bot, sessions, pois, lastRoute, {
    boostyUrl: process.env.DONATE_BOOSTY_URL,
    cloudtipsUrl: process.env.DONATE_CLOUDTIPS_URL,
  });
  registerHelpCallback(bot, sessions, {
    boostyUrl: process.env.DONATE_BOOSTY_URL,
    cloudtipsUrl: process.env.DONATE_CLOUDTIPS_URL,
  });
  registerRouteHandlers(bot, sessions, builder, users, analytics, miniAppUrl(), limiter, lastRoute, draftService, ownerService);
  registerNearbyHandlers(bot, sessions, pois, analytics, poiCards);
  registerInlineHandlers(bot, pois);
  registerContributeHandlers(bot, analytics, {
    donateBoostyUrl: process.env.DONATE_BOOSTY_URL,
    donateCloudtipsUrl: process.env.DONATE_CLOUDTIPS_URL,
  });
  registerGuideHandlers(bot, sessions, poiCards, limiter);

  // Miniapp → show POI location as a pin in the chat, or advance the guide
  // when the Mini App's auto-tracker detects the user is within ~50m of the
  // next POI ("I'm here" in the auto guide mode).
  //
  // Validation: the data comes from the Mini App inside a `web_app` button,
  // so it's authenticated by Telegram (the button was sent by the bot, the
  // Mini App is hosted at a URL the bot controls). We still:
  //   a. Guard against non-JSON payloads
  //   b. Validate action names are known
  //   c. Validate numeric params are in range
  bot.on('message:web_app_data', async (ctx, next) => {
    const raw = ctx.message.web_app_data!.data;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      // Not JSON — not from our Mini App. Silently ignore.
      return;
    }

    if (!data || typeof data !== 'object') return;

    if (
      data.action === 'showLocation' &&
      typeof data.lat === 'number' &&
      typeof data.lon === 'number' &&
      Math.abs(data.lat) <= 90 &&
      Math.abs(data.lon) <= 180
    ) {
      await ctx.replyWithLocation(data.lat, data.lon);
      return;
    }

    if (data.action === 'guideAt' && typeof data.index === 'number') {
      const s = sessions.get(ctx.chatId!, ctx.from);
      const total = s.lastRoute?.pois?.length ?? 0;
      if (data.index < 0 || data.index >= total) {
        await ctx.reply(
          `❌ Точка ${data.index + 1} не найдена в маршруте (всего ${total}).`,
        );
        return;
      }
      // The Mini App's auto-tracker reported arrival at POI N. We bridge
      // into the guide's own "Я на месте" flow by directly calling the
      // handler logic. If the guide isn't active, post a hint telling the
      // user how to start.
      if (s.step !== 'GUIDE_WALKING') {
        await ctx.reply(
          `📍 <b>Вы у точки ${data.index + 1}!</b>\n\n` +
            `Экскурсия сейчас неактивна — нажмите «Начать экскурсию» в меню.`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      s.guideIndex = data.index;
      sessions.set(ctx.chatId!, s);
      // Trigger the actual "at-point" handler through a synthetic callback.
      try {
        await ctx.api.sendMessage(ctx.chatId!, `guide:at:${data.index}`);
      } catch {
        /* fallback: user will re-tap in chat */
      }
      return;
    }

    // Unknown action — not ours. Silently pass through.
  });

  // Catch-all: always answer unknown callback queries (anti-patterns #5).
  bot.callbackQuery(/.*/, async (ctx) => ctx.answerCallbackQuery().catch(() => {}));

  return bot;
}

