import { describe, it, expect } from 'vitest';
import { buildStyle, baseFromTheme, DEFAULT_STYLE_CONFIG } from '@/lib/map-styles';
import { CATEGORY_STYLES, DEFAULT_ACTIVE_CATEGORIES, CATEGORY_ORDER, isWaterPoi, poiIcon } from '@/lib/poi-categories';

// ── map-styles.ts ──────────────────────────────────────────────────────

describe('buildStyle()', () => {
  it('returns a valid style object with version 8', () => {
    const style = buildStyle('light');
    expect(style).toBeDefined();
    expect(style.version).toBe(8);
    expect(style.sources).toBeDefined();
    expect(style.layers).toBeInstanceOf(Array);
  });

  it('buildStyle("light") has protomaps source and glyphs', () => {
    const style = buildStyle('light');
    expect(style.sources.protomaps).toBeDefined();
    expect(style.sources.protomaps.type).toBe('vector');
    expect(style.sources.protomaps.url).toContain('pmtiles://');
    // URL is env-driven (VITE_PMTILES_URL); assert it resolves to a .pmtiles
    // resource regardless of default vs CDN override.
    expect(style.sources.protomaps.url).toContain('.pmtiles');
    expect(style.glyphs).toBeDefined();
    expect(style.glyphs).toContain('protomaps.github.io');
  });

  it('buildStyle("dark") uses dark high-contrast flavor and dark sprite', () => {
    const style = buildStyle('dark');
    expect(style.sources.protomaps).toBeDefined();
    expect(style.sprite).toContain('dark');
    expect(style.layers.length).toBeGreaterThan(0);
    const ids = style.layers.map((l: any) => l.id);
    expect(ids).toContain('water');
  });

  it('buildStyle("satellite") returns Esri raster source, no glyphs', () => {
    const style = buildStyle('satellite');
    expect(style.sources.satellite).toBeDefined();
    expect(style.sources.satellite.type).toBe('raster');
    expect(style.sources.satellite.tiles).toBeDefined();
    expect(style.sources.satellite.tiles[0]).toContain('arcgisonline.com');
    expect(style.glyphs).toBeUndefined();
    expect(style.layers[0].id).toBe('satellite');
  });

  it('buildStyle with overlays.cycling adds cyclosm source and layer', () => {
    const style = buildStyle('light', { ...DEFAULT_STYLE_CONFIG.overlays, cycling: true });
    expect(style.sources.cyclosm).toBeDefined();
    expect(style.sources.cyclosm.type).toBe('raster');
    expect(style.sources.cyclosm.tiles[0]).toContain('cyclosm');
    const cyclingLayer = style.layers.find((l: any) => l.id === 'cycling-overlay');
    expect(cyclingLayer).toBeDefined();
    expect(cyclingLayer.source).toBe('cyclosm');
  });

  it('buildStyle with overlays.hiking adds waymarked source and layer', () => {
    const style = buildStyle('light', { ...DEFAULT_STYLE_CONFIG.overlays, hiking: true });
    expect(style.sources.hiking).toBeDefined();
    expect(style.sources.hiking.tiles[0]).toContain('waymarkedtrails');
    const hikingLayer = style.layers.find((l: any) => l.id === 'hiking-overlay');
    expect(hikingLayer).toBeDefined();
  });

  it('buildStyle with overlays.cycling+hiking adds both', () => {
    const style = buildStyle('light', { ...DEFAULT_STYLE_CONFIG.overlays, cycling: true, hiking: true });
    expect(style.sources.cyclosm).toBeDefined();
    expect(style.sources.hiking).toBeDefined();
  });

  it('buildStyle with terrainOpts+hillshade adds dem source and hillshade layer', () => {
    const overlays = { ...DEFAULT_STYLE_CONFIG.overlays, hillshade: true };
    const terrainOpts = { demTileUrl: 'dem://{z}/{x}/{y}', contourTileUrl: 'contours://{z}/{x}/{y}' };
    const style = buildStyle('light', overlays, terrainOpts);
    expect(style.sources.dem).toBeDefined();
    expect(style.sources.dem.type).toBe('raster-dem');
    expect(style.sources.dem.encoding).toBe('terrarium');
    expect(style.sources.dem.tiles[0]).toBe('dem://{z}/{x}/{y}');
    expect(style.sources.contours).toBeDefined();
    expect(style.sources.contours.tiles[0]).toBe('contours://{z}/{x}/{y}');
    const hillshadeLayer = style.layers.find((l: any) => l.id === 'hillshade');
    expect(hillshadeLayer).toBeDefined();
    expect(hillshadeLayer.type).toBe('hillshade');
    expect(style.layers.find((l: any) => l.id === 'contour-lines')).toBeUndefined();
    expect(style.layers.find((l: any) => l.id === 'contour-labels')).toBeUndefined();
  });

  it('buildStyle with overlays.contours adds contour layers but not hillshade', () => {
    const overlays = { ...DEFAULT_STYLE_CONFIG.overlays, contours: true };
    const terrainOpts = { demTileUrl: 'dem://{z}/{x}/{y}', contourTileUrl: 'contours://{z}/{x}/{y}' };
    const style = buildStyle('light', overlays, terrainOpts);
    expect(style.sources.dem).toBeDefined();
    expect(style.sources.contours).toBeDefined();
    expect(style.layers.find((l: any) => l.id === 'hillshade')).toBeUndefined();
    expect(style.layers.find((l: any) => l.id === 'contour-lines')).toBeDefined();
    expect(style.layers.find((l: any) => l.id === 'contour-labels')).toBeDefined();
  });

  it('buildStyle with hillshade+contours adds all terrain layers', () => {
    const overlays = { ...DEFAULT_STYLE_CONFIG.overlays, hillshade: true, contours: true };
    const terrainOpts = { demTileUrl: 'dem://{z}/{x}/{y}', contourTileUrl: 'contours://{z}/{x}/{y}' };
    const style = buildStyle('light', overlays, terrainOpts);
    expect(style.layers.find((l: any) => l.id === 'hillshade')).toBeDefined();
    expect(style.layers.find((l: any) => l.id === 'contour-lines')).toBeDefined();
    expect(style.layers.find((l: any) => l.id === 'contour-labels')).toBeDefined();
  });

  it('buildStyle with hillshade but no terrainOpts falls back to legacy terrain', () => {
    const overlays = { ...DEFAULT_STYLE_CONFIG.overlays, hillshade: true };
    const style = buildStyle('light', overlays);
    expect(style.sources.dem).toBeUndefined();
    expect(style.sources.terrain).toBeDefined();
    expect(style.sources.terrain.type).toBe('raster-dem');
    expect(style.sources.terrain.tiles[0]).toContain('amazonaws.com');
  });

  it('buildStyle("dark") layers include roads_labels_minor minzoom 14', () => {
    const style = buildStyle('dark');
    const minorLabel = style.layers.find((l: any) => l.id === 'roads_labels_minor');
    expect(minorLabel).toBeDefined();
    expect(minorLabel.minzoom).toBe(14);
  });
});

