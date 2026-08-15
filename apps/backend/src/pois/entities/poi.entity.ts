import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * POI category enum — taxonomy assigned by the POI pipeline (external poi-toolkit).
 * Actual taxonomy: specs/03-poi-data.md §3.1. Name/icon/color must match contents.
 *
 *   heritage  → Наследие          (castles, manors, ruins, archaeology, city gates/walls)
 *   monument  → Монументы         (war memorials, Lenin statues, obelisks)
 *   sights    → Достопримечательности (viewpoints, attractions, artworks, sculptures)
 *   religion  → Религия и некрополи (places of worship, monasteries, wayside crosses, cemeteries/tombs)
 *   museum    → Музеи             (museums, galleries)
 *   nature    → Природа           (lakes, rivers, springs, parks + ООПТ as subflag)
 *   service   → По пути           (cafes, restaurants, food shops — en-route stops)
 */
export type PoiCategory = 'heritage' | 'monument' | 'sights' | 'religion' | 'nature' | 'museum';

export const POI_CATEGORIES: readonly PoiCategory[] = [
  'heritage',
  'monument',
  'sights',
  'religion',
  'nature',
  'museum',
];

export type PoiSource = 'osm' | 'wikivoyage' | 'wikidata' | 'egrkn' | 'mkrf';

/**
 * @deprecated — Not used by PoisService (reads poi_product via raw SQL). Kept for
 * reference; do not rely on its column list. Real schema = poi_product
 * (poi_uuid, subcategory, heritage_facet, is_protected, attribution,
 * provenance, wikidata_qid).
 *
 * The heart of Nearventure: a point of interest (ARCHITECTURE.md §4).
 *
 * MVP note: embeddings (pgvector) and the semantic search are intentionally
 * deferred (ROADMAP §current priority). The `embedding vector(1536)` column and
 * related code will be added when we return to AI features — not now.
 *
 * `geom` (geography Point 4326) + its GIST index are managed OUTSIDE TypeORM
 * by `ensureGeoSchema()` (pois/geo-bootstrap.ts): TypeORM's `synchronize` can't
 * own a PostGIS geography column. `lat`/`lon` are the app-facing writable
 * fields; a DB trigger keeps `geom` in sync so indexed spatial queries
 * (ST_DWithin, bbox) work.
 */
@Entity('poi')
@Unique('UQ_poi_source_externalId', ['source', 'externalId'])
@Index('IDX_poi_category', ['category'])
export class PoiEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', default: 'osm' })
  source: PoiSource;

  /** OSM node id (as string), Wikidata Q-id, etc. — unique per source. */
  @Column({ type: 'varchar' })
  externalId: string;

  @Column({ type: 'varchar' })
  category: PoiCategory;

  /** Raw source tags (e.g. the full OSM tag dict). */
  @Column({ type: 'jsonb', nullable: true })
  tags: Record<string, string> | null;

  /** Wikidata Q-id (e.g. 'Q123456'), the gold key for cross-source dedup.
   *  Set from OSM `wikidata` tag or Python pipeline Wikidata fetch. Enables merge across sources. */
  @Index('IDX_poi_wikidataId')
  @Column({ type: 'varchar', nullable: true })
  wikidataId: string | null;

  /** ЕГРКН registration number (links an OSM/Wikidata POI to a heritage object).
   *  Source of truth for isHeritage/heritageSignificance. */
  @Index('IDX_poi_egrknRegNumber')
  @Column({ type: 'varchar', nullable: true })
  egrknRegNumber: string | null;

  @Column({ type: 'double precision' })
  lat: number;

  @Column({ type: 'double precision' })
  lon: number;

  /** Fallback name when no locale-specific name exists (often Russian in Kirov). */
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', nullable: true })
  nameRu: string | null;

  @Column({ type: 'varchar', nullable: true })
  nameEn: string | null;

  @Column({ type: 'text', nullable: true })
  descRu: string | null;

  @Column({ type: 'text', nullable: true })
  descEn: string | null;

  @Column({ type: 'varchar', nullable: true })
  imageUrl: string | null;

  @Column({ type: 'boolean', default: false })
  featured: boolean;

  /** True if matched to an ЕГРКН cultural-heritage object (source='egrkn'). Set by
   *  the Python pipeline (sources/egrkn.py), not by OSM. Drives the `heritage` category enrichment. */
  @Column({ type: 'boolean', default: false })
  isHeritage: boolean;

  /** Heritage significance (ЕГРКН): 'federal' | 'regional' | 'local' | null.
   *  null = not an ОКН or significance unknown. Source of truth: ЕГРКН. */
  @Column({ type: 'varchar', nullable: true })
  heritageSignificance: 'federal' | 'regional' | 'local' | null;

  /** Where the heritage flag came from ('egrkn', 'wikidata', 'manual'). Audit trail. */
  @Column({ type: 'varchar', nullable: true })
  heritageSource: string | null;

  /** Recomputed periodically from anon `interaction` signals (Phase 2/4). */
  @Column({ type: 'float', default: 0 })
  popularityScore: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
