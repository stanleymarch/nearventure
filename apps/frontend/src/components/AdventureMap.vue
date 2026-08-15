<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { CATEGORY_STYLES, CATEGORY_HEX, CATEGORY_PIN_PATHS } from '@/lib/poi-categories';
// `LUCIDE_PATHS` and `CATEGORY_HEX` used to be duplicated here AND in the chips;
// now they live in poi-categories.ts as the single source of truth so a museum
// pin on the map and the museum chip in the panel are the same glyph.
const LUCIDE_PATHS = CATEGORY_PIN_PATHS;
import { poiName, type Poi } from '@/api/pois';
import { buildStyle, baseFromTheme, DEFAULT_STYLE_CONFIG, type MapStyleConfig } from '@/lib/map-styles';
import mlcontour from 'maplibre-contour';

interface Props {
  pois: Poi[];
  activeCategories: string[];
  selectedPoiId?: string | null;
  startPoint?: { lat: number; lng: number } | null;
  finishPoint?: { lat: number; lng: number } | null;
  showHillshade?: boolean;
  showContours?: boolean;
  showIsochrone?: boolean;
  mode?: string;
  styleConfig?: MapStyleConfig;
  /** Dim catalog POI layers so the active route line dominates the map. */
  routeActive?: boolean;
  /** Canonical itinerary nodes rendered as numbered markers above the line. */
  routeStops?: Array<{ id: string; name: string; lat: number; lon: number; index: number }>;
}

const props = withDefaults(defineProps<Props>(), {
  selectedPoiId: null,
  startPoint: null,
  finishPoint: null,
  showHillshade: false,
  showContours: false,
  showIsochrone: true,
  mode: 'cycling',
  styleConfig: () => ({ ...DEFAULT_STYLE_CONFIG }),
  routeActive: false,
  routeStops: () => [],
});

const emit = defineEmits<{
  (e: 'map-click', latlng: { lat: number; lng: number }): void;
  (e: 'poi-select', poi: Poi): void;
  (e: 'map-view', view: { bbox: [number, number, number, number]; zoom: number }): void;
  (e: 'update:start-point', p: { lat: number; lng: number }): void;
  (e: 'update:finish-point', p: { lat: number; lng: number }): void;
}>();

const mapRef = ref<HTMLDivElement>();
let map: maplibregl.Map | null = null;
let startMarker: maplibregl.Marker | null = null;
let finishMarker: maplibregl.Marker | null = null;
let hoverPopup: maplibregl.Popup | null = null;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let poisById: Map<string, Poi> = new Map();
let resizeObserver: ResizeObserver | null = null;
let onVisibilityChange: (() => void) | null = null;

// ── PMTiles protocol registration (once, module-level) ────────────────
let pmtilesRegistered = false;
function registerPmtiles() {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

function registerTerrain() {
  if (terrainRegistered) return;
  const demSource = new mlcontour.DemSource({
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    encoding: 'terrarium',
    maxzoom: 13,
    worker: true,
    cacheSize: 100,
    timeoutMs: 10_000,
  });
  demSource.setupMaplibre(maplibregl);
  demTileUrl = demSource.sharedDemProtocolUrl;
  contourTileUrl = demSource.contourProtocolUrl({
    multiplier: 1,
    thresholds: { 11: [200, 1000], 12: [100, 500], 13: [100, 500], 14: [50, 200], 15: [20, 100] },
    contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level',
    extent: 4096, buffer: 1, overzoom: 1,
  });
  terrainRegistered = true;
}

// ── Module-level data storage for restoration after setStyle ───────────
let lastPoisData: Poi[] = [];
let lastRouteData: { lon: number; lat: number }[] | null = null;
let lastAlternativePreview: { route: number[][]; stops: Array<{ id: string; name: string; lat: number; lon: number; index: number }> } | null = null;
let lastIsochroneData: { type: 'Polygon'; coordinates: number[][][] } | null = null;
let lastStartPoint: { lat: number; lng: number } | null = null;
let lastSelectedId: string | null = null;

// ── maplibre-contour DemSource (shared by buildStyle calls) ─────────
let demTileUrl: string | null = null;
let contourTileUrl: string | null = null;
let terrainRegistered = false;

const KIROV: [number, number] = [49.6679, 58.6035]; // [lng, lat]

const colorFor = (cat: string) => CATEGORY_HEX[cat] || '#888';
const isDarkNow = () => document.documentElement.classList.contains('dark');

/** Render a teardrop POI pin with a lucide icon to a canvas → ImageData. */
function generatePinImage(color: string, iconPaths: string[] | undefined): HTMLCanvasElement {
  const W = 80, H = 104; // 2x for retina sharpness
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.scale(2, 2); // draw in 40x52 logical space
  const w = 40, h = 52;

  // Drop shadow
  ctx.shadowColor = 'rgba(35,25,20,0.35)';
  ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;

  // Teardrop body (round head + pointed tail at bottom)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(20, 51);
  ctx.bezierCurveTo(20, 42, 40, 36, 40, 19);
  ctx.arc(20, 19, 18, 0, Math.PI, true);
  ctx.bezierCurveTo(0, 36, 20, 42, 20, 51);
  ctx.closePath();
  ctx.fill();

  // White stroke ring
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Lucide icon (white, scaled to ~15px inside the head circle)
  if (iconPaths?.length) {
    ctx.save();
    const scale = 15 / 24;
    ctx.translate(20 - 7.5, 19 - 7.5);
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const d of iconPaths) {
      if (!d) continue;
      try { const p = new Path2D(d); ctx.stroke(p); } catch { /* ignore */ }
    }
    ctx.restore();
  }
  return cv;
}

