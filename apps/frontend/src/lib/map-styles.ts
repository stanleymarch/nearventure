/**
 * Nearventure map styles — Protomaps PMTiles vector basemap.
 *
 * Architecture (the whole point of MapLibre GL JS + Protomaps):
 *   - ONE vector PMTiles file (pfo.pmtiles) served by nginx at /tiles/
 *   - Light/dark/contrast themes = different `namedFlavor` applied to the SAME
 *     vector tiles. Instant theme switch, no tile URL swapping, all programmatic.
 *   - Cycling/hiking overlays = raster tiles layered on top (CyclOSM / Waymarked)
 *   - Terrain = Mapterhorn raster-dem (terrarium encoding) for hillshade
 *
 * The pmtiles:// protocol must be registered once via maplibregl.addProtocol
 * (see registerPmtilesProtocol() — call in main.ts or before first map).
 */
import { layers, namedFlavor } from '@protomaps/basemaps';

/** Protomaps theme shape (the package doesn't export the interface). */
type ProtomapsTheme = ReturnType<typeof namedFlavor>;

// ── Sources ────────────────────────────────────────────────────────────

// PMTiles resource URL. The code below prepends the `pmtiles://` scheme, so this
// must be the BARE resource URL (no `pmtiles://` prefix): a same-origin path in
// prod (`/tiles/pfo.pmtiles`) or an absolute URL (Protomaps CDN). Override via
// VITE_PMTILES_URL at build time.
const PMTILES_URL = import.meta.env.VITE_PMTILES_URL || '/tiles/pfo.pmtiles';
// Cache-busting token. nginx serves /tiles/ with `Cache-Control: immutable,
// max-age=1y`, so to force clients to fetch rebuilt tiles we append `?v=`.
// Set VITE_PMTILES_VERSION to the Protomaps BUILD_DATE at each tile rebuild.
const PMTILES_VERSION = import.meta.env.VITE_PMTILES_VERSION;
const pmtilesEndpoint = PMTILES_VERSION ? `${PMTILES_URL}?v=${PMTILES_VERSION}` : PMTILES_URL;
const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const sprite = (flavor: string) =>
  `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`;

/** Esri World Imagery — satellite (raster fallback, replaces vector base). */
const SATELLITE_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
];
/** CyclOSM — cycling-focused overlay (bike paths, parking, surface). */
const CYCLOSM_TILES = ['https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'];
/** Waymarked Trails — hiking route markings (transparent overlay). */
const HIKING_TILES = ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'];
/** Mapterhorn terrain — raster-dem (terrarium) for hillshade/relief. */
const TERRAIN_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
];

// ── Types ──────────────────────────────────────────────────────────────

export type BaseMapStyle = 'light' | 'dark' | 'satellite';
export type ProtomapsFlavor = 'light' | 'dark' | 'white' | 'black' | 'grayscale';

export interface OverlayOptions {
  cycling: boolean;
  hiking: boolean;
  hillshade: boolean;
  contours: boolean;
}

export interface MapStyleConfig {
  base: BaseMapStyle;
  overlays: { cycling: boolean; hiking: boolean; hillshade: boolean; contours: boolean };
}

export const DEFAULT_STYLE_CONFIG: MapStyleConfig = {
  base: 'light',
  overlays: { cycling: false, hiking: false, hillshade: false, contours: false },
};

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// ── Style builder ──────────────────────────────────────────────────────

export interface MaplibreStyle {
  version: 8;
  glyphs?: string;
  sprite?: string;
  sources: Record<string, any>;
  layers: any[];
  terrain?: any;
}

/**
 * Build a MapLibre style from a base + overlays.
 *
 * - light/dark → Protomaps vector (pmtiles://) with namedFlavor. SAME tiles,
 *   different theme — instant switch, fully programmatic.
 * - satellite → Esri raster (replaces vector base).
 * - Overlays (cycling/hiking/hillshade) layer on top of the base.
 */
