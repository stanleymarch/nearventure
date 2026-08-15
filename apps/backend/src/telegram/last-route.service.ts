import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LastRouteCacheEntity } from './entities/last-route-cache.entity';

/**
 * In-memory is fine for one-process bots, but we use Postgres here so the
 * cache survives bot restarts (cheap idempotency: when a user re-opens the
 * Mini App 10 minutes after the route was built, we still hand them the
 * same geometry, not "we lost it, /start again").
 *
 * TTL is enforced on read (delete expired rows lazily) — we don't run a
 * background sweeper. The Mini App only fetches when the user opens the
 * preview, so the cost of "check expiry" on every read is one comparison.
 */

export interface CachedRoute {
  distance: number;
  duration: number;
  ascend: number;
  descend: number;
  profile: string;
  geojson: { type: string; coordinates: number[][] | number[][][] } | null;
  pois: Array<{ id: string; name: string; category: string; lat: number; lon: number; order?: number }>;
  categories?: string[];
  timeMinutes?: number;
  expiresAt?: number; // unix ms; only set on read (set() computes from ttlMs)
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class LastRouteService {
  private readonly logger = new Logger(LastRouteService.name);

  constructor(
    @InjectRepository(LastRouteCacheEntity)
    private readonly repo: Repository<LastRouteCacheEntity>,
  ) {}

  /** Persist the bot's last built route for a chat. Overwrites any prior. */
  async set(chatId: number, route: CachedRoute, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const row: Partial<LastRouteCacheEntity> = {
      chatId,
      distance: route.distance,
      duration: route.duration,
      ascend: route.ascend,
      descend: route.descend,
      profile: route.profile,
      geojson: route.geojson,
      pois: route.pois,
      categories: route.categories ?? null,
      timeMinutes: route.timeMinutes ?? null,
      expiresAt,
    };
    try {
      await this.repo.upsert(row, ['chatId']);
    } catch (e: any) {
      this.logger.warn(`lastRoute.set(${chatId}) failed: ${e.message}`);
    }
  }

  /**
   * Read the cached route for a chat. Returns null if missing or expired
   * (and lazily deletes the expired row). The caller is the Mini App
   * (via /api/telegram/last-route, HMAC-validated) and the guide handler.
   */
  async get(chatId: number): Promise<CachedRoute | null> {
    const row = await this.repo.findOne({ where: { chatId } }).catch(() => null);
    if (!row) return null;

    if (row.expiresAt.getTime() <= Date.now()) {
      // Lazily drop expired rows.
      this.repo.delete({ chatId }).catch((e) =>
        this.logger.warn(`delete expired lastRoute(${chatId}): ${e.message}`),
      );
      return null;
    }

    return {
      distance: row.distance,
      duration: row.duration,
      ascend: row.ascend,
      descend: row.descend,
      profile: row.profile,
      geojson: row.geojson,
      pois: row.pois ?? [],
      categories: row.categories ?? undefined,
      timeMinutes: row.timeMinutes ?? undefined,
      expiresAt: row.expiresAt.getTime(),
    };
  }

  /** Drop the cache for a chat (e.g. when the user explicitly resets). */
  async clear(chatId: number): Promise<void> {
    await this.repo.delete({ chatId }).catch(() => {});
  }
}
