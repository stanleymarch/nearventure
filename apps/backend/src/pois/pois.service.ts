import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QueryPoiDto } from './dto/query-poi.dto';
import { PoiCategory } from './entities/poi.entity';
import { PoiOverride } from './entities/poi-override.entity';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import * as process from 'process';
import { RemoteImageFetcherService } from './remote-image-fetcher.service';
import { ImageAttribution, normalizePhotoAttribution } from './photo-attribution';

export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * Base POI columns from poi_product (aliased for the PoiRow interface).
 * The raw names are used as fallback inputs for COALESCE.
 */
const POI_COLUMNS_BASE = [
  'pp.poi_uuid AS id',
  'pp.category',
  'pp.subcategory',
  'pp.name',
  'pp.description',
  'pp.image_url',
  'pp.lat',
  'pp.lon',
  'pp.heritage_facet',
  'pp.is_protected',
  'pp.featured',
  'pp.popularity_score',
  'pp.attribution',
  'pp.provenance',
  // pp.wikidata_qid is the legacy column name in poi_product; for the
  // resolved QID we fall back to the provenance JSON blob below.
  'pp.wikidata_qid',
].join(', ');

/**
 * Merged POI columns: pipeline values win unless overridden.
 * Override fields shadow the corresponding poi_product columns,
 * while non-overrideable metadata (category, geom, provenance) comes
 * straight from poi_product.
 */
const POI_COLUMNS_MERGED = [
  'pp.poi_uuid AS id',
  'pp.category',
  'pp.subcategory',
  // Origin pipeline (poi_product.source): osm | egrkn | wikivoyage.
  // Exposed so the catalogue can filter/label by real provenance instead of
  // the previous client-side heuristic that never matched.
  'pp.source',
  'pp.external_id AS "externalId"',
  'COALESCE(po.display_name, pp.name) AS "name"',
  'COALESCE(po.description, pp.description) AS "descRu"',
  'COALESCE(po.description, pp.description) AS "description"', // backward-compat for miniapp (reads `description`), web reads `descRu`
  // Bug B2 (REPORT.md): some ЕГРКН-originated rows still have the registry
  // EGRKN photo.url (okn-mk.mkrf.ru/maps/show/id/XXX) is a DIRECT JPEG (Content-Type: image/jpeg),
  // not a registry page. The poi-toolkit confirmed this — no need to strip anymore.
  `COALESCE(po.image_url, pp.image_url) AS "imageUrl"`,
  'COALESCE(po.image_attribution, pp.image_attribution) AS "imageAttribution"',
  'pp.lat',
  'pp.lon',
  'pp.heritage_facet AS "heritageSignificance"',
  'pp.is_protected',
  'pp.featured',
  'pp.popularity_score AS "popularityScore"',
  'pp.attribution',
  'pp.provenance',
  // Resolve the QID for the frontend's "Wikidata" button. Two sources:
  //   1. pp.wikidata_qid (legacy plain column; may be NULL on newer rows)
  //   2. pp.provenance->>'wikidata' — JSONB with the full URL,
  //      e.g. "https://www.wikidata.org/wiki/Q12345"
  // The first non-null wins.
  `COALESCE(
     NULLIF(pp.wikidata_qid, ''),
     CASE
       WHEN pp.provenance->>'wikidata' LIKE '%/Q%'
         THEN substring(pp.provenance->>'wikidata' FROM 'Q[0-9]+$')
       ELSE NULL
     END
   ) AS "wikidataQid"`,
  // enrichment links / provenance (pipeline→frontend «подробнее» + image licensing)
  'pp.official_url AS "officialUrl"',
  'pp.social_url AS "socialUrl"',
  'pp.image_source AS "imageSource"',
  'pp.article_url AS "articleUrl"',
  'pp.wikivoyage_url AS "wikivoyageUrl"',
  // Same defensive null for egrknUrl: if we end up here from a legacy row
  // where the registry page got stored in image_url, fall back to that URL
  // so the «ЕГРКН» button on the POI card still has somewhere to go.
  `COALESCE(
     pp.egrkn_url,
     CASE
       WHEN COALESCE(po.image_url, pp.image_url) LIKE 'https://okn-mk.mkrf.ru/%'
         THEN COALESCE(po.image_url, pp.image_url)
       ELSE NULL
     END
   ) AS "egrknUrl"`,
  // Administrative location (assigned by collector's admin-boundary step).
  'pp.region',
  'pp.district',
  'pp.city',
  // Construction / inception year (optional start..end range + provenance).
  'pp.year',
  'pp.year_end',
  'pp.year_source AS "yearSource"',
  'pp.desc_source AS "descSource"',
  '(po.poi_uuid IS NOT NULL) AS "isOverridden"',
].join(', ');

