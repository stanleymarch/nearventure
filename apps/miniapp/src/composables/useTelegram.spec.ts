import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Tests for the Telegram Mini App composable. We mock window.Telegram.WebApp
 * with a minimal SDK surface (just what useTelegram touches) and assert:
 *  - init() registers ready()/expand() and reads theme
 *  - showBackButton guards against empty history (closes Mini App instead
 *    of a no-op router.back())
 *  - showBackButton cleanup offClick + hides
 *  - setMainButton cleanup removes the handler
 *  - setSecondaryButton cleanup removes the handler (and no-ops if SDK
 *    doesn't expose SecondaryButton — older Telegram)
 *  - openBot() uses initDataUnsafe.user.username when available and passes
 *    a /command deeplink
 *  - Falls back to a generic t.me link when no username is exposed
 */

type Handler = (...args: any[]) => any;

function makeWebApp(opts: {
  username?: string;
  withSecondaryButton?: boolean;
} = {}) {
  const handlers = new Map<string, Set<Handler>>();

  const eventOn = (event: string, cb: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(cb);
    return () => handlers.get(event)!.delete(cb);
  };

  const mkBtn = () => {
    const m: any = {
      _text: '',
      _cb: undefined as Handler | undefined,
      _visible: false,
      _progress: false,
      setText(t: string) { m._text = t; },
      setParams(p: any) {
        if (p.text !== undefined) m._text = p.text;
        if (p.is_visible !== undefined) m._visible = p.is_visible;
      },
      show() { m._visible = true; },
      hide() { m._visible = false; },
      onClick(cb: Handler) { m._cb = cb; },
      offClick(cb?: Handler) {
        if (!cb || m._cb === cb) m._cb = undefined;
      },
      showProgress() { m._progress = true; },
      hideProgress() { m._progress = false; },
    };
    return m;
  };

  const main = mkBtn();
  const back = mkBtn();
  const secondary = opts.withSecondaryButton === false ? undefined : mkBtn();

  const api: any = {
    initData: 'signed-payload',
    initDataUnsafe: opts.username
      ? { user: { id: 1, username: opts.username, first_name: 'A' } }
      : { user: { id: 1, first_name: 'A' } },
    colorScheme: 'light',
    version: '8.0',
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    openLink: vi.fn(),
    openTelegramLink: vi.fn(),
    onEvent: eventOn,
    offEvent: vi.fn(),
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
    MainButton: main,
    BackButton: back,
  };
  if (secondary) api.SecondaryButton = secondary;

  return { api, handlers, buttons: { main, back, secondary } };
}

function installWebApp(api: any) {
  (window as any).Telegram = { WebApp: api };
}

function uninstallWebApp() {
  delete (window as any).Telegram;
}

describe('useTelegram', () => {
  beforeEach(() => {
    uninstallWebApp();
    // Reset module-level init flag by re-importing the module fresh
    vi.resetModules();
  });

  afterEach(() => {
    uninstallWebApp();
  });

  describe('init', () => {
    it('calls ready() and expand() exactly once across multiple init() calls', async () => {
      const { api } = makeWebApp({ username: 'nearventure_bot' });
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');

      const t = useTelegram();
      t.init();
      t.init(); // idempotent
      t.init();
      expect(api.ready).toHaveBeenCalledTimes(1);
      expect(api.expand).toHaveBeenCalledTimes(1);
      expect(t.isInTelegram.value).toBe(true);
      expect(t.user.value?.first_name).toBe('A');
    });

    it('runs in fallback mode (no ready/expand) when Telegram is absent', async () => {
      uninstallWebApp();
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();
      expect(t.isInTelegram.value).toBe(false);
      expect(t.user.value).toBeNull();
    });
  });

  describe('showBackButton', () => {
    it('calls user callback when there is history', async () => {
      const { api, buttons } = makeWebApp();
      installWebApp(api);
      Object.defineProperty(window, 'history', {
        value: { state: { position: 1 }, length: 3 },
        writable: true,
        configurable: true,
      });
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      const cb = vi.fn();
      t.showBackButton(cb);
      expect(buttons.back._visible).toBe(true);
      expect(buttons.back._cb).toBeDefined();
      buttons.back._cb!();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('closes the Mini App instead of calling cb when history is empty', async () => {
      const { api, buttons } = makeWebApp();
      installWebApp(api);
      Object.defineProperty(window, 'history', {
        value: { state: { position: 0 }, length: 1 },
        writable: true,
        configurable: true,
      });
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      const cb = vi.fn();
      t.showBackButton(cb);
      buttons.back._cb!();
      expect(cb).not.toHaveBeenCalled();
      expect(api.close).toHaveBeenCalledTimes(1);
    });

    it('cleanup offClick and hides the button', async () => {
      const { api, buttons } = makeWebApp();
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      const cb = vi.fn();
      const cleanup = t.showBackButton(cb);
      expect(buttons.back._visible).toBe(true);
      cleanup();
      expect(buttons.back._cb).toBeUndefined();
      expect(buttons.back._visible).toBe(false);
    });
  });

  describe('setMainButton', () => {
    it('installs a click handler and returns a cleanup fn that offClicks', async () => {
      const { api, buttons } = makeWebApp();
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      const cb = vi.fn();
      const cleanup = t.setMainButton({ text: 'GO', onClick: cb });
      expect(buttons.main._text).toBe('GO');
      expect(buttons.main._visible).toBe(true);
      expect(buttons.main._cb).toBeDefined();
      cleanup();
      expect(buttons.main._cb).toBeUndefined();
    });
  });

  describe('setSecondaryButton', () => {
    it('installs on the SecondaryButton when SDK supports it', async () => {
      const { api, buttons } = makeWebApp({ withSecondaryButton: true });
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      const cb = vi.fn();
      const cleanup = t.setSecondaryButton({ text: '💬 К боту', onClick: cb });
      expect(buttons.secondary._text).toBe('💬 К боту');
      expect(buttons.secondary._visible).toBe(true);
      cleanup();
      expect(buttons.secondary._cb).toBeUndefined();
    });

    it('no-ops gracefully when SDK has no SecondaryButton (older Telegram)', async () => {
      const { api } = makeWebApp({ withSecondaryButton: false });
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      // Should not throw; cleanup is also a no-op.
      const cleanup = t.setSecondaryButton({ text: 'X', onClick: () => {} });
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });

  describe('openBot', () => {
    it('closes the Mini App to return to the bot chat', async () => {
      const { api } = makeWebApp({ username: 'nearventure_bot' });
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      const ok = t.openBot('route');
      expect(ok).toBe(true);
      expect(api.close).toHaveBeenCalledTimes(1);
    });

    it('closes the Mini App when no command is passed', async () => {
      const { api } = makeWebApp({ username: 'nearventure_bot' });
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      t.openBot();
      expect(api.close).toHaveBeenCalledTimes(1);
    });

    it('closes the Mini App even when username is not exposed', async () => {
      const { api } = makeWebApp(); // no username
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      t.openBot('start');
      expect(api.close).toHaveBeenCalledTimes(1);
    });

    it('returns false when not in Telegram (no tg object)', async () => {
      uninstallWebApp();
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();
      expect(t.openBot('route')).toBe(false);
    });
  });

  describe('hideBackButton / hideMainButton / hideSecondaryButton', () => {
    it('hides each button independently', async () => {
      const { api, buttons } = makeWebApp();
      installWebApp(api);
      const { useTelegram } = await import('./useTelegram');
      const t = useTelegram();
      t.init();

      t.setMainButton({ text: 'X', onClick: () => {} });
      t.setSecondaryButton({ text: 'Y', onClick: () => {} });
      expect(buttons.main._visible).toBe(true);
      expect(buttons.secondary._visible).toBe(true);

      t.hideMainButton();
      t.hideSecondaryButton();
      expect(buttons.main._visible).toBe(false);
      expect(buttons.secondary._visible).toBe(false);
    });
  });
});
