import { describe, it, expect, afterEach } from 'vitest';
import {
  isProduction,
  isWebhookMode,
  isLoopbackHost,
  jwtSecret,
  publicBaseUrl,
  maxRoutingConcurrency,
  maxRoutingQueue,
  assertProductionConfig,
  DEV_JWT_SECRET,
} from './app-config';

/**
 * Release-CRIT config guards: production must fail closed when required
 * secrets are absent; dev keeps explicit non-secret defaults.
 */

const TOUCHED = [
  'NODE_ENV',
  'APP_ENV',
  'JWT_SECRET',
  'TELEGRAM_WEBHOOK_DOMAIN',
  'TELEGRAM_WEBHOOK_SECRET',
  'PUBLIC_URL',
  'ROUTING_MAX_CONCURRENCY',
  'ROUTING_MAX_QUEUE',
] as const;

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of TOUCHED) {
    saved[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of TOUCHED) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('app-config', () => {
  afterEach(() => {
    // Guard against a leaked production flag in any later test file.
    if (process.env.NODE_ENV === 'production') delete process.env.NODE_ENV;
    if (process.env.APP_ENV === 'production') delete process.env.APP_ENV;
  });

  describe('isProduction', () => {
    it('detects NODE_ENV=production', () => {
      withEnv({ NODE_ENV: 'production', APP_ENV: undefined }, () => {
        expect(isProduction()).toBe(true);
      });
    });

    it('detects APP_ENV=production', () => {
      withEnv({ NODE_ENV: undefined, APP_ENV: 'production' }, () => {
        expect(isProduction()).toBe(true);
      });
    });

    it('is false for dev/test', () => {
      withEnv({ NODE_ENV: 'test', APP_ENV: undefined }, () => {
        expect(isProduction()).toBe(false);
      });
    });
  });

  describe('jwtSecret', () => {
    it('fails closed in production without JWT_SECRET', () => {
      withEnv({ NODE_ENV: 'production', JWT_SECRET: undefined }, () => {
        expect(() => jwtSecret()).toThrow(/JWT_SECRET must be set/);
      });
    });

    it('fails closed in production when JWT_SECRET is still the dev default', () => {
      withEnv({ NODE_ENV: 'production', JWT_SECRET: DEV_JWT_SECRET }, () => {
        expect(() => jwtSecret()).toThrow(/JWT_SECRET must be set/);
      });
    });

    it('accepts a real production secret', () => {
      withEnv({ NODE_ENV: 'production', JWT_SECRET: 'openssl-rand-hex-32' }, () => {
        expect(jwtSecret()).toBe('openssl-rand-hex-32');
      });
    });

    it('uses the dev default outside production (explicit, non-secret)', () => {
      withEnv({ NODE_ENV: 'test', JWT_SECRET: undefined }, () => {
        expect(jwtSecret()).toBe(DEV_JWT_SECRET);
      });
    });
  });

  describe('isWebhookMode', () => {
    it('is true for a public domain', () => {
      withEnv({ TELEGRAM_WEBHOOK_DOMAIN: 'nearventure.ru' }, () => {
        expect(isWebhookMode()).toBe(true);
      });
    });

    it('is true for a domain with scheme', () => {
      withEnv({ TELEGRAM_WEBHOOK_DOMAIN: 'https://nearventure.ru/' }, () => {
        expect(isWebhookMode()).toBe(true);
      });
    });

    it('is false for localhost and missing domain', () => {
      withEnv({ TELEGRAM_WEBHOOK_DOMAIN: 'localhost:3000' }, () => {
        expect(isWebhookMode()).toBe(false);
      });
      withEnv({ TELEGRAM_WEBHOOK_DOMAIN: undefined }, () => {
        expect(isWebhookMode()).toBe(false);
      });
    });

    // Hostile-domain cases: a public hostname that merely CONTAINS
    // "localhost" must NOT be treated as polling — otherwise the public
    // webhook endpoint would accept unauthenticated updates (bypass of the
    // required webhook secret).
    it('treats a public domain CONTAINING localhost as webhook mode (hostile bypass)', () => {
      for (const domain of [
        'localhost.example.com',
        'localhost.example',
        'https://localhost.example.com/',
        'evillocalhost.com',
        'my-localhost-site.ru',
      ]) {
        withEnv({ TELEGRAM_WEBHOOK_DOMAIN: domain }, () => {
          expect(isWebhookMode()).toBe(true);
        });
      }
    });

    it('treats only exact loopback hosts as polling', () => {
      for (const local of [
        'localhost',
        'localhost:3000',
        'http://localhost:8080',
        '127.0.0.1',
        '127.0.0.1:3000',
        'http://127.0.0.1:8080/',
        '127.42.7.1',
        '[::1]',
        '[::1]:3000',
      ]) {
        withEnv({ TELEGRAM_WEBHOOK_DOMAIN: local }, () => {
          expect(isWebhookMode()).toBe(false);
        });
      }
    });

    it('isLoopbackHost parses the host exactly (no substring matches)', () => {
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('localhost:3000')).toBe(true);
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('127.255.1.2')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('[::1]')).toBe(true);
      expect(isLoopbackHost('localhost.example.com')).toBe(false);
      expect(isLoopbackHost('127.0.0.1.example.com')).toBe(false);
      expect(isLoopbackHost('evillocalhost.ru')).toBe(false);
      expect(isLoopbackHost('not a host')).toBe(false);
    });
  });

  describe('publicBaseUrl', () => {
    it('normalizes a configured HTTPS origin', () => {
      withEnv({ PUBLIC_URL: 'https://share.example.test/' }, () => {
        expect(publicBaseUrl()).toBe('https://share.example.test');
      });
    });

    it('does not invent a public URL outside production', () => {
      withEnv({ NODE_ENV: 'test', PUBLIC_URL: undefined }, () => {
        expect(publicBaseUrl()).toBeUndefined();
      });
    });

    it.each([
      'http://share.example.test',
      'https://user:pass@share.example.test',
      'https://share.example.test/app',
      'https://share.example.test/?source=test',
      'https://share.example.test/#route',
    ])('rejects a non-origin public URL: %s', (value) => {
      withEnv({ PUBLIC_URL: value }, () => {
        expect(() => publicBaseUrl()).toThrow(/PUBLIC_URL must be/);
      });
    });

    it('requires PUBLIC_URL in production', () => {
      withEnv({ NODE_ENV: 'production', PUBLIC_URL: undefined }, () => {
        expect(() => publicBaseUrl()).toThrow(/PUBLIC_URL must be explicitly set/);
      });
    });
  });

  describe('maxRoutingQueue', () => {
    it('defaults to 100', () => {
      withEnv({ ROUTING_MAX_QUEUE: undefined }, () => {
        expect(maxRoutingQueue()).toBe(100);
      });
    });

    it('honours a valid env value and ignores invalid ones', () => {
      withEnv({ ROUTING_MAX_QUEUE: '250' }, () => {
        expect(maxRoutingQueue()).toBe(250);
      });
      withEnv({ ROUTING_MAX_QUEUE: '0' }, () => {
        expect(maxRoutingQueue()).toBe(100);
      });
      withEnv({ ROUTING_MAX_QUEUE: '-5' }, () => {
        expect(maxRoutingQueue()).toBe(100);
      });
      withEnv({ ROUTING_MAX_QUEUE: 'abc' }, () => {
        expect(maxRoutingQueue()).toBe(100);
      });
      withEnv({ ROUTING_MAX_QUEUE: '99999' }, () => {
        expect(maxRoutingQueue()).toBe(100);
      });
    });
  });

  describe('assertProductionConfig', () => {
    it('is a no-op in dev/test', () => {
      withEnv({ NODE_ENV: 'test', JWT_SECRET: undefined, TELEGRAM_WEBHOOK_SECRET: undefined, PUBLIC_URL: undefined }, () => {
        expect(() => assertProductionConfig()).not.toThrow();
      });
    });

    it('requires TELEGRAM_WEBHOOK_SECRET in production webhook mode', () => {
      withEnv(
        {
          NODE_ENV: 'production',
          JWT_SECRET: 'strong-secret',
          TELEGRAM_WEBHOOK_DOMAIN: 'nearventure.ru',
          TELEGRAM_WEBHOOK_SECRET: undefined,
          PUBLIC_URL: 'https://share.example.test',
        },
        () => {
          expect(() => assertProductionConfig()).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
        },
      );
    });

    it('passes when all production secrets are present', () => {
      withEnv(
        {
          NODE_ENV: 'production',
          JWT_SECRET: 'strong-secret',
          TELEGRAM_WEBHOOK_DOMAIN: 'nearventure.ru',
          TELEGRAM_WEBHOOK_SECRET: 'openssl rand -hex 16',
          PUBLIC_URL: 'https://share.example.test',
        },
        () => {
          expect(() => assertProductionConfig()).not.toThrow();
        },
      );
    });
  });

  describe('maxRoutingConcurrency', () => {
    it('defaults to 4', () => {
      withEnv({ ROUTING_MAX_CONCURRENCY: undefined }, () => {
        expect(maxRoutingConcurrency()).toBe(4);
      });
    });

    it('honours a valid env value and ignores invalid ones', () => {
      withEnv({ ROUTING_MAX_CONCURRENCY: '8' }, () => {
        expect(maxRoutingConcurrency()).toBe(8);
      });
      withEnv({ ROUTING_MAX_CONCURRENCY: '0' }, () => {
        expect(maxRoutingConcurrency()).toBe(4);
      });
      withEnv({ ROUTING_MAX_CONCURRENCY: 'abc' }, () => {
        expect(maxRoutingConcurrency()).toBe(4);
      });
    });
  });
});
