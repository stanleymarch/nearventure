/* MapLibre GL JS source/layer helpers for Nearventure data layers. */
import type { Map } from 'maplibre-gl';

// ── Source IDs ──
export const SOURCES = {
  pois: 'nearventure-pois',
  clusters: 'nearventure-clusters',
  route: 'nearventure-route',
  isochrone: 'nearventure-isochrone',
  start: 'nearventure-start',
  suggestions: 'nearventure-suggestions',
} as const;

// ── Layer IDs ──
export const LAYERS = {
  pois: 'nearventure-pois-circle',
  poisLabel: 'nearventure-pois-label',
  cluster: 'nearventure-cluster-circle',
  clusterCount: 'nearventure-cluster-count',
  selectedPoi: 'nearventure-selected-poi',
  route: 'nearventure-route-line',
  routeOutline: 'nearventure-route-outline',
  isochrone: 'nearventure-isochrone-fill',
  isochroneOutline: 'nearventure-isochrone-outline',
  start: 'nearventure-start-marker',
  suggestions: 'nearventure-suggestions-circle',
} as const;

/** Create or update a GeoJSON source. Call whenever data changes. */
export function setSource(map: Map, id: string, data: GeoJSON.GeoJSON): void {
  const existing = map.getSource(id);
  if (existing) {
    (existing as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data });
  }
}

/** Remove a source and its dependent layers. */
export function removeSource(map: Map, id: string): void {
  // Remove dependent layers first
  const layers = map.getStyle().layers ?? [];
  for (const layer of layers) {
    if (layer.source === id && layer.id) {
      map.removeLayer(layer.id);
    }
  }
  if (map.getSource(id)) {
    map.removeSource(id);
  }
}
