import { describe, it, expect, afterEach, vi } from 'vitest';
import { AppModule } from './app.module';

// Importing the real AppModule pulls in every feature module and TypeORM
// entities (whose bare @Column() decorators need tsc-emitted design:type
// metadata that vitest's esbuild transform does not provide). The seedAdmin
// behavior only depends on UsersService + env, so mock the heavy modules.
vi.mock('./database/database.module', () => ({ DatabaseModule: class DatabaseModule {} }));
vi.mock('./auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
vi.mock('./users/users.module', () => ({ UsersModule: class UsersModule {} }));
vi.mock('./users/users.service', () => ({ UsersService: class UsersService {} }));
vi.mock('./pois/pois.module', () => ({ PoisModule: class PoisModule {} }));
vi.mock('./routing/routing.module', () => ({ RoutingModule: class RoutingModule {} }));
vi.mock('./routes/routes.module', () => ({ RoutesModule: class RoutesModule {} }));
vi.mock('./analytics/analytics.module', () => ({ AnalyticsModule: class AnalyticsModule {} }));
vi.mock('./telegram/telegram.module', () => ({ TelegramModule: class TelegramModule {} }));
vi.mock('./itineraries/itinerary.module', () => ({ ItineraryModule: class ItineraryModule {} }));

/**
 * seedAdmin release-CRIT behavior:
 *  - production with an empty DB and missing ADMIN_* → startup fails (closed).
 *  - production never falls back to dev credentials.
 *  - the admin password is never logged (dev or prod).
 *  - dev keeps the explicit, non-secret defaults from .env.example.
 */

const TOUCHED = ['NODE_ENV', 'APP_ENV', 'ADMIN_LOGIN', 'ADMIN_PASSWORD'] as const;

function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of TOUCHED) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (async () => {
    try {
      await fn();
    } finally {
      for (const key of TOUCHED) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  })();
}

function makeUsers(overrides: Partial<{ count: any; create: any }> = {}) {
  return {
    count: overrides.count ?? vi.fn().mockResolvedValue({ total: 0 }),
    create: overrides.create ?? vi.fn().mockResolvedValue({ id: 1 }),
  } as any;
}

describe('AppModule.seedAdmin', () => {
  afterEach(() => {
    if (process.env.NODE_ENV === 'production') delete process.env.NODE_ENV;
    if (process.env.APP_ENV === 'production') delete process.env.APP_ENV;
  });

  it('skips seeding when users already exist', async () => {
    const users = makeUsers({ count: vi.fn().mockResolvedValue({ total: 3 }) });
    const mod = new AppModule(users);
    await mod.onModuleInit();
    expect(users.create).not.toHaveBeenCalled();
  });

  it('fails closed in production when ADMIN_* are missing and DB is empty', async () => {
    withEnv({ NODE_ENV: 'production', ADMIN_LOGIN: undefined, ADMIN_PASSWORD: undefined }, async () => {
      const users = makeUsers();
      const mod = new AppModule(users);
      await expect(mod.onModuleInit()).rejects.toThrow(/ADMIN_LOGIN and ADMIN_PASSWORD/);
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  it('seeds with explicit ADMIN_* in production and never logs the password', async () => {
    await withEnv(
      { NODE_ENV: 'production', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'super-secret-42' },
      async () => {
        const users = makeUsers();
        const mod = new AppModule(users);
        await mod.onModuleInit();
        expect(users.create).toHaveBeenCalledWith({ login: 'boss', password: 'super-secret-42', role: 'admin' });
      },
    );
  });

  it('never falls back to dev credentials in production', async () => {
    await withEnv({ NODE_ENV: 'production', ADMIN_LOGIN: undefined, ADMIN_PASSWORD: undefined }, async () => {
      const users = makeUsers();
      const mod = new AppModule(users);
      await expect(mod.onModuleInit()).rejects.toThrow();
      expect(users.create).not.toHaveBeenCalledWith({ login: 'admin', password: 'admin', role: 'admin' });
    });
  });

  it('keeps dev defaults for local/test startup (explicit, non-secret)', async () => {
    await withEnv({ NODE_ENV: 'test', ADMIN_LOGIN: undefined, ADMIN_PASSWORD: undefined }, async () => {
      const users = makeUsers();
      const mod = new AppModule(users);
      await mod.onModuleInit();
      expect(users.create).toHaveBeenCalledWith({ login: 'admin', password: 'admin', role: 'admin' });
    });
  });
});
