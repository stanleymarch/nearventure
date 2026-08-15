/**
 * Test fixture builder for the POI importer (C6).
 *
 * Generates a self-consistent `nearventure-poi-product-sql-v1` bundle on disk:
 * the SQL artifact, the strict v1 import manifest, the toolkit release
 * manifest and the collection provenance file — with matching raw-byte SHA-256
 * digests, counts and cross-file equality. Also exposes helpers to tamper with
 * individual parts so preflight rejection cases can be exercised.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FixtureRow {
  id: string;
  name: string;
  category: string;
  source: 'osm' | 'egrkn';
  lat: number;
  lon: number;
}

export const FIXTURE_CATEGORIES = ['heritage', 'monument', 'sights', 'religion', 'nature', 'museum'] as const;
export const FIXTURE_SOURCES = ['osm', 'egrkn'] as const;

function sqlEscape(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function jsonbEscape(value: unknown): string {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

/** Deterministic 32-char uuid for a fixture row (matches the toolkit poiUuid scheme). */
export function fixtureUuid(id: string): string {
  return createHash('sha256').update('poi-toolkit:' + id).digest('hex').slice(0, 32);
}

/** Emit one upsert statement in the exact v1 shape the exporter produces. */
export function buildFixtureStatement(row: FixtureRow): string {
  const uuid = fixtureUuid(row.id);
  const cols =
    '(poi_uuid, source, external_id, category, name, description, image_url, image_attribution, ' +
    'image_source, lat, lon, is_protected, heritage_facet, attribution, provenance, egrkn_url, ' +
    'wikidata_url, official_url, wikivoyage_url, is_active, subcategory, region, district, city)';
  const values = [
    sqlEscape(uuid),
    sqlEscape(row.source),
    sqlEscape(row.id),
    sqlEscape(row.category),
    sqlEscape(row.name),
    sqlEscape(`Описание ${row.name}`),
    'NULL',
    'NULL',
    'NULL',
    String(row.lat),
    String(row.lon),
    'false',
    'NULL',
    'NULL',
    jsonbEscape({ sources: [row.id], categoryRule: 'fixture', geometryPolicy: row.source, facets: [] }),
    'NULL',
    'NULL',
    'NULL',
    'NULL',
    'true',
    sqlEscape(row.category),
    sqlEscape('Кировская область'),
    sqlEscape('Кировский район'),
    sqlEscape('Киров'),
  ].join(', ');
  const assignments = [
    'category=EXCLUDED.category', 'name=EXCLUDED.name', 'description=EXCLUDED.description',
    'image_url=EXCLUDED.image_url', 'image_attribution=EXCLUDED.image_attribution', 'image_source=EXCLUDED.image_source',
    'lat=EXCLUDED.lat', 'lon=EXCLUDED.lon',
    'is_protected=EXCLUDED.is_protected', 'heritage_facet=EXCLUDED.heritage_facet',
    'attribution=EXCLUDED.attribution', 'provenance=EXCLUDED.provenance',
    'egrkn_url=EXCLUDED.egrkn_url', 'wikidata_url=EXCLUDED.wikidata_url', 'official_url=EXCLUDED.official_url',
    'wikivoyage_url=EXCLUDED.wikivoyage_url', 'subcategory=EXCLUDED.subcategory', 'region=EXCLUDED.region',
    'district=EXCLUDED.district', 'city=EXCLUDED.city',
  ].join(', ');
  return `INSERT INTO poi_product ${cols} VALUES (${values}) ON CONFLICT (poi_uuid) DO UPDATE SET ${assignments};`;
}

