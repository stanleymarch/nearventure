import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Telegram WebApp initData validation (HMAC-SHA256 per Bot API docs).
 *
 * Used to (a) authenticate Mini App requests — proving the payload really came
 * from Telegram, not a spoofed client — and (b) extract the originating chatId
 * so the bot can act on behalf of that user (e.g. start the guided walk).
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  get botToken(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  /**
   * Validate a raw initData string. Returns the parsed fields on success,
   * null otherwise.
   */
  /**
   * Maximum lifetime of a Telegram initData payload. Telegram's own
   * specification allows the server to reject payloads older than this
   * many seconds to prevent replay attacks (e.g. the same initData
   * being replayed a day later). The WebApp generates a fresh
   * auth_date on every open; anything beyond 24 hours is either a
   * replay or a clock-drifted device.
   */
  private static readonly MAX_INIT_DATA_AGE_S = 24 * 60 * 60;

  validate(initData: string): ParsedInitData | null {
    const token = this.botToken;
    if (!token || !initData) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const authDateRaw = params.get('auth_date');
    params.delete('hash');
    if (!hash) return null;

    // Replay guard: initData older than 24 h is stale.
    if (authDateRaw) {
      const authDate = Number(authDateRaw);
      if (
        !Number.isFinite(authDate) ||
        Date.now() / 1000 - authDate > TelegramAuthService.MAX_INIT_DATA_AGE_S
      ) {
        return null;
      }
    }

    // data_check_string: sorted "key=value\n" lines.
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
    const calc = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    try {
      const a = Buffer.from(calc);
      const b = Buffer.from(hash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
      return null;
    }

    // Parse user + chat.
    let user: TelegramInitUser | null = null;
    const userRaw = params.get('user');
    if (userRaw) {
      try {
        user = JSON.parse(userRaw);
      } catch {
        return null;
      }
    }
    return {
      chatId: user?.id ?? null,
      user,
      startParam: params.get('start_param') ?? undefined,
      authDate: authDateRaw ? Number(authDateRaw) : undefined,
    };
  }
}

export interface TelegramInitUser {
  id: number; // chatId for private chats
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ParsedInitData {
  chatId: number | null;
  user: TelegramInitUser | null;
  startParam?: string;
  authDate?: number;
}
