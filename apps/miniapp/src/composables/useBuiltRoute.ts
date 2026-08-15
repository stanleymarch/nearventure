/**
 * The final planned route — produced at basket checkout, consumed by the
 * preview. Module-level `shallowRef` (the GeoJSON object is large and its
 * internals don't need deep reactivity). Survives in-app navigation.
 *
 * `BuiltRoute` mirrors the backend `PlanResult`/`RouteResult` shape (geojson +
 * stats) enriched with the ordered POI list (for the preview's stop cards and
 * the guide's sendLocation sequence).
 */
import { shallowRef } from 'vue';
import type { RoadFact, RouteQuality } from '@shared/api/routing-contracts';

export interface BuiltRoutePoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  order: number;
}

export interface BuiltRoute {
  // Accepts either a GeoJSON Feature (wizard path) or a bare geometry
  // (bot lastRoute path). PreviewMap's extractLineCoordinates unwraps both.
  geojson:
    | { type: 'Feature'; geometry: { type: string; coordinates: number[][] | number[][][] } | null; properties?: unknown }
    | { type: string; coordinates: number[][] | number[][][] }
    | null;
  distance: number; // m
  duration: number; // s
  ascend: number; // m
  descend: number; // m
  profile: string;
  bbox?: [number, number, number, number];
  quality?: RouteQuality;
  roadFacts?: RoadFact[];
  pois: BuiltRoutePoi[];
}

const route = shallowRef<BuiltRoute | null>(null);

export function useBuiltRoute() {
  function get(): BuiltRoute | null {
    return route.value;
  }

  function set(r: BuiltRoute): void {
    route.value = r;
  }

  function clear(): void {
    route.value = null;
  }

  return { route, get, set, clear };
}
