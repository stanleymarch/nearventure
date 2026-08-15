import api from './index';

export type PoiCategory = 'heritage' | 'monument' | 'sights' | 'religion' | 'nature' | 'museum';

export interface Poi {
  id: string;

  /** Origin pipeline: 'osm' | 'egrkn' | 'wikivoyage' (poi_product.source).
   *  'suggested' is a frontend-only marker for enrichment suggestions. */
  source: string;
  /** External id within the source (OSM node, ЕГРКН reg №, …). Optional. */
  externalId?: string;
  category: PoiCategory;
  tags: Record<string, string> | null;
  lat: number;
  lon: number;
  name: string | null;
  /** Localized name — returned for some rows; poiName() falls back to `name`. */
  nameRu?: string | null;
  descRu: string | null;
  imageUrl: string | null;
  featured: boolean;
  popularityScore: number;
  /** Heritage facet from ЕГРКН: the single authoritative heritage signal. */
  heritageSignificance?: 'federal' | 'regional' | 'local' | null;
  createdAt?: string;
  updatedAt?: string;
  /* ── Extended fields (optional, populated on detail / newer POIs) ── */
  imageSource?: string;
  wikidataQid?: string;
  officialUrl?: string | null;
  socialUrl?: string | null;
  articleUrl?: string | null;
  egrknUrl?: string | null;
  wikivoyageUrl?: string | null;
  is_protected?: boolean;
  provenance?: PoiProvenance;
  attribution?: Record<string, string>;
  /** Explicit collector-supplied per-image metadata only. */
  imageAttribution?: {
    artist?: string;
    credit?: string;
    source?: string;
    license?: string;
    licenseUrl?: string;
    notice?: string;
  } | null;
  /** Neutral source-level context for a legacy image, not image licensing. */
  imageSourceNotice?: {
    source?: string;
    notice?: string;
  } | null;
  /* ── Collector pipeline fields (2026-07-07): location + construction year ── */
  region?: string | null;
  district?: string | null;
  city?: string | null;
  year?: number | null;
  year_end?: number | null;
  yearSource?: string | null;
  descSource?: string | null;
}

/** Provenance blob from poi_product.provenance.
 *  Real production shape (2026-07 refresh):
 *    { facets: ["culture.religious.church"],
 *      sources: ["osm:a1001011770", "osm:w500505885"],
 *      categoryRule: "facet.religious",
 *      geometryPolicy: "osm" }
 *  `sources` is an array of `<source>:<externalId>` refs, NOT a source→url map,
 *  so it is not used for the «Источники» link list (see sourceEntries). */
export interface PoiProvenance {
  facets?: string[];
  /** `<source>:<externalId>` refs, e.g. "osm:w500505885". */
  sources?: string[];
  categoryRule?: string;
  geometryPolicy?: string;
  /** Forward-compat / legacy keys. */
  [key: string]: unknown;
}

/** Reserved-tag keys the ingest layer writes into `tags` for attribution. */
export interface PoiAttribution {
  // tags._attr — per-source attribution block
  [source: string]: { url?: string; license?: string; notice?: string };
}

/** Read the attribution block (tags._attr) if present. */
export function poiAttribution(poi: Poi): Record<string, { url?: string; license?: string; notice?: string; artist?: string; licenseUrl?: string }> {
  if (!poi.tags?._attr) return {};
  try {
    return JSON.parse(poi.tags._attr);
  } catch {
    return {};
  }
}

/** Human label for a source key. */
export const SOURCE_LABELS: Record<string, string> = {
  osm: 'OpenStreetMap',
  egrkn: 'ЕГРКН (Минкультуры РФ)',
  wikidata: 'Wikidata',
  wikimedia: 'Wikimedia Commons',
  wikivoyage: 'Wikivoyage',
  manual: 'Редакция',
};

/** Russian label for heritage significance. */
export const HERITAGE_LABELS: Record<string, string> = {
  federal: 'федерального значения',
  regional: 'регионального значения',
  local: 'местного значения',
};

export interface PoiListResponse {
  items: Poi[];
  total: number;
}

const IMAGE_ATTRIBUTION_FIELDS = ['artist', 'credit', 'source', 'license', 'licenseUrl', 'notice'] as const;

/**
 * Defense in depth for the public POI API contract. The backend is the
 * authority, but a stale/misbehaving response must not make the browser load
 * an external OSM image backed only by flat source attribution.
 */
export function applyPublicImagePolicy<T extends Pick<Poi, 'imageUrl' | 'imageSource' | 'imageAttribution'>>(poi: T): T {
  const hasStructuredAttribution = !!poi.imageAttribution
    && typeof poi.imageAttribution === 'object'
    && IMAGE_ATTRIBUTION_FIELDS.some((field) => {
      const value = poi.imageAttribution?.[field];
      return typeof value === 'string' && value.trim().length > 0;
    });
  const isLocal = typeof poi.imageUrl === 'string' && poi.imageUrl.startsWith('/media/');
  if (poi.imageUrl && poi.imageSource === 'external' && !isLocal && !hasStructuredAttribution) {
    return { ...poi, imageUrl: null, imageAttribution: null };
  }
  return poi;
}

