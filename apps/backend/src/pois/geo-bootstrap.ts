import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';

/**
 * Ensure the PostGIS schema piece that TypeORM's `synchronize` CANNOT manage:
 * the indexed `geom` geography column, the trigger keeping it in sync with
 * `lat`/`lon`, and the GIST spatial index.
 *
 * Idempotent — safe to run on every boot. Called after TypeORM has created the
 * `poi` table from the entity (so `lat`, `lon` already exist).
 *
 * Why outside the entity: TypeORM has no first-class `geography(Point,4326)`
 * column that survives `synchronize`. This mirrors how
 * `docker/postgres/init-extensions.sql` manages extensions outside TypeORM.
 *
 * (The pgvector HNSW embedding index is deferred — added later with the AI work.)
 */
export async function ensureGeoSchema(dataSource: DataSource): Promise<void> {
  const logger = new Logger('GeoSchema');
  const queries = [
    // Spatial column + auto-maintaining trigger (app writes lat/lon only).
    `ALTER TABLE poi ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)`,
    `UPDATE poi
       SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
     WHERE geom IS NULL AND lat IS NOT NULL AND lon IS NOT NULL`,
    `CREATE OR REPLACE FUNCTION poi_set_geom() RETURNS trigger AS $$
     BEGIN
       IF NEW.lat IS NOT NULL AND NEW.lon IS NOT NULL THEN
         NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326)::geography;
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS poi_set_geom_tgr ON poi`,
    `CREATE TRIGGER poi_set_geom_tgr
       BEFORE INSERT OR UPDATE OF lat, lon ON poi
       FOR EACH ROW EXECUTE FUNCTION poi_set_geom()`,
    // Spatial index (radius / bbox queries).
    `CREATE INDEX IF NOT EXISTS poi_geom_gist ON poi USING GIST (geom)`,
  ];

  for (const sql of queries) {
    try {
      await dataSource.query(sql);
    } catch (err: any) {
      throw new Error(
        `ensureGeoSchema failed on:\n  ${sql.slice(0, 120)}...\n  → ${err.message}`,
      );
    }
  }
  logger.log('PostGIS geom column + trigger + GIST index ready.');
}