function resolveStyle(): MapStyleConfig {
  return props.styleConfig;
}

// ── Add custom layers (idempotent - can be called after setStyle) ───────
function addCustomLayers() {
  if (!map) return;
  const dark = isDarkNow();

  // ── Generate category pin images + add to map ──────────────────────
  for (const cat of Object.keys(CATEGORY_HEX)) {
    if (!map.hasImage(`pin-${cat}`)) {
      const cv = generatePinImage(colorFor(cat), LUCIDE_PATHS[cat]);
      const ctx2 = cv.getContext('2d')!;
      map.addImage(`pin-${cat}`, ctx2.getImageData(0, 0, cv.width, cv.height), { pixelRatio: 2 });
    }
  }

  // ── POI source + symbol layer (teardrop pins) ────────────────────────
  if (!map.getSource('pois')) {
    map.addSource('pois', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 50,
    });
    const iconMatch: any[] = ['match', ['get', 'category']];
    for (const cat of Object.keys(CATEGORY_HEX)) iconMatch.push(cat, `pin-${cat}`);
    iconMatch.push('pin-heritage'); // default fallback
    map.addLayer({
      id: 'custom-pois',
      type: 'symbol',
      source: 'pois',
      layout: {
        'icon-image': iconMatch as any,
        'icon-size': 0.9,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': false,
        'icon-padding': 2,
      },
      paint: {
        // Toggled by `routeActive` so catalog pins recede behind the route line.
        'icon-opacity': 1,
      },
    });
    map.addLayer({
      id: 'poi-clusters',
      type: 'circle',
      source: 'pois',
      filter: ['has', 'point_count'],
      paint: {
        // Clusters are neutral sage: quantity should not masquerade as a
        // route/CTA action (terracotta is reserved for those).
        'circle-color': '#66736B',
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 25, 50, 30],
        'circle-opacity': 0.7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
    map.addLayer({
      id: 'poi-cluster-count',
      type: 'symbol',
      source: 'pois',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 12,
        'text-font': ['Noto Sans Medium'],
      },
      paint: {
        'text-color': '#ffffff',
      },
    });
  }

  // ── Route preview source + line layer ──────────────────────────────────
  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      paint: {
        // Terracotta is reserved for the actual route — the one intentional
        // warm signal on an otherwise calm map.
        'line-color': dark ? '#F0B892' : '#B05D2B',
        'line-width': 4,
        'line-opacity': 0.8,
        'line-dasharray': [1.5, 1.5],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  } else {
    // Update paint on theme change
    map.setPaintProperty('route', 'line-color', dark ? '#F0B892' : '#B05D2B');
  }

  if (!map.getSource('route-stops')) {
    map.addSource('route-stops', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'route-stop-circles',
      type: 'circle',
      source: 'route-stops',
      paint: {
        'circle-radius': 14,
        'circle-color': dark ? '#272724' : '#FFFCF7',
        'circle-stroke-width': 3,
        'circle-stroke-color': dark ? '#F0B892' : '#B05D2B',
      },
    });
    map.addLayer({
      id: 'route-stop-labels',
      type: 'symbol',
      source: 'route-stops',
      layout: {
        'text-field': ['to-string', ['get', 'index']],
        'text-size': 12,
        'text-font': ['Noto Sans Medium'],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': dark ? '#F7F3EB' : '#6B2E0A' },
    });
  } else {
    map.setPaintProperty('route-stop-circles', 'circle-color', dark ? '#272724' : '#FFFCF7');
    map.setPaintProperty('route-stop-circles', 'circle-stroke-color', dark ? '#F0B892' : '#B05D2B');
    map.setPaintProperty('route-stop-labels', 'text-color', dark ? '#F7F3EB' : '#6B2E0A');
  }

  if (!map.getSource('alternative-preview-route')) {
    map.addSource('alternative-preview-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'alternative-preview-route-line', type: 'line', source: 'alternative-preview-route', paint: { 'line-color': '#438A9A', 'line-width': 4, 'line-dasharray': [2, 2] }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
    map.addSource('alternative-preview-stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'alternative-preview-stop-circles', type: 'circle', source: 'alternative-preview-stops', paint: { 'circle-radius': 11, 'circle-color': '#FFFCF7', 'circle-stroke-color': '#438A9A', 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'alternative-preview-stop-labels', type: 'symbol', source: 'alternative-preview-stops', layout: { 'text-field': ['to-string', ['get', 'index']], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#174A54' } });
  }
  if (lastAlternativePreview) drawAlternativePreview(lastAlternativePreview.route, lastAlternativePreview.stops);

  // ── Isochrone source + fill layer (reachable area) ────────────────────
  if (!map.getSource('isochrone')) {
    map.addSource('isochrone', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'isochrone-fill',
      type: 'fill',
      source: 'isochrone',
      paint: {
        // Reachability is informational geography, not a route: blue/teal.
        'fill-color': dark ? '#7AC6D2' : '#438A9A',
        'fill-opacity': 0.12,
      },
    });
    map.addLayer({
      id: 'isochrone-line',
      type: 'line',
      source: 'isochrone',
      paint: {
        'line-color': dark ? '#7AC6D2' : '#438A9A',
        'line-width': 2,
        'line-opacity': 0.5,
        'line-dasharray': [3, 2],
      },
    });
    // Apply initial visibility from showIsochrone prop
    if (!props.showIsochrone) {
      map.setLayoutProperty('isochrone-fill', 'visibility', 'none');
      map.setLayoutProperty('isochrone-line', 'visibility', 'none');
    }
  } else {
    // Update paint on theme change
    map.setPaintProperty('isochrone-fill', 'fill-color', dark ? '#7AC6D2' : '#438A9A');
    map.setPaintProperty('isochrone-line', 'line-color', dark ? '#7AC6D2' : '#438A9A');
    // Ensure visibility follows prop (e.g. after setStyle recreated layers)
    map.setLayoutProperty('isochrone-fill', 'visibility', props.showIsochrone ? 'visible' : 'none');
    map.setLayoutProperty('isochrone-line', 'visibility', props.showIsochrone ? 'visible' : 'none');
  }

  // ── Terrain (hillshade) — 3D mesh from 'dem' source ─────────────────────
  if (map.getSource('dem')) {
    map.setTerrain({ source: 'dem', exaggeration: 1.2 });
  } else if (map.getSource('terrain')) {
    map.setTerrain({ source: 'terrain', exaggeration: 1.2 });
  }

  // ── Restore data (after setStyle clears sources) ────────────────────────
  syncPois();
  syncRouteStops();
  syncStartPoint();
  syncFinishPoint();
  if (lastRouteData) restoreRouteData();
  if (lastIsochroneData) restoreIsochroneData();
  if (lastSelectedId) {
    const poi = props.pois.find((p) => p.id === lastSelectedId);
    if (poi) {
      hoverPopup?.setLngLat([poi.lon, poi.lat]).setHTML(poiName(poi)).addTo(map);
      map.flyTo({ center: [poi.lon, poi.lat], duration: 600 });
    }
  }

  // Fire initial map-view so the parent loads POIs for the starting viewport.
  emitMapView();
}

function emitMapView() {
  if (!map) return;
  const b = map.getBounds();
  emit('map-view', {
    bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    zoom: map.getZoom(),
  });
}

function syncPois() {
  if (!map || !map.getSource('pois')) return;
  lastPoisData = [...props.pois];
  poisById = new Map();
  const features = props.pois.map((p) => {
    poisById.set(p.id, p);
    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { id: p.id, category: p.category, name: poiName(p) },
    };
  });
  (map.getSource('pois') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features,
  });
}

