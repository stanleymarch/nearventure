/**
 * Cart of selected POIs — shared across catalog (add from detail) and the
 * basket/wizard (browse, remove, checkout). Module-level reactive Map so it
 * survives in-app navigation within a session, PLUS localStorage persistence
 * so the user never loses their cart on reload, back, or accidental close.
 *
 * This is the *selection* state. The final planned route lives in
 * `useBuiltRoute` (produced at checkout).
 */
import { computed, reactive, ref } from 'vue';

const CART_STORAGE_KEY = 'nv:cart:v1';

/**
 * Item in the cart. Two kinds:
 *  - 'poi': a real POI from the catalog (the common case).
 *  - 'custom': a user-supplied waypoint — typically a "I want to stop
 *    here" pin captured from a long-press on the map or a 'use my
 *    location' button. The `poiId` for custom is null.
 *
 * The cart is ordered: insertion order = visit order in the route.
 * Custom waypoints slot in wherever the user added them.
 */
export interface CartPoi {
  id: string;
  name: string;
  /** Category key (POI category for 'poi' kind; for 'custom' use 'custom'). */
  category: string;
  lat: number;
  lon: number;
  kind?: 'poi' | 'custom';
  /** Only set for 'poi' kind — the underlying POI's uuid. */
  poiId?: string | null;
}

export interface CartSerialized {
  items: Omit<CartPoi, 'kind' | 'poiId'>[];
}

// Ordered map keyed by POI id (insertion order = display order).
const items = reactive(new Map<string, CartPoi>());
let _hydrated = false;

/** Persist the current cart to localStorage. */
function persistToStorage(): void {
  try {
    const data = Array.from(items.values()).map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      lat: p.lat,
      lon: p.lon,
      kind: p.kind,
      poiId: p.poiId,
    }));
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable (private browsing, quota exceeded) →
    // cart still works in-memory, just not persisted across reloads.
  }
}

/** Restore cart from localStorage. Idempotent — only runs once. */
function hydrateFromStorage(): void {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as CartSerialized['items'];
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (!items.has(item.id)) {
        items.set(item.id, {
          id: item.id,
          name: item.name,
          category: item.category,
          lat: item.lat,
          lon: item.lon,
          kind: (item as any).kind || 'poi',
          poiId: (item as any).poiId || null,
        });
      }
    }
  } catch {
    // Corrupted storage → clear and start fresh.
    try { localStorage.removeItem(CART_STORAGE_KEY); } catch {}
  }
}

export function useCart() {
  const list = computed(() => Array.from(items.values()));
  const count = computed(() => items.size);
  /** True after localStorage restoration + first mutation trigger. */
  const restored = ref(false);

  // Restore once, lazily on first use.
  hydrateFromStorage();

  function has(id: string): boolean {
    return items.has(id);
  }

  function _mutate(action: () => void) {
    action();
    persistToStorage();
    restored.value = true;
  }

  function add(poi: CartPoi): void {
    _mutate(() => {
      if (!items.has(poi.id)) items.set(poi.id, poi);
    });
  }

  /**
   * Add a custom waypoint (user's location or a long-press on the map).
   * Generates a stable synthetic id so the cart can dedupe.
   */
  function addCustom(lat: number, lon: number, label?: string): string {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    _mutate(() => {
      items.set(id, {
        id,
        name: label || 'Моя точка',
        category: 'custom',
        lat,
        lon,
        kind: 'custom',
        poiId: null,
      });
    });
    return id;
  }

  function remove(id: string): void {
    _mutate(() => items.delete(id));
  }

  function toggle(poi: CartPoi): void {
    _mutate(() => {
      if (items.has(poi.id)) items.delete(poi.id);
      else items.set(poi.id, poi);
    });
  }

  function clear(): void {
    _mutate(() => items.clear());
  }

  return { list, count, has, add, addCustom, remove, toggle, clear, restored };
}
