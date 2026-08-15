import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoutesService } from './routes.service';
import { Repository } from 'typeorm';
import type { CreateRouteDto, UpdateRouteDto } from './dto/create-route.dto';
import type { RouteEntity } from './entities/route.entity';

describe('RoutesService', () => {
  let service: RoutesService;
  let mockRouteRepo: any;

  beforeEach(() => {
    // Mock Repository
    mockRouteRepo = {
      create: vi.fn(),
      save: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      find: vi.fn(),
    };

    process.env.PUBLIC_URL = 'https://share.example.test/';
    service = new RoutesService(mockRouteRepo, { query: vi.fn() } as any);
  });

  afterEach(() => {
    delete process.env.PUBLIC_URL;
  });

  describe('createPublicRoute', () => {
    it('creates route and returns public URL and token', async () => {
      const mockRoute: any = {
        id: 'abc123',
        publicToken: 'token456',
      };

      mockRouteRepo.create.mockReturnValue(mockRoute);
      mockRouteRepo.save.mockResolvedValue(mockRoute);

      const result = await service.createPublicRoute(
        {
          title: 'Test Route',
          description: 'Test description',
          transport: 'bike',
          timeAvailable: 30,
          selectedCategories: ['heritage'],
        },
        {
          geojson: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
          },
          distance: 1000,
          duration: 360,
          ascend: 10,
          descend: 5,
          bbox: [49.6, 58.6, 49.61, 58.61],
          profile: 'bike',
        },
        [
          { id: '1', name: 'POI 1', lat: 58.601, lon: 49.601, category: 'heritage' },
        ],
        'test-user',
        'Test User',
        'anon123',
      );

      expect(result.routeId).toBeDefined();
      expect(result.publicUrl).toMatch(/^https:\/\/share\.example\.test\/#\/route\//);
      expect(result.publicUrl).not.toContain(mockRoute.publicToken);
      expect(mockRouteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ publicUrl: result.publicUrl }),
      );
      expect(result.publicToken).toBeDefined();
      expect(mockRouteRepo.save).toHaveBeenCalled();
    });

    it('generates default title when not provided', async () => {
      const mockRoute: any = { id: 'abc123', publicToken: 'token456' };

      mockRouteRepo.create.mockReturnValue(mockRoute);
      mockRouteRepo.save.mockResolvedValue(mockRoute);

      await service.createPublicRoute(
        {} as any,
        {} as any,
        [],
        'test-user',
        undefined,
        undefined,
      );

      expect(mockRouteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Маршрут #'),
        }),
      );
    });

    it('sets expiration to 30 days', async () => {
      const mockRoute: any = { id: 'abc123', publicToken: 'token456' };

      mockRouteRepo.create.mockReturnValue(mockRoute);
      mockRouteRepo.save.mockResolvedValue(mockRoute);

      await service.createPublicRoute({} as any, {} as any, [], 'test-user');

      const callArgs = mockRouteRepo.create.mock.calls[0][0];
      const now = new Date();
      const expiresAt = new Date(callArgs.expiresAt);
      const daysDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      expect(daysDiff).toBeCloseTo(30, 1);
    });
  });

  describe('public route URL persistence', () => {
    it('stores the configured canonical SPA route for map-created routes', async () => {
      mockRouteRepo.create.mockImplementation((value: any) => value);
      mockRouteRepo.save.mockImplementation(async (value: any) => value);

      const saved = await service.createRouteFromMap({
        routeData: { distance: 1, duration: 2, ascend: 0, descend: 0, geojson: null },
        pois: [],
      });

      expect(saved.publicUrl).toBe(`https://share.example.test/#/route/${saved.id}`);
    });

    it('does not persist a fabricated URL when local development has no public base', async () => {
      delete process.env.PUBLIC_URL;
      mockRouteRepo.create.mockImplementation((value: any) => value);
      mockRouteRepo.save.mockImplementation(async (value: any) => value);

      const saved = await service.createRouteFromMap({
        routeData: { distance: 1, duration: 2, ascend: 0, descend: 0, geojson: null },
        pois: [],
      });

      expect(saved.publicUrl).toBeNull();
    });
  });

  describe('route topology persistence', () => {
    it.each([
      [true, true],
      [false, false],
      [undefined, null],
    ])('stores map option %s as %s', async (input, expected) => {
      mockRouteRepo.create.mockImplementation((value: any) => value);
      mockRouteRepo.save.mockImplementation(async (value: any) => value);

      const saved = await service.createRouteFromMap({
        routeData: { distance: 1, duration: 2, ascend: 0, descend: 0, geojson: null },
        pois: [],
        profile: 'foot',
        ...(input === undefined ? {} : { options: { loop: input } }),
      });

      expect(saved.loop).toBe(expected);
    });

    it('keeps nullable legacy topology as null in the public contract', () => {
      expect(service.toPublicRoute({ loop: null } as any)).toMatchObject({
        loop: null,
        options: { loop: null, optimize: false },
      });
      expect(service.toPublicRoute({ loop: false } as any).loop).toBe(false);
      expect(service.toPublicRoute({ loop: true } as any).loop).toBe(true);
    });

    it('suppresses legacy snapshot image URLs but preserves a safe current-media hint', () => {
      const publicRoute = service.toPublicRoute({
        loop: null,
        pois: [
          {
            id: 'unverified', name: 'Legacy external', category: 'sights', lat: 1, lon: 2,
            imageUrl: 'https://images.openstreetmap.org/legacy.jpg',
          },
          {
            id: 'structured', name: 'Verified current POI', category: 'museum', lat: 3, lon: 4,
            imageUrl: 'https://upload.wikimedia.org/official.jpg',
          },
        ],
      } as any);

      expect(publicRoute.pois).toEqual([
        { id: 'unverified', name: 'Legacy external', category: 'sights', lat: 1, lon: 2, hasMedia: true },
        { id: 'structured', name: 'Verified current POI', category: 'museum', lat: 3, lon: 4, hasMedia: true },
      ]);
      expect(JSON.stringify(publicRoute.pois)).not.toContain('https://');
    });
  });

  describe('getRouteById', () => {
    it('retrieves a route directly without a fabricated public URL', async () => {
      const mockRoute: any = {
        id: 'abc123',
        analytics: { views: 0, shares: 0, gpxDownloads: 0 },
        expiresAt: new Date(Date.now() + 1_000_000).toISOString(),
      };
      mockRouteRepo.findOne.mockResolvedValue(mockRoute);
      mockRouteRepo.save.mockResolvedValue(mockRoute);

      const result = await service.getRouteById('abc123', 'anon123');

      expect(mockRouteRepo.findOne).toHaveBeenCalledWith({ where: { id: 'abc123' } });
      expect(result.route).toBe(mockRoute);
      expect(result.anonymousId).toBe('anon123');
    });
  });

  describe('getRouteByPublicUrl', () => {
    it('returns route when URL matches', async () => {
      const mockRoute: any = {
        id: 'abc123',
        publicToken: 'a1b2c3d4e5f6',
        title: 'Test Route',
        analytics: { views: 0, shares: 0, gpxDownloads: 0 },
        expiresAt: new Date(Date.now() + 1000000).toISOString(),
      };

      mockRouteRepo.findOne.mockResolvedValue(mockRoute);
      mockRouteRepo.save.mockResolvedValue(mockRoute);

      const result = await service.getRouteByPublicUrl(
        'https://share.example.test/route/abc123/a1b2c3d4e5f6',
        'anon123',
      );

      expect(result.route).toEqual(mockRoute);
      expect(result.anonymousId).toBe('anon123');
      expect(result.route.analytics?.views).toBe(1);
      expect(mockRouteRepo.save).toHaveBeenCalled();
    });

    it('returns null when URL format invalid', async () => {
      const result = await service.getRouteByPublicUrl('invalid-url');

      expect(result.route).toBeNull();
      expect(mockRouteRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns null when route not found', async () => {
      mockRouteRepo.findOne.mockResolvedValue(null);

      const result = await service.getRouteByPublicUrl(
        'https://share.example.test/route/notfound/token',
      );

      expect(result.route).toBeNull();
    });

    it('returns null when token mismatch', async () => {
      const mockRoute: any = {
        id: 'abc123',
        publicToken: 'correct-token',
      };

      mockRouteRepo.findOne.mockResolvedValue(mockRoute);

      const result = await service.getRouteByPublicUrl(
        'https://share.example.test/route/abc123/wrong-token',
      );

      expect(result.route).toBeNull();
    });

    it('returns null when route expired', async () => {
      const mockRoute: any = {
        id: 'abc123',
        publicToken: 'a1b2c3d4e5f6',
        expiresAt: new Date(Date.now() - 1000000).toISOString(),
      };

      mockRouteRepo.findOne.mockResolvedValue(mockRoute);
      mockRouteRepo.update.mockResolvedValue(undefined);

      const result = await service.getRouteByPublicUrl(
        'https://share.example.test/route/abc123/a1b2c3d4e5f6',
      );

      expect(result.route).toBeNull();
      expect(mockRouteRepo.update).toHaveBeenCalled();
    });
  });

  describe('getRouteStats', () => {
    it('returns statistics', async () => {
      const mockPopularRoutes = [
        { id: '1', title: 'Route 1', analytics: { views: 10, shares: 2, gpxDownloads: 1 } },
        { id: '2', title: 'Route 2', analytics: { views: 5, shares: 1, gpxDownloads: 0 } },
      ];

      mockRouteRepo.count.mockResolvedValueOnce(100);
      mockRouteRepo.count.mockResolvedValueOnce(80); // active routes
      mockRouteRepo.find.mockResolvedValue(mockPopularRoutes);

      const result = await service.getRouteStats();

      expect(result.totalRoutes).toBe(100);
      expect(result.activeRoutes).toBe(80);
      expect(result.expiredRoutes).toBe(20);
      expect(result.popularRoutes).toHaveLength(2);
      expect(result.popularRoutes[0].views).toBe(10);
    });

    it('handles zero routes', async () => {
      mockRouteRepo.count.mockResolvedValueOnce(0);
      mockRouteRepo.count.mockResolvedValueOnce(0);
      mockRouteRepo.find.mockResolvedValue([]);

      const result = await service.getRouteStats();

      expect(result.totalRoutes).toBe(0);
      expect(result.activeRoutes).toBe(0);
      expect(result.expiredRoutes).toBe(0);
      expect(result.popularRoutes).toHaveLength(0);
    });
  });

  describe('updateRoute', () => {
    it('updates route fields', async () => {
      const mockRoute: any = {
        id: 'abc123',
        title: 'Old Title',
        description: 'Old description',
        updatedAt: new Date(),
      };

      mockRouteRepo.findOne.mockResolvedValue(mockRoute);
      mockRouteRepo.save.mockResolvedValue(mockRoute);

      const result = await service.updateRoute('abc123', {
        title: 'New Title',
        description: 'New description',
      });

      expect(result?.title).toBe('New Title');
      expect(result?.description).toBe('New description');
      expect(mockRouteRepo.save).toHaveBeenCalled();
    });

    it('returns null when route not found', async () => {
      mockRouteRepo.findOne.mockResolvedValue(null);

      const result = await service.updateRoute('notfound', { title: 'Test' });

      expect(result).toBeNull();
    });

    it('updates only provided fields', async () => {
      const mockRoute: any = {
        id: 'abc123',
        title: 'Old Title',
        description: 'Old description',
      };

      mockRouteRepo.findOne.mockResolvedValue(mockRoute);
      mockRouteRepo.save.mockResolvedValue(mockRoute);

      await service.updateRoute('abc123', { title: 'New Title' });

      expect(mockRoute.title).toBe('New Title');
      expect(mockRoute.description).toBe('Old description'); // unchanged
    });
  });

  describe('deleteRoute', () => {
    it('deletes route and returns true', async () => {
      mockRouteRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteRoute('abc123');

      expect(result).toBe(true);
      expect(mockRouteRepo.delete).toHaveBeenCalledWith({ id: 'abc123' });
    });

    it('returns false when route not found', async () => {
      mockRouteRepo.delete.mockResolvedValue({ affected: 0 });

      const result = await service.deleteRoute('notfound');

      expect(result).toBe(false);
    });
  });
});