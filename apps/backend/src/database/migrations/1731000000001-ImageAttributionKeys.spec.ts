import { describe, expect, it, vi } from 'vitest';
import { ImageAttributionKeys1731000000001 } from './1731000000001-ImageAttributionKeys';

function makeRunner(hasPoiProduct: boolean, hasPoiCanonical: boolean) {
  const query = vi.fn().mockResolvedValue(undefined);
  const hasTable = vi.fn().mockImplementation(async (table: string) =>
    table === 'poi_product' ? hasPoiProduct : table === 'poi_canonical' ? hasPoiCanonical : false,
  );
  return { query, runner: { query, hasTable } as any };
}

/** Every SQL statement the runner received, whitespace-normalised. */
function allSql(query: ReturnType<typeof vi.fn>): string[] {
  return query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim());
}

function updateSqls(query: ReturnType<typeof vi.fn>): string[] {
  return allSql(query).filter((s) => s.startsWith('UPDATE '));
}

describe('ImageAttributionKeys1731000000001', () => {
  it('up: absent poi_canonical produces no SQL mentioning it; poi_product gets its own ALTER + UPDATE', async () => {
    // Observed production shape: poi_product present, poi_canonical absent.
    const { query, runner } = makeRunner(true, false);
    await new ImageAttributionKeys1731000000001().up(runner);

    expect(query).toHaveBeenCalledTimes(2);
    const [alterSql, updateSql] = allSql(query);
    expect(alterSql).toContain('ALTER TABLE poi_product');
    expect(updateSql).toContain('UPDATE poi_product');
    for (const sql of allSql(query)) {
      expect(sql).not.toMatch(/poi_canonical/i);
    }
  });

  it('up: both tables present → each table receives exactly its own ALTER + UPDATE', async () => {
    const { query, runner } = makeRunner(true, true);
    await new ImageAttributionKeys1731000000001().up(runner);

    expect(query).toHaveBeenCalledTimes(4);
    const sqls = allSql(query);
    expect(sqls.filter((s) => s.startsWith('ALTER TABLE poi_product'))).toHaveLength(1);
    expect(sqls.filter((s) => s.startsWith('ALTER TABLE poi_canonical'))).toHaveLength(1);
    expect(sqls.filter((s) => s.startsWith('UPDATE poi_product'))).toHaveLength(1);
    expect(sqls.filter((s) => s.startsWith('UPDATE poi_canonical'))).toHaveLength(1);
  });

  it('up: neither table present (blank DB, pre-foundation) → no SQL at all', async () => {
    const { query, runner } = makeRunner(false, false);
    await new ImageAttributionKeys1731000000001().up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('up: normalizes legacy keys instead of rebuilding the object (arbitrary keys preserved, canonical never overwritten)', async () => {
    const { query, runner } = makeRunner(true, false);
    await new ImageAttributionKeys1731000000001().up(runner);
    const updateSql = updateSqls(query)[0];

    // 1. The RHS starts from the original column value and merges into it —
    //    arbitrary/extra keys survive (no `jsonb_build_object` rebuild).
    expect(updateSql).toContain('SET image_attribution = (');
    expect(updateSql).toContain('image_attribution || COALESCE((');

    // 2. Legacy→canonical mapping is built from the original object values.
    expect(updateSql).toContain(`jsonb_each_text(jsonb_build_object(`);
    expect(updateSql).toContain(`'artist', image_attribution->>'author'`);
    expect(updateSql).toContain(`'credit', image_attribution->>'source_url'`);
    expect(updateSql).toContain(`'licenseUrl', image_attribution->>'license_url'`);

    // 3. Canonical keys are only ever filled when absent / non-null: the
    //    correlated filter keys on the ORIGINAL object's key set (`? k`).
    expect(updateSql).toContain(`WHERE NOT image_attribution ? k AND v IS NOT NULL`);

    // 3. Legacy keys are removed after normalization (idempotent re-run).
    expect(updateSql).toContain(`- 'author' - 'source_url' - 'license_url'`);

    // 4. Only rows carrying a legacy `author` key are rewritten.
    expect(updateSql).toMatch(/WHERE image_attribution \? 'author'/);
  });

  it('down: reverses normalization without rebuilding the object and never overwrites legacy keys', async () => {
    const { query, runner } = makeRunner(true, false);
    await new ImageAttributionKeys1731000000001().down(runner);
    const updateSql = updateSqls(query)[0];

    expect(updateSql).toContain('SET image_attribution = (');
    expect(updateSql).toContain('image_attribution || COALESCE((');
    expect(updateSql).toContain(`'author', image_attribution->>'artist'`);
    expect(updateSql).toContain(`'source_url', image_attribution->>'credit'`);
    expect(updateSql).toContain(`'license_url', image_attribution->>'licenseUrl'`);
    expect(updateSql).toContain(`WHERE NOT image_attribution ? k AND v IS NOT NULL`);
    expect(updateSql).toMatch(/WHERE image_attribution \? 'artist' AND NOT \(image_attribution \? 'author'\)/);
  });

  it('down: absent poi_canonical produces no SQL mentioning it', async () => {
    const { query, runner } = makeRunner(true, false);
    await new ImageAttributionKeys1731000000001().down(runner);
    expect(query).toHaveBeenCalledTimes(1);
    expect(allSql(query)[0]).toContain('UPDATE poi_product');
    for (const sql of allSql(query)) {
      expect(sql).not.toMatch(/poi_canonical/i);
    }
  });

  it('down: both tables present → exactly one UPDATE per table, no ALTERs', async () => {
    const { query, runner } = makeRunner(true, true);
    await new ImageAttributionKeys1731000000001().down(runner);
    const sqls = allSql(query);
    expect(sqls).toHaveLength(2);
    expect(sqls.filter((s) => s.startsWith('UPDATE poi_product'))).toHaveLength(1);
    expect(sqls.filter((s) => s.startsWith('UPDATE poi_canonical'))).toHaveLength(1);
    expect(sqls.some((s) => s.startsWith('ALTER TABLE'))).toBe(false);
  });
});
