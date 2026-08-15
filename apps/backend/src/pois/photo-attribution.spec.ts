import { describe, expect, it } from 'vitest';
import { normalizePhotoAttribution } from './photo-attribution';

describe('normalizePhotoAttribution', () => {
  it('keeps legacy source metadata out of per-image attribution', () => {
    const poi = normalizePhotoAttribution({
      imageUrl: 'https://all.culture.ru/photo.jpg',
      imageAttribution: null,
      imageSource: null,
      provenance: { image: 'mkrf' },
      attribution: {
        mkrf: {
          label: 'Музеи/Парки (Минкультуры)',
          license: 'Открытые данные РФ',
          notice: 'Минкультуры РФ — museums',
          url: 'https://all.culture.ru/',
        },
      },
    });

    expect(poi.imageAttribution).toBeNull();
    expect(poi.imageSourceNotice).toEqual({
      source: 'Музеи/Парки (Минкультуры)',
      notice: 'Минкультуры РФ — museums · Открытые данные РФ',
    });
  });

  it('suppresses a production-shaped external OSM image URL with flat ODbL only', () => {
    const imageUrl = 'https://images.openstreetmap.org/kirov/poi-12345.jpg';
    const poi = normalizePhotoAttribution({
      imageUrl,
      imageAttribution: null,
      imageSource: 'external',
      provenance: { image: 'osm' },
      attribution: {
        osm: {
          label: 'OpenStreetMap',
          license: 'ODbL-1.0',
          url: 'https://www.openstreetmap.org/copyright',
        },
      },
    });

    expect(poi.imageUrl).toBeNull();
    expect(poi.imageAttribution).toBeNull();
    expect(poi.imageSourceNotice).toBeNull();
    expect(poi.attribution?.osm.license).toBe('ODbL-1.0');
  });

  it('suppresses an external image whose only attribution self-labels as unverified', () => {
    const poi = normalizePhotoAttribution({
      imageUrl: 'https://i.postimg.cc/g05H62NG/image.jpg',
      imageAttribution: { license: 'External (license unverified)', attribution: 'OpenStreetMap image reference' },
      imageSource: 'external',
      provenance: { image: 'osm' },
      attribution: null,
    });

    expect(poi.imageUrl).toBeNull();
    expect(poi.imageAttribution).toBeNull();
    expect(poi.imageSourceNotice).toBeNull();
  });

  it('preserves structured external attribution and local admin uploads', () => {
    const imageAttribution = {
      artist: 'Ivan Petrov',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    };
    const verifiedExternal = {
      imageUrl: 'https://images.openstreetmap.org/kirov/verified.jpg',
      imageAttribution,
      imageSource: 'external',
      provenance: null,
      attribution: null,
    };
    const localUpload = {
      imageUrl: '/media/poi/admin-upload.webp',
      imageAttribution: null,
      imageSource: 'external',
      provenance: null,
      attribution: null,
    };

    expect(normalizePhotoAttribution(verifiedExternal)).toBe(verifiedExternal);
    expect(normalizePhotoAttribution(localUpload)).toBe(localUpload);
  });

  it('suppresses an external image when legacy metadata is unavailable', () => {
    const poi = {
      imageUrl: 'https://example.test/photo.jpg',
      imageAttribution: null,
      imageSource: 'external',
      provenance: null,
      attribution: {
        external: { url: 'https://example.test/photo.jpg' },
      },
    };

    const normalized = normalizePhotoAttribution(poi);
    expect(normalized.imageUrl).toBeNull();
    expect(normalized.imageAttribution).toBeNull();
  });
});
