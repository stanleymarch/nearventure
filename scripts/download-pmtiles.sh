#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# download-pmtiles.sh — сборка PMTiles векторных тайлов для территории
#
# Использование:
#   bash scripts/download-pmtiles.sh pfo          # ПФО (умолчание)
#   bash scripts/download-pmtiles.sh szfo         # СЗФО
#   bash scripts/download-pmtiles.sh my-region    # новый округ из regions.conf
#
# Требования:
#   • pmtiles CLI (https://github.com/protomaps/go-pmtiles/releases)
#     Установите в PATH или укажите PMTILES_BIN
#
#   • wget или curl
#
# Что делает:
#   1. Определяет bbox территории из regions.conf
#   2. Скачивает protomaps planet сборку (кэширует в docker/data/)
#   3. Вырезает регион по bbox
#   4. Кладёт готовый .pmtiles в docker/data/tiles/
#
# Результат:
#   docker/data/tiles/<territory>.pmtiles  — векторные тайлы
#   docker/data/tiles/                     — смонтировано в nginx:/var/tiles
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILES_DIR="${PROJECT_ROOT}/docker/data/tiles"
CACHE_DIR="${PROJECT_ROOT}/docker/data"

PMTILES_BIN="${PMTILES_BIN:-pmtiles}"

# ── Конфигурация территорий ──────────────────────────────────────────────────
# Формат: bbox="minLon,minLat,maxLon,maxLat"
# Заменить коды на свои — см. гео-границы региона.

declare -A REGIONS
# ПФО — Приволжский федеральный округ.
# Geofabrik volga-fed-district.poly: 41.72107,49.75097–61.73371,61.71971.
# Keep a small margin so the visual basemap covers every GraphHopper route.
REGIONS[pfo]="41.5,49.5,62,62"
# СЗФО — Северо-Западный федеральный округ
REGIONS[szfo]="27,54,48,68"
# ЦФО — Центральный федеральный округ
REGIONS[cfo]="31,50,42,58"
# ЮФО — Южный федеральный округ
REGIONS[yufo]="35,44,48,49"
# СФО — Сибирский федеральный округ
REGIONS[sfo]="72,50,87,60"
# УФО — Уральский федеральный округ
REGIONS[ufo]="58,52,68,56"
# ДФО — Дальневосточный федеральный округ
REGIONS[dfo]="105,42,163,70"

# ── Выбор территории ─────────────────────────────────────────────────────────
TERRITORY="${1:-pfo}"
BBOX="${REGIONS[$TERRITORY]:-}"

if [[ -z "$BBOX" ]]; then
  echo "❌ Неизвестная территория: $TERRITORY"
  echo "   Доступны: ${!REGIONS[*]}"
  echo ""
  echo "   Чтобы добавить новую, пропишите bbox в раздел REGIONS"
  echo "   файла scripts/download-pmtiles.sh и перезапустите."
  echo ""
  echo "   Пример: REGIONS[my-region]=\"minLon,minLat,maxLon,maxLat\""
  exit 1
fi

echo "🌍 Территория:    $TERRITORY"
echo "📦 Bounding box:  $BBOX"

mkdir -p "$TILES_DIR" "$CACHE_DIR"

# ── Проверка pmtiles CLI ─────────────────────────────────────────────────────
if ! command -v "$PMTILES_BIN" &>/dev/null; then
  echo ""
  echo "❌ pmtiles CLI не найден. Установите:"
  echo "   curl -L https://github.com/protomaps/go-pmtiles/releases/latest/download/pmtiles_linux_amd64 -o /usr/local/bin/pmtiles"
  echo "   chmod +x /usr/local/bin/pmtiles"
  echo ""
  echo "   Или скачайте для Windows: https://github.com/protomaps/go-pmtiles/releases"
  exit 1
fi

# ── Определяем URL planet-сборки ─────────────────────────────────────────────
# Используем стабильную сборку Protomaps с фиксированной датой.
# См. https://maps.protomaps.com/builds/ — список доступных релизов.
# Дата привязана, чтобы повторные запуски давали тот же результат.
# Чтобы обновить, поменяйте BUILD_DATE.
#
# ВАЖНО: extract поддерживает удалённый URL напрямую — planet скачивается
# не целиком (~135 GB), а только нужные чанки (~1-2 GB для региона).
# Если локальный planet уже есть, будет использован он (быстрее).
#
# Для удалённого extract нужен стабильный интернет (на VPS работает лучше).

