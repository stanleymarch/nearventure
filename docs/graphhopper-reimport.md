# Re-import GraphHopper after profile changes

`docker/graphhopper/config.yml` changes profile names, custom models, LM entries
or `graph.encoded_values`. They apply only when GraphHopper builds a new graph.
This is a production maintenance procedure: do not run it without a maintenance
window.

Production mounts `docker/data/` at `/data`. Although committed
`docker/graphhopper/config.yml` retains `graph.location: /data/graph-cache`,
production Compose explicitly sets
`-Ddw.graphhopper.graph.location=/data/default-gh` in `JAVA_OPTS`; its effective
persistent cache is therefore `$APP/docker/data/default-gh` on the host. This
source-defined production contract is not an opaque image override. This
procedure intentionally does **not** change the committed `graph.location`. Do
not delete the PBF or SRTM cache.

## Preflight and rollback-input backup

Run these commands on the production host from the current known-good release
checkout (`$APP`), **before extracting or deploying the new release archive**.
They preserve the old code, Compose configuration, GraphHopper config/models,
environment file, and cache separately; the cache alone is not a full rollback.

```bash
set -eu
APP=/srv/nearventure
cd "$APP"
COMPOSE="docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MAINTENANCE="maintenance/graphhopper/${STAMP}"
ROLLBACK="${MAINTENANCE}/rollback-inputs"
mkdir -p "$ROLLBACK/docker"

# The known-good tracked release must be reproducible before archive deployment.
git diff --exit-code
git rev-parse HEAD | tee "$ROLLBACK/revision"
git archive --format=tar --output="$ROLLBACK/release.tar" HEAD
cp -a docker/docker-compose.prod.yml docker/.env.prod "$ROLLBACK/docker/"
cp -a docker/graphhopper "$ROLLBACK/docker/graphhopper"
sha256sum "$ROLLBACK/release.tar" "$ROLLBACK/docker/docker-compose.prod.yml" \
  "$ROLLBACK/docker/.env.prod" "$ROLLBACK/docker/graphhopper/config.yml" \
  "$ROLLBACK/docker/graphhopper/models/"*.json \
  | tee "$ROLLBACK/inputs.sha256"

# Preserve the exact inputs that will build the new cache.
sha256sum docker/graphhopper/config.yml docker/graphhopper/models/*.json \
  | tee "${MAINTENANCE}/new-inputs.sha256"
$COMPOSE config --quiet

# Verify the rendered target Compose configuration contains the exact explicit
# production-cache contract. Do not inspect the old running container here.
$COMPOSE config \
  | grep -Fx '      JAVA_OPTS: -Xmx3500m -Xms1500m -XX:ActiveProcessorCount=1 -Ddw.graphhopper.graph.location=/data/default-gh'

test -d docker/data/default-gh
curl --fail --silent --show-error https://nearventure.ru/api/routing/health \
  | tee "${MAINTENANCE}/health-before.json"
```

Continue only if the saved health response has `available: true` and lists all
seven profiles: `car`, `bike`, `bike_touring`, `mtb`, `mtb_leisure`, `foot`, and
`foot_scenic`. Confirm the PBF and SRTM data are present in `docker/data/` and
record sufficient free disk space for both the existing and imported cache.
Keep `${MAINTENANCE}` outside any release archive replacement; it contains the
inputs needed to restore the previous release.

## Recreate a legacy Docker network

After deploying the approved new release archive, return to `$APP`, set
`COMPOSE` as above, and run this in the maintenance window. Do **not** use
`docker compose down`: after the Compose network changed, it may target the
legacy network ambiguously. This explicitly detects only the legacy
`172.18.0.0/16` network, stops every Nearventure container (including certbot)
and every endpoint/orphan attached to it, and removes containers **without**
`-v`, so named volumes remain intact.

```bash
cd "$APP"
LEGACY_NETWORK=docker_nearventure_net

if docker network inspect "$LEGACY_NETWORK" >/dev/null 2>&1; then
  SUBNET=$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$LEGACY_NETWORK")
  if [ "$SUBNET" = "172.18.0.0/16" ]; then
    mapfile -t NEARVENTURE_CONTAINERS < <(
      {
        docker ps -aq --filter 'name=nearventure-'
        docker network inspect -f '{{range $id, $_ := .Containers}}{{$id}}{{"\n"}}{{end}}' "$LEGACY_NETWORK"
      } | sort -u
    )
    if ((${#NEARVENTURE_CONTAINERS[@]})); then
      docker stop "${NEARVENTURE_CONTAINERS[@]}" || true
      docker rm "${NEARVENTURE_CONTAINERS[@]}"
    fi

    # Docker refuses network removal while any endpoint remains attached.
    ENDPOINTS=$(docker network inspect -f '{{len .Containers}}' "$LEGACY_NETWORK")
    test "$ENDPOINTS" -eq 0
    docker network rm "$LEGACY_NETWORK"
  elif [ "$SUBNET" != "172.28.0.0/16" ]; then
    echo "Unexpected $LEGACY_NETWORK subnet: $SUBNET" >&2
    exit 1
  fi
fi

# The committed Compose file now creates docker_nearventure_net as 172.28/16.
$COMPOSE up -d db
SUBNET=$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "$LEGACY_NETWORK")
test "$SUBNET" = "172.28.0.0/16"
```

