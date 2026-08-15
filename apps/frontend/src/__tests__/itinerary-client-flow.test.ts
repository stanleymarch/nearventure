import { describe, expect, it, vi } from 'vitest';
import {
  budgetLabel,
  createItineraryApi,
  createPlannerFlow,
  formatMinuteDelta,
  formatMinutes,
  plannerFlowReducer,
} from '@nearventure/itinerary-client';

describe('@nearventure/itinerary-client planner flow', () => {
  it('moves a normal planner through intent, conditions, preferences, and review', () => {
    let flow = createPlannerFlow();
    expect(flow).toMatchObject({ stage: 'intent', intent: undefined, intentPrefilled: false });

    flow = plannerFlowReducer(flow, { type: 'choose_intent', intent: 'auto_budget' });
    expect(flow).toMatchObject({ stage: 'conditions', intent: 'auto_budget', intentPrefilled: false });

    flow = plannerFlowReducer(flow, { type: 'continue' });
    expect(flow.stage).toBe('preferences');
    flow = plannerFlowReducer(flow, { type: 'continue' });
    expect(flow.stage).toBe('review');
    flow = plannerFlowReducer(flow, { type: 'back' });
    expect(flow.stage).toBe('preferences');
  });

  it('does not invent an intent screen when a POI action prefills intent', () => {
    let flow = createPlannerFlow('destination');
    expect(flow).toMatchObject({ stage: 'conditions', intentPrefilled: true });

    flow = plannerFlowReducer(flow, { type: 'back' });
    expect(flow.stage).toBe('conditions');
  });
});

describe('@nearventure/itinerary-client API factory', () => {
  it('sends discard and preview through the shared versioned transport', async () => {
    const post = vi.fn().mockResolvedValue({ data: undefined });
    const get = vi.fn().mockResolvedValue({ data: { draftId: 'draft-1', version: 3, alternativeId: 'alt-1' } });
    const client = createItineraryApi({ post, get }, (clientId) => ({ headers: { 'x-test-client': clientId } }));
    const abort = new AbortController();
    await client.discardItinerary('draft-1', { expectedVersion: 3, commandId: 'discard-1' }, 'mini-1', abort.signal);
    await client.previewAlternative('draft-1', 'alt-1', 3, 'mini-1', abort.signal);
    expect(post).toHaveBeenCalledWith('/api/itineraries/draft-1/commands/discard', { expectedVersion: 3, commandId: 'discard-1' }, { headers: { 'x-test-client': 'mini-1' }, signal: abort.signal });
    expect(get).toHaveBeenCalledWith('/api/itineraries/draft-1/alternatives/alt-1/preview?expectedVersion=3', { headers: { 'x-test-client': 'mini-1' }, signal: abort.signal });
  });

  it('keeps versioned commands and client headers identical on every surface', async () => {
    const post = vi.fn().mockResolvedValue({ data: { id: 'draft-1' } });
    const http = { post, get: vi.fn() };
    const client = createItineraryApi(http, (clientId) => ({ headers: { 'x-test-client': clientId } }));

    await client.itineraryCommand('draft-1', 'accept-addition', { expectedVersion: 7, commandId: 'cmd-1' }, 'web-1');

    expect(post).toHaveBeenCalledWith(
      '/api/itineraries/draft-1/commands/accept-addition',
      { expectedVersion: 7, commandId: 'cmd-1' },
      { headers: { 'x-test-client': 'web-1' }, signal: undefined },
    );
  });
});

describe('@nearventure/itinerary-client format', () => {
  it('formats durations and budget status for shared UI', () => {
    expect(formatMinutes(75)).toBe('1 ч 15 мин');
    expect(formatMinuteDelta(-12.2)).toBe('−12 мин');
    expect(budgetLabel({ feasible: false, overBudgetMinutes: 8, remainingMinutes: null })).toBe('Превышение 8 мин');
  });
});
