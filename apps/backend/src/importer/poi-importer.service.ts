/**
 * Nearventure POI importer (C6) — manifest-validated, atomic staging swap.
 *
 * Consumption contract (approved poi-toolkit externalization design):
 *
 *  1. Preflight (NO database access): read the fixed manifest at
 *     `<trustedRoot>/<runDir>/reports/poi_product_import.manifest.json`, validate
 *     the strict v1 schema, read every artifact exactly once through a chain of
 *     held directory descriptors anchored at an admin-owned trusted root (Linux
 *     `/proc/self/fd` dirfd chain — the run dir is a clean relative path under
 *     the trusted root, never resolved as a pathname; symlinks and non-regular
 *     files rejected; unsupported platforms fail closed), check SemVer
 *     compatibility against
 *     IMPORTER_VERSION, verify raw-byte SHA-256 digests and byte counts of the
 *     SQL artifact and both provenance JSON files, cross-check the release
 *     manifest and collection provenance against the manifest counts/attribution,
 *     and parse the SQL with the restricted v1 grammar. Any failure throws
 *     ImportValidationError before a single write is attempted.
 *  2. Import (ONE transaction): acquire a Postgres advisory lock, ensure the
 *     importer-owned `poi_import_audit` table, reject replays unless
 *     `allowReplay`, create a uniquely named staging table `LIKE poi_product`,
 *     load the validated upserts retargeted to the staging table, verify
 *     COUNT(*) and the unique-poi_uuid invariant, then promote with
 *     rename(poi_product -> retired) / drop(retired) / rename(staging ->
 *     poi_product), restore the production indexes and the unique
 *     (source, external_id) constraint, assign the promoted primary key a
 *     collision-free generated name, and record the audit row.
 *
 * `poi_overrides` is never renamed, truncated, or written. `DROP TABLE` is
 * used only for the renamed-away retired copy inside the controlled
 * transaction and never with CASCADE; a rollback restores it. On any error the
 * transaction rolls back, leaving the previous `poi_product` data untouched
 * and dropping the staging table.
 */
import { createHash, randomBytes } from 'node:crypto';
import { satisfies } from 'semver';
import { DataSource, type QueryRunner } from 'typeorm';
import { openBundleScope } from './artifact-read';
import { ImportReplayError, ImportValidationError, PoiImportError } from './import-errors';
import {
  IMPORT_COLLECTION_PROVENANCE_PATH,
  IMPORT_MANIFEST_PATH,
  IMPORT_RECORDS_PATH,
  IMPORT_RELEASE_MANIFEST_PATH,
  IMPORTER_VERSION,
  parseImportManifest,
  type ImportManifest,
} from './import-manifest.schema';
import { acquirePoiWriteLock } from './poi-write-lock';
import {
  parsePoiImportSql,
  renderUpsert,
  type ParsedUpsertStatement,
} from './sql-grammar';

const AUDIT_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS poi_import_audit (
    id BIGSERIAL PRIMARY KEY,
    dataset_version varchar(128) NOT NULL,
    manifest_sha256 char(64) NOT NULL,
    sql_sha256 char(64) NOT NULL,
    territory_slug varchar(128) NOT NULL,
    profile varchar(128) NOT NULL,
    records_count integer NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    status varchar(16) NOT NULL DEFAULT 'ok',
    UNIQUE (manifest_sha256)
  )
`;

/** Production indexes restored after promotion (names from the runtime foundation migration). */
const PRODUCTION_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS poi_product_staging_source_idx1 ON poi_product (source)`,
  `CREATE INDEX IF NOT EXISTS poi_product_staging_category_idx1 ON poi_product (category)`,
  `CREATE INDEX IF NOT EXISTS poi_product_staging_wikidata_qid_idx1 ON poi_product (wikidata_qid)`,
  `CREATE INDEX IF NOT EXISTS poi_product_staging_lat_lon_idx1 ON poi_product (lat, lon)`,
  `CREATE INDEX IF NOT EXISTS poi_product_staging_is_active_idx1 ON poi_product (is_active) WHERE is_active = true`,
  `CREATE INDEX IF NOT EXISTS poi_product_staging_featured_idx1 ON poi_product (featured) WHERE featured = true`,
  `CREATE INDEX IF NOT EXISTS poi_product_staging_popularity_score_idx1 ON poi_product (popularity_score DESC)`,
];

