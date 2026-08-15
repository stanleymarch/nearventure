import { Bot, Context } from 'grammy';
import { InlineKeyboardMarkup } from '@grammyjs/types';
import type { BotSession } from './session';
import { SessionService } from './session.service';
import { CB, keyboard, safeEdit, esc } from './keyboards';
import { miniAppUrl } from './urls';
import { TelegramPoiCardService } from './poi-card.service';
import { BotRateLimiter } from './rate-limiter';
import type { BotContext } from './types';
import { pluralPoints } from './format';

/**
 * Guided walk-through (Экскурсовод) FSM.
 *
 * Flow:
 * 1. startGuide(s) → set GUIDE_WALKING, guideIndex=0 → send first POI location + "Я на месте"
 * 2. On "Я на месте" (gAtPoint) → reveal POI card → send next location → done
 * 3. On "Пропустить" (gSkip) → skip current POI → send next location
 * 4. On "Завершить" (gStop) → summary → GUIDE_DONE
 *
 * Note: Bot result → starts guide from session.lastRoute (no auth needed).
 * Miniapp preview → POST to /api/telegram/guide/start with initData + route.
 */

export function registerGuideHandlers(
  bot: Bot<BotContext>,
  sessions: SessionService,
  card: TelegramPoiCardService,
  limiter: BotRateLimiter,
) {
  // ── Start guide from bot auto-route result ─────────────────────────────
  bot.callbackQuery(CB.rrGuide, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (!s.lastRoute || !s.lastRoute.pois || s.lastRoute.pois.length === 0) {
      await ctx.reply('❌ Нет маршрута для экскурсии. Постройте новый — /start.');
      return;
    }
    await startGuide(ctx, s, sessions);
  });

  // ── Start guide from main menu (smart: lastRoute or empty state) ───────────────
  bot.callbackQuery(CB.gMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);

    if (s.lastRoute && s.lastRoute.pois && s.lastRoute.pois.length > 0) {
      const poiCount = s.lastRoute.pois.length;
      const totalMin = s.lastRoute.duration ? Math.round(s.lastRoute.duration / 60) : 0;
      await ctx.reply(
        `🗺 <b>Последний маршрут</b>\n\n` +
          `📍 ${poiCount} точек\n` +
          `⏱ ~${totalMin} минут\n\n` +
          `Начать экскурсию по этому маршруту?`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard([
            [
              { text: '▶ Начать', callback_data: CB.rrGuide, style: 'primary' },
              { text: '🔙 В меню', callback_data: CB.navHome },
            ],
          ]),
        },
      );
    } else {
      await ctx.reply(
        `🗺 <b>Для экскурсии нужен маршрут</b>\n\n` +
          `Сначала постройте маршрут — на карте или через «Маршрут за минуту».\n\n` +
          `Когда маршрут готов, вернитесь сюда — я поведу вас по точкам шаг за шагом.`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard([
            [
              { text: '🧭 Маршрут за минуту', callback_data: CB.startRoute, style: 'primary' },
              ...(miniAppUrl() ? [{ web_app: { url: miniAppUrl()! }, text: '🗺 На карте' }] : []),
            ],
            [{ text: '🔙 В меню', callback_data: CB.navHome }],
          ]),
        },
      );
    }
  });

  // ── "Я на месте" — reveal current POI and send next location ───────────
  bot.callbackQuery(/^guide:at:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const index = Number(ctx.match![1]);
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (s.step !== 'GUIDE_WALKING' || s.guideIndex !== index) {
      await safeEdit(
        ctx,
        s,
        '❌ Данные экскурсии повреждены. Начните заново — /start.',
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }
    await handleAtPoint(ctx, s, sessions, card, limiter);
  });

  // ── "Пропустить" — skip current POI and send next location ───────────────
  bot.callbackQuery(/^guide:skip:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const index = Number(ctx.match![1]);
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (s.step !== 'GUIDE_WALKING' || s.guideIndex !== index) {
      await safeEdit(
        ctx,
        s,
        '❌ Данные экскурсии повреждены. Начните заново — /start.',
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }
    await handleSkip(ctx, s, sessions);
  });

  // ── "Завершить" — end guide early ──────────────────────────────────────
  bot.callbackQuery(CB.gStop, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    if (s.step !== 'GUIDE_WALKING') return;
    // Delete last location message if exists.
    if (s.guideMessageId) {
      try {
        await ctx.api.deleteMessage(ctx.chatId!, s.guideMessageId);
      } catch {
        /* ignore */
      }
    }
    await endGuide(ctx, s, sessions);
  });

  // ── sendLocation handler (user replies with location) ───────────────────
  // Optional: can validate proximity, send distance hint. For now, rely on "Я на месте" tap.
}

