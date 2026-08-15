import { Bot } from 'grammy';
import type { BotContext } from './types';
import { PoisService } from '../pois/pois.service';
import { CATEGORIES, esc } from './keyboards';
import { fmtDistance } from './format';
import { haversine } from './geo';

/**
 * Inline mode — user types @bot_name <query> in any chat.
 *
 * Searches POIs by name/category. Each result is an InlineQueryResultArticle
 * with a short description. Tapping sends a link card to the current chat.
 */
export function registerInlineHandlers(
  bot: Bot<BotContext>,
  pois: PoisService,
) {
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();

    // No query → show a help article prompting to search.
    if (!query) {
      await ctx.answerInlineQuery(
        [
          {
            type: 'article',
            id: 'help',
            title: '🔍 Поиск мест',
            description: 'Напишите название места или категорию',
            input_message_content: {
              message_text:
                '🗺 <b>Nearventure</b> — наберите @' +
                ctx.me.username +
                ' и название места, чтобы найти интересные объекты.',
              parse_mode: 'HTML',
            },
          },
        ],
        { cache_time: 0 },
      );
      return;
    }

    // Search POIs by name (and description) — limit to 20 for inline results.
    try {
      const res = await pois.list({
        search: query,
        limit: 20,
        sort: 'popularity',
      });

      if (res.items.length === 0) {
        await ctx.answerInlineQuery(
          [
            {
              type: 'article',
              id: 'empty',
              title: 'Ничего не найдено',
              description: `По запросу «${query}» ничего нет`,
              input_message_content: {
                message_text: `По запросу «${esc(query)}» ничего не нашлось. Попробуйте другое слово.`,
              },
            },
          ],
          { cache_time: 30 },
        );
        return;
      }

      // BOT-2: when the user has location enabled in inline mode, sort by distance.
      const hasLocation = !!ctx.inlineQuery.location;
      const userLoc = ctx.inlineQuery.location;

      const results = res.items
        .filter((p) => p.lat != null && p.lon != null)
        .map((p) => {
          const cat = CATEGORIES.find((c) => c.key === p.category);
          const shortDesc = (p.descRu || '').substring(0, 120);
          const distText =
            hasLocation && userLoc
              ? ` · ${fmtDistance(haversine(
                  { lat: userLoc.latitude, lon: userLoc.longitude },
                  { lat: p.lat!, lon: p.lon! },
                ))}`
              : '';
          return {
            poi: p,
            cat,
            shortDesc,
            distText,
            distance: hasLocation && userLoc
              ? haversine(
                  { lat: userLoc.latitude, lon: userLoc.longitude },
                  { lat: p.lat!, lon: p.lon! },
                )
              : Infinity,
          };
        })
        .sort((a, b) => a.distance - b.distance) // nearest first
        .slice(0, 20)
        .map(({ poi: p, cat, shortDesc, distText }) => ({
          type: 'article' as const,
          id: String(p.id),
          title: `${cat?.emoji ?? '📍'} ${p.name || 'Без названия'}`,
          description: (shortDesc || cat?.label || p.category) + distText,
          thumb_url: p.imageUrl || undefined,
          input_message_content: {
            message_text:
              `${cat?.emoji ?? '📍'} <b>${esc(p.name || 'Без названия')}</b>\n` +
              `${esc(cat?.label ?? p.category)}` +
              (shortDesc ? `\n\n${esc(shortDesc)}` : '') +
              (distText ? `\n📍 Рядом: ${distText.replace(' · ', '')}` : '') +
              `\n\n📍 <a href="https://yandex.ru/maps/?pt=${p.lon},${p.lat}&z=15&l=map">Открыть в картах</a>`,
            parse_mode: 'HTML' as const,
          },
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '📍 На карте',
                  url: `https://yandex.ru/maps/?pt=${p.lon},${p.lat}&z=15&l=map`,
                },
              ],
            ],
          },
        }));

      await ctx.answerInlineQuery(results, { cache_time: 60 });
    } catch (err: any) {
      console.error('[tg bot] inline query failed:', err?.message || err);
      await ctx.answerInlineQuery(
        [
          {
            type: 'article',
            id: 'error',
            title: '⚠️ Ошибка поиска',
            description: 'Попробуйте позже',
            input_message_content: {
              message_text: '⚠️ Не удалось выполнить поиск. Попробуйте позже.',
            },
          },
        ],
        { cache_time: 0 },
      );
    }
  });
}

