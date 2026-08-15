/**
 * Restricted SQL grammar for the `nearventure-poi-product-sql-v1` artifact.
 *
 * The toolkit emits exactly `records.count` single-row statements of the form
 *
 *   INSERT INTO poi_product (col, ...) VALUES (v, ...)
 *   ON CONFLICT (poi_uuid) DO UPDATE SET col=EXCLUDED.col, ...;
 *
 * Nothing else is accepted: no BEGIN/COMMIT/ROLLBACK, no DDL, no COPY, no SET,
 * no psql meta-commands, no comments, no CTEs, no second-statement tricks, no
 * quoting or casts other than the `'...'::jsonb` JSONB literal. The lexer and
 * parser reject anything outside that grammar *before* the importer opens a
 * write transaction.
 *
 * Statements are parsed into a structured AST and re-rendered by
 * `renderUpsert` with the logical `poi_product` target redirected to the
 * importer-owned staging table. Values are emitted from their validated raw
 * tokens (string literals keep `''` escaping, JSONB literals keep `::jsonb`),
 * so no unchecked SQL text is ever passed to the database.
 */
import { SqlGrammarError } from './import-errors';

/** The exact insertable column set of the v1 format (poi-toolkit export-sql). */
export const ALLOWED_INSERT_COLUMNS: readonly string[] = [
  'poi_uuid',
  'source',
  'external_id',
  'category',
  'name',
  'description',
  'image_url',
  'image_attribution',
  'image_source',
  'lat',
  'lon',
  'is_protected',
  'heritage_facet',
  'attribution',
  'provenance',
  'egrkn_url',
  'wikidata_url',
  'official_url',
  'wikivoyage_url',
  'is_active',
  'subcategory',
  'region',
  'district',
  'city',
];

const ALLOWED_COLUMN_SET = new Set<string>(ALLOWED_INSERT_COLUMNS);

export type SqlValue =
  | { kind: 'string'; raw: string }
  | { kind: 'jsonb'; raw: string }
  | { kind: 'number'; raw: string }
  | { kind: 'boolean'; raw: string }
  | { kind: 'null'; raw: string };

export interface ParsedUpsertStatement {
  table: 'poi_product';
  columns: string[];
  values: SqlValue[];
  conflictColumn: 'poi_uuid';
  assignments: Array<{ column: string; excludedColumn: string }>;
}

export interface ParsedPoiImportSql {
  statements: ParsedUpsertStatement[];
}

type Token =
  | { type: 'keyword'; raw: string; upper: string; start: number }
  | { type: 'identifier'; raw: string; start: number }
  | { type: 'string'; raw: string; start: number }
  | { type: 'number'; raw: string; start: number }
  | { type: 'cast'; raw: string; start: number }
  | { type: 'punct'; raw: string; start: number };

const KEYWORDS = new Set([
  'INSERT', 'INTO', 'VALUES', 'ON', 'CONFLICT', 'DO', 'UPDATE', 'SET',
  'EXCLUDED', 'NULL', 'TRUE', 'FALSE', 'JSONB',
]);

const NUMBER_RE = /^-?[0-9]+(\.[0-9]+)?$/;

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function describe(token: Token | undefined): string {
  if (!token) return 'end of input';
  switch (token.type) {
    case 'keyword': return `keyword ${token.upper}`;
    case 'identifier': return `identifier ${JSON.stringify(token.raw)}`;
    case 'string': return 'string literal';
    case 'number': return `number ${token.raw}`;
    case 'cast': return ':: cast';
    default: return `'${token.raw}'`;
  }
}

