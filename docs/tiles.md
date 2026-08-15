# Тайлы (PMTiles) — сборка и деплой

Nearventure использует **векторные тайлы PMTiles** как единственный источник
базовой карты. PMTiles — это один файл, содержащий все z/x/y тайлы региона,
который отдаётся nginx через HTTP range requests.

## Стек

```
Protomaps Planet сборка (стабильный релиз)
  ↓ pmtiles extract --bbox --maxzoom=14 (из URL или локального файла)
pfo.pmtiles (региональный файл, ~800 MB)
  ↓ монтируется в nginx как /var/tiles/
https://nearventure.ru/tiles/pfo.pmtiles
  ↓ загружается MapLibre через pmtiles:// протокол
  ↓ накладывается style.json с кастомным Protomaps Flavor
MapLibre GL JS в браузере
```

**ВАЖНО:** extract поддерживает работу с удалённым URL напрямую — скачиваются только нужные чанки региона (~1-2 GB), а не весь planet (~135 GB).

## Сборка тайлов

### 1. Установите pmtiles CLI

```bash
# Linux (amd64)
curl -L https://github.com/protomaps/go-pmtiles/releases/latest/download/pmtiles_linux_amd64 -o /usr/local/bin/pmtiles
chmod +x /usr/local/bin/pmtiles

# macOS (arm64)
curl -L https://github.com/protomaps/go-pmtiles/releases/latest/download/pmtiles_darwin_arm64 -o /usr/local/bin/pmtiles
chmod +x /usr/local/bin/pmtiles

# Windows — скачайте .exe с https://github.com/protomaps/go-pmtiles/releases
# и добавьте в PATH
```

### 2. Соберите регион

```bash
# ПФО — по умолчанию, extract из удалённого URL
USE_REMOTE=true bash scripts/download-pmtiles.sh pfo

# Любой другой округ
USE_REMOTE=true bash scripts/download-pmtiles.sh cfo   # ЦФО
USE_REMOTE=true bash scripts/download-pmtiles.sh szfo  # СЗФО
```

Скрипт:
1. Extract из удалённого URL (скачивает только нужные чанки ~1-2 GB)
2. Или использует локальный кэш planet если он уже есть (быстрее)
3. Вырезает регион по bbox (zoom 0–14)
4. Кладёт `.pmtiles` в `docker/data/tiles/` — туда, где nginx его видит

**Примечание:** на dev-машине Windows может быть медленно. Лучше запускать на VPS (настройки те же).

### 3. Подключите в .env

```env
# VITE_PMTILES_URL — BARE-URL без префикса pmtiles:// (фронтенд дописывает схему
# сам: sources.protomaps.url = `pmtiles://${VITE_PMTILES_URL}`).

# Для dev/prod (self-hosted, если pfo.pmtiles уже собран и лежит в /var/tiles):
VITE_PMTILES_URL=/tiles/pfo.pmtiles

# Или удалённый Protomaps (для dev без сборки — быстро работает):
VITE_PMTILES_URL=https://build.protomaps.com/20260428.pmtiles
```

**Cache-busting (обязательно в проде):** nginx отдаёт `/tiles/` с
`Cache-Control: immutable, max-age=1y`. После каждой пересборки `pfo.pmtiles`
пропишите версию, иначе возвращающиеся пользователи до года будут видеть
старый файл из кэша браузера:

```env
# = BUILD_DATE из download-pmtiles.sh при последней пересборке
VITE_PMTILES_VERSION=20260710
```

Для продакшена — соответствующий env в `docker/.env.prod` или в compose.

## Добавление нового округа (lighter)

1. **Найдите bbox региона** на https://boundingbox.klokantech.com/
   - Переключитесь в режим CSV
   - Выделите область на карте
   - Скопируйте строку `minLon,minLat,maxLon,maxLat`

2. **Пропишите в скрипте** `scripts/download-pmtiles.sh`:

   ```bash
   # В раздел REGIONS добавьте:
   REGIONS[moy-okrug]="minLon,minLat,maxLon,maxLat"
   ```

3. **Соберите**:

   ```bash
   USE_REMOTE=true bash scripts/download-pmtiles.sh moy-okrug
   ```

4. **Готово.** nginx уже отдаёт `/tiles/moy-okrug.pmtiles`.

## Рельеф

Используется Mapterhorn — бесплатный DEM-эндпоинт, никакой сборки не нужно:

```
Источник: https://tiles.mapterhorn.com/{z}/{x}/{y}.webp
Encoding: terrarium
Tile size: 512
Maxzoom: 13
```

Подключён в `AdventureMap.vue` как `raster-dem` для hillshade и
`maplibre-contour` для горизонталей — всё на лету, ничего собирать не нужно.

### Self-hosted terrain (на будущее)

Если Mapterhorn когда-нибудь перестанет подходить:

```bash
# 1. Скачать SRTM для региона (https://earthexplorer.usgs.gov/)
# 2. gdal_contour — предсобранные контуры
gdal_contour -a elev -i 10 -f GeoJSON contours.geojson srtm_merged.tif
# 3. tippecanoe — упаковать в PMTiles
tippecanoe -zg -o contours.pmtiles contours.geojson
# 4. mv contours.pmtiles docker/data/tiles/
```

## Советы по размеру

| Регион | Площадь | PMTiles (z0-14) |
|--------|---------|-----------------|
| ПФО (Киров + Волга) | 1.0 млн км² | ~800 MB |
| СЗФО | 1.7 млн км² | ~1.2 GB |
| РФ целиком | 17 млн км² | ~7-10 GB (z0-10, недоступно — planet 135 GB) |

Примечание: размеры для extract по bbox — скачиваются только нужные чанки.

Для уменьшения размера:
- `--maxzoom=12` — экономит ~60% места (если не нужна детализация до улиц)
- `pmtiles extract` поддерживает `--minzoom` — можно убрать z0-4 для экономии
