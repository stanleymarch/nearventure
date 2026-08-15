/**
 * useTelegram — thin reactive wrapper around the Telegram WebApp SDK.
 *
 * - Detects whether we're really inside Telegram (fallback for browser dev).
 * - Calls ready()/expand() once.
 * - Installs the theme bridge.
 * - Exposes typed helpers for MainButton / BackButton / haptic / popups that
 *   no-op gracefully outside Telegram.
 *
 * Usage: call `useTelegram().init()` once in App.vue onMounted, then use the
 * returned helpers in any screen.
 */
import { ref, shallowRef } from 'vue';
import type { TelegramWebApp, TelegramUser } from '@/types/telegram';
import { installThemeBridge } from './useThemeBridge';

/**
 * shallowRef — the Telegram WebApp object has read-only/non-configurable
 * properties (HapticFeedback, MainButton, …). A deep reactive `ref` wraps them
 * in a Proxy whose get-trap returns a different object reference → TypeError
 * "'get' on proxy: property is read-only". shallowRef keeps the object intact.
 */
const tgRef = shallowRef<TelegramWebApp | null>(null);
const isInTelegram = ref(false);
const user = ref<TelegramUser | null>(null);
const colorScheme = ref<'light' | 'dark'>('light');
let initialized = false;

export function useTelegram() {
  function init() {
    if (initialized) return;
    initialized = true;

    const tg = window.Telegram?.WebApp;
    if (!tg) {
      // Dev outside Telegram — fallback UI path.
      console.info('[tg] Running outside Telegram — fallback mode.');
      colorScheme.value =
        window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.classList.toggle('tg-dark', colorScheme.value === 'dark');
      return;
    }

    tgRef.value = tg;
    isInTelegram.value = Boolean(tg.initData);
    user.value = tg.initDataUnsafe?.user || null;
    colorScheme.value = tg.colorScheme || 'light';

    // Signal ready + expand BEFORE reading theme, so Telegram injects vars.
    tg.ready();
    tg.expand();

    // Sync theme + safe areas.
    installThemeBridge(tg);

    // Re-read color scheme on theme change.
    tg.onEvent('themeChanged', () => {
      colorScheme.value = tg.colorScheme || 'light';
    });
  }

  // ── MainButton ──────────────────────────────────────────────
  function setMainButton(opts: {
    text: string;
    onClick: () => void;
    color?: string; // hex
    textColor?: string;
    active?: boolean;
  }) {
    const tg = tgRef.value;
    if (!tg) return () => {};
    const cb = opts.onClick;
    tg.MainButton.setParams({
      text: opts.text,
      color: opts.color, // undefined → Telegram keeps default
      text_color: opts.textColor,
      is_active: opts.active ?? true,
      is_visible: true,
    });
    tg.MainButton.onClick(cb);
    return () => {
      tg.MainButton.offClick(cb);
    };
  }

  function hideMainButton() {
    tgRef.value?.MainButton.hide();
  }

  function mainButtonProgress(show: boolean) {
    const b = tgRef.value?.MainButton;
    if (!b) return;
    if (show) b.showProgress(true);
    else b.hideProgress();
  }

  // ── SecondaryButton (Bot API 7.7+ for Mini App) ───────────
  // Telegram exposes a second fixed bottom button alongside MainButton. We use
  // it for "secondary action" affordances (e.g. "💬 К боту" on the preview
  // screen — go back to the bot from anywhere in the Mini App). If the
  // runtime doesn't support it (older Telegram), we silently no-op.
  function setSecondaryButton(opts: {
    text: string;
    onClick: () => void;
    color?: string;
    textColor?: string;
    active?: boolean;
  }): () => void {
    const tg = tgRef.value as any;
    const sb = tg?.SecondaryButton;
    if (!sb) return () => {};
    const cb = opts.onClick;
    sb.setParams({
      text: opts.text,
      color: opts.color,
      text_color: opts.textColor,
      is_active: opts.active ?? true,
      is_visible: true,
    });
    sb.onClick(cb);
    return () => {
      try { sb.offClick(cb); } catch { /* SDK variant */ }
    };
  }

  function hideSecondaryButton() {
    const sb = (tgRef.value as any)?.SecondaryButton;
    sb?.hide();
  }

  // ── BackButton ──────────────────────────────────────────────
  //
  // The native Telegram BackButton only navigates inside the Mini App's own
  // history. If the user opened the app via a deeplink /startapp=... (i.e.
  // window.history.length is 1), tapping "back" has nothing to go to and
  // the user is left with only "✕ Close". We guard this case: at the SPA
  // root we close the Mini App instead — that's a more honest UX than
  // pretending to go back.
  function showBackButton(onClick: () => void) {
    const tg = tgRef.value;
    if (!tg) return () => {};
    tg.BackButton.show();
    const safe = () => {
      // vue-router (createWebHashHistory) tracks navigation depth in
      // history.state.position. window.history.length is unreliable in
      // Telegram WebView (often stuck at 1 even after SPA navigation),
      // which made the back button always close the app.
      const pos = window.history.state?.position ?? 0;
      if (pos > 0) {
        onClick();
      } else {
        tg.close();
      }
    };
    tg.BackButton.onClick(safe);
    return () => {
      tg.BackButton.offClick(safe);
      tg.BackButton.hide();
    };
  }

  function hideBackButton() {
    tgRef.value?.BackButton.hide();
  }

  // ── Haptics ─────────────────────────────────────────────────
  const haptic = {
    impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light') {
      tgRef.value?.HapticFeedback.impactOccurred(style);
    },
    notify(type: 'error' | 'success' | 'warning') {
      tgRef.value?.HapticFeedback.notificationOccurred(type);
    },
    selection() {
      tgRef.value?.HapticFeedback.selectionChanged();
    },
  };

  // ── Popups / alerts ─────────────────────────────────────────
  function alert(message: string): Promise<void> {
    return new Promise((resolve) => {
      if (tgRef.value) tgRef.value.showAlert(message, () => resolve());
      else {
        window.alert(message);
        resolve();
      }
    });
  }

  function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (tgRef.value) tgRef.value.showConfirm(message, (ok) => resolve(ok));
      else resolve(window.confirm(message));
    });
  }

  // ── Links / data ────────────────────────────────────────────
  function openLink(url: string) {
    tgRef.value?.openLink(url) ?? window.open(url, '_blank');
  }

  function openTelegramLink(url: string) {
    tgRef.value?.openTelegramLink(url);
  }

  /**
   * Open the chat with our bot from anywhere in the Mini App. The native
   * `openTelegramLink` switches to the chat without closing the Mini App
   * gracefully — the user lands in the chat and can return by tapping the
   * bot's MenuButton (= our Mini App launcher).
   *
   * `command` is optional: pass 'route' to deep-link a /command, which
   * Telegram will surface in the chat input.
   */
  function openBot(_command?: string): boolean {
    const tg = tgRef.value;
    if (!tg) return false;
    // Closing the Mini App returns the user to the bot chat — this is the
    // most reliable way to "go back to bot" across all Telegram platforms
    // (mobile, Web K, Web A). openTelegramLink does NOT close the Mini App
    // and in Web K it opens a browser tab instead of switching to the chat.
    try {
      tg.close();
      return true;
    } catch {
      return false;
    }
  }

  /** Raw initData string for backend HMAC validation (empty outside TG). */
  function initData(): string {
    return tgRef.value?.initData || '';
  }

  /** start_param from the launch deep link (t.me/bot/app?startapp=...). */
  function startParam(): string | undefined {
    return tgRef.value?.initDataUnsafe?.start_param;
  }

  return {
    init,
    tg: tgRef,
    isInTelegram,
    user,
    colorScheme,
    // buttons
    setMainButton,
    hideMainButton,
    mainButtonProgress,
    setSecondaryButton,
    hideSecondaryButton,
    showBackButton,
    hideBackButton,
    // feedback
    haptic,
    alert,
    confirm,
    // links/data
    openLink,
    openTelegramLink,
    openBot,
    initData,
    startParam,
  };
}
