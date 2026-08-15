import { Bot } from 'grammy';
import type { InlineKeyboardButton } from '@grammyjs/types';
import { BotContext } from './types';
import { SessionService } from './session.service';
import { PoisService } from '../pois/pois.service';
import { LastRouteService } from './last-route.service';
import { CB, keyboard, safeEdit, wizardEscapeRow, copyTextButton } from './keyboards';
import { miniAppUrl } from './urls';
import { publicBaseUrl } from '../common/app-config';
import { richResetConfirm } from './rich-message';

/** Coverage label — project is ПФО-wide, expanding North next. */
const COVERAGE_LABEL = 'ПФО (Приволжский федеральный округ)';
const COVERAGE_NOTE =
  'Сейчас покрыт весь ПФО. Север (СЗФО) — в планах; пока ограничены ресурсами сервера.';

/**
 * /start, /help, /cancel, and the home menu (onboarding skill).
 *
 * Hero ≤6 lines, 3–5 verb-first buttons, one primary CTA. The "contribute"
 * CTA is intentionally NOT on /start (it shows up post-route, where intent is
 * high).
 */
export function registerStartHandlers(
  bot: Bot<BotContext>,
  sessions: SessionService,
  pois: PoisService,
  lastRoute: LastRouteService,
  donateOpts: { boostyUrl?: string; cloudtipsUrl?: string } = {},
) {
  // Cleanup helper — do it alongside every session reset so the Mini App
  // preview never shows a stale route from a previous session.
  const resetAll = (chatId: number) => {
    void lastRoute.clear(chatId).catch(() => {});
    return sessions.reset(chatId);
  };

  // ── /start ─────────────────────────────────────────────────────
  // Handle deep-link `t.me/<bot>?start=route_<id>` — the share Telegram
  // button in the web route detail opens the bot with this start_arg.
  // We send a link back to the public route page so the recipient can
  // open it. ctx.match is the part after `/start` (e.g. "route_abc").
  bot.command('start', async (ctx) => {
    const startArg = (ctx.match ?? '').toString().trim();
    const routeMatch = startArg.match(/^route_([A-Za-z0-9_-]+)$/);
    if (routeMatch) {
      const routeId = routeMatch[1];
      const publicUrl = publicBaseUrl();
      const s = sessions.get(ctx.chatId!, ctx.from);
      sessions.set(ctx.chatId!, s);
      if (!publicUrl) {
        await ctx.reply(
          '🗺 <b>Вам поделились маршрутом</b>\n\nПубличная ссылка сейчас не настроена.',
          { parse_mode: 'HTML', reply_markup: homeMenu() },
        );
        return;
      }
      // Frontend uses hash history (createWebHashHistory), so the route
      // detail lives at `/#/route/:id`. A bare `/route/:id` path would be
      // served by the SPA fallback but resolve to the home route (hash `#/`).
      const url = `${publicUrl}/#/route/${encodeURIComponent(routeId)}`;
      await ctx.reply(
        '🗺 <b>Вам поделились маршрутом</b>\n\nОткройте его по ссылке — ' +
          'там фото точек, GPX и карта.',
        {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗺 Открыть маршрут', url }],
              [{ text: '🔙 В меню', callback_data: CB.navHome }],
            ],
          },
        },
      );
      return;
    }
    const s = resetAll(ctx.chatId!);
    s.step = 'WELCOME';
    const hero = await heroText(pois);
    await ctx.reply(hero, {
      parse_mode: 'HTML',
      reply_markup: homeMenu(),
    });
  });

  // ── /help ──────────────────────────────────────────────────────
  bot.command('help', async (ctx) => {
    const s = sessions.get(ctx.chatId!, ctx.from);
    const msg = await ctx.reply(HELP_TEXT, {
      parse_mode: 'HTML',
      reply_markup: homeMenu(),
    });
    s.menuMessageId = msg.message_id;
    sessions.set(ctx.chatId!, s);
  });

  // ── /cancel ────────────────────────────────────────────────────
  bot.command('cancel', async (ctx) => {
    const s = resetAll(ctx.chatId!);
    const msg = await ctx.reply('🔄 Всё сбросил. Готовы к новому маршруту — нажимайте кнопку 👇', {
      reply_markup: homeMenu(),
    });
    s.menuMessageId = msg.message_id;
    sessions.set(ctx.chatId!, s);
  });

  // ── Home navigation ────────────────────────────────────────────
  bot.callbackQuery(CB.navHome, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = resetAll(ctx.chatId!);
    const hero = await heroText(pois);
    await safeEdit(ctx, s, hero, homeMenu());
    sessions.set(ctx.chatId!, s);
  });

  bot.callbackQuery(CB.navReset, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = resetAll(ctx.chatId!);
    await safeEdit(
      ctx,
      s,
      '🔄 Сбросил.',
      keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
    );
    sessions.set(ctx.chatId!, s);
  });

  // ── Inline-confirm reset (Pattern E — Undo from flow-patterns skill) ─
  // Surfaces a "are you sure?" dialog before destroying in-flight wizard
  // state. The user can cancel the cancel (nav:cancel:no) which leaves
  // the wizard intact — important because the only other path back to
  // the wizard is /start which calls sessions.reset() unconditionally.
  bot.callbackQuery(CB.navCancel, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Начать заново?' });
    const s = sessions.get(ctx.chatId!, ctx.from);
    await safeEdit(
      ctx,
      s,
      '🔄 <b>Начать заново?</b>\n\nНастройки маршрута, выбранные места и последний маршрут будут очищены.',
      keyboard([
        [
          { text: '✅ Да, сбросить', callback_data: CB.navCancelYes, style: 'danger' },
          { text: '↩ Отмена', callback_data: CB.navCancelNo },
        ],
      ]),
    );
    sessions.set(ctx.chatId!, s);
  });

  bot.callbackQuery(CB.navCancelYes, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Сброшено' });
    const s = resetAll(ctx.chatId!);
    await safeEdit(
      ctx,
      s,
      '🔄 Сбросил.',
      keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
    );
    sessions.set(ctx.chatId!, s);
  });

  bot.callbackQuery(CB.navCancelNo, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отменено' });
    // Re-render the home menu so the user is back where they were.
    const s = sessions.get(ctx.chatId!, ctx.from);
    const hero = await heroText(pois);
    await safeEdit(ctx, s, hero, homeMenu());
    sessions.set(ctx.chatId!, s);
  });
}