export function buildFixtureSql(rows: FixtureRow[]): string {
  return rows.map(buildFixtureStatement).join('\n\n') + '\n';
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface BundleFiles {
  runDir: string;
  manifestPath: string;
  sqlPath: string;
  releasePath: string;
  provenancePath: string;
  sql: string;
  manifest: Record<string, unknown>;
}

export const NOTICE = '© OpenStreetMap contributors (ODbL); Минкультуры РФ (open data)';

const LICENSE_BY_SOURCE: Record<string, { name: string; url: string; attribution: string }> = {
  osm: { name: 'ODbL-1.0', url: 'https://opendatacommons.org/licenses/odbl/', attribution: '© OpenStreetMap contributors' },
  egrkn: { name: 'open-data', url: 'https://opendata.mkrf.ru/', attribution: 'Минкультуры РФ (open data)' },
};

/**
 * Write a fully consistent bundle to `<runDir>` and return its paths.
 * Rows with distinct categories/sources produce realistic cross-file counts.
 */
export async function createValidBundle(runDir: string, rows: FixtureRow[]): Promise<BundleFiles> {
  const reportsDir = join(runDir, 'reports');
  const releaseDir = join(runDir, 'release');
  await mkdir(reportsDir, { recursive: true });
  await mkdir(releaseDir, { recursive: true });

  const sql = buildFixtureSql(rows);
  const sqlBytes = Buffer.from(sql, 'utf8');
  const sqlPath = join(reportsDir, 'poi_product_import.sql');
  await writeFile(sqlPath, sqlBytes);

  const categoryCounts: Record<string, number> = {};
  for (const category of FIXTURE_CATEGORIES) categoryCounts[category] = 0;
  for (const row of rows) categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;

  const sourceCounts: Record<string, number> = {};
  for (const row of rows) sourceCounts[row.source] = (sourceCounts[row.source] ?? 0) + 1;

  const sourceManifests = Object.keys(sourceCounts).map((id) => {
    const entry = LICENSE_BY_SOURCE[id];
    return { id, license: { name: entry.name, url: entry.url }, attribution: entry.attribution };
  });

  const releaseManifest = {
    schemaVersion: 2,
    profile: 'nearventure-v1',
    entityCount: rows.length,
    categoryCounts,
    coverage: { subject: 'pfo' },
    attribution: NOTICE,
    sourceCounts,
    artifacts: { 'poi_product_import.sql': { sha256: sha256Hex(sqlBytes), bytes: sqlBytes.byteLength } },
  };
  const releaseBytes = Buffer.from(JSON.stringify(releaseManifest, null, 2) + '\n', 'utf8');
  const releasePath = join(releaseDir, 'manifest.json');
  await writeFile(releasePath, releaseBytes);

  const collectionProvenance = {
    schemaVersion: 1,
    territory: { slug: 'pfo', profile: 'nearventure-v1' },
    inputPbf: { file: 'pfo-latest.osm.pbf', sha256: 'a'.repeat(64) },
    sourceManifests,
  };
  const provenanceBytes = Buffer.from(JSON.stringify(collectionProvenance, null, 2) + '\n', 'utf8');
  const provenancePath = join(reportsDir, 'collection-provenance.json');
  await writeFile(provenancePath, provenanceBytes);

  const manifest = {
    schemaVersion: 1,
    kind: 'nearventure.poi-product-import',
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
      path: 'reports/poi_product_import.sql',
      count: rows.length,
      bytes: sqlBytes.byteLength,
      sha256: sha256Hex(sqlBytes),
    },
    counts: { categories: categoryCounts, sourceRecords: sourceCounts },
    provenance: {
      releaseManifest: { path: 'release/manifest.json', sha256: sha256Hex(releaseBytes) },
      collectionProvenance: { path: 'reports/collection-provenance.json', sha256: sha256Hex(provenanceBytes) },
    },
    sourceAttribution: { notice: NOTICE, components: sourceManifests },
  };
  const manifestPath = join(reportsDir, 'poi_product_import.manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  return { runDir, manifestPath, sqlPath, releasePath, provenancePath, sql, manifest };
}

/** Standard fixture rows used across tests. */
export function defaultFixtureRows(): FixtureRow[] {
  return [
    { id: 'entity:1', name: 'Успенский собор', category: 'religion', source: 'osm', lat: 58.6035, lon: 49.668 },
    { id: 'entity:2', name: 'Музей Васнецовых', category: 'museum', source: 'egrkn', lat: 58.601, lon: 49.671 },
    { id: 'entity:3', name: 'Парк им. Кирова', category: 'nature', source: 'osm', lat: 58.593, lon: 49.683 },
  ];
}
