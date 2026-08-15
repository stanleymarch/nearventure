import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { ItineraryDraft } from '../itinerary.types';
import { ItineraryDraftEntity } from './itinerary-draft.entity';

@Entity('itinerary_command')
export class ItineraryCommandEntity {
  @PrimaryColumn('uuid', { name: 'draft_id' }) draftId: string;
  @PrimaryColumn('uuid', { name: 'command_id' }) commandId: string;
  @Column({ name: 'result_version', type: 'int' }) resultVersion: number;
  @Column({ name: 'result_snapshot', type: 'jsonb' }) resultSnapshot: ItineraryDraft;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @ManyToOne(() => ItineraryDraftEntity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'draft_id' }) draft?: ItineraryDraftEntity;
}