/** The UNIQUE (source, external_id) constraint present on the production schema. */
const UNIQUE_SOURCE_EXTERNAL_ID = `
  ALTER TABLE poi_product
    ADD CONSTRAINT poi_product_staging_source_external_id_key1 UNIQUE (source, external_id)
`;

export interface PoiImportOptions {
  /**
   * Admin-owned immutable trusted root (absolute path, Linux). Every bundle run
   * directory must be a clean relative descendant of this root. See
   * docs/data-refresh.md — "Trusted root" for permissions/ownership.
   */
  trustedRoot: string;
  /** Bundle run dir: a clean relative path under `trustedRoot` (no `..`, no absolute). */
  runDir: string;
  /** Validate + count only; opens no transaction and writes nothing. */
  dryRun?: boolean;
  /** Re-import a bundle whose manifest_sha256 is already recorded in the audit table. */
  allowReplay?: boolean;
}

export interface PoiImportResult {
  datasetVersion: string;
  recordsCount: number;
  manifestSha256: string;
  sqlSha256: string;
  importedAt: string;
  stagingTable: string | null;
  retiredTable: string | null;
  dryRun: boolean;
  replayed: boolean;
}

export interface ImportPreflightResult {
  manifest: ImportManifest;
  manifestFilePath: string;
  manifestSha256: string;
  sqlFilePath: string;
  sqlBytes: number;
  sqlStatements: ParsedUpsertStatement[];
}

interface ReleaseManifestData {
  profile: string;
  entityCount: number;
  categoryCounts: Record<string, number>;
  attribution: string;
  sourceCounts: Record<string, number>;
}

interface CollectionProvenanceData {
  territorySlug: string;
  sourceManifests: Array<{ id: string; license: { name: string; url: string }; attribution: string }>;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Allocate an unused relation name for the promoted primary-key constraint. */
async function generatePrimaryKeyName(queryRunner: QueryRunner): Promise<string> {
  // A PK constraint owns an index, and both use pg_class's schema namespace.
  // Check the exact generated candidate so even an exceptionally unlucky token
  // collision with an unrelated preserved table is retried before promotion.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const name = `poi_product_pkey_${randomBytes(8).toString('hex')}`;
    const rows = (await queryRunner.query(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1
       ) AS occupied`,
      [name],
    )) as Array<{ occupied: boolean }>;
    if (!rows[0]?.occupied) return name;
  }
  throw new PoiImportError('import_failed', 'unable to allocate a unique poi_product primary-key constraint name');
}

function safeInt(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new ImportValidationError(
      'provenance_invalid',
      `${path} must be an integer >= ${min}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** The toolkit release manifest is *not* our strict schema; extract only the fields we cross-check. */
function parseReleaseManifest(raw: unknown): ReleaseManifestData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ImportValidationError('provenance_invalid', 'release/manifest.json must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.profile !== 'string' || o.profile.trim() === '') {
    throw new ImportValidationError('provenance_invalid', 'release manifest profile must be a non-empty string');
  }
  if (typeof o.attribution !== 'string' || o.attribution.trim() === '') {
    throw new ImportValidationError('provenance_invalid', 'release manifest attribution must be a non-empty string');
  }
  const entityCount = safeInt(o.entityCount, 'release manifest entityCount', 1);
  const categoryCounts = o.categoryCounts;
  if (typeof categoryCounts !== 'object' || categoryCounts === null || Array.isArray(categoryCounts)) {
    throw new ImportValidationError('provenance_invalid', 'release manifest categoryCounts must be an object');
  }
  const categories = categoryCounts as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(categories)) {
    counts[key] = safeInt(value, `release manifest categoryCounts.${key}`, 0);
  }
  const sourceCountsRaw = o.sourceCounts;
  if (typeof sourceCountsRaw !== 'object' || sourceCountsRaw === null || Array.isArray(sourceCountsRaw)) {
    throw new ImportValidationError('provenance_invalid', 'release manifest sourceCounts must be an object');
  }
  const sourceCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(sourceCountsRaw as Record<string, unknown>)) {
    sourceCounts[key] = safeInt(value, `release manifest sourceCounts.${key}`, 0);
  }
  return {
    profile: o.profile,
    entityCount,
    categoryCounts: counts,
    attribution: o.attribution,
    sourceCounts,
  };
}