/** Home menu — primary CTA + feature buttons + escape. */
function homeMenu() {
  return keyboard([
    [{ text: '🗺 Построить маршрут', callback_data: CB.startRoute, style: 'primary' }],
    [
      { text: '📍 Найти рядом', callback_data: CB.startNearby },
      { text: '📂 Открыть каталог', callback_data: CB.mCatalog },
    ],
    [
      { text: '🚶 Начать экскурсию', callback_data: CB.gMenu },
      { text: '🌱 Помочь проекту', callback_data: CB.mDonate },
    ],
  ]);
}

/** Generate hero text with the REAL POI count from the DB (cached 10 min). */
let _countCache: { value: number; ts: number } | null = null;
const COUNT_CACHE_MS = 10 * 60 * 1000;

async function realPoiCount(pois: PoisService): Promise<number> {
  if (
    _countCache &&
    _countCache.value > 0 &&
    Date.now() - _countCache.ts < COUNT_CACHE_MS
  ) {
    return _countCache.value;
  }
  try {
    const { total } = await pois.count();
    if (total > 0) {
      _countCache = { value: total, ts: Date.now() };
    }
    return total;
  } catch {
    return _countCache?.value ?? 0;
  }
}

function fmtCount(n: number): string {
  return n.toLocaleString('ru-RU');
}

async function heroText(pois: PoisService): Promise<string> {
  const total = await realPoiCount(pois);
  const firstName = ''; // We don't have ctx.from on hero generation, but could add it.
  return [
    '👋 <b>Nearventure</b> — ваши микро-приключения рядом.',
    '',
    `У нас в базе <b>${fmtCount(total)}</b> мест по всему <b>${COVERAGE_LABEL}</b> —`,
    'старинные усадьбы, храмы, памятники, смотровые и просто красивые места.',
    '',
    'Выберите транспорт и время — я построю маршрут и подготовлю GPX,',
    'вам останется только поехать. Никакой подготовки, только впечатления. 🚲',
  ].join('\n');
}

