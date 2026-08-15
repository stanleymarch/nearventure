/**
 * Migration 1786340733385-CreateRuntimeFoundation
 *
 * Versioned runtime foundation for the deployed NestJS application.
 *
 * Problem: the migration CLI runs with `synchronize: false` and previously
 * contained only *additive* migrations (column additions, JSONB conversions).
 * A blank database therefore had neither `routes` nor `poi_product`, so a
 * fresh production bootstrap was impossible through the normal CLI. At the
 * same time, the observed production schema (`.tmp/nearventure-prod-schema.sql`)
 * has poi_product but *no* poi_canonical, and its poi_product lacks
 * `stale_from_osm` which the backend incremental OSM sync requires.
 *
 * This migration is the single, versioned bootstrap:
 *   - On a blank database it creates every runtime table/index/type that the
 *     deployed modules read or write, using `CREATE TABLE IF NOT EXISTS`,
 *     `CREATE INDEX IF NOT EXISTS`, enum `DO`-blocks and narrow
 *     `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` compatibility steps.
 *   - On an existing production-shaped database it is additive and
 *     idempotent: `CREATE TABLE IF NOT EXISTS` no-ops, and the only
 *     reconciliation is adding the missing `stale_from_osm` column plus
 *     index definitions that already exist there.
 *   - It never creates the Python canonical/pipeline tables
 *     (poi_canonical, match_candidate, pipeline_runs, raw_*), the deprecated
 *     TypeORM `poi` table, singular `poi_override`, staging copies, or the
 *     inactive feature tables (donations, scheduled_broadcasts,
 *     broadcast_logs). Those stay conditional/non-foundational.
 *
 * The column definitions mirror the observed production contract from
 * `.tmp/nearventure-prod-schema.sql` (including quoted mixed-case TypeORM
 * identifiers), generated against the current entity metadata and verified
 * against an empty PostgreSQL database.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Columns the runtime `PoisService`/sync SQL requires on poi_product. */
const POI_PRODUCT_REQUIRED_COLUMNS = [
  'poi_uuid',
  'source',
  'external_id',
  'category',
  'name',
  'lat',
  'lon',
  'is_active',
  'stale_from_osm',
];