const FROM_WITH_JOIN =
  'FROM poi_product pp LEFT JOIN poi_overrides po ON pp.poi_uuid = po.poi_uuid';

/**
 * Directory for locally cached/media POI images.
 * Can be overridden via MEDIA_DIR env var.
 */
const MEDIA_DIR = process.env.MEDIA_DIR || join(process.cwd(), 'media', 'poi');

export interface PoiRow {
  id: string;
  category: string;
  subcategory: string | null;
  source: string | null;
  externalId: string | null;
  name: string | null;
  descRu: string | null;
  description: string | null; // backward-compat for miniapp (reads `description`), web reads `descRu`
  imageUrl: string | null;
  /** Collector-supplied per-image attribution only. */
  imageAttribution: ImageAttribution | null;
  /** Neutral source-level context for legacy images; never an image license. */
  imageSourceNotice?: { source?: string; notice?: string } | null;
  lat: number | null;
  lon: number | null;
  heritageSignificance: string | null;
  is_protected: boolean | null;
  featured: boolean | null;
  popularityScore: number | null;
  attribution: Record<string, { label?: string; license?: string; notice?: string; url?: string }> | null;
  provenance: Record<string, unknown> | null;
  wikidataQid: string | null;
  // enrichment links / provenance
  officialUrl: string | null;
  socialUrl: string | null;
  imageSource: string | null;
  articleUrl: string | null;
  wikivoyageUrl: string | null;
  egrknUrl: string | null;
  // Administrative location + construction year (populated by collector pipeline).
  region: string | null;
  district: string | null;
  city: string | null;
  year: number | null;
  year_end: number | null;
  yearSource: string | null;
  descSource: string | null;
  isOverridden: boolean;
}

export interface PoiOverrideData {
  display_name?: string | null;
  description?: string | null;
  image_url?: string | null;
  image_attribution?: Record<string, any> | null;
  osm_contributor?: string | null;
  updated_by?: string;
}

function isValidCategory(cat: string): cat is PoiCategory {
  return ['heritage', 'monument', 'sights', 'religion', 'nature', 'museum'].includes(cat);
}

