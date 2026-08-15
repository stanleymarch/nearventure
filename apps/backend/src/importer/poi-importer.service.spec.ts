import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportReplayError, ImportValidationError, PoiImportError } from './import-errors';
import { POI_WRITE_LOCK_KEY, POI_WRITE_LOCK_SQL } from './poi-write-lock';
import { PoiImporterService } from './poi-importer.service';
import { createValidBundle, defaultFixtureRows, type BundleFiles } from './test-fixtures';

class FakeQueryRunner {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  committed = false;
  rolledBack = false;
  released = false;
  existingAuditRows = 0;
  /** Number of generated PK-name probes that should report an occupied name. */
  occupiedPrimaryKeyCandidates = 0;
  /** Override for the staging COUNT(*) result; defaults to the number of executed inserts. */
  stagingCount = -1;
  /** Throw when the n-th INSERT INTO "<staging>" statement is executed. */
  failOnInsertNumber = 0;
  /** Throw on the first query containing this substring. */
  failOnQueryContaining = '';
  private insertCount = 0;

  async connect(): Promise<void> {
    // no-op
  }

  async startTransaction(): Promise<void> {
    // no-op
  }

  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    this.queries.push({ sql, params });
    if (this.failOnQueryContaining && sql.includes(this.failOnQueryContaining)) {
      throw new Error(`injected failure on: ${this.failOnQueryContaining}`);
    }
    if (/INSERT INTO "poi_product_staging_/.test(sql)) {
      this.insertCount += 1;
      if (this.failOnInsertNumber === this.insertCount) {
        throw new Error('injected insert failure');
      }
    }
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('SELECT manifest_sha256 FROM poi_import_audit')) {
      return this.existingAuditRows > 0 ? [{ manifest_sha256: 'f'.repeat(64) }] : [];
    }
    if (sql.includes('to_regclass')) return [{ cls: 'poi_product' }];
    if (sql.includes('FROM pg_class c')) {
      const occupied = this.occupiedPrimaryKeyCandidates > 0;
      if (occupied) this.occupiedPrimaryKeyCandidates -= 1;
      return [{ occupied }];
    }
    if (sql.includes('GROUP BY poi_uuid HAVING')) return [{ c: 0 }];
    if (/SELECT COUNT\(\*\)::int AS c FROM/.test(sql)) {
      return [{ c: this.stagingCount >= 0 ? this.stagingCount : this.insertCount }];
    }
    return [];
  }

  async commitTransaction(): Promise<void> {
    this.committed = true;
  }

  async rollbackTransaction(): Promise<void> {
    this.rolledBack = true;
  }

  async release(): Promise<void> {
    this.released = true;
  }
}

class FakeDataSource {
  runner: FakeQueryRunner | null = null;
  existingAuditRows = 0;
  occupiedPrimaryKeyCandidates = 0;
  failOnInsertNumber = 0;
  failOnQueryContaining = '';
  createQueryRunner(): FakeQueryRunner {
    const runner = new FakeQueryRunner();
    runner.existingAuditRows = this.existingAuditRows;
    runner.occupiedPrimaryKeyCandidates = this.occupiedPrimaryKeyCandidates;
    runner.failOnInsertNumber = this.failOnInsertNumber;
    runner.failOnQueryContaining = this.failOnQueryContaining;
    this.runner = runner;
    return runner;
  }
}

let tmpDirs: string[] = [];
let trustedRoot: string;

/** Absolute run dir under a shared trusted root; returns its relative path. */
async function makeRunDir(): Promise<string> {
  if (!trustedRoot || !(await fs.stat(trustedRoot).then(() => true).catch(() => false))) {
    trustedRoot = await fs.mkdtemp(join(tmpdir(), 'poi-svc-trusted-'));
    tmpDirs.push(trustedRoot);
  }
  const runDir = await fs.mkdtemp(join(trustedRoot, 'run-XXXXXX'));
  tmpDirs.push(runDir);
  return runDir;
}

function relOf(dir: string): string {
  return relative(trustedRoot, dir);
}

/**
 * Real-filesystem transaction tests. They need the Linux dirfd-chain secure
 * open (which fails closed on other platforms), so the suite runs on Linux and
 * is skipped elsewhere; the deterministic branch coverage lives in
 * artifact-read.spec.ts (mocked).
 */
