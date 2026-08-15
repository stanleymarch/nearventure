import { describe, expect, it, vi } from 'vitest';
import { ItineraryController } from './itinerary.controller';

describe('ItineraryController owner request resolution', () => {
  it('passes verified Telegram header identity instead of browser fallback', async () => {
    const drafts = { get: vi.fn().mockResolvedValue({ id: 'draft' }) } as any;
    const owners = { resolve: vi.fn().mockReturnValue({ key: 'tg:42', kind: 'telegram' }) } as any;
    const controller = new ItineraryController(drafts, owners);
    await controller.get('browser_client', 'signed-init-data', 'draft');
    expect(owners.resolve).toHaveBeenCalledWith('browser_client', 'signed-init-data');
    expect(drafts.get).toHaveBeenCalledWith('tg:42', 'draft');
  });

  it('forwards owner and expected version to the read-only alternative preview', async () => {
    const drafts = { previewAlternative: vi.fn().mockResolvedValue({ alternativeId: 'alt-1' }) } as any;
    const owners = { resolve: vi.fn().mockReturnValue({ key: 'client:web', kind: 'client' }) } as any;
    const controller = new ItineraryController(drafts, owners);
    await controller.previewAlternative('web', undefined, 'draft-1', 'alt-1', '7');
    expect(drafts.previewAlternative).toHaveBeenCalledWith('client:web', 'draft-1', 'alt-1', 7);
  });

  it('passes browser client id when Telegram header is absent', async () => {
    const drafts = { create: vi.fn().mockResolvedValue({ id: 'draft' }) } as any;
    const owners = { resolve: vi.fn().mockReturnValue({ key: 'client:browser_client', kind: 'client' }) } as any;
    const controller = new ItineraryController(drafts, owners);
    await controller.create('browser_client', undefined, {} as any);
    expect(owners.resolve).toHaveBeenCalledWith('browser_client', undefined);
    expect(drafts.create).toHaveBeenCalledWith('client:browser_client', {});
  });
});
