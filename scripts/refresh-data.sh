#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# refresh-data.sh — оркестратор обновления геоданных Nearventure.
#
# Связывает три ручные операции в один воспроизводимый запуск:
#   1) pbf   — свежий OSM PBF (Geofabrik)                  → docker/data/pfo-latest.osm.pbf
#   2) graph — реимпорт GraphHopper (удаление graph-cache)  → docker/data/graph-cache/
#   3) tiles — пересборка PMTiles из свежего Protomaps snapshot → docker/data/tiles/pfo.pmtiles
#
# POI-синк НЕ входит сюда: каталог POI обновляется только через
# manifest-валидируемый импортёр (одноразовый Compose-сервис `poi-importer`,
# профиль "import") из bundle внешнего пайплайна poi-toolkit — см. docs/data-refresh.md.
#
# Использование (с ребра репо):
#   bash scripts/refresh-data.sh                 # = --pbf --graph (типовой прогон)
#   bash scripts/refresh-data.sh --pbf --graph
#   bash scripts/refresh-data.sh --graph         # реимпорт на УЖЕ скачанном PBF
#   bash scripts/refresh-data.sh --tiles 20260710
#   bash scripts/refresh-data.sh --all 20260710  # pbf + graph + tiles
#
# Переменные окружения:
#   COMPOSE_FILE  — путь к compose-файлу (умолч. docker/docker-compose.prod.yml)
#   COMPOSE_CMD   — полная команда compose (умолч. `docker compose -f $COMPOSE_FILE`).
#                   Для проды: COMPOSE_CMD="docker compose --env-file docker/.env.prod \
#                                                   -f docker/docker-compose.prod.yml"
#   BUILD_DATE    — дата Protomaps snapshot для --tiles (или позиционный аргумент)
#
# ⚠️  Реимпорт графа (шаг graph) на ПРОДЕ = окно обслуживания: маршрутизация
#     недоступна ~2–5 мин. Не запускайте без нужды под нагрузкой.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.prod.yml}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose -f $COMPOSE_FILE}"
DATA_DIR="docker/data"
PBF="$DATA_DIR/pfo-latest.osm.pbf"
GRAPH_CACHE="$DATA_DIR/graph-cache"
TILES_DIR="$DATA_DIR/tiles"
GH_SERVICE="graphhopper"

