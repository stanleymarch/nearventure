import { describe, expect, it } from 'vitest';
import { PlaceClusteringService } from './place-clustering.service';
import { VisitTimeService } from './visit-time.service';
const poi = (id: string, lat: number, lon: number, extra: any = {}) => ({ id, name: id, category: 'monument', lat, lon, included: true, estimatedVisitMinutes: 0, ...extra });
describe('PlaceClusteringService', () => {
  const service = new PlaceClusteringService(new VisitTimeService());
  it('uses a stable explicit-complex id and de-duplicates input ids', async () => {
    const input = [poi('a', 58.6, 49.6, { explicitComplexId: 'square-1' }), poi('b', 58.603, 49.603, { explicitComplexId: 'square-1' }), poi('a', 58.6001, 49.6001, { explicitComplexId: 'square-1' })];
    const forward = await service.cluster(input, 'foot');
    const reverse = await service.cluster([...input].reverse(), 'foot');
    expect(forward).toHaveLength(1); expect(forward[0].pois.map((x) => x.id).sort()).toEqual(['a', 'b']); expect(forward).toEqual(reverse);
  });
  it('requires complete-link network proximity and never joins a 180m chain', async () => {
    const walkable = { minutesBetween: async (from: any, to: any) => Math.abs(from.lon - to.lon) > 0.003 ? 5 : 2 };
    const places = await service.cluster([poi('a', 58.6, 49.6), poi('b', 58.6, 49.602), poi('c', 58.6, 49.604)], 'foot', walkable);
    expect(places).toHaveLength(2); expect(places.flatMap((place) => place.pois).map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('does not use radius-only final clustering and rejects barrier/off-network pairs', async () => {
    expect(await service.cluster([poi('a', 58.6, 49.6), poi('b', 58.6, 49.6001)], 'foot')).toHaveLength(2);
    const blocked = { minutesBetween: async () => null };
    const places = await service.cluster([poi('a', 58.6, 49.6), poi('b', 58.6, 49.6005)], 'foot', blocked);
    expect(places).toHaveLength(2);
    const tooSlowOneWay = { minutesBetween: async (from: any) => from.id === 'a' ? 4 : 2 };
    expect(await service.cluster([poi('a', 58.6, 49.6), poi('b', 58.6, 49.6005)], 'foot', tooSlowOneWay)).toHaveLength(2);
  });
  it('uses the featured child as the deterministic nearby-cluster headline and marks only it notable', async () => {
    const places = await service.cluster([
      poi('z-popular', 58.6, 49.6, { name: 'Popular museum', popularityScore: 99 }),
      poi('a-featured', 58.6001, 49.6001, { name: 'Featured monument', featured: true, popularityScore: 1 }),
      poi('b-normal', 58.6002, 49.6002, { name: 'Normal sight' }),
    ], 'foot', { minutesBetween: async () => 2 });
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe('Featured monument');
    expect(places[0].pois.map((item) => item.id).sort()).toEqual(['a-featured', 'b-normal', 'z-popular']);
    expect(places[0].pois.filter((item) => item.notable).map((item) => item.id)).toEqual(['a-featured']);
  });
  it('handles legacy children without ranking data and chooses a normalized-name headline', async () => {
    const places = await service.cluster([
      poi('z', 58.6, 49.6, { name: 'zebra' }),
      poi('a', 58.6001, 49.6001, { name: '  Alpha  ' }),
    ], 'foot', { minutesBetween: async () => 2 });
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe('  Alpha  ');
    expect(places[0].pois.filter((item) => item.notable).map((item) => item.id)).toEqual(['a']);
  });
  it('honours manual split as a draft override', async () => {
    const places = await service.cluster([poi('a', 58.6, 49.6), poi('b', 58.6, 49.6005)], 'foot', undefined, { splitPoiIds: ['a'] });
    expect(places).toHaveLength(2); expect(places.flatMap((place) => place.pois).map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
  it('keeps diameter safeguards for explicit and manual groups', async () => {
    const far = [poi('a', 58.6, 49.6, { explicitComplexId: 'complex' }), poi('b', 58.61, 49.6, { explicitComplexId: 'complex' })];
    expect(await service.cluster(far, 'foot')).toHaveLength(2);
    expect(await service.cluster(far.map(({ explicitComplexId: _, ...item }) => item), 'foot', undefined, { manualGroups: [['a', 'b']] })).toHaveLength(2);
  });
  it('clusters four square POIs without linear visit-time multiplication', async () => {
    const square = [poi('d', 58.6, 49.6), poi('b', 58.6001, 49.6001), poi('a', 58.6001, 49.6), poi('c', 58.6, 49.6001)].map((item) => ({ ...item, explicitComplexId: 'square' }));
    const places = await service.cluster(square, 'foot');
    expect(places).toHaveLength(1); expect(places[0].pois).toHaveLength(4); expect(places[0].dwellMinutes).toBeLessThan(20);
  });

  it('finds every cross-cell E-W pair 350-399 m apart at Slobodskoy latitude', async () => {
    // Slobodskoy latitude (58.7327°N): lon cells are ~400.3 m wide, so a pair
    // 350-399 m apart in longitude can straddle a cell boundary and would be
    // missed by a 1-ring neighborhood. Each pair below sits with its western
    // POI ~0.995 of a cell into cell k=7 and its eastern POI across the
    // boundary in cell k+1 — the 3x3 spatial index must still find them.
    const refLat = 58.7327;
    const rad = Math.PI / 180;
    const metersPerDeg = Math.cos(refLat * rad) * rad * 6371000;
    const lonCell = 0.0036 / Math.cos(refLat * rad);
    // One pair per lon cell (k=7, 9, 11): within a pair the two POIs straddle
    // the eastern cell boundary, while different pairs are ~800 m apart so
    // complete-link never merges across pairs.
    const spans = [350, 380, 399];
    const cells = [7, 9, 11];
    const input: any[] = [];
    const pairs = spans.map((span, index) => {
      const cell = cells[index];
      const aLon = cell * lonCell + 0.995 * lonCell;
      const bLon = aLon + span / metersPerDeg;
      const a = poi(`sp-${index}-a`, refLat, aLon);
      const b = poi(`sp-${index}-b`, refLat, bLon);
      input.push(a, b);
      return [a.id, b.id];
    });
    // Walkability always says 2 min: any pair the spatial index finds and that
    // is within the 400 m diameter merges. An explicit/manual grouping is NOT
    // used, so a merge can only happen through the index + walkability check.
    const queried: string[] = [];
    const walkable = { minutesBetween: async (from: any, to: any) => { queried.push(`${from.id}>${to.id}`); return 2; } };
    const places = await service.cluster(input, 'foot', walkable as any);
    expect(places).toHaveLength(spans.length);
    for (const place of places) {
      const ids = place.pois.map((p) => p.id).sort();
      const pair = pairs.find(([a, b]) => ids.join(',') === [a, b].sort().join(','));
      expect(pair, `pair ${ids.join(',')} must be a merged cross-cell pair`).toBeDefined();
    }
    // The cross-cell pair was actually compared over the network, not grouped
    // by id or radius alone.
    expect(queried.length).toBeGreaterThanOrEqual(spans.length * 2);
  });

  it('never merges a cell-adjacent pair beyond the 400 m merge diameter', async () => {
    const refLat = 58.7327;
    const rad = Math.PI / 180;
    const metersPerDeg = Math.cos(refLat * rad) * rad * 6371000;
    const lonCell = 0.0036 / Math.cos(refLat * rad);
    // A sits 0.90 of a lon cell into cell 7 (40 m from the boundary); B is
    // 430 m east — one cell over (the 3x3 index finds it) but beyond the
    // 400 m complete-link diameter, so canJoin must reject it BEFORE any
    // walkability call.
    const aLon = 7 * lonCell + 0.90 * lonCell;
    const bLon = aLon + 430 / metersPerDeg;
    const queried: string[] = [];
    const walkable = { minutesBetween: async (from: any, to: any) => { queried.push(`${from.id}>${to.id}`); return 1; } };
    const places = await service.cluster([poi('far-a', refLat, aLon), poi('far-b', refLat, bLon)], 'foot', walkable as any);
    expect(places).toHaveLength(2);
    expect(queried).toHaveLength(0);
  });
});
