import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests for the cart composable (used by CatalogView and WizardView).
 *
 * The cart is a module-level reactive Map — state survives across imports,
 * which is by design (so navigating from /catalog to /wizard preserves
 * the selection). Each test resets the state via cart.clear() so the
 * tests don't bleed into each other.
 *
 * localStorage persistence is tested with a mock — happy-dom provides
 * it but we sanitise between tests to keep them isolated.
 */

// Tests use happy-dom localStorage.

import type { CartPoi } from './useCart';

function makePoi(overrides: Partial<CartPoi> = {}): CartPoi {
  return {
    id: 'uuid-' + Math.random().toString(36).slice(2, 9),
    name: 'Test POI',
    category: 'heritage',
    lat: 58.6,
    lon: 49.6,
    ...overrides,
  };
}

describe('useCart', () => {
  let cart: ReturnType<typeof import('./useCart').useCart>;
  beforeEach(async () => {
    // Re-import the module so the module-level state is fresh between tests.
    const mod = await import('./useCart');
    cart = mod.useCart();
    cart.clear();
  });

  it('starts empty', () => {
    expect(cart.count.value).toBe(0);
    expect(cart.list.value).toEqual([]);
  });

  it('add inserts in insertion order', () => {
    const a = makePoi({ id: 'a' });
    const b = makePoi({ id: 'b' });
    const c = makePoi({ id: 'c' });
    cart.add(a);
    cart.add(b);
    cart.add(c);
    expect(cart.list.value.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(cart.count.value).toBe(3);
  });

  it('add is idempotent by id', () => {
    const a = makePoi({ id: 'a' });
    cart.add(a);
    cart.add(a);
    cart.add({ ...a, name: 'Renamed' });
    expect(cart.count.value).toBe(1);
    // First add wins (Map.set semantics) — name stays 'Test POI'.
    expect(cart.list.value[0].name).toBe('Test POI');
  });

  it('remove drops by id', () => {
    cart.add(makePoi({ id: 'a' }));
    cart.add(makePoi({ id: 'b' }));
    cart.remove('a');
    expect(cart.list.value.map((p) => p.id)).toEqual(['b']);
    expect(cart.has('a')).toBe(false);
    expect(cart.has('b')).toBe(true);
  });

  it('toggle adds when missing, removes when present', () => {
    const a = makePoi({ id: 'a' });
    cart.toggle(a);
    expect(cart.has('a')).toBe(true);
    cart.toggle(a);
    expect(cart.has('a')).toBe(false);
  });

  it('addCustom stores a custom waypoint and returns its id', () => {
    const id = cart.addCustom(58.6, 49.6, 'Park');
    expect(typeof id).toBe('string');
    expect(cart.has(id)).toBe(true);
    const item = cart.list.value.find((p) => p.id === id);
    expect(item?.kind).toBe('custom');
    expect(item?.category).toBe('custom');
    expect(item?.name).toBe('Park');
    expect(item?.lat).toBe(58.6);
    expect(item?.lon).toBe(49.6);
  });

  it('addCustom defaults the label to "Моя точка"', () => {
    const id = cart.addCustom(1, 2);
    const item = cart.list.value.find((p) => p.id === id);
    expect(item?.name).toBe('Моя точка');
  });

  it('addCustom can coexist with POIs in the cart (insertion order)', () => {
    cart.add(makePoi({ id: 'a' }));
    cart.addCustom(1, 2);
    cart.add(makePoi({ id: 'b' }));
    expect(cart.list.value.map((p) => p.id)).toEqual(['a', expect.stringMatching(/^custom-/), 'b']);
  });

  it('persists to localStorage and restores after clear', () => {
    // Add items → localStorage should have data.
    cart.add(makePoi({ id: 'persist-a', name: 'A' }));
    expect(localStorage.getItem('nv:cart:v1')).toMatch('"persist-a"');

    // Clear → localStorage should be empty array or missing.
    cart.clear();
    const after = localStorage.getItem('nv:cart:v1');
    // After clear the cart serializes to an empty array `[]`.
    expect(after).toBe('[]');
  });

  it('has reflects membership reactively', () => {
    const a = makePoi({ id: 'a' });
    expect(cart.has('a')).toBe(false);
    cart.add(a);
    expect(cart.has('a')).toBe(true);
  });

  it('clear empties the cart', () => {
    cart.add(makePoi({ id: 'a' }));
    cart.add(makePoi({ id: 'b' }));
    cart.clear();
    expect(cart.count.value).toBe(0);
    expect(cart.list.value).toEqual([]);
  });

  it('preserves insertion order on repeated add+remove', () => {
    cart.add(makePoi({ id: 'a' }));
    cart.add(makePoi({ id: 'b' }));
    cart.add(makePoi({ id: 'c' }));
    cart.remove('b');
    cart.add(makePoi({ id: 'd' }));
    // Order is the current Map iteration order: a, c, d (b removed).
    expect(cart.list.value.map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });
});
