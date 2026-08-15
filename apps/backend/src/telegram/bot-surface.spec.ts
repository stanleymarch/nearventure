import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { installBotSurface } from './bot-surface';

/**
 * Verifies the discoverability surface is installed on bot boot:
 *  - setMyCommands is called twice (ru locale + default).
 *  - setChatMenuButton is called with a web_app pointing at the Mini App.
 *  - If setMyCommands throws, setChatMenuButton still runs.
 *  - If setChatMenuButton throws, the function resolves cleanly.
 *
 * These are pure best-effort calls — the bot must still come up if the API
 * rejects them (e.g. during rate limit windows). We never throw out of
 * installBotSurface.
 */

function makeApi(opts: {
  setMyCommandsImpl?: (cmds: any, opts?: any) => Promise<boolean>;
  setChatMenuButtonImpl?: (b: any) => Promise<boolean>;
} = {}) {
  return {
    setMyCommands: vi.fn((opts.setMyCommandsImpl ?? (async () => true)) as any),
    setChatMenuButton: vi.fn((opts.setChatMenuButtonImpl ?? (async () => true)) as any),
  } as any;
}

describe('installBotSurface', () => {
  // Most tests assume a public URL is configured (i.e. production-style
  // boot). The "skips when no PUBLIC_URL" test clears it explicitly.
  beforeEach(() => {
    process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://nearventure.test';
  });
  afterEach(() => {
    delete process.env.PUBLIC_URL;
    delete process.env.TELEGRAM_WEBHOOK_DOMAIN;
  });
  it('registers localised ru commands and a default set', async () => {
    const api = makeApi();
    const logger = new Logger('test');

    await installBotSurface(api, logger);

    expect(api.setMyCommands).toHaveBeenCalledTimes(2);

    const [ruCmds, ruOpts] = (api.setMyCommands as any).mock.calls[0];
    expect(ruOpts).toEqual({ language_code: 'ru' });
    expect(ruCmds.map((c: any) => c.command)).toEqual([
      'start', 'help', 'route', 'nearby', 'cancel',
    ]);
    // Russian labels are non-empty Cyrillic
    expect(ruCmds[0].description).toMatch(/[А-Яа-яЁё]/);

    const [defCmds, defOpts] = (api.setMyCommands as any).mock.calls[1];
    expect(defOpts).toBeUndefined();
    expect(defCmds.map((c: any) => c.command)).toEqual([
      'start', 'help', 'route', 'nearby', 'cancel',
    ]);
  });

  it('installs a web_app chat menu button pointing at the mini app', async () => {
    const api = makeApi();
    const logger = new Logger('test');

    await installBotSurface(api, logger);

    expect(api.setChatMenuButton).toHaveBeenCalledTimes(1);
    const [arg] = (api.setChatMenuButton as any).mock.calls[0];
    expect(arg.menu_button.type).toBe('web_app');
    expect(arg.menu_button.text).toMatch(/Nearventure/);
    expect(arg.menu_button.web_app.url).toBe('https://nearventure.test/tg/');
  });

  it('skips setChatMenuButton when PUBLIC_URL is not set (dev fallback would be dead)', async () => {
    delete process.env.PUBLIC_URL;
    delete process.env.TELEGRAM_WEBHOOK_DOMAIN;
    const api = makeApi();
    const logger = new Logger('test');

    await installBotSurface(api, logger);

    // Menu button NOT installed — better a missing button than a dead one.
    expect(api.setChatMenuButton).not.toHaveBeenCalled();
    // setMyCommands is independent of PUBLIC_URL.
    expect(api.setMyCommands).toHaveBeenCalledTimes(2);
  });

  it('continues to setChatMenuButton if setMyCommands throws', async () => {
    const api = makeApi({
      setMyCommandsImpl: async () => {
        throw new Error('429 Too Many Requests');
      },
    });
    const logger = new Logger('test');

    await installBotSurface(api, logger);

    // First call failed → logged → moved on
    expect(api.setMyCommands).toHaveBeenCalledTimes(1);
    // Menu button still installed
    expect(api.setChatMenuButton).toHaveBeenCalledTimes(1);
  });

  it('skips the second setMyCommands call if the first (locale) call throws', async () => {
    // Intent: if the localised call fails, we don't want to spam Telegram
    // with a redundant default call — one failure is enough signal. We log
    // and move on to setChatMenuButton.
    let calls = 0;
    const api = makeApi({
      setMyCommandsImpl: async () => {
        calls++;
        if (calls === 1) throw new Error('transient');
        return true;
      },
    });
    const logger = new Logger('test');

    await installBotSurface(api, logger);

    // First call failed → caught → second skipped
    expect(api.setMyCommands).toHaveBeenCalledTimes(1);
    // Menu button still installed
    expect(api.setChatMenuButton).toHaveBeenCalledTimes(1);
  });

  it('does not throw when setChatMenuButton fails', async () => {
    const api = makeApi({
      setChatMenuButtonImpl: async () => {
        throw new Error('network down');
      },
    });
    const logger = new Logger('test');

    await expect(installBotSurface(api, logger)).resolves.toBeUndefined();
  });
});
