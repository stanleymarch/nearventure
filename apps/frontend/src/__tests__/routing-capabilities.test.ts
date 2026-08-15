// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RouteEvidence from '@/components/route/RouteEvidence.vue';
import {
  availableRoutingProfiles,
  isRoutingProfileAvailable,
  preserveRoutingProfile,
  ROUTING_PROFILES,
  ROUTING_PROFILE_LABELS,
  createLatestRequestGate,
  type RoutingHealth,
} from '@/api/routing-contracts';

const healthy: RoutingHealth = { available: true, profiles: ['foot', 'car'] };

describe('routing capabilities', () => {
  it('uses live health profiles and keeps an available selection', () => {
    expect(availableRoutingProfiles(healthy)).toEqual(['foot', 'car']);
    expect(isRoutingProfileAvailable('bike', healthy)).toBe(false);
    expect(preserveRoutingProfile('bike', healthy)).toBe('foot');
  });

  it('keeps every public alias selectable and faithfully preserved', () => {
    const aliases = ['bike_touring', 'mtb_leisure', 'foot_scenic'] as const;
    expect(ROUTING_PROFILES).toHaveLength(7);
    for (const profile of ROUTING_PROFILES) {
      const health: RoutingHealth = { available: true, profiles: [profile] };
      expect(availableRoutingProfiles(health)).toEqual([profile]);
      expect(preserveRoutingProfile(profile, health)).toBe(profile);
      expect(ROUTING_PROFILE_LABELS[profile]).toBeTruthy();
    }
    for (const alias of aliases) expect(ROUTING_PROFILE_LABELS[alias]).not.toBe(ROUTING_PROFILE_LABELS[alias.split('_')[0] as keyof typeof ROUTING_PROFILE_LABELS]);
  });

  it('does not claim a profile is unsupported while health is unknown and blocks after failure', () => {
    expect(isRoutingProfileAvailable('bike', null)).toBe(true);
    expect(availableRoutingProfiles({ ...healthy, available: false })).toEqual([]);
    expect(isRoutingProfileAvailable('bike', { ...healthy, available: false })).toBe(false);
  });

  it('rejects stale retry responses', () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const retry = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(retry)).toBe(true);
  });

  it('renders only supplied quality and road evidence', () => {
    const wrapper = mount(RouteEvidence, {
      props: {
        quality: { warnings: ['UNAVOIDABLE_OUT_AND_BACK'] },
        roadFacts: [{ kind: 'surface', values: [{ value: 'asphalt', distance: 800, share: 0.8 }] }],
        ascend: 120,
        descend: 90,
      },
    });
    expect(wrapper.text()).toContain('Часть пути неизбежно повторяется');
    expect(wrapper.text()).toContain('Покрытие: asphalt 80%');
    expect(wrapper.text()).toContain('Высоты: ↑120 м · ↓90 м');
    expect(wrapper.text()).not.toMatch(/живопис|безопас|покрыт полностью/i);
    expect(mount(RouteEvidence).text()).toBe('');
  });
});