function syncRouteStops() {
  if (!map || !map.getSource('route-stops')) return;
  const features = props.routeStops.map((stop) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
    properties: { id: stop.id, name: stop.name, index: stop.index },
  }));
  (map.getSource('route-stops') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features,
  });
}

function syncStartPoint() {
  if (!map) return;
  lastStartPoint = props.startPoint;
  if (props.startPoint) {
    const [lat, lng] = [props.startPoint.lat, props.startPoint.lng];
    if (!startMarker) {
      const dark = document.documentElement.classList.contains('dark');
      const el = document.createElement('div');
      el.className = 'nv-startpin';
      el.innerHTML = `<svg width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.2 0 0 7.2 0 16c0 11 16 24 16 24s16-13 16-24C32 7.2 24.8 0 16 0z" fill="${dark ? '#E6A08C' : '#C95712'}" stroke="${dark ? '#1a1a1f' : '#6b2e0a'}" stroke-width="1.5"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>`;
      startMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      startMarker.on('dragend', () => {
        const ll = startMarker!.getLngLat();
        emit('update:start-point', { lat: ll.lat, lng: ll.lng });
      });
    } else {
      startMarker.setLngLat([lng, lat]);
    }
  } else if (startMarker) {
    startMarker.remove();
    startMarker = null;
  }
}

