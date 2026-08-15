import { Bot } from 'grammy';
import { BotContext } from './types';
import { SessionService } from './session.service';
import { PoisService, PoiRow } from '../pois/pois.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TelegramPoiCardService } from './poi-card.service';
import { CB, CATEGORIES, RADII, keyboard, esc, safeEdit, deleteIfPossible } from './keyboards';
import { BotSession } from './session';
import { fmtDistance } from './format';
import { haversine } from './geo';

const PAGE_SIZE = 8; // Increased from 6 to 8 per requirement
const DEFAULT_RADIUS = 5000; // 5km - already correct

/**
 * "Что рядом" — search-then-pick (flow-patterns skill).
 *
 * Flow: categories+radius setup → location → inline list (emoji·name·distance,
 * paginated) → tap → POI card (photo + caption) → back to list.
 */
export function registerNearbyHandlers(
  bot: Bot<BotContext>,
  sessions: SessionService,
  pois: PoisService,
  analytics: AnalyticsService,
  poiCards: TelegramPoiCardService,
) {
  // ── Step 1: Setup — categories + radius ────────────────────────
  bot.callbackQuery(CB.startNearby, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.step = 'NEARBY_SETUP';
    s.nearbyRadius = DEFAULT_RADIUS;
    s.nearbyCategories = [...CATEGORIES.map((c) => c.key)];
    s.nearbyOffset = 0;
    s.nearbyLocation = undefined;
    sessions.set(ctx.chatId!, s);
    await sendSetup(ctx, s);
  });

  // Toggle category
  bot.callbackQuery(new RegExp(`^${CB.nbCat}:(\\w+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    const key = ctx.match![1];
    if (s.nearbyCategories!.includes(key)) {
      s.nearbyCategories = s.nearbyCategories!.filter((c) => c !== key);
    } else {
      s.nearbyCategories!.push(key);
    }
    sessions.set(ctx.chatId!, s);
    await ctx.editMessageReplyMarkup({ reply_markup: setupKeyboard(s) }).catch(() => {});
  });

  // Set radius
  bot.callbackQuery(new RegExp(`^${CB.nbRadius}:(\\d+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.nearbyRadius = parseInt(ctx.match![1], 10);
    sessions.set(ctx.chatId!, s);
    await ctx.editMessageReplyMarkup({ reply_markup: setupKeyboard(s) }).catch(() => {});
  });

  // Done → request location
  bot.callbackQuery(CB.nbCatsDone, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (!s.nearbyCategories || s.nearbyCategories.length === 0) {
      await ctx.reply('❌ Выберите хотя бы одну категорию для поиска.', {
        reply_markup: keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      });
      return;
    }
    s.step = 'NEARBY_LOCATION';
    sessions.set(ctx.chatId!, s);
    const prompt = await ctx.reply('📍 <b>Где вы сейчас?</b>\n\nОтправьте геолокацию кнопкой ниже или напишите место текстом.', {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{ text: '📍 Отправить геолокацию', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    s.nearbyPromptId = prompt.message_id;
    // Inline keyboard BELOW the reply-keyboard prompt — gives users
    // a way back to category filters. Without this, the only option
    // is "send location" and users get stuck (user feedback).
    const inline = await ctx.reply('Можно вернуться к выбору категорий или в меню:', {
      reply_markup: keyboard([
        [{ text: '⚙️ Назад к фильтрам', callback_data: CB.startNearby }],
        [{ text: '🔙 В меню', callback_data: CB.navHome }],
      ]),
    });
    s.nearbyPromptInlineId = inline.message_id;
    sessions.set(ctx.chatId!, s);
  });

  // ── Step 2: Location received → fetch + show list ──────────────
  bot.on('message:location', async (ctx, next) => {
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (s.step !== 'NEARBY_LOCATION') {
      // Stale location: user shared their position outside the nearby
      // flow (e.g. mid-route wizard). Don't silently swallow it — give
      // them a one-liner and move on. anti-pattern #16: silent error.
      if (ctx.message?.location) {
        await ctx.reply(
          '📍 Локация получена, но сейчас мы не в режиме «рядом».\n\n' +
            'Нажмите /start и выберите «📍 Найти рядом».',
          { reply_markup: { remove_keyboard: true } },
        );
      }
      return next();
    }
    const loc = ctx.message.location;
    s.nearbyLocation = { lat: loc.latitude, lon: loc.longitude };
    s.nearbyOffset = 0;
    sessions.set(ctx.chatId!, s);
    // The "Где вы сейчас?" prompt had a request_location reply-keyboard.
    // Now that the user has shared their location, that prompt has done
    // its job — delete both the prompt AND the inline back-button message
    // so the chat doesn't accumulate dead keyboards.
    await deleteIfPossible(ctx, s.nearbyPromptId);
    await deleteIfPossible(ctx, s.nearbyPromptInlineId);
    s.nearbyPromptId = undefined;
    s.nearbyPromptInlineId = undefined;
    sessions.set(ctx.chatId!, s);
    await sendNearbyPage(ctx, s, pois, sessions, analytics);
  });

  // ── Pagination ─────────────────────────────────────────────────
  bot.callbackQuery(new RegExp(`^${CB.nbPage}:(\\d+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.nearbyOffset = parseInt(ctx.match![1], 10);
    await sendNearbyPage(ctx, s, pois, sessions, analytics, /*edit*/ true);
  });

  // ── Tap POI → detail card ──────────────────────────────────────
  bot.callbackQuery(new RegExp(`^${CB.nbCard}:(\\d+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    const idx = parseInt(ctx.match![1], 10);
    const poi = s.nearbyPois?.[idx];
    if (!poi) return;

    s.step = 'NEARBY_CARD';
    sessions.set(ctx.chatId!, s);

    // Send POI card via the card service (photo + caption + caching).
    // Navigation buttons are attached directly to the card (anti-patterns #1).
    const nextOffset = (s.nearbyOffset || 0) + PAGE_SIZE;
    const cardRows: any[][] = [
      [{ text: '◀ Назад к списку', callback_data: CB.nbBack }],
    ];
    // "More results" only if there is a next page cached/expected.
    // We don't know the exact next page size here, so we offer it unconditionally;
    // sendNearbyPage will show an empty-state if nothing is left.
    cardRows.push([{ text: '➡️ Ещё варианты', callback_data: `${CB.nbPage}:${nextOffset}` }]);
    cardRows.push([{ text: '📍 Новая локация', callback_data: CB.nbMore }]);
    cardRows.push([{ text: '🔙 В меню', callback_data: CB.navHome }]);
    await poiCards.sendPoiCard(ctx.api, ctx.chatId!, poi.id, cardRows);

    // Send location pin so user can open the POI in their maps app.
    const pinMsg = await ctx.api.sendLocation(ctx.chatId!, poi.lat, poi.lon).catch(() => undefined);
    if (pinMsg?.message_id) {
      s.nearbyCardPinId = pinMsg.message_id;
      sessions.set(ctx.chatId!, s);
    }

    void analytics
      .record({ type: 'poi_viewed', poiUuid: poi.id, telegramChatId: ctx.chatId })
      .catch(() => {});
  });

  // Back to list (from a card)
  bot.callbackQuery(CB.nbBack, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    await deleteIfPossible(ctx, s.nearbyCardPinId);
    s.nearbyCardPinId = undefined;
    s.step = 'NEARBY_LIST';
    sessions.set(ctx.chatId!, s);
    await sendNearbyPage(ctx, s, pois, sessions, analytics, true);
  });

  // More nearby (request new location, or reuse current if available)
  bot.callbackQuery(CB.nbMore, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.nearbyOffset = 0;
    sessions.set(ctx.chatId!, s);

    // If we already have a location, ask whether to reuse it instead of
    // forcing the user to share again (common case: "я не двигался").
    if (s.nearbyLocation) {
      // Keep the step open for a new location in case the user ignores the
      // inline buttons and just shares a point — that's still a valid "new location".
      s.step = 'NEARBY_LOCATION';
      sessions.set(ctx.chatId!, s);
      await ctx.editMessageText(
        '📍 <b>Искать в том же месте или отправить новую точку?</b>',
        {
          parse_mode: 'HTML',
          reply_markup: keyboard([
            [{ text: '🔄 Искать здесь же', callback_data: 'nearby:same' }],
            [{ text: '📍 Новая локация', callback_data: 'nearby:newloc' }],
            [{ text: '🔙 В меню', callback_data: CB.navHome }],
          ]),
        },
      ).catch(async () => {
        await ctx.reply(
          '📍 <b>Искать в том же месте или отправить новую точку?</b>',
          {
            parse_mode: 'HTML',
            reply_markup: keyboard([
              [{ text: '🔄 Искать здесь же', callback_data: 'nearby:same' }],
              [{ text: '📍 Новая локация', callback_data: 'nearby:newloc' }],
              [{ text: '🔙 В меню', callback_data: CB.navHome }],
            ]),
          },
        );
      });
      return;
    }

    s.step = 'NEARBY_LOCATION';
    sessions.set(ctx.chatId!, s);
    const prompt = await ctx.reply('📍 <b>Отправьте новую геолокацию</b>\n\nНайду интересные места вокруг новой точки.', {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{ text: '📍 Отправить геолокацию', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    s.nearbyPromptId = prompt.message_id;
    sessions.set(ctx.chatId!, s);
  });

  // Reuse current location for another search.
  bot.callbackQuery('nearby:same', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Ищем рядом…' });
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.step = 'NEARBY_LIST';
    s.nearbyOffset = 0;
    sessions.set(ctx.chatId!, s);
    await sendNearbyPage(ctx, s, pois, sessions, analytics, true);
  });

  // Explicitly request a new location.
  bot.callbackQuery('nearby:newloc', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отправьте новую точку' });
    const s = sessions.get(ctx.chatId!, ctx.from);
    s.step = 'NEARBY_LOCATION';
    s.nearbyLocation = undefined;
    s.nearbyOffset = 0;
    sessions.set(ctx.chatId!, s);
    const prompt = await ctx.reply('📍 <b>Отправьте новую геолокацию</b>\n\nНайду интересные места вокруг новой точки.', {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{ text: '📍 Отправить геолокацию', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    s.nearbyPromptId = prompt.message_id;
    sessions.set(ctx.chatId!, s);
  });
}

// ── Setup keyboard (categories + radius) ─────────────────────────

function setupKeyboard(s: BotSession) {
  const cats = s.nearbyCategories ?? [];
  const rows: any[][] = CATEGORIES.map((c) => [{
    text: `${cats.includes(c.key) ? '✅' : '⬜'} ${c.emoji} ${c.label}`,
    callback_data: `${CB.nbCat}:${c.key}`,
  }]);
  // Radius row
  rows.push(
    RADII.map((r) => ({
      text: s.nearbyRadius === r.meters ? `🔘 ${r.label}` : r.label,
      callback_data: `${CB.nbRadius}:${r.meters}`,
    })),
  );
  rows.push([{ text: '🔍 Найти', callback_data: CB.nbCatsDone, style: 'success' }]);
  rows.push([{ text: '🔙 В меню', callback_data: CB.navHome }]);
  return keyboard(rows);
}

async function sendSetup(ctx: any, s: BotSession) {
  const text =
    `🔍 <b>Что рядом?</b>\n\n` +
    `Выберите категории и радиус поиска — потом пришлёте геолокацию.\n\n` +
    `<i>По умолчанию: все категории включены, радиус 5 км.</i>`;
  await safeEdit(ctx, s, text, setupKeyboard(s));
}

// ── Nearby list page ─────────────────────────────────────────────

async function sendNearbyPage(
  ctx: any,
  s: BotSession,
  pois: PoisService,
  sessions: SessionService,
  analytics: AnalyticsService,
  edit = false,
) {
  if (!s.nearbyLocation) return;
  await ctx.replyWithChatAction('typing');

  const catFilter = s.nearbyCategories?.length ? s.nearbyCategories.join(',') : undefined;
  let res;
  try {
    res = await pois.list({
      lat: s.nearbyLocation.lat,
      lng: s.nearbyLocation.lon,
      radius: s.nearbyRadius ?? DEFAULT_RADIUS,
      category: catFilter as any,
      sort: 'popularity',
      limit: PAGE_SIZE + 1,
      offset: s.nearbyOffset || 0,
    });
  } catch {
    const msg = '⚠️ Не удалось загрузить объекты. Проверьте связь и попробуйте снова.';
    const mk = keyboard([
      [{ text: '🔁 Повторить', callback_data: `${CB.nbPage}:${s.nearbyOffset || 0}` }],
      [{ text: '🔙 В меню', callback_data: CB.navHome }],
    ]);
    if (edit) {
      await ctx.editMessageText(msg, { reply_markup: mk }).catch(() => ctx.reply(msg, { reply_markup: mk }));
    } else {
      await ctx.reply(msg, { reply_markup: mk });
    }
    return;
  }

  s.nearbyPois = res.items.map((p) => toManual(p));
  const hasNext = res.items.length > PAGE_SIZE;
  const page = res.items.slice(0, PAGE_SIZE);
  const offset = s.nearbyOffset || 0;

  if (page.length === 0) {
    const radiusKm = (s.nearbyRadius ?? DEFAULT_RADIUS) / 1000;
    const msg =
      `В радиусе ${radiusKm} км ничего не нашлось.\n\n` +
      `Попробуйте расширить радиус или сменить категории.`;
    const mk = keyboard([
      [{ text: '⚙️ Изменить фильтры', callback_data: CB.startNearby }],
      [{ text: '🔙 В меню', callback_data: CB.navHome }],
    ]);
    if (edit) {
      await ctx.editMessageText(msg, { reply_markup: mk }).catch(async () => {
        await ctx.reply(msg, { reply_markup: mk });
      });
    } else {
      await ctx.reply(msg, { reply_markup: mk });
    }
    return;
  }

  // Sort by actual distance from user
  const withDist = page.map((p, i) => ({
    p,
    i,
    d: haversine(s.nearbyLocation!, { lat: p.lat, lon: p.lon }),
  }));
  withDist.sort((a, b) => a.d - b.d);

  // Update cached indices to match sorted order
  s.nearbyPois = withDist.map((x) => toManual(x.p));
  s.step = 'NEARBY_LIST';
  sessions.set(ctx.chatId!, s);

  const radiusKm = (s.nearbyRadius ?? DEFAULT_RADIUS) / 1000;
  // Compact summary — categories grouped. Buttons carry the full POI list.
  // Don't duplicate the POI list in both text and buttons (user feedback:
  // "в сообщении дублируется ровно то же, что в инлайн кнопках. Зачем?").
  const catSummary = uniqueCategories(page as any[])
    .map((key) => {
      const c = CATEGORIES.find((x) => x.key === key);
      return c ? `${c.emoji} ${c.label}` : key;
    })
    .join(', ');
  const text =
    `📍 <b>Рядом с вами · ${radiusKm} км</b>\n\n` +
    `Нашлось <b>${page.length}</b> ${pluralNearby(page.length)}: ${catSummary}.\n` +
    (hasNext ? `Ещё есть — листайте ↩ • →` : ``) +
    `\n\n<i>Нажмите на любой объект — покажу фото и описание.</i>`;

  // Inline buttons: tap to open POI card
  const rows: any[][] = withDist.map((x, i) => [
    { text: `🗺 ${CATEGORIES.find((c) => c.key === (x.p as any).category)?.emoji ?? '📍'} ${truncateLabel(x.p.name)} · ${fmtDistance(x.d)}`, callback_data: `${CB.nbCard}:${i}` },
  ]);

  const nav: any[] = [];
  if (offset > 0) nav.push({ text: '◀️', callback_data: `${CB.nbPage}:${Math.max(0, offset - PAGE_SIZE)}` });
  if (hasNext) nav.push({ text: '▶️', callback_data: `${CB.nbPage}:${offset + PAGE_SIZE}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '📍 Новая локация', callback_data: CB.nbMore }]);
  rows.push([{ text: '🔙 В меню', callback_data: CB.navHome }]);

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard(rows) }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard(rows) });
    });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard(rows) });
  }

  for (const p of page) {
    void analytics
      .record({ type: 'poi_viewed', poiUuid: String((p as any).id), telegramChatId: ctx.chatId })
      .catch(() => {});
  }
}

function truncateLabel(s: string | null, max = 28): string { // Slightly shorter to fit with 🗺 emoji
  const t = s || 'Без названия';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function toManual(p: PoiRow): { id: string; name: string; lat: number; lon: number; category: string } {
  return {
    id: String(p.id),
    name: p.name || 'Без названия',
    lat: p.lat as number,
    lon: p.lon as number,
    category: p.category,
  };
}

/** Deduplicated list of categories from a POI page. */
function uniqueCategories(pois: { category: string }[]): string[] {
  return [...new Set(pois.map((p) => p.category))];
}

function pluralNearby(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'объект';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'объекта';
  return 'объектов';
}

