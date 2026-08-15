import { describe, expect, it } from 'vitest';
import { applyPublicImagePolicy, poiMediaUrl, poiMediaUrlById } from '@/api/pois';

describe('public POI image API contract', () => {
  it('does not pass a production-shaped external OSM URL with flat ODbL to renderers', () => {
    const poi = applyPublicImagePolicy({
      imageUrl: 'https://images.openstreetmap.org/kirov/poi-12345.jpg',
      imageSource: 'external',
      imageAttribution: null,
      attribution: { osm: { license: 'ODbL-1.0', url: 'https://www.openstreetmap.org/copyright' } },
    } as any);

    expect(poi.imageUrl).toBeNull();
  });

  it('retains verified Commons and local images', () => {
    expect(applyPublicImagePolicy({
      imageUrl: 'https://upload.wikimedia.org/verified.jpg',
      imageSource: 'wikimedia_commons',
      imageAttribution: null,
    } as any).imageUrl).toContain('wikimedia');
    expect(applyPublicImagePolicy({
      imageUrl: '/media/poi/admin.webp',
      imageSource: 'external',
      imageAttribution: null,
    } as any).imageUrl).toBe('/media/poi/admin.webp');
  });
});


describe('policy-versioned POI media URLs', () => {
  it('uses a new immutable-cache key instead of the legacy media URL', () => {
    expect(poiMediaUrlById('poi/a')).toBe('/api/pois/poi%2Fa/media?policy=2');
  });

  it('preserves an attributed external image through the proxy, never its raw URL', () => {
    const poi = applyPublicImagePolicy({
      id: 'verified',
      imageUrl: 'https://upload.wikimedia.org/verified.jpg',
      imageSource: 'external',
      imageAttribution: { license: 'CC BY-SA 4.0' },
    } as any);

    expect(poi.imageUrl).toContain('wikimedia');
    expect(poiMediaUrl(poi as any)).toBe('/api/pois/verified/media?policy=2');
  });
});
