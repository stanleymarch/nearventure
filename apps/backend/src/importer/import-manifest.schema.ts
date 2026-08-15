/**
 * Strict v1 import-manifest schema validation (Nearventure side, C6).
 *
 * Mirrors the approved poi-toolkit externalization contract
 * (`docs/superpowers/specs/2026-08-09-poi-toolkit-externalization-design.md`,
 * `packages/core/src/index.ts` `ImportManifestSchema` in poi-toolkit@9ca756b).
 *
 * The root object and every nested object are strict: any unknown field
 * rejects the bundle, so a misspelled integrity/security field can never be
 * silently accepted. Paths are fixed literals, versions are stable SemVer,
 * hashes are lowercase SHA-256 hex digests of the raw bytes of their files.
 *
 * The validator is hand-rolled (no zod dependency in the backend) and throws
 * `ImportValidationError` with a precise field path.
 */
import {
  ImportValidationError,
} from './import-errors';

/** Version of this importer; must satisfy
 * `compatibility.minImporterVersion <= IMPORTER_VERSION < maxImporterVersionExclusive`. */
export const IMPORTER_VERSION = '1.0.0';

export const IMPORT_MANIFEST_KIND = 'nearventure.poi-product-import' as const;
export const IMPORT_RECORDS_FORMAT = 'nearventure-poi-product-sql-v1' as const;
export const IMPORT_MANIFEST_PATH = 'reports/poi_product_import.manifest.json' as const;
export const IMPORT_RECORDS_PATH = 'reports/poi_product_import.sql' as const;
export const IMPORT_RELEASE_MANIFEST_PATH = 'release/manifest.json' as const;
export const IMPORT_COLLECTION_PROVENANCE_PATH = 'reports/collection-provenance.json' as const;
export const IMPORT_PROFILE = 'nearventure-v1' as const;

/** Canonical six category keys of the nearventure-v1 profile. */
export const IMPORT_CATEGORY_KEYS = [
  'heritage',
  'monument',
  'sights',
  'religion',
  'nature',
  'museum',
] as const;
export type ImportCategoryKey = (typeof IMPORT_CATEGORY_KEYS)[number];

/** Allowed source-record keys; component ids must equal the keys of counts.sourceRecords. */
export const IMPORT_SOURCE_KEYS = [
  'osm',
  'egrkn',
  'wikidata',
  'wikivoyage',
  'mkrf',
] as const;
export type ImportSourceKey = (typeof IMPORT_SOURCE_KEYS)[number];

export const ASCII_IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
export const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const REVISION_HEX = /^[0-9a-f]{40}$/;
export const HTTPS_URL = /^https:\/\//;
export const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export interface ImportAttributionComponent {
  id: ImportSourceKey;
  license: { name: string; url: string };
  attribution: string;
}

export interface ImportManifest {
  schemaVersion: 1;
  kind: typeof IMPORT_MANIFEST_KIND;
  datasetVersion: string;
  generatedAt: string;
  territory: { slug: string; profile: typeof IMPORT_PROFILE };
  run: { id: string };
  toolkit: { version: string; revision: string };
  compatibility: {
    recordsFormat: typeof IMPORT_RECORDS_FORMAT;
    minImporterVersion: string;
    maxImporterVersionExclusive: string;
  };
  records: { path: typeof IMPORT_RECORDS_PATH; count: number; bytes: number; sha256: string };
  counts: {
    categories: Record<ImportCategoryKey, number>;
    sourceRecords: Partial<Record<ImportSourceKey, number>>;
  };
  provenance: {
    releaseManifest: { path: typeof IMPORT_RELEASE_MANIFEST_PATH; sha256: string };
    collectionProvenance: { path: typeof IMPORT_COLLECTION_PROVENANCE_PATH; sha256: string };
  };
  sourceAttribution: { notice: string; components: ImportAttributionComponent[] };
}

type Validator<T> = (value: unknown, path: string) => T;

