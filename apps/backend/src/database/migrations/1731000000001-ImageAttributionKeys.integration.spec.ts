/**
 * Real-PostgreSQL semantics tests for ImageAttributionKeys1731000000001.
 *
 * The review required (review-prod-migration-repair.md follow-up) proving in
 * real Postgres that the historical migration:
 *   (1) preserves arbitrary JSONB keys (no `jsonb_build_object` rebuild),
 *   (2) removes/normalizes the legacy keys (`author`, `source_url`,
 *       `license_url` → `artist`, `credit`, `licenseUrl`),
 *   (3) never overwrites existing canonical `artist`/`credit` values with
 *       legacy `author`/`source_url` values on mixed rows.
 *
 * Runs only against a *disposable* database and only when MIGRATION_IT=1:
 *
 *   MIGRATION_IT=1 npx vitest run --config vitest.config.ts \
 *     src/database/migrations/1731000000001-ImageAttributionKeys.integration.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ImageAttributionKeys1731000000001 } from './1731000000001-ImageAttributionKeys';

const ENABLED = process.env.MIGRATION_IT === '1';

const BASE = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME || 'nearventure',
  password: process.env.DB_PASSWORD || 'nearventure_dev',
};

const LEGACY_ONLY = JSON.stringify({
  author: 'Old Author',
  source_url: 'http://src.example/legacy.jpg',
  license_url: 'http://lic.example/legacy',
});
// Control row: already canonical, must not be touched by up().
const CANONICAL_ONLY = JSON.stringify({
  artist: 'Modern Artist',
  credit: 'http://src.example/modern.jpg',
  licenseUrl: 'http://lic.example/modern',
  license: 'CC-BY-SA-4.0',
});
// Mixed row: legacy AND canonical disagree — canonical must win, legacy removed.
const CONFLICT = JSON.stringify({
  artist: 'Keep Me Canonical',
  credit: 'http://src.example/canonical.jpg',
  licenseUrl: 'http://lic.example/canonical',
  author: 'Legacy Author Should Not Win',
  source_url: 'http://src.example/legacy.jpg',
  license_url: 'http://lic.example/legacy',
});
// Legacy + arbitrary extra metadata keys, which must survive.
const LEGACY_WITH_EXTRAS = JSON.stringify({
  author: 'Extra Author',
  source_url: 'http://src.example/extra.jpg',
  license_url: 'http://lic.example/extra',
  photographer: 'Extra Person',
  custom_note: { nested: true, tags: ['a', 'b'] },
  attribution: 'Attribution text',
  description: 'Some description',
});
// Canonical key present but null — up() must not replace it with legacy.
const NULL_CANONICAL = JSON.stringify({ artist: null, author: 'Null Artist Legacy' });

/** Expected post-up() values, asserted with jsonb `=` (order-insensitive). */
const EXPECTED_AFTER_UP: Record<string, string> = {
  legacy_only: JSON.stringify({
    artist: 'Old Author',
    credit: 'http://src.example/legacy.jpg',
    licenseUrl: 'http://lic.example/legacy',
  }),
  canonical_only: CANONICAL_ONLY,
  conflict: JSON.stringify({
    artist: 'Keep Me Canonical',
    credit: 'http://src.example/canonical.jpg',
    licenseUrl: 'http://lic.example/canonical',
  }),
  legacy_with_extras: JSON.stringify({
    artist: 'Extra Author',
    credit: 'http://src.example/extra.jpg',
    licenseUrl: 'http://lic.example/extra',
    photographer: 'Extra Person',
    custom_note: { nested: true, tags: ['a', 'b'] },
    attribution: 'Attribution text',
    description: 'Some description',
  }),
  null_canonical: JSON.stringify({ artist: null }),
};

const LEGACY_KEYS = ['author', 'source_url', 'license_url'];

function rand(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeDataSource(db: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host: BASE.host,
    port: BASE.port,
    username: BASE.user,
    password: BASE.password,
    database: db,
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false,
  });
}

