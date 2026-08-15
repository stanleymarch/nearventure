import { Injectable } from '@nestjs/common';

/**
 * In-memory fixed-window rate limiter for the Telegram bot.
 *
 * Keyed by Telegram `from.id` (the user), NOT chat id — so a group chat with
 * many users doesn't share one bucket. No persistence / no Redis: the bot is a
 * single process, and a reset on restart is acceptable (anti-abuse, not billing).
 *
 * This is "without registration": `from.id` is intrinsic to every Telegram
 * update, no account needed.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

type Action = 'route' | 'gpx' | 'media';

const LIMITS: Record<Action, { max: number; windowMs: number }> = {
  route: { max: 8, windowMs: 60 * 60 * 1000 }, // 8 route builds / hour
  gpx: { max: 15, windowMs: 60 * 60 * 1000 }, // 15 GPX / hour
  media: { max: 40, windowMs: 60 * 60 * 1000 }, // 40 photo cards / hour
};

@Injectable()
export class BotRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** True if the action is allowed (and counted); false if rate-limited. */
  try(action: Action, userId: string | number): boolean {
    const lim = LIMITS[action];
    const now = Date.now();
    const key = `${action}:${userId}`;
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + lim.windowMs };
      this.buckets.set(key, b);
    }
    if (b.count >= lim.max) return false;
    b.count += 1;
    return true;
  }

  /** Minutes until the bucket resets (for friendly messages). */
  resetInMin(action: Action, userId: string | number): number {
    const b = this.buckets.get(`${action}:${userId}`);
    if (!b) return 0;
    return Math.max(1, Math.ceil((b.resetAt - Date.now()) / 60000));
  }
}
