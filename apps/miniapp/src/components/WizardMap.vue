<script setup lang="ts">
/**
 * Compact map for the WizardView — shows POI markers in the
 * isochrone range + supports long-press to drop a custom waypoint.
 *
 * Uses Leaflet for Telegram WebView compatibility. MapLibre migration is
 * planned after a Telegram iOS/Android soak test confirms WebGL stability.
 *
 * This is the "storefront window" the user sees at the top of the wizard:
 * "here's what's reachable, here's where you are, tap anywhere to drop a
 * custom pin".
 */
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PoiRow } from '@/composables/usePois';
import type { Point } from '@/composables/useRouting';

const props = defineProps<{
  start: Point | null;
  pois: PoiRow[];
  /** When true, long-press drops a custom pin instead of showing tooltip. */
  pinMode?: boolean;
  finishPoint?: Point | null;
  selectionMode?: 'finish' | null;
}>();

const emit = defineEmits<{
  (e: 'pin', pos: { lat: number; lon: number }): void;
  (e: 'finish', pos: { lat: number; lon: number }): void;
}>();

const mapEl = ref<HTMLDivElement>();
let map: L.Map | null = null;
let poiLayer: L.LayerGroup | null = null;
let customPin: L.Marker | null = null;
let finishPin: L.Marker | null = null;
let resizeObserver: ResizeObserver | null = null;

const defaultCenter: L.LatLngExpression = [58.60, 49.67]; // Kirov
const center = computed<L.LatLngExpression>(() =>
  props.start ? [props.start.lat, props.start.lon] : defaultCenter,
);

onMounted(() => {
  if (!mapEl.value) return;

  map = L.map(mapEl.value, {
    center: center.value,
    zoom: 13,
    zoomControl: false,
    attributionControl: false,
  });

  L.tileLayer('/raster-tiles/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

  poiLayer = L.layerGroup().addTo(map);

  // Start marker
  if (props.start) {
    L.circleMarker([props.start.lat, props.start.lon], {
      radius: 10,
      fillColor: '#4f46e5',
      color: '#fff',
      weight: 2,
      fillOpacity: 0.9,
    }).addTo(map);
  }

  // Long-press → custom pin when pinMode is active.
  let touchTimer: ReturnType<typeof setTimeout> | undefined;
  let touchPoint: L.Point | undefined;

  map.on('click', (e: L.LeafletMouseEvent) => {
    if (props.selectionMode === 'finish') dropFinishPin(e.latlng.lat, e.latlng.lng);
  });

  map.on('contextmenu', (e: L.LeafletMouseEvent) => {
    if (!props.pinMode) return;
    dropCustomPin(e.latlng.lat, e.latlng.lng);
  });

  map.on('mousedown', (e: L.LeafletMouseEvent) => {
    if (!props.pinMode) return;
    touchPoint = (e as any).containerPoint;
    touchTimer = setTimeout(() => {
      if (touchPoint) {
        const latlng = map!.containerPointToLatLng(touchPoint);
        dropCustomPin(latlng.lat, latlng.lng);
      }
    }, 600);
  });

  map.on('mouseup mousemove zoomstart', () => {
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = undefined;
    }
  });

  updateMarkers();
  syncFinishPin();

  // Lifecycle: ResizeObserver for container size changes.
  if (typeof ResizeObserver !== 'undefined' && mapEl.value) {
    resizeObserver = new ResizeObserver(() => map?.invalidateSize());
    resizeObserver.observe(mapEl.value);
  }
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.onEvent) {
    tg.onEvent('viewportChanged', () => nextTick(() => map?.invalidateSize()));
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  map?.remove();
  map = null;
});

function dropFinishPin(lat: number, lon: number) {
  emit('finish', { lat, lon });
}

function syncFinishPin() {
  if (!map) return;
  finishPin?.remove();
  finishPin = null;
  if (!props.finishPoint) return;
  const icon = L.divIcon({
    html: '<div style="display:grid;place-items:center;width:28px;height:28px;border-radius:999px;background:#1f2937;color:white;border:2px solid white;font:700 12px system-ui">F</div>',
    className: 'finish-pin-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  finishPin = L.marker([props.finishPoint.lat, props.finishPoint.lon], { icon }).addTo(map);
}

function dropCustomPin(lat: number, lon: number) {
  if (!map) return;
  customPin?.remove();
  const icon = L.divIcon({
    html: '📍',
    className: 'custom-pin-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
  customPin = L.marker([lat, lon], { icon }).addTo(map);
  emit('pin', { lat, lon });
}

function updateMarkers() {
  if (!map || !poiLayer) return;
  poiLayer.clearLayers();

  for (const p of props.pois) {
    if (p.lat == null || p.lon == null) continue;
    const dotIcon = L.divIcon({
      html: '<div style="width:10px;height:10px;border-radius:50%;background:#4f46e5;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.4);"></div>',
      className: 'poi-dot-icon',
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    });
    L.marker([p.lat, p.lon], { icon: dotIcon }).addTo(poiLayer);
  }

  // Auto-fit bounds to show all markers + start
  if (props.pois.length > 0 && props.start) {
    const bounds = L.latLngBounds(
      props.pois
        .filter(p => p.lat != null && p.lon != null)
        .map(p => [p.lat!, p.lon!] as [number, number])
    );
    bounds.extend([props.start.lat, props.start.lon]);
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 15 });
  }
}

// Re-render markers when the POI list changes.
watch(() => props.pois, updateMarkers, { deep: false });
watch(() => props.finishPoint, syncFinishPin, { deep: true });
</script>

<template>
  <div class="relative overflow-hidden rounded-xl border border-nv-outline-variant/60">
    <div ref="mapEl" class="h-48 w-full" />

    <div v-if="selectionMode === 'finish'" class="absolute bottom-2 left-2 right-2 rounded-lg bg-nv-primary/90 px-2.5 py-1.5 text-center text-[11px] font-semibold text-white">
      Нажмите на карту, чтобы выбрать финиш
    </div>

    <!-- Pin mode indicator -->
    <div
      v-else-if="pinMode"
      class="absolute bottom-2 left-2 right-2 rounded-lg bg-nv-tertiary/90 px-2.5 py-1.5 text-center text-[11px] font-semibold text-white"
    >
      Удерживайте на карте, чтобы поставить точку ✨
    </div>
  </div>
</template>
