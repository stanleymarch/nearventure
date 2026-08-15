import { describe, expect, it } from 'vitest';
import { applyPublicImagePolicy } from './poi-types';

describe('Mini App public POI image contract', () => {
  it('does not expose a flat-ODbL external OSM image URL to the media component', () => {
    const poi = applyPublicImagePolicy({
      imageUrl: 'https://images.openstreetmap.org/kirov/poi-12345.jpg',
      imageSource: 'external',
      imageAttribution: null,
      attribution: { osm: { license: 'ODbL-1.0' } },
    } as any);

    expect(poi.imageUrl).toBeNull();
  });
});
