import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { isIP } from 'node:net';
import { Request, Response } from 'express';
import { HttpRateLimiter } from './http-rate-limiter';
import { RATE_LIMIT_ACTION_KEY } from './rate-limit.decorator';

/**
 * Rejects requests that exceed the per-IP fixed-window limit for the
 * endpoint action, responding 429 with a Retry-After header so clients
 * get an actionable signal.
 *
 * Use via the `@RateLimit('action')` decorator.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly limiter: HttpRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const action = this.actionFor(context);
    const key = `${action}:${clientIp(req)}`;
    const decision = this.limiter.try(key, action);

    if (!decision.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      throw new HttpException(
        `Too many requests. Try again in ${retryAfterSec}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private actionFor(context: ExecutionContext): string {
    return (
      Reflect.getMetadata(RATE_LIMIT_ACTION_KEY, context.getHandler()) ?? 'default'
    );
  }
}

/**
 * Client identity for rate limiting (anti-spoofing contract).
 *
 * Production nginx overwrites `X-Forwarded-For` with its own trusted
 * `$remote_addr` (single, validated client address — see
 * docker/nginx/nginx.conf.template). We therefore NEVER trust an arbitrary
 * client-supplied first hop, and we only honor XFF when ALL of these hold:
 *
 *   1. the header is a single well-formed IP literal (no comma chain), and
 *   2. the immediate TCP peer is a proxy we explicitly trust
 *      (TRUSTED_PROXIES env: comma-separated IPs / IPv4 CIDRs).
 *
 * In every other case (no proxy configured — local dev, direct connections,
 * spoofed chains, junk values) the identity is the real socket peer
 * (`req.ip`/`remoteAddress`). So a client cannot mint a fresh bucket by
 * sending a forged XFF: through production nginx the header is overwritten,
 * and anywhere else it is ignored unless the peer is trusted.
 */
function clientIp(req: Request): string {
  const peer = normalizeIp(req.ip || req.socket?.remoteAddress) ?? 'unknown';

  const forwarded = req.headers['x-forwarded-for'];
  const value = typeof forwarded === 'string' ? forwarded.trim() : '';
  const singleLiteral = value !== '' && !value.includes(',') && isIP(value) !== 0;

  if (singleLiteral && isTrustedProxy(peer)) {
    return normalizeIp(value) ?? peer;
  }
  return peer;
}

/** Comma-separated IPs / IPv4 CIDRs that are allowed to set XFF for us. */
function trustedProxies(): string[] {
  return (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isTrustedProxy(peer: string): boolean {
  const proxies = trustedProxies();
  if (!proxies.length) return false;
  return proxies.some((entry) => matchIpOrCidr(peer, entry));
}

/** Exact IP (v4/v6) or IPv4 CIDR match. */
function matchIpOrCidr(ip: string, entry: string): boolean {
  const [addr, bitsStr] = entry.split('/');
  if (bitsStr !== undefined) {
    const bits = Number(bitsStr);
    const entryAddr = parseIpv4(addr);
    const candidate = parseIpv4(ip);
    if (
      entryAddr !== null &&
      candidate !== null &&
      Number.isInteger(bits) &&
      bits >= 0 &&
      bits <= 32
    ) {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (entryAddr & mask) === (candidate & mask);
    }
    return false;
  }
  return ip === addr;
}

function parseIpv4(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  const [a, b, c, d] = ip.split('.').map(Number);
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
}

/** Trim whitespace and normalize IPv4-mapped IPv6 (`::ffff:1.2.3.4`). */
function normalizeIp(ip: string | undefined | null): string | undefined {
  if (!ip) return undefined;
  let value = ip.trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  return isIP(value) !== 0 ? value : undefined;
}
