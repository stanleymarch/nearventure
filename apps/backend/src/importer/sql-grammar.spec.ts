import { describe, expect, it } from 'vitest';
import { SqlGrammarError } from './import-errors';
import {
  parsePoiImportSql,
  renderUpsert,
  type ParsedUpsertStatement,
} from './sql-grammar';
import { buildFixtureSql, defaultFixtureRows, fixtureUuid } from './test-fixtures';

function firstStatement(): ParsedUpsertStatement {
  const parsed = parsePoiImportSql(buildFixtureSql(defaultFixtureRows()));
  expect(parsed.statements.length).toBe(3);
  return parsed.statements[0];
}

describe('sql grammar — v1 data-only upsert format', () => {
  it('parses the exporter-shaped SQL into structured ASTs', () => {
    const rows = defaultFixtureRows();
    const parsed = parsePoiImportSql(buildFixtureSql(rows));
    expect(parsed.statements).toHaveLength(rows.length);
    const first = parsed.statements[0];
    expect(first.table).toBe('poi_product');
    expect(first.conflictColumn).toBe('poi_uuid');
    expect(first.columns).toContain('poi_uuid');
    expect(first.columns).toContain('provenance');
    expect(first.values[0].kind).toBe('string');
    expect(first.values[0].raw).toBe(`'${fixtureUuid(rows[0].id)}'`);
    const provenanceValue = first.values[14];
    expect(provenanceValue.kind).toBe('jsonb');
    expect(provenanceValue.raw).toContain('::jsonb');
    expect(first.values[9].kind).toBe('number');
    expect(first.values[11].kind).toBe('boolean');
    expect(first.values[3].kind).toBe('string');
  });

  it('handles apostrophes escaped as doubled single quotes', () => {
    const rows = [{ ...defaultFixtureRows()[0], name: "Bob's Dacha (О'Брайан)" }];
    const parsed = parsePoiImportSql(buildFixtureSql(rows));
    expect(parsed.statements).toHaveLength(1);
    const nameValue = parsed.statements[0].values[4];
    expect(nameValue.raw).toContain("''");
  });

  it('re-renders a statement retargeted to a staging table', () => {
    const statement = firstStatement();
    const rendered = renderUpsert(statement, 'poi_product_staging_abc123');
    expect(rendered).toContain('INSERT INTO "poi_product_staging_abc123" (');
    expect(rendered).toContain('ON CONFLICT (poi_uuid) DO UPDATE SET');
    expect(rendered).not.toContain('poi_product (');
    expect(rendered.endsWith(';')).toBe(true);
    // raw values preserved verbatim
    expect(rendered).toContain("::jsonb");
  });

  const rejectSql: Array<[string, string]> = [
    ['transaction control — BEGIN', 'BEGIN;'],
    ['transaction control — COMMIT', 'COMMIT;'],
    ['transaction control — ROLLBACK', 'ROLLBACK;'],
    ['DDL — CREATE TABLE', 'CREATE TABLE x (id int);'],
    ['DDL — ALTER', 'ALTER TABLE poi_product ADD COLUMN x int;'],
    ['DDL — DROP', 'DROP TABLE poi_product;'],
    ['COPY', 'COPY poi_product FROM stdin;'],
    ['SET', 'SET search_path TO public;'],
    ['TRUNCATE', 'TRUNCATE poi_product;'],
    ['DELETE', 'DELETE FROM poi_product;'],
    ['psql meta-command', '\\g'],
    ['line comment', '-- comment\n' + buildFixtureSql([defaultFixtureRows()[0]])],
    ['block comment', '/* c */ ' + buildFixtureSql([defaultFixtureRows()[0]])],
    ['double-quoted identifier', 'INSERT INTO "poi_product" (poi_uuid) VALUES (1) ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['unterminated string', "INSERT INTO poi_product (poi_uuid, name) VALUES ('abc, 'x') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;"],
    ['second statement — SELECT', buildFixtureSql([defaultFixtureRows()[0]]) + ' SELECT 1;'],
    ['second statement — UPDATE poi_overrides', buildFixtureSql([defaultFixtureRows()[0]]) + ' UPDATE poi_overrides SET display_name = x;'],
    ['ON CONFLICT DO NOTHING', 'INSERT INTO poi_product (poi_uuid) VALUES (\'a\') ON CONFLICT (poi_uuid) DO NOTHING;'],
    ['no ON CONFLICT', 'INSERT INTO poi_product (poi_uuid) VALUES (\'a\');'],
    ['conflict target not poi_uuid', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', \'x\') ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name;'],
    ['assignment without EXCLUDED', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', \'x\') ON CONFLICT (poi_uuid) DO UPDATE SET name=\'x\';'],
    ['assignment to non-inserted column', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', \'x\') ON CONFLICT (poi_uuid) DO UPDATE SET category=EXCLUDED.category;'],
    ['assignment updates poi_uuid', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', \'x\') ON CONFLICT (poi_uuid) DO UPDATE SET poi_uuid=EXCLUDED.poi_uuid;'],
    ['insert into other table', 'INSERT INTO poi_overrides (poi_uuid) VALUES (\'a\') ON CONFLICT (poi_uuid) DO UPDATE SET display_name=EXCLUDED.display_name;'],
    ['schema-qualified target', 'INSERT INTO public.poi_product (poi_uuid) VALUES (\'a\') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['unknown column', 'INSERT INTO poi_product (poi_uuid, evil_column) VALUES (\'a\', \'x\') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['missing poi_uuid column', 'INSERT INTO poi_product (name) VALUES (\'x\') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['column/value count mismatch', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['unquoted string value', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', x) ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['::text cast', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', \'x\'::text) ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['::jsonb on number', 'INSERT INTO poi_product (poi_uuid, provenance) VALUES (\'a\', 1::jsonb) ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['exponent number', 'INSERT INTO poi_product (poi_uuid, lat) VALUES (\'a\', 1e5) ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['negative-only number', 'INSERT INTO poi_product (poi_uuid, lat) VALUES (\'a\', -) ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['missing semicolon', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', \'x\') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name'],
    ['trailing garbage', buildFixtureSql([defaultFixtureRows()[0]]) + ' GARBAGE'],
    ['cte', 'WITH x AS (SELECT 1) INSERT INTO poi_product (poi_uuid) VALUES (\'a\') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
    ['returning clause', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', \'x\') ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name RETURNING poi_uuid;'],
    ['dollar-quoted string', 'INSERT INTO poi_product (poi_uuid, name) VALUES (\'a\', $$x$$) ON CONFLICT (poi_uuid) DO UPDATE SET name=EXCLUDED.name;'],
  ];

  for (const [name, sql] of rejectSql) {
    it(`rejects: ${name}`, () => {
      expect(() => parsePoiImportSql(sql)).toThrow(SqlGrammarError);
    });
  }

  it('rejects empty input', () => {
    expect(() => parsePoiImportSql('')).toThrow(SqlGrammarError);
    expect(() => parsePoiImportSql('   \n  ')).toThrow(SqlGrammarError);
  });
});
