/**
 * Migration 1731000000001-ImageAttributionKeys
 *
 * Bug B3 (logs/qa/REPORT.md): the image_attribution JSONB on poi_product
 * used the old Commons-API key shape (`author`, `source_url`, `license_url`)
 * but the frontend expected a different shape (`artist`, `credit`,
 * `licenseUrl`). The Commons ingest step (poi-collector) now writes the
 * frontend-compatible shape, but historical rows still have the old keys.
 *
 * What this migration does, per legacy row (WHERE image_attribution ? 'author'):
 *   - normalizes the legacy keys into canonical ones (`author` → `artist`,
 *     `source_url` → `credit`, `license_url` → `licenseUrl`);
 *   - **only fills a canonical key that is entirely absent** — an existing
 *     `artist`/`credit`/`licenseUrl` value is never overwritten by a legacy
 *     `author`/`source_url`/`license_url` value (rows written by the current
 *     collector carry both shapes, and the canonical one wins);
 *   - **preserves every other key** (arbitrary metadata such as `url`,
 *     `thumb_url`, `photographer`, `attribution`, `description`, future
 *     keys) by merging into the original object instead of rebuilding it;
 *   - never introduces `null`-valued keys (missing legacy keys simply
 *     contribute nothing);
 *   - removes the legacy `author`, `source_url`, `license_url` keys so the
 *     normalized shape is stable and the migration stays idempotent (re-run
 *     matches no rows).
 *
 * Implementation notes:
 *   - `jsonb_each_text` turns a missing key / JSON null value into SQL NULL;
 *     `jsonb_object_agg` keeps NULL *values* on this PG version, so the
 *     `v IS NOT NULL` filter is what guarantees no `"key": null` is born.
 *   - binary `-` binds tighter than `||` in PostgreSQL, so the legacy-key
 *     removal must wrap the whole merged object in parentheses.
 *
 * Schema-aware: each table is guarded independently via `hasTable`. The
 * production runtime schema has poi_product but *no* poi_canonical (the
 * Python canonical model never made it to production), so the canonical
 * block must no-op there. A multi-statement string naming an absent table
 * would fail the whole migration; the guard prevents that.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

const NORMALIZE_LEGACY_TO_CANONICAL = `
  (image_attribution
   || COALESCE((
        SELECT jsonb_object_agg(k, v)
        FROM jsonb_each_text(jsonb_build_object(
          'artist',     image_attribution->>'author',
          'credit',     image_attribution->>'source_url',
          'licenseUrl', image_attribution->>'license_url'
        )) AS kv(k, v)
        WHERE NOT image_attribution ? k AND v IS NOT NULL
      ), '{}'::jsonb))
  - 'author' - 'source_url' - 'license_url'
`;

const DENORMALIZE_CANONICAL_TO_LEGACY = `
  (image_attribution
   || COALESCE((
        SELECT jsonb_object_agg(k, v)
        FROM jsonb_each_text(jsonb_build_object(
          'author',      image_attribution->>'artist',
          'source_url',  image_attribution->>'credit',
          'license_url', image_attribution->>'licenseUrl'
        )) AS kv(k, v)
        WHERE NOT image_attribution ? k AND v IS NOT NULL
      ), '{}'::jsonb))
`;

export class ImageAttributionKeys1731000000001 implements MigrationInterface {
  name = 'ImageAttributionKeys1731000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('poi_product')) {
      // Defensive: ADD COLUMN IF NOT EXISTS so the migration is safe on older
      // databases where the column was never created (e.g. legacy dev envs).
      await queryRunner.query(`ALTER TABLE poi_product ADD COLUMN IF NOT EXISTS image_attribution JSONB`);

      await queryRunner.query(`
        UPDATE poi_product
        SET image_attribution = (${NORMALIZE_LEGACY_TO_CANONICAL})
        WHERE image_attribution ? 'author'
      `);
    }

    // Canonical-model table (Python pipeline). Absent in the observed
    // production schema — the guard makes this block a no-op there without
    // ever emitting SQL that names a missing table.
    if (await queryRunner.hasTable('poi_canonical')) {
      await queryRunner.query(`ALTER TABLE poi_canonical ADD COLUMN IF NOT EXISTS image_attribution JSONB`);

      await queryRunner.query(`
        UPDATE poi_canonical
        SET image_attribution = (${NORMALIZE_LEGACY_TO_CANONICAL})
        WHERE image_attribution ? 'author'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort reverse: re-create the legacy keys from the canonical ones,
    // again never overwriting an existing legacy key and preserving all other
    // (arbitrary) keys. Only touches rows that up() actually normalized
    // (canonical present, legacy author absent).
    if (await queryRunner.hasTable('poi_product')) {
      await queryRunner.query(`
        UPDATE poi_product
        SET image_attribution = (${DENORMALIZE_CANONICAL_TO_LEGACY})
        WHERE image_attribution ? 'artist'
          AND NOT (image_attribution ? 'author')
      `);
    }

    if (await queryRunner.hasTable('poi_canonical')) {
      await queryRunner.query(`
        UPDATE poi_canonical
        SET image_attribution = (${DENORMALIZE_CANONICAL_TO_LEGACY})
        WHERE image_attribution ? 'artist'
          AND NOT (image_attribution ? 'author')
      `);
    }
  }
}
