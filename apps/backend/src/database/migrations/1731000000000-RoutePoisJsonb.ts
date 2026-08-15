/**
 * Migration 1731000000000-RoutePoisJsonb
 *
 * The `routes.pois` column was previously `simple-array` (a TypeORM convenience
 * for arrays of primitive strings only). For complex objects (e.g. POI
 * snapshots with id/name/category/lat/lon/descRu/imageUrl) TypeORM serialised
 * each element via String() → "[object Object]". Switching to `jsonb` allows
 * structured storage and round-tripping real POI data.
 *
 *   - type:  text → jsonb
 *   - nullability: NOT NULL → NULL allowed (no route should crash on save if
 *     the frontend sends an empty list)
 *
 * Idempotent: uses ALTER ... USING and guards on column type via
 * information_schema, so re-running on a modern column is a no-op.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RoutePoisJsonb1731000000000 implements MigrationInterface {
  name = 'RoutePoisJsonb1731000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Detect current column type. On Postgres, information_schema.columns.data_type
    // returns 'text' for simple-array (TypeORM uses text under the hood with a
    // comma join/serialise step) and 'jsonb' after this migration.
    const rows = (await queryRunner.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'routes'
         AND column_name = 'pois'`,
    )) as { data_type: string; is_nullable: string }[];

    if (rows.length === 0) {
      // Column missing entirely — synchronize: true on a fresh install will
      // create it. Nothing to do.
      return;
    }

    const dataType = rows[0].data_type.toLowerCase();
    if (dataType === 'text') {
      // simple-array stored as comma-joined text. Cast to jsonb — if the
      // existing content is well-formed JSON or empty string, this succeeds.
      // If anything else is in there, we fall back to a safe default.
      // Pre-clean: rows that hold TypeORM's "[object Object]" leftover from
      // the old simple-array column (see REPORT.md B1) are NOT valid JSON
      // because they lack quotes around the object label. Detect them by
      // substring and reset to '[]' BEFORE the column-type flip, so the
      // USING clause's jsonb cast never has to handle them.
      await queryRunner.query(`UPDATE routes SET pois = '[]' WHERE pois LIKE '%[object Object]%' OR pois LIKE '%object Object%'`);
      await queryRunner.query(`UPDATE routes SET pois = '[]' WHERE pois IS NULL OR pois = ''`);
      await queryRunner.query(`ALTER TABLE routes ALTER COLUMN pois TYPE jsonb USING
        CASE
          WHEN pois IS NULL OR pois = '' THEN '[]'::jsonb
          WHEN pois ~ '^\\s*\\[.*\\]\\s*$' THEN pois::jsonb
          ELSE '[]'::jsonb
        END`);
    } else if (dataType === 'json') {
      await queryRunner.query(`ALTER TABLE routes ALTER COLUMN pois TYPE jsonb USING pois::jsonb`);
    }
    // already jsonb → no-op

    if (rows[0].is_nullable === 'NO') {
      await queryRunner.query(`ALTER TABLE routes ALTER COLUMN pois DROP NOT NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort rollback to text. simple-array semantics aren't preserved —
    // but down-migrations are rarely run in production.
    await queryRunner.query(`UPDATE routes SET pois = '[]'::jsonb WHERE pois IS NULL`);
    await queryRunner.query(`ALTER TABLE routes ALTER COLUMN pois TYPE text USING pois::text`);
    await queryRunner.query(`ALTER TABLE routes ALTER COLUMN pois SET NOT NULL`);
  }
}
