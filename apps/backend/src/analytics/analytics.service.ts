import { Injectable, Logger, Inject, Optional, NotFoundException, ConflictException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Telegraf } from 'telegraf';
import { AnalyticsEventEntity, AnalyticsEventType, POPULARITY_WEIGHTS } from './entities/analytics-event.entity';
import { RouteFeedbackEntity } from './entities/route-feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { acquirePoiWriteLock } from '../importer/poi-write-lock';

/** One event record to pass to `record()`. */
export interface AnalyticsRecord {
  type: AnalyticsEventType | string;
  routeId?: string | null;
  poiUuid?: string | null;
  anonymousId?: string | null;
  /** Telegram chat id when the event came from the bot. */
  telegramChatId?: number | null;
  meta?: Record<string, unknown> | null;
}

/** Admin summary shape (GET /api/analytics/summary). */
export interface AnalyticsSummary {
  generatedAt: string;
  totals: { type: string; total: number; last7d: number; last24h: number }[];
  routesSaved: number;
  feedbackCount: number;
  feedbackAvgRating: number | null;
  osmContributors: { yes: number; no: number; skipped: number };
  topPois: { poiUuid: string; name: string | null; category: string | null; score: number }[];
  topCategories: { category: string; events: number }[];
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(AnalyticsEventEntity)
    private readonly eventRepo: Repository<AnalyticsEventEntity>,
    @InjectRepository(RouteFeedbackEntity)
    private readonly feedbackRepo: Repository<RouteFeedbackEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() @Inject('TELEGRAM_BOT') private readonly bot: Telegraf | null,
  ) {}

  // ── event recording (fire-and-forget at call site) ─────────────────────────

  /**
   * Persist one analytics event. Never throws — wraps in try/catch so a logging
   * failure can never break the user-facing response. Callers should NOT await
   * this (use `void this.analytics.record({...}).catch(() => {})`).
   */
  async record(r: AnalyticsRecord): Promise<void> {
    try {
      await this.eventRepo.save({
        type: r.type,
        routeId: r.routeId ?? null,
        poiUuid: r.poiUuid ?? null,
        anonymousId: r.anonymousId ?? null,
        telegramChatId: r.telegramChatId ?? null,
        meta: r.meta ?? null,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to record event "${r.type}": ${err.message}`);
    }
  }

  // ── feedback ──────────────────────────────────────────────────────────────

  /**
   * Create a feedback record for a route. Verifies the route exists (404),
   * dedups one-per-anonymous-visitor (409), pushes a copy to the admin's
   * Telegram, and records a `feedback_sent` event for analytics.
   *
   * `anonId` comes from the `x-anonymous-id` header (front localStorage UUID),
   * same channel as all other events; falls back to dto.anonymousId.
   */
  async createFeedback(routeId: string, dto: CreateFeedbackDto, anonId?: string | null): Promise<{ id: string }> {
    // 1. Route must exist (raw query — avoids importing RoutesModule → no cycle).
    const route = await this.dataSource.query(
      `SELECT id, title FROM routes WHERE id = $1`,
      [routeId],
    );
    if (!route.length) {
      throw new NotFoundException(`Route "${routeId}" not found`);
    }

    // 2. Dedup: one review per anonymous visitor per route.
    const effectiveAnon = anonId ?? dto.anonymousId ?? null;
    if (effectiveAnon) {
      const dup = await this.feedbackRepo.findOne({
        where: { routeId, anonymousId: effectiveAnon },
      });
      if (dup) {
        throw new ConflictException('Вы уже оставляли отзыв на этот маршрут');
      }
    }

    // 3. Persist.
    const fb = await this.feedbackRepo.save({
      routeId,
      rating: dto.rating,
      comment: dto.comment ?? null,
      osmContributor: dto.osmContributor ?? null,
      osmContributionNote: dto.osmContributionNote ?? null,
      anonymousId: effectiveAnon,
    });

    // 4. Analytics event (route-level) + push to admin.
    void this.record({
      type: 'feedback_sent',
      routeId,
      anonymousId: effectiveAnon,
      meta: { rating: dto.rating },
    }).catch(() => {});

    this.pushFeedbackToAdmin(routeId, route[0].title, dto).catch((e) =>
      this.logger.warn(`TG feedback push failed: ${e.message}`),
    );

    return { id: fb.id };
  }

  // ── popularity recompute (cron) ───────────────────────────────────────────

  /**
   * Recompute `poi_product.popularity_score` from analytics events with
   * exponential time-decay (half-life = 60 days). Idempotent — safe to run
   * repeatedly. Runs daily at 04:00 MSK via @Cron, and can be triggered on
   * demand by the admin endpoint.
   */
  @Cron('0 4 * * *', { timeZone: 'Europe/Moscow', name: 'popularity-recompute' })
  async recomputePopularity(): Promise<{ updated: number }> {
    // Serialized against the only other poi_product writer (the
    // manifest-validated importer) via the shared advisory transaction lock.
    const res = await this.dataSource.transaction(async (tx) => {
      await acquirePoiWriteLock(tx);
      return tx.query(`
        WITH scored AS (
          SELECT poi_uuid,
            SUM(
              (CASE type
                WHEN 'poi_viewed'   THEN ${POPULARITY_WEIGHTS.poi_viewed}
                WHEN 'poi_in_route' THEN ${POPULARITY_WEIGHTS.poi_in_route}
                WHEN 'poi_liked'    THEN ${POPULARITY_WEIGHTS.poi_liked}
                ELSE 0
              END)
              * EXP(-EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 / 60.0)
            ) AS score
          FROM analytics_event
          WHERE poi_uuid IS NOT NULL
            AND type IN ('poi_viewed','poi_in_route','poi_liked')
          GROUP BY poi_uuid
        )
        UPDATE poi_product p
        SET popularity_score = COALESCE(s.score, 0)
        FROM scored s
        WHERE p.poi_uuid = s.poi_uuid
        RETURNING p.poi_uuid
      `);
    });
    const updated = res?.length ?? 0;
    this.logger.log(`Popularity recompute: ${updated} POIs updated`);
    return { updated };
  }

  // ── admin summary ─────────────────────────────────────────────────────────

  /** Aggregated product numbers for the admin dashboard / frontend admin view. */
  async getSummary(): Promise<AnalyticsSummary> {
    const [totals, routesSaved, feedbackStats, topPois, topCategories] = await Promise.all([
      this.dataSource.query(`
        SELECT type,
          count(*)::int AS total,
          count(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS last7d,
          count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24h
        FROM analytics_event GROUP BY type ORDER BY total DESC`),
      this.dataSource.query(`SELECT count(*)::int AS n FROM routes`),
      this.dataSource.query(`
        SELECT count(*)::int AS n,
          COALESCE(avg(rating), 0)::float AS avg_rating,
          count(*) FILTER (WHERE osm_contributor = true)::int  AS osm_yes,
          count(*) FILTER (WHERE osm_contributor = false)::int AS osm_no,
          count(*) FILTER (WHERE osm_contributor IS NULL)::int AS osm_skipped
        FROM route_feedback`),
      this.dataSource.query(`
        SELECT p.poi_uuid AS "poiUuid", p.name, p.category, p.popularity_score AS score
        FROM poi_product p
        WHERE p.popularity_score > 0
        ORDER BY p.popularity_score DESC LIMIT 10`),
      this.dataSource.query(`
        SELECT p.category, count(*)::int AS events
        FROM analytics_event e
        JOIN poi_product p ON p.poi_uuid = e.poi_uuid
        WHERE e.type IN ('poi_viewed','poi_in_route','poi_liked')
          AND p.category IS NOT NULL
        GROUP BY p.category ORDER BY events DESC LIMIT 10`),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      totals,
      routesSaved: routesSaved[0]?.n ?? 0,
      feedbackCount: feedbackStats[0]?.n ?? 0,
      feedbackAvgRating: feedbackStats[0]?.avg_rating ? +feedbackStats[0].avg_rating : null,
      osmContributors: {
        yes: feedbackStats[0]?.osm_yes ?? 0,
        no: feedbackStats[0]?.osm_no ?? 0,
        skipped: feedbackStats[0]?.osm_skipped ?? 0,
      },
      topPois,
      topCategories,
    };
  }

  // ── daily Telegram digest (cron) ──────────────────────────────────────────

  /** Send a compact daily digest to the admin chat at 09:00 MSK. */
  @Cron('0 9 * * *', { timeZone: 'Europe/Moscow', name: 'daily-digest' })
  async sendDailyDigest(): Promise<void> {
    const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (!adminChatId || !this.bot) {
      // Silent skip — events still land in the DB and are queryable via the API.
      return;
    }
    try {
      const s = await this.getSummary();
      const lines = [
        '📊 <b>Nearventure — дневной дайджест</b>',
        '',
        'События (всего / 7д / 24ч):',
        ...s.totals.map(
          (t) => `  • ${t.type}: ${t.total} / ${t.last7d} / ${t.last24h}`,
        ),
        '',
        `💾 Сохранено маршрутов: ${s.routesSaved}`,
        `⭐ Отзывов: ${s.feedbackCount}${s.feedbackAvgRating ? ` (ср. ${s.feedbackAvgRating.toFixed(1)})` : ''}`,
        `🌱 OSM-контрибьюторов: да=${s.osmContributors.yes}, нет=${s.osmContributors.no}, пропустили=${s.osmContributors.skipped}`,
        '',
        '🏆 Топ POI по популярности:',
        ...(s.topPois.length
          ? s.topPois.map((p, i) => `  ${i + 1}. ${p.name ?? p.poiUuid} (${p.category ?? '?'}) — ${(+p.score).toFixed(1)}`)
          : ['  (пока нет данных)']),
      ];
      await this.bot.telegram.sendMessage(adminChatId, lines.join('\n'), {
        parse_mode: 'HTML',
      });
    } catch (err: any) {
      this.logger.warn(`Daily digest failed: ${err.message}`);
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Push a single feedback to the admin chat immediately (best-effort). */
  private async pushFeedbackToAdmin(
    routeId: string,
    routeTitle: string | null,
    dto: CreateFeedbackDto,
  ): Promise<void> {
    const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (!adminChatId || !this.bot) return;

    const stars = '⭐'.repeat(dto.rating) + '☆'.repeat(5 - dto.rating);
    const osmLine =
      dto.osmContributor === undefined
        ? '—'
        : dto.osmContributor
          ? '✅ да'
          : '❌ нет';
    const note = dto.osmContributionNote ? `\n📝 ${dto.osmContributionNote}` : '';
    const comment = dto.comment ? `\n💬 ${dto.comment}` : '';

    const text =
      `💬 <b>Новый отзыв</b>\n` +
      `🛣 ${routeTitle ?? 'Без названия'}\n` +
      `${stars} ${dto.rating}/5\n` +
      `🌱 OSM-контрибьютор: ${osmLine}${note}${comment}\n` +
      `<code>${routeId}</code>`;
    await this.bot.telegram.sendMessage(adminChatId, text, { parse_mode: 'HTML' });
  }
}
