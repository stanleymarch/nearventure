import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { poiCardHtml, TelegramPoiCardService } from './poi-card.service';
import { hashImageUrl } from './media-hash';

/**
 * Behaviour tests for the cache-staleness logic in sendPoiCard:
 *  - cache hit + same hash → re-use file_id (no upload)
 *  - cache hit + hash drift → drop cache, re-upload
 *  - cache hit + send throws → drop cache, re-upload
 *  - cache miss → upload + store with both file_id and file_unique_id
 *
 * Telegram API is mocked: we never hit the network. PoisService is mocked for
 * image fetch.
 */

const POI_UUID = 'abcdef0123456789';
const POI_URL = 'https://example.com/poi.jpg';
const FILE_ID = 'AgACAgIAAxkBAAI';
const FILE_UNIQUE_ID = 'AQAD1234';

type CacheRow = {
  poi_uuid: string;
  file_id: string;
  file_unique_id: string | null;
  image_url_hash: string | null;
  image_url: string | null;
  created_at?: Date;
  updated_at?: Date;
};

function makePoisService(poi: any, jpeg: Buffer | null) {
  return {
    byId: vi.fn().mockResolvedValue(poi),
    getMediaJpegBuffer: vi.fn().mockResolvedValue(jpeg),
  } as any;
}

function makeRepo() {
  const rows = new Map<string, CacheRow>();
  return {
    findOne: vi.fn(({ where }: any) =>
      Promise.resolve(where?.poi_uuid ? rows.get(where.poi_uuid) ?? null : null),
    ),
    // Keep a delete-by-criteria helper for direct repo.delete({poi_uuid}) calls.
    save: vi.fn((row: CacheRow) => {
      rows.set(row.poi_uuid, { ...rows.get(row.poi_uuid), ...row });
      return Promise.resolve(row);
    }),
    insert: vi.fn((row: CacheRow) => {
      rows.set(row.poi_uuid, row);
      return Promise.resolve();
    }),
    delete: vi.fn((criteria: any) => {
      const had = rows.delete(criteria?.poi_uuid);
      return Promise.resolve({ affected: had ? 1 : 0 });
    }),
    _rows: rows,
  } as any;
}

