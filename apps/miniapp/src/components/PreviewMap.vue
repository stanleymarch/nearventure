<script setup lang="ts">
/**
 * Read-only preview of a built route: numbered POI markers in visit
 * order and the route polyline. Autoscales to fit.
 *
 * Uses Leaflet for Telegram WebView compatibility. MapLibre migration is
 * planned after a Telegram iOS/Android soak test confirms WebGL stability.
 */
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BuiltRoute } from '@/composables/useBuiltRoute';
import { categoryStyle } from '@/lib/poi-categories';
import { extractLineCoordinates } from '@nearventure/map-runtime/geojson-utils';

const props = defineProps<{ route: BuiltRoute }>();
const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let poiLayer: L.LayerGroup | null = null;
let routeLayer: L.Polyline | null = null;
let resizeObserver: ResizeObserver | null = null;
let onVisibilityChange: (() => void) | null = null;

onMounted(init);
onUnmounted(cleanup);
watch(() => props.route, render, { deep: false });

function init() {
  if (!mapEl.value) return;
  map = L.map(mapEl.value, {
    center: [58.6035, 49.6679],
    zoom: 12,
    zoomControl: true,
    attributionControl: false,
  });
  L.tileLayer('/raster-tiles/{z}/{x}/{y}.png', {
    maxZoom: 20,
  }).addTo(map);
  poiLayer = L.layerGroup().addTo(map);

  // Lifecycle: resize on container change and Telegram viewport events.
  if (typeof ResizeObserver !== 'undefined' && mapEl.value) {
    resizeObserver = new ResizeObserver(() => {
      map?.invalidateSize();
    });
    resizeObserver.observe(mapEl.value);
  }
  onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      nextTick(() => map?.invalidateSize());
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Telegram viewport change → invalidateSize.
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.onEvent) {
    tg.onEvent('viewportChanged', () => nextTick(() => map?.invalidateSize()));
  }

  render();
}

function cleanup() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (onVisibilityChange) {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    onVisibilityChange = null;
  }
  map?.remove();
  map = null;
}

function render() {
  if (!map || !poiLayer) return;
  poiLayer.clearLayers();
  routeLayer?.remove();

  const allPts: L.LatLngExpression[] = [];

  // Route polyline from GeoJSON coordinates.
  const lngLatPts: [number, number][] = extractLineCoordinates(props.route.geojson);
  if (lngLatPts.length >= 2) {
    const latLngs = lngLatPts.map(([lon, lat]) => [lat, lon] as [number, number]);
    routeLayer = L.polyline(latLngs, {
      color: '#C95712',
      weight: 4,
      opacity: 0.85,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);
    allPts.push(...latLngs);
  }

  // Numbered POI markers in visit order.
  for (const p of props.route.pois) {
    const st = categoryStyle(p.category);
    const num = (p.order ?? 0) + 1;
    const icon = L.divIcon({
      html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:rgb(255 255 255 / 0.96);border:2px solid ${st.color};color:${st.color};font-weight:700;font-size:12px;box-shadow:0 2px 6px rgb(0 0 0 / 0.25);">${num}</div>`,
      className: 'nv-marker-icon',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    const m = L.marker([p.lat, p.lon], { icon }).addTo(poiLayer);
    m.bindPopup(`<b>${num}. ${p.name}</b>`);
    allPts.push([p.lat, p.lon]);
  }

  // Fit bounds
  if (allPts.length >= 2) {
    map.fitBounds(L.latLngBounds(allPts), { padding: [30, 30], maxZoom: 15 });
  } else if (allPts.length === 1) {
    map.setView(allPts[0], 14);
  }
}

defineExpose({ invalidate: () => map?.invalidateSize() });
</script>

<template>
  <div ref="mapEl" class="preview-map"></div>
</template>

<style scoped>
.preview-map {
  width: 100%;
  height: 260px;
  border-radius: 14px;
  overflow: hidden;
}
</style>
