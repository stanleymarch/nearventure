import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RoadFactKind } from './road-facts';

export type LiveScenarioKind = 'point-to-point' | 'round-trip' | 'isochrone';
export type LoopOverlapClass = 'clean' | 'out-and-back' | 'any';
export type LiveCorpusStatus = 'passed' | 'skipped-profile' | 'failed' | 'setup-failed';

export interface LiveCorpusPoint {
  lon: number;
  lat: number;
}

interface LatencyExpectation {
  maxLatencyMs: number;
}

interface RouteExpectation extends LatencyExpectation {
  networkConfirmed: true;
  minDistanceMeters?: number;
  maxDistanceMeters?: number;
  maxDurationSeconds?: number;
  roadFacts?: { configuredOnly: true };
}

export interface PointToPointScenario {
  id: string;
  kind: 'point-to-point';
  profiles: string[];
  start: string;
  finish: string;
  expect: RouteExpectation;
}

export interface RoundTripScenario {
  id: string;
  kind: 'round-trip';
  profiles: string[];
  start: string;
  distanceMeters: number;
  seed: number;
  expect: RouteExpectation & {
    maxClosureGapMeters: number;
    overlapClass: LoopOverlapClass;
  };
}

export interface IsochroneScenario {
  id: string;
  kind: 'isochrone';
  profiles: string[];
  point: string;
  timeLimitMinutes: number;
  expect: LatencyExpectation & { networkConfirmed: true };
}

export type LiveRoutingScenario = PointToPointScenario | RoundTripScenario | IsochroneScenario;

export interface LiveRoutingCorpus {
  version: 1;
  name: string;
  points: Record<string, LiveCorpusPoint>;
  scenarios: LiveRoutingScenario[];
}

export interface RouteInvariantResult {
  distance: number;
  duration: number;
  geometry: unknown;
  latencyMs: number;
  networkConfirmed: boolean;
  roadFactKinds?: readonly string[];
  configuredDetailKinds?: readonly RoadFactKind[];
  closureGapMeters?: number;
  overlapClass?: LoopOverlapClass;
}

export const DEFAULT_LIVE_ROUTING_CORPUS = resolve(
  __dirname,
  'fixtures/live-routing-corpus.pfo.json',
);

export interface LiveCorpusResult {
  scenario: string;
  profile: string;
  kind: LiveRoutingScenario['kind'] | 'setup';
  status: LiveCorpusStatus;
  latencyMs?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  overlapClass?: string;
  reason?: string;
}

export interface LiveCorpusSummary {
  corpus: string;
  advertisedProfiles: string[];
  counts: Record<LiveCorpusStatus, number>;
  results: LiveCorpusResult[];
}

/** Builds truthful, stable live-suite output, including failures before any scenario runs. */
export function summarizeLiveRoutingCorpus(
  corpus: string,
  advertisedProfiles: readonly string[],
  results: readonly LiveCorpusResult[],
): LiveCorpusSummary {
  const ordered = [...results].sort((a, b) => `${a.scenario}:${a.profile}`.localeCompare(`${b.scenario}:${b.profile}`));
  const counts = ordered.reduce((total, result) => {
    total[result.status] += 1;
    return total;
  }, { passed: 0, 'skipped-profile': 0, failed: 0, 'setup-failed': 0 } as Record<LiveCorpusStatus, number>);
  return { corpus, advertisedProfiles: [...advertisedProfiles].sort(), counts, results: ordered };
}

export function formatLiveRoutingCorpusSummary(summary: LiveCorpusSummary): string {
  const { counts } = summary;
  return `Live routing corpus: ${counts.passed} passed, ${counts['skipped-profile']} profile-skipped, ${counts.failed} scenario failed, ${counts['setup-failed']} setup failed.`;
}

