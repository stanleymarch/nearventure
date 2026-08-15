import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { PoiRow } from '../../pois/pois.service';
import type { RoutingProfile } from '../../routing/routing.types';
import type { RouteResult } from '../../routing/routing.types';

export enum RouteStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  HIDDEN = 'hidden',
  ARCHIVED = 'archived',
}

@Entity('routes')
export class RouteEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'enum', enum: RouteStatus, default: RouteStatus.DRAFT })
  status: RouteStatus;

  @Column({ type: 'enum', enum: RouteStatus, nullable: true })
  previousStatus?: RouteStatus;

  // Маршрутные данные
  @Column({ type: 'text' })
  transport: RoutingProfile;

  /** NULL is a truthful legacy state: older map saves discarded this option. */
  @Column({ type: 'boolean', nullable: true, default: null })
  loop: boolean | null;

  @Column({ type: 'int', nullable: true })
  timeAvailable: number;

  @Column('simple-array')
  selectedCategories: string[];

  @Column({ type: 'float' })
  distance: number;

  @Column({ type: 'int' })
  duration: number;

  @Column({ type: 'float' })
  ascend: number;

  @Column({ type: 'float' })
  descend: number;

  @Column({ type: 'json', nullable: true })
  geojson?: any;

  // POIs в маршруте.
  // Stored as jsonb — the old `simple-array` (text + comma-join) cannot hold
  // complex objects; it was producing "[object Object]" strings on round-trip
  // (see B1 in logs/qa/REPORT.md). The migration 1731000000000 converts
  // existing text rows to a jsonb array.
  @Column({ type: 'jsonb', nullable: true })
  pois: Array<{ id: string; name: string; category: string; lat: number; lon: number; distance?: number; description?: string; imageUrl?: string | null; hasMedia?: boolean }> | null;

  @Column({ name: 'source_draft_id', type: 'uuid', nullable: true })
  sourceDraftId: string | null;

  @Column({ name: 'itinerary_snapshot', type: 'jsonb', nullable: true })
  itinerarySnapshot: Record<string, unknown> | null;

  // Analytics
  @Column({ type: 'json', nullable: true })
  analytics?: {
    views: number;
    shares: number;
    lastViewedAt?: string;
    previewClicks?: number;
    gpxDownloads?: number;
  };

  // Публичный доступ
  @Column({ type: 'varchar' })
  publicToken: string;

  @Column({ type: 'text', nullable: true })
  publicUrl: string | null;

  @Column({ type: 'date', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'boolean', default: false })
  isPublished: boolean = false;

  @Column({ type: 'boolean', default: false })
  isArchived: boolean = false;

  // Метаданные
  @Column({ type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'date', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'date', nullable: true })
  deletedAt: Date | null;
}