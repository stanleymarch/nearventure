import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BroadcastLogStatus {
  SENT = 'sent',
  FAILED = 'failed',
  PARTIAL = 'partial', // отправлена часть каналов
}

@Entity('broadcast_logs')
export class BroadcastLogEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  broadcastId: string; // ID ScheduledBroadcast

  @Column()
  channelId: string; // Telegram channel ID (без @)

  @Column({ type: 'enum', default: BroadcastLogStatus.SENT })
  status: BroadcastLogStatus;

  @Column({ nullable: true })
  sentAt: Date | null; // Когда отправлена

  @Column({ type: 'text', nullable: true })
  errorLog: string | null; // Ошибка

  @CreateDateColumn()
  createdAt: Date;
}