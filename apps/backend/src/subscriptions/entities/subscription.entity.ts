import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  userId: string | null; // Auth user ID (если есть)

  @Column()
  anonymousId: string; // Anonymous tracking ID

  @Column()
  telegramChatId: string; // Chat ID канала (без @)

  @Column()
  channelId: string; // Telegram channel ID (без @)

  @Column({ type: 'enum', default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  @CreateDateColumn()
  subscribedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}