import { afterEach, describe, expect, it } from 'vitest';
import { DEV_DATABASE_DEFAULTS, resolveDatabaseConfig } from './database.config';

const DATABASE_ENV = [
  'NODE_ENV',
  'APP_ENV',
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
] as const;

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const saved = Object.fromEntries(DATABASE_ENV.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const key of DATABASE_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('resolveDatabaseConfig', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.APP_ENV;
  });

  it('keeps documented local-development defaults outside production', () => {
    withEnv(
      {
        NODE_ENV: 'test',
        DB_HOST: undefined,
        DB_PORT: undefined,
        DB_USERNAME: undefined,
        DB_PASSWORD: undefined,
        DB_DATABASE: undefined,
      },
      () => expect(resolveDatabaseConfig()).toEqual(DEV_DATABASE_DEFAULTS),
    );
  });

  it('requires every database option to be explicit in production', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        DB_HOST: 'db',
        DB_PORT: '5432',
        DB_USERNAME: 'nearventure',
        DB_PASSWORD: undefined,
        DB_DATABASE: 'nearventure',
      },
      () => expect(() => resolveDatabaseConfig()).toThrow('DB_PASSWORD must be explicitly configured'),
    );
  });

  it('rejects the known development password in production', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        DB_HOST: 'db',
        DB_PORT: '5432',
        DB_USERNAME: 'nearventure',
        DB_PASSWORD: DEV_DATABASE_DEFAULTS.password,
        DB_DATABASE: 'nearventure',
      },
      () => expect(() => resolveDatabaseConfig()).toThrow('DB_PASSWORD must not use the development default'),
    );
  });

  it('accepts an explicit non-development production profile', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        DB_HOST: 'db',
        DB_PORT: '5432',
        DB_USERNAME: 'operator',
        DB_PASSWORD: 'long-random-password',
        DB_DATABASE: 'nearventure_prod',
      },
      () => {
        expect(resolveDatabaseConfig()).toEqual({
          host: 'db',
          port: 5432,
          username: 'operator',
          password: 'long-random-password',
          database: 'nearventure_prod',
        });
      },
    );
  });
});
