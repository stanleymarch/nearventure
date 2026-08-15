import { InlineKeyboard } from 'grammy';
import type { InlineKeyboardMarkup } from '@grammyjs/types';
import type { BotContext } from './types';
import type { BotSession } from './session';

/** Re-export so handlers import markup type from one place. */
export type { InlineKeyboardMarkup };
export const CB = {
  navHome: 'nav:home',
  navReset: 'nav:reset',
  startRoute: 'route:start',
  startNearby: 'nearby:start',
  // wizard steps
  rSetTransport: 'route:tr', // +transport
  rBiketype: 'route:bt', // +biketype
  rSetTime: 'route:tm', // +minutes
  rToggleCat: 'route:cat', // +category
  rCatsDone: 'route:catdone',
  rSetMode: 'route:md', // +mode(auto/manual)
  rToggleLoop: 'route:loop', // toggle loop (return to start) on/off
  rLocText: 'route:loctext',
  rRequestLoc: 'route:reqloc',
  // nearby
  nbPage: 'nearby:page', // +offset
  nbCard: 'nearby:card', // +index → POI detail card
  nbBack: 'nearby:back', // back to list (no arg)
  nbMore: 'nearby:more', // request new location
  nbLocShare: 'nearby:locshare', // +index → send POI location
  nbCatFilter: 'nearby:catfilter', // +category → filter list by category
  nbRadius: 'nearby:rad', // +meters
  nbCat: 'nearby:cat', // +category toggle
  nbCatsDone: 'nearby:catdone',
  // main menu extras
  mCatalog: 'menu:catalog',
  mDonate: 'menu:donate',
  // route result
  // route result
  rrGpx: 'route:gpx',
  rrContribute: 'route:contribute',
  // draft integration (Task 17)
  rrOpen: 'route:open',
  rrRegenerate: 'route:regenerate',
  rrSmartFix: 'route:smartfix',
  // guide (экскурсовод)
  rrGuide: 'guide:start',
  gMenu: 'guide:menu',
  gAtPoint: 'guide:at',
  gSkip: 'guide:skip',
  gStop: 'guide:stop',
  // contribute block
  ctrBack: 'ctr:back',
  // route wizard navigation
  rBackToCats: 'route:backcats',
  // reset with inline confirm (Pattern E — Undo)
  navCancel: 'nav:cancel',
  navCancelYes: 'nav:cancel:yes',
  navCancelNo: 'nav:cancel:no',
} as const;

export const TRANSPORTS: { key: 'foot' | 'bike' | 'car'; label: string; emoji: string }[] = [
  { key: 'bike', label: 'Велосипед', emoji: '🚲' },
  { key: 'foot', label: 'Пешком', emoji: '🚶' },
  { key: 'car', label: 'Авто', emoji: '🚗' },
];

export const BIKE_TYPES: { key: 'bike' | 'mtb'; label: string; emoji: string }[] = [
  { key: 'bike', label: 'Городской / шоссейный', emoji: '🚴' },
  { key: 'mtb', label: 'Горный (MTB)', emoji: '⛰️' },
];

export const TIMES: { minutes: number; label: string }[] = [
  { minutes: 30, label: '30 мин' },
  { minutes: 60, label: '1 ч' },
  { minutes: 120, label: '2 ч' },
  { minutes: 180, label: '3 ч' },
  { minutes: 240, label: '4 ч' },
];

export const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: 'heritage', label: 'Наследие', emoji: '🏛' },
  { key: 'monument', label: 'Монументы', emoji: '🎖' },
  { key: 'sights', label: 'Достопримечательности', emoji: '🌟' },
  { key: 'religion', label: 'Религия', emoji: '⛪' },
  { key: 'nature', label: 'Природа', emoji: '🌲' },
  { key: 'museum', label: 'Музеи', emoji: '🖼' },
];

/**
 * grammy InlineKeyboard has no native `style`/`icon_custom_emoji_id` setters,
 * so for the styled buttons (Bot API 8.0+) we build raw markup. `style` is one
 * of 'danger' | 'success' | 'primary' — see find-docs (InlineKeyboardButton.style).
 */

import type { InlineKeyboardButton } from '@grammyjs/types';

/**
 * Edit the inline message a callback button was pressed on; fall back to a
 * fresh reply when that bubble can't be edited (older than 48h, deleted, or not
 * editable). Tracks the active menu message id on the session so later
 * navigations can recover the right bubble.
 *
 * Anti-patterns #1 — edit-in-place instead of stacking a new message + keyboard
 * on every screen change.
 */