BUILD_DATE="${BUILD_DATE:-20260428}"
PLANET_URL="https://build.protomaps.com/${BUILD_DATE}.pmtiles"
PLANET_FILE="${CACHE_DIR}/planet-${BUILD_DATE}.pmtiles"
USE_REMOTE="${USE_REMOTE:-false}"

# ── Загружаем planet (опционально) ───────────────────────────────────────────
# Если USE_REMOTE=true или planet уже есть — пропускаем скачивание
# и сразу переходим к extract из удалённого источника.
if [[ "$USE_REMOTE" != "true" ]] && [[ ! -f "$PLANET_FILE" ]]; then
  echo ""
  echo "⬇️  Скачиваю Protomaps planet сборку (${BUILD_DATE})..."
  echo "   URL: $PLANET_URL"
  echo "   ⚠️  Это ~135 GB. ОЧЕНЬ ДОЛГО."
  echo ""
  echo "   💡 ВАЖНО: Для региона (ПФО) planet скачивать НЕ нужно."
  echo "   Используйте extract из удалённого URL:"
  echo "   USE_REMOTE=true bash $0 pfo"
  echo ""

  if command -v wget &>/dev/null; then
    wget --continue --show-progress -O "$PLANET_FILE" "$PLANET_URL"
  elif command -v curl &>/dev/null; then
    curl -L -C - --progress-bar -o "$PLANET_FILE" "$PLANET_URL"
  else
    echo "❌ Ни wget, ни curl не найдены. Установите один из них."
    exit 1
  fi
elif [[ -f "$PLANET_FILE" ]]; then
  echo "✓ Planet сборка уже есть локально: $(du -h "$PLANET_FILE" | cut -f1)"
else
  echo "ℹ️  Используем удалённый extract без скачивания planet (USE_REMOTE=true)"
fi

# ── Вырезаем регион ──────────────────────────────────────────────────────────
OUTPUT="${TILES_DIR}/${TERRITORY}.pmtiles"

if [[ -f "$OUTPUT" ]]; then
  echo "✓ Тайлы для $TERRITORY уже есть: $(du -h "$OUTPUT" | cut -f1)"
  echo "  Чтобы пересобрать, удалите: rm $OUTPUT"
else
  echo ""
  echo "✂️  Вырезаю регион $TERRITORY (bbox=$BBOX, maxzoom=14)..."
  echo "   Это может занять несколько минут (или час при медленном интернете)."

  if [[ "$USE_REMOTE" == "true" ]] || [[ ! -f "$PLANET_FILE" ]]; then
    # Extract из удалённого URL — скачиваются только нужные чанки
    $PMTILES_BIN extract "$PLANET_URL" "$OUTPUT" \
      --bbox="$BBOX" \
      --maxzoom=14 \
      --download-threads=4
  else
    # Extract из локального файла (быстрее, если planet уже есть)
    $PMTILES_BIN extract "$PLANET_FILE" "$OUTPUT" \
      --bbox="$BBOX" \
      --maxzoom=14
  fi

  echo ""
  echo "✓ Готово: $(du -h "$OUTPUT" | cut -f1)"
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo "── 📋 Итог ──────────────────────────────────────"
ls -lh "$OUTPUT" 2>/dev/null || true
echo ""
echo "Для подключения в .env укажите:"
echo "  VITE_PMTILES_URL=/tiles/${TERRITORY}.pmtiles"
echo "  VITE_PMTILES_VERSION=${BUILD_DATE}   # cache-bust: меняется при каждой пересборке"
echo ""
echo "NB: VITE_PMTILES_URL — это BARE-URL без префикса pmtiles:// (код фронтенда"
echo "    дописывает схему сам: pmtiles://\${VITE_PMTILES_URL})."
echo ""
echo "А в nginx тайлы уже будут доступны:"
echo "  https://nearventure.ru/tiles/${TERRITORY}.pmtiles"
echo ""
echo "Чтобы добавить новый округ:"
echo "  1. Найдите его bbox (можно на https://boundingbox.klokantech.com/)"
echo "  2. Добавьте строку в REGIONS[] в этом скрипте"
echo "  3. Запустите: bash scripts/download-pmtiles.sh ваш-округ"
