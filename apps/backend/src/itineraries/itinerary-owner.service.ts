import { UnauthorizedException, Injectable, Optional } from '@nestjs/common';
import { TelegramAuthService } from '../telegram/telegram-auth.service';

export interface ItineraryOwner { key: string; kind: 'client' | 'telegram'; }
@Injectable()
export class ItineraryOwnerService {
  constructor(@Optional() private readonly telegramAuth?: TelegramAuthService) {}

  /** Verified Telegram identity takes precedence; raw initData is never retained or logged. */
  resolve(clientId?: string, telegramInitData?: string): ItineraryOwner {
    if (telegramInitData) {
      const parsed = this.telegramAuth?.validate(telegramInitData);
      if (!parsed?.user?.id) throw new UnauthorizedException('Invalid Telegram initData');
      return this.forTelegramUser(parsed.user.id);
    }
    return this.fromClientId(clientId);
  }

  fromClientId(clientId?: string): ItineraryOwner {
    if (!clientId || !/^[A-Za-z0-9_-]{8,160}$/.test(clientId)) throw new UnauthorizedException('X-NV-Client-ID is required');
    return { key: `client:${clientId}`, kind: 'client' };
  }
  forTelegramUser(userId: number): ItineraryOwner {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthorizedException('Invalid Telegram owner');
    return { key: `tg:${userId}`, kind: 'telegram' };
  }
}
