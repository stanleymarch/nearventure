import { describe, expect, it } from 'vitest';
import { ItineraryBudgetService } from './itinerary-budget.service';
const place = (dwellMinutes: number) => ({ id: 'p', name: 'p', center: { lat: 0, lon: 0 }, pois: [], visitMode: 'visit' as const, dwellMinutes, arrivalOverheadMinutes: 0, source: 'manual' as const, locked: false, clusterConfidence: 'manual' as const });
describe('ItineraryBudgetService', () => {
  const service = new ItineraryBudgetService();
  it('reserves max(5 minutes, five percent) and accepts an exact whole-trip boundary', () => {
    expect(service.reserve(80)).toBe(5); expect(service.reserve(101)).toBe(6);
    expect(service.calculate({ travelMinutes: 0, places: [], budgetMinutes: 100, budgetMode: 'whole_trip', reserveMinutes: 0 }).reserveMinutes).toBe(5);
    const totals = service.calculate({ travelMinutes: 40, places: [place(55)], budgetMinutes: 100, budgetMode: 'whole_trip', reserveMinutes: 5 });
    expect(totals.totalMinutes).toBe(100); expect(totals.feasible).toBe(true);
  });
  it('travel-only constrains travel while returning the real outing duration', () => {
    const totals = service.calculate({ travelMinutes: 60, places: [place(100)], budgetMinutes: 60, budgetMode: 'travel_only' });
    expect(totals.totalMinutes).toBe(165); expect(totals.stopMinutes).toBe(100); expect(totals.reserveMinutes).toBe(5); expect(totals.feasible).toBe(true);
  });
  it('unlimited has no hidden budget, reserve, or overage', () => {
    const totals = service.calculate({ travelMinutes: 60, places: [place(20)], budgetMinutes: null, budgetMode: 'unlimited', reserveMinutes: 99 });
    expect(totals).toMatchObject({ totalMinutes: 80, budgetMinutes: null, reserveMinutes: 0, feasible: true, overBudgetMinutes: 0, remainingMinutes: null });
  });
  it('allows an infeasible draft with an explicit overage', () => {
    const totals = service.calculate({ travelMinutes: 90, places: [place(20)], budgetMinutes: 100, budgetMode: 'whole_trip', reserveMinutes: 5 });
    expect(totals.feasible).toBe(false); expect(totals.overBudgetMinutes).toBe(15);
  });
});
