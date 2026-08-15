import { describe, expect, it, vi } from 'vitest';
import { availableRoutingProfiles, isRoutingProfileAvailable, preserveRoutingProfile, routingProfileFromQuery, ROUTING_PROFILES, ROUTING_PROFILE_LABELS, createLatestRequestGate } from '@shared/api/routing-contracts';
import { api } from '@/api';
import { getRoutingHealth, startGuideFromMiniApp } from './useRouting';

describe('Mini App routing capability transport', () => {
  it('reads the live health endpoint and filters profiles from its response', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { available: true, profiles: ['bike', 'mtb'] } } as any);
    const health = await getRoutingHealth();
    expect(api.get).toHaveBeenCalledWith('/api/routing/health');
    expect(availableRoutingProfiles(health)).toEqual(['bike', 'mtb']);
    expect(isRoutingProfileAvailable('foot', health)).toBe(false);
  });

  it('starts a guide with draft identity and version only', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({ data: { ok: true } } as any);
    await expect(startGuideFromMiniApp('signed-init-data', 'draft-123', 7)).resolves.toEqual({ ok: true });
    expect(api.post).toHaveBeenCalledWith('/api/telegram/guide/start-draft', {
      initData: 'signed-init-data', draftId: 'draft-123', expectedVersion: 7,
    });
    expect((api.post as any).mock.calls[0][1]).not.toHaveProperty('geojson');
    expect((api.post as any).mock.calls[0][1]).not.toHaveProperty('pois');
  });

  it('preserves every public alias returned by live health', () => {
    for (const profile of ROUTING_PROFILES) {
      const health = { available: true, profiles: [profile] };
      expect(preserveRoutingProfile(profile, health)).toBe(profile);
      expect(ROUTING_PROFILE_LABELS[profile]).toBeTruthy();
    }
  });

  it('hydrates every shared profile from a Wizard deep link without alias fallback', () => {
    for (const profile of ROUTING_PROFILES) expect(routingProfileFromQuery(profile)).toBe(profile);
    expect(routingProfileFromQuery('unsupported')).toBeNull();
  });

  it('does not let an older retry win the health state', () => {
    const gate = createLatestRequestGate();
    const earlier = gate.begin();
    const retry = gate.begin();
    expect(gate.isCurrent(earlier)).toBe(false);
    expect(gate.isCurrent(retry)).toBe(true);
  });

  it('treats an unavailable health response as no requestable profile', () => {
    const health = { available: false, profiles: [] };
    expect(availableRoutingProfiles(health)).toEqual([]);
    expect(isRoutingProfileAvailable('bike', health)).toBe(false);
  });
});
