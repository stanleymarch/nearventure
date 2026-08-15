import { describe, expect, it, vi } from 'vitest';
import { AddRouteLoop1744650000002 } from './1744650000002-AddRouteLoop';

function makeRunner(routesExists: boolean) {
  const query = vi.fn().mockResolvedValue(undefined);
  const hasTable = vi.fn().mockResolvedValue(routesExists);
  return { query, hasTable, runner: { query, hasTable } as any };
}

describe('AddRouteLoop1744650000002', () => {
  it('adds a nullable loop column without a misleading default when routes exists', async () => {
    const { query, runner } = makeRunner(true);
    await new AddRouteLoop1744650000002().up(runner);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS loop boolean NULL');
    expect(sql).not.toMatch(/DEFAULT\s+(true|false)/i);
    expect(sql).not.toMatch(/NOT NULL/i);
  });

  it('emits no SQL at all when routes is absent (fresh database, pre-foundation)', async () => {
    const { query, runner } = makeRunner(false);
    await new AddRouteLoop1744650000002().up(runner);
    expect(query).not.toHaveBeenCalled();
  });

  it('drops only the additive column on rollback when routes exists', async () => {
    const { query, runner } = makeRunner(true);
    await new AddRouteLoop1744650000002().down(runner);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain('DROP COLUMN IF EXISTS loop');
  });

  it('emits no SQL on rollback when routes is absent', async () => {
    const { query, runner } = makeRunner(false);
    await new AddRouteLoop1744650000002().down(runner);
    expect(query).not.toHaveBeenCalled();
  });
});
