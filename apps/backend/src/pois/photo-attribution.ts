export interface ImageAttribution {
  artist?: string;
  credit?: string;
  source?: string;
  license?: string;
  licenseUrl?: string;
  notice?: string;
}

/** Source-level context for a legacy image; this is not image attribution. */
export interface ImageSourceNotice {
  source?: string;
  notice?: string;
}

export interface LegacyAttribution {
  label?: string;
  license?: string;
  notice?: string;
  // A legacy URL identifies a data source, not necessarily an image license.
  // Keep it out of the photo contract until the collector supplies a verified
  // per-image license URL.
  url?: string;
}

export interface PhotoAttributionRow {
  imageUrl: string | null;
  imageAttribution: ImageAttribution | null;
  imageSourceNotice?: ImageSourceNotice | null;
  imageSource: string | null;
  provenance: Record<string, unknown> | null;
  attribution: Record<string, LegacyAttribution> | null;
}

const IMAGE_ATTRIBUTION_FIELDS: Array<keyof ImageAttribution> = [
  'artist', 'credit', 'source', 'license', 'licenseUrl', 'notice',
];

/**
 * Explicit data in image_attribution is producer-verified per-image evidence
 * (or an authenticated admin override), unlike the flat source attribution.
 */
export function hasStructuredImageAttribution(value: unknown): value is ImageAttribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attribution = value as Record<string, unknown>;
  // The upstream collector tags generic OSM references as
  // «External (license unverified)». Such a self-declared unverified label is
  // not publishable per-image evidence, so it does not count as structured.
  const unverified = IMAGE_ATTRIBUTION_FIELDS.some(
    (field) => typeof attribution[field] === 'string' && /unverified/i.test(attribution[field] as string),
  );
  if (unverified) return false;
  return IMAGE_ATTRIBUTION_FIELDS.some((field) => nonEmpty(attribution[field]));
}

function isLocalImageUrl(value: string): boolean {
  return value.startsWith('/media/');
}

const SOURCE_KEY_ALIASES: Record<string, string[]> = {
  wikimedia_commons: ['wikimedia_commons', 'wikimedia', 'commons', 'wikidata'],
  wikimedia: ['wikimedia', 'commons', 'wikimedia_commons', 'wikidata'],
  commons: ['commons', 'wikimedia', 'wikimedia_commons', 'wikidata'],
};

/**
 * Keeps imageAttribution exclusively for collector-supplied per-image metadata.
 * Older rows have source-level data only, which is exposed separately as a
 * neutral source notice. In particular, a source-level ODbL entry never becomes
 * a license claim about the image.
 */
export function normalizePhotoAttribution<T extends PhotoAttributionRow>(poi: T): T {
  // Public-release policy: a generic external image reference from an OSM row
  // is not publishable evidence. Flat source attribution (including ODbL) is
  // attribution for the dataset, not verification of this image. Local admin
  // uploads and non-external sources retain their established behavior.
  if (poi.imageUrl && poi.imageSource === 'external' && !isLocalImageUrl(poi.imageUrl)
      && !hasStructuredImageAttribution(poi.imageAttribution)) {
    return { ...poi, imageUrl: null, imageAttribution: null, imageSourceNotice: null };
  }

  if (poi.imageAttribution != null || poi.imageSourceNotice != null || !poi.imageUrl || !poi.attribution) return poi;

  const legacy = legacyAttributionForImage(poi.attribution, poi.provenance, poi.imageSource);
  if (!legacy) return poi;

  const imageSourceNotice: ImageSourceNotice = {};
  if (nonEmpty(legacy.label)) imageSourceNotice.source = legacy.label;
  const notice = sourceNotice(legacy);
  if (notice) imageSourceNotice.notice = notice;

  return Object.keys(imageSourceNotice).length ? { ...poi, imageSourceNotice } : poi;
}

function legacyAttributionForImage(
  attribution: Record<string, LegacyAttribution>,
  provenance: Record<string, unknown> | null,
  imageSource: string | null,
): LegacyAttribution | null {
  // provenance.image records the origin of this specific image and takes
  // precedence over a generic transport value such as "external".
  for (const sourceKey of [imageSourceFromProvenance(provenance), imageSource]) {
    if (!sourceKey) continue;
    for (const key of SOURCE_KEY_ALIASES[sourceKey] || [sourceKey]) {
      const entry = attribution[key];
      if (entry && typeof entry === 'object') return entry;
    }
  }
  return null;
}

function imageSourceFromProvenance(provenance: Record<string, unknown> | null): string | null {
  const source = provenance?.image;
  return nonEmpty(source) ? source : null;
}

function sourceNotice(legacy: LegacyAttribution): string | null {
  const parts = [legacy.notice, legacy.license].filter(nonEmpty);
  return parts.length ? parts.join(' · ') : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
