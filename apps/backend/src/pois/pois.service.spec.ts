import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoisService } from './pois.service';
import { NotFoundException } from '@nestjs/common';

describe('PoisService', () => {
  let service: PoisService;
  let mockDataSource: any;
  let mockOverrideRepo: any;
  let mockRemoteImageFetcher: any;

  beforeEach(() => {
    mockDataSource = {
      query: vi.fn(),
    };

    mockOverrideRepo = {
      findOne: vi.fn(),
      insert: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
    };
    mockRemoteImageFetcher = { fetch: vi.fn() };

    service = new PoisService(mockDataSource, mockOverrideRepo, mockRemoteImageFetcher);
    vi.spyOn(require('fs/promises'), 'mkdir').mockResolvedValue(undefined);
  });

  describe('findReturnLegCandidates', () => {
    it('commits a transaction when abort is observed after SET LOCAL', async () => {
      const controller = new AbortController();
      const runner = { connect: vi.fn(), startTransaction: vi.fn(), query: vi.fn(async () => { controller.abort(); return []; }), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn() };
      mockDataSource.createQueryRunner = vi.fn(() => runner);
      await expect(service.findReturnLegCandidates([49, 58, 50, 59], 120, controller.signal)).resolves.toEqual([]);
      expect(runner.commitTransaction).toHaveBeenCalledOnce();
      expect(runner.rollbackTransaction).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalledOnce();
    });

    it('rolls back a failed candidate query', async () => {
      const runner = { connect: vi.fn(), startTransaction: vi.fn(), query: vi.fn().mockRejectedValue(new Error('timeout')), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn() };
      mockDataSource.createQueryRunner = vi.fn(() => runner);
      await expect(service.findReturnLegCandidates([49, 58, 50, 59], 120)).rejects.toThrow('timeout');
      expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
      expect(runner.release).toHaveBeenCalledOnce();
    });

    it('releases the runner when startTransaction rejects before a transaction is active', async () => {
      const runner = {
        connect: vi.fn(),
        startTransaction: vi.fn().mockRejectedValue(new Error('cannot start transaction')),
        query: vi.fn(),
        commitTransaction: vi.fn(),
        rollbackTransaction: vi.fn(),
        release: vi.fn(),
      };
      mockDataSource.createQueryRunner = vi.fn(() => runner);

      await expect(service.findReturnLegCandidates([49, 58, 50, 59], 120)).rejects.toThrow('cannot start transaction');
      expect(runner.rollbackTransaction).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalledOnce();
    });
  });

  describe('fetchPois', () => {
    it('returns POIs list with total count', async () => {
      const mockPOIs = [
        {
          id: '123',
          category: 'heritage',
          name: 'Test Museum',
          lat: 58.6,
          lon: 49.6,
          popularityScore: 10,
        },
      ];

      mockDataSource.query
        .mockResolvedValueOnce(mockPOIs)  // First call: get POIs
        .mockResolvedValueOnce([{ count: 1 }]);  // Second call: get total

      const result = await service.list({});

      expect(result).toEqual({ items: mockPOIs, total: 1 });
      expect(mockDataSource.query).toHaveBeenCalledTimes(2);
    });

    it('does not advertise an external OSM image with flat ODbL in list or detail responses', async () => {
      const row = {
        id: 'osm-12345', category: 'heritage', name: 'OSM POI', lat: 58.6, lon: 49.6,
        imageUrl: 'https://images.openstreetmap.org/kirov/poi-12345.jpg',
        imageSource: 'external', imageAttribution: null,
        provenance: { image: 'osm' },
        attribution: { osm: { label: 'OpenStreetMap', license: 'ODbL-1.0', url: 'https://www.openstreetmap.org/copyright' } },
      };
      mockDataSource.query
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([row]);

      const list = await service.list({});
      const detail = await service.byId(row.id);

      expect(list.items[0].imageUrl).toBeNull();
      expect(detail.imageUrl).toBeNull();
      expect(list.items[0].attribution?.osm.license).toBe('ODbL-1.0');
    });

    it('throws NotFoundException for invalid category', async () => {
      await expect(service.list({ category: 'invalid' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('polygon coverage', () => {
    it('uses indexed bbox prefilters before parameterized boundary-covering ST_Covers', async () => {
      mockDataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);
      await service.listCoveredByPolygon(
        { type: 'Polygon', coordinates: [[[49, 58], [50, 58], [50, 59], [49, 58]]] },
        { limit: 10 },
      );
      const [sql, params] = mockDataSource.query.mock.calls[0];
      expect(sql).toContain('pp.lat BETWEEN $2 AND $3');
      expect(sql).toContain('pp.lon BETWEEN $4 AND $5');
      expect(sql.indexOf('pp.lat BETWEEN')).toBeLessThan(sql.indexOf('ST_Covers'));
      expect(sql).toContain('ST_Covers'); // unlike ST_Contains, includes polygon boundary points
      expect(params).toEqual([expect.stringContaining('Polygon'), 58, 59, 49, 50, 10, 0]);
    });

    it('supports MultiPolygon and keeps category and pagination parameterized', async () => {
      mockDataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }]);
      const multiPolygon = {
        type: 'MultiPolygon',
        coordinates: [
          [[[49, 58], [50, 58], [50, 59], [49, 58]]],
          [[[51, 60], [52, 60], [52, 61], [51, 60]]],
        ],
      };
      await service.listCoveredByPolygon(multiPolygon, { category: 'nature,museum', limit: 7, offset: 2 });
      const [sql, params] = mockDataSource.query.mock.calls[0];
      expect(sql).toContain('pp.category = ANY($6)');
      expect(params.slice(1)).toEqual([58, 61, 49, 52, ['nature', 'museum'], 7, 2]);
    });

    it('rejects invalid geometry/category without issuing SQL', async () => {
      await expect(service.listCoveredByPolygon({ type: 'Polygon', coordinates: [] }, {})).rejects.toThrow(NotFoundException);
      await expect(service.listCoveredByPolygon(
        { type: 'Polygon', coordinates: [[[49, 58], [50, 58], [50, 59], [49, 58]]] },
        { category: 'invalid' },
      )).rejects.toThrow(NotFoundException);
      expect(mockDataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('content filters', () => {
    it('adds a non-empty description filter when hasDescription=true', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([])   // items
        .mockResolvedValueOnce([{ count: 0 }]); // total

      await service.list({ hasDescription: true });

      const sql = mockDataSource.query.mock.calls[0][0] as string;
      expect(sql).toContain('pp.description IS NOT NULL');
      expect(sql).toContain("pp.description <> ''");
    });

    it('adds a non-empty image filter when hasPhoto=true', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      await service.list({ hasPhoto: true });

      const sql = mockDataSource.query.mock.calls[0][0] as string;
      expect(sql).toContain('pp.image_url IS NOT NULL');
      expect(sql).toContain("pp.image_url <> ''");
    });

    it('does not add content filters when the flags are false', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      await service.list({ hasDescription: false, hasPhoto: false });

      const sql = mockDataSource.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('pp.description IS NOT NULL');
      expect(sql).not.toContain('pp.image_url IS NOT NULL');
    });
  });

  describe('regions', () => {
    it('returns distinct region list from poi_product (collector admin-boundary)', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { region: 'Кировская область' },
        { region: 'Нижегородская область' },
      ]);
      await expect(service.regions()).resolves.toEqual({
        regions: ['Кировская область', 'Нижегородская область'],
      });
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT region FROM poi_product'),
      );
    });
  });

  describe('regionAt', () => {
    it('returns the most common region within 5 km (tight radius)', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { region: 'Кировская область', n: 7 },
        { region: 'Нижегородская область', n: 1 },
      ]);
      const result = await service.regionAt(58.6, 49.6);
      expect(result).toEqual({ region: 'Кировская область', sample: 7 });
      // Tight radius is the first query; the wide fallback is skipped
      // when we already have a match.
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
    });

    it('falls back to the wide radius when no POI is within 5 km', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([]) // tight: empty
        .mockResolvedValueOnce([{ region: 'Московская область', n: 3 }]); // wide: hit
      const result = await service.regionAt(55.75, 37.6);
      expect(result).toEqual({ region: 'Московская область', sample: 3 });
      expect(mockDataSource.query).toHaveBeenCalledTimes(2);
    });

    it('returns null region when nothing is anywhere within 50 km', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([]) // tight
        .mockResolvedValueOnce([]); // wide
      const result = await service.regionAt(0, 0); // middle of the ocean
      expect(result).toEqual({ region: null, sample: 0 });
    });
  });

  describe('getNearby', () => {
    it('returns POIs within radius when lat/lng/radius provided', async () => {
      const mockPOIs = [
        { id: '123', category: 'nature', lat: 58.601, lon: 49.601, popularityScore: 5 },
        { id: '124', category: 'museum', lat: 58.599, lon: 49.599, popularityScore: 8 },
      ];

      mockDataSource.query
        .mockResolvedValueOnce(mockPOIs)  // First call: get POIs
        .mockResolvedValueOnce([{ count: 2 }]);  // Second call: get total

      const result = await service.list({ lat: 58.6, lng: 49.6, radius: 1000 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('BETWEEN'),
        expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]),
      );
    });

    it('returns empty list when no POIs in radius', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([])  // First call: get POIs
        .mockResolvedValueOnce([{ count: 0 }]);  // Second call: get total

      const result = await service.list({ lat: 58.6, lng: 49.6, radius: 100 });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });
});