/** Tokenize the v1 SQL artifact. Throws SqlGrammarError on any forbidden construct. */
function lex(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      throw new SqlGrammarError(`line comment at offset ${i} is not allowed in the v1 format`);
    }
    if (ch === '/' && sql[i + 1] === '*') {
      throw new SqlGrammarError(`block comment at offset ${i} is not allowed in the v1 format`);
    }
    if (ch === '\\') {
      throw new SqlGrammarError(`psql meta-command at offset ${i} is not allowed in the v1 format`);
    }
    if (ch === '"') {
      throw new SqlGrammarError(`double-quoted identifier at offset ${i} is not allowed in the v1 format`);
    }
    if (ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (!closed) {
        throw new SqlGrammarError(`unterminated string literal at offset ${i}`);
      }
      tokens.push({ type: 'string', raw: sql.slice(i, j), start: i });
      i = j;
      continue;
    }
    if (ch === ':' ) {
      if (sql[i + 1] === ':') {
        tokens.push({ type: 'cast', raw: '::', start: i });
        i += 2;
        continue;
      }
      throw new SqlGrammarError(`unexpected ':' at offset ${i}`);
    }
    if (isDigit(ch) || (ch === '-' && isDigit(sql[i + 1])) || (ch === '.' && isDigit(sql[i + 1]))) {
      let j = i;
      if (sql[j] === '-' || sql[j] === '.') j += 1;
      while (j < n && isDigit(sql[j])) j += 1;
      if (j < n && sql[j] === '.' && isDigit(sql[j + 1])) {
        j += 1;
        while (j < n && isDigit(sql[j])) j += 1;
      }
      const raw = sql.slice(i, j);
      if (!NUMBER_RE.test(raw)) {
        throw new SqlGrammarError(`invalid numeric literal ${JSON.stringify(raw)} at offset ${i}`);
      }
      if (j < n && (sql[j] === 'e' || sql[j] === 'E')) {
        throw new SqlGrammarError(`exponent notation not allowed in numeric literal at offset ${i}`);
      }
      tokens.push({ type: 'number', raw, start: i });
      i = j;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i;
      while (j < n && isIdentPart(sql[j])) j += 1;
      const raw = sql.slice(i, j);
      const upper = raw.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', raw, upper, start: i });
      } else {
        tokens.push({ type: 'identifier', raw, start: i });
      }
      i = j;
      continue;
    }
    if ('(),=;.'.includes(ch)) {
      tokens.push({ type: 'punct', raw: ch, start: i });
      i += 1;
      continue;
    }
    throw new SqlGrammarError(`unexpected character ${JSON.stringify(ch)} at offset ${i}`);
  }
  return tokens;
}

