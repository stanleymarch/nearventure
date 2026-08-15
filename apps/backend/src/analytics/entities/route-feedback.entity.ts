import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * User feedback on a stored route. Anonymous (no login required) — tied to the
 * share link (`/route/:id`). Pushed to the admin's Telegram on creation.
 *
 * `osmContributor` + `osmContributionNote` capture the "public-good impact"
 * question: did the user contribute to OSM / other open-data sources, and do
 * they plan to? Aggregated in the admin summary.
 */
@Entity('route_feedback')
@Index('IDX_feedback_route', ['routeId'])
@Index('IDX_feedback_anon', ['anonymousId'])
export class RouteFeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'route_id', type: 'uuid' })
  routeId: string;

  /** 1–5 stars. */
  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  /** "Did you contribute to OSM / open-data services?" (null = skipped). */
  @Column({ name: 'osm_contributor', type: 'boolean', nullable: true })
  osmContributor: boolean | null;

  /** Free-text "plans to contribute / impact" note. */
  @Column({ name: 'osm_contribution_note', type: 'text', nullable: true })
  osmContributionNote: string | null;

  /** Front-supplied UUID (localStorage) — dedup one review per anon per route. */
  @Column({ name: 'anonymous_id', type: 'varchar', length: 40, nullable: true })
  anonymousId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
