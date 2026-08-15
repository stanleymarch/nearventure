import { describe, expect, it } from 'vitest';
import { LoopQualityService } from '../routing/loop-quality.service';
import type { RouteResult } from '../routing/routing.types';
import { ItineraryQualityGateService } from './itinerary-quality-gate.service';

const gate = new ItineraryQualityGateService(new LoopQualityService());
const totals = { feasible: true };
const route = (coordinates: number[][]): RouteResult => ({
  distance: 1_000,
  duration: 600,
  ascend: 0,
  descend: 0,
  profile: 'foot',
  bbox: [0, 0, 1, 1],
  geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { distance: 1_000, duration: 600, ascend: 0, descend: 0, profile: 'foot' } },
});
const places: any[] = [
  { id: 'cluster', clusterConfidence: 'walkable', pois: [{ id: 'a', included: true }, { id: 'hidden', included: false }] },
  { id: 'manual', clusterConfidence: 'manual', pois: [{ id: 'b', included: true }] },
];

describe('ItineraryQualityGateService', () => {
  it('confirms a feasible, network-confirmed clean loop and reports available stop metrics', () => {
    const quality = gate.assess({
      route: route([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]),
      totals,
      requestedLoop: true,
      places,
      networkConfirmed: true,
    });

    expect(quality).toMatchObject({ version: 'graphhopper-quality-core-v1', verdict: 'confirmed', feasible: true, networkConfirmed: true, warnings: [] });
    expect(quality.metrics).toMatchObject({ requestedLoop: true, routeAvailable: true, stopCount: 2, uniquePoiCount: 2, clusteredStopCount: 1 });
    expect(quality.metrics.repeatedRoadRatio).toBeLessThan(0.1);
  });

  it('marks a network-confirmed loop with unavoidable repeated roads as degraded', () => {
    const quality = gate.assess({
      route: route([[0, 0], [0.01, 0], [0.02, 0], [0.03, 0], [0.02, 0], [0.01, 0], [0, 0]]),
      totals,
      requestedLoop: true,
      places: [],
      networkConfirmed: true,
    });

    expect(quality.verdict).toBe('degraded');
    expect(quality.warnings).toEqual(['UNAVOIDABLE_OUT_AND_BACK']);
    expect(quality.metrics.outAndBackRatio).toBeGreaterThan(0.7);
  });

  it('does not call a linear result a failed loop', () => {
    const quality = gate.assess({
      route: route([[0, 0], [0.01, 0]]),
      totals,
      requestedLoop: false,
      places: [],
      networkConfirmed: true,
    });

    expect(quality.verdict).toBe('confirmed');
    expect(quality.metrics.requestedLoop).toBe(false);
    expect(quality.warnings).not.toContain('LOOP_NOT_CLOSED');
  });

  it('makes network-unconfirmed fallback input explicit without inventing route evidence', () => {
    const quality = gate.assess({
      route: route([[0, 0], [0.01, 0], [0, 0]]),
      totals,
      requestedLoop: true,
      places: [],
      networkConfirmed: false,
    });

    expect(quality).toMatchObject({ verdict: 'unconfirmed', networkConfirmed: false });
    expect(quality.warnings).toContain('ROUTE_NOT_NETWORK_CONFIRMED');
  });
});
