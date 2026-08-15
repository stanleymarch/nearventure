import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Cache of Telegram `file_id`s for POI photos.
 *
 * Telegram returns a stable `file_id` the first time a file is uploaded to a bot.
 * Re-sending by `file_id` is instant + free (no upload), so we persist it per
 * POI and reuse it on every subsequent photo card (guide reveal, nearby
 * details…). But:
 *
 *   - If the POI's `imageUrl` is changed (admin override, collector ingest
 *     update, or new photo at the same URL), the cached `file_id` would
 *     resolve to a stale photo in chat. We detect this with `image_url_hash`
 *     (sha256 of the URL, see media-hash.ts) — on mismatch, drop cache and
 *     re-upload.
 *   - If Telegram itself rotates `file_id` (rare; usually only after a bot
 *     re-registers), `file_unique_id` changes. We store it for forensic /
 *     future `getFile` checks. On a stale `file_id` send, the catch in
 *     `TelegramPoiCardService.sendPoiCard` drops the cache and re-uploads.
 *
 * Schema notes:
 *   - `poi_uuid` matches `poi_product.poi_uuid` (hex string, no dashes).
 *   - `synchronize: true` in `DatabaseModule` will add columns on next boot
 *     (synchronize is safe here because no destructive change is made).
 */
@Entity('telegram_poi_media')
@Index('IDX_tg_poi_media_url_hash', ['image_url_hash'])
export class PoiMediaCacheEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  poi_uuid: string;

  /** Telegram file_id for the largest photo size we uploaded. */
  @Column({ type: 'varchar', length: 255 })
  file_id: string;

  /**
   * Telegram's stable-per-file identifier. Survives `file_id` rotation; changes
   * only if the underlying file content changes. Optional because pre-existing
   * rows from before this column existed won't have it (we backfill by treating
   * null as "needs re-upload" on first read).
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  file_unique_id: string | null;

  /**
   * sha256(imageUrl)[:16] at the moment of upload. Used to invalidate the cache
   * when the POI's `imageUrl` changes on our side (admin/ingest update).
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  image_url_hash: string | null;

  /**
   * The exact URL we uploaded from. Stored for diagnostics (we can show
   * "this card was rendered from URL X on Y"); not used in staleness checks.
   */
  @Column({ type: 'text', nullable: true })
  image_url: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
