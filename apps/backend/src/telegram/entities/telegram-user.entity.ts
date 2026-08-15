import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * A Telegram user who interacted with the bot.
 *
 * Why we store this (no separate login):
 *  - Internal product analytics (route_generated / gpx_downloaded / feedback
 *    events are attributed to `telegramChatId`).
 *  - Future gamification (XP, badges, streaks, citizen-science missions —
 *    see specs/09-missions-gamification.md).
 *  - Anti-abuse for future media/XP collection (one chat_id farm guard).
 *
 * 152-ФЗ: chatId + first_name + username are what the user already shares with
 * the bot by messaging it. No phone, no email, no location stored here.
 */
@Entity('telegram_user')
@Index('IDX_tguser_chatid', ['chatId'], { unique: true })
export class TelegramUserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Telegram chat id (== user id for private chats). */
  @Column({ name: 'chat_id', type: 'bigint' })
  chatId: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  /** ISO language code from Telegram (ru / en / …). */
  @Column({ type: 'varchar', length: 8, nullable: true })
  languageCode: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'last_seen_at' })
  lastSeenAt: Date;

  /** Running totals for future gamification. */
  @Column({ default: 0 })
  routesGenerated: number;

  @Column({ default: 0 })
  gpxDownloads: number;
}
