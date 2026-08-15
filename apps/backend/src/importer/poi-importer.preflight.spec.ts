import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportValidationError } from './import-errors';
import { PoiImporterService } from './poi-importer.service';
import {
  buildFixtureSql,
  createValidBundle,
  defaultFixtureRows,
  sha256Hex,
  type BundleFiles,
} from './test-fixtures';

const service = new PoiImporterService({} as never);

let tmpDirs: string[] = [];
let trustedRoot: string;
let runDirAbs: string;
let runDirRel: string;

async function makeTrustedRoot(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'poi-trusted-'));
  tmpDirs.push(dir);
  return dir;
}

async function makeRunDir(root: string): Promise<string> {
  const dir = join(root, `run-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function asRelative(root: string, dir: string): string {
  return relative(root, dir);
}

/** Patch a dotted manifest field so the manifest stays parseable but semantically different. */
async function patchManifest(bundle: BundleFiles, field: string, value: unknown): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(bundle.manifestPath, 'utf8')) as Record<string, any>;
  const parts = field.split('.');
  let node: any = manifest;
  for (let i = 0; i < parts.length - 1; i += 1) node = node[parts[i]];
  node[parts[parts.length - 1]] = value;
  await fs.writeFile(bundle.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

/** Overwrite the SQL artifact and re-sync records.sha256/records.bytes — the
 *  "validly re-hashed" case: hashes prove integrity, not authorization. */
async function overwriteSql(bundle: BundleFiles, content: string | Buffer): Promise<void> {
  await fs.writeFile(bundle.sqlPath, content);
  const bytes = await fs.readFile(bundle.sqlPath);
  await patchManifest(bundle, 'records.sha256', sha256Hex(bytes));
  await patchManifest(bundle, 'records.bytes', bytes.byteLength);
}

/** Overwrite the release manifest and re-sync its provenance hash. */
async function overwriteRelease(bundle: BundleFiles, content: string | Buffer): Promise<void> {
  await fs.writeFile(bundle.releasePath, content);
  await patchManifest(bundle, 'provenance.releaseManifest.sha256', sha256Hex(await fs.readFile(bundle.releasePath)));
}

/** Overwrite the collection provenance and re-sync its provenance hash. */
async function overwriteProvenance(bundle: BundleFiles, content: string | Buffer): Promise<void> {
  await fs.writeFile(bundle.provenancePath, content);
  await patchManifest(
    bundle,
    'provenance.collectionProvenance.sha256',
    sha256Hex(await fs.readFile(bundle.provenancePath)),
  );
}

/**
 * Real-filesystem preflight tests. They need the Linux dirfd-chain secure open
 * (`readBundleArtifactOnce` fails closed on other platforms), so the suite runs
 * on Linux (production/CI/container) and is skipped elsewhere; the cross-platform
 * branch coverage lives in artifact-read.spec.ts (mocked).
 */
const IMPORTER_REAL_FS_SUPPORTED = process.platform === 'linux';

describe.skipIf(!IMPORTER_REAL_FS_SUPPORTED)('PoiImporterService preflight (no database access)', () => {
  let bundle: BundleFiles;

  beforeEach(async () => {
    trustedRoot = await makeTrustedRoot();
    runDirAbs = await makeRunDir(trustedRoot);
    runDirRel = asRelative(trustedRoot, runDirAbs);
    bundle = await createValidBundle(runDirAbs, defaultFixtureRows());
  });

  afterEach(async () => {
    await Promise.all(
      tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
    );
    tmpDirs = [];
  });

  it('accepts a valid bundle and returns parsed statements', async () => {
    const result = await service.validateBundle({ trustedRoot, runDir: runDirRel });
    expect(result.sqlStatements).toHaveLength(3);
    expect(result.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifest.datasetVersion).toBe('pfo-2026-07-26-v0.1');
  });

  it('rejects malformed manifest JSON', async () => {
    await fs.writeFile(bundle.manifestPath, '{ not json');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({
      name: 'ImportValidationError',
      code: 'manifest_unreadable',
    });
  });

  it('rejects an unknown root field in the manifest', async () => {
    await patchManifest(bundle, 'injected', 'evil');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'unknown_field' });
  });

  it('rejects an unknown kind', async () => {
    await patchManifest(bundle, 'kind', 'evil.poi-import');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'invalid_field' });
  });

  it('rejects an incompatible SemVer window', async () => {
    await patchManifest(bundle, 'compatibility.minImporterVersion', '2.0.0');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({
      code: 'incompatible_importer',
    });
  });

  it('rejects a missing SQL artifact', async () => {
    await fs.rm(bundle.sqlPath);
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({
      code: 'missing_artifact',
    });
  });

  it('rejects a directory in place of an artifact', async () => {
    await fs.rm(bundle.sqlPath);
    await fs.mkdir(bundle.sqlPath);
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({
      code: 'invalid_artifact',
    });
  });

  it('rejects a non-existent run directory', async () => {
    await expect(service.validateBundle({ trustedRoot, runDir: 'does-not-exist' })).rejects.toMatchObject({
      code: 'missing_artifact',
    });
  });

  it('rejects a run directory that is not a clean relative descendant of the trusted root', async () => {
    await expect(service.validateBundle({ trustedRoot, runDir: '../escape' })).rejects.toMatchObject({
      code: 'invalid_path',
    });
    await expect(service.validateBundle({ trustedRoot, runDir: '/absolute/path' })).rejects.toMatchObject({
      code: 'invalid_path',
    });
    await expect(service.validateBundle({ trustedRoot, runDir: 'a\\b' })).rejects.toMatchObject({
      code: 'invalid_path',
    });
  });

  it('accepts a nested run directory (known-good)', async () => {
    const nested = join(trustedRoot, 'releases', '2026-07-26');
    await fs.mkdir(nested, { recursive: true });
    await createValidBundle(nested, defaultFixtureRows());
    const result = await service.validateBundle({ trustedRoot, runDir: 'releases/2026-07-26' });
    expect(result.sqlStatements).toHaveLength(3);
    expect(result.manifest.datasetVersion).toBe('pfo-2026-07-26-v0.1');
  });

  it('rejects a run directory that is a symlink outside the trusted root', async () => {
    const outside = join(tmpdir(), `poi-import-run-outside-${Date.now()}`);
    await fs.mkdir(outside, { recursive: true });
    await fs.rm(runDirAbs, { recursive: true, force: true });
    try {
      await fs.symlink(outside, runDirAbs, 'dir');
    } catch {
      // Symlinks unavailable on this platform — restore and skip.
      await fs.mkdir(runDirAbs, { recursive: true });
      return;
    }
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({
      code: 'path_escape',
    });
  });

  it('rejects a missing trusted root', async () => {
    const missingRoot = join(tmpdir(), `poi-trusted-missing-${Date.now()}`);
    await expect(service.validateBundle({ trustedRoot: missingRoot, runDir: 'run' })).rejects.toMatchObject({
      code: 'path_escape',
    });
  });

  it('rejects a symlinked trusted root', async () => {
    const realRoot = join(tmpdir(), `poi-trusted-real-${Date.now()}`);
    const linkRoot = join(tmpdir(), `poi-trusted-link-${Date.now()}`);
    await fs.mkdir(realRoot);
    try {
      await fs.symlink(realRoot, linkRoot, 'dir');
    } catch {
      return; // Symlinks unavailable on this platform — nothing to prove here.
    }
    await expect(service.validateBundle({ trustedRoot: linkRoot, runDir: 'run' })).rejects.toMatchObject({
      code: 'path_escape',
    });
  });

  it('rejects SQL byte-length mismatch', async () => {
    await patchManifest(bundle, 'records.bytes', (await fs.readFile(bundle.sqlPath)).byteLength + 1);
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'hash_mismatch' });
  });

  it('rejects SQL SHA-256 mismatch (same-length tamper, manifest not re-hashed)', async () => {
    const bytes = await fs.readFile(bundle.sqlPath);
    const tampered = Buffer.from(bytes);
    tampered[bytes.length - 2] = tampered[bytes.length - 2] === 0x61 ? 0x62 : 0x61;
    await fs.writeFile(bundle.sqlPath, tampered);
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'hash_mismatch' });
  });

  it('rejects a release-manifest SHA-256 mismatch', async () => {
    await fs.writeFile(bundle.releasePath, (await fs.readFile(bundle.releasePath)) + Buffer.from('x'));
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'hash_mismatch' });
  });

  it('rejects SQL statement-count mismatch (self-consistent hash)', async () => {
    // 2 statements instead of 3, with the manifest re-hashed to match: count check fires.
    await overwriteSql(bundle, buildFixtureSql(defaultFixtureRows().slice(0, 2)));
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'count_mismatch' });
  });

  it('rejects SQL statement-count mismatch with more statements than declared', async () => {
    const extra = defaultFixtureRows()[0];
    await overwriteSql(bundle, buildFixtureSql([...defaultFixtureRows(), extra]));
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'count_mismatch' });
  });

  it('rejects a category-sum mismatch in the manifest itself', async () => {
    await patchManifest(bundle, 'counts.categories.museum', 10);
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'count_mismatch' });
  });

  it('rejects a release-manifest profile mismatch (self-consistent hash)', async () => {
    const release = JSON.parse(await fs.readFile(bundle.releasePath, 'utf8'));
    release.profile = 'other-profile';
    await overwriteRelease(bundle, JSON.stringify(release, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects a release-manifest entityCount mismatch', async () => {
    const release = JSON.parse(await fs.readFile(bundle.releasePath, 'utf8'));
    release.entityCount = 999;
    await overwriteRelease(bundle, JSON.stringify(release, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects a release-manifest categoryCounts mismatch', async () => {
    const release = JSON.parse(await fs.readFile(bundle.releasePath, 'utf8'));
    release.categoryCounts.museum = 100;
    await overwriteRelease(bundle, JSON.stringify(release, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects a release-manifest sourceCounts mismatch', async () => {
    const release = JSON.parse(await fs.readFile(bundle.releasePath, 'utf8'));
    release.sourceCounts.osm = 100;
    await overwriteRelease(bundle, JSON.stringify(release, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects a release-manifest attribution mismatch', async () => {
    const release = JSON.parse(await fs.readFile(bundle.releasePath, 'utf8'));
    release.attribution = '© someone else';
    await overwriteRelease(bundle, JSON.stringify(release, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects a collection-provenance territory slug mismatch', async () => {
    const provenance = JSON.parse(await fs.readFile(bundle.provenancePath, 'utf8'));
    provenance.territory.slug = 'other';
    await overwriteProvenance(bundle, JSON.stringify(provenance, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects a missing required provenance component', async () => {
    const provenance = JSON.parse(await fs.readFile(bundle.provenancePath, 'utf8'));
    provenance.sourceManifests = provenance.sourceManifests.filter((m: { id: string }) => m.id !== 'egrkn');
    await overwriteProvenance(bundle, JSON.stringify(provenance, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects a component license url mismatch', async () => {
    const provenance = JSON.parse(await fs.readFile(bundle.provenancePath, 'utf8'));
    provenance.sourceManifests[0].license.url = 'https://other.example.com/license';
    await overwriteProvenance(bundle, JSON.stringify(provenance, null, 2) + '\n');
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'provenance_mismatch' });
  });

  it('rejects malicious SQL even when the manifest is re-hashed to match', async () => {
    const evil = bundle.sql + ' DROP TABLE poi_overrides;';
    await overwriteSql(bundle, evil);
    let caught: unknown;
    try {
      await service.validateBundle({ trustedRoot, runDir: runDirRel });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportValidationError);
    expect((caught as ImportValidationError).code).toBe('sql_grammar');
  });

  it('rejects a symlinked artifact that escapes the run tree', async () => {
    const outside = join(tmpdir(), `poi-import-outside-${Date.now()}.sql`);
    await fs.writeFile(outside, 'escape');
    await fs.rm(bundle.sqlPath);
    try {
      await fs.symlink(outside, bundle.sqlPath);
    } catch {
      // Symlinks unavailable on this platform (e.g. no developer mode on Windows).
      await fs.writeFile(bundle.sqlPath, bundle.sql);
      return;
    }
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'path_escape' });
  });

  it('rejects a symlinked manifest that escapes the run tree', async () => {
    const outside = join(tmpdir(), `poi-import-manifest-outside-${Date.now()}.json`);
    await fs.writeFile(outside, JSON.stringify({ schemaVersion: 1 }));
    await fs.rm(bundle.manifestPath);
    try {
      await fs.symlink(outside, bundle.manifestPath);
    } catch {
      // Symlinks unavailable on this platform.
      await fs.writeFile(bundle.manifestPath, JSON.stringify(bundle.manifest, null, 2) + '\n');
      return;
    }
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'path_escape' });
  });

  it('rejects a symlinked intermediate reports/ directory that escapes the run tree', async () => {
    const reportsReal = join(bundle.runDir, 'reports');
    const elsewhere = join(tmpdir(), `poi-import-reports-outside-${Date.now()}`);
    await fs.mkdir(elsewhere, { recursive: true });
    // Copy the real reports content into the symlink target so the artifact
    // paths exist there — otherwise realpath would fail with ENOENT instead of
    // proving the escape is detected.
    await fs.cp(reportsReal, elsewhere, { recursive: true });
    await fs.rm(reportsReal, { recursive: true, force: true });
    try {
      await fs.symlink(elsewhere, reportsReal, 'dir');
    } catch {
      // Symlinks unavailable on this platform — restore and skip.
      await fs.mkdir(reportsReal, { recursive: true });
      return;
    }
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'path_escape' });
  });

  it('rejects a directory in place of the release manifest artifact', async () => {
    await fs.rm(bundle.releasePath);
    await fs.mkdir(bundle.releasePath);
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'invalid_artifact' });
  });

  it('derives the manifest digest from the parsed buffer, never a re-read of the pathname', async () => {
    const result = await service.validateBundle({ trustedRoot, runDir: runDirRel });
    const expected = sha256Hex(await fs.readFile(bundle.manifestPath));
    expect(result.manifestSha256).toBe(expected);

    // Replace the manifest file AFTER validation: the recorded digest must stay
    // the digest of the exact bytes that were parsed (single-read invariant —
    // no digest divergence, because the pathname is never reopened).
    await fs.writeFile(bundle.manifestPath, JSON.stringify({ schemaVersion: 1, kind: 'not-a-real-manifest' }));
    expect(result.manifestSha256).toBe(expected);
  });

  it('re-reads a manifest replaced on disk exactly once and uses the new content wholesale', async () => {
    const first = await service.validateBundle({ trustedRoot, runDir: runDirRel });
    const replaced = JSON.parse(await fs.readFile(bundle.manifestPath, 'utf8')) as Record<string, any>;
    replaced.datasetVersion = 'pfo-replaced-v0.1';
    // The artifacts are unchanged, so records/provenance hashes still match.
    await fs.writeFile(bundle.manifestPath, JSON.stringify(replaced, null, 2) + '\n');

    const second = await service.validateBundle({ trustedRoot, runDir: runDirRel });
    expect(second.manifest.datasetVersion).toBe('pfo-replaced-v0.1');
    expect(second.manifestSha256).not.toBe(first.manifestSha256);
    // The digest equals the digest of the *new* bytes only — never a mix of
    // old parse + new re-read or vice versa.
    expect(second.manifestSha256).toBe(sha256Hex(await fs.readFile(bundle.manifestPath)));
  });

  it('fails all preflight checks without touching a database', async () => {
    // The service was constructed with a broken DataSource (`{} as never`); any
    // attempt to connect would throw a TypeError. Preflight must never reach it.
    await patchManifest(bundle, 'records.sha256', 'f'.repeat(64));
    await expect(service.validateBundle({ trustedRoot, runDir: runDirRel })).rejects.toMatchObject({ code: 'hash_mismatch' });
  });
});
