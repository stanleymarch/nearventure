import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BotRateLimiter } from './rate-limiter';

describe('BotRateLimiter', () => {
  let limiter: BotRateLimiter;

  beforeEach(() => {
    limiter = new BotRateLimiter();
  });

  // ── within-limit ──────────────────────────────────────────────────────
  it('allows actions up to the configured max, then blocks', () => {
    // route limit is 8 / hour
    for (let i = 0; i < 8; i++) {
      expect(limiter.try('route', 'user-a')).toBe(true);
    }
    // 9th attempt → blocked
    expect(limiter.try('route', 'user-a')).toBe(false);
  });

  it('counts gpx separately from route (different action types)', () => {
    // Exhaust route for user-a
    for (let i = 0; i < 8; i++) limiter.try('route', 'user-a');
    expect(limiter.try('route', 'user-a')).toBe(false);

    // gpx still available (limit 15)
    expect(limiter.try('gpx', 'user-a')).toBe(true);
  });

  it('counts media separately from route and gpx', () => {
    // Exhaust route + gpx
    for (let i = 0; i < 8; i++) limiter.try('route', 'user-a');
    for (let i = 0; i < 15; i++) limiter.try('gpx', 'user-a');

    // media still available (limit 40)
    expect(limiter.try('media', 'user-a')).toBe(true);
  });

  // ── over-limit ────────────────────────────────────────────────────────
  it('blocks all further attempts once the limit is reached', () => {
    for (let i = 0; i < 8; i++) limiter.try('route', 'user-a');
    for (let i = 0; i < 5; i++) {
      expect(limiter.try('route', 'user-a')).toBe(false);
    }
  });

  // ── user isolation ────────────────────────────────────────────────────
  it('isolates users: user-a hitting route limit does not affect user-b', () => {
    for (let i = 0; i < 8; i++) limiter.try('route', 'user-a');
    expect(limiter.try('route', 'user-a')).toBe(false);
    expect(limiter.try('route', 'user-b')).toBe(true);
  });

  it('isolates action+user buckets: same user different actions are independent', () => {
    for (let i = 0; i < 8; i++) limiter.try('route', 'user-a');
    expect(limiter.try('gpx', 'user-a')).toBe(true);
    expect(limiter.try('media', 'user-a')).toBe(true);
  });

  // ── window reset ──────────────────────────────────────────────────────
  it('resets the bucket after the window expires', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Exhaust route limit
    for (let i = 0; i < 8; i++) limiter.try('route', 'user-a');
    expect(limiter.try('route', 'user-a')).toBe(false);

    // Advance time past the 1-hour window
    vi.setSystemTime(now + 61 * 60 * 1000);

    // Bucket should have reset — first try succeeds
    expect(limiter.try('route', 'user-a')).toBe(true);

    vi.useRealTimers();
  });

  it('does NOT reset before the window expires', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    for (let i = 0; i < 8; i++) limiter.try('route', 'user-a');
    expect(limiter.try('route', 'user-a')).toBe(false);

    // 59 minutes — still within the 1-hour window
    vi.setSystemTime(now + 59 * 60 * 1000);
    expect(limiter.try('route', 'user-a')).toBe(false);

    vi.useRealTimers();
  });

  // ── resetInMin helper ─────────────────────────────────────────────────
  it('resetInMin returns 0 for a non-existent bucket', () => {
    expect(limiter.resetInMin('route', 'nobody')).toBe(0);
  });

  it('resetInMin returns minutes until reset (at least 1)', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    limiter.try('route', 'user-a');
    const mins = limiter.resetInMin('route', 'user-a');
    expect(mins).toBeGreaterThanOrEqual(59);
    expect(mins).toBeLessThanOrEqual(60);

    vi.useRealTimers();
  });
});