/** Parse the token stream into validated upsert statements. */
function parse(tokens: Token[]): ParsedPoiImportSql {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  const expectKeyword = (kw: string): void => {
    const token = next();
    if (!token || token.type !== 'keyword' || token.upper !== kw) {
      throw new SqlGrammarError(`expected ${kw}, got ${describe(token)}`);
    }
  };
  const expectIdentifier = (): string => {
    const token = next();
    if (!token || token.type !== 'identifier') {
      throw new SqlGrammarError(`expected identifier, got ${describe(token)}`);
    }
    return token.raw;
  };
  const expectPunct = (p: string): void => {
    const token = next();
    if (!token || token.type !== 'punct' || token.raw !== p) {
      throw new SqlGrammarError(`expected '${p}', got ${describe(token)}`);
    }
  };

  const parseValue = (): SqlValue => {
    const token = next();
    if (!token) {
      throw new SqlGrammarError('unexpected end of input in VALUES list');
    }
    if (token.type === 'string') {
      const cast = next();
      if (cast && cast.type === 'cast') {
        const jsonb = next();
        if (!jsonb || jsonb.type !== 'keyword' || jsonb.upper !== 'JSONB') {
          throw new SqlGrammarError('only the ::jsonb cast is allowed, and only on string literals');
        }
        return { kind: 'jsonb', raw: `${token.raw}::jsonb` };
      }
      if (cast) pos -= 1; // not a cast — put the token back
      return { kind: 'string', raw: token.raw };
    }
    if (token.type === 'number') {
      return { kind: 'number', raw: token.raw };
    }
    if (token.type === 'keyword') {
      if (token.upper === 'NULL') return { kind: 'null', raw: 'NULL' };
      if (token.upper === 'TRUE') return { kind: 'boolean', raw: 'true' };
      if (token.upper === 'FALSE') return { kind: 'boolean', raw: 'false' };
    }
    throw new SqlGrammarError(`invalid value ${describe(token)} in VALUES list`);
  };

  const parseStatement = (): ParsedUpsertStatement => {
    expectKeyword('INSERT');
    expectKeyword('INTO');
    const table = expectIdentifier();
    if (table.toLowerCase() !== 'poi_product') {
      throw new SqlGrammarError(`INSERT target must be poi_product, got ${JSON.stringify(table)}`);
    }

    expectPunct('(');
    const columns: string[] = [];
    const seenColumns = new Set<string>();
    for (;;) {
      const column = expectIdentifier();
      if (!ALLOWED_COLUMN_SET.has(column)) {
        throw new SqlGrammarError(`column ${JSON.stringify(column)} is not part of the v1 format`);
      }
      if (seenColumns.has(column)) {
        throw new SqlGrammarError(`duplicate column ${JSON.stringify(column)} in INSERT`);
      }
      seenColumns.add(column);
      columns.push(column);
      const sep = peek();
      if (sep && sep.type === 'punct' && sep.raw === ',') {
        next();
        continue;
      }
      break;
    }
    expectPunct(')');
    if (!seenColumns.has('poi_uuid')) {
      throw new SqlGrammarError('INSERT must include the poi_uuid column (required for ON CONFLICT)');
    }

    expectKeyword('VALUES');
    expectPunct('(');
    const values: SqlValue[] = [];
    for (;;) {
      values.push(parseValue());
      const sep = peek();
      if (sep && sep.type === 'punct' && sep.raw === ',') {
        next();
        continue;
      }
      break;
    }
    expectPunct(')');
    if (values.length !== columns.length) {
      throw new SqlGrammarError(
        `column count (${columns.length}) does not match value count (${values.length})`,
      );
    }

    expectKeyword('ON');
    expectKeyword('CONFLICT');
    expectPunct('(');
    const conflictColumn = expectIdentifier();
    expectPunct(')');
    if (conflictColumn !== 'poi_uuid') {
      throw new SqlGrammarError(
        `ON CONFLICT target must be poi_uuid, got ${JSON.stringify(conflictColumn)}`,
      );
    }

    expectKeyword('DO');
    expectKeyword('UPDATE');
    expectKeyword('SET');
    const assignments: Array<{ column: string; excludedColumn: string }> = [];
    const seenAssignments = new Set<string>();
    for (;;) {
      const column = expectIdentifier();
      expectPunct('=');
      const excluded = next();
      if (!excluded || excluded.type !== 'keyword' || excluded.upper !== 'EXCLUDED') {
        throw new SqlGrammarError('DO UPDATE SET must reference EXCLUDED.<column>');
      }
      expectPunct('.');
      const excludedColumn = expectIdentifier();
      if (excludedColumn !== column) {
        throw new SqlGrammarError(
          `DO UPDATE SET must be column=EXCLUDED.column, got ${column}=EXCLUDED.${excludedColumn}`,
        );
      }
      if (!seenColumns.has(column)) {
        throw new SqlGrammarError(`DO UPDATE SET references ${column}, which is not an INSERT column`);
      }
      if (column === 'poi_uuid') {
        throw new SqlGrammarError('DO UPDATE SET must not update poi_uuid');
      }
      if (seenAssignments.has(column)) {
        throw new SqlGrammarError(`duplicate DO UPDATE SET column ${JSON.stringify(column)}`);
      }
      seenAssignments.add(column);
      assignments.push({ column, excludedColumn });
      const sep = peek();
      if (sep && sep.type === 'punct' && sep.raw === ',') {
        next();
        continue;
      }
      break;
    }
    if (assignments.length === 0) {
      throw new SqlGrammarError('DO UPDATE SET must contain at least one assignment');
    }

    expectPunct(';');
    return {
      table: 'poi_product',
      columns,
      values,
      conflictColumn: 'poi_uuid',
      assignments,
    };
  };

  const statements: ParsedUpsertStatement[] = [];
  while (pos < tokens.length) {
    statements.push(parseStatement());
  }
  if (statements.length === 0) {
    throw new SqlGrammarError('the SQL artifact is empty: expected at least one INSERT statement');
  }
  return { statements };
}

/** Parse and validate a complete v1 SQL artifact. */
export function parsePoiImportSql(sql: string): ParsedPoiImportSql {
  const tokens = lex(sql);
  return parse(tokens);
}

/** Re-render a validated upsert statement against the given staging table. */
export function renderUpsert(statement: ParsedUpsertStatement, targetTable: string): string {
  const columns = statement.columns.join(', ');
  const values = statement.values.map((value) => value.raw).join(', ');
  const assignments = statement.assignments
    .map((a) => `${a.column}=EXCLUDED.${a.excludedColumn}`)
    .join(', ');
  return (
    `INSERT INTO ${quoteIdentifier(targetTable)} (${columns}) VALUES (${values}) ` +
    `ON CONFLICT (poi_uuid) DO UPDATE SET ${assignments};`
  );
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