function fail(path: string, expected: string, actual: unknown): never {
  const shown = typeof actual === 'string' ? JSON.stringify(actual) : JSON.stringify(actual) ?? String(actual);
  throw new ImportValidationError(
    'invalid_field',
    `${path} must be ${expected}, got ${shown}`,
  );
}

/** Strict object validation: rejects unknown keys, requires every declared key. */
function strictObject<T extends object>(
  spec: Record<string, Validator<unknown>>,
  path: string,
): Validator<T> {
  return (value, objectPath) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(objectPath, 'an object', value);
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(key in spec)) {
        throw new ImportValidationError(
          'unknown_field',
          `${objectPath}.${key} is not an allowed field`,
        );
      }
    }
    const result = {} as Record<string, unknown>;
    for (const [key, validate] of Object.entries(spec)) {
      if (!(key in record)) {
        throw new ImportValidationError('missing_field', `${objectPath}.${key} is required`);
      }
      result[key] = validate(record[key], `${objectPath}.${key}`);
    }
    return result as T;
  };
}

const stringField = (pattern: RegExp | null, description: string): Validator<string> =>
  (value, path) => {
    if (typeof value !== 'string') fail(path, `a string (${description})`, value);
    if (pattern && !pattern.test(value)) fail(path, `match ${description}`, value);
    return value;
  };

const nonEmptyString: Validator<string> = (value, path) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(path, 'a non-empty string', value);
  }
  return value;
};

const safeInteger = (min: number): Validator<number> => (value, path) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    fail(path, `an integer >= ${min}`, value);
  }
  return value;
};

const literal = <T extends string | number>(expected: T): Validator<T> => (value, path) => {
  if (value !== expected) fail(path, `the literal ${JSON.stringify(expected)}`, value);
  return expected;
};

const asciiIdentifier = stringField(ASCII_IDENTIFIER, 'an ASCII identifier (^[a-z0-9][a-z0-9._-]{0,127}$)');
const stableSemVer = stringField(STABLE_SEMVER, 'a stable SemVer version (major.minor.patch)');
const sha256 = stringField(SHA256_HEX, 'a lowercase 64-hex SHA-256 digest');
const revision = stringField(REVISION_HEX, 'exactly 40 lowercase hex characters');
const httpsUrl = stringField(HTTPS_URL, 'an absolute https:// URL');
const generatedAt = stringField(RFC3339_UTC, 'an RFC 3339 UTC instant (YYYY-MM-DDTHH:mm:ss(.sss)?Z)');

const categoryKeys = new Set<string>(IMPORT_CATEGORY_KEYS);
const sourceKeys = new Set<string>(IMPORT_SOURCE_KEYS);

const categoriesValidator = strictObject<Record<ImportCategoryKey, number>>(
  Object.fromEntries(
    IMPORT_CATEGORY_KEYS.map((key) => [key, safeInteger(0)]),
  ) as Record<ImportCategoryKey, Validator<number>>,
  'counts.categories',
);

const sourceRecordsValidator: Validator<Partial<Record<ImportSourceKey, number>>> =
  (value, path) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(path, 'an object', value);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) {
      throw new ImportValidationError('invalid_field', `${path} must be non-empty`);
    }
    for (const key of keys) {
      if (!sourceKeys.has(key)) {
        throw new ImportValidationError(
          'unknown_field',
          `${path}.${key} is not one of the allowed source keys (${IMPORT_SOURCE_KEYS.join(', ')})`,
        );
      }
    }
    const result: Partial<Record<ImportSourceKey, number>> = {};
    for (const key of keys) {
      result[key as ImportSourceKey] = safeInteger(0)(record[key], `${path}.${key}`);
    }
    return result;
  };

