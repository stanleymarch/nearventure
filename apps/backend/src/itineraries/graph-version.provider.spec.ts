import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GraphVersionProvider, FALLBACK_NAMESPACE } from './graph-version.provider';

describe('GraphVersionProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const meta = (version: string) =>
    vi.fn(async (): Promise<{ version?: string; bbox?: number[] }> => ({ version, bbox: [31.0, 48.0, 49.0, 58.0] }));

  it('derives a verified namespace from GraphHopper graph metadata', async () => {
    const gh: any = { graphMetadata: meta('9.0') };
    const provider = new GraphVersionProvider(gh);
    expect(await provider.namespace()).toBe('gh-9.0-31.000,48.000,49.000,58.000');
    expect(gh.graphMetadata).toHaveBeenCalledTimes(1);
  });

  it('returns the conservative unverified namespace when metadata is unavailable', async () => {
    const gh: any = { graphMetadata: vi.fn(async (): Promise<{ version?: string; bbox?: number[] }> => ({})) };
    const provider = new GraphVersionProvider(gh);
    expect(await provider.namespace()).toBe(FALLBACK_NAMESPACE);
  });

  it('returns the conservative namespace when metadata fetch throws', async () => {
    const gh: any = { graphMetadata: vi.fn(async () => { throw new Error('network down'); }) };
    const provider = new GraphVersionProvider(gh);
    expect(await provider.namespace()).toBe(FALLBACK_NAMESPACE);
  });

  it('memoizes the namespace within the TTL', async () => {
    const gh: any = { graphMetadata: meta('9.0') };
    const provider = new GraphVersionProvider(gh);
    const first = await provider.namespace();
    const second = await provider.namespace();
    expect(first).toBe(second);
    expect(gh.graphMetadata).toHaveBeenCalledTimes(1);
  });

  it('refreshes the namespace after the TTL expires', async () => {
    let version = '9.0';
    const gh: any = {
      graphMetadata: vi.fn(async (): Promise<{ version?: string; bbox?: number[] }> => ({ version, bbox: [31.0, 48.0, 49.0, 58.0] })),
    };
    const provider = new GraphVersionProvider(gh);
    await provider.namespace();
    version = '9.1';
    vi.advanceTimersByTime(6 * 60_000);
    expect(await provider.namespace()).toBe('gh-9.1-31.000,48.000,49.000,58.000');
    expect(gh.graphMetadata).toHaveBeenCalledTimes(2);
  });
});
