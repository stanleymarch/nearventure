import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Manual overrides for POI fields.
 * When present, these values take precedence over the pipeline-generated
 * poi_product columns via COALESCE in PoisService SQL queries.
 *
 * Designed for admin edits (via bot or frontend dashboard) that should
 * survive pipeline re-runs. Also used for community-suggested edits
 * from the share link feedback form (osm_contributor).
 */
@Entity('poi_overrides')
export class PoiOverride {
  /** POI UUID (references poi_product.poi_uuid — no FK constraint,
   *  since poi_product is managed by the external Python pipeline).
   *  Uses varchar (not native uuid) because poi_product stores hex strings
   *  without dashes (e.g. '8637976e969f430c191c873373e152cf'). */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  poi_uuid: string;

  /** Manual display name (overrides poi_product.name). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  display_name: string | null;

  /** Manual description (overrides poi_product.description). */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Custom image URL — can be:
   *  - external URL (Wikimedia, MKRF, etc.) → proxy will fetch + cache
   *  - local path (/media/poi/xxx.jpg) when admin uploaded directly
   */
  @Column({ type: 'text', nullable: true })
  image_url: string | null;

  /** Per-image attribution metadata (author, license) from Commons API
   *  or entered manually by admin. */
  @Column({ type: 'jsonb', nullable: true })
  image_attribution: Record<string, any> | null;

  /** OSM contributor who suggested this edit (from share-link feedback). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  osm_contributor: string | null;

  /** Who made the edit: 'admin' | 'community' */
  @Column({ type: 'varchar', length: 50, default: 'admin' })
  updated_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
