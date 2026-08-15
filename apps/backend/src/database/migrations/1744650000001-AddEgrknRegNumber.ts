/**
 * Migration 1744650000001-AddEgrknRegNumber
 *
 * poi_product.egrkn_reg_number is declared on the entity
 * (PoiProduct.egrknRegNumber) and written by poi-collector
 * (poi-collector/import_postgres.py, schema.sql), but the SQL schema used to
 * provision already-running databases (and the production dump) does not
 * declare the column. In dev `synchronize: true` masks the drift; in
 * production (`synchronize: false`) the column is missing and every query
 * touching it fails.
 *
 * Schema-aware: guarded by `hasTable('poi_product')` — on a fresh database
 * this no-ops until the runtime-foundation migration creates poi_product.
 *
 * This migration is the safety net for provisioned/production databases.
 * Idempotent: ADD COLUMN IF NOT EXISTS. Mirrors AddWikidataUrl1731000000003.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEgrknRegNumber1744650000001 implements MigrationInterface {
  name = 'AddEgrknRegNumber1744650000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('poi_product')) {
      await queryRunner.query(`
        ALTER TABLE poi_product
          ADD COLUMN IF NOT EXISTS egrkn_reg_number VARCHAR
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op — column drops are destructive.
  }
}