function makeApi(photoBehaviour: (fileIdOrBuf: any) => Promise<any>) {
  return {
    sendPhoto: vi.fn(photoBehaviour),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as any;
}

function makePoi(imageUrl: string) {
  return {
    id: POI_UUID,
    name: 'Test POI',
    category: 'heritage',
    imageUrl,
    lat: 58.6,
    lon: 49.6,
    descRu: null,
    region: null,
    district: null,
    city: null,
    year: null,
    year_end: null,
  };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe('TelegramPoiCardService — cache versioning', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: TelegramPoiCardService;

  beforeEach(() => {
    repo = makeRepo();
    service = new TelegramPoiCardService(makePoisService(makePoi(POI_URL), JPEG), repo);
  });

  it('uploads on cache miss and stores both file_id and file_unique_id', async () => {
    const api = makeApi(async () => ({
      message_id: 1,
      photo: [
        { file_id: 'small', file_unique_id: 'uniq-small' },
        { file_id: FILE_ID, file_unique_id: FILE_UNIQUE_ID },
      ],
    }));

    await service.sendPoiCard(api, 123, POI_UUID);

    expect(api.sendPhoto).toHaveBeenCalledTimes(1);
    const sentArg = (api.sendPhoto as Mock).mock.calls[0][1];
    // InputFile object (not a file_id) — i.e. we uploaded
    expect(typeof sentArg).toBe('object');
    expect(repo.insert).toHaveBeenCalledTimes(1);
    const stored = repo._rows.get(POI_UUID);
    expect(stored?.file_id).toBe(FILE_ID);
    expect(stored?.file_unique_id).toBe(FILE_UNIQUE_ID);
    expect(stored?.image_url_hash).toBe(hashImageUrl(POI_URL));
    expect(stored?.image_url).toBe(POI_URL);
  });

  it('reuses cached file_id when imageUrl hash matches', async () => {
    // Pre-populate cache
    const cachedHash = hashImageUrl(POI_URL);
    repo._rows.set(POI_UUID, {
      poi_uuid: POI_UUID,
      file_id: FILE_ID,
      file_unique_id: FILE_UNIQUE_ID,
      image_url_hash: cachedHash,
      image_url: POI_URL,
    });

    const api = makeApi(async () => ({
      message_id: 2,
      photo: [{ file_id: FILE_ID, file_unique_id: FILE_UNIQUE_ID }],
    }));

    await service.sendPoiCard(api, 123, POI_UUID);

    // Used cached file_id, not an InputFile
    expect(api.sendPhoto).toHaveBeenCalledTimes(1);
    expect((api.sendPhoto as Mock).mock.calls[0][1]).toBe(FILE_ID);
    // No new insert / save
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('drops cache and re-uploads when imageUrl hash drifts', async () => {
    // Cache says we uploaded from URL_A, but POI now has URL_B
    const oldHash = hashImageUrl('https://example.com/old.jpg');
    repo._rows.set(POI_UUID, {
      poi_uuid: POI_UUID,
      file_id: FILE_ID,
      file_unique_id: FILE_UNIQUE_ID,
      image_url_hash: oldHash,
      image_url: 'https://example.com/old.jpg',
    });

    const api = makeApi(async () => ({
      message_id: 3,
      photo: [
        { file_id: 'small', file_unique_id: 'uniq-small' },
        { file_id: 'new-file-id', file_unique_id: 'new-unique' },
      ],
    }));

    await service.sendPoiCard(api, 123, POI_UUID);

    expect(repo.delete).toHaveBeenCalledWith({ poi_uuid: POI_UUID });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    const stored = repo._rows.get(POI_UUID);
    expect(stored?.file_id).toBe('new-file-id');
    expect(stored?.image_url_hash).toBe(hashImageUrl(POI_URL));
  });

  it('drops cache and re-uploads when sendPhoto with cached file_id throws', async () => {
    // Cache is fresh (hash matches), but Telegram-side file_id is gone
    repo._rows.set(POI_UUID, {
      poi_uuid: POI_UUID,
      file_id: 'stale-file-id',
      file_unique_id: FILE_UNIQUE_ID,
      image_url_hash: hashImageUrl(POI_URL),
      image_url: POI_URL,
    });

    let callIndex = 0;
    const api = makeApi(async () => {
      callIndex++;
      if (callIndex === 1) {
        // First call: cached file_id → reject (simulating Telegram rotation)
        throw new Error('400 Bad Request: wrong file_id');
      }
      // Second call: re-upload succeeds
      return {
        message_id: 4,
        photo: [{ file_id: 'fresh-file-id', file_unique_id: 'fresh-unique' }],
      };
    });

    await service.sendPoiCard(api, 123, POI_UUID);

    expect(api.sendPhoto).toHaveBeenCalledTimes(2);
    expect((api.sendPhoto as Mock).mock.calls[0][1]).toBe('stale-file-id');
    expect(typeof (api.sendPhoto as Mock).mock.calls[1][1]).toBe('object'); // InputFile
    const stored = repo._rows.get(POI_UUID);
    expect(stored?.file_id).toBe('fresh-file-id');
  });

  it('treats legacy cache (no image_url_hash) as stale and re-uploads', async () => {
    // Simulate an old row that predates the image_url_hash column
    repo._rows.set(POI_UUID, {
      poi_uuid: POI_UUID,
      file_id: 'legacy-file-id',
      file_unique_id: null,
      image_url_hash: null,
      image_url: null,
    });

    const api = makeApi(async () => ({
      message_id: 5,
      photo: [{ file_id: 'fresh', file_unique_id: 'uniq' }],
    }));

    await service.sendPoiCard(api, 123, POI_UUID);

    expect(repo.delete).toHaveBeenCalledWith({ poi_uuid: POI_UUID });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    const stored = repo._rows.get(POI_UUID);
    expect(stored?.image_url_hash).toBe(hashImageUrl(POI_URL));
  });

  it('renders a legacy source notice without an image-license claim in the Telegram caption', () => {
    const caption = poiCardHtml({
      ...makePoi(POI_URL),
      imageAttribution: null,
      imageSourceNotice: {
        source: 'OpenStreetMap',
        notice: 'ODbL-1.0',
      },
    });

    expect(caption).toContain('📷 Источник изображения: OpenStreetMap · Сведения об источнике: ODbL-1.0');
    expect(caption).not.toContain('Лицензия:');
  });

  it('does not reuse cached Telegram media after the public image policy suppresses a URL', async () => {
    const suppressedPoi = {
      ...makePoi(null as any),
      imageSource: 'external',
      imageAttribution: null,
    };
    const suppressedService = new TelegramPoiCardService(makePoisService(suppressedPoi, null), repo);
    repo._rows.set(POI_UUID, {
      poi_uuid: POI_UUID,
      file_id: FILE_ID,
      file_unique_id: FILE_UNIQUE_ID,
      image_url_hash: hashImageUrl(POI_URL),
      image_url: POI_URL,
    });
    const api = makeApi(async () => ({}));

    await suppressedService.sendPoiCard(api, 123, POI_UUID);

    expect(api.sendPhoto).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledOnce();
    expect(repo.delete).toHaveBeenCalledWith({ poi_uuid: POI_UUID });
  });

  it('falls back to text card when POI has no image', async () => {
    // POI without imageUrl
    const noImgService = new TelegramPoiCardService(
      makePoisService(makePoi(null), null),
      repo,
    );
    const api = makeApi(async () => ({}));

    await noImgService.sendPoiCard(api, 123, POI_UUID);

    expect(api.sendPhoto).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('describeCache returns current and stored state', async () => {
    repo._rows.set(POI_UUID, {
      poi_uuid: POI_UUID,
      file_id: FILE_ID,
      file_unique_id: FILE_UNIQUE_ID,
      image_url_hash: hashImageUrl(POI_URL),
      image_url: POI_URL,
    });

    const desc = await service.describeCache(POI_UUID);
    expect(desc.cached).toBe(true);
    expect(desc.file_id).toBe(FILE_ID);
    expect(desc.image_url_hash).toBe(hashImageUrl(POI_URL));
    expect(desc.current_url_hash).toBe(hashImageUrl(POI_URL));
  });

  it('describeCache flags drift', async () => {
    repo._rows.set(POI_UUID, {
      poi_uuid: POI_UUID,
      file_id: FILE_ID,
      file_unique_id: FILE_UNIQUE_ID,
      image_url_hash: hashImageUrl('https://example.com/old.jpg'),
      image_url: 'https://example.com/old.jpg',
    });

    const desc = await service.describeCache(POI_UUID);
    expect(desc.cached).toBe(true);
    expect(desc.image_url_hash).not.toBe(desc.current_url_hash);
  });
});
