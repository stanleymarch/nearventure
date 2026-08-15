import { Bot } from 'grammy';
import { BotContext } from './types';
import { CB, keyboard } from './keyboards';
import { AnalyticsService } from '../analytics/analytics.service';

/**
 * Contribute / citizen-science funnel.
 *
 * After a route is built, the user is one nudge away from the project's higher
 * purpose (ARCHITECTURE §1): Nearventure routes people to interesting or
 * hard-to-reach places so they can document them — feeding OSM / Wikimedia /
 * offline 3D archives. This handler surfaces the concrete tools and a donate
 * path.
 *
 * No PII stored here — only a `contribute_opened` analytics signal.
 */
export function registerContributeHandlers(
  bot: Bot<BotContext>,
  analytics: AnalyticsService,
  opts: {
    /** Boosty donate URL (e.g. https://boosty.to/staniverse). */
    donateBoostyUrl?: string;
    /** CloudTips donate URL (e.g. https://pay.cloudtips.ru/p/XXXXXX). */
    donateCloudtipsUrl?: string;
  },
) {
  bot.callbackQuery(CB.rrContribute, async (ctx) => {
    await ctx.answerCallbackQuery();
    void analytics
      .record({ type: 'feedback_sent', telegramChatId: ctx.chatId, meta: { contribute: true } })
      .catch(() => {});

    const text = CONTRIBUTE_TEXT;
    const rows: any[][] = [
      [
        { text: '🌍 Rapid Editor (ПК)', url: 'https://rapideditor.org/edit' },
      ],
      [
        { text: '📱 StreetComplete', url: 'https://streetcomplete.app/' },
        { text: '📱 Every Door', url: 'https://every-door.app/' },
      ],
      [
        { text: '🗺 OsmAnd', url: 'https://osmand.net/' },
        { text: '📚 OSM вики-уроки', url: 'https://wiki.openstreetmap.org/wiki/RU:Beginners_Guide_1' },
      ],
    ];

    // Donate row (env-driven, never hardcoded).
    const donate: any[] = [];
    if (opts.donateBoostyUrl) {
      donate.push({ text: '💛 Boosty', url: opts.donateBoostyUrl });
    }
    if (opts.donateCloudtipsUrl) {
      donate.push({ text: '☁️ CloudTips', url: opts.donateCloudtipsUrl });
    }
    if (donate.length) rows.push(donate);

    rows.push([{ text: '🔙 К маршруту', callback_data: CB.ctrBack }]);

    await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: keyboard(rows) });
  });

  // "Back to route/menu" from the contribute block.
  bot.callbackQuery(CB.ctrBack, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('🔙 В меню.', {
      reply_markup: keyboard([[{ text: '🗺 Построить маршрут', callback_data: 'route:start', style: 'primary' }]]),
    });
  });
}

const CONTRIBUTE_TEXT = [
  '🌱 <b>Помогите сделать карту лучше</b>',
  '',
  'Маршруты Nearventure строятся из открытых данных — OpenStreetMap, Wikidata,',
  'Wikivoyage, ЕГРКН. Вы только что побывали (или собираетесь) в реальном месте.',
  'Каждая ваша правка делает этот сервис, и всю карту OSM, точнее — а OSM',
  'пользуются миллионы: путешественники, исследователи, спасатели, приложения.',
  '',
  '<b>С телефона — прямо в полях:</b>',
  '• <b>StreetComplete</b> — квесты «как называется эта улица?», простые вопросы.',
  '• <b>Every Door</b> — добавлять и править объекты (кафе, магазины, памятники).',
  '',
  '<b>Открываете GPX в OsmAnd?</b>',
  'Там есть встроенный редактор OSM — отметьте ошибку прямо на маршруте.',
  '',
  '<b>С компьютера:</b>',
  '• <b>Rapid Editor</b> — мощный онлайн-редактор с подложкой из спутника и AI.',
  '',
  'Фото мест можно загрузить в <b>Wikimedia Commons</b> (с лицензией) — они',
  'попадут и в карточки Nearventure. Спасибо, что делаете мир открытее! 🙏',
].join('\n');
