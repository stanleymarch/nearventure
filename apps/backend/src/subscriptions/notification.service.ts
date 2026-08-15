import { Injectable, Logger } from '@nestjs/common';
import { TelegramChannelsService } from './telegram-channels.service';

/**
 * Единая точка исходящих уведомлений — архитектурный шов под очередь (ADR-010).
 *
 * Сегодня тело методов — синхронные вызовы в `TelegramChannelsService`, который
 * уже устойчив к `429/FLOOD_WAIT` и 5xx (ретраи с backoff). Когда сработает
 * триггер ADR-010 (Фаза 7: захват медиа → S3; реальная рассылка по N подпискам
 * с `FLOOD_WAIT`; >1 реплика бэкенда), тело заменяется на `queue.add(...)` (Redis +
 * BullMQ) **без правки мест вызова**.
 *
 * Правило: все исходящие Telegram-сообщения идут через этот сервис, а не через
 * прямые `sendMessage` / `bot.telegram.sendMessage`. Так в будущем замена на
 * очередь будет точечной.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly telegramChannels: TelegramChannelsService) {}

  /**
   * Отправить сообщение в админ-чат (`ADMIN_TELEGRAM_CHAT_ID`).
   * Best-effort: не бросает, логирует неудачу. Используется кроном дайджеста
   * и немедленным пушем отзывов.
   */
  async pushAdmin(text: string, parseMode = 'HTML'): Promise<void> {
    const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (!adminChatId) return; // env не настроен — молча пропускаем
    try {
      await this.telegramChannels.sendMessage(adminChatId, text, parseMode);
    } catch (err: any) {
      this.logger.warn(`pushAdmin failed: ${err.message}`);
    }
  }

  /**
   * Разослать сообщение по набору чатов/каналов. Последовательно (N пока мал);
   * каждый send независимо ретраится в `TelegramChannelsService`. Возвращает
   * счётчики. Когда придёт брокер — тело станет `queue.add('broadcast', ...)`.
   */
  async notifyChannels(
    chatIds: string[],
    text: string,
    parseMode = 'HTML',
  ): Promise<{ sent: number; failed: string[] }> {
    const failed: string[] = [];
    let sent = 0;
    for (const chatId of chatIds) {
      try {
        await this.telegramChannels.sendMessage(chatId, text, parseMode);
        sent += 1;
      } catch (err: any) {
        this.logger.warn(`notifyChannels → ${chatId} failed: ${err.message}`);
        failed.push(chatId);
      }
    }
    return { sent, failed };
  }
}
