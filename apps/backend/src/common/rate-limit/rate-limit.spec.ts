import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpRateLimiter } from './http-rate-limiter';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimit } from './rate-limit.decorator';
import { RoutingController } from '../../routing/routing.controller';

/**
 * Release-CRIT rate limiting for public expensive routing endpoints:
 * per-IP fixed window with an actionable 429 + Retry-After header.
 */

describe('HttpRateLimiter', () => {
  beforeEach(() => {
    process.env.HTTP_RATE_LIMIT_MAX = '2';
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = '60000';
  });

  it('allows up to max requests then rejects with retry-after', () => {
    const limiter = new HttpRateLimiter();
    expect(limiter.try('route:127.0.0.1', 'route').allowed).toBe(true);
    expect(limiter.try('route:127.0.0.1', 'route').allowed).toBe(true);
    const denied = limiter.try('route:127.0.0.1', 'route');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('keys buckets per client (IP) and per action', () => {
    const limiter = new HttpRateLimiter();
    limiter.try('route:1.2.3.4', 'route');
    limiter.try('route:1.2.3.4', 'route');
    // Different IP is unaffected
    expect(limiter.try('route:5.6.7.8', 'route').allowed).toBe(true);
    // Different action is unaffected
    expect(limiter.try('plan:1.2.3.4', 'plan').allowed).toBe(true);
  });

  it('resets the window after windowMs elapses', () => {
    const limiter = new HttpRateLimiter();
    limiter.try('route:ip', 'route');
    limiter.try('route:ip', 'route');
    expect(limiter.try('route:ip', 'route').allowed).toBe(false);
    // Fast-forward the clock past the window.
    const future = Date.now() + 61_000;
    vi.spyOn(Date, 'now').mockReturnValue(future);
    expect(limiter.try('route:ip', 'route').allowed).toBe(true);
    vi.restoreAllMocks();
  });

  it('prunes expired buckets and refuses new keys when the map is saturated', () => {
    process.env.HTTP_RATE_LIMIT_MAX_BUCKETS = '3';
    const limiter = new HttpRateLimiter();

    // First two keys fit; the third saturates the cap.
    expect(limiter.try('route:1.1.1.1', 'route').allowed).toBe(true);
    expect(limiter.try('route:2.2.2.2', 'route').allowed).toBe(true);
    expect(limiter.try('route:3.3.3.3', 'route').allowed).toBe(true);
    expect(limiter.size).toBe(3);

    // A brand-new key at the cap is refused instead of growing the map.
    expect(limiter.try('route:4.4.4.4', 'route').allowed).toBe(false);
    expect(limiter.size).toBe(3);

    // Expired buckets are pruned, freeing room for new keys.
    const future = Date.now() + 61_000;
    vi.spyOn(Date, 'now').mockReturnValue(future);
    expect(limiter.try('route:4.4.4.4', 'route').allowed).toBe(true);
    vi.restoreAllMocks();
    expect(limiter.size).toBeLessThanOrEqual(3);

    delete process.env.HTTP_RATE_LIMIT_MAX_BUCKETS;
  });
});

describe('RateLimitGuard', () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXIES;
    delete process.env.HTTP_RATE_LIMIT_MAX_BUCKETS;
  });

  function makeGuard(limiter: HttpRateLimiter) {
    return new RateLimitGuard(limiter);
  }

  function makeContext(ip: string, path = '/routing/route') {
    const req: any = {
      ip,
      headers: {},
      route: { path },
    };
    const res: any = {
      setHeader: vi.fn(),
      getHeaders: () => ({}),
      status: vi.fn(),
      json: vi.fn(),
    };
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getHandler: () => (() => {}),
      getClass: () => class {},
    } as any;
  }

  it('throws 429 with Retry-After when the limit is exceeded', () => {
    process.env.HTTP_RATE_LIMIT_MAX = '1';
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = '60000';
    const guard = makeGuard(new HttpRateLimiter());

    const ctx1 = makeContext('9.9.9.9');
    expect(guard.canActivate(ctx1)).toBe(true);

    const ctx2 = makeContext('9.9.9.9');
    try {
      guard.canActivate(ctx2);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(String((e as HttpException).message)).toMatch(/Too many requests/);
      const res = ctx2.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
    }
  });

  it('uses the real socket peer when no trusted proxy is configured (dev)', () => {
    process.env.HTTP_RATE_LIMIT_MAX = '1';
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = '60000';
    delete process.env.TRUSTED_PROXIES;
    const guard = makeGuard(new HttpRateLimiter());

    // Spoofed single-value XFF from an untrusted peer is IGNORED.
    const ctx1 = makeContext('127.0.0.1');
    ctx1.switchToHttp().getRequest().headers['x-forwarded-for'] = '203.0.113.7';
    expect(guard.canActivate(ctx1)).toBe(true);
    // Same real peer with a DIFFERENT spoofed XFF still hits the same bucket.
    const ctx2 = makeContext('127.0.0.1');
    ctx2.switchToHttp().getRequest().headers['x-forwarded-for'] = '198.51.100.9';
    expect(() => guard.canActivate(ctx2)).toThrow(HttpException);
  });

  it('ignores a spoofed comma-chain X-Forwarded-For (no fresh bucket per request)', () => {
    process.env.HTTP_RATE_LIMIT_MAX = '1';
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = '60000';
    delete process.env.TRUSTED_PROXIES;
    const guard = makeGuard(new HttpRateLimiter());

    const ctx1 = makeContext('10.0.0.1');
    ctx1.switchToHttp().getRequest().headers['x-forwarded-for'] = '203.0.113.7, 10.0.0.1';
    expect(guard.canActivate(ctx1)).toBe(true);
    // Second request with a DIFFERENT forged first hop → same real client
    // bucket, so the spoofing attempt is blocked.
    const ctx2 = makeContext('10.0.0.1');
    ctx2.switchToHttp().getRequest().headers['x-forwarded-for'] = '198.51.100.9, 10.0.0.1';
    expect(() => guard.canActivate(ctx2)).toThrow(HttpException);
  });

  it('honors a single-literal XFF only when the peer is a configured trusted proxy', () => {
    process.env.HTTP_RATE_LIMIT_MAX = '1';
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.TRUSTED_PROXIES = '10.0.0.1, 172.28.0.0/16';
    const guard = makeGuard(new HttpRateLimiter());

    // Trusted nginx peer + nginx-set single-literal XFF → real client bucket.
    const ctx1 = makeContext('10.0.0.1');
    ctx1.switchToHttp().getRequest().headers['x-forwarded-for'] = '203.0.113.7';
    expect(guard.canActivate(ctx1)).toBe(true);
    const ctx2 = makeContext('10.0.0.1');
    ctx2.switchToHttp().getRequest().headers['x-forwarded-for'] = '203.0.113.7';
    expect(() => guard.canActivate(ctx2)).toThrow(HttpException);

    // Untrusted peer with single-literal XFF → XFF ignored, peer bucket used.
    const ctx3 = makeContext('192.0.2.5');
    ctx3.switchToHttp().getRequest().headers['x-forwarded-for'] = '198.51.100.9';
    expect(guard.canActivate(ctx3)).toBe(true);
    // Same untrusted peer, different spoofed XFF → same peer bucket, blocked.
    const ctx4 = makeContext('192.0.2.5');
    ctx4.switchToHttp().getRequest().headers['x-forwarded-for'] = '203.0.113.66';
    expect(() => guard.canActivate(ctx4)).toThrow(HttpException);

    // CIDR entry matches a peer inside the range.
    const ctx5 = makeContext('172.28.0.10');
    ctx5.switchToHttp().getRequest().headers['x-forwarded-for'] = '9.9.9.9';
    expect(guard.canActivate(ctx5)).toBe(true);
  });
});

describe('@RateLimit decorator', () => {
  it('stores the action metadata and attaches the guard', () => {
    class Demo {
      @RateLimit('route')
      run() {
        return 'ok';
      }
    }
    const meta = Reflect.getMetadata('rate_limit_action', Demo.prototype.run);
    expect(meta).toBe('route');
    const guards = Reflect.getMetadata('__guards__', Demo.prototype.run) ?? [];
    expect(guards.map((g: any) => g.name)).toContain('RateLimitGuard');
  });

  it('covers every expensive public routing endpoint', () => {
    const expensive = ['route', 'plan', 'round-trip', 'isochrone'] as const;
    for (const action of expensive) {
      const method = String(action) === 'round-trip' ? 'roundTrip' : String(action);
      const meta = Reflect.getMetadata('rate_limit_action', RoutingController.prototype[method]);
      expect(meta).toBe(action);
      const guards = Reflect.getMetadata('__guards__', RoutingController.prototype[method]) ?? [];
      expect(guards.map((g: any) => g.name)).toContain('RateLimitGuard');
    }
    // Liveness probe stays unthrottled.
    expect(Reflect.getMetadata('rate_limit_action', RoutingController.prototype.health)).toBeUndefined();
  });
});
