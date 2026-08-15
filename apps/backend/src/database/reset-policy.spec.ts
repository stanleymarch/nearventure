import { afterEach, describe, expect, it } from 'vitest';
import { DEV_DATABASE_DEFAULTS, type DatabaseConnectionConfig } from './database.config';
import { assertDatabaseResetAllowed } from './reset-policy';

const localConfig: DatabaseConnectionConfig = { ...DEV_DATABASE_DEFAULTS };
const savedAllow = process.env.ALLOW_DB_RESET;

describe('assertDatabaseResetAllowed', () => {
  afterEach(() => {
    if (savedAllow === undefined) delete process.env.ALLOW_DB_RESET;
    else process.env.ALLOW_DB_RESET = savedAllow;
  });

  it('requires an explicit ALLOW_DB_RESET=1 opt-in', () => {
    delete process.env.ALLOW_DB_RESET;
    expect(() => assertDatabaseResetAllowed(localConfig)).toThrow('ALLOW_DB_RESET=1');
  });

  it('refuses a non-loopback database host even with opt-in', () => {
    process.env.ALLOW_DB_RESET = '1';
    expect(() => assertDatabaseResetAllowed({ ...localConfig, host: 'db.example.com' })).toThrow('exact loopback host');
  });

  it('allows an explicitly opted-in exact loopback host', () => {
    process.env.ALLOW_DB_RESET = '1';
    expect(() => assertDatabaseResetAllowed({ ...localConfig, host: '[::1]' })).not.toThrow();
  });
});
