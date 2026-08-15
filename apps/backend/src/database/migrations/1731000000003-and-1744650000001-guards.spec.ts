import { describe, expect, it, vi } from 'vitest';
import { AddWikidataUrl1731000000003 } from './1731000000003-AddWikidataUrl';
import { AddEgrknRegNumber1744650000001 } from './1744650000001-AddEgrknRegNumber';

describe('AddWikidataUrl1731000000003', () => {
  it('emits the ALTER only when poi_product exists', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const hasTable = vi.fn().mockResolvedValue(true);
    await new AddWikidataUrl1731000000003().up({ query, hasTable } as any);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain('ALTER TABLE poi_product');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS wikidata_url VARCHAR(500)');
  });

  it('no-ops on a blank database (pre-foundation)', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const hasTable = vi.fn().mockResolvedValue(false);
    await new AddWikidataUrl1731000000003().up({ query, hasTable } as any);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('AddEgrknRegNumber1744650000001', () => {
  it('emits the ALTER only when poi_product exists', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const hasTable = vi.fn().mockResolvedValue(true);
    await new AddEgrknRegNumber1744650000001().up({ query, hasTable } as any);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain('ALTER TABLE poi_product');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS egrkn_reg_number VARCHAR');
  });

  it('no-ops on a blank database (pre-foundation)', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const hasTable = vi.fn().mockResolvedValue(false);
    await new AddEgrknRegNumber1744650000001().up({ query, hasTable } as any);
    expect(query).not.toHaveBeenCalled();
  });
});
