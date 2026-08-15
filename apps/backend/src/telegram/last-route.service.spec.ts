import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LastRouteService } from './last-route.service';
import type { LastRouteCacheEntity } from './entities/last-route-cache.entity';

/**
 * Tests for the last-route cache service:
 *  - set() upserts by chatId
 *  - get() returns the cached route when fresh
 *  - get() returns null + lazily deletes when expired
 *  - clear() drops the row
 *  - set() with a custom TTL is honoured
 *
 * The TypeORM repository is mocked: we keep an in-memory Map and emulate
 * upsert/findOne/delete.
 */

type Row = LastRouteCacheEntity;

function makeRepo() {
  const rows = new Map<number, Row>();
  return {
    findOne: vi.fn(({ where }: any) =>
      Promise.resolve(where?.chatId != null ? rows.get(Number(where.chatId)) ?? null : null),
    ),
    upsert: vi.fn((row: Row) => {
      rows.set(Number(row.chatId), { ...rows.get(Number(row.chatId)), ...row });
      return Promise.resolve();
    }),
    delete: vi.fn((where: any) => {
      const had = rows.delete(Number(where.chatId));
      return Promise.resolve({ affected: had ? 1 : 0 });
    }),
    _rows: rows,
  } as any;
}

function makeRoute() {
  return {
    distance: 12_400,
    duration: 4320,
    ascend: 240,
    descend: 235,
    profile: 'bike',
    geojson: { type: 'LineString', coordinates: [[49.6, 58.6], [49.7, 58.7]] },
    pois: [
      { id: 'p1', name: 'Church', category: 'religion', lat: 58.61, lon: 49.61 },
      { id: 'p2', name: 'Museum', category: 'museum', lat: 58.65, lon: 49.65 },
    ],
    categories: ['heritage', 'religion'],
    timeMinutes: 120,
  };
}

describe('LastRouteService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: LastRouteService;

  beforeEach(() => {
    repo = makeRepo();
    service = new LastRouteService(repo);
  });

  it('set() upserts by chatId', async () => {
    await service.set(111, makeRoute() as any);
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    const stored = repo._rows.get(111);
    expect(stored).toBeTruthy();
    expect(stored!.distance).toBe(12_400);
    expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('set() overwrites prior entry for same chatId', async () => {
    await service.set(111, makeRoute() as any);
    await service.set(111, { ...makeRoute(), distance: 5_000 } as any);
    expect(repo._rows.get(111)!.distance).toBe(5_000);
  });

  it('get() returns null when no entry', async () => {
    expect(await service.get(999)).toBeNull();
  });

  it('get() returns the route when fresh', async () => {
    await service.set(111, makeRoute() as any);
    const r = await service.get(111);
    expect(r).toBeTruthy();
    expect(r!.distance).toBe(12_400);
    expect(r!.pois).toHaveLength(2);
  });

  it('get() returns null and deletes when expired', async () => {
    await service.set(111, makeRoute() as any, 50);
    await new Promise((r) => setTimeout(r, 80));
    const r = await service.get(111);
    expect(r).toBeNull();
    expect(repo.delete).toHaveBeenCalledWith({ chatId: 111 });
    expect(repo._rows.has(111)).toBe(false);
  });

  it('get() does not delete when fresh (just reads)', async () => {
    await service.set(111, makeRoute() as any, 60_000);
    await service.get(111);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('clear() drops the row', async () => {
    await service.set(111, makeRoute() as any);
    await service.clear(111);
    expect(repo._rows.has(111)).toBe(false);
  });

  it('set() with custom TTL is honoured', async () => {
    await service.set(111, makeRoute() as any, 5_000);
    const r = await service.get(111);
    const expected = Date.now() + 5_000;
    // 1s slop for test execution
    expect(Math.abs(r!.expiresAt - expected)).toBeLessThan(1_000);
  });
});