/** Extract only the territory slug and source manifests from the collection provenance. */
function parseCollectionProvenance(raw: unknown): CollectionProvenanceData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ImportValidationError('provenance_invalid', 'collection-provenance.json must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  const territory = o.territory;
  if (typeof territory !== 'object' || territory === null) {
    throw new ImportValidationError('provenance_invalid', 'collection provenance territory must be an object');
  }
  const slug = (territory as Record<string, unknown>).slug;
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new ImportValidationError('provenance_invalid', 'collection provenance territory.slug must be a non-empty string');
  }
  const sourceManifests = o.sourceManifests;
  if (!Array.isArray(sourceManifests) || sourceManifests.length === 0) {
    throw new ImportValidationError('provenance_invalid', 'collection provenance sourceManifests must be a non-empty array');
  }
  const components = sourceManifests.map((manifest, index) => {
    if (typeof manifest !== 'object' || manifest === null) {
      throw new ImportValidationError('provenance_invalid', `collection provenance sourceManifests[${index}] must be an object`);
    }
    const entry = manifest as Record<string, unknown>;
    const license = entry.license;
    if (typeof license !== 'object' || license === null) {
      throw new ImportValidationError('provenance_invalid', `collection provenance sourceManifests[${index}].license must be an object`);
    }
    const lic = license as Record<string, unknown>;
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new ImportValidationError('provenance_invalid', `collection provenance sourceManifests[${index}].id must be a non-empty string`);
    }
    if (typeof lic.name !== 'string' || lic.name.trim() === '') {
      throw new ImportValidationError('provenance_invalid', `collection provenance sourceManifests[${index}].license.name must be non-empty`);
    }
    if (typeof lic.url !== 'string' || !/^https:\/\//.test(lic.url)) {
      throw new ImportValidationError('provenance_invalid', `collection provenance sourceManifests[${index}].license.url must be an absolute https URL`);
    }
    if (typeof entry.attribution !== 'string' || entry.attribution.trim() === '') {
      throw new ImportValidationError('provenance_invalid', `collection provenance sourceManifests[${index}].attribution must be non-empty`);
    }
    return {
      id: entry.id,
      license: { name: lic.name, url: lic.url },
      attribution: entry.attribution,
    };
  });
  if (new Set(components.map((c) => c.id)).size !== components.length) {
    throw new ImportValidationError('provenance_invalid', 'collection provenance sourceManifests contain duplicate ids');
  }
  return { territorySlug: slug, sourceManifests: components };
}

