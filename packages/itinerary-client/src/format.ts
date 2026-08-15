import type { ItineraryTotals } from './contracts';

/** Human-readable duration for compact itinerary UI. */
export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

/** Signed duration used in suggestion previews. */
export function formatMinuteDelta(minutes: number): string {
  const rounded = Math.round(minutes);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${formatMinutes(Math.abs(rounded))}`;
}

export function budgetLabel(totals: Pick<ItineraryTotals, 'feasible' | 'overBudgetMinutes' | 'remainingMinutes'>): string {
  if (!totals.feasible) return `Превышение ${formatMinutes(totals.overBudgetMinutes)}`;
  if (totals.remainingMinutes == null) return 'Без лимита';
  return `Запас ${formatMinutes(totals.remainingMinutes)}`;
}
