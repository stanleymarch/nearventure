// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createItinerary, getItinerary, itineraryCommand } from '@/api/itineraries';
import { useItineraryDraft } from './useItineraryDraft';
import { ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS } from '@shared/api/itinerary-draft-commands';

vi.mock('@/api/itineraries', async (load) => {
  const actual = await load<typeof import('@/api/itineraries')>();
  return { ...actual, createItinerary: vi.fn(), getItinerary: vi.fn(), itineraryCommand: vi.fn(), commandId: vi.fn(() => 'cmd') };
});

const snapshot = (version = 1) => ({ id: 'draft', version, profile: 'foot', loop: true } as any);

describe('Mini App itinerary routing guard', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('keeps a valid existing route accessible while routing is unavailable', async () => {
    const existing = { ...snapshot(), route: { distance: 1000, duration: 600, geojson: { type: 'Feature', geometry: null, properties: {} } } } as any;
    vi.mocked(getItinerary).mockResolvedValue(existing);
    const state = useItineraryDraft();
    state.setRoutingGuard(() => false, vi.fn());

    await state.hydrate('draft');

    expect(state.draft.value?.route).toEqual(existing.route);
    expect(getItinerary).toHaveBeenCalledWith('draft', expect.any(String), expect.any(AbortSignal));
  });

  it('prevents every unavailable routing-capable action but permits non-routing edits', async () => {
    vi.mocked(createItinerary).mockResolvedValue(snapshot());
    const blocked = vi.fn();
    const state = useItineraryDraft();
    await state.create({ start: { lat: 1, lon: 2 }, profile: 'foot', loop: true, budgetMinutes: 60 } as any);
    state.setRoutingGuard(() => false, blocked);
    for (const action of ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS) await state.command(action);
    expect(blocked).toHaveBeenCalledTimes(ROUTING_CAPABLE_ITINERARY_DRAFT_COMMANDS.length);
    expect(itineraryCommand).not.toHaveBeenCalled();

    vi.mocked(itineraryCommand).mockResolvedValue(snapshot(2));
    await state.setLocked('place', true);
    expect(itineraryCommand).toHaveBeenCalledWith('draft', 'set-locked', expect.any(Object), expect.any(String), expect.any(AbortSignal));
  });
});
