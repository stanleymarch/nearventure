import { describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  previewAlternative: vi.fn(),
  discardItinerary: vi.fn(),
}));

vi.mock('./index', () => ({ api: {} }));
vi.mock('@nearventure/itinerary-client/api', () => ({
  commandId: () => 'command-id',
  conflictSnapshot: () => null,
  createItineraryApi: () => shared,
}));

import { discardItinerary, previewAlternative } from './itineraries';

describe('Mini App itinerary transport adapter', () => {
  it('delegates alternative preview and discard to the shared typed client unchanged', async () => {
    const signal = new AbortController().signal;
    const preview = { draftId: 'draft-1', version: 2, alternativeId: 'alt-1' };
    shared.previewAlternative.mockResolvedValue(preview);

    await expect(previewAlternative('draft-1', 'alt-1', 2, 'mini-client', signal)).resolves.toEqual(preview);
    expect(shared.previewAlternative).toHaveBeenCalledWith('draft-1', 'alt-1', 2, 'mini-client', signal);

    await discardItinerary('draft-1', { expectedVersion: 2, commandId: 'discard-1' } as any, 'mini-client', signal);
    expect(shared.discardItinerary).toHaveBeenCalledWith('draft-1', { expectedVersion: 2, commandId: 'discard-1' }, 'mini-client', signal);
  });
});
