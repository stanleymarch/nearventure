import { describe, expect, it } from 'vitest';
import { ImportValidationError } from './import-errors';
import {
  IMPORT_CATEGORY_KEYS,
  IMPORT_COLLECTION_PROVENANCE_PATH,
  IMPORT_MANIFEST_KIND,
  IMPORT_RECORDS_PATH,
  IMPORT_RELEASE_MANIFEST_PATH,
  parseImportManifest,
} from './import-manifest.schema';
import { defaultFixtureRows, NOTICE, fixtureUuid } from './test-fixtures';

function validManifest(): Record<string, unknown> {
  const rows = defaultFixtureRows();
  return {
    schemaVersion: 1,
    kind: IMPORT_MANIFEST_KIND,
    datasetVersion: 'pfo-2026-07-26-v0.1',
    generatedAt: '2026-07-26T12:00:00.000Z',
    territory: { slug: 'pfo', profile: 'nearventure-v1' },
    run: { id: 'pfo-v0.1' },
    toolkit: { version: '0.1.0', revision: '0123456789abcdef0123456789abcdef01234567' },
    compatibility: {
      recordsFormat: 'nearventure-poi-product-sql-v1',
      minImporterVersion: '1.0.0',
      maxImporterVersionExclusive: '2.0.0',
    },
    records: {
      path: IMPORT_RECORDS_PATH,
      count: rows.length,
      bytes: 1024,
      sha256: 'a'.repeat(64),
    },
    counts: {
      categories: {
        heritage: 0,
        monument: 0,
        sights: 0,
        religion: 1,
        nature: 1,
        museum: 1,
      },
      sourceRecords: { osm: 2, egrkn: 1 },
    },
    provenance: {
      releaseManifest: { path: IMPORT_RELEASE_MANIFEST_PATH, sha256: 'b'.repeat(64) },
      collectionProvenance: { path: IMPORT_COLLECTION_PROVENANCE_PATH, sha256: 'c'.repeat(64) },
    },
    sourceAttribution: {
      notice: NOTICE,
      components: [
        { id: 'osm', license: { name: 'ODbL-1.0', url: 'https://opendatacommons.org/licenses/odbl/' }, attribution: '© OpenStreetMap contributors' },
        { id: 'egrkn', license: { name: 'open-data', url: 'https://opendata.mkrf.ru/' }, attribution: 'Минкультуры РФ (open data)' },
      ],
    },
  };
}

describe('parseImportManifest (strict v1 schema)', () => {
  it('accepts a fully valid manifest and returns typed data', () => {
    const manifest = parseImportManifest(validManifest());
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.kind).toBe(IMPORT_MANIFEST_KIND);
    expect(manifest.records.count).toBe(3);
    expect(Object.keys(manifest.counts.categories)).toEqual([...IMPORT_CATEGORY_KEYS]);
    expect(manifest.sourceAttribution.components.map((c) => c.id)).toEqual(['osm', 'egrkn']);
    expect(fixtureUuid('entity:1')).toHaveLength(32);
  });

  const rejectCases: Array<[string, (m: Record<string, unknown>) => void, string]> = [
    ['unknown root field', (m) => { (m as any).evil = true; }, 'unknown_field'],
    ['unknown nested field', (m) => { (m.territory as any).extra = 1; }, 'unknown_field'],
    ['wrong schemaVersion', (m) => { m.schemaVersion = 2; }, 'invalid_field'],
    ['wrong kind', (m) => { m.kind = 'other.kind'; }, 'invalid_field'],
    ['missing kind', (m) => { delete m.kind; }, 'missing_field'],
    ['uppercase datasetVersion', (m) => { m.datasetVersion = 'Pfo-2026'; }, 'invalid_field'],
    ['empty datasetVersion', (m) => { m.datasetVersion = ''; }, 'invalid_field'],
    ['wrong territory profile', (m) => { (m.territory as any).profile = 'other-v2'; }, 'invalid_field'],
    ['non-UTC generatedAt', (m) => { m.generatedAt = '2026-07-26T12:00:00+03:00'; }, 'invalid_field'],
    ['non-40-hex revision', (m) => { (m.toolkit as any).revision = 'unknown'; }, 'invalid_field'],
    ['uppercase revision', (m) => { (m.toolkit as any).revision = 'A'.repeat(40); }, 'invalid_field'],
    ['non-semver toolkit version', (m) => { (m.toolkit as any).version = '0.1'; }, 'invalid_field'],
    ['prerelease minImporterVersion', (m) => { (m.compatibility as any).minImporterVersion = '1.0.0-beta.1'; }, 'invalid_field'],
    ['records path not literal', (m) => { (m.records as any).path = '../evil.sql'; }, 'invalid_field'],
    ['records count zero', (m) => { (m.records as any).count = 0; }, 'invalid_field'],
    ['records count float', (m) => { (m.records as any).count = 3.5; }, 'invalid_field'],
    ['records bytes zero', (m) => { (m.records as any).bytes = 0; }, 'invalid_field'],
    ['records sha256 not 64-hex', (m) => { (m.records as any).sha256 = 'xyz'; }, 'invalid_field'],
    ['missing category key', (m) => { delete (m.counts as any).categories.nature; }, 'missing_field'],
    ['extra category key', (m) => { (m.counts as any).categories.extra = 5; }, 'unknown_field'],
    ['negative category count', (m) => { (m.counts as any).categories.museum = -1; }, 'invalid_field'],
    ['category sum mismatch', (m) => { (m.counts as any).categories.museum = 10; }, 'count_mismatch'],
    ['empty sourceRecords', (m) => { (m.counts as any).sourceRecords = {}; }, 'invalid_field'],
    ['unknown source key', (m) => { (m.counts as any).sourceRecords.foursquare = 1; }, 'unknown_field'],
    ['provenance path not literal', (m) => { (m.provenance as any).releaseManifest.path = '/etc/passwd'; }, 'invalid_field'],
    ['empty attribution notice', (m) => { (m.sourceAttribution as any).notice = '   '; }, 'invalid_field'],
    ['empty components', (m) => { (m.sourceAttribution as any).components = []; }, 'invalid_field'],
    ['component license not https', (m) => { (m.sourceAttribution as any).components[0].license.url = 'http://example.com'; }, 'invalid_field'],
    ['duplicate component ids', (m) => { (m.sourceAttribution as any).components = [(m.sourceAttribution as any).components[0], (m.sourceAttribution as any).components[0]]; }, 'invalid_field'],
    ['component ids != sourceRecords keys', (m) => { (m.sourceAttribution as any).components = [(m.sourceAttribution as any).components[0]]; }, 'count_mismatch'],
  ];

  for (const [name, mutate, code] of rejectCases) {
    it(`rejects: ${name}`, () => {
      const manifest = validManifest();
      mutate(manifest);
      let caught: ImportValidationError | null = null;
      try {
        parseImportManifest(manifest);
      } catch (error) {
        caught = error as ImportValidationError;
      }
      expect(caught).toBeInstanceOf(ImportValidationError);
      expect(caught?.code).toBe(code);
    });
  }

  it('rejects non-object input', () => {
    expect(() => parseImportManifest('not an object')).toThrow(ImportValidationError);
    expect(() => parseImportManifest([])).toThrow(ImportValidationError);
    expect(() => parseImportManifest(null)).toThrow(ImportValidationError);
  });
});
