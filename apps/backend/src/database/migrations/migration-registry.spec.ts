import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MIGRATIONS } from '../migration-registry';

const EXPECTED_ORDER = [
  'RoutePoisJsonb1731000000000',
  'ImageAttributionKeys1731000000001',
  'AddPoiUrlColumns1731000000002',
  'AddWikidataUrl1731000000003',
  'CreateItineraryDraft1744650000000',
  'AddEgrknRegNumber1744650000001',
  'AddRouteLoop1744650000002',
  'CreateRuntimeFoundation1786340733385',
  'RetireOsmSyncState1786341200000',
];

describe('migration registry', () => {
  it('lists every migration once, in ascending timestamp order, retirement last', () => {
    const names = MIGRATIONS.map((m) => new m().name);
    expect(names).toEqual(EXPECTED_ORDER);
    expect(new Set(names).size).toBe(names.length);
    // Ascending by the numeric timestamp prefix of the class name.
    const sorted = [...names].sort((a, b) => {
      const ts = (n: string) => parseInt((n.match(/(\d{13})/) ?? ['0'])[0], 10);
      return ts(a) - ts(b);
    });
    expect(sorted).toEqual(names);
  });

  it('retires the legacy OSM sync state as the final migration, after the foundation', () => {
    const names = MIGRATIONS.map((m) => new m().name);
    expect(names[names.length - 1]).toBe('RetireOsmSyncState1786341200000');
    expect(names[names.length - 2]).toBe('CreateRuntimeFoundation1786340733385');
  });

  it('CLI and DatabaseModule both consume the shared registry (no inline list drift)', () => {
    const cli = readFileSync(join(__dirname, '..', 'cli', 'migrate.ts'), 'utf8');
    const module = readFileSync(join(__dirname, '..', 'database.module.ts'), 'utf8');

    expect(cli).toMatch(/import \{ MIGRATIONS \} from '\.\.\/migration-registry'/);
    expect(module).toMatch(/import \{ MIGRATIONS \} from '\.\/migration-registry'/);
    // No inline migration arrays may survive in either registration point.
    expect(cli).not.toMatch(/migrations: \[\n\s+RoutePoisJsonb/);
    expect(module).not.toMatch(/const migrations = \[\n\s+require\('\.\/migrations\//);
  });

  it('every migration class declares a `name` matching its class name', () => {
    for (const MigrationClass of MIGRATIONS) {
      const instance = new MigrationClass();
      expect(instance.name).toBe(MigrationClass.name);
    }
  });
});
