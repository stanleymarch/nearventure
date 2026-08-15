import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Headers,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Bot } from 'grammy';
import { BotContext } from './types';
import { TelegramAuthService } from './telegram-auth.service';
import { LastRouteService } from './last-route.service';
import { SessionService } from './session.service';
import { ItineraryDraftService } from '../itineraries/itinerary-draft.service';
import { ItineraryOwnerService } from '../itineraries/itinerary-owner.service';
import type { CachedRoute } from './last-route.service';
import { guideRouteFromCache, guideRouteFromDraft } from './guide-route.boundary';
import { isWebhookMode } from '../common/app-config';

/**
 * Telegram webhook endpoint + Mini App ↔ Bot bridge.
 *
 *  - POST /api/telegram/webhook   Telegram update ingress (HMAC by header)
 *  - GET  /api/telegram/health    Liveness + bot config check
 *  - GET  /api/telegram/last-route  Mini App reads the bot's last built
 *    route for its originating chatId (initData in query, HMAC-validated)
 *  - POST /api/telegram/guide/start  Mini App requests to start the guided
 *    walk-through (guide handler seeds the session, returns "ok")
 *
 * The bridge endpoints are the missing link that the original RoutePreviewView
 * tried to substitute by re-running GraphHopper with just query params —
 * which dropped the ordered POI list. The Mini App now reads the same data
 * the bot's chat message has, with the same TTL.
 */
@ApiTags('telegram')
@Controller('telegram')
export class TelegramController {
  constructor(
    @Inject('TELEGRAM_BOT') private readonly bot: Bot<BotContext> | null,
    private readonly auth: TelegramAuthService,
    private readonly lastRoute: LastRouteService,
    private readonly sessions: SessionService,
    private readonly drafts: ItineraryDraftService,
    private readonly owners: ItineraryOwnerService,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Body() update: any,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ) {
    // Release CRIT (B-04): the webhook secret MUST be enforced. In webhook
    // mode anyone who knows the URL can POST fake updates — pollute
    // analytics, spam the rate limiter, trigger bot side effects.
    //
    //  - Webhook mode + no secret configured → refuse (fail closed): never
    //    accept unauthenticated updates because the operator forgot the env.
    //  - Secret configured + missing/forged header → 401, update NOT handled.
    //  - Polling mode (dev) → no webhook URL exists to spoof; allowed.
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (isWebhookMode() && !expected) {
      throw new ServiceUnavailableException('Webhook secret not configured');
    }
    if (expected && (!secretToken || !this.constantTimeEqual(secretToken, expected))) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    if (!this.bot) return { ok: false, error: 'Bot not initialized' };
    await this.bot.handleUpdate(update);
    return { ok: true };
  }

  /** Constant-time string comparison to avoid timing leaks on secret check. */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      // crypto.timingSafeEqual works on Buffers.
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      return bufA.length === bufB.length && require('node:crypto').timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  @Get('health')
  health() {
    // Liveness only: no bot token, domain or config details are exposed publicly.
    return { status: 'ok' };
  }

  /**
   * Mini App → backend: hand over the bot's last built route for the chat.
   * HMAC-validates `initData` and returns the cached route (or 404 if
   * the cache is empty / expired).
   *
   * No auth beyond Telegram's HMAC: the request is "Telegram says this user
   * (chatId) wants their last route". We don't ask the user for a token;
   * the Mini App runs in their Telegram session.
   */
  @Get('last-route')
  async getLastRoute(
    @Query('initData') queryInitData?: string,
    @Headers('x-telegram-initdata') headerInitData?: string,
  ) {
    const initData = headerInitData || queryInitData;
    if (!initData) throw new BadRequestException('initData is required');
    const parsed = this.auth.validate(initData);
    if (!parsed?.chatId) throw new UnauthorizedException('Invalid initData');

    const route = await this.lastRoute.get(parsed.chatId);
    if (!route) {
      return { ok: false, error: 'no-route' };
    }
    return { ok: true, route };
  }

