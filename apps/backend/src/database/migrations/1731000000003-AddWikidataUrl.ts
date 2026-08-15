/**
 * Migration 1731000000003-AddWikidataUrl
 *
 * Bug B4 (logs/qa/REPORT.md): poi_product stores the Wikidata URL
 * (`https://www.wikidata.org/wiki/Q12345`) in the `wikidata_url` column
 * (per poi-collector/src/poi_collector/model/canonical.py PoiProduct),
 * but the SQL schema (`poi-collector/db/schema.sql`) does not declare
 * it for `poi_product`. This migration is the safety net for already-
 * provisioned databases that were created from `schema.sql` and therefore
 * lack the column.
 *
 * Schema-aware: guarded by `hasTable('poi_product')` — on a fresh database
 * this no-ops until the runtime-foundation migration creates poi_product.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWikidataUrl1731000000003 implements MigrationInterface {
  name = 'AddWikidataUrl1731000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('poi_product')) {
      await queryRunner.query(`
        ALTER TABLE poi_product
          ADD COLUMN IF NOT EXISTS wikidata_url VARCHAR(500)
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op — column drops are destructive.
  }
}