describe('DEFAULT_STYLE_CONFIG', () => {
  it('has correct defaults', () => {
    expect(DEFAULT_STYLE_CONFIG.base).toBe('light');
    expect(DEFAULT_STYLE_CONFIG.overlays.cycling).toBe(false);
    expect(DEFAULT_STYLE_CONFIG.overlays.hiking).toBe(false);
    expect(DEFAULT_STYLE_CONFIG.overlays.hillshade).toBe(false);
    expect(DEFAULT_STYLE_CONFIG.overlays.contours).toBe(false);
  });
});

describe('baseFromTheme', () => {
  it('returns "dark" for true', () => {
    expect(baseFromTheme(true)).toBe('dark');
  });
  it('returns "light" for false', () => {
    expect(baseFromTheme(false)).toBe('light');
  });
});

// ── poi-categories.ts ──────────────────────────────────────────────────

describe('CATEGORY_STYLES', () => {
  it('has all 6 categories', () => {
    const expected = ['heritage', 'monument', 'sights', 'religion', 'nature', 'museum'];
    expect(Object.keys(CATEGORY_STYLES).sort()).toEqual(expected.sort());
  });

  it('each category has required fields', () => {
    for (const [key, cat] of Object.entries(CATEGORY_STYLES)) {
      expect(cat.key).toBe(key);
      expect(cat.label).toBeTruthy();
      expect(cat.labelLong).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(cat.color).toBeTruthy();
      expect(cat.container).toBeTruthy();
    }
  });

  it('hardcoded color values are valid', () => {
    const hexColor = /^#[0-9a-fA-F]{6}$/;
    const cssVarColor = /^rgb\(var\(--nv-/;
    for (const cat of Object.values(CATEGORY_STYLES)) {
      if (cat.color.startsWith('#')) {
        expect(cat.color).toMatch(hexColor);
      } else {
        expect(cat.color).toMatch(cssVarColor);
      }
      if (cat.container.startsWith('#')) {
        expect(cat.container).toMatch(hexColor);
      } else {
        expect(cat.container).toMatch(cssVarColor);
      }
    }
  });

  it('heritage has muted sage-grey', () => {
    expect(CATEGORY_STYLES.heritage.color).toBe('#66736B');
  });

  it('monument has subdued ochre', () => {
    expect(CATEGORY_STYLES.monument.color).toBe('#A87545');
  });

  it('religion has dusty brick', () => {
    expect(CATEGORY_STYLES.religion.color).toBe('#8D5D5B');
  });

  it('museum has muted violet', () => {
    expect(CATEGORY_STYLES.museum.color).toBe('#776B8E');
  });
});

describe('DEFAULT_ACTIVE_CATEGORIES', () => {
  it('has 5 categories (museum is opt-in)', () => {
    expect(DEFAULT_ACTIVE_CATEGORIES).toHaveLength(5);
    expect(DEFAULT_ACTIVE_CATEGORIES).not.toContain('museum');
  });

  it('contains all expected categories', () => {
    expect(DEFAULT_ACTIVE_CATEGORIES).toContain('heritage');
    expect(DEFAULT_ACTIVE_CATEGORIES).toContain('monument');
    expect(DEFAULT_ACTIVE_CATEGORIES).toContain('sights');
    expect(DEFAULT_ACTIVE_CATEGORIES).toContain('religion');
    expect(DEFAULT_ACTIVE_CATEGORIES).toContain('nature');
  });
});

describe('CATEGORY_ORDER', () => {
  it('has 6 categories in defined order', () => {
    expect(CATEGORY_ORDER).toHaveLength(6);
    expect(CATEGORY_ORDER[0]).toBe('heritage');
    expect(CATEGORY_ORDER[5]).toBe('museum');
  });
});

describe('isWaterPoi', () => {
  it('returns false for non-nature category', () => {
    expect(isWaterPoi('heritage', { natural: 'water' })).toBe(false);
    expect(isWaterPoi('monument', { water: 'lake' })).toBe(false);
  });

  it('returns false for nature with null tags', () => {
    expect(isWaterPoi('nature', null)).toBe(false);
  });

  it('returns true for nature with water tag', () => {
    expect(isWaterPoi('nature', { water: 'lake' })).toBe(true);
  });

  it('returns true for nature with natural=water', () => {
    expect(isWaterPoi('nature', { natural: 'water' })).toBe(true);
  });

  it('returns true for nature with natural=spring', () => {
    expect(isWaterPoi('nature', { natural: 'spring' })).toBe(true);
  });

  it('returns true for nature with waterway=waterfall', () => {
    expect(isWaterPoi('nature', { waterway: 'waterfall' })).toBe(true);
  });

  it('returns true for nature with waterway=river', () => {
    expect(isWaterPoi('nature', { waterway: 'river' })).toBe(true);
  });

  it('returns false for nature with unrelated tags', () => {
    expect(isWaterPoi('nature', { natural: 'forest' })).toBe(false);
    expect(isWaterPoi('nature', { landuse: 'grass' })).toBe(false);
  });
});

describe('poiIcon', () => {
  it('returns correct icon and color for heritage', () => {
    const result = poiIcon({ category: 'heritage', tags: null });
    expect(result.icon).toBe('account_balance');
    expect(result.color).toBe('#66736B');
  });

  it('returns correct icon for monument', () => {
    const result = poiIcon({ category: 'monument', tags: null });
    expect(result.icon).toBe('military_tech');
    expect(result.color).toBe('#A87545');
  });

  it('returns correct icon for sights', () => {
    const result = poiIcon({ category: 'sights', tags: null });
    expect(result.icon).toBe('landscape');
  });

  it('returns correct icon for religion', () => {
    const result = poiIcon({ category: 'religion', tags: null });
    expect(result.icon).toBe('church');
    expect(result.color).toBe('#8D5D5B');
  });

  it('returns correct icon for museum', () => {
    const result = poiIcon({ category: 'museum', tags: null });
    expect(result.icon).toBe('museum');
    expect(result.color).toBe('#776B8E');
  });

  it('returns water_drop for water POI', () => {
    const result = poiIcon({ category: 'nature', tags: { natural: 'water' } });
    expect(result.icon).toBe('water_drop');
  });

  it('returns forest icon for non-water nature POI', () => {
    const result = poiIcon({ category: 'nature', tags: { natural: 'forest' } });
    expect(result.icon).toBe('forest');
  });

  it('returns forest icon for nature with null tags', () => {
    const result = poiIcon({ category: 'nature', tags: null });
    expect(result.icon).toBe('forest');
  });
});
