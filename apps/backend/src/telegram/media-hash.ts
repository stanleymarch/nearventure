import { createHash } from 'node:crypto';

/**
 * Short, stable fingerprint for a media URL.
 *
 * Why we hash (not store the URL itself):
 *  - URLs can be long (Wikimedia Commons file pages with query params).
 *  - We only need "did this change?" — sha256 truncated to 8 bytes (16 hex chars)
 *    is plenty (2^64 collision space).
 *  - The hash is paired with `file_unique_id` returned by Telegram, so we can
 *    detect both URL changes (our side) and bot-side re-uploads (Telegram side).
 *
 * Returns '' for null/empty URLs so callers can compare nullable columns
 * without separate guards.
 */
export function hashImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Normalise:
  //  - trim whitespace
  //  - drop fragment (#...)
  //  - sort query params alphabetically
  //  - lowercase protocol+host (case-insensitive per RFC 3986)
  //  - drop trailing slash on the path
  // This avoids spurious "changed" detections on equivalent URLs that
  // servers re-emit in different shapes (e.g. http vs https, reordered
  // tracking params, or added trailing slashes).
  let normalised = url.trim();
  try {
    const u = new URL(normalised);
    // Strip tracking / garbage params before sorting. These are commonly added
    // by link shorteners, email clients, and social media — they don't change
    // the actual image content, so treating them as part of the URL identity
    // creates spurious cache misses.
    const trackingParams = /^utm_|^fbclid$|^gclid$|^gclsrc$|^dclid$|^msclkid$|^ref$|^ref_/;
    const sortedQuery = u.search
      .replace(/^\?/, '')
      .split('&')
      .filter((p) => p.length > 0 && !trackingParams.test(p.split('=')[0]))
      .sort()
      .join('&');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    normalised = `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${
      sortedQuery ? '?' + sortedQuery : ''
    }`;
  } catch {
    // Not a parseable absolute URL — hash the raw string. Local upload markers
    // like '/media/poi/<file>' are stable, so the raw hash is fine.
  }
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

