import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoutingService } from './routing.service';
import { BadRequestException } from '@nestjs/common';
import { GraphHopperClient, GraphHopperError } from './graphhopper.client';
import type { RouteResult } from './routing.types';

describe('RoutingService', () => {
  let service: RoutingService;
  let mockGhClient: any;
  let mockPoisService: any;

  beforeEach(() => {
    // Mock GraphHopper client
    mockGhClient = {
      route: vi.fn(),
      roundTrip: vi.fn(),
      health: vi.fn(),
      isochrone: vi.fn(),
      routeMulti: vi.fn(),
    };

    // Mock PoisService
    mockPoisService = {
      list: vi.fn(),
      listCoveredByPolygon: vi.fn(),
      findReturnLegCandidates: vi.fn(),
    };

    service = new RoutingService(mockGhClient, mockPoisService);
  });

  describe('Stage C return-leg scoring', () => {
    const path = (coordinates: number[][], time = 1000) => ({ points: { type: 'LineString', coordinates }, time, distance: 1000, ascend: 0, descend: 0, bbox: [49, 58, 50, 59] });
    it('prefers a POI-rich return inside the overlap gate', async () => {
      mockPoisService.findReturnLegCandidates.mockResolvedValue([{ id: 'rich', lat: 58.608, lon: 49.605, popularityScore: 5 }]);
      const result = await (service as any).scoreReturnShortlist([
        { path: path([[49.6, 58.6], [49.62, 58.6]]), index: 0, overlap: 0.2 },
        { path: path([[49.6, 58.6], [49.605, 58.61]]), index: 1, overlap: 0.21 },
      ], [{ lon: 49.6, lat: 58.6 }]);
      expect(result[1].richness).toBeGreaterThan(result[0].richness);
      expect(mockPoisService.findReturnLegCandidates).toHaveBeenCalledOnce();
    });
    it('selects the POI-rich return through the public loop plan path', async () => {
      const outbound = path([[49.6, 58.6], [49.61, 58.61]], 1_000);
      const plainReturn = path([[49.61, 58.61], [49.605, 58.6], [49.6, 58.6]], 1_000);
      const richReturn = path([[49.61, 58.61], [49.63, 58.61], [49.6, 58.6]], 1_200);
      mockGhClient.routeMulti
        .mockResolvedValueOnce([outbound])
        .mockResolvedValueOnce([plainReturn, richReturn]);
      mockPoisService.findReturnLegCandidates.mockResolvedValue([
        { id: 'return-poi', lat: 58.61, lon: 49.63, popularityScore: 5 },
      ]);
      vi.spyOn((service as any).loopQuality, 'overlap')
        .mockReturnValueOnce(0.10)
        .mockReturnValueOnce(0.11);

      const result = await service.plan({
        start: { lat: 58.6, lon: 49.6 },
        waypoints: [{ lat: 58.61, lon: 49.61 }],
        profile: 'bike',
        options: { loop: true },
      });

      expect(mockGhClient.routeMulti).toHaveBeenNthCalledWith(1,
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }], 'bike', expect.objectContaining({ flexible: true }));
      expect(mockGhClient.routeMulti).toHaveBeenNthCalledWith(2,
        [{ lat: 58.61, lon: 49.61 }, { lat: 58.6, lon: 49.6 }], 'bike', expect.objectContaining({ alternatives: true }));
      expect(mockPoisService.findReturnLegCandidates).toHaveBeenCalledOnce();
      expect(result.routes[0].geojson.geometry?.coordinates).toContainEqual([49.63, 58.61]);
      expect(result.routes[0].duration).toBe(2);
    });

    it('falls back when inbound abort is already signalled', async () => {
      const abort = new AbortController(); abort.abort();
      await expect((service as any).scoreReturnShortlist([{ path: path([[49.6, 58.6], [49.61, 58.61]]), index: 0, overlap: 0.2 }], [], abort.signal)).resolves.toBeNull();
      expect(mockPoisService.findReturnLegCandidates).not.toHaveBeenCalled();
    });
    it('measures a POI against a long segment and keeps later route portions', () => {
      expect((service as any).distanceToPolylineMeters({ lon: 49.5, lat: 58.605 }, [[49.5, 58.6], [49.5, 58.61]])).toBeLessThan(750);
      const simplified = (service as any).simplifyPolyline(Array.from({ length: 500 }, (_, i) => [49 + i / 10000, 58.6]), 250);
      expect(simplified.at(-1)).toEqual([49.0499, 58.6]);
    });
  });

  describe('pointToPoint', () => {
    it('returns normalized route result', async () => {
      const mockPath = {
        points: {
          type: 'LineString',
          coordinates: [[49.6, 58.6], [49.61, 58.61]],
        },
        distance: 1000,
        time: 360000, // 6 minutes in ms
        ascend: 10,
        descend: 5,
        bbox: [49.6, 58.6, 49.61, 58.61],
      };

      mockGhClient.route.mockResolvedValue(mockPath);

      const result = await service.pointToPoint({
        points: [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        profile: 'bike',
      });

      expect(result.geojson).toBeDefined();
      expect(result.distance).toBe(1000);
      expect(result.duration).toBe(360); // seconds
      expect(result.ascend).toBe(10);
      expect(result.descend).toBe(5);
    });

    it('adds compact road facts only when GraphHopper supplied valid evidence', async () => {
      mockGhClient.route.mockResolvedValue({
        points: {
          type: 'LineString',
          coordinates: [[49.6, 58.6], [49.61, 58.6], [49.62, 58.6]],
        },
        distance: 1200,
        time: 360000,
        ascend: 10,
        descend: 5,
        bbox: [49.6, 58.6, 49.62, 58.6],
        details: { surface: [[0, 2, 'asphalt']] },
      });

      const result = await service.pointToPoint({
        points: [{ lat: 58.6, lon: 49.6 }, { lat: 58.6, lon: 49.62 }],
        profile: 'bike',
      });

      expect(result.roadFacts).toEqual([{
        kind: 'surface',
        values: [{ value: 'asphalt', distance: expect.any(Number), share: 1 }],
      }]);
      expect(result.geojson.properties).not.toHaveProperty('roadFacts');
    });

    it('keeps the legacy route response free of an absent roadFacts field', async () => {
      mockGhClient.route.mockResolvedValue({
        points: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
        distance: 1000, time: 360000, ascend: 10, descend: 5,
        bbox: [49.6, 58.6, 49.61, 58.61],
      });

      const result = await service.pointToPoint({
        points: [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        profile: 'bike',
      });

      expect(result).not.toHaveProperty('roadFacts');
      expect(result).toMatchObject({ distance: 1000, duration: 360, profile: 'bike' });
    });

    it('throws BadRequestException for invalid profile', async () => {
      await expect(
        service.pointToPoint({
          points: [{ lat: 58.6, lon: 49.6 }],
          profile: 'invalid' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('wraps GraphHopper errors as BadRequestException', async () => {
      mockGhClient.route.mockRejectedValue(new GraphHopperError('Network failure', 503));

      await expect(
        service.pointToPoint({
          points: [{ lat: 58.6, lon: 49.6 }],
          profile: 'bike',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('roundTrip', () => {
    it('returns normalized round trip result', async () => {
      const mockPath = {
        points: {
          type: 'LineString',
          coordinates: [[49.6, 58.6], [49.61, 58.61], [49.6, 58.6]],
        },
        distance: 2000,
        time: 720000,
        ascend: 20,
        descend: 20,
        bbox: [49.6, 58.6, 49.61, 58.61],
      };

      mockGhClient.roundTrip.mockResolvedValue(mockPath);

      const result = await service.roundTrip({
        start: { lat: 58.6, lon: 49.6 },
        profile: 'bike',
        distance: 2000,
        seed: 42,
      });

      expect(result.geojson).toBeDefined();
      expect(result.distance).toBe(2000);
      expect(result.duration).toBe(720);
    });

    it('throws BadRequestException for invalid profile', async () => {
      await expect(
        service.roundTrip({
          start: { lat: 58.6, lon: 49.6 },
          profile: 'invalid' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('N variants: generates multiple round_trip loops and includes self-overlap score', async () => {
      // Two loops with the same start/end but different geometry.
      // For a true out-and-back, the self-overlap detection would catch the
      // repeated coordinates. Here we just verify the API plumbing works.
      const loopA = {
        points: {
          type: 'LineString',
          coordinates: [
            [49.6, 58.6], [49.61, 58.6], [49.62, 58.6], [49.63, 58.6],
            [49.62, 58.6], [49.61, 58.6], [49.6, 58.6],
          ],
        },
        distance: 4000, time: 900000, ascend: 10, descend: 10,
        bbox: [49.6, 58.6, 49.63, 58.6],
      };
      const loopB = {
        points: {
          type: 'LineString',
          coordinates: [
            [49.6, 58.6], [49.62, 58.62], [49.6, 58.64], [49.58, 58.62],
            [49.6, 58.6], [49.605, 58.605], [49.6, 58.6],
          ],
        },
        distance: 4500, time: 1000000, ascend: 30, descend: 30,
        bbox: [49.58, 58.6, 49.62, 58.64],
      };

      mockGhClient.roundTrip
        .mockResolvedValueOnce(loopA)
        .mockResolvedValueOnce(loopB);

      const result = await service.roundTrip({
        start: { lat: 58.6, lon: 49.6 },
        profile: 'bike',
        distance: 4000,
        variants: 2,
      });

      // Verify the API returns a result with self-overlap scoring
      expect(result.distance).toBeDefined();
      expect(result.selfOverlap).toBeDefined();
      expect(result.selfOverlap).toBeGreaterThanOrEqual(0);
      expect(result.selfOverlap).toBeLessThanOrEqual(1);
    });

    it('N variants: throws if all variants fail', async () => {
      mockGhClient.roundTrip.mockRejectedValue(new Error('off graph'));

      await expect(
        service.roundTrip({
          start: { lat: 58.6, lon: 49.6 },
          profile: 'bike',
          distance: 4000,
          variants: 3,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('health', () => {
    it('returns the GraphHopper health payload unchanged', async () => {
      const mockHealth = { available: true, profiles: ['bike'], url: 'http://graphhopper' };
      mockGhClient.health.mockResolvedValue(mockHealth);

      await expect(service.health()).resolves.toEqual(mockHealth);
    });
  });

  describe('isochrone', () => {
    it('returns bounding box and geojson', async () => {
      const mockIso = {
        bbox: [49.5, 58.5, 49.7, 58.7],
        geojson: {
          type: 'Polygon',
          coordinates: [[[49.5, 58.5], [49.7, 58.5], [49.7, 58.7], [49.5, 58.7], [49.5, 58.5]]],
        },
      };

      mockGhClient.isochrone.mockResolvedValue(mockIso);

      const result = await service.isochrone({ lat: 58.6, lon: 49.6 }, 'bike', 15);

      expect(result.bbox).toEqual([49.5, 58.5, 49.7, 58.7]);
      expect(result.geojson).toBeDefined();
    });
  });

  describe('plan', () => {
    const path = (coordinates: number[][], seconds: number) => ({
      points: { type: 'LineString', coordinates },
      distance: seconds * 4,
      time: seconds * 1000,
      ascend: 0,
      descend: 0,
      bbox: [Math.min(...coordinates.map(p => p[0])), Math.min(...coordinates.map(p => p[1])), Math.max(...coordinates.map(p => p[0])), Math.max(...coordinates.map(p => p[1]))],
    });

    it('one-POI loop chooses a lower-overlap alternative return', async () => {
      const outbound = path([[0, 0], [0.01, 0]], 300);
      const direct = path([[0.01, 0], [0, 0]], 300);
      const alternative = path([[0.01, 0], [0.01, 0.01], [0, 0]], 360);
      mockGhClient.routeMulti.mockResolvedValueOnce([outbound]).mockResolvedValueOnce([direct, alternative]);
      const result = await service.plan({ start: { lon: 0, lat: 0 }, waypoints: [{ lon: 0.01, lat: 0 }], profile: 'bike', options: { loop: true } });
      expect(result.routes[0].geojson.geometry?.coordinates).toContainEqual([0.01, 0.01]);
      expect(result.optimize).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it('one-POI out-and-back fallback emits a warning', async () => {
      const outbound = path([[0, 0], [0.01, 0]], 300);
      const direct = path([[0.01, 0], [0, 0]], 300);
      mockGhClient.routeMulti.mockResolvedValueOnce([outbound]).mockResolvedValueOnce([direct]);
      const result = await service.plan({ start: { lon: 0, lat: 0 }, waypoints: [{ lon: 0.01, lat: 0 }], profile: 'bike', options: { loop: true } });
      expect(result.warnings).toContain('UNAVOIDABLE_OUT_AND_BACK');
    });

    it('returns planned route without optimization', async () => {
      const mockPath = {
        points: {
          type: 'LineString',
          coordinates: [[49.6, 58.6], [49.61, 58.61], [49.62, 58.62]],
        },
        distance: 1500,
        time: 540000,
        ascend: 15,
        descend: 10,
        bbox: [49.6, 58.6, 49.62, 58.62],
      };

      mockGhClient.routeMulti.mockResolvedValue([mockPath]);

      const result = await service.plan({
        start: { lat: 58.6, lon: 49.6 },
        waypoints: [
          { lat: 58.61, lon: 49.61 },
          { lat: 58.62, lon: 49.62 },
        ],
        profile: 'bike',
        options: { optimize: false, loop: false },
      });

      expect(result.routes).toHaveLength(1);
      expect(result.optimize).toBe(false);
      expect(result.loop).toBe(false);
    });

    it('throws BadRequestException for invalid profile', async () => {
      await expect(
        service.plan({
          start: { lat: 58.6, lon: 49.6 },
          waypoints: [{ lat: 58.61, lon: 49.61 }],
          profile: 'invalid' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('haversine calculation', () => {
    it('calculates distance between two points', () => {
      const distance = service['haversine'](58.6, 49.6, 58.601, 49.601);

      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(200); // ~100m per 0.001 degree
    });
  });

  describe('getSpeedMs', () => {
    it('returns correct speeds for each profile', () => {
      expect(service['getSpeedMs']('foot')).toBe(1.4); // ~5 km/h
      expect(service['getSpeedMs']('bike')).toBe(4.2); // ~15 km/h
      expect(service['getSpeedMs']('mtb')).toBe(3.3); // ~12 km/h
      expect(service['getSpeedMs']('car')).toBe(11.1); // ~40 km/h
    });
  });

  describe('extractRoutePoints', () => {
    it('extracts lat/lon pairs from GeoJSON LineString', () => {
      const geojson = {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [50.18, 58.73],
            [50.19, 58.72],
            [50.20, 58.71],
          ],
        },
        properties: {},
      };
      const pts = service['extractRoutePoints'](geojson);
      expect(pts.length).toBe(3);
      expect(pts[0]).toEqual({ lat: 58.73, lon: 50.18 });
      expect(pts[2]).toEqual({ lat: 58.71, lon: 50.20 });
    });

    it('returns [] for missing coordinates', () => {
      expect(service['extractRoutePoints']({})).toEqual([]);
      expect(service['extractRoutePoints']({ geometry: {} })).toEqual([]);
    });
  });

  describe('computeInsertionDetour', () => {
    it('returns ~0 detour for a point ON the route segment', () => {
      // Route: A(58.73, 50.18) → B(58.72, 50.19) — ~1.3 km segment
      const route = [
        { lat: 58.73, lon: 50.18 },
        { lat: 58.72, lon: 50.19 },
      ];
      // Point mid-way on the segment
      const mid = { lat: 58.725, lon: 50.185 };
      const { detourM } = service['computeInsertionDetour'](mid, route);
      expect(detourM).toBeLessThan(50); // essentially on the route
    });

    it('returns positive detour for a point OFF the route', () => {
      const route = [
        { lat: 58.73, lon: 50.18 },
        { lat: 58.72, lon: 50.19 },
      ];
      // Point ~500m east of the route
      const off = { lat: 58.725, lon: 50.195 };
      const { detourM } = service['computeInsertionDetour'](off, route);
      expect(detourM).toBeGreaterThan(300); // significant detour
    });

    it('returns 0 for degenerate route (< 2 points)', () => {
      const result = service['computeInsertionDetour'](
        { lat: 58.73, lon: 50.18 },
        [{ lat: 58.73, lon: 50.18 }],
      );
      expect(result.detourM).toBe(0);
    });

    it('finds the best segment among multiple', () => {
      // L-shaped route
      const route = [
        { lat: 58.73, lon: 50.18 },
        { lat: 58.72, lon: 50.18 }, // vertical segment
        { lat: 58.72, lon: 50.19 }, // horizontal segment
      ];
      // Point near the horizontal segment
      const pt = { lat: 58.7201, lon: 50.189 };
      const { detourM, insertAfterIdx } = service['computeInsertionDetour'](pt, route);
      expect(detourM).toBeLessThan(200);
      expect(insertAfterIdx).toBe(1); // best insertion is after the corner
    });
  });

  describe('plan() enrichment (scenario B: user picks → system suggests)', () => {
    it('suggests nearby POIs that fit in the remaining budget', async () => {
      // Route: start (58.7332, 50.1854) → Bakulev (58.6979, 50.1886) → start
      // This is a ~8 km loop, ~35 min by bike
      const routeCoords = [
        [50.1854, 58.7332], // start
        [50.1870, 58.7100], // mid
        [50.1886, 58.6979], // Bakulev
        [50.1900, 58.7100], // return mid
        [50.1854, 58.7332], // back to start
      ];
      mockGhClient.routeMulti.mockResolvedValue([{
        points: { type: 'LineString', coordinates: routeCoords },
        distance: 8000,
        time: 35 * 60 * 1000, // 35 min in ms
        ascend: 50, descend: 50,
        bbox: [50.185, 58.697, 50.190, 58.734],
      }]);

      // Mock POIs near the route: Lake Kurya (nature) + a church (religion)
      mockPoisService.list.mockResolvedValue({
        items: [
          { id: 'kurya', name: 'Озеро Курья', category: 'nature', lat: 58.6865, lon: 50.1980, popularityScore: 0.5 },
          { id: 'church', name: 'Екатерининская церковь', category: 'religion', lat: 58.7210, lon: 50.1850, popularityScore: 2.3 },
          { id: 'bakulev', name: 'Музей Бакулева', category: 'museum', lat: 58.6979, lon: 50.1886, popularityScore: 3.1 },
        ],
      });

      const result = await service.plan({
        start: { lat: 58.7332, lon: 50.1854 },
        waypoints: [{ lat: 58.6979, lon: 50.1886 }], // user picked Bakulev
        profile: 'bike',
        options: {
          loop: true,
          timeBudgetMinutes: 90,
          enrichWithPois: true,
          enrichCategories: 'nature,religion',
        },
      });

      expect(result.routes).toBeDefined();
      expect(result.routes[0].duration).toBeLessThan(90 * 60); // fits in budget
      expect(result.suggestedPois).toBeDefined();
      expect(result.suggestedPois!.length).toBeGreaterThan(0);
      // Bakulev should be excluded (it's a user waypoint)
      expect(result.suggestedPois!.find(p => p.id === 'bakulev')).toBeUndefined();
      // Each suggestion has detourMinutes
      for (const p of result.suggestedPois!) {
        expect(p.detourMinutes).toBeGreaterThan(0);
        expect(p.detourMinutes).toBeLessThan(60);
      }
    });

    it('does NOT suggest POIs when enrichWithPois is false', async () => {
      mockGhClient.routeMulti.mockResolvedValue([{
        points: { type: 'LineString', coordinates: [[50.18, 58.73], [50.19, 58.72]] },
        distance: 2000, time: 10 * 60 * 1000, ascend: 0, descend: 0,
        bbox: [50.18, 58.72, 50.19, 58.73],
      }]);

      const result = await service.plan({
        start: { lat: 58.73, lon: 50.18 },
        waypoints: [{ lat: 58.72, lon: 50.19 }],
        profile: 'bike',
        options: { loop: false },
      });

      expect(result.suggestedPois).toBeUndefined();
    });
  });
});