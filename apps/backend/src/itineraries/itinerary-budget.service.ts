import { Injectable } from '@nestjs/common';
import type { BudgetMode, ItineraryTotals, RoutePlace } from './itinerary.types';
@Injectable()
export class ItineraryBudgetService {
  reserve(budgetMinutes: number | null): number {
    return budgetMinutes == null ? 0 : Math.max(5, Math.ceil(budgetMinutes * .05));
  }

  calculate(input: { travelMinutes?: number; places: RoutePlace[]; budgetMinutes: number | null; budgetMode: BudgetMode; reserveMinutes?: number }): ItineraryTotals {
    const travelMinutes = this.nonNegative(input.travelMinutes ?? 0);
    const stopMinutes = input.places.reduce((sum, place) => sum + this.nonNegative(place.dwellMinutes), 0);
    const reserveMinutes = input.budgetMode === 'unlimited'
      ? 0
      : Math.max(this.reserve(input.budgetMinutes), this.nonNegative(input.reserveMinutes ?? 0));
    // totalMinutes is the real outing duration for every mode. Budget mode only
    // changes which component is constrained, never what the user sees.
    const totalMinutes = travelMinutes + stopMinutes + reserveMinutes;
    if (input.budgetMode === 'unlimited' || input.budgetMinutes == null) {
      return { travelMinutes, stopMinutes, reserveMinutes, totalMinutes, budgetMinutes: null, feasible: true, overBudgetMinutes: 0, remainingMinutes: null };
    }
    const constrainedMinutes = input.budgetMode === 'whole_trip' ? totalMinutes : travelMinutes;
    const overBudgetMinutes = Math.max(0, constrainedMinutes - input.budgetMinutes);
    return { travelMinutes, stopMinutes, reserveMinutes, totalMinutes, budgetMinutes: input.budgetMinutes, feasible: overBudgetMinutes === 0, overBudgetMinutes, remainingMinutes: Math.max(0, input.budgetMinutes - constrainedMinutes) };
  }
  private nonNegative(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0; }
}
