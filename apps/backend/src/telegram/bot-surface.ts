import { Logger } from '@nestjs/common';
import type { Api } from 'grammy';
import { miniAppUrl } from './urls';

/**
 * One-time registration of the bot's "discoverability" surface — the parts
 * of the bot UI that exist before the user types anything.
 *
 * Extracted from TelegramModule so we can unit-test it with a mock Api
 * (without spinning up a full Nest DI container + a real Bot).
 *
 * What this sets:
 *  - setMyCommands (per-locale + default): the slash-command menu users see
 *    when typing "/" in chat. Without this, /start, /help, /route work but
 *    are undiscoverable.
 *  - setChatMenuButton: the persistent left-side "≡" button that opens the
 *    Mini App directly from any chat with the bot. Without this, the only
 *    way to reach the app is via inline `web_app` buttons in a bot message.
 *
 * Best-effort: if either call fails (rate limit, transient network, missing
 * scope in legacy bots), we log and move on. The bot still works; the user
 * just doesn't get the affordances until next boot.
 */
export async function installBotSurface(api: Api, logger: Logger): Promise<void> {
  await safeSetMyCommands(api, logger);
  await safeSetChatMenuButton(api, logger);
}

async function safeSetMyCommands(api: Api, logger: Logger): Promise<void> {
  try {
    // Localised menu (ru). Telegram picks the user's language_code to render
    // the appropriate labels; on a brand-new language we fall back to default.
    await api.setMyCommands(
      [
        { command: 'start',  description: 'Главное меню' },
        { command: 'help',   description: 'Как пользоваться ботом' },
        { command: 'route',  description: 'Построить маршрут' },
        { command: 'nearby', description: 'Что рядом со мной' },
        { command: 'cancel', description: 'Сбросить маршрут' },
      ],
      { language_code: 'ru' },
    );
    // Default (no language prefix) — for users with non-RU locale.
    await api.setMyCommands([
      { command: 'start',  description: 'Main menu' },
      { command: 'help',   description: 'How to use this bot' },
      { command: 'route',  description: 'Build a route' },
      { command: 'nearby', description: "What's nearby" },
      { command: 'cancel', description: 'Reset current flow' },
    ]);
    logger.log('setMyCommands ✓');
  } catch (e: any) {
    logger.warn(`setMyCommands failed: ${e.message}`);
  }
}

async function safeSetChatMenuButton(api: Api, logger: Logger): Promise<void> {
  // Guard: setting a menu button with a URL Telegram cannot reach is worse
  // than omitting it. PUBLIC_URL is the sole source of public bot links.
  try {
    const url = miniAppUrl();
    if (!url) {
      logger.warn('setChatMenuButton skipped: PUBLIC_URL is not configured.');
      return;
    }
    await api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: '🗺 Nearventure',
        web_app: { url },
      },
    });
    logger.log(`setChatMenuButton → ${url} ✓`);
  } catch (e: any) {
    logger.warn(`setChatMenuButton failed: ${e.message}`);
  }
}