describe('ImageAttributionKeys real-Postgres semantics', { skip: !ENABLED }, () => {
  const dbName = `migration_it_attribution_${rand()}`;
  let admin: Client;
  let ds: DataSource;

  beforeAll(async () => {
    admin = new Client({ ...BASE, database: 'postgres' });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    ds = makeDataSource(dbName);
    await ds.initialize();
    // Minimal production-shaped tables (poi_product + the guarded
    // poi_canonical) with only the column the migration touches.
    await ds.query(`CREATE TABLE public.poi_product (
      poi_uuid varchar PRIMARY KEY,
      image_attribution jsonb
    )`);
    await ds.query(`CREATE TABLE public.poi_canonical (
      poi_uuid varchar PRIMARY KEY,
      image_attribution jsonb
    )`);
    const rows = [
      ['legacy_only', LEGACY_ONLY],
      ['canonical_only', CANONICAL_ONLY],
      ['conflict', CONFLICT],
      ['legacy_with_extras', LEGACY_WITH_EXTRAS],
      ['null_canonical', NULL_CANONICAL],
    ];
    for (const table of ['poi_product', 'poi_canonical']) {
      for (const [id, json] of rows) {
        await ds.query(
          `INSERT INTO ${table} (poi_uuid, image_attribution) VALUES ($1, $2::jsonb)`,
          [`${table}_${id}`, json],
        );
      }
    }
  }, 60_000);

  afterAll(async () => {
    await ds.destroy().catch(() => {});
    admin = new Client({ ...BASE, database: 'postgres' });
    await admin.connect();
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [dbName],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    } finally {
      await admin.end();
    }
  }, 60_000);

  async function attributionOf(table: string, id: string): Promise<unknown> {
    const res = await ds.query(`SELECT image_attribution FROM ${table} WHERE poi_uuid = $1`, [
      `${table}_${id}`,
    ]);
    return res[0].image_attribution;
  }

  it('up: normalizes legacy keys, preserves arbitrary keys, never overwrites canonical values', async () => {
    const qr = ds.createQueryRunner();
    try {
      await new ImageAttributionKeys1731000000001().up(qr);
    } finally {
      await qr.release();
    }

    for (const table of ['poi_product', 'poi_canonical']) {
      for (const [id, expectedJson] of Object.entries(EXPECTED_AFTER_UP)) {
        const res = await ds.query(
          `SELECT image_attribution = $1::jsonb AS ok FROM ${table} WHERE poi_uuid = $2`,
          [expectedJson, `${table}_${id}`],
        );
        expect(res[0]?.ok, `${table}/${id} expected ${expectedJson}`).toBe(true);
      }
      // Legacy keys must be gone everywhere after up().
      for (const key of LEGACY_KEYS) {
        const res = await ds.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE image_attribution ? $1`,
          [key],
        );
        expect(res[0].n, `${table} still has key ${key}`).toBe(0);
      }
    }
  });

  it('up: idempotent — a second run rewrites nothing', async () => {
    const before = JSON.stringify(await ds.query(`SELECT * FROM poi_product ORDER BY poi_uuid`));
    const qr = ds.createQueryRunner();
    try {
      await new ImageAttributionKeys1731000000001().up(qr);
    } finally {
      await qr.release();
    }
    const after = JSON.stringify(await ds.query(`SELECT * FROM poi_product ORDER BY poi_uuid`));
    expect(after).toBe(before);
  });

  it('down: restores legacy keys from canonical values, keeps canonical and extras', async () => {
    const qr = ds.createQueryRunner();
    try {
      await new ImageAttributionKeys1731000000001().down(qr);
    } finally {
      await qr.release();
    }

    // After down(): canonical-only rows got the legacy keys back,
    // extras survive, canonical keys stay.
    const expectDown = {
      legacy_only: JSON.stringify({
        artist: 'Old Author',
        credit: 'http://src.example/legacy.jpg',
        licenseUrl: 'http://lic.example/legacy',
        author: 'Old Author',
        source_url: 'http://src.example/legacy.jpg',
        license_url: 'http://lic.example/legacy',
      }),
      canonical_only: JSON.stringify({
        artist: 'Modern Artist',
        credit: 'http://src.example/modern.jpg',
        licenseUrl: 'http://lic.example/modern',
        license: 'CC-BY-SA-4.0',
        author: 'Modern Artist',
        source_url: 'http://src.example/modern.jpg',
        license_url: 'http://lic.example/modern',
      }),
      conflict: JSON.stringify({
        artist: 'Keep Me Canonical',
        credit: 'http://src.example/canonical.jpg',
        licenseUrl: 'http://lic.example/canonical',
        author: 'Keep Me Canonical',
        source_url: 'http://src.example/canonical.jpg',
        license_url: 'http://lic.example/canonical',
      }),
      legacy_with_extras: JSON.stringify({
        artist: 'Extra Author',
        credit: 'http://src.example/extra.jpg',
        licenseUrl: 'http://lic.example/extra',
        photographer: 'Extra Person',
        custom_note: { nested: true, tags: ['a', 'b'] },
        attribution: 'Attribution text',
        description: 'Some description',
        author: 'Extra Author',
        source_url: 'http://src.example/extra.jpg',
        license_url: 'http://lic.example/extra',
      }),
      // artist stays null; down() only backfills legacy keys from canonical.
      null_canonical: JSON.stringify({ artist: null }),
    };
    for (const table of ['poi_product', 'poi_canonical']) {
      for (const [id, expectedJson] of Object.entries(expectDown)) {
        const res = await ds.query(
          `SELECT image_attribution = $1::jsonb AS ok FROM ${table} WHERE poi_uuid = $2`,
          [expectedJson, `${table}_${id}`],
        );
        expect(res[0]?.ok, `${table}/${id} after down expected ${expectedJson}`).toBe(true);
      }
    }
  });
});
