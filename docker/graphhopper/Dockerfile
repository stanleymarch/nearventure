# GraphHopper 11.0 — built from the official release JAR.
#
# There is NO public Docker image anymore (Docker Hub `graphhopper/*` is gone,
# ghcr.io/graphhopper/graphhopper is not anonymously pullable). The supported
# self-host path is to run the release `graphhopper-web-<ver>.jar` on a JRE.
#
# Build context: docker/graphhopper/
#   docker compose -f docker/docker-compose.yml build graphhopper
#
# The config.yml is mounted at runtime (see docker-compose.yml) so config
# changes don't require a rebuild. The OSM PBF + graph cache live in ./data.

FROM eclipse-temurin:21-jre-jammy

RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /graphhopper

# Pin the version for reproducibility. Bump here + in config.yml together.
ARG GH_VERSION=11.0
RUN wget -q "https://github.com/graphhopper/graphhopper/releases/download/${GH_VERSION}/graphhopper-web-${GH_VERSION}.jar" -O graphhopper.jar

EXPOSE 8989
# JAVA_OPTS injected via compose (memory cap). Config mounted at /graphhopper/config.yml
CMD ["sh", "-c", "java $JAVA_OPTS -jar graphhopper.jar server /graphhopper/config.yml"]
