import { Injectable } from '@nestjs/common';

/** Base Telegram Bot API URL, built from the bot token (env). */
function telegramApiBase(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return `https://api.telegram.org/bot${token}`;
}

interface TelegramResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

interface ChatMember {
  status: 'member' | 'left' | 'kicked' | 'restricted' | 'not_member' | 'administrator' | 'creator';
  user?: { id: number; first_name: string };
}

@Injectable()
export class TelegramChannelsService {
  constructor() {}

  /**
   * Выполнить GET-запрос к Telegram API.
   */
  private async apiGet<T>(method: string, params: Record<string, string>): Promise<TelegramResponse<T>> {
    const url = new URL(`${telegramApiBase()}/${method}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Nearventure/1.0 (tg @staniverse)' },
    });
    return res.json() as Promise<TelegramResponse<T>>;
  }

  /**
   * Получить информацию о канале по его ID.
   */
  async getChat(channelId: string): Promise<any | null> {
    try {
      const data = await this.apiGet<any>('getChat', { chat_id: channelId });
      if (!data.ok) return null;
      return data.result || null;
    } catch {
      return null;
    }
  }

  /**
   * Проверить, состоит ли пользователь в канале.
   */
  async getChatMember(channelId: string, userId: string): Promise<ChatMember | null> {
    try {
      const data = await this.apiGet<ChatMember>('getChatMember', {
        chat_id: channelId,
        user_id: userId,
      });
      if (!data.ok) return { status: 'not_member' };
      return data.result || null;
    } catch {
      return { status: 'not_member' };
    }
  }

  /**
   * Получить chat_id по Telegram channel ID.
   */
  async getChatIdByChannelId(channelId: string): Promise<string | null> {
    const chat = await this.getChat(channelId);
    return chat?.id?.toString() || null;
  }

  /**
   * Отправить сообщение в канал.
   */
  async sendMessage(channelId: string, text: string, parseMode = 'HTML'): Promise<{ messageId: number } | null> {
    try {
      const response = await fetch(`${telegramApiBase()}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Nearventure/1.0 (tg @staniverse)',
        },
        body: JSON.stringify({
          chat_id: channelId,
          text,
          parse_mode: parseMode,
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(`Failed to send message: ${data.description}`);
      }
      return data.result || null;
    } catch (err: any) {
      throw new Error(`Failed to send message: ${err.message}`);
    }
  }
}