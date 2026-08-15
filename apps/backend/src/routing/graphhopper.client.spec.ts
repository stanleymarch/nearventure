import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphHopperClient, GraphHopperError } from './graphhopper.client';

describe('GraphHopperClient', () => {
  const originalFetch = global.fetch;
  let client: GraphHopperClient;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    client = new GraphHopperClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GRAPHHOPPER_URL;
    delete process.env.GRAPHHOPPER_PATH_DETAILS;
  });

  // ── POST URL helper ─────────────────────────────────────────
  function expectPost(url: string, bodyMatcher?: (body: any) => void) {
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    if (bodyMatcher) {
      const callArgs = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(callArgs[1].body);
      bodyMatcher(sentBody);
    }
  }

  // ── Shared mock path ────────────────────────────────────────
  const mockPath = {
    points: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61]] },
    distance: 1000,
    time: 360000,
    ascend: 10,
    descend: 5,
    bbox: [49.6, 58.6, 49.61, 58.61],
  };

  // ═════════════════════════════════════════════════════════════
  //  route()
  // ═════════════════════════════════════════════════════════════
  describe('route', () => {
    it('returns route result for valid request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ paths: [mockPath] }),
      });

      const result = await client.route(
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        'bike',
      );

      expect(result.points).toBeDefined();
      expect(result.distance).toBe(1000);
      expect(result.time).toBe(360000);
      expectPost('http://localhost:8989/route', (body) => {
        expect(body.points).toEqual([[49.6, 58.6], [49.61, 58.61]]);
        expect(body.profile).toBe('bike');
        expect(body.elevation).toBe(true);
        expect(body.points_encoded).toBe(false);
        // Unset keeps the existing fast request unchanged.
        expect(body.details).toBeUndefined();
        // bike has no CH preparation on our GraphHopper (only car does) →
        // ch.disable must be sent or GH rejects the profile.
        expect(body['ch.disable']).toBe(true);
      });
    });

    it('requests configured details and retains only structurally valid returned facts', async () => {
      process.env.GRAPHHOPPER_PATH_DETAILS = 'road_class,surface';
      client = new GraphHopperClient();
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          paths: [{
            ...mockPath,
            details: {
              road_class: [[0, 1, 'residential']],
              surface: [[0, 1, 'asphalt']],
              track_type: [[0, 1, 'grade1']],
            },
          }],
        }),
      });

      const result = await client.route(
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        'bike',
      );

      expect(result.details).toEqual({
        road_class: [[0, 1, 'residential']],
        surface: [[0, 1, 'asphalt']],
      });
      expectPost('http://localhost:8989/route', (body) => {
        expect(body.details).toEqual(['road_class', 'surface']);
      });
    });

    it('keeps routing successful when configured details are absent or malformed', async () => {
      process.env.GRAPHHOPPER_PATH_DETAILS = 'surface';
      client = new GraphHopperClient();
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          paths: [{ ...mockPath, details: { surface: [[0, 'bad', 'asphalt']] } }],
        }),
      });

      const result = await client.route(
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        'bike',
      );

      expect(result.distance).toBe(1000);
      expect(result.details).toBeUndefined();
    });

    it('ignores unknown detail configuration values', async () => {
      process.env.GRAPHHOPPER_PATH_DETAILS = 'surface,not_a_gh_detail';
      client = new GraphHopperClient();
      mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ paths: [mockPath] }) });

      await client.route([{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }], 'bike');

      expectPost('http://localhost:8989/route', (body) => {
        expect(body.details).toEqual(['surface']);
      });
    });

    it.each([
      ['missing geometry', { ...mockPath, points: undefined }],
      ['single coordinate', { ...mockPath, points: { type: 'LineString', coordinates: [[49.6, 58.6]] } }],
      ['invalid coordinate', { ...mockPath, points: { type: 'LineString', coordinates: [[49.6, 58.6], ['bad', 58.61]] } }],
    ])('rejects a 200 response with %s', async (_label, path) => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ paths: [path] }),
      });

      await expect(
        client.route([{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }], 'bike'),
      ).rejects.toThrow('invalid route geometry');
    });

    it('throws GraphHopperError on HTTP error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ message: 'Invalid request' }),
      });

      await expect(
        client.route([{ lat: 58.6, lon: 49.6 }], 'bike'),
      ).rejects.toThrow(GraphHopperError);
    });

    it('propagates network failure as original Error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        client.route([{ lat: 58.6, lon: 49.6 }], 'bike'),
      ).rejects.toThrow('Network error');
    });

    it('handles multiple points', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          paths: [{
            ...mockPath,
            points: { type: 'LineString', coordinates: [[49.6, 58.6], [49.61, 58.61], [49.62, 58.62]] },
            distance: 2000,
          }],
        }),
      });

      await client.route(
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }, { lat: 58.62, lon: 49.62 }],
        'bike',
      );

      expectPost('http://localhost:8989/route', (body) => {
        expect(body.points).toHaveLength(3);
        expect(body.points[2]).toEqual([49.62, 58.62]);
      });
    });
  });

  // ═════════════════════════════════════════════════════════════
  //  roundTrip()
  // ═════════════════════════════════════════════════════════════
  describe('roundTrip', () => {
    it('returns round trip route', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ paths: [mockPath] }),
      });

      const result = await client.roundTrip(
        { lat: 58.6, lon: 49.6 },
        'bike',
        2000,
        42,
      );

      expect(result.points).toBeDefined();
      expect(result.distance).toBe(1000);
      expectPost('http://localhost:8989/route', (body) => {
        expect(body.algorithm).toBe('round_trip');
        expect(body['round_trip.distance']).toBe(2000);
        expect(body['round_trip.seed']).toBe(42);
        expect(body.points).toEqual([[49.6, 58.6]]);
        expect(body.profile).toBe('bike');
      });
    });

    it('rejects a partial round-trip response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ paths: [{ ...mockPath, points: { type: 'LineString', coordinates: [] } }] }),
      });

      await expect(
        client.roundTrip({ lat: 58.6, lon: 49.6 }, 'bike', 2000, 42),
      ).rejects.toThrow('invalid route geometry');
    });

    it('throws GraphHopperError on error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'Server error' }),
      });

      await expect(
        client.roundTrip({ lat: 58.6, lon: 49.6 }, 'bike', 2000, 42),
      ).rejects.toThrow(GraphHopperError);
    });
  });

  // ═════════════════════════════════════════════════════════════
  //  isochrone()  —  HTTP GET
  // ═════════════════════════════════════════════════════════════
  describe('isochrone', () => {
    const mockPolygon = {
      type: 'Polygon',
      coordinates: [[
        [49.5, 58.5],
        [49.7, 58.5],
        [49.7, 58.7],
        [49.5, 58.7],
        [49.5, 58.5],
      ]],
      bbox: [49.5, 58.5, 49.7, 58.7],
    };

    it('returns isochrone polygon and bbox', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ polygons: [{ geometry: mockPolygon }] }),
      });

      const result = await client.isochrone({ lat: 58.6, lon: 49.6 }, 'bike', 15);

      expect(result.geojson).toBeDefined();
      expect(result.geojson.type).toBe('Polygon');
      expect(result.bbox).toEqual([49.5, 58.5, 49.7, 58.7]);

      // isochrone uses GET with query params (not POST)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/isochrone?point=58.6%2C49.6&profile=bike&time_limit='),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('converts minutes to seconds with conservatism factor', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ polygons: [{ geometry: mockPolygon }] }),
      });

      await client.isochrone({ lat: 58.6, lon: 49.6 }, 'foot', 30);

      // foot factor=0.75 → 30*60*0.75 = 1350
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('time_limit=1350'),
        expect.any(Object),
      );
    });

    it.each([
      ['bike_touring', 1170],
      ['mtb_leisure', 1080],
      ['foot_scenic', 1350],
    ] as const)('uses the base-family isochrone factor for %s', async (profile, expectedSeconds) => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ polygons: [{ geometry: mockPolygon }] }),
      });

      await client.isochrone({ lat: 58.6, lon: 49.6 }, profile, 30);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`time_limit=${expectedSeconds}`),
        expect.any(Object),
      );
    });

    it('returns approximate=false for a real GraphHopper polygon', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ polygons: [{ geometry: mockPolygon }] }),
      });
      const result = await client.isochrone({ lat: 58.6, lon: 49.6 }, 'bike', 15);
      expect(result.approximate).toBe(false);
    });

    it('returns approximate=true with circle fallback for an empty polygon', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ polygons: [] }),
      });
      const result = await client.isochrone({ lat: 58.6, lon: 49.6 }, 'bike', 30);
      expect(result.approximate).toBe(true);
      expect(result.geojson).toBeDefined();
      expect(result.bbox).toBeDefined();
    });
  });

  // ═════════════════════════════════════════════════════════════
  //  health()  —  HTTP GET /info
  // ═════════════════════════════════════════════════════════════
  describe('health', () => {
    it('returns available=true with profiles when healthy (no internal details)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          version: '3.0.0',
          bbox: [49.6, 58.6, 49.61, 58.61],
          profiles: [{ name: 'bike' }, { name: 'foot' }],
        }),
      });

      const result = await client.health();

      expect(result.available).toBe(true);
      expect(result.profiles).toEqual(['bike', 'foot']);
      // Internal details (version, bbox, base URL) must not be exposed publicly.
      expect(result).not.toHaveProperty('graphhopperVersion');
      expect(result).not.toHaveProperty('bbox');
      expect(result).not.toHaveProperty('url');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8989/info',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('reports only profile names advertised by the live /info response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          profiles: [{ name: 'custom_bike' }, { name: 'car' }, { name: 'custom_bike' }, {}, 'foot'],
        }),
      });

      const result = await client.health();

      expect(result.available).toBe(true);
      expect(result.profiles).toEqual(['custom_bike', 'car']);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8989/info');
    });

    it('returns available=false on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await client.health();

      expect(result.available).toBe(false);
      expect(result.profiles).toEqual([]);
    });

    it('returns available=false on network failure (does NOT throw)', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.health();

      expect(result.available).toBe(false);
      expect(result.profiles).toEqual([]);
    });
  });

  // ═════════════════════════════════════════════════════════════
  //  routeMulti()
  // ═════════════════════════════════════════════════════════════
  describe('routeMulti', () => {
    const mockPaths = [
      { ...mockPath },
      { ...mockPath, distance: 1200, time: 400000 },
    ];

    it('returns multiple route variants', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ paths: mockPaths }),
      });

      const result = await client.routeMulti(
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        'bike',
        { alternatives: true, maxAlternatives: 3 },
      );

      expect(result).toHaveLength(2);
      expect(result[0].distance).toBe(1000);
      expect(result[1].distance).toBe(1200);
      expectPost('http://localhost:8989/route', (body) => {
        expect(body.algorithm).toBe('alternative_route');
        expect(body['alternative_route.max_paths']).toBe(3);
        expect(body['alternative_route.max_share_factor']).toBe(0.5);
      });
    });

    it('bike: disables CH (no CH preparation for bike, only car)', async () => {
      const singlePath = [{ ...mockPath }];
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ paths: singlePath }),
      });

      await client.routeMulti(
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        'bike',
        { alternatives: false },
      );

      expectPost('http://localhost:8989/route', (body) => {
        expect(body.algorithm).toBeUndefined();
        expect(body['ch.disable']).toBe(true);
      });
    });

    it('car: keeps CH for the fast point-to-point path', async () => {
      const singlePath = [{ ...mockPath }];
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ paths: singlePath }),
      });

      await client.routeMulti(
        [{ lat: 58.6, lon: 49.6 }, { lat: 58.61, lon: 49.61 }],
        'car',
        { alternatives: false },
      );

      expectPost('http://localhost:8989/route', (body) => {
        expect(body['ch.disable']).toBeUndefined();
      });
    });
  });

  // ═════════════════════════════════════════════════════════════
  //  error handling
  // ═════════════════════════════════════════════════════════════
  describe('error handling', () => {
    it('includes status code in GraphHopperError message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({}),
      });

      const err = await client
        .route([{ lat: 58.6, lon: 49.6 }], 'bike')
        .catch((e) => e);

      expect(err).toBeInstanceOf(GraphHopperError);
      expect(err.message).toContain('404');
    });

    it('includes custom message from response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ message: 'Invalid point' }),
      });

      await expect(
        client.route([{ lat: 58.6, lon: 49.6 }], 'bike'),
      ).rejects.toThrow('Invalid point');
    });
  });
});
