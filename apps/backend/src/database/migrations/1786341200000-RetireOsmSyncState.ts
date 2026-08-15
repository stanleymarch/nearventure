/**
 * Migration 1786341200000-RetireOsmSyncState
 *
 * Forward retirement of the legacy incremental OSM sync, which was removed in
 * C7 (commit af01681: embedded Python poi-collector + TypeScript
 * PipelineModule/OsmSyncService deleted). After that removal the codebase has
 * no reader or writer left for:
 *   - the `osm_sync_state` table (created/seeded by
 *     CreateRuntimeFoundation1786340733385), and
 *   - the `poi_product.stale_from_osm` column (only the retired sync touched
 *     it; the C6 manifest importer replaces the whole table from exporter SQL,
 *     and the exporter schema has no such column).
 *
 * This migration is deliberately NOT a rewrite of the already-deployed
 * foundation migration: it runs AFTER it, so both a blank-database bootstrap
 * and an already-migrated production shape converge on the same retired
 * state. It is safe/idempotent (`IF EXISTS`/`IF NOT EXISTS`-style guards) and
 * never touches poi_overrides or the rest of poi_product.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RetireOsmSyncState1786341200000 implements MigrationInterface {
  name = 'RetireOsmSyncState1786341200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No deployed reader/writer of osm_sync_state remains after C7; the table
    // is dead schema created only by the foundation bootstrap.
    await queryRunner.query(`DROP TABLE IF EXISTS osm_sync_state`);
    // stale_from_osm was written only by the retired incremental sync; the
    // importer's staging swap rebuilds poi_product without it.
    await queryRunner.query(`ALTER TABLE poi_product DROP COLUMN IF EXISTS stale_from_osm`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Deliberately a no-op: recreating dead legacy schema (or re-adding the
    // obsolete column) would reintroduce a retired contract. Releases are
    // reverted with forward migrations, not by undoing this one.
  }
}