const IMPORTER_REAL_FS_SUPPORTED = process.platform === 'linux';

describe.skipIf(!IMPORTER_REAL_FS_SUPPORTED)('PoiImporterService import transaction', () => {
  let bundle: BundleFiles;

  beforeEach(async () => {
    bundle = await createValidBundle(await makeRunDir(), defaultFixtureRows());
  });

  afterEach(async () => {
    await Promise.all(
      tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    );
    tmpDirs = [];
  });

  it('imports a valid bundle: staging load, count check, atomic swap, indexes, audit, commit', async () => {
    const dataSource = new FakeDataSource();
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });

    const result = await service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) });

    const runner = dataSource.runner!;
    expect(runner.committed).toBe(true);
    expect(runner.rolledBack).toBe(false);
    expect(runner.released).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.recordsCount).toBe(3);
    expect(result.stagingTable).toMatch(/^poi_product_staging_[0-9a-f]{16}$/);

    const sqls = runner.queries.map((q) => q.sql);
    // lock first, with the shared writer key
    expect(sqls[0]).toContain('pg_advisory_xact_lock');
    expect(runner.queries[0].params?.[0]).toBe(POI_WRITE_LOCK_KEY);
    // audit table ensured before replay check
    expect(sqls.join('\n')).toContain('CREATE TABLE IF NOT EXISTS poi_import_audit');
    // target existence check
    expect(sqls.join('\n')).toContain("SELECT to_regclass('public.poi_product') AS cls");
    // staging created LIKE poi_product, PK added
    const createStaging = sqls.find((s) => s.includes('CREATE TABLE "poi_product_staging_'));
    expect(createStaging).toContain('(LIKE poi_product INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)');
    expect(sqls.join('\n')).toContain('ADD PRIMARY KEY (poi_uuid)');

    // exactly three upserts, all retargeted to the staging table
    const inserts = sqls.filter((s) => s.includes('INSERT INTO "poi_product_staging_'));
    expect(inserts).toHaveLength(3);
    for (const insert of inserts) {
      expect(insert).toContain('ON CONFLICT (poi_uuid) DO UPDATE SET');
      expect(insert).not.toMatch(/INSERT INTO poi_product \(/);
    }

    // count + invariant checks
    expect(sqls.some((s) => /SELECT COUNT\(\*\)::int AS c FROM "poi_product_staging_/.test(s))).toBe(true);
    expect(sqls.some((s) => s.includes('GROUP BY poi_uuid HAVING COUNT(*) > 1'))).toBe(true);

    // atomic swap order
    const swap = sqls.filter((s) => s.includes('RENAME TO') || /^DROP TABLE/.test(s));
    expect(swap[0]).toContain('ALTER TABLE poi_product RENAME TO "poi_product_retired_');
    expect(swap[1]).toMatch(/^DROP TABLE "poi_product_retired_/);
    expect(swap[2]).toContain('ALTER TABLE "poi_product_staging_');
    expect(swap[2]).toContain('RENAME TO poi_product');

    // production schema surface restored
    const all = sqls.join('\n');
    expect(all).toContain('CREATE INDEX IF NOT EXISTS poi_product_staging_source_idx1');
    expect(all).toContain('CREATE INDEX IF NOT EXISTS poi_product_staging_lat_lon_idx1');
    // PK gets a per-import generated name, so no unrelated table can own it.
    expect(all).toMatch(/RENAME CONSTRAINT "poi_product_staging_[0-9a-f]{16}_pkey" TO "poi_product_pkey_[0-9a-f]{16}"/);
    expect(all).toContain('ADD CONSTRAINT poi_product_staging_source_external_id_key1 UNIQUE (source, external_id)');

    // audit row recorded
    const audit = sqls.find((s) => s.includes('INSERT INTO poi_import_audit'));
    expect(audit).toContain('ON CONFLICT (manifest_sha256) DO UPDATE');

    // poi_overrides is never renamed, truncated, or written
    for (const q of runner.queries) {
      expect(q.sql).not.toContain('poi_overrides');
      expect(q.sql).not.toContain('poi_override');
    }
  });

  it('retries a generated primary-key name that is already occupied', async () => {
    const dataSource = new FakeDataSource();
    dataSource.occupiedPrimaryKeyCandidates = 1;
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });

    await service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) });

    const runner = dataSource.runner!;
    const nameChecks = runner.queries.filter((query) => query.sql.includes('FROM pg_class c'));
    expect(nameChecks).toHaveLength(2);
    const firstName = nameChecks[0].params![0] as string;
    const secondName = nameChecks[1].params![0] as string;
    expect(firstName).toMatch(/^poi_product_pkey_[0-9a-f]{16}$/);
    expect(secondName).toMatch(/^poi_product_pkey_[0-9a-f]{16}$/);
    expect(secondName).not.toBe(firstName);
    const rename = runner.queries.find((query) => query.sql.includes('RENAME CONSTRAINT'))!.sql;
    expect(rename).toContain(`TO "${secondName}"`);
  });

  it('takes the shared poi_product advisory write lock as its first statement', async () => {
    const dataSource = new FakeDataSource();
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });

    await service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) });

    const first = dataSource.runner!.queries[0];
    expect(first.sql).toBe(POI_WRITE_LOCK_SQL);
    expect(first.params).toEqual([POI_WRITE_LOCK_KEY]);
  });

  it('dryRun validates only and never opens a query runner', async () => {
    const dataSource = new FakeDataSource();
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });
    const result = await service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir), dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.stagingTable).toBeNull();
    expect(dataSource.runner).toBeNull();
  });

  it('rejects a tampered bundle before creating a query runner (no DB write)', async () => {
    const dataSource = new FakeDataSource();
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });
    const manifest = JSON.parse(await fs.readFile(bundle.manifestPath, 'utf8'));
    manifest.records.sha256 = 'e'.repeat(64);
    await fs.writeFile(bundle.manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) })).rejects.toBeInstanceOf(ImportValidationError);
    expect(dataSource.runner).toBeNull();
  });

  it('rejects a replay of the same manifest unless allowReplay is set', async () => {
    const dataSource = new FakeDataSource();
    dataSource.existingAuditRows = 1;
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });

    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) })).rejects.toBeInstanceOf(ImportReplayError);
    expect(dataSource.runner!.rolledBack).toBe(true);
    expect(dataSource.runner!.committed).toBe(false);

    // with allowReplay the import proceeds and commits
    dataSource.existingAuditRows = 1;
    const result = await service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir), allowReplay: true });
    expect(result.replayed).toBe(true);
    expect(dataSource.runner!.committed).toBe(true);
  });

  it('rolls back and leaves no committed state on a mid-load failure', async () => {
    const dataSource = new FakeDataSource();
    dataSource.failOnInsertNumber = 2;
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });

    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) })).rejects.toBeInstanceOf(PoiImportError);
    expect(dataSource.runner!.rolledBack).toBe(true);
    expect(dataSource.runner!.committed).toBe(false);
    // no swap, no audit row on failure
    const all = dataSource.runner!.queries.map((q) => q.sql).join('\n');
    expect(all).not.toContain('RENAME TO poi_product');
    expect(all).not.toContain('INSERT INTO poi_import_audit');
  });

  it('rolls back on a promotion failure', async () => {
    const dataSource = new FakeDataSource();
    dataSource.failOnQueryContaining = 'ALTER TABLE poi_product RENAME TO';
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });

    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) })).rejects.toBeInstanceOf(PoiImportError);
    expect(dataSource.runner!.rolledBack).toBe(true);
    expect(dataSource.runner!.committed).toBe(false);
  });

  it('wraps unexpected database errors in PoiImportError', async () => {
    const dataSource = new FakeDataSource();
    dataSource.failOnQueryContaining = 'CREATE TABLE "poi_product_staging_';
    const service = new PoiImporterService(dataSource as never, { log: () => undefined });

    await expect(service.importPoiExport({ trustedRoot, runDir: relOf(bundle.runDir) })).rejects.toMatchObject({
      name: 'PoiImportError',
      code: 'import_failed',
    });
    expect(dataSource.runner!.rolledBack).toBe(true);
  });
});