/**
 * CyclOSM / OpenTopoMap-inspired theme overlay.
 *
 * Map-first palette principles:
 *   - Quiet stone/sage land; water stays a restrained blue-green.
 *   - Rural tracks are visible in muted sage-grey, not decorative ochre.
 *   - Major roads recede; the planned route is the sole warm signal.
 *   - High-contrast labels on dark base, without neon POI noise.
 */
export function cyclingTheme(base: 'light' | 'dark'): ProtomapsTheme {
  const stock = namedFlavor(base);
  if (base === 'dark') {
    return {
      ...stock,
      background: '#17201d',
      earth: '#1b2621',
      water: '#183b4c',
      // Trails remain legible, but use the same quiet sage family as land.
      other: '#718479',
      tunnel_other: '#2c3a33',
      bridges_other: '#718479',
      pedestrian: '#51645a',
      minor_service: '#45574e',
      minor_a: '#5a6c62',
      minor_b: '#687a70',
      minor_casing: '#26332d',
      // Major roads are navigational structure, not decoration.
      major: '#3c4b44',
      major_casing_early: '#2b3832',
      major_casing_late: '#2b3832',
      highway: '#4a5b51',
      highway_casing_early: '#303e37',
      highway_casing_late: '#303e37',
      link: '#43544b',
      link_casing: '#29362f',
      buildings: '#243029',
      // High-contrast labels.
      city_label: '#f0f0f0', city_label_halo: '#000000',
      subplace_label: '#cfcfcf', subplace_label_halo: '#000000',
      state_label: '#cfcfcf', state_label_halo: '#000000',
      country_label: '#e8e8e8',
      roads_label_major: '#dcdcdc', roads_label_major_halo: '#000000',
      roads_label_minor: '#c4c4c4', roads_label_minor_halo: '#000000',
      ocean_label: '#9fb6e0',
      address_label: '#c4c4c4', address_label_halo: '#000000',
      pois: {
        ...stock.pois,
        tangerine: '#FFB347', // was #F19B6E — brighter amber
        slategray: '#B8B8C8', // was #93939F — lighter cool gray
        blue: '#5BB8D6',
        green: '#4ADE80',
        lapis: '#6080FF',
        pink: '#FF7BC8',
        red: '#FF6B81',
        turquoise: '#22D3EE',
      },
    };
  }
  // Light — quiet map surface: stone/sage land, blue-green water, muted paths.
  return {
    ...stock,
    background: '#f4f6f1',
    earth: '#f1f4ed',
    water: '#a8cfd5',
    // Trails stay readable without turning the map into a beige topographic sheet.
    other: '#91a399',
    tunnel_other: '#dce4da',
    bridges_other: '#91a399',
    pedestrian: '#b7c4b5',
    minor_service: '#d9e1d7',
    minor_a: '#d2dcd1',
    minor_b: '#e4ebe2',
    minor_casing: '#adbcae',
    // Major roads recede behind the route and POIs.
    major: '#ffffff',
    major_casing_early: '#ced9cd',
    major_casing_late: '#ced9cd',
    highway: '#e5ebe3',
    highway_casing_early: '#c1d0c2',
    highway_casing_late: '#c1d0c2',
    link: '#e8eee6',
    link_casing: '#cbd7ca',
    buildings: '#dbe3d9',
  };
}

