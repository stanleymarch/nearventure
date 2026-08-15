/**
 * Centralised environment configuration guards.
 *
 * Security rule (release CRIT): production MUST fail closed when required
 * credentials/secrets are absent — never silently fall back to the dev-only
 * defaults. Dev keeps the documented, non-secret defaults (see
 * `apps/backend/.env.example`) so `docker compose up` and local `npm run
 * start:dev` keep working without secrets.
 */

/** Dev-only JWT signing secret. Never used in production. */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

/** True when running a production build (Docker sets NODE_ENV=production). */
export function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production'
  );
}

/**
 * Webhook mode is active when a public webhook domain is configured and is
 * NOT an exact loopback host. Matches the bot startup logic in TelegramModule.
 *
 * Only exact loopback hosts (localhost, 127.0.0.0/8, ::1, with an optional
 * port) count as local: a public hostname that merely CONTAINS "localhost"
 * (e.g. `localhost.example.com`) is a public webhook domain and therefore
 * still requires a webhook secret (fail closed).
 */
export function isWebhookMode(): boolean {
  const raw = process.env.TELEGRAM_WEBHOOK_DOMAIN;
  const domain = raw?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return !!domain && !isLoopbackHost(domain);
}

/**
 * True only for exact loopback hostnames: `localhost`, IPv4 loopback
 * (127.0.0.0/8) or IPv6 `::1`, each with an optional port. The hostname is
 * parsed structurally (via URL), so `localhost.evil.example` is NOT local.
 */
export function isLoopbackHost(value: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(value.includes('://') ? value : `https://${value}`).hostname;
  } catch {
    // Bare IPv6 loopback (`::1` or `::1:3000`) can't be parsed by URL without
    // brackets — recognize it explicitly before declaring the host non-local.
    const bare = value.replace(/^https?:\/\//, '');
    return /^::1(:\d+)?$/.test(bare);
  }
  if (hostname === 'localhost') return true;
  const ipv6 = hostname.replace(/^\[|\]$/g, '');
  if (ipv6 === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * JWT signing/verification secret.
 *
 * - Production: JWT_SECRET is REQUIRED and must not be the dev default —
 *   calling this throws, which fails startup (fail closed).
 * - Dev/test: falls back to the documented dev-only default.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (isProduction()) {
    if (!secret || secret === DEV_JWT_SECRET) {
      throw new Error(
        'JWT_SECRET must be set to a strong, non-default value in production ' +
          '(generate one with: openssl rand -hex 32).',
      );
    }
    return secret;
  }
  return secret || DEV_JWT_SECRET;
}

/**
 * Resolve the externally reachable application origin used in persisted share
 * URLs and Telegram buttons. A missing value is allowed outside production so
 * local API development does not publish a misleading URL; callers must omit
 * public links in that case.
 */
export function publicBaseUrl(): string | undefined {
  const raw = process.env.PUBLIC_URL;
  if (!raw) {
    if (isProduction()) {
      throw new Error('PUBLIC_URL must be explicitly set to an HTTPS origin in production.');
    }
    return undefined;
  }

  if (raw !== raw.trim()) {
    throw new Error('PUBLIC_URL must be an HTTPS origin without surrounding whitespace.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('PUBLIC_URL must be a valid HTTPS origin.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'PUBLIC_URL must be an HTTPS origin only (no credentials, path, query, or hash).',
    );
  }

  return url.origin;
}

/**
 * Maximum concurrent GraphHopper requests (concurrency guard for the public
 * routing endpoints). Default 4; env-tunable via ROUTING_MAX_CONCURRENCY.
 */
export function maxRoutingConcurrency(): number {
  const raw = Number(process.env.ROUTING_MAX_CONCURRENCY);
  return Number.isInteger(raw) && raw >= 1 && raw <= 64 ? raw : 4;
}

/**
 * Maximum number of requests allowed to wait in the GraphHopper queue before
 * new work is rejected with 503 (bounded waiting — never queue indefinitely).
 * Default 100; env-tunable via ROUTING_MAX_QUEUE.
 */
export function maxRoutingQueue(): number {
  const raw = Number(process.env.ROUTING_MAX_QUEUE);
  return Number.isInteger(raw) && raw >= 1 && raw <= 10_000 ? raw : 100;
}

/**
 * Fail-fast startup validation for production. Called from `main.ts`
 * before the Nest application is created, so a misconfigured production
 * deployment exits with a clear error instead of running with insecure
 * fallbacks.
 */
export function assertProductionConfig(): void {
  if (!isProduction()) return;

  // JWT: never sign/verify with the dev default in production.
  jwtSecret();

  // Persisted share links and Telegram web_app URLs must have an explicit,
  // valid public origin; never infer one from a deployment-specific domain.
  publicBaseUrl();

  // Telegram webhook: the public webhook endpoint must be protected by a
  // secret token, otherwise anyone can POST fake updates to the bot.
  if (isWebhookMode() && !process.env.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error(
      'TELEGRAM_WEBHOOK_SECRET is required in production when webhook mode is ' +
        'enabled (TELEGRAM_WEBHOOK_DOMAIN set). Generate one with: openssl rand -hex 16',
    );
  }
}
