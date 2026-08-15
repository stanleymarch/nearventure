import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity, SubscriptionStatus } from './entities/subscription.entity';
import { TelegramChannelsService } from './telegram-channels.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    private readonly telegramChannelsService: TelegramChannelsService,
  ) {}

  /**
   * Подписать пользователя на канал.
   */
  async subscribeToChannel(
    userId: string | null,
    anonymousId: string,
    channelId: string,
    chatId: string,
  ): Promise<SubscriptionEntity> {
    // Проверяем, что канал существует и бот в админах
    const channel = await this.telegramChannelsService.getChat(channelId);
    if (!channel) {
      throw new Error('Channel not found or bot is not an admin');
    }

    // Проверяем, что пользователь не подписан
    const existing = await this.subscriptionRepo.findOne({
      where: [
        { userId, anonymousId },
        { anonymousId },
      ],
    });

    if (existing) {
      await this.subscriptionRepo.remove(existing);
    }

    const subscription = this.subscriptionRepo.create({
      userId: userId || null,
      anonymousId,
      channelId,
      telegramChatId: chatId,
      status: SubscriptionStatus.ACTIVE,
      subscribedAt: new Date(),
    });

    return this.subscriptionRepo.save(subscription);
  }

  /**
   * Отписать пользователя от канала.
   */
  async unsubscribeFromChannel(subscriptionId: string): Promise<void> {
    await this.subscriptionRepo.delete({ id: subscriptionId });
  }

  /**
   * Получить все подписки пользователя.
   */
  async getUserSubscriptions(userId: string | null, anonymousId?: string): Promise<SubscriptionEntity[]> {
    if (userId) {
      return this.subscriptionRepo.find({
        where: { userId },
        order: { subscribedAt: 'DESC' },
      });
    } else if (anonymousId) {
      return this.subscriptionRepo.find({
        where: { anonymousId },
        order: { subscribedAt: 'DESC' },
      });
    }
    return [];
  }

  /**
   * Получить список ID каналов пользователя (для рассылки).
   */
  async getUserChannelIds(userId: string | null, anonymousId?: string): Promise<string[]> {
    const subs = await this.getUserSubscriptions(userId, anonymousId);
    return subs
      .filter((s) => s.status === SubscriptionStatus.ACTIVE)
      .map((s) => s.channelId);
  }

  /**
   * Проверить, состоит ли пользователь в канале (по userId).
   */
  async isUserChannelMember(channelId: string, userId: string): Promise<boolean> {
    if (!userId) return false;

    const chatId = await this.telegramChannelsService.getChatIdByChannelId(channelId);
    if (!chatId) return false;

    const member = await this.telegramChannelsService.getChatMember(chatId, userId);
    return !!member;
  }

  /**
   * Получить статистику подписок для админа.
   */
  async getSubscriptionStats(): Promise<{
    totalSubscribers: number;
    activeSubscribers: number;
    channels: Array<{ id: string; name: string; subscribers: number }>;
  }> {
    const total = await this.subscriptionRepo.count();
    const active = await this.subscriptionRepo.count({
      where: { status: SubscriptionStatus.ACTIVE },
    });

    // Группируем по каналам и считаем активных подписчиков
    const subs = await this.subscriptionRepo.find({
      where: { status: SubscriptionStatus.ACTIVE },
    });

    const channelMap = new Map<string, { id: string; name: string; subscribers: number }>();
    for (const sub of subs) {
      if (!channelMap.has(sub.channelId)) {
        const channel = await this.telegramChannelsService.getChat(sub.channelId);
        channelMap.set(sub.channelId, {
          id: sub.channelId,
          name: channel?.title || sub.channelId,
          subscribers: 0,
        });
      }
      channelMap.get(sub.channelId)!.subscribers += 1;
    }

    return {
      totalSubscribers: total,
      activeSubscribers: active,
      channels: [...channelMap.values()].sort((a, b) => b.subscribers - a.subscribers),
    };
  }
}