export function buildStyle(
  base: BaseMapStyle,
  overlays: OverlayOptions = DEFAULT_STYLE_CONFIG.overlays,
  terrainOpts?: { demTileUrl?: string; contourTileUrl?: string },
): MaplibreStyle {
  const sources: Record<string, any> = {};
  let layerList: any[] = [];

  // ── 1. Base ────────────────────────────────────────────────────────
  if (base === 'satellite') {
    sources.satellite = {
      type: 'raster',
      tiles: SATELLITE_TILES,
      tileSize: 256,
      attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
      maxzoom: 19,
    };
    layerList.push({ id: 'satellite', type: 'raster', source: 'satellite', maxzoom: 19 });
  } else {
    // Protomaps vector via pmtiles:// protocol
    sources.protomaps = {
      type: 'vector',
      url: `pmtiles://${pmtilesEndpoint}`,
      attribution: OSM_ATTR,
    };
    if (base === 'dark') {
      layerList = layers('protomaps', cyclingTheme('dark'), { lang: 'ru' });
    } else {
      layerList = layers('protomaps', cyclingTheme('light'), { lang: 'ru' });
    }
    // Street labels start from z15 by default; lower to z14
    layerList.forEach(l => { if (l.id === 'roads_labels_minor') l.minzoom = 14; });
  }

  const style: MaplibreStyle = {
    version: 8,
    sources,
    layers: layerList,
  };
  if (base !== 'satellite') {
    style.glyphs = GLYPHS;
    style.sprite = sprite(base === 'dark' ? 'dark' : 'light');
  }

  // ── 2. Terrain (hillshade + contours) — maplibre-contour DemSource ──
  const needsTerrain = overlays.hillshade || overlays.contours;
  if (needsTerrain && terrainOpts?.demTileUrl) {
    sources.dem = {
      type: 'raster-dem',
      encoding: 'terrarium',
      tiles: [terrainOpts.demTileUrl],
      maxzoom: 13,
      tileSize: 256,
      attribution: 'Terrain © AWS Terrain Tiles (Registry of Open Data on AWS)',
    };
    sources.contours = {
      type: 'vector',
      tiles: [terrainOpts.contourTileUrl],
      maxzoom: 15,
    };
    if (overlays.hillshade) {
      style.layers.push(
        { id: 'hillshade', type: 'hillshade', source: 'dem',
          paint: { 'hillshade-illumination-direction': 315, 'hillshade-illumination-anchor': 'map',
                   'hillshade-exaggeration': 0.8, 'hillshade-shadow-color': '#3a2d1d',
                   'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#000000' } },
      );
    }
    if (overlays.contours) {
      style.layers.push(
        { id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours',
          paint: { 'line-color': 'rgba(40,30,15,0.6)',
                   'line-width': ['match', ['get', 'level'], 0, 1.5, 1, 1.1, 0.7] },
          layout: { 'line-join': 'round', 'line-cap': 'round' } },
        { id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours',
          filter: ['>', ['get', 'level'], 0],
          layout: { 'symbol-placement': 'line', 'symbol-spacing': 300, 'text-size': 11,
                    'text-font': ['Noto Sans Medium'],
                    'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' м'] },
          paint: { 'text-color': base === 'dark' ? '#d4a86a' : '#4a3828',
                   'text-halo-color': base === 'dark' ? '#000000' : '#ffffff',
                   'text-halo-width': 2 } },
      );
    }
  } else if (overlays.hillshade) {
    // Fallback: legacy terrain source (if DemSource wasn't registered)
    sources.terrain = {
      type: 'raster-dem',
      tiles: TERRAIN_TILES,
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 14,
      attribution: 'Terrain © OpenTopoMap / AWS Terrain Tiles',
    };
  }

  // ── 3. Cycling overlay (CyclOSM raster) ────────────────────────────
  if (overlays.cycling) {
    sources.cyclosm = {
      type: 'raster',
      tiles: CYCLOSM_TILES,
      tileSize: 256,
      attribution: `${OSM_ATTR}, CyclOSM`,
      maxzoom: 17,
    };
    style.layers.push({
      id: 'cycling-overlay',
      type: 'raster',
      source: 'cyclosm',
      maxzoom: 17,
      paint: { 'raster-opacity': 0.55 },
    });
  }

  // ── 4. Hiking overlay (Waymarked Trails raster) ────────────────────
  if (overlays.hiking) {
    sources.hiking = {
      type: 'raster',
      tiles: HIKING_TILES,
      tileSize: 256,
      attribution: `${OSM_ATTR}, Waymarked Trails`,
      maxzoom: 16,
    };
    style.layers.push({
      id: 'hiking-overlay',
      type: 'raster',
      source: 'hiking',
      maxzoom: 16,
      paint: { 'raster-opacity': 0.7 },
    });
  }

  return style;
}

/** Derive base from app theme. */
export function baseFromTheme(isDark: boolean): BaseMapStyle {
  return isDark ? 'dark' : 'light';
}