export interface PoiQuery {
  /** Comma-separated category filter (e.g. 'heritage,nature'). */
  category?: string;
  /** Only POIs with a non-empty description. */
  hasDescription?: boolean;
  /** Only POIs with a non-empty image_url. */
  hasPhoto?: boolean;
  lat?: number;
  lng?: number;
  radius?: number;
  bbox?: string;
  limit?: number;
  offset?: number;
  /** Free-text search (matches nameRu, name, descRu). */
  search?: string;
  /** Sort order. 'popularity' → popularity_score DESC; 'name' → name ASC. */
  sort?: 'popularity' | 'name';
  /** Origin pipeline filter: comma-separated (osm,egrkn,wikivoyage). */
  source?: string;
  /** Century filter — comma-separated century numbers, e.g. '19,20' */
  century?: string;
  /** Region filter — exact match on poi_product.region */
  region?: string;
}

/** Localized name for display (ru first in the launch region, else generic name). */
export function poiName(poi: Poi): string {
  return poi.nameRu || poi.name || `POI #${poi.id}`;
}

/** Bump this whenever the server-side media publication policy changes. */
export const POI_MEDIA_POLICY_VERSION = '2';

/** Image URL for display — always uses the policy-versioned media proxy. */
export function poiMediaUrl(poi: Poi): string | null {
  return poiMediaUrlFor(poi);
}

/**
 * Backend media-proxy URL for a POI. The explicit policy version makes a
 * policy deployment a new cache key, so immutable bytes cached for an older
 * policy can never be reused by current clients.
 */
export function poiMediaUrlById(id: string | number): string {
  return `/api/pois/${encodeURIComponent(String(id))}/media?policy=${POI_MEDIA_POLICY_VERSION}`;
}

/**
 * Resolve a display image src for a POI-like object that carries an id +
 * imageUrl (e.g. a route snapshot). Goes through the media proxy when an image
 * exists, else null so the caller falls back to the category icon.
 */
export function poiMediaUrlFor(item: { id: string | number; imageUrl?: string | null }): string | null {
  return item.imageUrl ? poiMediaUrlById(item.id) : null;
}

/** True when the POI has at least one external resource link. */
export function poiHasExternalLinks(poi: Poi): boolean {
  return !!(poi.officialUrl || poi.socialUrl || poi.articleUrl || poi.wikidataQid);
}

/** Check whether a URL points to VKontakte. */
export function isVkUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /vk\.com/i.test(url);
}

/**
 * Build the «Источники» link list for a POI from the real backend fields
 * (poi_product source + per-source url columns). Previous version parsed
 * tags._sources and guessed from provenance keys, which never matched the
 * actual `{source: "osm"}` provenance shape — so most cards showed nothing.
 */
export function sourceEntries(poi: Poi): { key: string; url: string; label: string }[] {
  const entries: { key: string; url: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (key: string, url: string | null | undefined, label?: string) => {
    if (!url || seen.has(key)) return;
    seen.add(key);
    entries.push({ key, url, label: label ?? SOURCE_LABELS[key] ?? key });
  };

  // Per-source URLs come from dedicated columns (wikidataQid, egrknUrl,
  // wikivoyageUrl). provenance.sources is an array of "<src>:<id>" refs, not a
  // source→url map, so it does not contribute direct links here. The origin
  // label itself is rendered separately via poiSourceLabel().
  if (poi.wikidataQid) {
    add('wikidata', `https://www.wikidata.org/wiki/${poi.wikidataQid}`);
  }
  add('egrkn', poi.egrknUrl);
  add('wikivoyage', poi.wikivoyageUrl);

  return entries;
}

/** Short human label for a POI's origin pipeline (catalogue card footer). */
export function poiSourceLabel(poi: Poi): string {
  return SOURCE_LABELS[poi.source] ?? (poi.imageSource ? SOURCE_LABELS[poi.imageSource] ?? poi.imageSource : 'OpenStreetMap');
}

export const getPois = async (query: PoiQuery = {}): Promise<PoiListResponse> => {
  const res = await api.get<PoiListResponse>('/api/pois', { params: query });
  return { ...res.data, items: (res.data.items || []).map(applyPublicImagePolicy) };
};

export const getPoi = async (id: string): Promise<Poi> => {
  const res = await api.get<Poi>(`/api/pois/${id}`);
  return applyPublicImagePolicy(res.data);
};

export const getPoiCount = async (): Promise<{ total: number }> => {
  const res = await api.get<{ total: number }>('/api/pois/count');
  return res.data;
};

/** Fetch list of unique regions from the POI index (PФO regions + Кировская область). */
export const getRegions = async (): Promise<string[]> => {
  const res = await api.get<{ regions: string[] }>('/api/pois/regions');
  return res.data.regions;
};
