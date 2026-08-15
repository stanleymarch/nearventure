/**
 * Theme bridge — syncs Telegram's theme (hex) into Nearventure's --nv-* tokens
 * (RGB triples) at runtime, so the existing Tailwind color layer keeps working
 * without changes. Brand accents (primary/secondary/tertiary) stay constant.
 *
 * See docs/TELEGRAM_MINIAPP_PLAN.md §7 and telegram-mini-app-skill §5.
 */
import type { TelegramWebApp, ThemeParams } from '@/types/telegram';

/** Map a Telegram theme hex → "r g b" triple string. Returns null if invalid. */
function hexToTriple(hex?: string): string | null {
  if (!hex || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Which --nv-* token each Telegram theme key should drive (surfaces only). */
const SURFACE_MAP: Array<[keyof ThemeParams, string]> = [
  ['bg_color', '--nv-bg'],
  ['text_color', '--nv-on-bg'],
  ['text_color', '--nv-on-surface'],
  ['secondary_bg_color', '--nv-surface-low'],
  ['section_bg_color', '--nv-surface-lowest'],
  ['section_separator_color', '--nv-outline-variant'],
  ['subtitle_text_color', '--nv-on-surface-variant'],
  ['hint_color', '--nv-on-surface-variant'],
  ['section_header_text_color', '--nv-on-surface-variant'],
  ['destructive_text_color', '--nv-error'],
  ['link_color', '--nv-secondary'],
  ['accent_text_color', '--nv-primary'],
];

let installed = false;

export function installThemeBridge(tg: TelegramWebApp) {
  applyTheme(tg);
  applySafeAreas(tg);
  if (installed) return;
  installed = true;

  tg.onEvent('themeChanged', () => applyTheme(tg));
  tg.onEvent('safeAreaChanged', () => applySafeAreas(tg));
  tg.onEvent('contentSafeAreaChanged', () => applySafeAreas(tg));
}

function applyTheme(tg: TelegramWebApp) {
  const root = document.documentElement;
  const params = tg.themeParams || {};

  // Drive surface tokens from Telegram's theme.
  for (const [src, dst] of SURFACE_MAP) {
    const triple = hexToTriple(params[src]);
    if (triple) root.style.setProperty(dst, triple);
  }

  // Toggle dark brand-accent variant based on Telegram's color scheme.
  root.classList.toggle('tg-dark', tg.colorScheme === 'dark');

  // Branded background + header — feels Nearventure, not generic Telegram.
  // (Skill §5: setHeaderColor/setBackgroundColor give a cohesive look.)
  try {
    tg.setBackgroundColor?.(params.bg_color || '#fff8f6');
    tg.setHeaderColor?.(params.bg_color || '#fff8f6');
  } catch {
    /* some platforms reject these — non-fatal */
  }
}

/** Hybrid safe-area math (skill §13): combine system + Telegram content insets. */
function applySafeAreas(tg: TelegramWebApp) {
  const top = Math.max(
    48,
    (tg.contentSafeAreaInset?.top || 0) + (tg.safeAreaInset?.top || 0),
  );
  const bottom = Math.max(
    32,
    (tg.contentSafeAreaInset?.bottom || 0) + (tg.safeAreaInset?.bottom || 0),
  );
  const root = document.documentElement;
  root.style.setProperty('--safe-top', `${top}px`);
  root.style.setProperty('--safe-bottom', `${bottom}px`);
}
