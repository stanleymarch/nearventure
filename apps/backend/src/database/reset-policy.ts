import { isLoopbackHost } from '../common/app-config';
import type { DatabaseConnectionConfig } from './database.config';

/**
 * Resetting a database is intentionally opt-in even on a local machine. This
 * check must run before opening a connection or issuing a query.
 */
export function assertDatabaseResetAllowed(config: DatabaseConnectionConfig): void {
  if (process.env.ALLOW_DB_RESET !== '1') {
    throw new Error('Refusing to reset database: set ALLOW_DB_RESET=1 explicitly.');
  }
  if (!isLoopbackHost(config.host)) {
    throw new Error('Refusing to reset database: DB_HOST must be an exact loopback host.');
  }
}
