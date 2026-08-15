import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { ItineraryDraftState } from '../itinerary.types';

@Entity('itinerary_draft')
@Index('IDX_itinerary_draft_expires_at', ['expiresAt'])
@Index('IDX_itinerary_draft_owner_updated_at', ['ownerKey', 'updatedAt'])
export class ItineraryDraftEntity {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'int', default: 1 }) version: number;
  @Column({ name: 'owner_key', type: 'varchar', length: 160 }) ownerKey: string;
  @Column({ type: 'jsonb' }) state: ItineraryDraftState;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
