/**
 * Rich Message builders — Bot API 10.1 (released September 2025).
 *
 * Telegram's modern message format supports structured blocks: headings
 * (## ...), paragraphs, dividers (---), and rich formatting tags
 * (<b>, <i>, <u>, <tg-emoji>, <tg-spoiler>, …). Clients render these as
 * native UI elements instead of the raw HTML echo we get with
 * parse_mode: 'HTML'.
 *
 * We use the HTML dialect of rich messages (most readable in source,
 * closest to what we already do with esc()). The helper is typed against
 * `InputRichMessage` from @grammyjs/types.
 *
 * Anti-pattern note: rich messages are 32 KB max and 500 blocks max per
 * message. Our builders stay well under both limits (a route summary
 * with 10 POIs is ~12 blocks, ~1.5 KB).
 */
import type { InputRichMessage } from '@grammyjs/types';
import { CATEGORIES, esc } from './keyboards';

/**
 * Build a rich message by concatenating blocks separated by blank lines.
 * Caller passes already-escaped HTML fragments.
 */
function rich(html: string): InputRichMessage {
  return { html };
}

/** Heading level 2 — equivalent to `## Title` in Markdown. */
function h2(text: string): string {
  return `<h2>${esc(text)}</h2>`;
}

/** Heading level 3 — `### Sub`. */
function h3(text: string): string {
  return `<h3>${esc(text)}</h3>`;
}

/** Plain paragraph (renders as <p>). */
function p(text: string): string {
  return `<p>${text}</p>`;
}

/** Inline rich span. We expose this so callers can wrap <b>/<i>/<u>. */
function span(text: string): string {
  return text;
}

/** Horizontal divider. */
function divider(): string {
  return '<hr/>';
}

/** Build the route-result summary. */
export function richRouteSummary(opts: {
  distanceKm: number;
  durationMin: number;
  ascendM: number;
  descendM: number;
  pois: Array<{ name: string; category: string }>;
}): InputRichMessage {
  const asc = Math.round(opts.ascendM);
  const desc = Math.round(opts.descendM);
  const dur = opts.durationMin;
  const durLabel =
    dur >= 60 ? `${Math.floor(dur / 60)} ч ${dur % 60} мин` : `${dur} мин`;

  let body =
    h2('🗺 Маршрут готов') +
    divider() +
    p(
      `📏 <b>${opts.distanceKm.toFixed(1)} км</b>  ·  ⏱ <b>${durLabel}</b><br/>` +
        `⬆️ набор <b>${asc} м</b>  ·  ⬇️ спуск <b>${desc} м</b>`,
    );

  if (opts.pois.length > 0) {
    body += divider() + h3(`По пути (${opts.pois.length})`);
    for (const poi of opts.pois) {
      const cat = CATEGORIES.find((c) => c.key === poi.category);
      const icon = cat?.emoji ?? '📍';
      body += p(`${icon} <b>${esc(poi.name)}</b>`);
    }
  } else {
    body += p('<i>Не нашлось мест по пути — попробуйте другие категории.</i>');
  }
  return rich(body);
}

/** Compact "what changed" message — used by the reset confirm. */
export function richResetConfirm(): InputRichMessage {
  return rich(
    h2('🔄 Начать заново?') +
      p('Настройки маршрута, выбранные места и последний маршрут будут очищены.'),
  );
}

// Re-export the low-level builders so tests can use them directly.
export const builders = { rich, h2, h3, p, span, divider };