If the network already reports `172.28.0.0/16`, do not delete it; continue with
the committed Compose configuration. An unexpected subnet is a stop condition.

## Backup cache and full import

Move the old cache only after the release inputs above have been saved and the
network gate has passed. Do **not** remove it: moving it aside lets GraphHopper
make a new `default-gh` while retaining the old cache for the full rollback
procedure below.

```bash
mv docker/data/default-gh "docker/data/default-gh-${STAMP}"

# Starts an empty default-gh import with the committed production JVM limits.
$COMPOSE up -d graphhopper

# Fail closed before app/nginx start: prove the newly created container received
# the exact production-cache contract (not the old pre-deploy container).
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' nearventure-graphhopper \
  | grep -Fx 'JAVA_OPTS=-Xmx3500m -Xms1500m -XX:ActiveProcessorCount=1 -Ddw.graphhopper.graph.location=/data/default-gh'

$COMPOSE logs -f --tail=100 graphhopper
```

Wait for GraphHopper to finish importing successfully; do not start the public
application or end the maintenance window on an OOM/restart loop. On 2026-08-12,
operators observed repeated Java `OutOfMemoryError` failures in `ForkJoinPool`
with `-Xmx3500m -Xms1500m` but without `ActiveProcessorCount=1`; adding
`-XX:ActiveProcessorCount=1` became healthy and used about 2.588 GiB. This is a
dated operator-observed baseline, not a universal known-safe limit: revalidate
completion, health, and route smokes for every import.

## Postflight gates

Before restoring normal traffic, prove that the cache inputs did not change,
that the committed network is in use, and that the application sees the
expected imported graph. Normal restored services include certbot.

```bash
sha256sum --check "${MAINTENANCE}/new-inputs.sha256"
$COMPOSE up -d app nginx certbot

test "$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' docker_nearventure_net)" = "172.28.0.0/16"
test "$(docker inspect -f '{{with index .NetworkSettings.Networks "docker_nearventure_net"}}{{.IPAddress}}{{end}}' nearventure-nginx)" = "172.28.0.10"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' nearventure-app \
  | grep -Fx 'TRUSTED_PROXIES=172.28.0.10'

curl --fail --silent --show-error https://nearventure.ru/api/routing/health \
  | tee "${MAINTENANCE}/health-after.json"
```

The postflight health response must again report `available: true` and include
`car`, `bike`, `bike_touring`, `mtb`, `mtb_leisure`, `foot`, and `foot_scenic`.
Run disposable route smokes for every profile before reopening production traffic.
Preserve the old cache and maintenance evidence until the change is accepted.

## Full rollback

If import or any postflight gate fails, restore the old release inputs **and**
the old cache. Do not claim that restoring `default-gh` alone rolls back a
changed release. These commands do not remove PBF, SRTM data, PostgreSQL
volumes, POI data, or named volumes.

```bash
cd "$APP"
# Stop and remove failed containers without -v before restoring old inputs.
docker ps -aq --filter 'name=nearventure-' | xargs -r docker stop || true
docker ps -aq --filter 'name=nearventure-' | xargs -r docker rm

rm -rf docker/data/default-gh
test -d "docker/data/default-gh-${STAMP}"
mv "docker/data/default-gh-${STAMP}" docker/data/default-gh

# Restore the exact tracked old release plus deployment-specific old inputs.
git reset --hard "$(cat "$ROLLBACK/revision")"
tar -xpf "$ROLLBACK/release.tar" -C "$APP"
cp -a "$ROLLBACK/docker/." docker/
sha256sum --check "$ROLLBACK/inputs.sha256"

OLD_COMPOSE="docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml"
$OLD_COMPOSE build app
$OLD_COMPOSE up -d db graphhopper app nginx certbot
```

The final command restores the normal services, including certbot, using the
old code/config/model inputs and old graph cache. If the old release used a
legacy network, perform the network-recreation section with its committed
network settings before its final `up` command.