/**
 * Start guided walk-through. Sets session to GUIDE_WALKING and sends first POI location.
 *
 * UX: we frame the start as an actual guided tour, not a list of pins. The
 * user sees a one-paragraph intro with the total route shape, then the
 * first location arrives with a "Точка 1 из 5" header. The next-POI hint
 * is sent as a separate text message so the user can read it before
 * tapping the map pin.
 */
export async function startGuide(
  ctx: BotContext,
  s: BotSession,
  sessions: SessionService,
): Promise<void> {
  s.step = 'GUIDE_WALKING';
  s.guideIndex = 0;
  s.guideMessageId = undefined;
  sessions.set(ctx.chatId!, s);

  const pois = s.lastRoute?.pois ?? [];
  const poiCount = pois.length;
  const totalMin = s.lastRoute?.duration ? Math.round(s.lastRoute.duration / 60) : 0;
  const totalKm = s.lastRoute?.distance ? (s.lastRoute.distance / 1000).toFixed(1) : '0';
  const first = pois[0]?.name;

  // Intro card: sets expectations, gives the count, names the first stop.
  // We send this as a fresh message (not safeEdit) because the user is
  // coming from the route summary; a new bubble reads as a new phase.
  await ctx.reply(
    `🧭 <b>Экскурсия началась</b>\n\n` +
      `Идём по маршруту: <b>${poiCount} ${pluralPoints(poiCount)}</b>, ` +
      `~${totalKm} км, ~${totalMin} мин.\n\n` +
      (first
        ? `Первая остановка: <b>${esc(first)}</b>. Сейчас пришлю точку на карте.`
        : `Сейчас пришлю первую точку на карте.`) +
      `\n\nКогда дойдёте — жмите <b>«Я на месте»</b>, и я расскажу, что здесь интересного.`,
    { parse_mode: 'HTML' },
  );
  sessions.set(ctx.chatId!, s);

  await sendNextLocation(ctx, s, sessions);
}

/**
 * Send location of current POI with "Я на месте" / "Пропустить" / "Завершить" buttons.
 * Also sends a separate "next hint" message naming the upcoming POI so the
 * user has a sense of the journey's shape, not just a pin.
 */
async function sendNextLocation(
  ctx: BotContext,
  s: BotSession,
  sessions: SessionService,
): Promise<void> {
  const pois = s.lastRoute?.pois ?? [];
  const idx = s.guideIndex ?? 0;
  const poi = pois[idx];
  if (!poi) {
    await endGuide(ctx, s, sessions);
    return;
  }

  const total = pois.length;
  const isLast = idx === total - 1;

  // Header text frames the current step. Sends BEFORE the map pin so
  // it scrolls into the chat top.
  const next = pois[idx + 1];
  const nextHint = isLast
    ? `\n\nЭто <b>последняя</b> остановка маршрута.`
    : next
    ? `\n\nСледующая: <b>${esc(next.name)}</b>.`
    : '';

  await ctx.reply(
    `📍 <b>Точка ${idx + 1} из ${total}</b>\n` +
      `Идём к: <b>${esc(poi.name)}</b>.` +
      nextHint,
    { parse_mode: 'HTML' },
  );
  sessions.set(ctx.chatId!, s);

  // The actual map pin with action buttons.
  const locMsg = await ctx.replyWithLocation(poi.lat, poi.lon, {
    reply_markup: locationKeyboard(idx, total),
  });

  s.guideMessageId = locMsg.message_id;
  sessions.set(ctx.chatId!, s);
}

/**
 * Handle "Я на месте" — reveal POI card and send next location.
 *
 * UX: the "Я на месте" tap is the moment the user has finished walking
 * to the POI. We want to acknowledge it ("Отлично!"), then deliver the
 * POI card, then preview what's next. All three happen in order; if
 * one fails (rate-limited photo), the rest still flow.
 */
async function handleAtPoint(
  ctx: BotContext,
  s: BotSession,
  sessions: SessionService,
  card: TelegramPoiCardService,
  limiter: BotRateLimiter,
): Promise<void> {
  // Delete last location message.
  if (s.guideMessageId) {
    try {
      await ctx.api.deleteMessage(ctx.chatId!, s.guideMessageId);
    } catch {
      /* ignore */
    }
    s.guideMessageId = undefined;
    sessions.set(ctx.chatId!, s);
  }

  const total = s.lastRoute?.pois?.length ?? 0;
  const idx = s.guideIndex ?? 0;
  const poi = s.lastRoute?.pois?.[idx];
  if (!poi) {
    await endGuide(ctx, s, sessions);
    return;
  }

  // Acknowledgement toast — small but it makes the bot feel alive.
  // `show_alert: false` keeps it as a quiet hint, not an interrupt.
  try {
    await ctx.answerCallbackQuery({ text: `Точка ${idx + 1}/${total}: ${poi.name}` });
  } catch {
    /* answerCallbackQuery races with the location-message delete above; safe to ignore */
  }

  // Show POI card (photo + description + attribution + link buttons).
  // Rate-limited photo upload — if hit, skip the photo but keep the guide flowing.
  if (limiter.try('media', ctx.from!.id)) {
    await ctx.replyWithChatAction('upload_photo');
    try {
      await card.sendPoiCard(ctx.api, ctx.chatId!, poi.id);
    } catch {
      // Card send failed (network, Telegram API, malformed POI data).
      // Fall back to a text-only card so the guide doesn't break mid-walk.
      await ctx
        .reply(`📍 <b>${esc(poi.name)}</b>\n\n<i>Не удалось загрузить карточку с фото. Описание доступно в каталоге.</i>`, {
          parse_mode: 'HTML',
        })
        .catch(() => {});
    }
  } else {
    await ctx
      .reply(`📍 <b>${esc(poi.name)}</b>\n\n<i>Фото временно недоступно — слишком много запросов.</i>`, {
        parse_mode: 'HTML',
      })
      .catch(() => {});
  }

  // Move to next POI.
  s.guideIndex = idx + 1;
  sessions.set(ctx.chatId!, s);

  if (s.guideIndex >= total) {
    await endGuide(ctx, s, sessions);
  } else {
    await sendNextLocation(ctx, s, sessions);
  }
}