const HELP_TEXT = [
  '📖 <b>Как это работает</b>',
  '',
  '▫️ <b>🗺 Построить маршрут</b> — укажите, где вы, транспорт и сколько времени есть.',
  '  Бот подберёт интересные места по пути и соберёт GPX для навигатора.',
  '',
  '▫️ <b>📍 Найти рядом</b> — пришлёте геолокацию — покажу всё, что есть вокруг.',
  '  Фото, описания, как добраться.',
  '',
  '▫️ <b>📂 Каталог</b> — все объекты в одном месте. Фильтры по категориям, поиск.',
  '',
  '▫️ <b>🚶 Экскурсия</b> — бот поведёт от точки к точке — просто идите,',
  '  а я рассказываю истории.',
  '',
  'Команды: /start — меню · /cancel — отмена.',
  '',
  'Есть вопросы или идеи? Пишите @staniverse 👋',
].join('\n');

// Route the help callback to the same text.
export function registerHelpCallback(
  bot: Bot<BotContext>,
  sessions: SessionService,
  donateOpts: { boostyUrl?: string; cloudtipsUrl?: string } = {},
) {
  bot.callbackQuery('nav:help', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    await safeEdit(ctx, s, HELP_TEXT, homeMenu());
    sessions.set(ctx.chatId!, s);
  });

  // Catalog → Mini App
  bot.callbackQuery(CB.mCatalog, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    const base = miniAppUrl();
    if (!base) {
      await safeEdit(
        ctx,
        s,
        '📂 <b>Каталог временно недоступен</b>\n\nПубличный URL Mini App не настроен.',
        keyboard([[{ text: '🔙 В меню', callback_data: CB.navHome }]]),
      );
      sessions.set(ctx.chatId!, s);
      return;
    }
    const url = `${base}#/catalog`;
    await safeEdit(
      ctx,
      s,
      '📂 <b>Каталог объектов</b>\n\nВсе достопримечательности ПФО — с фото, описаниями и фильтрами по категориям.',
      keyboard([
        [{ text: '📂 Открыть каталог', web_app: { url }, style: 'primary' }],
        [{ text: '🔙 В меню', callback_data: CB.navHome }],
      ]),
    );
    sessions.set(ctx.chatId!, s);
  });

  // Donate/contribute → plain HTML intro + dynamic donate links.
  bot.callbackQuery(CB.mDonate, async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = sessions.get(ctx.chatId!, ctx.from);
    const text = [
      '🌱 <b>Помочь проекту</b>',
      '',
      'Nearventure — открытый проект на открытых данных (OSM, Wikidata, ЕГРКН).',
      'Ваша поддержка помогает развивать маршруты, наполнять базу и держать сервер запущенным.',
      '',
      `Покрытие: <b>${COVERAGE_LABEL}</b>. ${COVERAGE_NOTE}`,
      '',
      'Можно помочь правками карт или поддержать рублём.',
    ].join('\n');

    const rows: InlineKeyboardButton[][] = [
      [{ text: '🗺 Помочь с картами', callback_data: CB.rrContribute }],
    ];
    const donateLinks: InlineKeyboardButton[] = [];
    if (donateOpts.boostyUrl) {
      donateLinks.push({ text: '💛 Boosty', url: donateOpts.boostyUrl });
    }
    if (donateOpts.cloudtipsUrl) {
      donateLinks.push({ text: '☁️ CloudTips', url: donateOpts.cloudtipsUrl });
    }
    if (donateLinks.length) rows.push(donateLinks);
    rows.push([copyTextButton('📋 Скопировать ссылку на бота', 'https://t.me/nearventure_bot')]);
    rows.push(wizardEscapeRow());

    await safeEdit(ctx, s, text, keyboard(rows));
    sessions.set(ctx.chatId!, s);
  });

}
