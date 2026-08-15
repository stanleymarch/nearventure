/**
 * Isolated Postgres acceptance for the POI importer (C6).
 *
 * Runs only when TEST_DATABASE_URL points at a scratch database (the suite
 * drops every table it creates). Verifies the full contract against a real
 * PostgreSQL:
 *   - a valid bundle imports exactly records.count rows;
 *   - `poi_overrides` survives the swap untouched;
 *   - the audit table records the bundle and replay is rejected unless allowed;
 *   - a grammar-rejected bundle writes nothing;
 *   - a forced mid-load failure rolls back, leaving the previous `poi_product`
 *     and `poi_overrides` intact and no staging table behind.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportReplayError, ImportValidationError } from './import-errors';
import { POI_WRITE_LOCK_KEY, POI_WRITE_LOCK_SQL } from './poi-write-lock';
import { PoiImporterService } from './poi-importer.service';
import { createValidBundle, defaultFixtureRows, fixtureUuid, sha256Hex, type BundleFiles } from './test-fixtures';

const testDbUrl = process.env.TEST_DATABASE_URL;

const POI_PRODUCT_DDL = `
  CREATE TABLE poi_product (
    poi_uuid varchar NOT NULL,
    source varchar NOT NULL,
    external_id varchar NOT NULL,
    category varchar NOT NULL,
    subcategory varchar,
    name text,
    description text,
    image_url varchar,
    lat double precision,
    lon double precision,
    heritage_facet varchar,
    is_protected boolean DEFAULT false,
    featured boolean DEFAULT false,
    popularity_score double precision DEFAULT 0,
    provenance jsonb,
    attribution jsonb,
    wikidata_qid varchar,
    is_active boolean DEFAULT true,
    official_url varchar,
    social_url varchar,
    image_source varchar,
    article_url varchar,
    wikivoyage_url varchar,
    egrkn_url varchar,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    egrkn_reg_number varchar,
    region varchar,
    district varchar,
    city varchar,
    year integer,
    year_end integer,
    year_source varchar,
    desc_source varchar,
    image_attribution jsonb,
    wikidata_url varchar(500),
    stale_from_osm boolean NOT NULL DEFAULT false,
    PRIMARY KEY (poi_uuid)
  )
`;

const POI_OVERRIDES_DDL = `
  CREATE TABLE poi_overrides (
    poi_uuid varchar(32) NOT NULL PRIMARY KEY,
    display_name varchar(500),
    description text,
    image_url text,
    image_attribution jsonb,
    osm_contributor varchar(255),
    updated_by varchar(50) DEFAULT 'admin' NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
  )
`;

let tmpDirs: string[] = [];
let trustedRoot: string;

/** Absolute run dir under a shared trusted root; returns its relative path. */
async function makeRunDir(): Promise<string> {
  if (!trustedRoot || !(await fs.stat(trustedRoot).then(() => true).catch(() => false))) {
    trustedRoot = await fs.mkdtemp(join(tmpdir(), 'poi-int-trusted-'));
    tmpDirs.push(trustedRoot);
  }
  const runDir = await fs.mkdtemp(join(trustedRoot, 'run-XXXXXX'));
  tmpDirs.push(runDir);
  return runDir;
}

function relOf(dir: string): string {
  return relative(trustedRoot, dir);
}