const attributionComponent = strictObject<ImportAttributionComponent>({
  id: (value, path) => {
    if (typeof value !== 'string' || !sourceKeys.has(value)) {
      fail(path, `one of ${IMPORT_SOURCE_KEYS.join(', ')}`, value);
    }
    return value as ImportSourceKey;
  },
  license: strictObject({ name: nonEmptyString, url: httpsUrl }, 'sourceAttribution.components[i].license'),
  attribution: nonEmptyString,
}, 'sourceAttribution.components[i]');

/** Full strict v1 manifest validation. Throws ImportValidationError on any issue. */
export function parseImportManifest(raw: unknown): ImportManifest {
  const manifest = strictObject<ImportManifest>({
    schemaVersion: literal(1),
    kind: literal(IMPORT_MANIFEST_KIND),
    datasetVersion: asciiIdentifier,
    generatedAt,
    territory: strictObject({ slug: asciiIdentifier, profile: literal(IMPORT_PROFILE) }, 'territory'),
    run: strictObject({ id: asciiIdentifier }, 'run'),
    toolkit: strictObject({ version: stableSemVer, revision }, 'toolkit'),
    compatibility: strictObject(
      {
        recordsFormat: literal(IMPORT_RECORDS_FORMAT),
        minImporterVersion: stableSemVer,
        maxImporterVersionExclusive: stableSemVer,
      },
      'compatibility',
    ),
    records: strictObject(
      {
        path: literal(IMPORT_RECORDS_PATH),
        count: safeInteger(1),
        bytes: safeInteger(1),
        sha256,
      },
      'records',
    ),
    counts: strictObject(
      { categories: categoriesValidator, sourceRecords: sourceRecordsValidator },
      'counts',
    ),
    provenance: strictObject(
      {
        releaseManifest: strictObject({ path: literal(IMPORT_RELEASE_MANIFEST_PATH), sha256 }, 'provenance.releaseManifest'),
        collectionProvenance: strictObject(
          { path: literal(IMPORT_COLLECTION_PROVENANCE_PATH), sha256 },
          'provenance.collectionProvenance',
        ),
      },
      'provenance',
    ),
    sourceAttribution: strictObject(
      {
        notice: nonEmptyString,
        components: attributionComponentList(),
      },
      'sourceAttribution',
    ),
  }, 'manifest')(raw, 'manifest');

  // ── Cross-field invariants (super-refine equivalent) ───────────────────
  const categorySum = IMPORT_CATEGORY_KEYS.reduce(
    (sum, key) => sum + manifest.counts.categories[key],
    0,
  );
  if (categorySum !== manifest.records.count) {
    throw new ImportValidationError(
      'count_mismatch',
      `counts.categories sum (${categorySum}) must equal records.count (${manifest.records.count})`,
    );
  }

  const sourceKeysInManifest = Object.keys(manifest.counts.sourceRecords).sort();
  const componentIds = manifest.sourceAttribution.components.map((c) => c.id).sort();
  const uniqueComponentIds = new Set(manifest.sourceAttribution.components.map((c) => c.id));
  if (uniqueComponentIds.size !== manifest.sourceAttribution.components.length) {
    throw new ImportValidationError(
      'invalid_field',
      'sourceAttribution.components must not contain duplicate ids',
    );
  }
  if (
    sourceKeysInManifest.length !== componentIds.length ||
    sourceKeysInManifest.some((key, index) => key !== componentIds[index])
  ) {
    throw new ImportValidationError(
      'count_mismatch',
      `sourceAttribution.components ids must equal the keys of counts.sourceRecords exactly once ` +
        `(components: ${componentIds.join(', ')}, sourceRecords: ${sourceKeysInManifest.join(', ')})`,
    );
  }

  return manifest;
}

/** Components list: non-empty array of strictly-validated attribution components. */
function attributionComponentList(): Validator<ImportAttributionComponent[]> {
  return (value, path) => {
    if (!Array.isArray(value) || value.length === 0) {
      fail(path, 'a non-empty array', value);
    }
    return value.map((entry, index) => attributionComponent(entry, `${path}[${index}]`));
  };
}