function syncFinishPoint() {
  if (!map) return;
  if (props.finishPoint) {
    const { lat, lng } = props.finishPoint;
    if (!finishMarker) {
      const el = document.createElement('div');
      el.className = 'grid size-8 place-items-center rounded-full border-2 border-background bg-foreground text-xs font-black text-background shadow-lg';
      el.textContent = 'F';
      el.setAttribute('aria-label', 'Финиш маршрута');
      finishMarker = new maplibregl.Marker({ element: el, anchor: 'center', draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      finishMarker.on('dragend', () => {
        const ll = finishMarker!.getLngLat();
        emit('update:finish-point', { lat: ll.lat, lng: ll.lng });
      });
    } else {
      finishMarker.setLngLat([lng, lat]);
    }
  } else if (finishMarker) {
    finishMarker.remove();
    finishMarker = null;
  }
}

function restoreRouteData() {
  if (!lastRouteData || !map?.getSource('route')) return;
  const coords = lastRouteData.map((r) => [r.lon, r.lat]);
  (map.getSource('route') as maplibregl.GeoJSONSource).setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {},
  });
}

function restoreIsochroneData() {
  if (!lastIsochroneData || !map?.getSource('isochrone')) return;
  (map.getSource('isochrone') as maplibregl.GeoJSONSource).setData({
    type: 'Feature', geometry: lastIsochroneData, properties: {},
  });
}

