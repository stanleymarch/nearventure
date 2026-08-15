// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/AdventureMap.vue', () => ({
  default: { template: '<div />' },
}));

import router from '@/router';

describe('legacy adventure route', () => {
  afterEach(async () => {
    await router.replace('/');
  });

  it('redirects /adventure to the immersive map route', async () => {
    await router.push('/adventure');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('home');
    expect(router.currentRoute.value.fullPath).toBe('/map');
  });
});
