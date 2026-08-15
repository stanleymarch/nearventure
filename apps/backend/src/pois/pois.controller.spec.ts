import { describe, expect, it, vi } from 'vitest';
import { PoisController } from './pois.controller';

describe('PoisController media cache policy', () => {
  function makeController() {
    return new PoisController({
      getMediaBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from('webp'), mime: 'image/webp' }),
    } as any, {} as any);
  }

  function makeResponse() {
    return { set: vi.fn(), send: vi.fn() } as any;
  }

  it('allows immutable caching only for the current policy-versioned URL', async () => {
    const response = makeResponse();
    await (makeController() as any).getMedia('poi-1', '2', response);

    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
  });

  it('does not extend the lifetime of legacy unversioned media URLs', async () => {
    const response = makeResponse();
    await (makeController() as any).getMedia('poi-1', undefined, response);

    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