export async function safeEdit(
  ctx: BotContext,
  session: BotSession | undefined,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<number | undefined> {
  const opts: any = { parse_mode: 'HTML' };
  if (replyMarkup) opts.reply_markup = replyMarkup;

  const isNotModified = (e: unknown): boolean =>
    /not modified/i.test(String((e as { message?: string })?.message ?? ''));

  // 1. Edit the message the user actually tapped (the correct target).
  try {
    const res: any = await ctx.editMessageText(text, opts);
    const id =
      res && typeof res === 'object' && 'message_id' in res
        ? (res as { message_id: number }).message_id
        : undefined;
    if (session && id) session.menuMessageId = id;
    return id;
  } catch (e) {
    // Identical content — nothing to change, do NOT send a duplicate reply.
    if (isNotModified(e)) return session?.menuMessageId;
    /* tapped message not editable — try the tracked menu bubble below */
  }

  // 2. Recover by editing the tracked menu message, if we still have one.
  if (session?.menuMessageId) {
    try {
      await ctx.api.editMessageText(ctx.chatId!, session.menuMessageId, text, opts);
      return session.menuMessageId;
    } catch (e) {
      if (isNotModified(e)) return session.menuMessageId;
      /* tracked bubble gone too — send a new one */
    }
  }

  // 3. Last resort: a fresh message. Remember it for next time.
  const msg = await ctx.reply(text, opts);
  if (session) session.menuMessageId = msg.message_id;
  return msg.message_id;
}

export function keyboard(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

/**
 * Markup that asks Telegram to drop any currently-attached reply keyboard
 * from the chat. The user has either completed the step that needed the
 * keyboard (e.g. shared a location) or moved on, and a stale
 * "📍 Отправить геолокацию" button sitting in the chat forever is exactly
 * the kind of "this bot feels broken" UX the user reported.
 *
 * Use as the `reply_markup` of the very next message after a flow that
 * used a request_location / request_contact keyboard.
 */
export const removeReplyKeyboard: InlineKeyboardMarkup = {
  inline_keyboard: [], // Inline-only marker; the real flag is on the options.
} as unknown as InlineKeyboardMarkup;

/**
 * Best-effort: delete the message the user just replied to. Used when a
 * reply-keyboard prompt is fulfilled — the request_location message has
 * served its purpose and shouldn't linger in the chat as a dead artefact.
 * No-ops if the message is already gone or too old to delete.
 */
export async function deleteIfPossible(
  ctx: BotContext,
  messageId: number | undefined,
): Promise<void> {
  if (!messageId) return;
  try {
    await ctx.api.deleteMessage(ctx.chatId!, messageId);
  } catch {
    /* ignore — message is gone or not ours to delete */
  }
}

/**
 * Build a "copy text" inline button (Bot API 9.4+). The user gets a
 * native OS clipboard prompt with the supplied text — useful for
 * shareable URLs, route IDs, command deep-links, etc.
 *
 * Why this matters: previously users had to long-press the message text,
 * select all, copy — 4 taps. With copy_text, it's 1 tap. Pattern from
 * the telegram-bot-ui skill: save the user work.
 */
export function copyTextButton(label: string, text: string): InlineKeyboardButton {
  // InlineKeyboardButton.CopyTextButtonButton shape; use a narrow cast
  // because grammy's union type narrows awkwardly when constructed
  // dynamically. The runtime JSON is identical.
  return { text: label, copy_text: { text } } as unknown as InlineKeyboardButton;
}

/**
 * Standard escape row: 2 buttons — “back to home” (safe) and
 * “❌ Reset current flow” (destructive, with inline-confirm via
 * nav:cancel). Use at the bottom of every wizard step.
 */
export function wizardEscapeRow(): InlineKeyboardButton[] {
  return [
    { text: '🔙 В меню', callback_data: CB.navHome },
    { text: '❌ Сбросить', callback_data: CB.navCancel, style: 'danger' },
  ];
}

/** Kirov city center — a sensible default when the user types a place name. */
export const KIROV_CENTER = { lat: 58.6035, lon: 49.6679 };

/** Escape HTML for parse_mode:'HTML'. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Transport speed (km/h) — used to translate time → radius for fallback. */
export const SPEED_KMH: Record<string, number> = { foot: 5, bike: 15, mtb: 12, car: 40 };

export const RADII: { meters: number; label: string }[] = [
  { meters: 1000, label: '1 км' },
  { meters: 3000, label: '3 км' },
  { meters: 5000, label: '5 км' },
  { meters: 10000, label: '10 км' },
];

export { InlineKeyboard };
