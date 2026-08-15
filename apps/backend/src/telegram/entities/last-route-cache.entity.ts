import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Persists the bot's last built route per Telegram chatId, so the Mini App
 * can fetch it via HMAC-validated GET instead of re-running GraphHopper with
 * just the query params (which dropped the ordered POI list — see
 * docs/superpowers/specs/2026-07-01-miniapp-poi-cart-design.md §3).
 *
 * Keyed by chatId (Telegram private chat == user id). The bot writes via
 * LastRouteService.set() right after a successful build, and on read the
 * service checks `expiresAt` to enforce a TTL (default 30 min — long enough
 * for a user to switch to the Mini App, short enough that a stale route
 * never gets re-shown after a long absence).
 *
 * Schema notes:
 *  - `geojson` is the full built GeoJSON (LineString + bbox metadata). Small
 *    enough (a 4-hour bike route is ~10 KB) to keep in row form.
 *  - `pois` is the ordered stop list with names + categories — what the
 *    Mini App preview renders as numbered cards.
 *  - `meta` carries `profile`, `categories`, `timeMinutes` so the preview
 *    can show the wizard summary header without a follow-up call.
 */
@Entity('telegram_last_route')
export class LastRouteCacheEntity {
  @PrimaryColumn({ name: 'chat_id', type: 'bigint' })
  chatId: number;

  /** Distance in meters. */
  @Column({ type: 'double precision' })
  distance: number;

  /** Duration in seconds. */
  @Column({ type: 'double precision' })
  duration: number;

  /** Elevation gain in meters. */
  @Column({ type: 'double precision', default: 0 })
  ascend: number;

  /** Elevation loss in meters. */
  @Column({ type: 'double precision', default: 0 })
  descend: number;

  @Column({ type: 'varchar', length: 16 })
  profile: string;

  @Column({ type: 'simple-json', nullable: true })
  geojson: { type: string; coordinates: number[][] | number[][][] } | null;

  @Column({ type: 'simple-json', nullable: true })
  pois: Array<{
    id: string;
    name: string;
    category: string;
    lat: number;
    lon: number;
  }> | null;

  @Column({ type: 'simple-array', nullable: true })
  categories: string[] | null;

  @Column({ type: 'int', nullable: true })
  timeMinutes: number | null;

  @Index('IDX_tg_last_route_expires')
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
