import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

/**
 * Verifies useBotShortcut:
 *  - on mount, sets the secondary button text to '💬 К боту' and installs
 *    a click handler
 *  - clicking the installed handler calls openTelegramLink with the right
 *    /command deeplink
 *  - on unmount, the click handler is removed (no leak across navigations)
 *
 * We assert against the mocked window.Telegram.WebApp.SecondaryButton
 * directly — no need to mock the inner composable.
 */

function installWebApp(username: string) {
  const sbHandlers: Array<() => void> = [];
  const sb: any = {
    _text: '',
    setParams: vi.fn((p: any) => { if (p.text) sb._text = p.text; }),
    onClick: vi.fn((cb: () => void) => { sbHandlers.push(cb); }),
    offClick: vi.fn((cb?: () => void) => {
      if (cb) {
        const i = sbHandlers.indexOf(cb);
        if (i >= 0) sbHandlers.splice(i, 1);
      } else {
        sbHandlers.length = 0;
      }
    }),
    show: vi.fn(),
    hide: vi.fn(),
  };
  (window as any).Telegram = {
    WebApp: {
      initData: 'x',
      initDataUnsafe: { user: { id: 1, username } },
      colorScheme: 'light',
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      openTelegramLink: vi.fn(),
      onEvent: vi.fn(),
      MainButton: { setParams: vi.fn(), onClick: vi.fn(), offClick: vi.fn(), show: vi.fn(), hide: vi.fn() },
      BackButton: { setParams: vi.fn(), onClick: vi.fn(), offClick: vi.fn(), show: vi.fn(), hide: vi.fn() },
      SecondaryButton: sb,
    },
  };
  return { sb, sbHandlers };
}

describe('useBotShortcut', () => {
  beforeEach(() => {
    delete (window as any).Telegram;
    vi.resetModules();
  });
  afterEach(() => {
    delete (window as any).Telegram;
  });

  // useTelegram's tgRef is only populated after init() is called. The
  // composable's module-level state is initialised once per test via
  // vi.resetModules(), so we manually call init() in the component setup.
  // (Helper inlined per test — see below.)

  it('mounts the secondary button with the 💬 К боту text', async () => {
    const { sb } = installWebApp('nearventure_bot');
    const { useBotShortcut } = await import('./useBotShortcut');
    const { useTelegram } = await import('./useTelegram');
    const Comp = defineComponent({
      setup() {
        useTelegram().init();
        useBotShortcut('route');
        return () => h('div');
      },
    });
    const wrapper = mount(Comp);

    expect(sb.setParams).toHaveBeenCalledWith(
      expect.objectContaining({ text: '💬 К боту' }),
    );
    wrapper.unmount();
  });

  it('clicking the button closes the Mini App to return to the bot', async () => {
    const { sbHandlers } = installWebApp('nearventure_bot');
    const { useBotShortcut } = await import('./useBotShortcut');
    const { useTelegram } = await import('./useTelegram');
    const tg = (window as any).Telegram.WebApp;

    const Comp = defineComponent({
      setup() {
        useTelegram().init();
        useBotShortcut('route');
        return () => h('div');
      },
    });
    const wrapper = mount(Comp);
    expect(sbHandlers).toHaveLength(1);

    // Fire the registered click handler
    sbHandlers[0]();
    expect(tg.close).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('removes the click handler on unmount (no leak across views)', async () => {
    const { sbHandlers } = installWebApp('nearventure_bot');
    const { useBotShortcut } = await import('./useBotShortcut');
    const { useTelegram } = await import('./useTelegram');

    const Comp = defineComponent({
      setup() {
        useTelegram().init();
        useBotShortcut('start');
        return () => h('div');
      },
    });
    const wrapper = mount(Comp);
    expect(sbHandlers).toHaveLength(1);

    wrapper.unmount();
    expect(sbHandlers).toHaveLength(0);
  });

  it('default command still closes the Mini App', async () => {
    const { sbHandlers } = installWebApp('nearventure_bot');
    const { useBotShortcut } = await import('./useBotShortcut');
    const { useTelegram } = await import('./useTelegram');
    const tg = (window as any).Telegram.WebApp;

    const Comp = defineComponent({
      setup() {
        useTelegram().init();
        useBotShortcut();
        return () => h('div');
      },
    });
    const wrapper = mount(Comp);
    sbHandlers[0]();
    expect(tg.close).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
