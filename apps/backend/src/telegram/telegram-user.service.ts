import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUserEntity } from './entities/telegram-user.entity';

/**
 * Upserts Telegram users and keeps running counters for future gamification.
 */
@Injectable()
export class TelegramUserService {
  private readonly logger = new Logger(TelegramUserService.name);

  constructor(
    @InjectRepository(TelegramUserEntity)
    private readonly repo: Repository<TelegramUserEntity>,
  ) {}

  /** Create-or-update on every interaction. Returns the user row. */
  async touch(from: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  }): Promise<TelegramUserEntity> {
    try {
      const existing = await this.repo.findOne({ where: { chatId: from.id } });
      if (existing) {
        existing.firstName = from.first_name ?? existing.firstName;
        existing.lastName = from.last_name ?? existing.lastName;
        existing.username = from.username ?? existing.username;
        existing.languageCode = from.language_code ?? existing.languageCode;
        return this.repo.save(existing);
      }
      return this.repo.save(
        this.repo.create({
          chatId: from.id,
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          username: from.username ?? null,
          languageCode: from.language_code ?? null,
        }),
      );
    } catch (err: any) {
      this.logger.warn(`touch() failed for ${from.id}: ${err.message}`);
      // Non-fatal — the bot still works without persistence.
      return this.repo.create({ id: 0, chatId: from.id });
    }
  }

  async incrementRoutes(chatId: number): Promise<void> {
    await this.repo.increment({ chatId }, 'routesGenerated', 1).catch(() => {});
  }

  async incrementGpx(chatId: number): Promise<void> {
    await this.repo.increment({ chatId }, 'gpxDownloads', 1).catch(() => {});
  }
}
