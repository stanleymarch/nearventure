/* Nearventure MapLibre composable — shared lifecycle, resize, diagnostics. */
import { ref, shallowRef, watch, onMounted, onUnmounted, type Ref } from 'vue';
import maplibregl, { type Map, type MapOptions, type LngLatBoundsLike } from 'maplibre-gl';
import { createMapState, type MapState, type MapDiagnostic } from './map-state.js';

export interface UseNearventureMapOptions {
  /** Container element ref (must be non-null after mount). */
  container: Ref<HTMLElement | null>;
  /** MapLibre style URL or inline style object. */
  style: string | Record<string, unknown>;
  /** Initial center (will be overridden by route fit). */
  center?: [number, number];
  /** Initial zoom. */
  zoom?: number;
  /** Controls to include (omit = none). */
  navigationControl?: boolean;
  /** Enable attribution. */
  attributionControl?: boolean;
  /** Optional keyboard bindings disable for mobile. */
  keyboard?: boolean;
  /** PMTiles tiles URL for local style. */
  tilesUrl?: string;
}

export function useNearventureMap(opts: UseNearventureMapOptions) {
  const map = shallowRef<Map | null>(null);
  const state = ref<MapState>(createMapState('map-container-not-ready'));
  const diagnostic = ref<MapDiagnostic>('map-container-not-ready');
  const ready = ref(false);

  let resizeObserver: ResizeObserver | null = null;

  function cleanup(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (map.value) {
      map.value.remove();
      map.value = null;
    }
  }

  onMounted(() => {
    const el = opts.container.value;
    if (!el) {
      state.value = createMapState('map-container-not-ready');
      return;
    }

    try {
      const mapOptions: MapOptions = {
        container: el,
        style: opts.style,
        center: opts.center ?? [49.66, 58.6],
        zoom: opts.zoom ?? 7,
        attributionControl: opts.attributionControl ?? true,
        keyboard: opts.keyboard ?? false,
      };

      const instance = new maplibregl.Map(mapOptions);

      instance.on('load', () => {
        state.value = createMapState('ready');
        diagnostic.value = 'ready';
        ready.value = true;
      });

      instance.on('error', (e) => {
        console.error('[MapLibre]', e.error?.message || e);
        if (e.error?.message?.includes('WebGL')) {
          state.value = createMapState('webgl-unavailable');
          diagnostic.value = 'webgl-unavailable';
        }
      });

      instance.on('webglcontextlost', () => {
        state.value = createMapState('style-or-tile-failure');
        diagnostic.value = 'style-or-tile-failure';
      });

      instance.on('webglcontextrestored', () => {
        state.value = createMapState('ready');
        diagnostic.value = 'ready';
      });

      // ResizeObserver for container size changes
      resizeObserver = new ResizeObserver(() => {
        instance.resize();
      });
      resizeObserver.observe(el);

      // Visibility change — resume context if returning to page
      const onVisibility = () => {
        if (document.visibilityState === 'visible' && instance) {
          instance.resize();
        }
      };
      document.addEventListener('visibilitychange', onVisibility);

      map.value = instance;

      onUnmounted(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        cleanup();
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('WebGL')) {
        state.value = createMapState('webgl-unavailable');
        diagnostic.value = 'webgl-unavailable';
      } else {
        state.value = createMapState('style-or-tile-failure');
        diagnostic.value = 'style-or-tile-failure';
      }
    }
  });

  /** Explicit resize call — use after sheet/drawer snap, Telegram viewport change. */
  function resize(): void {
    map.value?.resize();
  }

  /** Fit map to bounds with padding. */
  function fitBounds(
    bounds: [number, number, number, number],
    padding: number = 80,
  ): void {
    if (!map.value) return;
    try {
      map.value.fitBounds(bounds as LngLatBoundsLike, { padding, maxZoom: 14 });
    } catch {
      // Invalid bounds — ignore
    }
  }

  /** Update diagnostic state manually (e.g. route not found). */
  function setDiagnostic(d: MapDiagnostic): void {
    diagnostic.value = d;
    state.value = createMapState(d);
  }

  return {
    map,
    state,
    diagnostic,
    ready,
    resize,
    fitBounds,
    setDiagnostic,
    cleanup,
  };
}
