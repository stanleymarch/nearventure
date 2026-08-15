/**
 * Migration 1731000000002-AddPoiUrlColumns
 *
 * Bug B4 (logs/qa/REPORT.md): poi_canonical / poi_product were missing the
 * dedicated egrkn_url / wikivoyage_url / article_url columns. The Python
 * pipeline (poi-collector) already declares these columns in the
 * SQLAlchemy models, so a fresh `Base.metadata.create_all` will create them.
 * This migration is the safety net for already-provisioned databases:
 * it adds the columns with `ADD COLUMN IF NOT EXISTS` so the migration is
 * idempotent.
 *
 * Schema-aware: each table is guarded independently via `hasTable`, so a
 * database that has poi_product but no poi_canonical (the observed
 * production shape) only receives the poi_product ALTER.
 *
 * Note: poi_product already has `official_url` / `social_url` (added by
 * earlier work), and `wikivoyage_url` / `egrkn_url` / `article_url` were
 * declared in the SQLAlchemy model for poi_product. We still issue
 * IF NOT EXISTS to be safe across the various staging/prod schemas.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPoiUrlColumns1731000000002 implements MigrationInterface {
  name = 'AddPoiUrlColumns1731000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('poi_canonical')) {
      await queryRunner.query(`
        ALTER TABLE poi_canonical
          ADD COLUMN IF NOT EXISTS egrkn_url      VARCHAR(500),
          ADD COLUMN IF NOT EXISTS wikivoyage_url VARCHAR(1000),
          ADD COLUMN IF NOT EXISTS article_url    VARCHAR(1000)
      `);
    }

    if (await queryRunner.hasTable('poi_product')) {
      await queryRunner.query(`
        ALTER TABLE poi_product
          ADD COLUMN IF NOT EXISTS egrkn_url      VARCHAR(500),
          ADD COLUMN IF NOT EXISTS wikivoyage_url VARCHAR(1000),
          ADD COLUMN IF NOT EXISTS article_url    VARCHAR(1000)
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: dropping a column is destructive and rarely needed in prod.
    // A future rollback script can add DROP COLUMN IF EXISTS here.
  }
}
