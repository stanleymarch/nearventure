/**
 * PoiRow as returned by the backend GET /api/pois/:id (Postgres poi_product).
 *
 * NOTE: this differs from the legacy web `Poi` type (which has `tags._attr`).
 * The real backend returns flat `attribution` / `provenance` / `imageAttribution`
 * jsonb columns plus a derived `imageSourceNotice` for legacy source context.
 */
export interface PoiDetail {
  id: string;
  category: string;
  subcategory: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Transport source; `external` needs verified per-image metadata. */
  imageSource?: string | null;
  /** Explicit collector-supplied per-image metadata only. */
  imageAttribution: {
    artist?: string;
    license?: string;
    licenseUrl?: string;
    source?: string;
    credit?: string;
    notice?: string;
  } | null;
  /** Neutral source-level context for a legacy image, not image licensing. */
  imageSourceNotice?: {
    source?: string;
    notice?: string;
  } | null;
  lat: number;
  lon: number;
  heritageSignificance: string | null;
  is_protected: boolean | null;
  featured: boolean | null;
  popularityScore: number | null;
  attribution: Record<string, { url?: string; license?: string; notice?: string }> | null;
  provenance: Record<string, string> | null;
  wikidataQid: string | null;
  // Administrative location + construction year (collector pipeline, 2026-07-07).
  region: string | null;
  district: string | null;
  city: string | null;
  year: number | null;
  year_end: number | null;
  yearSource: string | null;
  descSource: string | null;
}

const IMAGE_ATTRIBUTION_FIELDS = ['artist', 'credit', 'source', 'license', 'licenseUrl', 'notice'] as const;

/** Must match the deployed server media policy version. */
export const POI_MEDIA_POLICY_VERSION = '2';

/** Always use a new cache key after a media-policy deployment. */
export function poiMediaUrlById(id: string | number): string {
  return `/api/pois/${encodeURIComponent(String(id))}/media?policy=${POI_MEDIA_POLICY_VERSION}`;
}

/** Client-side contract guard; the backend remains the public-policy authority. */
export function applyPublicImagePolicy<T extends Pick<PoiDetail, 'imageUrl' | 'imageSource' | 'imageAttribution'>>(poi: T): T {
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

export function poiDisplayName(p: PoiDetail): string {
  return p.name || `Объект ${p.id.slice(0, 8)}`;
}

/** Human label for a source key (OSM / Wikidata / ЕГРКН / Wikimedia). */
export const SOURCE_LABELS: Record<string, string> = {
  osm: 'OpenStreetMap',
  egrkn: 'ЕГРКН (Минкультуры РФ)',
  wikidata: 'Wikidata',
  wikimedia: 'Wikimedia Commons',
  wikivoyage: 'Wikivoyage',
  mkrf: 'Минкультуры РФ',
  manual: 'Редакция Nearventure',
};

export const HERITAGE_LABELS: Record<string, string> = {
  federal: 'объект культурного наследия федерального значения',
  regional: 'объект культурного наследия регионального значения',
  local: 'объект культурного наследия местного значения',
};

export function sourceEntries(p: PoiDetail): Array<{ key: string; label: string; url?: string }> {
  const out: Array<{ key: string; label: string; url?: string }> = [];
  const prov = p.provenance || {};
  const attr = p.attribution || {};
  const seen = new Set<string>();

  // Provenance carries per-source urls (osm_url, wikidata_url, …).
  for (const [k, v] of Object.entries(prov)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) {
      const src = k.replace(/_url$|Url$/, '');
      if (seen.has(src)) continue;
      seen.add(src);
      out.push({ key: src, label: SOURCE_LABELS[src] || src, url: v });
    }
  }
  // Attribution block (per-source license/notice).
  for (const [k, v] of Object.entries(attr)) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, label: SOURCE_LABELS[k] || k, url: v?.url });
  }
  // Wikidata qid fallback.
  if (p.wikidataQid && !seen.has('wikidata')) {
    out.push({ key: 'wikidata', label: 'Wikidata', url: `https://www.wikidata.org/wiki/${p.wikidataQid}` });
  }
  return out;
}