  /**
   * Mini App → backend: "I'm on the preview screen, start the guide for
   * the user". The Mini App posts initData; we seed the session's
   * `lastRoute` + `guideIndex` so that the next message the user sends
   * (or the next /guide callback) picks up at the right point.
   *
   * Note: the guide actually drives via inline messages the bot sends; the
   * Mini App just primes the state and then closes, so the user lands in
   * the bot's chat and the first location-message is already waiting.
   */
  @Post('guide/start')
  async startGuide(@Body() body: { initData?: string }) {
    if (!body?.initData) throw new BadRequestException('initData is required');
    const parsed = this.auth.validate(body.initData);
    if (!parsed?.chatId) throw new UnauthorizedException('Invalid initData');
    const cachedRoute = await this.lastRoute.get(parsed.chatId);
    if (!cachedRoute) return { ok: false, error: 'no-route' };
    const route = guideRouteFromCache(cachedRoute);
    if (!route || !await this.seedGuide(parsed.chatId, parsed.user, route)) {
      return { ok: false, error: 'unready-route' };
    }
    return { ok: true, route };
  }

  /** Canonical Mini App handoff: route data is derived only from an owned draft. */
  @Post('guide/start-draft')
  async startGuideFromDraft(@Body() body: { initData?: string; draftId?: string; expectedVersion?: number }) {
    const allowed = new Set(['initData', 'draftId', 'expectedVersion']);
    if (!body || Object.keys(body).some((key) => !allowed.has(key))) throw new BadRequestException('Only initData, draftId and expectedVersion are allowed');
    if (!body.initData || !body.draftId || !Number.isSafeInteger(body.expectedVersion)) throw new BadRequestException('initData, draftId and expectedVersion are required');
    const parsed = this.auth.validate(body.initData);
    if (!parsed?.chatId || !parsed.user?.id) throw new UnauthorizedException('Invalid initData');

    // The signed Telegram user is the sole owner and chat authority.
    const draft = await this.drafts.get(this.owners.forTelegramUser(parsed.user.id).key, body.draftId);
    if (draft.version !== body.expectedVersion) throw new ConflictException('stale-draft');
    // This shared boundary filters included children, assigns their canonical
    // order, and completes validation before cache/session side effects.
    const route = guideRouteFromDraft(draft);
    if (!route) return { ok: false, error: 'unready-route' };

    await this.lastRoute.set(parsed.chatId, route);
    await this.seedGuide(parsed.chatId, parsed.user, route);
    return { ok: true };
  }

  private async seedGuide(chatId: number, user: { first_name?: string; username?: string } | null, route: CachedRoute): Promise<boolean> {
    // Keep this guard here as well as at endpoint boundaries: this helper sends
    // locations and must remain safe if a future caller bypasses a controller.
    const validatedRoute = guideRouteFromCache(route);
    if (!validatedRoute) return false;

    const s = this.sessions.get(chatId, user ? { id: chatId, first_name: user.first_name, username: user.username } : undefined);
    route = validatedRoute;
    s.lastRoute = { geojson: route.geojson as any, distance: route.distance, duration: route.duration, ascend: route.ascend, descend: route.descend, profile: route.profile as any, pois: route.pois.map(({ order: _order, ...poi }) => poi) };
    s.guideIndex = 0;
    this.sessions.set(chatId, s);
    if (!this.bot) return true;
    try {
      await this.bot.api.sendMessage(chatId, `🧭 <b>Экскурсия начинается!</b>\n\n📍 ${route.pois.length} точек\n⏱ ~${Math.round(route.duration / 60)} минут\n\nНажимайте «Я на месте» на каждой точке — я расскажу о месте и отправлю следующую координату.`, { parse_mode: 'HTML' });
      const first = route.pois[0];
      if (first) await this.bot.api.sendLocation(chatId, first.lat, first.lon, { reply_markup: { inline_keyboard: [
        [{ text: '✅ Я на месте', callback_data: 'guide:at:0' }],
        [{ text: '⏭ Пропустить', callback_data: 'guide:skip:0' }],
      ] } });
      s.step = 'GUIDE_WALKING';
      this.sessions.set(chatId, s);
    } catch (e: any) {
      // Best effort: the seeded session permits a restart in chat.
      // eslint-disable-next-line no-console
      console.warn('[tg] guide start message failed:', e.message);
    }
    return true;
  }
}
