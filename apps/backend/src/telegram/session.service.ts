import { Injectable, Logger } from '@nestjs/common';
import { BotSession, freshSession, isStale, GUIDE_TIMEOUT_MS } from './session';
import { TelegramUserService } from './telegram-user.service';

/**
 * In-memory session store keyed by chatId. Good enough for a single-process
 * bot; matches the architecture decision (bot in the NestJS process, no extra
 * RAM for a session DB).
 *
 * Also touches the TelegramUser row on every access (analytics + gamification)
 * and resets stale sessions on the fly (flow-patterns P4 timeout sweeper).
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly store = new Map<number, BotSession>();

  constructor(private readonly users: TelegramUserService) {}

  /** Get or create a session; resets it if stale. */
  get(chatId: number, from?: any): BotSession {
    let s = this.store.get(chatId);
    if (s) {
      // Guide steps walk 10–30 min between points — exempt them from the
      // 5-min flow timeout and allow the longer guide TTL instead.
      const stale =
        s.step === 'GUIDE_WALKING' || s.step === 'GUIDE_DONE'
          ? Date.now() - s.updatedAt >= GUIDE_TIMEOUT_MS
          : isStale(s);
      if (stale) {
        this.logger.log(`Session ${chatId} timed out — resetting.`);
        s = undefined;
      }
    }
    if (!s) {
      s = freshSession();
      this.store.set(chatId, s);
    }
    s.updatedAt = Date.now();
    if (from) {
      void this.users.touch(from).catch((e) =>
        this.logger.warn(`touch user ${chatId}: ${e.message}`),
      );
    }
    return s;
  }

  reset(chatId: number): BotSession {
    const s = freshSession();
    this.store.set(chatId, s);
    return s;
  }

  set(chatId: number, s: BotSession): void {
    s.updatedAt = Date.now();
    this.store.set(chatId, s);
  }
}
