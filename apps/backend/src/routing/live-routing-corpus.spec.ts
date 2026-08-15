import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_ROUTING_CORPUS,
  evaluateRouteInvariants,
  formatLiveRoutingCorpusSummary,
  isValidIsochronePolygon,
  loadLiveRoutingCorpus,
  parseLiveRoutingCorpus,
  summarizeLiveRoutingCorpus,
} from './live-routing-corpus';
import { ROUTING_PROFILES } from './routing.types';

describe('live routing corpus support', () => {
  const corpus = parseLiveRoutingCorpus({
    version: 1,
    name: 'unit-corpus',
    points: { start: { lon: 1, lat: 2 }, finish: { lon: 1.01, lat: 2.01 } },
    scenarios: [{
      id: 'leg', kind: 'point-to-point', profiles: ['bike'], start: 'start', finish: 'finish',
      expect: {
        networkConfirmed: true, minDistanceMeters: 10, maxDistanceMeters: 5000,
        maxDurationSeconds: 600, maxLatencyMs: 100, roadFacts: { configuredOnly: true },
      },
    }, {
      id: 'loop', kind: 'round-trip', profiles: ['bike'], start: 'start', distanceMeters: 1000, seed: 1,
      expect: {
        networkConfirmed: true, minDistanceMeters: 10, maxDistanceMeters: 5000,
        maxDurationSeconds: 600, maxLatencyMs: 100, maxClosureGapMeters: 30, overlapClass: 'clean',
      },
    }, {
      id: 'area', kind: 'isochrone', profiles: ['bike'], point: 'start', timeLimitMinutes: 15,
      expect: { networkConfirmed: true, maxLatencyMs: 100 },
    }],
  });

  it('parses named points and each supported direct-engine scenario', () => {
    expect(corpus.scenarios.map((scenario) => scenario.kind)).toEqual(['point-to-point', 'round-trip', 'isochrone']);
    expect(corpus.points.start).toEqual({ lon: 1, lat: 2 });
  });

  it('uses the checked-in PFO corpus by default and directly covers every product profile', () => {
    const defaultCorpus = loadLiveRoutingCorpus(DEFAULT_LIVE_ROUTING_CORPUS);
    const directlyTestedProfiles = new Set(defaultCorpus.scenarios
      .filter((scenario) => scenario.kind === 'point-to-point')
      .flatMap((scenario) => scenario.profiles));

    expect(defaultCorpus.name).toBe('pfo-kirov-dev-graph');
    expect([...ROUTING_PROFILES].every((profile) => directlyTestedProfiles.has(profile))).toBe(true);
  });

  it('rejects an unknown point instead of allowing a hidden coordinate fallback', () => {
    expect(() => parseLiveRoutingCorpus({
      version: 1, name: 'bad', points: { start: { lon: 0, lat: 0 } },
      scenarios: [{ id: 'bad-leg', kind: 'point-to-point', profiles: ['bike'], start: 'start', finish: 'missing', expect: { networkConfirmed: true, maxLatencyMs: 1 } }],
    })).toThrow('references unknown point "missing"');
  });

  it('evaluates stable route and configured-road-fact invariants', () => {
    const scenario = corpus.scenarios[0];
    if (scenario.kind !== 'point-to-point') throw new Error('unexpected scenario');
    const valid = evaluateRouteInvariants(scenario.expect, {
      networkConfirmed: true, distance: 1000, duration: 120, latencyMs: 80,
      geometry: { type: 'LineString', coordinates: [[1, 2], [1.01, 2.01]] },
      configuredDetailKinds: ['surface'], roadFactKinds: ['surface'],
    });
    const invalid = evaluateRouteInvariants(scenario.expect, {
      networkConfirmed: false, distance: Infinity, duration: 700, latencyMs: 101,
      geometry: { type: 'LineString', coordinates: [[1, 2]] },
      configuredDetailKinds: [], roadFactKinds: ['surface'],
    });
    expect(valid).toEqual([]);
    expect(invalid).toEqual(expect.arrayContaining([
      'route was not confirmed by GraphHopper',
      'route geometry is not a valid LineString',
      'route distance is not finite and positive',
      'road fact "surface" was returned without configuration',
    ]));
  });

  it('reports setup failures rather than a success-looking zero-failure summary', () => {
    const summary = summarizeLiveRoutingCorpus('broken-corpus', [], [{
      scenario: 'setup', profile: '', kind: 'setup', status: 'setup-failed', reason: 'loopback guard rejected URL',
    }]);

    expect(summary.counts).toEqual({ passed: 0, 'skipped-profile': 0, failed: 0, 'setup-failed': 1 });
    expect(formatLiveRoutingCorpusSummary(summary)).toContain('1 setup failed');
  });

  it('checks loop closure and overlap class without relying on exact geometry', () => {
    const scenario = corpus.scenarios[1];
    if (scenario.kind !== 'round-trip') throw new Error('unexpected scenario');
    expect(evaluateRouteInvariants(scenario.expect, {
      networkConfirmed: true, distance: 1000, duration: 120, latencyMs: 10,
      geometry: { type: 'LineString', coordinates: [[1, 2], [1.01, 2.01], [1, 2]] },
      closureGapMeters: 40, overlapClass: 'out-and-back',
    })).toEqual(expect.arrayContaining([
      'closure gap 40m exceeds 30m',
      'overlap class is "out-and-back", expected "clean"',
    ]));
  });

  it('validates non-degenerate closed isochrone polygons', () => {
    expect(isValidIsochronePolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toBe(true);
    expect(isValidIsochronePolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 0], [0, 0]]] })).toBe(false);
  });
});
