import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OptimizationRunBudget, OptimizationRunCounters } from './optimization-run-budget';

describe('OptimizationRunBudget', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('tracks request slots and refuses when exhausted', () => {
    const budget = new OptimizationRunBudget({ maxRequests: 5, deadlineMs: 10000 });
    expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(false); // exhausted
    expect(budget.usedRequestCount).toBe(5);
  });

  it('respects the deadline', () => {
    const budget = new OptimizationRunBudget({ maxRequests: 100, deadlineMs: 5000 });
    expect(budget.isExhausted()).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(budget.isExhausted()).toBe(true);
    expect(budget.acquire()).toBe(false);
    expect(budget.wasDeadlineExceeded()).toBe(true);
  });

  it('reserves slots for final validation so search cannot starve it', () => {
    const budget = new OptimizationRunBudget({ maxRequests: 10, reservedFinalValidation: 3 });
    budget.reserveFinalValidation();
    // 10 - 3 reserved = 7 general slots
    for (let i = 0; i < 7; i++) expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(false); // general pool exhausted
    // But reserved slots still work
    expect(budget.acquireReserved()).toBe(true);
    expect(budget.acquireReserved()).toBe(true);
    expect(budget.acquireReserved()).toBe(true);
    expect(budget.acquireReserved()).toBe(false);
  });

  it('reserves slots for the initial candidate so probing cannot starve it, and releases unused ones', async () => {
    const budget = new OptimizationRunBudget({ maxRequests: 10, reservedFinalValidation: 2, reservedInitialCandidate: 2 });
    budget.reserveFinalValidation();
    budget.reserveInitialCandidate();
    // General pool = 10 - 2 (final) - 2 (initial) = 6 slots.
    for (let i = 0; i < 6; i++) expect(budget.acquire()).toBe(true);
    expect(budget.acquire()).toBe(false); // probing exhausted
    // The initial-candidate reservation is still usable even though the
    // general pool is exhausted — probing can never starve the first route.
    expect(budget.initialCandidateReserved).toBe(2);
    const lease = await budget.acquireReservedInitialLease();
    expect(lease).not.toBeNull();
    lease?.release();
    expect(budget.initialCandidateReserved).toBe(1);
    // Returning the unused reservation widens the general pool again.
    budget.releaseInitialCandidateReservation();
    expect(budget.initialCandidateReserved).toBe(0);
    expect(budget.acquire()).toBe(true);
  });

  it('counts remaining milliseconds correctly', () => {
    const budget = new OptimizationRunBudget({ deadlineMs: 10000 });
    expect(budget.remainingMs()).toBe(10000);
    vi.advanceTimersByTime(3000);
    expect(budget.remainingMs()).toBe(7000);
  });
});

describe('OptimizationRunCounters', () => {
  it('records and serializes exclusion reasons', () => {
    const counters = new OptimizationRunCounters();
    counters.recordExclusion('isolated_automatic_singleton');
    counters.recordExclusion('isolated_automatic_singleton');
    counters.recordExclusion('unreachable');
    const json = counters.toJSON();
    expect(json.exclusionReasons).toEqual({ isolated_automatic_singleton: 2, unreachable: 1 });
  });

  it('tracks graphhopper requests and cache stats', () => {
    const counters = new OptimizationRunCounters();
    counters.graphHopperRequests = 5;
    counters.cacheHits = 10;
    counters.cacheMisses = 5;
    counters.isochronePois = 41;
    counters.placesAfterClustering = 9;
    const json = counters.toJSON();
    expect(json.graphHopperRequests).toBe(5);
    expect(json.cacheHits).toBe(10);
    expect(json.isochronePois).toBe(41);
  });
});
