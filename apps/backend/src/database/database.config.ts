import { isProduction } from '../common/app-config';

/** Documented local-development connection values. Never used as a production fallback. */
export const DEV_DATABASE_DEFAULTS = {
  host: 'localhost',
  port: 5432,
  username: 'nearventure',
  password: 'nearventure_dev',
  database: 'nearventure',
} as const;

export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

const REQUIRED_DATABASE_ENV = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE'] as const;

function requiredEnv(name: (typeof REQUIRED_DATABASE_ENV)[number]): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be explicitly configured in production.`);
  }
  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('DB_PORT must be an integer between 1 and 65535.');
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

/**
 * Resolve the only database connection profile used by the application and
 * operational CLIs. Local development retains the documented defaults. A
 * production process must provide every value explicitly and may never use the
 * well-known development password.
 */
export function resolveDatabaseConfig(): DatabaseConnectionConfig {
  if (isProduction()) {
    const config = {
      host: requiredEnv('DB_HOST'),
      port: parsePort(requiredEnv('DB_PORT')),
      username: requiredEnv('DB_USERNAME'),
      password: requiredEnv('DB_PASSWORD'),
      database: requiredEnv('DB_DATABASE'),
    };
    if (config.password === DEV_DATABASE_DEFAULTS.password) {
      throw new Error('DB_PASSWORD must not use the development default in production.');
    }
    return config;
  }

  return {
    host: process.env.DB_HOST?.trim() || DEV_DATABASE_DEFAULTS.host,
    port: parsePort(process.env.DB_PORT?.trim() || String(DEV_DATABASE_DEFAULTS.port)),
    username: process.env.DB_USERNAME?.trim() || DEV_DATABASE_DEFAULTS.username,
    password: process.env.DB_PASSWORD || DEV_DATABASE_DEFAULTS.password,
    database: process.env.DB_DATABASE?.trim() || DEV_DATABASE_DEFAULTS.database,
  };
}
