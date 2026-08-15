import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { BroadcastLogEntity } from './broadcast-log.entity';

export enum BroadcastStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('scheduled_broadcasts')
export class ScheduledBroadcastEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  title: string; // Заголовок рассылки (для админа)

  @Column()
  message: string; // Текст сообщения

  @Column()
  scheduledAt: Date; // Когда отправить

  @Column({ type: 'enum' })
  repeatEvery?: 'daily' | 'weekly' | 'monthly' | null; // Периодичность (null = разово)

  @Column('simple-array')
  channelIds: string[]; // Список ID каналов (без @)

  @Column({ type: 'enum', default: BroadcastStatus.PENDING })
  status: BroadcastStatus;

  @Column()
  userId: string | null; // Кто создал (auth user)

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  sentAt: Date | null; // Когда отправлена (успешно)

  @Column({ type: 'text', nullable: true })
  errorLog: string | null; // Ошибка при отправке

  // Отношения
  @OneToMany(() => BroadcastLogEntity, 'broadcast', { cascade: true })
  logs: BroadcastLogEntity[];
}