export class CreateRuntimeFoundation1786340733385 implements MigrationInterface {
  name = 'CreateRuntimeFoundation1786340733385';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // route_feedback.id defaults to uuid_generate_v4() in the observed
    // production schema; make the extension available on fresh databases.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── Enums (guarded: CREATE TYPE is not idempotent) ───────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE routes_status_enum AS ENUM ('draft', 'published', 'hidden', 'archived');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE routes_previousstatus_enum AS ENUM ('draft', 'published', 'hidden', 'archived');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE subscriptions_status_enum AS ENUM ('active', 'inactive');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // ── Auth/users ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id SERIAL PRIMARY KEY,
        login VARCHAR NOT NULL UNIQUE,
        "passwordHash" VARCHAR NOT NULL,
        role VARCHAR DEFAULT 'user' NOT NULL,
        "createdAt" TIMESTAMP DEFAULT now() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT now() NOT NULL
      )
    `);

    // ── Routes ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS routes (
        id uuid NOT NULL,
        title varchar NOT NULL,
        description text,
        status routes_status_enum DEFAULT 'draft' NOT NULL,
        "previousStatus" routes_previousstatus_enum,
        transport text NOT NULL,
        "timeAvailable" integer,
        "selectedCategories" text NOT NULL,
        distance double precision NOT NULL,
        duration integer NOT NULL,
        ascend double precision NOT NULL,
        descend double precision NOT NULL,
        geojson json,
        pois jsonb,
        analytics json,
        "publicToken" varchar NOT NULL,
        "publicUrl" text,
        "expiresAt" date,
        "isPublished" boolean DEFAULT false NOT NULL,
        "isArchived" boolean DEFAULT false NOT NULL,
        "createdBy" text,
        "createdAt" timestamp DEFAULT now() NOT NULL,
        "updatedAt" timestamp DEFAULT now() NOT NULL,
        "publishedAt" date,
        "deletedAt" date,
        source_draft_id uuid,
        itinerary_snapshot jsonb,
        loop boolean,
        PRIMARY KEY (id)
      )
    `);

    // ── Analytics ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_event (
        id BIGSERIAL PRIMARY KEY,
        type varchar(40) NOT NULL,
        route_id uuid,
        poi_uuid varchar,
        anonymous_id varchar(40),
        telegram_chat_id bigint,
        meta jsonb,
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_event_type_created" ON analytics_event (type, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_event_poi" ON analytics_event (poi_uuid)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_event_route" ON analytics_event (route_id)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS route_feedback (
        id uuid DEFAULT uuid_generate_v4() NOT NULL,
        route_id uuid NOT NULL,
        rating integer NOT NULL,
        comment text,
        osm_contributor boolean,
        osm_contribution_note text,
        anonymous_id varchar(40),
        created_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_feedback_route" ON route_feedback (route_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_feedback_anon" ON route_feedback (anonymous_id)`);

    // ── Subscriptions ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id uuid NOT NULL,
        "userId" varchar NOT NULL,
        "anonymousId" varchar NOT NULL,
        "telegramChatId" varchar NOT NULL,
        "channelId" varchar NOT NULL,
        status subscriptions_status_enum DEFAULT 'active' NOT NULL,
        "subscribedAt" timestamp DEFAULT now() NOT NULL,
        "updatedAt" timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (id)
      )
    `);

    // ── Telegram ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS telegram_user (
        id SERIAL PRIMARY KEY,
        chat_id bigint NOT NULL,
        "firstName" varchar(64),
        "lastName" varchar(64),
        username varchar(64),
        "languageCode" varchar(8),
        created_at timestamp DEFAULT now() NOT NULL,
        last_seen_at timestamp DEFAULT now() NOT NULL,
        "routesGenerated" integer DEFAULT 0 NOT NULL,
        "gpxDownloads" integer DEFAULT 0 NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tguser_chatid" ON telegram_user (chat_id)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS telegram_last_route (
        chat_id bigint NOT NULL,
        distance double precision NOT NULL,
        duration double precision NOT NULL,
        ascend double precision DEFAULT 0 NOT NULL,
        descend double precision DEFAULT 0 NOT NULL,
        profile varchar(16) NOT NULL,
        geojson text,
        pois text,
        categories text,
        "timeMinutes" integer,
        "expiresAt" timestamptz NOT NULL,
        "updatedAt" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY (chat_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tg_last_route_expires" ON telegram_last_route ("expiresAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS telegram_poi_media (
        poi_uuid varchar(32) NOT NULL,
        file_id varchar(255) NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        file_unique_id varchar(64),
        image_url_hash varchar(16),
        image_url text,
        PRIMARY KEY (poi_uuid)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tg_poi_media_url_hash" ON telegram_poi_media (image_url_hash)`);

    // ── Itineraries ──────────────────────────────────────────────────────
    // Compatible with (and idempotent on top of) CreateItineraryDraft1744650000000,
    // which already created these on databases where it ran.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS itinerary_draft (
        id uuid PRIMARY KEY,
        version integer NOT NULL DEFAULT 1,
        owner_key varchar(160) NOT NULL,
        state jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_itinerary_draft_expires_at" ON itinerary_draft (expires_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_itinerary_draft_owner_updated_at" ON itinerary_draft (owner_key, updated_at)`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS itinerary_command (
        draft_id uuid NOT NULL REFERENCES itinerary_draft(id) ON DELETE CASCADE,
        command_id uuid NOT NULL,
        result_version integer NOT NULL,
        result_snapshot jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (draft_id, command_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_itinerary_command_created_at" ON itinerary_command (created_at)`);

    // ── POI overrides (plural — the live API joins this exact table) ─────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS poi_overrides (
        poi_uuid varchar(32) NOT NULL,
        display_name varchar(500),
        description text,
        image_url text,
        image_attribution jsonb,
        osm_contributor varchar(255),
        updated_by varchar(50) DEFAULT 'admin' NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY (poi_uuid)
      )
    `);

    // ── poi_product runtime contract ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS poi_product (
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
        PRIMARY KEY (poi_uuid),
        CONSTRAINT poi_product_staging_source_external_id_key1 UNIQUE (source, external_id)
      )
    `);

    // Compatibility for existing production-shaped tables: the observed
    // production dump has every column above except stale_from_osm, which the
    // backend incremental OSM sync inserts/updates. Additive-only.
    await queryRunner.query(`ALTER TABLE poi_product ADD COLUMN IF NOT EXISTS stale_from_osm boolean NOT NULL DEFAULT false`);

    // Supporting indexes, named to match the observed production schema
    // (IF NOT EXISTS — no-ops on databases that already have them).
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS poi_product_staging_source_idx1 ON poi_product (source)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS poi_product_staging_category_idx1 ON poi_product (category)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS poi_product_staging_wikidata_qid_idx1 ON poi_product (wikidata_qid)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS poi_product_staging_lat_lon_idx1 ON poi_product (lat, lon)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS poi_product_staging_is_active_idx1 ON poi_product (is_active) WHERE is_active = true`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS poi_product_staging_featured_idx1 ON poi_product (featured) WHERE featured = true`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS poi_product_staging_popularity_score_idx1 ON poi_product (popularity_score DESC)`);

    // Contract guard: if a pre-existing poi_product is incompatible in a way
    // that is not additively reconcilable, fail loudly instead of coercing or
    // dropping data (CREATE TABLE IF NOT EXISTS does not reconcile existing
    // definitions).
    const columns = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'poi_product'`,
    )) as { column_name: string }[];
    const present = new Set(columns.map((c) => c.column_name));
    const missing = POI_PRODUCT_REQUIRED_COLUMNS.filter((c) => !present.has(c));
    if (missing.length > 0) {
      throw new Error(
        `poi_product is missing required runtime columns (${missing.join(', ')}). ` +
        'Incompatible schema — refusing to alter/drop data. Fix the schema, then re-run.',
      );
    }

    // ── Routes compatibility (pre-existing routes tables) ────────────────
    if (await queryRunner.hasTable('routes')) {
      await queryRunner.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS source_draft_id uuid`);
      await queryRunner.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS itinerary_snapshot jsonb`);
      await queryRunner.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS loop boolean`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_routes_source_draft_id" ON routes (source_draft_id)`);
    }

    // ── Incremental OSM sync state ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS osm_sync_state (
        id integer PRIMARY KEY DEFAULT 1,
        last_sequence bigint NOT NULL DEFAULT 0,
        last_sync_at timestamp NOT NULL DEFAULT now(),
        last_status varchar DEFAULT 'idle',
        last_error text,
        processed integer DEFAULT 0,
        CONSTRAINT single_row CHECK (id = 1)
      )
    `);
    await queryRunner.query(`
      INSERT INTO osm_sync_state (id, last_sequence)
      VALUES (1, 0)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Deliberately a no-op: dropping any of the foundational runtime tables
    // (or the extensions/enums) would be destructive and is never safe in
    // production. Revert this release with forward migrations, not by
    // removing the foundation.
  }
}