onMounted(() => {
  if (!mapRef.value) return;

  // Register pmtiles protocol before creating map
  registerPmtiles();

  // Register maplibre-contour DemSource (custom protocols for hillshade/contours)
  registerTerrain();

  const cfg = resolveStyle();

  map = new maplibregl.Map({
    container: mapRef.value,
    center: KIROV,
    zoom: 13,
    style: buildStyle(
      cfg.base, cfg.overlays,
      { demTileUrl: demTileUrl ?? undefined, contourTileUrl: contourTileUrl ?? undefined },
    ),
    attributionControl: { compact: true },
  });
  // Dev-only: expose the map so Playwright/inspect can assert paint properties
  // (e.g. catalog dimming when a route is active) without a pixel diff.
  if (import.meta.env.DEV) (window as any).__nearventureMap = map;

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  // Expose for e2e tests (window.mapInstance)
  if (typeof window !== 'undefined') {
    (window as any).mapInstance = map;
  }

  hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });

  // ── Lifecycle resilience (spec §6.3) ─────────────────────────────
  // ResizeObserver: resize map when container changes size (sheet open/close,
  // viewport changes, orientation). Without this, map canvas can stay stale.
  if (typeof ResizeObserver !== 'undefined' && mapRef.value) {
    resizeObserver = new ResizeObserver(() => {
      map?.resize();
    });
    resizeObserver.observe(mapRef.value);
  }

  // WebGL context loss recovery — re-add custom layers on restore.
  map.on('webglcontextlost', () => {
    console.warn('[AdventureMap] WebGL context lost — will attempt recovery');
  });
  map.on('webglcontextrestored', () => {
    console.info('[AdventureMap] WebGL context restored — re-adding layers');
    addCustomLayers();
  });

  // Visibility change — resize on resume (tab switch back, Telegram foreground).
  onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      map?.resize();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Style/tile error listener — log for diagnostics (spec §6.4, §15).
  map.on('error', (e) => {
    const msg = e.error?.message || '';
    if (msg) console.warn('[AdventureMap] map error:', msg);
  });

  map.on('load', () => {
    addCustomLayers();
    applyCatalogDim();
  });

  // ── Interactions ─────────────────────────────────────────────────────
  map.on('click', (e) => {
    // Ignore clicks on POI features (handled by custom-pois layer handler)
    const target = e.originalEvent?.target as HTMLElement | null;
    if (target && target.closest('.maplibregl-popup')) return;
    const poiFeats = map?.queryRenderedFeatures(e.point, { layers: ['custom-pois', 'poi-clusters'] });
    if (poiFeats?.length) return;
    emit('map-click', { lat: e.lngLat.lat, lng: e.lngLat.lng });
  });

  // Cluster click → expand
  map.on('click', 'poi-clusters', (e: any) => {
    const features = e.features; if (!features?.length) return;
    const clusterId = features[0].properties.cluster_id;
    const source = map!.getSource('pois') as maplibregl.GeoJSONSource;
    (source as any).getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
      if (err) return;
      map!.easeTo({ center: (features[0] as any).geometry.coordinates, zoom: Math.min(zoom + 1, 18) });
    });
  });
  map.on('mouseenter', 'poi-clusters', () => { canvas.style.cursor = 'pointer'; });
  map.on('mouseleave', 'poi-clusters', () => { canvas.style.cursor = ''; });
  const canvas = map.getCanvas();
  map.on('mouseenter', 'custom-pois', () => { canvas.style.cursor = 'pointer'; });
  map.on('mousemove', 'custom-pois', (e: any) => {
    if (!e.features?.length) return;
    const f = e.features[0];
    hoverPopup!.setLngLat(f.geometry.coordinates).setHTML(f.properties.name).addTo(map!);
  });
  map.on('mouseleave', 'custom-pois', () => {
    canvas.style.cursor = '';
    hoverPopup!.remove();
  });
  map.on('click', 'custom-pois', (e: any) => {
    if (!e.features?.length) return;
    const id = String(e.features[0].properties.id);
    const poi = poisById.get(id);
    if (poi) {
      lastSelectedId = poi.id;
      emit('poi-select', poi);
    }
  });

  // Debounced map-view emit (drives bbox-based POI fetching in parent)
  map.on('moveend', emitMapView);
});

onBeforeUnmount(() => {
  lastAlternativePreview = null;
  if (moveTimer) clearTimeout(moveTimer);
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (onVisibilityChange) {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    onVisibilityChange = null;
  }
  hoverPopup?.remove();
  startMarker?.remove();
  finishMarker?.remove();
  map?.remove();
  map = null;
});

// ── Reactive watchers ──────────────────────────────────────────────────
watch(() => props.pois, syncPois, { deep: false });
watch(() => props.routeStops, syncRouteStops, { deep: false });
watch(() => props.startPoint, syncStartPoint, { deep: true });
watch(() => props.finishPoint, syncFinishPoint, { deep: true });

watch(() => props.selectedPoiId, (newId) => {
  if (!map || newId == null) return;
  lastSelectedId = newId;
  const poi = props.pois.find((p) => p.id === newId);
  if (poi) {
    map.flyTo({ center: [poi.lon, poi.lat], duration: 600 });
    hoverPopup?.setLngLat([poi.lon, poi.lat]).setHTML(poiName(poi)).addTo(map);
  }
});

// Watch theme — rebuild style to update overlay colors (route, pois, isochrone)
// but PRESERVE the base from styleConfig (layer control), not from UI theme.
watch(
  () => document.documentElement.classList.contains('dark'),
  (dark) => {
    if (!map) return;
    const base = props.styleConfig.base;
    if (base === 'satellite') return;
    const style = buildStyle(base, props.styleConfig.overlays, { demTileUrl: demTileUrl ?? undefined, contourTileUrl: contourTileUrl ?? undefined });
    map.setStyle(style);
    map.once('style.load', addCustomLayers);
  },
);

// Watch styleConfig — rebuild style + re-add custom layers
watch(
  () => props.styleConfig,
  (cfg) => {
    if (!map) return;
    const base = cfg.base;
    const style = buildStyle(base, cfg.overlays, { demTileUrl: demTileUrl ?? undefined, contourTileUrl: contourTileUrl ?? undefined });
    map.setStyle(style);
    map.once('style.load', addCustomLayers);
  },
  { deep: true },
);