# ── Цветной лог ──────────────────────────────────────────────────────────────
log()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '  \033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── Разбор аргументов ────────────────────────────────────────────────────────
DO_PBF=0
DO_GRAPH=0
DO_TILES=0
BUILD_DATE="${BUILD_DATE:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pbf)   DO_PBF=1; shift;;
    --graph) DO_GRAPH=1; shift;;
    --tiles) DO_TILES=1; shift; [[ $# -gt 0 && "$1" != --* ]] && { BUILD_DATE="$1"; shift; } ;;
    --all)   DO_PBF=1; DO_GRAPH=1; DO_TILES=1; shift; [[ $# -gt 0 && "$1" != --* ]] && { BUILD_DATE="$1"; shift; } ;;
    -h|--help)
      sed -n '2,40p' "$0"; exit 0;;
    *) die "Неизвестный аргумент: $1 (см. --help)";;
  esac
done

# По умолчанию — типовой прогон «свежий PBF + реимпорт графа».
if [[ $DO_PBF -eq 0 && $DO_GRAPH -eq 0 && $DO_TILES -eq 0 ]]; then
  DO_PBF=1; DO_GRAPH=1
fi

echo "──────── Nearventure · обновление геоданных ────────"
echo "  compose:    $COMPOSE_CMD"
echo "  PBF:        $PBF"
echo "  graph-cache:$GRAPH_CACHE"
echo "  steps:     $([[ $DO_PBF -eq 1 ]] && echo -n 'pbf ')$([[ $DO_GRAPH -eq 1 ]] && echo -n 'graph ')$([[ $DO_TILES -eq 1 ]] && echo -n 'tiles')"
[[ $DO_TILES -eq 1 ]] && { [[ -z "$BUILD_DATE" ]] && die "--tiles требует дату Protomaps (напр. 20260710) или BUILD_DATE env"; echo "  BUILD_DATE: $BUILD_DATE"; }
echo "────────────────────────────────────────────────────"

# ── Шаг 1: свежий PBF ────────────────────────────────────────────────────────
step_pbf() {
  log "Шаг 1/3 · Скачиваю свежий OSM PBF (Geofabrik, ПФО)"
  bash scripts/download-osm.sh
  [[ -s "$PBF" ]] || die "PBF не появился после download-osm.sh: $PBF"
  local sz; sz=$(du -h "$PBF" | cut -f1)
  # Geofabrik ПФО ~730 МБ. Если < 400 МБ — подозрительно (обрыв/ошибка).
  local mb; mb=$(stat -c %s "$PBF" 2>/dev/null || stat -f %z "$PBF"); mb=$(( mb / 1024 / 1024 ))
  [[ $mb -lt 400 ]] && die "PBF подозрительно мал (${mb} МБ < 400). Прерывание до реимпорта."
  ok "PBF готов: $sz ($mb МБ) → $PBF"
}

# ── Шаг 2: реимпорт графа ────────────────────────────────────────────────────
step_graph() {
  log "Шаг 2/3 · Реимпорт графа GraphHopper"
  [[ -s "$PBF" ]] || die "Нет PBF для реимпорта ($PBF). Запустите с --pbf."

  # Печатаем, на каком PBF строим — чтобы не перестроить по ошибке на старом.
  local pbf_date; pbf_date=$(date -r "$PBF" '+%Y-%m-%d %H:%M' 2>/dev/null || stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$PBF")
  warn "Маршрутизация будет недоступна ~2–5 мин (окно обслуживания)."
  warn "Граф перестраивается на PBF от: $pbf_date"
  read -r -p "  Продолжить? [y/N] " ans; [[ "$ans" =~ ^[Yy]$ ]] || { echo "  пропускаю"; return 0; }

  log "Останавливаю $GH_SERVICE"
  $COMPOSE_CMD stop "$GH_SERVICE"

  log "Удаляю $GRAPH_CACHE/* (PBF и SRTM-кэш не трогаю)"
  mkdir -p "$GRAPH_CACHE"
  # Удаляем только содержимое graph-cache — сам каталог оставляем (права монтирования).
  find "$GRAPH_CACHE" -mindepth 1 -delete

  log "Запускаю $GH_SERVICE (импорт ~минуты, смотрим логи)"
  $COMPOSE_CMD start "$GH_SERVICE"
  # Хвост логов до появления готовности GraphHopper.
  $COMPOSE_CMD logs -f "$GH_SERVICE" &  local LOGPID=$!
  echo "  (Ctrl+C чтобы выйти из слежения за логами — импорт продолжится в фоне; LOGPID=$LOGPID)"
  ok "Граф пересобирается. Проверьте здоровье: $COMPOSE_CMD logs --tail=50 $GH_SERVICE"
}

# ── Шаг 3: пересборка PMTiles ────────────────────────────────────────────────
step_tiles() {
  log "Шаг 3/3 · Пересборка PMTiles (Protomaps snapshot $BUILD_DATE)"
  [[ -n "$BUILD_DATE" ]] || die "Нет BUILD_DATE"
  # Удаляем старый регион-файл, чтобы download-pmtiles.sh пересобрал (иначе он пропустит).
  [[ -f "$TILES_DIR/pfo.pmtiles" ]] && { warn "Удаляю старый $TILES_DIR/pfo.pmtiles для пересборки"; rm -f "$TILES_DIR/pfo.pmtiles"; }
  USE_REMOTE=true BUILD_DATE="$BUILD_DATE" bash scripts/download-pmtiles.sh pfo
  ok "PMTiles собран: $(du -h "$TILES_DIR/pfo.pmtiles" | cut -f1)"
  echo
  echo "  ⚠️  ОБЯЗАТЕЛЬНО для cache-busting: задайте в окружении сборки SPA"
  echo "      VITE_PMTILES_VERSION=$BUILD_DATE  и пересоберите/перевыкатите фронт."
  echo "      Иначе возвращающиеся пользователи до года будут видеть старые тайлы"
  echo "      (nginx отдаёт /tiles/ с Cache-Control: immutable, max-age=1y)."
  echo "      Подробнее: docs/tiles.md → «Cache-busting»."
}

# ── Запуск ───────────────────────────────────────────────────────────────────
[[ $DO_PBF   -eq 1 ]] && step_pbf
[[ $DO_GRAPH -eq 1 ]] && step_graph
[[ $DO_TILES -eq 1 ]] && step_tiles

echo
echo "──────── ✓ Готово ────────"
echo "  POI (каталог) обновляется отдельно — manifest-импортёр из bundle"
echo "  внешнего poi-toolkit: docker compose --profile import run --rm poi-importer"
echo "    --run-dir releases/<tag>   (см. docs/data-refresh.md)"
echo "  (см. docs/data-refresh.md)"
echo "─────────────────────────"
