/**
 * Shared advisory transaction lock for every writer of `poi_product`.
 *
 * The manifest-validated importer (C6) replaces the whole table via an atomic
 * staging swap inside one transaction; the analytics popularity recompute
 * updates `popularity_score` in place. Both take the exact same advisory
 * transaction lock so a full-replace promotion can never interleave with (and
 * silently lose) an in-place popularity update, and vice versa.
 *
 * `pg_advisory_xact_lock(hashtext($1))` is a *transaction-scoped* lock: it is
 * released automatically on commit or rollback of the transaction that took
 * it, so a failed import can never leak a lock.
 *
 * Every consumer must call `acquirePoiWriteLock` *inside* its transaction
 * (never in autocommit mode) and before the first read of or write to
 * `poi_product`.
 */
export const POI_WRITE_LOCK_KEY = 'nearventure_poi_import_v1';

/** The single SQL statement used to take the lock; parameters: [POI_WRITE_LOCK_KEY]. */
export const POI_WRITE_LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtext($1))';

/** Minimum query surface a writer transaction must expose (TypeORM QueryRunner / EntityManager). */
export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** Acquire the shared poi_product write lock on the current transaction. */
export async function acquirePoiWriteLock(tx: SqlExecutor): Promise<void> {
  await tx.query(POI_WRITE_LOCK_SQL, [POI_WRITE_LOCK_KEY]);
}
