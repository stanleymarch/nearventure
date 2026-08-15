import {
  Controller,
  Get,
  Param,
  Query,
  Headers,
  Res,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PoisService } from './pois.service';
import { QueryPoiDto } from './dto/query-poi.dto';
import { AnalyticsService } from '../analytics/analytics.service';
import { Public } from '../auth/public.decorator';
import { existsSync } from 'fs';
import { createReadStream } from 'fs';

/**
 * Public POI read API. End-users need no account.
 * Reads from poi_product (canonical → product layer) with optional
 * poi_overrides merged in.
 */
@Public()
@ApiTags('pois')
@Controller('pois')
export class PoisController {
  private readonly logger = new Logger(PoisController.name);

  constructor(
    private readonly poisService: PoisService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** List POIs by category / search / heritage with pagination. */
  @Get()
  list(@Query() query: QueryPoiDto) {
    return this.poisService.list(query);
  }

  /** POI count (used by the public landing page). */
  @Get('count')
  count() {
    return this.poisService.count();
  }

  /** Available regions for the region filter (empty until reverse-geocoding). */
  @Get('regions')
  regions() {
    return this.poisService.regions();
  }

  /**
   * Reverse-geocode a point to the region it sits inside. Used by the
   * Mini App wizard to auto-filter out POIs from other regions. Bounded
   * by `radius` (default 5 km, max 50 km) — a 5 km search is enough for
   * "which region am I in" and avoids scanning the whole DB.
   */
  @Get('region-at')
  async regionAt(
    @Query('lat') latStr: string,
    @Query('lng') lngStr: string,
  ) {
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new NotFoundException('lat out of range');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new NotFoundException('lng out of range');
    }
    return this.poisService.regionAt(lat, lng);
  }

  /** Single POI by UUID. */
  @Get(':id')
  async byId(@Param('id') id: string, @Headers('x-anonymous-id') anon?: string) {
    const poi = await this.poisService.byId(id);
    void this.analytics
      .record({ type: 'poi_viewed', poiUuid: id, anonymousId: anon && anon.length <= 40 ? anon : null })
      .catch(() => {});
    return poi;
  }

  /**
   * Serve POI image (lazy-cached WebP proxy).
   *
   * Delegates to `PoisService.getMediaBuffer()`, which on first request fetches
   * the source (Wikimedia/MKRF/local upload), converts to WebP (max 1600px,
   * quality 80, EXIF-rotated) and caches at `{uuid}.webp`. Subsequent requests
   * serve the cached file directly. Always returns `Content-Type: image/webp`
   * matching the bytes — the previous inline implementation wrote raw JPEG
   * bytes under a `.webp` path, so `sendFile` later mislabeled them and browsers
   * refused to render the image (root cause of the missing museum photos).
   *
   * Attribution for Wikimedia images is shown separately via
   * `poi.imageAttribution` in the POI payload.
   */
  @Get(':id/media')
  async getMedia(
    @Param('id') id: string,
    @Query('policy') policy: string | undefined,
    @Res() res: Response,
  ) {
    const media = await this.poisService.getMediaBuffer(id).catch((e: any) => {
      this.logger.warn(`Media fetch failed for ${id}: ${e?.message || e}`);
      return null;
    });
    if (!media) throw new NotFoundException('POI has no image');
    res.set('Content-Type', media.mime);
    // Immutable caching is safe only on a deliberate policy-versioned URL.
    // Unversioned legacy URLs must not gain another long-lived cache entry.
    res.set('Cache-Control', policy === '2'
      ? 'public, max-age=31536000, immutable'
      : 'no-store');
    res.send(media.buffer);
  }
}
