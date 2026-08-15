import { describe, expect, it } from 'vitest';
import { SelectionDiagnosticsLogger, type SelectionDiagnosticsPayload } from './selection-diagnostics.logger';
import { OptimizationRunCounters } from './optimization-run-budget';

describe('SelectionDiagnosticsLogger', () => {
  const logger = new SelectionDiagnosticsLogger();

  const validPayload: SelectionDiagnosticsPayload = {
    isochronePois: 41,
    placesAfterClustering: 9,
    graphHopperRequests: 12,
    cacheHits: 8,
    cacheMisses: 4,
    exclusionReasons: { isolated_automatic_singleton: 1 },
    deadlineExceeded: false,
    returnedBestConfirmed: false,
    selectedUniquePois: 7,
    selectedPlaces: 5,
    maxAutomaticExcursionMinutes: 6,
  };

  it('confirms a payload with only aggregate counts is PII-free', () => {
    expect(logger.isPIIFree(validPayload)).toBe(true);
  });

  it('rejects a payload containing coordinate-like values', () => {
    const bad = { ...validPayload, isochronePois: 0 } as any;
    bad.coordinates = '58.7327,50.1772'; // coordinate-like string
    expect(logger.isPIIFree(bad)).toBe(false);
  });

  it('rejects a payload with PII-like keys', () => {
    const bad = { ...validPayload, lat: 58.73, lon: 50.17 } as any;
    // The JSON string contains "lat":58.73 which matches the PII key pattern
    expect(logger.isPIIFree(bad)).toBe(false);
  });

  it('builds a payload from counters correctly', () => {
    const counters = new OptimizationRunCounters();
    counters.isochronePois = 41;
    counters.graphHopperRequests = 5;
    counters.cacheHits = 3;
    counters.cacheMisses = 2;
    counters.recordExclusion('isolated_automatic_singleton');
    const payload = SelectionDiagnosticsLogger.buildPayload(counters, {
      selectedUniquePois: 7,
      selectedPlaces: 5,
      maxAutomaticExcursionMinutes: 6,
    });
    expect(payload.isochronePois).toBe(41);
    expect(payload.graphHopperRequests).toBe(5);
    expect(payload.exclusionReasons.isolated_automatic_singleton).toBe(1);
    expect(payload.selectedUniquePois).toBe(7);
    expect(logger.isPIIFree(payload)).toBe(true);
  });
});
