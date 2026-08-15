import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Anonymous product-analytics events. 152-ФЗ safe:
 *  - NO IP address stored (only a front-supplied `anonymousId` from localStorage).
 *  - NO user id / login / email by default.
 *  - `meta` carries only non-personal attributes (profile, distanceKm, category…).
 *
 * Sources: routes (generate/save/open/gpx), pois (view), feedback.
 * Used to (a) recompute `poi_product.popularity_score` and (b) show the admin
 * a daily summary + each piece of feedback in Telegram.
 */
export type AnalyticsEventType =
  // route lifecycle
  | 'route_generated'
  | 'route_saved'
  | 'route_opened'
  | 'gpx_downloaded'
  | 'poi_in_route' // one per saved POI when a route is persisted → popularity signal
  // poi lifecycle
  | 'poi_viewed'
  | 'poi_liked' // future (explicit like)
  // feedback
  | 'feedback_sent';

/** Weights for popularity recompute (higher = stronger intent). */
export const POPULARITY_WEIGHTS: Record<string, number> = {
  poi_viewed: 1,
  poi_in_route: 5,
  poi_liked: 8,
};

@Entity('analytics_event')
@Index('IDX_event_type_created', ['type', 'createdAt'])
@Index('IDX_event_poi', ['poiUuid'])
@Index('IDX_event_route', ['routeId'])
export class AnalyticsEventEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 40 })
  type: AnalyticsEventType | string;

  /** Stored route id when the event is about a route. */
  @Column({ name: 'route_id', type: 'uuid', nullable: true })
  routeId: string | null;

  /** poi_product.poi_uuid when the event is about a POI. */
  @Column({ name: 'poi_uuid', type: 'varchar', nullable: true })
  poiUuid: string | null;

  /** Front-supplied UUID (localStorage). Not PII — used only for light dedup. */
  @Column({ name: 'anonymous_id', type: 'varchar', length: 40, nullable: true })
  anonymousId: string | null;

  /** Telegram chat id when the event originated from the bot (analytics +
   *  future gamification). Null for web events. */
  @Column({ name: 'telegram_chat_id', type: 'bigint', nullable: true })
  telegramChatId: number | null;

  /** Non-personal context: { profile, distanceKm, category, rating, ... }. */
  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
