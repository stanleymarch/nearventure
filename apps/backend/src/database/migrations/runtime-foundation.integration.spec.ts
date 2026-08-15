/**
 * Ephemeral-PostgreSQL integration tests for the migration chain repair.
 *
 * These create and drop *disposable* databases on a reachable PostgreSQL
 * server — never the real dev/prod database. They are disabled unless
 * `MIGRATION_IT=1` is set, so the normal `npm test` run stays hermetic:
 *
 *   MIGRATION_IT=1 npx vitest run --config vitest.config.ts \
 *     src/database/migrations/runtime-foundation.integration.spec.ts
 *
 * Connection defaults match the dev stack (docker/docker-compose.yml):
 * localhost:5432, nearventure/nearventure_dev, and the maintenance database
 * `postgres` is used only to create/drop the disposable test databases.
 *
 * Coverage (review-prod-migration-repair.md "Required tests" 3 + 4):
 *   - production-shape: load `.tmp/nearventure-prod-schema.sql` (which has
 *     poi_product but no poi_canonical and no stale_from_osm), model the
 *     reported interrupted run (RoutePoisJsonb already recorded), run the
 *     normal migration chain, and assert success / no poi_canonical /
 *     recorded migrations / untouched poi_product / legacy sync retired.
 *   - blank-db: run only the normal migration chain against an empty
 *     database, assert no pending migrations on the second run and that the
 *     runtime contracts (PoisService join, incremental-sync insert) work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { MIGRATIONS } from '../migration-registry';

const ENABLED = process.env.MIGRATION_IT === '1';

const BASE = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME || 'nearventure',
  password: process.env.DB_PASSWORD || 'nearventure_dev',
};

const MIGRATION_NAMES = MIGRATIONS.map((M) => new M().name);

function schemaDumpPath(): string {
  const candidates = [
    join(process.cwd(), '.tmp', 'nearventure-prod-schema.sql'),
    join(__dirname, '..', '..', '..', '..', '..', '.tmp', 'nearventure-prod-schema.sql'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('nearventure-prod-schema.sql not found — run from the repo or apps/backend');
}

function makeDataSource(db: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host: BASE.host,
    port: BASE.port,
    username: BASE.user,
    password: BASE.password,
    database: db,
    // Entities are irrelevant for running raw-SQL migrations; keeping the list
    // empty also avoids emitting decorator metadata in the vitest transform.
    entities: [],
    migrations: MIGRATIONS,
    synchronize: false,
    logging: false,
  });
}

async function createDatabase(name: string): Promise<void> {
  const admin = new Client({ ...BASE, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(name: string): Promise<void> {
  const admin = new Client({ ...BASE, database: 'postgres' });
  await admin.connect();
  try {
    // Terminate lingering connections (e.g. a failed run's pool) first.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  } catch {
    // Best-effort cleanup only.
  } finally {
    await admin.end();
  }
}

async function runMigrations(db: string): Promise<string[]> {
  const ds = makeDataSource(db);
  await ds.initialize();
  try {
    const ran = await ds.runMigrations({ transaction: 'each' });
    return ran.map((m) => m.name);
  } finally {
    await ds.destroy();
  }
}

async function loadSchemaDump(db: string): Promise<void> {
  const client = new Client({ ...BASE, database: db });
  await client.connect();
  try {
    await client.query(readFileSync(schemaDumpPath(), 'utf8'));
  } finally {
    await client.end();
  }
}

function rand(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('migration chain integration (ephemeral PostgreSQL)', { skip: !ENABLED }, () => {
  const prodDb = `migration_it_prod_${rand()}`;
  const blankDb = `migration_it_blank_${rand()}`;
  let ds: DataSource | null = null;

  beforeAll(async () => {
    await createDatabase(prodDb);
    await createDatabase(blankDb);
  }, 60_000);

  afterAll(async () => {
    if (ds) {
      await ds.destroy().catch(() => {});
      ds = null;
    }
    await dropDatabase(prodDb);
    await dropDatabase(blankDb);
  }, 60_000);

  it(
    'production-shape: migrated dump stays intact, no poi_canonical, legacy sync retired',
    async () => {
      // 1. Load the observed production schema structure (no poi_canonical,
      //    no stale_from_osm on poi_product).
      await loadSchemaDump(prodDb);

      ds = makeDataSource(prodDb);
      await ds.initialize();

      // 2. Model the reported interrupted run: RoutePoisJsonb was already
      //    recorded before ImageAttributionKeys failed and rolled back.
      await ds.query(
        `INSERT INTO migrations ("timestamp", name) VALUES (1731000000000, 'RoutePoisJsonb1731000000000')`,
      );

      // 3. Seed one legacy poi_product row so we can prove data survives.
      //    image_attribution carries the legacy Commons key shape plus
      //    arbitrary extra metadata keys — both must survive the chain
      //    (normalized, extras preserved).
      await ds.query(
        `INSERT INTO public.poi_product
           (poi_uuid, source, external_id, category, name, description, image_url, lat, lon,
            is_active, image_attribution, created_at, updated_at)
         VALUES
           ('8637976e969f430c191c873373e152cf', 'osm', '555', 'sights', 'Старый дом', 'desc', 'http://img/x.jpg', 58.6, 49.6,
            true, '{"author":"Old Author","source_url":"http://src.example/x.jpg","license_url":"http://lic.example/","photographer":"Extra Person","custom_note":"keep-me"}'::jsonb,
            now(), now())`,
      );
      const checksumBefore = JSON.stringify(
        await ds.query(
          `SELECT poi_uuid, source, external_id, category, name, description, image_url FROM poi_product ORDER BY poi_uuid`,
        ),
      );

      // 4. Run the normal migration chain.
      const ran = await ds.runMigrations({ transaction: 'each' });
      expect(ran.map((m) => m.name).sort()).toEqual(
        MIGRATION_NAMES.filter((n) => n !== 'RoutePoisJsonb1731000000000').sort(),
      );

      // 5. Assertions on the result.
      const canonical = await ds.query(`SELECT to_regclass('public.poi_canonical') IS NULL AS absent`);
      expect(canonical[0].absent).toBe(true);

      const recorded = await ds.query(`SELECT name FROM migrations ORDER BY id`);
      expect(recorded.map((r: { name: string }) => r.name)).toEqual(MIGRATION_NAMES);

      const rowAfter = JSON.stringify(
        await ds.query(
          `SELECT poi_uuid, source, external_id, category, name, description, image_url FROM poi_product ORDER BY poi_uuid`,
        ),
      );
      expect(rowAfter).toBe(checksumBefore); // untouched by the chain

      // 5b. image_attribution was normalized (legacy keys → canonical) by
      //     ImageAttributionKeys1731000000001 *without* dropping the extra
      //     metadata keys and *without* touching anything else. jsonb `=`
      //     ignores key order, so compare on the server side.
      const attributionOk = await ds.query(
        `SELECT image_attribution = $1::jsonb AS ok FROM poi_product WHERE poi_uuid = '8637976e969f430c191c873373e152cf'`,
        [
          JSON.stringify({
            artist: 'Old Author',
            credit: 'http://src.example/x.jpg',
            licenseUrl: 'http://lic.example/',
            photographer: 'Extra Person',
            custom_note: 'keep-me',
          }),
        ],
      );
      expect(attributionOk[0].ok).toBe(true);
      // And the legacy keys really are gone from the stored value.
      const legacyKeys = await ds.query(
        `SELECT image_attribution ? 'author' AS has_author,
                image_attribution ? 'source_url' AS has_source_url,
                image_attribution ? 'license_url' AS has_license_url
         FROM poi_product WHERE poi_uuid = '8637976e969f430c191c873373e152cf'`,
      );
      expect(legacyKeys[0]).toMatchObject({ has_author: false, has_source_url: false, has_license_url: false });

      const stale = await ds.query(
        `SELECT count(*) AS n FROM information_schema.columns
         WHERE table_name = 'poi_product' AND column_name = 'stale_from_osm'`,
      );
      expect(Number(stale[0].n)).toBe(0); // retired by RetireOsmSyncState

      const syncState = await ds.query(`SELECT to_regclass('public.osm_sync_state') IS NULL AS absent`);
      expect(syncState[0].absent).toBe(true); // retired by RetireOsmSyncState

      // 6. Runtime contract holds on the migrated production shape:
      //    the PoisService poi_product LEFT JOIN poi_overrides select.
      const joined = await ds.query(
        `SELECT pp.name, po.display_name FROM poi_product pp
         LEFT JOIN poi_overrides po ON pp.poi_uuid = po.poi_uuid
         WHERE pp.is_active = true AND pp.poi_uuid = '8637976e969f430c191c873373e152cf'`,
      );
      expect(joined).toHaveLength(1);

      await ds.destroy();
      ds = null;
    },
    180_000,
  );

  it(
    'blank-db: normal migration chain bootstraps the full runtime schema and is idempotent',
    async () => {
      // 1. Only the normal migration chain against an empty database.
      const ran = await runMigrations(blankDb);
      expect(ran).toEqual(MIGRATION_NAMES);

      // 2. Second run — nothing pending.
      const secondRun = await runMigrations(blankDb);
      expect(secondRun).toEqual([]);

      ds = makeDataSource(blankDb);
      await ds.initialize();

      // 3. Foundational tables exist.
      const tables = (await ds.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      )) as { tablename: string }[];
      const tableNames = new Set(tables.map((t) => t.tablename));
      for (const t of [
        'user', 'routes', 'analytics_event', 'route_feedback', 'subscriptions',
        'telegram_user', 'telegram_last_route', 'telegram_poi_media',
        'itinerary_draft', 'itinerary_command', 'poi_overrides', 'poi_product',
        'migrations',
      ]) {
        expect(tableNames.has(t), `missing foundational table: ${t}`).toBe(true);
      }

      // 4. No conditional pipeline / legacy tables were created.
      for (const t of [
        'poi_canonical', 'match_candidate', 'pipeline_runs',
        'raw_osm', 'raw_egrkn', 'raw_wikidata', 'raw_wikivoyage', 'raw_mkrf',
        'poi', 'poi_override', 'poi_product_old', 'poi_product_before_v0_3',
        'donations', 'scheduled_broadcasts', 'broadcast_logs',
        'osm_sync_state', // retired by RetireOsmSyncState1786341200000
      ]) {
        expect(tableNames.has(t), `conditional table must not be created: ${t}`).toBe(false);
      }

      // 5. Enum types exist.
      const enums = (await ds.query(
        `SELECT typname FROM pg_type WHERE typname IN
           ('routes_status_enum', 'routes_previousstatus_enum', 'subscriptions_status_enum')`,
      )) as { typname: string }[];
      expect(new Set(enums.map((e) => e.typname))).toEqual(
        new Set(['routes_status_enum', 'routes_previousstatus_enum', 'subscriptions_status_enum']),
      );

      // 6. Runtime contract: PoisService poi_product LEFT JOIN poi_overrides.
      await ds.query(
        `INSERT INTO poi_product
           (poi_uuid, source, external_id, category, name, lat, lon, is_active, created_at, updated_at)
         VALUES ('8637976e969f430c191c873373e152cf', 'osm', '123', 'pending', 'Тест', 58.6, 49.6,
                 true, NOW(), NOW())
         ON CONFLICT (poi_uuid) DO UPDATE SET name = EXCLUDED.name,
           is_active = true, updated_at = NOW()`,
      );
      await ds.query(
        `INSERT INTO poi_overrides (poi_uuid, display_name, updated_by)
         VALUES ('8637976e969f430c191c873373e152cf', 'Тест (ручная)', 'admin')`,
      );
      const joined = await ds.query(
        `SELECT pp.name, po.display_name FROM poi_product pp
         LEFT JOIN poi_overrides po ON pp.poi_uuid = po.poi_uuid
         WHERE pp.is_active = true`,
      );
      expect(joined).toHaveLength(1);
      expect(joined[0]).toMatchObject({ name: 'Тест', display_name: 'Тест (ручная)' });

      // 7. Legacy OSM-sync state was retired by the forward migration:
      //    no osm_sync_state table, no stale_from_osm column.
      const syncState = await ds.query(`SELECT to_regclass('public.osm_sync_state') IS NULL AS absent`);
      expect(syncState[0].absent).toBe(true);
      const stale = await ds.query(
        `SELECT count(*) AS n FROM information_schema.columns
         WHERE table_name = 'poi_product' AND column_name = 'stale_from_osm'`,
      );
      expect(Number(stale[0].n)).toBe(0);

      await ds.destroy();
      ds = null;
    },
    120_000,
  );
});