@Injectable()
export class PoisService implements OnModuleInit {
  private readonly logger = new Logger(PoisService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PoiOverride)
    private readonly overrideRepo: Repository<PoiOverride>,
    private readonly remoteImageFetcher: RemoteImageFetcherService,
  ) {}

  async onModuleInit() {
    // Ensure the media directory exists
    try {
      await fs.mkdir(MEDIA_DIR, { recursive: true });
      this.logger.log(`Media directory ready: ${MEDIA_DIR}`);
    } catch (e: any) {
      this.logger.warn(`Could not create media dir ${MEDIA_DIR}: ${e.message}`);
    }
    this.logger.log('PoisService initialized with poi_product + poi_overrides');
  }

  /**
   * Internal, bounded rows-only acquisition for loop return-leg scoring.
   * This deliberately is not the catalogue query: one stable SELECT, no count
   * or pagination. Abort is cooperative; PostgreSQL statement_timeout bounds
   * an already-running query because TypeORM exposes no portable query cancel.
   */
  async findReturnLegCandidates(
    bbox: [number, number, number, number], limit: number, signal?: AbortSignal, deadline?: number,
  ): Promise<Array<{ id: string; lat: number; lon: number; popularityScore: number | null }>> {
    if (signal?.aborted || limit > 120) return [];
    const runner = this.dataSource.createQueryRunner();
    let transactionStarted = false;
    try {
      await runner.connect();
      await runner.startTransaction();
      transactionStarted = true;
      const remaining = Math.max(1, Math.floor((deadline ?? Date.now() + 800) - Date.now()));
      await runner.query(`SET LOCAL statement_timeout = '${remaining}ms'`);
      let result: Array<{ id: string; lat: number; lon: number; popularityScore: number | null }> = [];
      if (!signal?.aborted) {
        const rows = await runner.query(
          `SELECT poi_uuid AS id, lat, lon, popularity_score AS "popularityScore"
           FROM poi_product WHERE is_active = true AND lon BETWEEN $1 AND $2 AND lat BETWEEN $3 AND $4
           ORDER BY popularity_score DESC NULLS LAST, poi_uuid ASC LIMIT $5`,
          [bbox[0], bbox[2], bbox[1], bbox[3], limit],
        );
        if (!signal?.aborted) result = rows;
      }
      // Even a cooperative abort after SET LOCAL must close the transaction.
      await runner.commitTransaction();
      return result;
    } catch (error) {
      // startTransaction may reject before TypeORM marks the runner active;
      // rolling back then can mask the original failure. Release is still
      // unconditional in finally, including a connect/start failure.
      if (transactionStarted) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  /** Local path for the cached, WebP-converted POI image (media proxy target). */
  mediaPath(uuid: string): string {
    return join(MEDIA_DIR, `${uuid}.webp`);
  }

  /** Legacy pre-WebP cache path (.jpg). Kept only for one-time migration. */
  legacyMediaPath(uuid: string): string {
    return join(MEDIA_DIR, `${uuid}.jpg`);
  }

  /** Expose media directory path for multer / admin uploads. */
  get mediaDir(): string {
    return MEDIA_DIR;
  }

  /**
   * Resolve the raw source image bytes for a POI's imageUrl.
   * Handles two shapes:
   *  - local upload marker `/media/poi/<file>` (admin upload) → read from MEDIA_DIR
   *  - absolute external URL (Wikimedia/MKRF) → fetch with our UA
   * Returns the raw bytes; conversion to WebP happens in encodeWebp().
   */
  async fetchSourceBytes(url: string): Promise<Buffer> {
    if (url.startsWith('/media/')) {
      const local = join(MEDIA_DIR, basename(url));
      if (existsSync(local)) return fs.readFile(local);
      throw new Error(`local media not found: ${local}`);
    }
    return this.remoteImageFetcher.fetch(url);
  }

  /** Convert any image buffer to WebP (max 1600px, quality 80). EXIF-rotated. */
  async encodeWebp(buf: Buffer): Promise<Buffer> {
    const sharpMod = await import('sharp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (sharpMod.default ?? sharpMod) as unknown as (buf: Buffer, options?: any) => any;
    return s(buf, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
      .rotate() // honour EXIF orientation
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  }

  /** Convert an admin-uploaded image buffer to WebP and store it as the cache. */
  async storeUploadWebp(uuid: string, raw: Buffer): Promise<void> {
    const webp = await this.encodeWebp(raw);
    await fs.writeFile(this.mediaPath(uuid), webp);
  }

  /**
   * Return cached WebP bytes for a POI, producing them on first request:
   *  1. {uuid}.webp exists → return it
   *  2. legacy {uuid}.jpg exists → convert + cache + return (migration)
   *  3. else fetch source (local upload marker or remote URL) → convert + cache → return
   * Returns null if the POI has no image at all.
   */
  async getMediaBuffer(
    uuid: string,
  ): Promise<{ buffer: Buffer; mime: 'image/webp' } | null> {
    // Authorize the currently published image before reading a cache. A cache
    // may outlive an import or an override, so serving it first would bypass
    // the public image-evidence policy applied by byId().
    const poi = await this.byId(uuid).catch(() => null);
    if (!poi?.imageUrl) return null;

    const webpPath = this.mediaPath(uuid);
    if (existsSync(webpPath)) {
      return { buffer: await fs.readFile(webpPath), mime: 'image/webp' };
    }

    let raw: Buffer;
    const legacy = this.legacyMediaPath(uuid);
    if (existsSync(legacy)) {
      raw = await fs.readFile(legacy);
    } else {
      // Fetch errors (timeout, DNS, bad URL, non-image response) must not crash
      // the endpoint — return null → 404 instead of 500.
      try {
        raw = await this.fetchSourceBytes(poi.imageUrl);
      } catch (err: any) {
        this.logger.warn(`Failed to fetch image for ${uuid}: ${err?.message || err}`);
        return null;
      }
    }

    try {
      const webp = await this.encodeWebp(raw);
      void fs.writeFile(webpPath, webp).catch((e) =>
        this.logger.warn(`Failed to cache webp for ${uuid}: ${e.message}`),
      );
      // Drop the legacy .jpg after a successful migration.
      if (existsSync(legacy)) void fs.unlink(legacy).catch(() => {});
      return { buffer: webp, mime: 'image/webp' };
    } catch (err: any) {
      this.logger.warn(`Failed to encode webp for ${uuid}: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * JPEG bytes for a POI image, derived from the cached WebP.
   * Used by the Telegram bot (sendPhoto renders .webp as a sticker, so we send
   * JPEG instead). WebP stays the on-disk cache for the web/miniapp.
   */
  async getMediaJpegBuffer(uuid: string): Promise<Buffer | null> {
    const media = await this.getMediaBuffer(uuid);
    if (!media) return null;
    const sharpMod = await import('sharp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (sharpMod.default ?? sharpMod) as unknown as (buf: Buffer) => any;
    return s(media.buffer).jpeg({ quality: 85 }).toBuffer();
  }

  async list(query: QueryPoiDto): Promise<{ items: PoiRow[]; total: number }> {
    const limit = Math.min(query.limit ?? 50, 200);
    const offset = query.offset ?? 0;
    const params: any[] = [];
    // Only show active POIs — soft-deleted OSM objects (is_active=false) are hidden.
    // See docs/data-refresh.md (POI-каталог обновляется через manifest-импортёр).
    const where: string[] = ['pp.is_active = true'];

    if (query.category) {
      const cats = String(query.category).split(',').map(c => c.trim().toLowerCase()).filter(isValidCategory);
      if (cats.length === 0) throw new NotFoundException(`Invalid category: ${query.category}`);
      if (cats.length === 1) {
        where.push(`pp.category = $${params.length + 1}`);
        params.push(cats[0]);
      } else {
        where.push(`pp.category = ANY($${params.length + 1})`);
        params.push(cats);
      }
    }

    // Origin pipeline filter (osm | egrkn | wikivoyage). Matches the
    // authoritative poi_product.source column — the catalogue's source filter
    // now runs server-side so the count + pagination stay correct.
    if (query.source) {
      const srcs = String(query.source).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (srcs.length) {
        where.push(`pp.source = ANY($${params.length + 1})`);
        params.push(srcs);
      }
    }

    // Spatial: simple bounding box (no PostGIS needed)
    if (query.radius != null && query.lat != null && query.lng != null) {
      const latDeg = query.radius / 111000;
      const lonDeg = query.radius / (111000 * Math.cos(query.lat * Math.PI / 180));
      where.push(`pp.lat BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      where.push(`pp.lon BETWEEN $${params.length + 3} AND $${params.length + 4}`);
      params.push(query.lat - latDeg, query.lat + latDeg, query.lng - lonDeg, query.lng + lonDeg);
    } else if (query.bbox) {
      const [minLng, minLat, maxLng, maxLat] = query.bbox
        .split(',')
        .map((v) => parseFloat(v.trim()));
      if ([minLng, minLat, maxLng, maxLat].some((n) => Number.isNaN(n))) {
        throw new NotFoundException(`Invalid bbox: ${query.bbox}`);
      }
      where.push(`pp.lat BETWEEN $${params.length + 1} AND $${params.length + 2}`);
      where.push(`pp.lon BETWEEN $${params.length + 3} AND $${params.length + 4}`);
      params.push(minLat, maxLat, minLng, maxLng);
    }

    if (query.search) {
      const searchStr = `%${query.search}%`;
      params.push(searchStr, searchStr);
      where.push(`(pp.name ILIKE $${params.length - 1} OR pp.description ILIKE $${params.length})`);
    }

    // Content filters — require a non-empty description / image. These work today
    // without any schema change (poi_product already has the columns).
    if (query.hasDescription) {
      where.push(`(pp.description IS NOT NULL AND pp.description <> '')`);
    }
    if (query.hasPhoto) {
      where.push(`(pp.image_url IS NOT NULL AND pp.image_url <> '')`);
    }

    // Administrative-location filters (region/district/city), populated by
    // the collector's admin-boundary step (point-in-polygon from OSM admin
    // boundaries). These columns exist on poi_product since 2026-07-07.
    if (query.region) {
      where.push(`pp.region = $${params.length + 1}`);
      params.push(query.region);
    }
    if (query.district) {
      where.push(`pp.district = $${params.length + 1}`);
      params.push(query.district);
    }
    if (query.city) {
      where.push(`pp.city = $${params.length + 1}`);
      params.push(query.city);
    }

    // Century filter: ((year - 1) / 100 + 1) IN (19, 20, ...).
    // Accepts comma-separated century numbers ('19' or '19,20,21').
    if (query.century) {
      const centuries = query.century.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1);
      if (centuries.length > 0) {
        where.push(`(pp.year IS NOT NULL AND ((pp.year - 1) / 100 + 1) = ANY($${params.length + 1}))`);
        params.push(centuries);
      }
    }

    if (query.heritage) {
      const sigs = String(query.heritage).split(',').map(s => s.trim().toLowerCase());
      if (!sigs.includes('all')) {
        where.push(`pp.heritage_facet = ANY($${params.length})`);
        params.push(sigs);
      } else {
        where.push(`pp.heritage_facet IS NOT NULL`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderBy = query.sort === 'popularity'
      ? 'pp.popularity_score DESC NULLS LAST'
      : query.sort === 'name'
        ? 'lower(pp.name) ASC NULLS LAST'
        : 'pp.poi_uuid DESC';

    const rows = (await this.dataSource.query(
      `SELECT ${POI_COLUMNS_MERGED} ${FROM_WITH_JOIN} ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    )) as PoiRow[];

    const totalRow = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM poi_product pp ${whereSql}`,
      params,
    )) as { count: number }[];

    return { items: rows.map(normalizePhotoAttribution), total: totalRow[0]?.count ?? rows.length };
  }


  /** Return only POIs covered by an isochrone polygon. Public bbox catalogue semantics stay unchanged. */
  async listCoveredByPolygon(
    geojson: { type: string; coordinates: unknown },
    query: Pick<QueryPoiDto, 'category' | 'limit' | 'offset' | 'sort'>,
  ): Promise<{ items: PoiRow[]; total: number }> {
    if (!this.isValidPolygon(geojson)) throw new NotFoundException('Invalid isochrone polygon');
    const [minLon, minLat, maxLon, maxLat] = this.polygonBbox(geojson.coordinates);
    const params: unknown[] = [JSON.stringify(geojson), minLat, maxLat, minLon, maxLon];
    const where = [
      'pp.is_active = true',
      // Cheap/indexable scalar prefilter keeps ST_Covers away from rows that
      // cannot possibly be inside the isochrone.
      'pp.lat BETWEEN $2 AND $3',
      'pp.lon BETWEEN $4 AND $5',
      'ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), ST_SetSRID(ST_MakePoint(pp.lon, pp.lat), 4326))',
    ];
    if (query.category) {
      const cats = String(query.category).split(',').map(c => c.trim().toLowerCase()).filter(isValidCategory);
      if (!cats.length) throw new NotFoundException('Invalid category: ' + query.category);
      params.push(cats);
      where.push('pp.category = ANY($' + params.length + ')');
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    // Auto selection needs a bounded, diverse pool; catalogue callers retain
    // their normal smaller limit while this internal covered query may use 500.
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;
    const orderBy = query.sort === 'popularity' ? 'pp.popularity_score DESC NULLS LAST' : query.sort === 'name' ? 'lower(pp.name) ASC NULLS LAST' : 'pp.poi_uuid DESC';
    const rows = await this.dataSource.query(
      'SELECT ' + POI_COLUMNS_MERGED + ' ' + FROM_WITH_JOIN + ' ' + whereSql + ' ORDER BY ' + orderBy + ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
      [...params, limit, offset],
    ) as PoiRow[];
    const countRows = await this.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM poi_product pp ' + whereSql,
      params,
    ) as { count: number }[];
    return { items: rows.map(normalizePhotoAttribution), total: countRows[0]?.count ?? rows.length };
  }

  private isValidPolygon(geojson: { type: string; coordinates: unknown }): boolean {
    if (!geojson || !['Polygon', 'MultiPolygon'].includes(geojson.type)) return false;
    const validPosition = (position: unknown): position is number[] => Array.isArray(position)
      && position.length >= 2 && position.every((value) => typeof value === 'number' && Number.isFinite(value));
    const validRing = (ring: unknown): ring is number[][] => Array.isArray(ring) && ring.length >= 4
      && ring.every(validPosition) && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    if (geojson.type === 'Polygon') return Array.isArray(geojson.coordinates) && geojson.coordinates.length > 0 && geojson.coordinates.every(validRing);
    return Array.isArray(geojson.coordinates) && geojson.coordinates.length > 0
      && geojson.coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing));
  }

  private polygonBbox(coordinates: unknown): [number, number, number, number] {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    const visit = (value: unknown): void => {
      if (Array.isArray(value) && value.length >= 2
        && typeof value[0] === 'number' && typeof value[1] === 'number') {
        minLon = Math.min(minLon, value[0]);
        minLat = Math.min(minLat, value[1]);
        maxLon = Math.max(maxLon, value[0]);
        maxLat = Math.max(maxLat, value[1]);
        return;
      }
      if (Array.isArray(value)) value.forEach(visit);
    };
    visit(coordinates);
    return [minLon, minLat, maxLon, maxLat];
  }

  async byId(id: string): Promise<PoiRow> {
    const rows = (await this.dataSource.query(
      `SELECT ${POI_COLUMNS_MERGED} ${FROM_WITH_JOIN} WHERE pp.poi_uuid = $1 AND pp.is_active = true`,
      [id],
    )) as PoiRow[];
    const row = rows[0];
    if (!row) throw new NotFoundException(`POI "${id}" not found`);
    return normalizePhotoAttribution(row);
  }

  async count(): Promise<{ total: number }> {
    const rows = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM poi_product pp WHERE pp.is_active = true`,
    )) as { total: number }[];
    return rows[0];
  }

  /**
   * Available regions for the region filter. Populated by the collector's
   * admin-boundary step (poi_product.region). Returns distinct non-null values.
   */
  async regions(): Promise<{ regions: string[] }> {
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT region FROM poi_product
       WHERE region IS NOT NULL AND region <> '' AND is_active = true
       ORDER BY region`,
    )) as { region: string }[];
    return { regions: rows.map(r => r.region) };
  }

  /**
   * Reverse-geocode a point to the region it sits inside. Used by the
   * Mini App's route wizard to auto-filter out POIs from other regions
   * (e.g. "Казань" showing up when the user is in Kirov).
   *
   * Strategy: find the most common `region` value among active POIs
   * inside a small (~5 km) radius. If none, fall back to the nearest
   * POI's region within 50 km. Returns null when nothing is in range.
   */
  async regionAt(
    lat: number,
    lon: number,
  ): Promise<{ region: string | null; sample: number }> {
    // Tight radius first (5 km).
    const tight = (await this.dataSource.query(
      `SELECT region, COUNT(*)::int AS n FROM poi_product
       WHERE is_active = true
         AND lat BETWEEN $1 AND $2
         AND lon BETWEEN $3 AND $4
         AND region IS NOT NULL AND region <> ''
       GROUP BY region
       ORDER BY n DESC, region ASC
       LIMIT 1`,
      [
        lat - 0.05,
        lat + 0.05,
        lon - 0.05 / Math.max(0.1, Math.cos((lat * Math.PI) / 180)),
        lon + 0.05 / Math.max(0.1, Math.cos((lat * Math.PI) / 180)),
      ],
    )) as { region: string; n: number }[];
    if (tight.length) return { region: tight[0].region, sample: tight[0].n };

    // Wider radius (50 km) — nearest-neighbour fallback.
    const wide = (await this.dataSource.query(
      `SELECT region, COUNT(*)::int AS n FROM poi_product
       WHERE is_active = true
         AND lat BETWEEN $1 AND $2
         AND lon BETWEEN $3 AND $4
         AND region IS NOT NULL AND region <> ''
       GROUP BY region
       ORDER BY n DESC, region ASC
       LIMIT 1`,
      [
        lat - 0.5,
        lat + 0.5,
        lon - 0.5 / Math.max(0.1, Math.cos((lat * Math.PI) / 180)),
        lon + 0.5 / Math.max(0.1, Math.cos((lat * Math.PI) / 180)),
      ],
    )) as { region: string; n: number }[];
    if (wide.length) return { region: wide[0].region, sample: wide[0].n };

    return { region: null, sample: 0 };
  }

  // ─── Override CRUD ──────────────────────────────────────────────────────

  /** Upsert override fields for a POI. Only non-null fields are written;
   *  pass `null` explicitly to clear a field. */
  async updateOverride(id: string, data: PoiOverrideData): Promise<void> {
    // Verify POI exists first
    const exists = await this.dataSource.query(
      `SELECT 1 FROM poi_product WHERE poi_uuid = $1`,
      [id],
    );
    if (!exists.length) throw new NotFoundException(`POI "${id}" not found`);

    const existing = await this.overrideRepo.findOne({ where: { poi_uuid: id } });
    if (existing) {
      // Merge: only update provided fields (including explicit nulls)
      if (data.display_name !== undefined) existing.display_name = data.display_name;
      if (data.description !== undefined) existing.description = data.description;
      if (data.image_url !== undefined) existing.image_url = data.image_url;
      if (data.image_attribution !== undefined) existing.image_attribution = data.image_attribution;
      if (data.osm_contributor !== undefined) existing.osm_contributor = data.osm_contributor;
      if (data.updated_by !== undefined) existing.updated_by = data.updated_by;
      await this.overrideRepo.save(existing);
    } else {
      await this.overrideRepo.insert({
        poi_uuid: id,
        display_name: data.display_name ?? null,
        description: data.description ?? null,
        image_url: data.image_url ?? null,
        image_attribution: data.image_attribution ?? null,
        osm_contributor: data.osm_contributor ?? null,
        updated_by: data.updated_by ?? 'admin',
      });
    }
  }

  /** Remove all overrides for a POI, reverting to pipeline data. */
  async deleteOverride(id: string): Promise<void> {
    const result = await this.overrideRepo.delete({ poi_uuid: id });
    if (result.affected === 0) throw new NotFoundException(`No overrides for POI "${id}"`);
  }

  /** Get the current override row, if any. */
  async getOverride(id: string): Promise<PoiOverride | null> {
    return this.overrideRepo.findOne({ where: { poi_uuid: id } });
  }
}
