import { randomUUID } from 'node:crypto';
import { Bot, InputFile } from 'grammy';
import type { InlineKeyboardButton } from '@grammyjs/types';
import { BotContext } from './types';
import { SessionService } from './session.service';
import { RouteBuilderService } from './route-builder.service';
import { TelegramUserService } from './telegram-user.service';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  CB,
  TIMES,
  CATEGORIES,
  keyboard,
  wizardEscapeRow,
  KIROV_CENTER,
  esc,
  safeEdit,
} from './keyboards';
import { BotSession, Transport } from './session';
import { routeSummaryHtml, fmtDistance } from './format';
import { BotRateLimiter } from './rate-limiter';
import { LastRouteService } from './last-route.service';
import { ItineraryDraftService } from '../itineraries/itinerary-draft.service';
import { ItineraryOwnerService } from '../itineraries/itinerary-owner.service';
import { guideRouteFromDraft } from './guide-route.boundary';

/**
 * Route wizard — Pattern A (linear wizard, flow-patterns skill).
 *
 * Single message, edited in place at each step (anti-patterns #1 — no message
 * spam). Steps: location → transport → time → categories → build. Auto-mode stays
 * fully in chat; manual-mode graduates to the Mini App.
 */
export function registerRouteHandlers(
  bot: Bot<BotContext>,
  sessions: SessionService,
  builder: RouteBuilderService,
  users: TelegramUserService,
  analytics: AnalyticsService,
  miniAppUrl: string | undefined,
  limiter: BotRateLimiter,
  lastRoute: LastRouteService,
  draftService: ItineraryDraftService,
  ownerService: ItineraryOwnerService,
) {
  // ── Start route wizard ─────────────────────────────────────────
  bot.callbackQuery(CB.startRoute, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.step = 'ROUTE_LOCATION';
    s.start = undefined;
    sessions.set(ctx.chatId!, s);

    await ctx.reply(
      '📍 <b>Откуда стартуем?</b>\n\nПоделитесь геолокацией — я сам определю ваше положение.',
      {
        parse_mode: 'HTML',
        reply_markup: keyboard([
          [{ text: '🛰 Поделиться геолокацией', callback_data: CB.rRequestLoc, style: 'primary' }],
          [{ text: '✏️ Написать название', callback_data: CB.rLocText }],
          [{ text: '🔙 В меню', callback_data: CB.navHome }, { text: '❌ Сбросить', callback_data: CB.navCancel, style: 'danger' }],
        ]),
      },
    );
  });

  // Location: request native keyboard with request_location
  bot.callbackQuery(CB.rRequestLoc, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.step = 'ROUTE_LOCATION';
    sessions.set(ctx.chatId!, s);
    const prompt = await ctx.reply(
      '📍 <b>Откуда стартуем?</b>\n\nНажмите кнопку — пришлёт вашу геолокацию одним тапом.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '📍 Отправить геолокацию', request_location: true }],
            [{ text: '🔙 В меню' }],
          ],
          one_time_keyboard: true,
          resize_keyboard: true,
          input_field_placeholder: 'Или напишите город / место…',
        },
      },
    );
    s.routeLocationPromptId = prompt.message_id;
    sessions.set(ctx.chatId!, s);
  });

  // Location: via Telegram location button
  // IMPORTANT: must call next() when step doesn't match so the nearby handler
  // (registered after this one) also receives location messages.
  bot.on('message:location', async (ctx, next) => {
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (s.step !== 'ROUTE_LOCATION') {
      // Stale location from a previous run of the wizard or a
      // stray share. Acknowledge so the user doesn't think the bot
      // hung (anti-pattern #16), then move on.
      if (ctx.message?.location) {
        await ctx.reply(
          '📍 Локация получена, но сейчас мы не в режиме построения маршрута.\n\n' +
            'Нажмите /start и выберите «🗺 Построить маршрут».',
          { reply_markup: { remove_keyboard: true } },
        );
      }
      return next();
    }
    const loc = ctx.message.location;
    s.start = { lat: loc.latitude, lon: loc.longitude };
    // The "Откуда стартуем?" prompt had the request_location keyboard.
    // Once the location is in, the prompt has done its job — delete it
    // so the chat doesn't accumulate a dead "📍 Отправить геолокацию"
    // button under the next step. Same pattern as nearby.handler.ts.
    if (s.routeLocationPromptId) {
      try {
        await ctx.api.deleteMessage(ctx.chatId!, s.routeLocationPromptId);
      } catch {
        /* ignore */
      }
      s.routeLocationPromptId = undefined;
    }
    await askTransport(ctx, s);
  });

  // Location: typed text → simple geocode (Kirov center fallback for known words)
  bot.callbackQuery(CB.rLocText, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.step = 'ROUTE_LOCATION_TEXT';
    sessions.set(ctx.chatId!, s);
    await ctx.reply('Напишите город или место (например «Киров» или «Центр Кирова»):', {
      reply_markup: { force_reply: true, input_field_placeholder: 'Город или место…' },
    });
  });

  // Escape from the location step: the reply keyboard has a "🔙 В меню"
  // button (sends text). Catch it during location steps and return home.
  bot.hears('🔙 В меню', async (ctx) => {
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.step = undefined;
    s.start = undefined;
    sessions.set(ctx.chatId!, s);
    await ctx.reply('🏠 Главное меню', {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply('Что делаем?', {
      reply_markup: keyboard([
        [{ text: '🗺 Построить маршрут', callback_data: CB.startRoute, style: 'primary' }],
        [
          { text: '📍 Найти рядом', callback_data: CB.startNearby },
          { text: '📂 Открыть каталог', callback_data: CB.mCatalog },
        ],
      ]),
    });
  });

  bot.on('message:text', async (ctx, next) => {
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (s.step !== 'ROUTE_LOCATION_TEXT') return next();

    // Minimal resolver: "киров" → Kirov center. Real geocoding can be added later.
    const q = ctx.message.text.trim().toLowerCase();
    if (q.includes('киров')) {
      s.start = { ...KIROV_CENTER, label: 'Киров' };
    } else {
      // No more "Москва → Москва (≈ Киров)" silent lie (audit finding
      // M-1). Either we recognise the place or we tell the user we
      // can't and ask them to share location instead.
      await ctx.reply(
        '🤔 Не могу распознать это место (пока умею только «Киров»).\n\n' +
          'Отправьте геолокацию кнопкой ниже или напишите «Киров».',
        {
          reply_markup: {
            keyboard: [
              [{ text: '📍 Отправить геолокацию', request_location: true }],
              [{ text: '🔙 В меню' }],
            ],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        },
      );
      return;
    }
    // Recognised — clean up the location-prompt message and move on.
    if (s.routeLocationPromptId) {
      try {
        await ctx.api.deleteMessage(ctx.chatId!, s.routeLocationPromptId);
      } catch {
        /* ignore */
      }
      s.routeLocationPromptId = undefined;
    }
    await askTransport(ctx, s);
  });

  // ── Transport (hierarchical: bike → subtype) ──────────────────
  async function askTransport(ctx: any, s: BotSession) {
    s.step = 'ROUTE_TRANSPORT';
    s.bikeSubtype = undefined;
    const msg = await ctx.reply('🚲 <b>Как добираемся?</b>', {
      parse_mode: 'HTML',
      reply_markup: keyboard([
        [{ text: '🚴 Велосипед', callback_data: `${CB.rSetTransport}:bike`, style: 'primary' }],
        [{ text: '🚶 Пешком', callback_data: `${CB.rSetTransport}:foot` }, { text: '🚗 Авто', callback_data: `${CB.rSetTransport}:car` }],
        wizardEscapeRow(),
      ]),
    });
    s.menuMessageId = msg.message_id;
    sessions.set(ctx.chatId!, s);
  }

  bot.callbackQuery(new RegExp(`^${CB.rSetTransport}:(bike|foot|car)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (ctx.match![1] === 'bike') {
      // Show bike subtype selection.
      s.step = 'ROUTE_BIKE_SUBTYPE';
      sessions.set(ctx.chatId!, s);
      await safeEdit(ctx, s, '🚴 <b>Велосипед — какой?</b>', keyboard([
        [{ text: '🚴 Городской', callback_data: `${CB.rSetTransport}:bike:bike` }],
        [{ text: '⛰️ Горный (MTB)', callback_data: `${CB.rSetTransport}:bike:mtb` }],
        [{ text: '🔙 Назад', callback_data: `${CB.rSetTransport}:back` }],
      ]));
      return;
    }
    s.transport = ctx.match![1] as Transport;
    s.bikeSubtype = s.transport;
    await askTime(ctx, s);
  });

  bot.callbackQuery(`${CB.rSetTransport}:back`, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    await askTransport(ctx, s);
  });

  // Bike subtype selection — buttons send `route:tr:bike:bike` / `route:tr:bike:mtb`
  // (two segments). The regex must match BOTH segments, otherwise the
  // callback is unhandled and the user sees the button do nothing (the
  // "быстрый маршрут + вело → ничего" bug).
  bot.callbackQuery(new RegExp(`^${CB.rSetTransport}:bike:(bike|mtb)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    const subtype = ctx.match![1] as Transport;
    // Use the actual GraphHopper profile (bike=trekking/asphalt, mtb=mountain
    // via the custom nearventure-mtb model). Previously this was hardcoded to
    // 'bike', so picking «Горный (MTB)» silently routed on the road-bike
    // profile — wrong speeds and wrong roads.
    s.transport = subtype;
    s.bikeSubtype = subtype;
    await askTime(ctx, s);
  });

  // ── Time ───────────────────────────────────────────────────────
  async function askTime(ctx: any, s: BotSession) {
    s.step = 'ROUTE_TIME';
    await safeEdit(ctx, s, '⏱ <b>Сколько времени?</b>\n\n🔁 <i>Кольцо</i> — вернётесь в старт. Линейный — уедете дальше за то же время.',
      keyboard([
        TIMES.slice(0, 3).map((t) => ({
          text: t.label,
          callback_data: `${CB.rSetTime}:${t.minutes}`,
        })),
        TIMES.slice(3).map((t) => ({
          text: t.label,
          callback_data: `${CB.rSetTime}:${t.minutes}`,
        })),
        [{
          text: `${s.loopRoute ? '🔁' : '➡️'} Кольцо: ${s.loopRoute ? 'вкл' : 'выкл'}`,
          callback_data: CB.rToggleLoop,
          style: s.loopRoute ? 'primary' : undefined,
        }],
        wizardEscapeRow(),
      ]),
    );
    sessions.set(ctx.chatId!, s);
  }

  // Toggle loop on/off (re-renders the time screen so the state is visible).
  bot.callbackQuery(CB.rToggleLoop, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.loopRoute = !s.loopRoute;
    sessions.set(ctx.chatId!, s);
    await askTime(ctx, s);
  });

  bot.callbackQuery(new RegExp(`^${CB.rSetTime}:(\\d+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.timeMinutes = parseInt(ctx.match![1], 10);
    await askCategories(ctx, s);
  });

  // ── Categories ─────────────────────────────────────────────────
  async function askCategories(ctx: any, s: BotSession) {
    s.step = 'ROUTE_CATEGORIES';
    await safeEdit(
      ctx,
      s,
      '🏷 <b>Что интересно?</b>\nТапайте, чтобы включить/выключить.',
      categoriesKeyboard(s),
    );
    sessions.set(ctx.chatId!, s);
  }

  function categoriesKeyboard(s: BotSession) {
    const rows: InlineKeyboardButton[][] = CATEGORIES.map((c) => {
      const on = s.categories.includes(c.key);
      return [{
        text: `${on ? '✅' : '⬜'} ${c.emoji} ${c.label}`,
        callback_data: `${CB.rToggleCat}:${c.key}`,
        style: on ? 'primary' : undefined,
      }];
    });
    rows.push([
      { text: '✅ Готово (авто)', callback_data: CB.rCatsDone, style: 'success' },
      { text: '🛒 Выбрать вручную', callback_data: `${CB.rSetMode}:manual` },
    ]);
    rows.push([{ text: '🔙 В меню', callback_data: CB.navHome }]);
    return keyboard(rows);
  }

  bot.callbackQuery(new RegExp(`^${CB.rToggleCat}:(\\w+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    const key = ctx.match![1];
    if (s.categories.includes(key)) s.categories = s.categories.filter((c) => c !== key);
    else s.categories.push(key);
    sessions.set(ctx.chatId!, s);
    await ctx.editMessageReplyMarkup({ reply_markup: categoriesKeyboard(s) });
  });

  bot.callbackQuery(CB.rCatsDone, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (s.categories.length === 0) {
      await safeEdit(
        ctx,
        s,
        '❌ Выберите хотя бы одну категорию.',
        keyboard([[{ text: '🔙 К категориям', callback_data: CB.rSetTime }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }
    // Auto-build immediately — no separate mode step
    await buildAuto(ctx, s);
  });

  // Back from categories → time
  bot.callbackQuery(CB.rBackToCats, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    await askCategories(ctx, s);
  });

  // ── Manual mode (graduated to Mini App) ────────────────────────
  bot.callbackQuery(new RegExp(`^${CB.rSetMode}:manual$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (!miniAppUrl) {
      await safeEdit(
        ctx,
        s,
        '🛒 <b>Ручной режим временно недоступен</b>\n\nПубличный URL Mini App не настроен.',
        keyboard([[{ text: '🔙 Назад', callback_data: CB.rCatsDone }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }
    const url = `${miniAppUrl}#/wizard?lat=${s.start!.lat}&lon=${s.start!.lon}&profile=${s.transport}&time=${s.timeMinutes}&cat=${encodeURIComponent(s.categories.join(','))}&loop=${s.loopRoute ? 1 : 0}&mode=manual`;
    await safeEdit(
      ctx,
      s,
      '🛒 <b>Ручной режим — в приложении</b>\n\nВыберите объекты в каталоге и соберите маршрут. ' +
        'Откроется мини-приложение Nearventure.',
      keyboard([
        [{ text: '🛒 Открыть выбор мест', web_app: { url }, style: 'primary' }],
        [{ text: '🔙 Назад', callback_data: CB.rCatsDone }],
      ]),
    );
    sessions.set(ctx.chatId!, s);
  });

  // ── Build (auto) — creates draft + calls autoFill ──────────────
  async function buildAuto(ctx: any, s: BotSession) {
    // Rate limit check before expensive GraphHopper call (Task H2).
    if (!limiter.try('route', ctx.from!.id)) {
      const min = limiter.resetInMin('route', ctx.from!.id);
      await safeEdit(
        ctx,
        s,
        `⏳ Лимит построения маршрутов исчерпан на этот час. Попробуйте через ~${min} мин.`,
        keyboard([wizardEscapeRow()]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }

    // Keep the existing wizard state until the canonical draft has passed the
    // guide boundary, so a malformed result cannot alter the saved session.
    await ctx.replyWithChatAction('typing');
    const statusMsg = await ctx.reply('🧭 Собираю маршрут…', {
      reply_markup: keyboard([
        [{ text: '🛑 Отменить', callback_data: CB.navReset }],
      ]),
    });

    try {
      const ownerKey = ownerService.forTelegramUser(ctx.from!.id).key;
      const preset = s.draftPreset ?? 'balanced';

      // 1. Create the itinerary draft
      let draft = await draftService.create(ownerKey, {
        start: s.start!,
        profile: s.transport as any,
        loop: s.loopRoute,
        intent: 'auto_budget',
        stopPace: 'pass_by',
        budgetMinutes: s.timeMinutes!,
        preset,
      });

      // 2. Auto-fill with POI categories
      draft = await draftService.autoFill(
        ownerKey,
        draft.id,
        {
          preferredCategories: s.categories,
          preset,
          seed: Math.floor(Math.random() * 2147483647),
          expectedVersion: draft.version,
          commandId: randomUUID(),
        },
      );

      // 3. Validate the canonical included stops before any cache/session write.
      const guideRoute = guideRouteFromDraft(draft);
      if (!guideRoute) throw new Error('Маршрут содержит неполные данные для экскурсии.');
      const route = draftToRouteSnapshot(draft, guideRoute);

      s.lastRoute = {
        geojson: route.geojson as any,
        distance: route.distance,
        duration: route.duration,
        ascend: route.ascend,
        descend: route.descend,
        profile: guideRoute.profile,
        pois: route.pois,
      };
      s.draftId = draft.id;
      s.draftVersion = draft.version;
      s.draftPreset = preset;
      s.step = 'IDLE';
      sessions.set(ctx.chatId!, s);

      // 4. Persist the same validated snapshot for the Mini App handoff.
      await lastRoute.set(ctx.chatId!, {
        ...guideRoute,
        categories: s.categories,
        timeMinutes: s.timeMinutes,
      });

      // 5. Stats + analytics attribution
      await users.incrementRoutes(ctx.chatId!);
      void analytics
        .record({
          type: 'route_generated',
          telegramChatId: ctx.chatId,
          meta: {
            profile: s.transport,
            distanceKm: route.distance / 1000,
            durationMin: route.duration / 60,
            poiCount: route.pois.length,
            timeBudgetMin: s.timeMinutes,
            categories: s.categories,
            draftId: draft.id,
          },
        })
        .catch(() => {});

      try {
        await ctx.api.deleteMessage(ctx.chatId!, statusMsg.message_id);
      } catch {
        /* ignore */
      }

      // 6. Render result with draft-aware buttons
      await ctx.reply(routeSummaryHtml(route), {
        parse_mode: 'HTML',
        reply_markup: routeResultKeyboard(draft.id, draft.version),
      });
    } catch (err: any) {
      try {
        await ctx.api.deleteMessage(ctx.chatId!, statusMsg.message_id);
      } catch {
        /* ignore */
      }
      const msg = err?.message || 'Не получилось построить маршрут.';
      await safeEdit(
        ctx,
        s,
        `❌ ${esc(msg)}\n\nПопробуйте другую точку или время.`,
        keyboard([
          [{ text: '🔁 Повторить', callback_data: CB.rCatsDone }],
          [{ text: '🔙 В меню', callback_data: CB.navHome }],
        ]),
      );
    }
  }

  /** Convert ItineraryDraft → BuiltRoute-compatible snapshot for bot rendering. */
  function draftToRouteSnapshot(
    draft: import('../itineraries/itinerary.types').ItineraryDraft,
    guideRoute: import('./last-route.service').CachedRoute,
  ): import('./route-builder.service').BuiltRoute {
    return {
      geojson: guideRoute.geojson,
      distance: guideRoute.distance,
      duration: guideRoute.duration,
      ascend: guideRoute.ascend,
      descend: guideRoute.descend,
      profile: guideRoute.profile as import('../routing/routing.types').RoutingProfile,
      pois: guideRoute.pois.map(({ order: _order, ...poi }) => poi),
      totals: { travelMinutes: draft.totals.travelMinutes, stopMinutes: draft.totals.stopMinutes, reserveMinutes: draft.totals.reserveMinutes, totalMinutes: draft.totals.totalMinutes, feasible: draft.totals.feasible },
      warnings: draft.warnings,
      selectionSummary: draft.autoFillSummary,
    };
  }

  function routeResultKeyboard(draftId: string, version: number) {
    const rows: InlineKeyboardButton[][] = [];
    if (miniAppUrl) {
      rows.push([{
        text: '✏️ Открыть и изменить',
        web_app: { url: `${miniAppUrl}#/draft/${draftId}?version=${version}` },
        style: 'primary',
      }]);
    }
    rows.push(
      [
        { text: '🔄 Другой вариант', callback_data: CB.rrRegenerate },
        { text: '📦 Уложить плотнее', callback_data: CB.rrSmartFix },
      ],
      [
        { text: '⬇ GPX', callback_data: CB.rrGpx },
        { text: '▶ Проведи меня', callback_data: CB.rrGuide },
      ],
      [{ text: '🔙 В меню', callback_data: CB.navHome }],
    );
    return keyboard(rows);
  }

  // ── GPX download (sendDocument) ────────────────────────────────
  bot.callbackQuery(CB.rrGpx, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (!s.lastRoute) {
      await safeEdit(
        ctx,
        s,
        '❌ Маршрут не найден. Постройте новый — /start.',
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }

    // Rate limit GPX generation (Task H2).
    if (!limiter.try('gpx', ctx.from!.id)) {
      const min = limiter.resetInMin('gpx', ctx.from!.id);
      await safeEdit(
        ctx,
        s,
        `⏳ Лимит скачивания GPX исчерпан на этот час. Попробуйте через ~${min} мин.`,
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }

    await ctx.replyWithChatAction('upload_document');
    try {
      const gpx = builder.buildGpx(
        {
          geojson: s.lastRoute.geojson,
          distance: s.lastRoute.distance,
          duration: s.lastRoute.duration,
          ascend: s.lastRoute.ascend,
          descend: s.lastRoute.descend,
          profile: (s.lastRoute.profile || s.transport) as any,
          pois: s.lastRoute.pois,
        },
        `Nearventure — ${fmtDistance(s.lastRoute.distance)}`,
      );
      const buf = Buffer.from(gpx, 'utf8');
      await ctx.replyWithDocument(
        new InputFile(buf, `nearventure-${Math.round(s.lastRoute.distance / 1000)}km.gpx`),
        { caption: `🗺 ${fmtDistance(s.lastRoute.distance)} · GPX-маршрут Nearventure` },
      );
      await users.incrementGpx(ctx.chatId!);
      void analytics
        .record({ type: 'gpx_downloaded', telegramChatId: ctx.chatId })
        .catch(() => {});
    } catch (err: any) {
      await ctx.reply(`❌ Не удалось собрать GPX: ${esc(err.message)}`);
    }
  });

  // ── Open draft in Mini App (web_app button — no callback needed) ──
  // The "✏️ Открыть и изменить" button uses web_app directly with a
  // draft URL. No callback handler needed — Telegram opens the Mini App.
  // This comment documents that rrOpen is reserved for future use.
  void CB.rrOpen;

  // ── Regenerate (new seed) ──────────────────────────────────────
  bot.callbackQuery(CB.rrRegenerate, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (!s.draftId || !s.draftVersion) {
      await safeEdit(
        ctx,
        s,
        '❌ Черновик маршрута не найден. Постройте новый — /start.',
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }

    // Rate limit check
    if (!limiter.try('route', ctx.from!.id)) {
      const min = limiter.resetInMin('route', ctx.from!.id);
      await safeEdit(
        ctx,
        s,
        `⏳ Лимит построения маршрутов исчерпан на этот час. Попробуйте через ~${min} мин.`,
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }

    await ctx.replyWithChatAction('typing');
    try {
      const ownerKey = ownerService.forTelegramUser(ctx.from!.id).key;
      const draft = await draftService.regenerate(
        ownerKey,
        s.draftId,
        {
          categories: s.categories,
          preset: s.draftPreset ?? 'balanced',
          seed: Math.floor(Math.random() * 2147483647),
          expectedVersion: s.draftVersion,
          commandId: randomUUID(),
        },
      );

      const guideRoute = guideRouteFromDraft(draft);
      if (!guideRoute) throw new Error('Маршрут содержит неполные данные для экскурсии.');
      const route = draftToRouteSnapshot(draft, guideRoute);
      s.draftVersion = draft.version;
      s.lastRoute = {
        geojson: route.geojson as any,
        distance: route.distance,
        duration: route.duration,
        ascend: route.ascend,
        descend: route.descend,
        profile: guideRoute.profile,
        pois: route.pois,
      };
      sessions.set(ctx.chatId!, s);

      // Update lastRoute cache
      await lastRoute.set(ctx.chatId!, {
        ...guideRoute,
        categories: s.categories,
        timeMinutes: s.timeMinutes,
      });

      await safeEdit(
        ctx,
        s,
        routeSummaryHtml(route),
        routeResultKeyboard(draft.id, draft.version),
      );
    } catch (err: any) {
      await safeEdit(
        ctx,
        s,
        `❌ ${esc(err?.message || 'Не удалось перестроить маршрут.')}`,
        keyboard([
          [{ text: '🔄 Попробовать снова', callback_data: CB.rrRegenerate }],
          [{ text: '🔙 В меню', callback_data: CB.navHome }],
        ]),
      );
    }
  });

  // ── Apply smart fix ("Уложить плотнее") ────────────────────────
  bot.callbackQuery(CB.rrSmartFix, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (!s.draftId || !s.draftVersion) {
      await safeEdit(
        ctx,
        s,
        '❌ Черновик маршрута не найден. Постройте новый — /start.',
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }

    await ctx.replyWithChatAction('typing');
    try {
      const ownerKey = ownerService.forTelegramUser(ctx.from!.id).key;

      // Fetch latest draft to get suggestions
      const latest = await draftService.get(ownerKey, s.draftId);
      const suggestion = latest.suggestions[0];
      if (!suggestion) {
        await safeEdit(
          ctx,
          s,
          '✅ Маршрут уже оптимален. Дополнительные улучшения не требуются.',
          keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
        );
        sessions.set(ctx.chatId!, s);
        return;
      }

      const draft = await draftService.applySmartFix(
        ownerKey,
        s.draftId,
        {
          suggestionId: suggestion.suggestionId,
          expectedVersion: latest.version,
          commandId: randomUUID(),
        },
      );

      const guideRoute = guideRouteFromDraft(draft);
      if (!guideRoute) throw new Error('Маршрут содержит неполные данные для экскурсии.');
      const route = draftToRouteSnapshot(draft, guideRoute);
      s.draftVersion = draft.version;
      s.lastRoute = {
        geojson: route.geojson as any,
        distance: route.distance,
        duration: route.duration,
        ascend: route.ascend,
        descend: route.descend,
        profile: guideRoute.profile,
        pois: route.pois,
      };
      sessions.set(ctx.chatId!, s);

      // Update lastRoute cache
      await lastRoute.set(ctx.chatId!, {
        ...guideRoute,
        categories: s.categories,
        timeMinutes: s.timeMinutes,
      });

      await safeEdit(
        ctx,
        s,
        routeSummaryHtml(route),
        routeResultKeyboard(draft.id, draft.version),
      );
    } catch (err: any) {
      await safeEdit(
        ctx,
        s,
        `❌ ${esc(err?.message || 'Не удалось применить улучшение.')}`,
        keyboard([
          [{ text: '🔄 Попробовать снова', callback_data: CB.rrSmartFix }],
          [{ text: '🔙 В меню', callback_data: CB.navHome }],
        ]),
      );
    }
  });
}

// Keep unused import alive for type-checking in tests
const _CB = CB;
type _BotSession = BotSession;

