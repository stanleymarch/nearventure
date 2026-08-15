#!/usr/bin/env bash
# Downloads the Volga Federal District OSM extract (Geofabrik) for GraphHopper
# and Nominatim. Covers Kirov Oblast (relation 115100, bundled into the district).
# Output: docker/data/pfo-latest.osm.pbf
#
# Usage:  bash scripts/download-osm.sh
#
# If the default URL 404s, verify the exact slug at:
#   https://download.geofabrik.de/russia.html
# and override via:  OSM_PBF_URL=<url> bash scripts/download-osm.sh

set -euo pipefail

# Geofabrik has no `kirov-oblast` subregion — Kirov Oblast (relation 115100) is bundled
# into the Volga Federal District. Use the district file (730 MB) as the default.
# For a Kirov-only cut (~50-120 MB, lighter graph), use osmium extract:
#   osmium extract --polygon=kirov.poly volga-fed-district-latest.osm.pbf -o kirov.osm.pbf
# (kirov.poly generated from relation 115100 via https://web.archive.org/... poly service)
DEFAULT_URL="https://download.geofabrik.de/russia/volga-fed-district-latest.osm.pbf"
URL="${OSM_PBF_URL:-$DEFAULT_URL}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../docker/data"
OUT="$OUT_DIR/pfo-latest.osm.pbf"

mkdir -p "$OUT_DIR"

echo "Downloading OSM extract (Volga Federal District, covers Kirov Oblast)..."
echo "  from: $URL"
echo "  to:   $OUT"

if command -v curl >/dev/null 2>&1; then
  curl -L --fail -o "$OUT" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$OUT" "$URL"
else
  echo "ERROR: need curl or wget." >&2
  exit 1
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo "Done. File size: $SIZE"
echo "Now start GraphHopper:  docker compose -f docker/docker-compose.yml up -d graphhopper"
echo "(first run will import the graph + fetch SRTM tiles, ~1-3 min)"
