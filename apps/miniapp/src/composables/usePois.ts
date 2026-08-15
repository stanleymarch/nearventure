/**
 * Typed POI list/detail access for the mini-app.
 *
 * The backend `GET /api/pois` returns the real `poi_product` row (string uuid,
 * flat `attribution`/`provenance`/`imageAttribution`) — NOT the legacy web `Poi`
 * (numeric id). We type against the real shape (matches `PoiDetail`) so catalog
 * and basket are type-safe without the legacy drift.
 */
import { api } from '@/api';
import { applyPublicImagePolicy, type PoiDetail } from '@/api/poi-types';
import type { PoiCategory } from '@/lib/poi-categories';

export type PoiRow = Pick<
  PoiDetail,
  | 'id'
  | 'category'
  | 'subcategory'
  | 'name'
  | 'description'
  | 'imageUrl'
  | 'imageSource'
  | 'imageAttribution'
  | 'lat'
  | 'lon'
  | 'heritageSignificance'
  | 'featured'
  | 'popularityScore'
  | 'region'
  | 'district'
  | 'city'
  | 'year'
  | 'year_end'
  | 'yearSource'
  | 'descSource'
>;

export interface PoiListResult {
  items: PoiRow[];
  total: number;
}

export interface PoiQuery {
  category?: PoiCategory | string; // comma-separated list allowed by backend
  search?: string; // ILIKE on name/description
  hasDescription?: boolean; // only POIs with a non-empty description
  hasPhoto?: boolean; // only POIs with a non-empty image_url
  lat?: number;
  lng?: number;
  radius?: number;
  bbox?: string; // "minLng,minLat,maxLng,maxLat"
  limit?: number;
  offset?: number;
  sort?: 'popularity';
  century?: string;
  region?: string;
}

export async function fetchPois(query: PoiQuery = {}): Promise<PoiListResult> {
  const res = await api.get<PoiListResult>('/api/pois', { params: query });
  // Backend may omit desc fields; normalize description alias.
  const items = (res.data.items || []).map((p) => ({
    ...applyPublicImagePolicy(p),
    description: (p as any).description ?? (p as any).descRu ?? null,
  })) as PoiRow[];
  return { items, total: res.data.total ?? items.length };
}

/** Fetch list of unique regions from the POI index. */
export async function fetchRegions(): Promise<string[]> {
  const res = await api.get<{ regions: string[] }>('/api/pois/regions');
  return res.data.regions;
}

/**
 * Reverse-geocode a point to the region the user is in. Used by the
 * wizard to auto-filter out POIs from other regions so the "shop" stays
 * relevant to the user's location. Cached client-side (callers should
 * memoise by `lat|lng|round(100m)`).
 */
export async function fetchRegionAt(
  lat: number,
  lng: number,
): Promise<{ region: string | null; sample: number }> {
  const res = await api.get<{ region: string | null; sample: number }>(
    '/api/pois/region-at',
    { params: { lat, lng } },
  );
  return res.data;
}

/** Fetch a single POI by its uuid (used for deep-link prefill ?poi=). */
export async function fetchPoiById(id: string): Promise<PoiRow | null> {
  try {
    const res = await api.get<PoiDetail>(`/api/pois/${id}`);
    const p = applyPublicImagePolicy(res.data);
    return {
      id: p.id,
      category: p.category,
      subcategory: p.subcategory,
      name: p.name,
      description: p.description ?? (p as any).descRu ?? null,
      imageUrl: p.imageUrl,
      imageSource: p.imageSource,
      imageAttribution: p.imageAttribution,
      lat: p.lat,
      lon: p.lon,
      heritageSignificance: p.heritageSignificance,
      featured: p.featured,
    } as PoiRow;
  } catch {
    return null;
  }
}
