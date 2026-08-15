import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphHopperClient } from './graphhopper.client';
import { LoopQualityService } from './loop-quality.service';
import {
  evaluateRouteInvariants,
  formatLiveRoutingCorpusSummary,
  isValidIsochronePolygon,
  loadLiveRoutingCorpus,
  summarizeLiveRoutingCorpus,
  type LiveCorpusResult,
  type LiveRoutingCorpus,
  type LiveRoutingScenario,
} from './live-routing-corpus';
import { parseConfiguredPathDetails } from './road-facts';
import { RoutingService } from './routing.service';
import type { RoutingHealth, RoutingProfile } from './routing.types';

const enabled = process.env.GRAPHHOPPER_LIVE === '1';
let corpus: LiveRoutingCorpus | undefined;
let corpusLoadError: Error | undefined;
if (enabled) {
  try {
    corpus = loadLiveRoutingCorpus();
  } catch (error) {
    corpusLoadError = asError(error);
  }
}

/** Explicit opt-in direct-client audit; it has no database or itinerary dependency. */
if (enabled) {
  describe('live GraphHopper routing corpus', () => {
    const results: LiveCorpusResult[] = [];
    const routing = new RoutingService(new GraphHopperClient());
    const loopQuality = new LoopQualityService();
    const configuredDetails = parseConfiguredPathDetails(process.env.GRAPHHOPPER_PATH_DETAILS).details;
    let health: RoutingHealth | undefined;

    beforeAll(async () => {
      try {
        if (corpusLoadError) throw corpusLoadError;
        assertLoopbackGraphHopperUrl(process.env.GRAPHHOPPER_URL);
        health = await routing.health();
        if (!health.available) throw new Error('Live routing corpus requires a reachable local GraphHopper /info endpoint.');
      } catch (error) {
        results.push({ scenario: 'setup', profile: '', kind: 'setup', status: 'setup-failed', reason: asError(error).message });
        throw error;
      }
    });

    if (!corpus) {
      it('loads the configured corpus', () => {
        throw corpusLoadError ?? new Error('Live routing corpus was not loaded.');
      });
    }

    for (const scenario of corpus?.scenarios ?? []) for (const profile of scenario.profiles) {
      it(`${scenario.id} [${profile}]`, async ({ skip }) => {
        if (!health!.profiles.includes(profile)) {
          results.push({ scenario: scenario.id, profile, kind: scenario.kind, status: 'skipped-profile', reason: 'not advertised by /info' });
          skip(`Profile "${profile}" is not advertised by GraphHopper /info.`);
        }
        const startedAt = Date.now();
        let recorded = false;
        try {
          if (scenario.kind === 'point-to-point') {
            const route = await routing.pointToPoint({ profile: profile as RoutingProfile, points: [corpus!.points[scenario.start], corpus!.points[scenario.finish]] });
            const latencyMs = Date.now() - startedAt;
            const failures = evaluateRouteInvariants(scenario.expect, {
              networkConfirmed: true, distance: route.distance, duration: route.duration,
              geometry: route.geojson.geometry, latencyMs,
              roadFactKinds: route.roadFacts?.map((fact) => fact.kind), configuredDetailKinds: configuredDetails,
            });
            record(results, scenario, profile, failures, { latencyMs, distanceMeters: route.distance, durationSeconds: route.duration });
            recorded = true;
            expect(failures, `${scenario.id} (${profile})`).toEqual([]);
            return;
          }
          if (scenario.kind === 'round-trip') {
            const route = await routing.roundTrip({ profile: profile as RoutingProfile, start: corpus!.points[scenario.start], distance: scenario.distanceMeters, seed: scenario.seed });
            const latencyMs = Date.now() - startedAt;
            const quality = loopQuality.assess(route.geojson.geometry!.coordinates);
            const overlapClass = quality.repeatedRoadRatio >= 0.6 ? 'out-and-back' : 'clean';
            const failures = evaluateRouteInvariants(scenario.expect, {
              networkConfirmed: true, distance: route.distance, duration: route.duration,
              geometry: route.geojson.geometry, latencyMs, closureGapMeters: quality.closureGapMeters, overlapClass,
              roadFactKinds: route.roadFacts?.map((fact) => fact.kind), configuredDetailKinds: configuredDetails,
            });
            record(results, scenario, profile, failures, { latencyMs, distanceMeters: route.distance, durationSeconds: route.duration, overlapClass });
            recorded = true;
            expect(failures, `${scenario.id} (${profile})`).toEqual([]);
            return;
          }
          const area = await routing.isochrone(corpus!.points[scenario.point], profile as RoutingProfile, scenario.timeLimitMinutes);
          const latencyMs = Date.now() - startedAt;
          const failures = [
            ...(area.approximate ? ['GraphHopper returned an approximate isochrone fallback, not a network polygon'] : []),
            ...(!isValidIsochronePolygon(area.geojson) ? ['isochrone is not a valid non-degenerate Polygon'] : []),
            ...(latencyMs > scenario.expect.maxLatencyMs ? [`latency ${latencyMs}ms exceeds ${scenario.expect.maxLatencyMs}ms`] : []),
          ];
          record(results, scenario, profile, failures, { latencyMs });
          recorded = true;
          expect(failures, `${scenario.id} (${profile})`).toEqual([]);
        } catch (error) {
          if (!recorded) results.push({ scenario: scenario.id, profile, kind: scenario.kind, status: 'failed', reason: asError(error).message });
          throw error;
        }
      });
    }

    afterAll(() => {
      const summary = summarizeLiveRoutingCorpus(corpus?.name ?? 'unavailable', health?.profiles ?? [], results);
      console.info(`LIVE_ROUTING_CORPUS ${JSON.stringify(summary)}`);
      console.info(formatLiveRoutingCorpusSummary(summary));
    });
  });
} else {
  describe.skip('live GraphHopper routing corpus', () => it('requires GRAPHHOPPER_LIVE=1', () => {}));
}

function record(results: LiveCorpusResult[], scenario: LiveRoutingScenario, profile: string, failures: string[], metrics: Omit<LiveCorpusResult, 'scenario' | 'profile' | 'kind' | 'status' | 'reason'>): void {
  results.push({ scenario: scenario.id, profile, kind: scenario.kind, status: failures.length ? 'failed' : 'passed', ...metrics, reason: failures.join('; ') || undefined });
}
function assertLoopbackGraphHopperUrl(rawUrl: string | undefined): void {
  const url = new URL(rawUrl || 'http://localhost:8981');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Live routing corpus refuses a non-local GRAPHHOPPER_URL; use localhost, 127.0.0.1, or ::1.');
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