/**
 * Handle "Пропустить" — skip current POI and send next location.
 *
 * UX: we don't try to be clever about skipped POIs (no running "X
 * skipped" counter). The user already tapped "skip"; announcing it is
 * noise. Just move on to the next location.
 */
async function handleSkip(
  ctx: BotContext,
  s: BotSession,
  sessions: SessionService,
): Promise<void> {
  // Delete last location message.
  if (s.guideMessageId) {
    try {
      await ctx.api.deleteMessage(ctx.chatId!, s.guideMessageId);
    } catch {
      /* ignore */
    }
    s.guideMessageId = undefined;
    sessions.set(ctx.chatId!, s);
  }

  // Move to next POI.
  s.guideIndex = (s.guideIndex ?? 0) + 1;
  sessions.set(ctx.chatId!, s);

  if (s.guideIndex >= (s.lastRoute?.pois?.length ?? 0)) {
    await endGuide(ctx, s, sessions);
  } else {
    await sendNextLocation(ctx, s, sessions);
  }
}

/**
 * End guide — show summary, offer GPX, contribute nudge.
 *
 * UX: the outro re-states what was actually walked (not the plan) so
 * the user feels the summary is honest, then offers the next thing.
 * We split visited/total intentionally: "3 из 5" reads as "I did
 * something real", "3" alone reads as "you missed stuff".
 */
async function endGuide(ctx: BotContext, s: BotSession, sessions: SessionService): Promise<void> {
  s.step = 'GUIDE_DONE';

  const visited = s.guideIndex ?? 0;
  const total = s.lastRoute?.pois?.length ?? 0;
  const distanceKm = s.lastRoute?.distance ? (s.lastRoute.distance / 1000).toFixed(1) : '0';
  const durationMin = s.lastRoute?.duration ? Math.round(s.lastRoute.duration / 60) : 0;
  const missed = total - visited;

  const summary =
    `🎉 <b>Экскурсия завершена</b>\n\n` +
    `📍 Прошли: <b>${visited} из ${total}</b> ${pluralPoints(total)}\n` +
    `📏 Дистанция маршрута: ${distanceKm} км\n` +
    `⏱ Заложенное время: ~${durationMin} мин` +
    (missed > 0 ? `\n\nПропустили ${missed} ${pluralPoints(missed)} — вернитесь, когда будет настроение.` : `\n\nВсе точки пройдены — поздравляю!`) +
    `\n\nСкачайте GPX, чтобы пройти маршрут ещё раз в навигаторе, или помогите проекту — мы добавляем новые места каждый месяц.`;

  await ctx.reply(summary, {
    parse_mode: 'HTML',
    reply_markup: keyboard([
      [{ text: '⬇ Скачать GPX', callback_data: CB.rrGpx, style: 'success' }],
      [{ text: '🌱 Помочь проекту', callback_data: CB.rrContribute }],
      [{ text: '🔙 В меню', callback_data: CB.navHome }],
    ]),
  });
  sessions.set(ctx.chatId!, s);
}

/**
 * Inline keyboard for location messages: "Я на месте" / "Пропустить" / "Завершить".
 */
function locationKeyboard(currentIndex: number, totalPois: number): InlineKeyboardMarkup {
  const atPoint = `${CB.gAtPoint}:${currentIndex}`;
  const skip = `${CB.gSkip}:${currentIndex}`;

  const rows: any[][] = [
    [{ text: '✅ Я на месте', callback_data: atPoint, style: 'primary' }],
    [{ text: '⏭ Пропустить', callback_data: skip }],
  ];

  if (currentIndex > 0 || totalPois > 1) {
    rows.push([{ text: '🏁 Завершить', callback_data: CB.gStop }]);
  }

  return keyboard(rows);
}