export class PoiImporterService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger?: { log(message: string): void },
  ) {}

  private log(message: string): void {
    if (this.logger) this.logger.log(message);
  }

  /**
   * Full preflight validation. No database access and no writes.
   * Throws ImportValidationError on any invalid/tampered/malicious input.
   */
  async validateBundle(options: { trustedRoot: string; runDir: string }): Promise<ImportPreflightResult> {
    // Open the bundle scope once: the trusted root is the anchor (opened once
    // O_DIRECTORY|O_NOFOLLOW with a config-time dev/ino identity binding), the
    // run dir is a lexically-validated clean relative path walked through held
    // descriptors, and every artifact is read exactly once through that chain.
    const scope = await openBundleScope(options.trustedRoot, options.runDir);
    try {
      // ── Read the manifest exactly once ───────────────────────────────────
      // Parsing AND the replay/audit digest come from this single no-follow read
      // buffer; the manifest pathname is never reopened (no digest divergence).
      const manifestArtifact = await scope.readArtifact(IMPORT_MANIFEST_PATH, 'import manifest');
      let manifestRaw: unknown;
      try {
        manifestRaw = JSON.parse(manifestArtifact.bytes.toString('utf8'));
      } catch (error) {
        throw new ImportValidationError(
          'manifest_unreadable',
          `cannot read/parse the import manifest at ${manifestArtifact.path}: ${(error as Error).message}`,
        );
      }
      const manifest = parseImportManifest(manifestRaw);

      // ── SemVer compatibility window ───────────────────────────────────────
      const { minImporterVersion, maxImporterVersionExclusive } = manifest.compatibility;
      if (!satisfies(IMPORTER_VERSION, `>=${minImporterVersion} <${maxImporterVersionExclusive}`)) {
        throw new ImportValidationError(
          'incompatible_importer',
          `importer version ${IMPORTER_VERSION} is outside the allowed window ` +
            `[${minImporterVersion}, ${maxImporterVersionExclusive})`,
        );
      }

      // ── Read each artifact exactly once and verify raw-byte digests/counts ──
      const [sqlArtifact, releaseArtifact, provenanceArtifact] = await Promise.all([
        scope.readArtifact(IMPORT_RECORDS_PATH, 'records SQL artifact'),
        scope.readArtifact(IMPORT_RELEASE_MANIFEST_PATH, 'release manifest'),
        scope.readArtifact(IMPORT_COLLECTION_PROVENANCE_PATH, 'collection provenance'),
      ]);
      const sqlBytes = sqlArtifact.bytes;
      if (sqlBytes.byteLength !== manifest.records.bytes) {
        throw new ImportValidationError(
          'hash_mismatch',
          `SQL byte length (${sqlBytes.byteLength}) does not match manifest records.bytes (${manifest.records.bytes})`,
        );
      }
      const sqlSha = sha256Hex(sqlBytes);
      if (sqlSha !== manifest.records.sha256) {
        throw new ImportValidationError('hash_mismatch', 'SQL artifact SHA-256 does not match manifest records.sha256');
      }
      if (sha256Hex(releaseArtifact.bytes) !== manifest.provenance.releaseManifest.sha256) {
        throw new ImportValidationError('hash_mismatch', 'release/manifest.json SHA-256 does not match manifest provenance');
      }
      if (sha256Hex(provenanceArtifact.bytes) !== manifest.provenance.collectionProvenance.sha256) {
        throw new ImportValidationError('hash_mismatch', 'collection-provenance.json SHA-256 does not match manifest provenance');
      }

      // ── Cross-file provenance / counts / attribution checks ────────────────
      const release = parseReleaseManifest(JSON.parse(releaseArtifact.bytes.toString('utf8')));
      const provenance = parseCollectionProvenance(JSON.parse(provenanceArtifact.bytes.toString('utf8')));
      crossCheckProvenance(manifest, release, provenance);

      // ── Restricted SQL grammar + statement count ───────────────────────────
      let statements: ParsedUpsertStatement[];
      try {
        statements = parsePoiImportSql(sqlBytes.toString('utf8')).statements;
      } catch (error) {
        if (error instanceof ImportValidationError) throw error;
        throw new ImportValidationError('sql_unreadable', `cannot parse the SQL artifact: ${(error as Error).message}`);
      }
      if (statements.length !== manifest.records.count) {
        throw new ImportValidationError(
          'count_mismatch',
          `SQL artifact contains ${statements.length} INSERT statements, but manifest records.count is ${manifest.records.count}`,
        );
      }

      const manifestSha256 = sha256Hex(manifestArtifact.bytes);
      return {
        manifest,
        manifestFilePath: manifestArtifact.path,
        manifestSha256,
        sqlFilePath: sqlArtifact.path,
        sqlBytes: sqlBytes.byteLength,
        sqlStatements: statements,
      };
    } finally {
      await scope.close();
    }
  }

  /**
   * Validate then import. Writes happen only inside one transaction, only to
   * the staging table and poi_product/audit, and never to poi_overrides.
   */
  async importPoiExport(options: PoiImportOptions): Promise<PoiImportResult> {
    const { trustedRoot, runDir, dryRun = false, allowReplay = false } = options;
    const preflight = await this.validateBundle({ trustedRoot, runDir });

    if (dryRun) {
      this.log(`dry-run: bundle valid, ${preflight.sqlStatements.length} statements, no writes performed`);
      return {
        datasetVersion: preflight.manifest.datasetVersion,
        recordsCount: preflight.manifest.records.count,
        manifestSha256: preflight.manifestSha256,
        sqlSha256: preflight.manifest.records.sha256,
        importedAt: new Date().toISOString(),
        stagingTable: null,
        retiredTable: null,
        dryRun: true,
        replayed: false,
      };
    }

    const token = randomBytes(8).toString('hex');
    const staging = `poi_product_staging_${token}`;
    const retired = `poi_product_retired_${token}`;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction();

      // Serialize concurrent writers of poi_product; the advisory xact lock
      // releases on commit/rollback. The analytics popularity recompute (the
      // only other poi_product writer) takes the identical lock.
      await acquirePoiWriteLock(queryRunner);

      // Importer-owned audit table (same transaction) + replay policy.
      await queryRunner.query(AUDIT_TABLE_DDL);
      const existing = (await queryRunner.query(
        `SELECT manifest_sha256 FROM poi_import_audit WHERE manifest_sha256 = $1`,
        [preflight.manifestSha256],
      )) as Array<{ manifest_sha256: string }>;
      const replayed = existing.length > 0;
      if (replayed && !allowReplay) {
        throw new ImportReplayError(
          `bundle ${preflight.manifestSha256} (dataset ${preflight.manifest.datasetVersion}) was already imported; ` +
            'pass allowReplay to re-import',
        );
      }

      // The live target must exist before we touch anything.
      const targetCheck = (await queryRunner.query(
        `SELECT to_regclass('public.poi_product') AS cls`,
      )) as Array<{ cls: string | null }>;
      if (!targetCheck[0] || !targetCheck[0].cls) {
        throw new ImportValidationError('target_missing', 'poi_product table does not exist in the database');
      }

      // Unique staging table mirroring poi_product (columns, defaults, NOT NULL, checks).
      await queryRunner.query(
        `CREATE TABLE ${quoteIdentifier(staging)} (LIKE poi_product INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)`,
      );
      // ON CONFLICT (poi_uuid) requires a unique arbiter on the staging table.
      await queryRunner.query(`ALTER TABLE ${quoteIdentifier(staging)} ADD PRIMARY KEY (poi_uuid)`);

      // Load the accepted ASTs, retargeted only to the staging table.
      for (const statement of preflight.sqlStatements) {
        await queryRunner.query(renderUpsert(statement, staging));
      }

      // Required invariants before promotion.
      const countRow = (await queryRunner.query(
        `SELECT COUNT(*)::int AS c FROM ${quoteIdentifier(staging)}`,
      )) as Array<{ c: number }>;
      if (countRow[0].c !== preflight.manifest.records.count) {
        throw new ImportValidationError(
          'count_mismatch',
          `staging table contains ${countRow[0].c} rows, expected ${preflight.manifest.records.count}`,
        );
      }
      const dupRow = (await queryRunner.query(
        `SELECT COUNT(*)::int AS c FROM (SELECT poi_uuid FROM ${quoteIdentifier(staging)} GROUP BY poi_uuid HAVING COUNT(*) > 1) d`,
      )) as Array<{ c: number }>;
      if (dupRow[0].c !== 0) {
        throw new ImportValidationError(
          'invariant_failed',
          `staging table contains ${dupRow[0].c} duplicate poi_uuid rows`,
        );
      }

      // Promotion: atomic within the transaction. The retired copy is dropped
      // with a plain DROP TABLE (no CASCADE); a rollback restores it.
      await queryRunner.query(`ALTER TABLE poi_product RENAME TO ${quoteIdentifier(retired)}`);
      await queryRunner.query(`DROP TABLE ${quoteIdentifier(retired)}`);
      await queryRunner.query(`ALTER TABLE ${quoteIdentifier(staging)} RENAME TO poi_product`);
      // Constraint/index names share one namespace per schema. A preserved
      // historical table can therefore own `poi_product_pkey`; never rename or
      // drop that table. Give the live PK a freshly generated, checked name.
      const primaryKeyName = await generatePrimaryKeyName(queryRunner);
      await queryRunner.query(
        `ALTER TABLE poi_product RENAME CONSTRAINT ${quoteIdentifier(`${staging}_pkey`)} TO ${quoteIdentifier(primaryKeyName)}`,
      );

      // Restore the production schema surface (indexes + unique constraint).
      for (const ddl of PRODUCTION_INDEXES) {
        await queryRunner.query(ddl);
      }
      await queryRunner.query(UNIQUE_SOURCE_EXTERNAL_ID);

      // Audit / replay ledger.
      await queryRunner.query(
        `INSERT INTO poi_import_audit
           (dataset_version, manifest_sha256, sql_sha256, territory_slug, profile, records_count, imported_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 'ok')
         ON CONFLICT (manifest_sha256) DO UPDATE SET imported_at = now(), status = 'ok'`,
        [
          preflight.manifest.datasetVersion,
          preflight.manifestSha256,
          preflight.manifest.records.sha256,
          preflight.manifest.territory.slug,
          preflight.manifest.territory.profile,
          preflight.manifest.records.count,
        ],
      );

      await queryRunner.commitTransaction();
      this.log(
        `imported dataset ${preflight.manifest.datasetVersion}: ${preflight.manifest.records.count} POIs ` +
          `(staging ${staging}, retired ${retired})`,
      );
      return {
        datasetVersion: preflight.manifest.datasetVersion,
        recordsCount: preflight.manifest.records.count,
        manifestSha256: preflight.manifestSha256,
        sqlSha256: preflight.manifest.records.sha256,
        importedAt: new Date().toISOString(),
        stagingTable: staging,
        retiredTable: retired,
        dryRun: false,
        replayed,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
      if (error instanceof PoiImportError) {
        throw error;
      }
      throw new PoiImportError('import_failed', `POI import failed: ${(error as Error).message}`);
    } finally {
      await queryRunner.release();
    }
  }
}

