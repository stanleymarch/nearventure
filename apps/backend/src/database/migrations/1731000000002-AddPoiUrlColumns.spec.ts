import { describe, expect, it, vi } from 'vitest';
import { AddPoiUrlColumns1731000000002 } from './1731000000002-AddPoiUrlColumns';

function makeRunner(hasPoiProduct: boolean, hasPoiCanonical: boolean) {
  const query = vi.fn().mockResolvedValue(undefined);
  const hasTable = vi.fn().mockImplementation(async (table: string) =>
    table === 'poi_product' ? hasPoiProduct : table === 'poi_canonical' ? hasPoiCanonical : false,
  );
  return { query, runner: { query, hasTable } as any };
}

function allSql(query: ReturnType<typeof vi.fn>): string[] {
  return query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim());
}

describe('AddPoiUrlColumns1731000000002', () => {
  it('absent poi_canonical → only the poi_product ALTER is emitted (production shape)', async () => {
    const { query, runner } = makeRunner(true, false);
    await new AddPoiUrlColumns1731000000002().up(runner);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = allSql(query)[0];
    expect(sql).toMatch(/ALTER TABLE poi_product/);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS egrkn_url');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS wikivoyage_url');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS article_url');
    expect(sql).not.toMatch(/poi_canonical/i);
  });

  it('both tables present → one ALTER per table', async () => {
    const { query, runner } = makeRunner(true, true);
    await new AddPoiUrlColumns1731000000002().up(runner);
    expect(query).toHaveBeenCalledTimes(2);
    const sqls = allSql(query);
    expect(sqls.some((s) => s.startsWith('ALTER TABLE poi_canonical'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('ALTER TABLE poi_product'))).toBe(true);
  });

  it('neither table present (blank DB, pre-foundation) → no SQL at all', async () => {
    const { query, runner } = makeRunner(false, false);
    await new AddPoiUrlColumns1731000000002().up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('down stays a no-op', async () => {
    const { query, runner } = makeRunner(true, true);
    await new AddPoiUrlColumns1731000000002().down(runner);
    expect(query).not.toHaveBeenCalled();
  });
});