/** Loads only test corpus data; this module is never used by production routing. */
export function loadLiveRoutingCorpus(filePath = process.env.GRAPHHOPPER_LIVE_CORPUS): LiveRoutingCorpus {
  const selected = filePath || DEFAULT_LIVE_ROUTING_CORPUS;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(selected, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load live routing corpus "${selected}": ${message}`);
  }
  return parseLiveRoutingCorpus(raw, selected);
}

export function parseLiveRoutingCorpus(raw: unknown, source = 'corpus'): LiveRoutingCorpus {
  const corpus = object(raw, source);
  if (corpus.version !== 1) fail(source, 'version must be 1');
  const name = string(corpus.name, `${source}.name`);
  const rawPoints = object(corpus.points, `${source}.points`);
  const points: Record<string, LiveCorpusPoint> = {};
  for (const [name, point] of Object.entries(rawPoints)) {
    const candidate = object(point, `${source}.points.${name}`);
    const lon = finite(candidate.lon, `${source}.points.${name}.lon`);
    const lat = finite(candidate.lat, `${source}.points.${name}.lat`);
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) fail(source, `point "${name}" is outside WGS84 bounds`);
    points[name] = { lon, lat };
  }
  if (Object.keys(points).length === 0) fail(source, 'points must not be empty');
  if (!Array.isArray(corpus.scenarios) || corpus.scenarios.length === 0) fail(source, 'scenarios must not be empty');
  const ids = new Set<string>();
  const scenarios = corpus.scenarios.map((scenario, index) => parseScenario(scenario, `${source}.scenarios[${index}]`, points, ids));
  return { version: 1, name, points, scenarios };
}

/** Stable route checks shared by the live suite and deterministic unit tests. */
export function evaluateRouteInvariants(
  expectation: RouteExpectation | RoundTripScenario['expect'],
  result: RouteInvariantResult,
): string[] {
  const failures: string[] = [];
  if (!result.networkConfirmed) failures.push('route was not confirmed by GraphHopper');
  if (!isLineString(result.geometry)) failures.push('route geometry is not a valid LineString');
  if (!finitePositive(result.distance)) failures.push('route distance is not finite and positive');
  if (!finitePositive(result.duration)) failures.push('route duration is not finite and positive');
  if (!finiteNonNegative(result.latencyMs) || result.latencyMs > expectation.maxLatencyMs) {
    failures.push(`latency ${rounded(result.latencyMs)}ms exceeds ${expectation.maxLatencyMs}ms`);
  }
  if (expectation.minDistanceMeters != null && result.distance < expectation.minDistanceMeters) {
    failures.push(`distance ${rounded(result.distance)}m is below ${expectation.minDistanceMeters}m`);
  }
  if (expectation.maxDistanceMeters != null && result.distance > expectation.maxDistanceMeters) {
    failures.push(`distance ${rounded(result.distance)}m exceeds ${expectation.maxDistanceMeters}m`);
  }
  if (expectation.maxDurationSeconds != null && result.duration > expectation.maxDurationSeconds) {
    failures.push(`duration ${rounded(result.duration)}s exceeds ${expectation.maxDurationSeconds}s`);
  }
  if (expectation.roadFacts?.configuredOnly) {
    const configured = new Set(result.configuredDetailKinds ?? []);
    for (const kind of result.roadFactKinds ?? []) {
      if (!configured.has(kind as RoadFactKind)) failures.push(`road fact "${kind}" was returned without configuration`);
    }
  }
  if ('maxClosureGapMeters' in expectation) {
    if (!finiteNonNegative(result.closureGapMeters) || result.closureGapMeters > expectation.maxClosureGapMeters) {
      failures.push(`closure gap ${rounded(result.closureGapMeters)}m exceeds ${expectation.maxClosureGapMeters}m`);
    }
    if (expectation.overlapClass !== 'any' && result.overlapClass !== expectation.overlapClass) {
      failures.push(`overlap class is "${result.overlapClass ?? 'unknown'}", expected "${expectation.overlapClass}"`);
    }
  }
  return failures;
}

export function isValidIsochronePolygon(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false;
  return geometry.coordinates.every((ring) => {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isCoordinate)) return false;
    const first = ring[0] as number[];
    const last = ring[ring.length - 1] as number[];
    return first[0] === last[0] && first[1] === last[1] && ringHasArea(ring as number[][]);
  });
}

function parseScenario(raw: unknown, path: string, points: Record<string, LiveCorpusPoint>, ids: Set<string>): LiveRoutingScenario {
  const scenario = object(raw, path);
  const id = string(scenario.id, `${path}.id`);
  if (ids.has(id)) fail(path, `duplicate scenario id "${id}"`);
  ids.add(id);
  const kind = string(scenario.kind, `${path}.kind`) as LiveScenarioKind;
  if (!['point-to-point', 'round-trip', 'isochrone'].includes(kind)) fail(path, 'kind must be point-to-point, round-trip, or isochrone');
  const profiles = strings(scenario.profiles, `${path}.profiles`);
  if (!profiles.length) fail(path, 'profiles must not be empty');
  const expect = parseExpectation(scenario.expect, `${path}.expect`, kind === 'round-trip');
  if (kind === 'point-to-point') {
    const start = pointName(scenario.start, `${path}.start`, points);
    const finish = pointName(scenario.finish, `${path}.finish`, points);
    return { id, kind, profiles, start, finish, expect };
  }
  if (kind === 'round-trip') {
    const start = pointName(scenario.start, `${path}.start`, points);
    return { id, kind, profiles, start, distanceMeters: positive(scenario.distanceMeters, `${path}.distanceMeters`), seed: integer(scenario.seed, `${path}.seed`), expect: expect as RoundTripScenario['expect'] };
  }
  const point = pointName(scenario.point, `${path}.point`, points);
  return { id, kind, profiles, point, timeLimitMinutes: positive(scenario.timeLimitMinutes, `${path}.timeLimitMinutes`), expect: expect as IsochroneScenario['expect'] };
}

function parseExpectation(raw: unknown, path: string, roundTrip: boolean): RouteExpectation | RoundTripScenario['expect'] | IsochroneScenario['expect'] {
  const value = object(raw, path);
  if (value.networkConfirmed !== true) fail(path, 'networkConfirmed must be true');
  const maxLatencyMs = positive(value.maxLatencyMs, `${path}.maxLatencyMs`);
  if ('maxClosureGapMeters' in value || roundTrip) {
    if (!roundTrip) fail(path, 'closure expectations apply only to round-trip scenarios');
    const overlapClass = string(value.overlapClass, `${path}.overlapClass`) as LoopOverlapClass;
    if (!['clean', 'out-and-back', 'any'].includes(overlapClass)) fail(path, 'overlapClass must be clean, out-and-back, or any');
    return {
      networkConfirmed: true,
      maxLatencyMs,
      ...routeBounds(value, path),
      maxClosureGapMeters: finiteNonNegativeValue(value.maxClosureGapMeters, `${path}.maxClosureGapMeters`),
      overlapClass,
    };
  }
  if ('minDistanceMeters' in value || 'maxDistanceMeters' in value || 'maxDurationSeconds' in value || 'roadFacts' in value) {
    return { networkConfirmed: true, maxLatencyMs, ...routeBounds(value, path) };
  }
  return { networkConfirmed: true, maxLatencyMs };
}

function routeBounds(value: Record<string, unknown>, path: string): Omit<RouteExpectation, 'networkConfirmed' | 'maxLatencyMs'> {
  const minDistanceMeters = optionalFinite(value.minDistanceMeters, `${path}.minDistanceMeters`);
  const maxDistanceMeters = optionalFinite(value.maxDistanceMeters, `${path}.maxDistanceMeters`);
  if (minDistanceMeters != null && maxDistanceMeters != null && minDistanceMeters > maxDistanceMeters) fail(path, 'minDistanceMeters must not exceed maxDistanceMeters');
  const maxDurationSeconds = optionalFinite(value.maxDurationSeconds, `${path}.maxDurationSeconds`);
  let roadFacts: { configuredOnly: true } | undefined;
  if (value.roadFacts != null) {
    const rawRoadFacts = object(value.roadFacts, `${path}.roadFacts`);
    if (rawRoadFacts.configuredOnly !== true) fail(path, 'roadFacts.configuredOnly must be true');
    roadFacts = { configuredOnly: true };
  }
  return {
    ...(minDistanceMeters != null ? { minDistanceMeters } : {}),
    ...(maxDistanceMeters != null ? { maxDistanceMeters } : {}),
    ...(maxDurationSeconds != null ? { maxDurationSeconds } : {}),
    ...(roadFacts ? { roadFacts } : {}),
  };
}

function isLineString(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  return geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every(isCoordinate);
}

function isCoordinate(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
    && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function ringHasArea(ring: number[][]): boolean {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index++) twiceArea += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  return Number.isFinite(twiceArea) && Math.abs(twiceArea) > 0;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string): string { if (typeof value !== 'string' || !value.trim()) fail(path, 'must be a non-empty string'); return value.trim(); }
function strings(value: unknown, path: string): string[] { if (!Array.isArray(value)) fail(path, 'must be an array'); return value.map((item, index) => string(item, `${path}[${index}]`)); }
function finite(value: unknown, path: string): number { if (!Number.isFinite(value)) fail(path, 'must be a finite number'); return value as number; }
function finiteNonNegativeValue(value: unknown, path: string): number { const number = finite(value, path); if (number < 0) fail(path, 'must not be negative'); return number; }
function positive(value: unknown, path: string): number { const number = finite(value, path); if (number <= 0) fail(path, 'must be positive'); return number; }
function integer(value: unknown, path: string): number { const number = finite(value, path); if (!Number.isInteger(number)) fail(path, 'must be an integer'); return number; }
function optionalFinite(value: unknown, path: string): number | undefined { return value == null ? undefined : finiteNonNegativeValue(value, path); }
function pointName(value: unknown, path: string, points: Record<string, LiveCorpusPoint>): string { const name = string(value, path); if (!points[name]) fail(path, `references unknown point "${name}"`); return name; }
function fail(path: string, message: string): never { throw new Error(`Invalid live routing corpus at ${path}: ${message}`); }
function finitePositive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function finiteNonNegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function rounded(value: unknown): number | string { return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 'invalid'; }
