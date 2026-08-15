# Postgres with PostGIS (geo queries) + pgvector (semantic POI search)
# on a single image — no full Supabase platform needed.
FROM postgis/postgis:16-3.4

# pgvector ships in the PGDG apt repo that the postgis image already configures.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*