/** All cross-file equality checks between the import manifest and its provenance artifacts. */
function crossCheckProvenance(
  manifest: ImportManifest,
  release: ReleaseManifestData,
  provenance: CollectionProvenanceData,
): void {
  if (release.profile !== manifest.territory.profile) {
    throw new ImportValidationError(
      'provenance_mismatch',
      `release manifest profile (${release.profile}) does not match manifest territory.profile (${manifest.territory.profile})`,
    );
  }
  if (release.entityCount !== manifest.records.count) {
    throw new ImportValidationError(
      'provenance_mismatch',
      `release manifest entityCount (${release.entityCount}) does not match records.count (${manifest.records.count})`,
    );
  }
  const manifestCategories = manifest.counts.categories;
  const releaseCategories = release.categoryCounts;
  const categoryKeys = Object.keys(manifestCategories);
  const releaseCategoryKeys = Object.keys(releaseCategories);
  if (
    categoryKeys.length !== releaseCategoryKeys.length ||
    categoryKeys.some((key) => releaseCategories[key] !== manifestCategories[key as keyof typeof manifestCategories])
  ) {
    throw new ImportValidationError(
      'provenance_mismatch',
      'release manifest categoryCounts does not match manifest counts.categories',
    );
  }
  const manifestSources = manifest.counts.sourceRecords;
  const releaseSources = release.sourceCounts;
  const sourceKeys = Object.keys(manifestSources);
  const releaseSourceKeys = Object.keys(releaseSources);
  if (
    sourceKeys.length !== releaseSourceKeys.length ||
    sourceKeys.some((key) => releaseSources[key] !== manifestSources[key as keyof typeof manifestSources])
  ) {
    throw new ImportValidationError(
      'provenance_mismatch',
      'release manifest sourceCounts does not match manifest counts.sourceRecords',
    );
  }
  if (release.attribution !== manifest.sourceAttribution.notice) {
    throw new ImportValidationError(
      'provenance_mismatch',
      'release manifest attribution does not match manifest sourceAttribution.notice',
    );
  }
  if (provenance.territorySlug !== manifest.territory.slug) {
    throw new ImportValidationError(
      'provenance_mismatch',
      `collection provenance territory.slug (${provenance.territorySlug}) does not match manifest territory.slug (${manifest.territory.slug})`,
    );
  }
  const provenanceById = new Map(provenance.sourceManifests.map((component) => [component.id, component]));
  for (const component of manifest.sourceAttribution.components) {
    const source = provenanceById.get(component.id);
    if (!source) {
      throw new ImportValidationError(
        'provenance_mismatch',
        `collection provenance is missing source manifest for component "${component.id}"`,
      );
    }
    if (source.license.name !== component.license.name || source.license.url !== component.license.url) {
      throw new ImportValidationError(
        'provenance_mismatch',
        `collection provenance license for "${component.id}" does not match manifest sourceAttribution`,
      );
    }
    if (source.attribution !== component.attribution) {
      throw new ImportValidationError(
        'provenance_mismatch',
        `collection provenance attribution for "${component.id}" does not match manifest sourceAttribution`,
      );
    }
  }
}
