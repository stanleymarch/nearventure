<script setup lang="ts">
/**
 * CatalogMap — read-only map of the POI catalog.
 *
 * Uses Leaflet for Telegram WebView compatibility. MapLibre migration is
 * planned after a Telegram iOS/Android soak test confirms WebGL stability.
 *
 * Tapping a marker emits `open` (caller navigates to PoiDetailView).
 */
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PoiRow } from '@/composables/usePois';
import { categoryStyle } from '@/lib/poi-categories';

const props = defineProps<{ pois: PoiRow[] }>();
const emit = defineEmits<{ open: [poi: PoiRow] }>();

const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let markerLayer: L.LayerGroup | null = null;
let resizeObserver: ResizeObserver | null = null;

function makeMarker(poi: PoiRow): L.Marker {
  const style = categoryStyle(poi.category);
  const icon = L.divIcon({
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${style.color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer;"></div>`,
    className: 'cat-marker-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
  const m = L.marker([poi.lat!, poi.lon!], { icon });
  m.on('click', () => emit('open', poi));
  return m;
}

function render() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const valid = props.pois.filter(p => p.lat != null && p.lon != null);
  if (valid.length === 0) return;

  for (const poi of valid) {
    markerLayer.addLayer(makeMarker(poi));
  }

  if (valid.length === 1) {
    map.setView([valid[0].lat!, valid[0].lon!], 12);
  } else {
    const bounds = L.latLngBounds(valid.map(p => [p.lat!, p.lon!] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value, {
    center: [58.6035, 49.6679],
    zoom: 9,
    zoomControl: false,
    attributionControl: false,
  });
  L.tileLayer('/raster-tiles/{z}/{x}/{y}.png', {
    maxZoom: 20,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  render();
  // Lifecycle: ResizeObserver replaces the setTimeout hack — fires whenever
  // the container changes size (v-if reveal, Telegram viewport, orientation).
  if (typeof ResizeObserver !== 'undefined' && mapEl.value) {
    resizeObserver = new ResizeObserver(() => map?.invalidateSize());
    resizeObserver.observe(mapEl.value);
  }
  // Telegram viewport change → invalidateSize.
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

watch(() => props.pois, render, { deep: false });
</script>

<template>
  <div ref="mapEl" class="catalog-map" />
</template>

<style scoped>
.catalog-map {
  width: 100%;
  height: 240px;
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--nv-surface-low));
}
</style>
