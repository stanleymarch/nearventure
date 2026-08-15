-- Nearventure Postgres extensions. Runs once on first DB init.
-- PostGIS  → spatial queries (POI in radius, bbox, routing reachability).
-- vector   → pgvector, semantic search over POI description embeddings.
-- pg_trgm  → fast fuzzy text search on POI names (built-in, lightweight).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