describe.skipIf(!testDbUrl || process.platform !== 'linux')('PoiImporterService isolated Postgres acceptance', () => {
  const dataSource = new DataSource({
    type: 'postgres',
    url: testDbUrl as string,
    synchronize: false,
    logging: false,
  });
  const service = new PoiImporterService(dataSource, { log: () => undefined });
  let bundle: BundleFiles;

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query(POI_PRODUCT_DDL);
    await dataSource.query(POI_OVERRIDES_DDL);
  });

  afterAll(async () => {
    await dataSource
      .query(
        `DROP TABLE IF EXISTS poi_import_audit, poi_overrides, poi_product, poi_product_before_v0_3 CASCADE`,
      )
      .catch(() => undefined);
    await dataSource.destroy().catch(() => undefined);
    await Promise.all(
      tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    );
  });

  it('imports exactly records.count rows, preserves overrides and writes the audit row', async () => {
    bundle = await createValidBundle(await makeRunDir(), defaultFixtureRows());
    const legacyUuid = 'legacy'.padEnd(32, 'x');
    await dataSource.query(
      `INSERT INTO poi_overrides (poi_uuid, display_name) VALUES ($1, $2)`,
      [fixtureUuid('entity:1'), 'Старое имя (override)'],
    );
    await dataSource.query(
      `INSERT INTO poi_product (poi_uuid, source, external_id, category, name, stale_from_osm)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [legacyUuid, 'osm', 'legacy-row', 'heritage', 'Legacy row that must retire'],
    );

    const result = await service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) });
    expect(result.recordsCount).toBe(3);

    const count = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_product')) as Array<{ c: number }>;
    expect(count[0].c).toBe(3);
    const legacy = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM poi_product WHERE poi_uuid = $1`,
      [legacyUuid],
    )) as Array<{ c: number }>;
    expect(legacy[0].c).toBe(0);

    // override for an imported uuid survives and still shadows the base name
    const override = (await dataSource.query(
      `SELECT display_name FROM poi_overrides WHERE poi_uuid = $1`,
      [fixtureUuid('entity:1')],
    )) as Array<{ display_name: string }>;
    expect(override[0].display_name).toBe('Старое имя (override)');

    // audit ledger has exactly one row for this manifest
    const manifestBytes = await fs.readFile(bundle.manifestPath);
    const audit = (await dataSource.query(
      `SELECT dataset_version, records_count, status FROM poi_import_audit WHERE manifest_sha256 = $1`,
      [sha256Hex(manifestBytes)],
    )) as Array<{ dataset_version: string; records_count: number; status: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].dataset_version).toBe('pfo-2026-07-26-v0.1');
    expect(audit[0].records_count).toBe(3);
    expect(audit[0].status).toBe('ok');

    // production index surface restored
    const indexes = (await dataSource.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'poi_product'`,
    )) as Array<{ indexname: string }>;
    const names = indexes.map((i) => i.indexname);
    expect(names).toContainEqual(expect.stringMatching(/^poi_product_pkey_[0-9a-f]{16}$/));
    expect(names).toContain('poi_product_staging_lat_lon_idx1');
    expect(names).toContain('poi_product_staging_source_idx1');
    expect(names).toContain('poi_product_staging_category_idx1');
  });

  it('rejects a replay of the same bundle by default and allows it explicitly', async () => {
    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) })).rejects.toBeInstanceOf(
      ImportReplayError,
    );
    const result = await service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir), allowReplay: true });
    expect(result.replayed).toBe(true);
    const count = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_product')) as Array<{ c: number }>;
    expect(count[0].c).toBe(3);
  });

  it('writes nothing for a grammar-rejected (tampered) bundle', async () => {
    const bad = await createValidBundle(await makeRunDir(), defaultFixtureRows());
    const evil = bad.sql + ' DROP TABLE poi_overrides;';
    await fs.writeFile(bad.sqlPath, evil);
    const sqlBytes = await fs.readFile(bad.sqlPath);
    const manifest = JSON.parse(await fs.readFile(bad.manifestPath, 'utf8')) as Record<string, any>;
    manifest.records.sha256 = sha256Hex(sqlBytes);
    manifest.records.bytes = sqlBytes.byteLength;
    await fs.writeFile(bad.manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const before = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_product')) as Array<{ c: number }>;
    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(bad.runDir) })).rejects.toBeInstanceOf(
      ImportValidationError,
    );
    const after = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_product')) as Array<{ c: number }>;
    expect(after[0].c).toBe(before[0].c);
    const overrides = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_overrides')) as Array<{ c: number }>;
    expect(overrides[0].c).toBe(1);
    const staging = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'poi_product_staging_%'`,
    )) as Array<{ c: number }>;
    expect(staging[0].c).toBe(0);
  });

  it('shares the poi_product advisory write lock contract with other writers', async () => {
    // A third-party writer transaction (as the analytics popularity recompute
    // would do) takes the exact same xact lock the importer uses.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(POI_WRITE_LOCK_SQL, [POI_WRITE_LOCK_KEY]);

    // While held, no other session can take the lock (deterministic try-lock,
    // no timing involved).
    const locked = (await dataSource.query(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok',
      [POI_WRITE_LOCK_KEY],
    )) as Array<{ ok: boolean }>;
    expect(locked[0].ok).toBe(false);

    await holder.commitTransaction();

    const free = (await dataSource.query(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok',
      [POI_WRITE_LOCK_KEY],
    )) as Array<{ ok: boolean }>;
    expect(free[0].ok).toBe(true);
    await holder.release();
  });

  it('serializes concurrent imports via the shared advisory lock without corrupting state', async () => {
    // Two distinct bundles (different manifest sha256 than every earlier test).
    const bundleA = await createValidBundle(await makeRunDir(), [
      { ...defaultFixtureRows()[0], id: 'entity:7', name: 'Первый параллельный' },
      ...defaultFixtureRows().slice(1),
    ]);
    const bundleB = await createValidBundle(await makeRunDir(), [
      { ...defaultFixtureRows()[0], id: 'entity:9', name: 'Отдельный объект' },
      ...defaultFixtureRows().slice(1),
    ]);

    const [a, b] = await Promise.all([
      service.importPoiExport({ trustedRoot, runDir: relOf(bundleA.runDir) }),
      service.importPoiExport({ trustedRoot, runDir: relOf(bundleB.runDir) }),
    ]);
    expect(a.recordsCount).toBe(3);
    expect(b.recordsCount).toBe(3);

    // Both manifests were audited.
    const shaA = sha256Hex(await fs.readFile(bundleA.manifestPath));
    const shaB = sha256Hex(await fs.readFile(bundleB.manifestPath));
    const audit = (await dataSource.query(
      `SELECT manifest_sha256 FROM poi_import_audit WHERE manifest_sha256 = ANY($1)`,
      [[shaA, shaB]],
    )) as Array<{ manifest_sha256: string }>;
    expect(audit).toHaveLength(2);

    // Exactly one full table is left, with no staging/retired leftovers.
    const staging = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'poi_product_staging_%'`,
    )) as Array<{ c: number }>;
    expect(staging[0].c).toBe(0);
    const retired = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'poi_product_retired_%'`,
    )) as Array<{ c: number }>;
    expect(retired[0].c).toBe(0);
    const count = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_product')) as Array<{ c: number }>;
    expect(count[0].c).toBe(3);
  });

  it('uses a tokenized primary-key name when an unrelated preserved table owns poi_product_pkey', async () => {
    // Reproduce the production history that failed with `relation
    // "poi_product_pkey" already exists`: a preserved historical table
    // (poi_product_before_v0_3) owns the schema-level name `poi_product_pkey`,
    // while the live table's PK already has a generated name. Constraint/index
    // names share one namespace per schema, so the importer must not touch the
    // unrelated table.
    await dataSource.query(
      `CREATE TABLE poi_product_before_v0_3 (LIKE poi_product INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)`,
    );
    await dataSource.query(
      `ALTER TABLE poi_product_before_v0_3 ADD CONSTRAINT poi_product_pkey PRIMARY KEY (poi_uuid)`,
    );

    const collisionBundle = await createValidBundle(await makeRunDir(), [
      { ...defaultFixtureRows()[0], id: 'entity:21', name: 'Объект при коллизии' },
      ...defaultFixtureRows().slice(1),
    ]);
    const result = await service.importPoiExport({ trustedRoot, runDir: relOf(collisionBundle.runDir) });
    expect(result.recordsCount).toBe(3);

    // Live PK keeps uniqueness semantics under a collision-free tokenized name.
    const livePk = (await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'poi_product'::regclass AND contype = 'p'`,
    )) as Array<{ conname: string }>;
    expect(livePk).toHaveLength(1);
    expect(livePk[0].conname).toMatch(/^poi_product_pkey_[0-9a-f]{16}$/);

    // The unrelated historical table is untouched and still owns the canonical name.
    const historicalPk = (await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'poi_product_before_v0_3'::regclass AND contype = 'p'`,
    )) as Array<{ conname: string }>;
    expect(historicalPk).toEqual([{ conname: 'poi_product_pkey' }]);

    // UNIQUE (source, external_id) semantics restored on the live table.
    const uniq = (await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'poi_product'::regclass AND contype = 'u'`,
    )) as Array<{ conname: string }>;
    expect(uniq).toHaveLength(1);

    // Rows + overrides intact, audited once, no staging/retired leftovers.
    const count = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_product')) as Array<{ c: number }>;
    expect(count[0].c).toBe(3);
    const overrides = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_overrides')) as Array<{ c: number }>;
    expect(overrides[0].c).toBe(1);
    const staging = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'poi_product_staging_%'`,
    )) as Array<{ c: number }>;
    expect(staging[0].c).toBe(0);
    const retired = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'poi_product_retired_%'`,
    )) as Array<{ c: number }>;
    expect(retired[0].c).toBe(0);
    const manifestBytes = await fs.readFile(collisionBundle.manifestPath);
    const audit = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM poi_import_audit WHERE manifest_sha256 = $1`,
      [sha256Hex(manifestBytes)],
    )) as Array<{ c: number }>;
    expect(audit[0].c).toBe(1);
  });

  it('rolls back a forced mid-load failure leaving previous state intact', async () => {
    // A NOT NULL column without a default makes every exported INSERT fail on
    // the staging table — exactly the kind of schema incompatibility the
    // importer must surface atomically. (Seed rows first, then drop the
    // default, so the ALTER succeeds on a populated table.)
    await dataSource.query(`ALTER TABLE poi_product ADD COLUMN mandatory_extra varchar NOT NULL DEFAULT 'seed'`);
    await dataSource.query(`ALTER TABLE poi_product ALTER COLUMN mandatory_extra DROP DEFAULT`);

    const fresh = await createValidBundle(await makeRunDir(), [
      // Distinct rows so this bundle has a different manifest sha256 than any
      // bundle imported by the earlier tests (a replay rejection would
      // otherwise short-circuit before the mid-load failure).
      { ...defaultFixtureRows()[0], id: 'entity:11', name: 'Третий объект' },
      ...defaultFixtureRows().slice(1),
    ]);
    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(fresh.runDir) })).rejects.toBeDefined();

    const count = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_product')) as Array<{ c: number }>;
    expect(count[0].c).toBe(3); // previous data untouched
    const overrides = (await dataSource.query('SELECT COUNT(*)::int AS c FROM poi_overrides')) as Array<{ c: number }>;
    expect(overrides[0].c).toBe(1);
    const staging = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'poi_product_staging_%'`,
    )) as Array<{ c: number }>;
    expect(staging[0].c).toBe(0);
    // the failed bundle was never audited
    const manifestBytes = await fs.readFile(fresh.manifestPath);
    const audit = (await dataSource.query(
      `SELECT COUNT(*)::int AS c FROM poi_import_audit WHERE manifest_sha256 = $1`,
      [sha256Hex(manifestBytes)],
    )) as Array<{ c: number }>;
    expect(audit[0].c).toBe(0);
  });
});