// ── Isochrone visibility toggle (separate re-render, no style rebuild) ─
watch(() => props.showIsochrone, (show) => {
  const m = map;
  if (!m) return;
  ['isochrone-fill', 'isochrone-line'].forEach((id) => {
    if (m.getLayer(id)) {
      m.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    }
  });
});

// ── Catalog declutter: dim POI layers while a route is active so the line,
// // start pin and rail carry the story instead of competing with pins. Route
// // stops use their own numbered source above the route line, so dimming
// // catalog pins never hides an itinerary node. Applied after layers are created AND on
// // every change, because routeActive can already be true at mount (draft
// // hydrated before the map) — the watcher alone would miss the initial state.
function applyCatalogDim() {
  const m = map;
  if (!m) return;
  const active = props.routeActive;
  if (m.getLayer('custom-pois')) m.setPaintProperty('custom-pois', 'icon-opacity', active ? 0.35 : 1);
  if (m.getLayer('poi-clusters')) m.setPaintProperty('poi-clusters', 'circle-opacity', active ? 0.3 : 0.7);
  if (m.getLayer('poi-cluster-count')) m.setPaintProperty('poi-cluster-count', 'text-opacity', active ? 0.4 : 1);
}
watch(() => props.routeActive, applyCatalogDim);

// ── Exposed imperative API (called by AdventureView) ───────────────────
function drawRoutePreview(route: { lon: number; lat: number }[]) {
  if (!map) return;
  lastRouteData = route;
  if (!map.getSource('route')) return;
  const coords = route.map((r) => [r.lon, r.lat]);
  (map.getSource('route') as maplibregl.GeoJSONSource).setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {},
  });
  if (coords.length > 1) {
    const bounds = coords.reduce(
      (b, c) => b.extend(c as [number, number]),
      new maplibregl.LngLatBounds(coords[0] as [number, number], coords[1] as [number, number]),
    );
    map.fitBounds(bounds, { padding: 60, duration: 500 });
  }
}

function drawAlternativePreview(route: number[][], stops: Array<{ id: string; name: string; lat: number; lon: number; index: number }>) {
  if (!map) return; lastAlternativePreview = { route, stops };
  (map.getSource('alternative-preview-route') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: route }, properties: {} });
  (map.getSource('alternative-preview-stops') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: stops.map((stop) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] }, properties: { id: stop.id, name: stop.name, index: stop.index } })) });
}
function clearAlternativePreview() {
  lastAlternativePreview = null;
  (map?.getSource('alternative-preview-route') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
  (map?.getSource('alternative-preview-stops') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
}

function clearRoutePreview() {
  if (!map) return;
  lastRouteData = null;
  if (!map.getSource('route')) return;
  (map.getSource('route') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: [],
  });
}

function drawIsochrone(geojson: { type: 'Polygon'; coordinates: number[][][] } | null) {
  if (!map) return;
  lastIsochroneData = geojson;
  if (!map.getSource('isochrone')) return;
  const src = map.getSource('isochrone') as maplibregl.GeoJSONSource;
  if (!geojson) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  src.setData({ type: 'Feature', geometry: geojson, properties: {} });
}

function clearIsochrone() {
  if (!map) return;
  lastIsochroneData = null;
  if (!map.getSource('isochrone')) return;
  (map.getSource('isochrone') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection', features: [],
  });
}

function panTo(latlng: { lat: number; lng: number }) {
  map?.flyTo({ center: [latlng.lng, latlng.lat], duration: 400 });
}

function setZoom(zoom: number) {
  map?.zoomTo(zoom);
}

function flyToBounds(bounds: [number, number][]) {
  if (!map || bounds.length < 2) return;
  const b = bounds.reduce(
    (acc, c) => acc.extend(c),
    new maplibregl.LngLatBounds(bounds[0], bounds[1]),
  );
  map.fitBounds(b, { padding: 60, duration: 800 });
}

defineExpose({ drawRoutePreview, clearRoutePreview, drawAlternativePreview, clearAlternativePreview, drawIsochrone, clearIsochrone, panTo, setZoom, flyToBounds, map });
</script>

<template>
  <div ref="mapRef" id="map" class="adventure-map" aria-label="Карта с точками интереса"></div>
</template>

<style scoped>
.adventure-map {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.nv-startpin {
  cursor: grab;
  filter: drop-shadow(0 4px 6px rgba(35, 25, 20, 0.35));
}
.nv-startpin:active {
  cursor: grabbing;
}
</style>