# Обновление геоданных (PBF · граф · тайлы · POI)

Правки из OSM доходят до Nearventure **тремя независимыми путями**: basemap-тайлы,
routing-граф и каталог POI. Этот документ описывает, что и когда обновлять.

> Связанный оркестратор: `scripts/refresh-data.sh`.
> Архитектурный контекст: [ARCHITECTURE.md](./ARCHITECTURE.md), [tiles.md](./tiles.md).

## Три слоя данных

| Слой | Что показывают | Источник | Обновляется | Инструмент |
|:--|:--|:--|:--|:--|
| **Basemap-тайлы** | Озёра, дороги, леса **на карте** | Protomaps planet snapshot (`BUILD_DATE`) | вручную | `scripts/download-pmtiles.sh` |
| **Routing-граф** | Учёт дорог **в маршрутах** | Geofabrik PBF + GraphHopper graph-cache | вручную (реимпорт) | `scripts/download-osm.sh` + удаление `graph-cache/` |
| **POI-каталог** | Точки интереса в каталоге и на карте | bundle внешнего poi-toolkit (`SQL + manifest.json`) | вручную | одноразовый сервис `poi-importer` (C6) |

**Ключевое:** этот файл — **канонический consumer runbook Nearventure** для
приёма и импорта POI bundle. POI-каталог обновляется **только** через
manifest-валидируемый импортёр (`apps/backend/src/importer/`) — никаких прямых
SQL-прогонов и Python-скриптов в Nearventure. Встроенный `poi-collector/`
(Python) и инкрементальный `osm-sync` удалены (см. C7); канонический пайплайн
сбора — внешний [poi-toolkit](https://github.com/stanleymarch/poi-toolkit).

Граница ответственности producer и точный состав выпуска описаны в
[Nearventure v1 bundle handoff (poi-toolkit)](https://github.com/stanleymarch/poi-toolkit/blob/main/docs/nearventure-handoff.md).
Этот runbook определяет только действия потребителя: размещение неизменённых
байтов под trusted root, проверку, импорт и сохранение evidence.

## Политика публичных изображений

Nearventure — consumer готового bundle и не считает плоскую атрибуцию источника
доказательством прав на конкретное изображение. В публичных list/detail API и
`/api/pois/:id/media` изображение с `image_source: "external"` скрывается, если
у него нет непустого структурированного `image_attribution` (verified metadata
producer или authenticated admin override). Например, OSM URL вместе с одной
лишь source-level записью ODbL не публикуется и не попадает в Telegram.

Это не меняет generic producer bundle: policy применяется только Nearventure на
read path. EGRKN/MKRF, Wikimedia Commons и локальные `/media/...` изображения
сохраняют прежнее поведение; cache проверяется после policy, поэтому старый cache
не способен повторно выдать скрытое изображение.
## Когда что обновлять

| Сценарий | Что сделать |
|:--|:--|
| Выпустили новый bundle POI в poi-toolkit | `docker compose ... --profile import run --rm poi-importer --run-dir releases/<tag>` (см. ниже) |
| Добавили озеро/реку/лес **на карту** | `bash scripts/refresh-data.sh --tiles <BUILD_DATE>` |
| Добавили/изменили дорогу **в маршрутизации** | `bash scripts/refresh-data.sh --pbf --graph` |
| Полное обновление разом | `bash scripts/refresh-data.sh --all <BUILD_DATE>` |

## Источники тяжёлых артефактов

Где Nearventure берёт большие данные (ничего не вендорится в репозиторий):

| Артефакт | Источник | Как получить | Кеш |
|:--|:--|:--|:--|
| OSM PBF (`pfo-latest.osm.pbf`) | [Geofabrik](https://download.geofabrik.de/russia/volga-fed-district-latest.osm.pbf) — вырезка Приволжского ФО (≈730 МБ, покрывает Кировскую область) | `bash scripts/download-osm.sh` | `docker/data/` |
| Граф GraphHopper | **Не скачивается** — строится из PBF при первом старте (`docker compose up -d graphhopper`, импорт + SRTM ≈1–3 мин) | см. [deployment.md](deployment.md) §1.4 | `docker/data/graph-cache/` |
| SRTM-высоты | **NASA SRTM** — GraphHopper скачивает тайлы автоматически при первом импорте (`graph.elevation.provider: srtm` в `docker/graphhopper/config.yml`) | ничего не нужно | `docker/data/srtm-cache/` |
| Векторные тайлы `pfo.pmtiles` | [Protomaps planet builds](https://maps.protomaps.com/builds/) — стабильная сборка с фиксированной датой | `bash scripts/download-pmtiles.sh pfo` (переменная `BUILD_DATE`, дефолт в скрипте) | `docker/data/tiles/` |
| POI-датасет (bundle) | **poi-toolkit** (GitHub Releases, `releases/<tag>`) — отдельный TS-инструмент сбора/дедупликации/экспорта; Nearventure только импортирует | см. «Приём v1 bundle» ниже | `/srv/nearventure/imports` (прод) |
| Веса Photon (геокодинг коллектора) | [photon.komoot.io/data/](https://photon.komoot.io/data/russia-latest.tar) — массовое бесплатное геокодирование при сборе poi-toolkit | описано в `poi-toolkit/docker/photon/README.md` | `poi-toolkit/docker/data/photon/` |

> Геокодирование в боте Nearventure сейчас не используется: `route.handler.ts`
> распознаёт только известные слова («киров» → центр Кирова). Реальный геокодинг
> живёт в отдельном TS-инструменте сбора poi-toolkit (Photon по умолчанию, опционально
> Nominatim/Yandex — см. `packages/geocode`), чтобы укладываться в бесплатные лимиты
> публичных Nominatim.

## Оркестратор `refresh-data.sh`

```bash
# Типовой прогон: свежий PBF + реимпорт графа (закрывает «новая дорога не учитывается»)
bash scripts/refresh-data.sh                     # = --pbf --graph

# Только реимпорт графа на уже скачанном PBF
bash scripts/refresh-data.sh --graph

# Пересобрать тайлы (закрывает «озеро не отображается»)
bash scripts/refresh-data.sh --tiles 20260710

# Всё сразу
bash scripts/refresh-data.sh --all 20260710
```

Для проды задайте правильную compose-команду (с env-файлом):

```bash
COMPOSE_CMD="docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml" \
  bash scripts/refresh-data.sh --pbf --graph
```

⚠️ Шаг `--graph` = окно обслуживания: маршрутизация недоступна ~2–5 мин во время
реимпорта. Не запускайте под пиковой нагрузкой.

### Cache-busting тайлов (обязательно)

nginx отдаёт `/tiles/` с `Cache-Control: immutable, max-age=1y`. После пересборки
`pfo.pmtiles` **обязательно** поднимите версию и перевыкатите SPA, иначе
возвращающиеся пользователи до года будут видеть старый файл из кэша браузера:

```env
VITE_PMTILES_VERSION=20260710   # = BUILD_DATE из последней пересборки
```

## Рекомендуемое расписание (host crontab)

Положите на сервер (MSK, `crontab -e`). Пути замените на свои.

```cron
# ── Раз в неделю (вт 04:00) — свежий PBF + реимпорт графа (окно обслуживания) ──
0 4 * * 2  cd /srv/nearventure && COMPOSE_CMD="docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml" bash scripts/refresh-data.sh --pbf --graph >> logs/refresh-graph.log 2>&1

# ── Раз в месяц (1-го числа 04:30) — пересборка тайлов из свежего snapshot ──
30 4 1 * *  cd /srv/nearventure && bash scripts/refresh-data.sh --tiles $(date +\%Y\%m\%d) >> logs/refresh-tiles.log 2>&1
#   ⚠️ после пересборки поднять VITE_PMTILES_VERSION и пересобрать SPA (см. cache-busting)

# ── POI-импорт из нового bundle poi-toolkit — вручную, после проверки bundle ──
#   docker compose --env-file docker/.env.prod --profile import \
#     -f docker/docker-compose.prod.yml run --rm poi-importer \
#     --dry-run --run-dir releases/<tag>
#   ... затем обычный импорт (см. «Trusted root импортёра (C6)» ниже)
#   (автоматизации не требуется)
```

> Инкрементального `osm-sync` больше нет: POI-каталог меняется только явным
> импортом готового bundle.

### Сериализация писателей `poi_product` (advisory lock)

Писатели `poi_product` — manifest-валидируемый импортёр (C6, staging + atomic
swap) и пересчёт популярности (`AnalyticsService`, 04:00) — берут **один и тот же
транзакционный advisory lock** перед любой записью:

```sql
SELECT pg_advisory_xact_lock(hashtext('nearventure_poi_import_v1'));
```

Ключ задан один раз в `apps/backend/src/importer/poi-write-lock.ts`
(`POI_WRITE_LOCK_KEY`). Lock транзакционный: автоматически освобождается на
commit/rollback и не требует ручной очистки. Без него пересчёт популярности мог
бы пересечься с atomic-swap импортом и молча потерять пакет записей.

### Приём v1 bundle от poi-toolkit

До размещения bundle оператор получает от producer **все** следующие значения
из `reports/poi_product_import.manifest.json` вместе с путём к передаваемой
директории:

| Группа | Обязательные идентификаторы / поля |
|:--|:--|
| Формат | `schemaVersion`, `kind`, `compatibility.recordsFormat` |
| Набор и запуск | `datasetVersion`, `run.id`, `territory.slug`, `territory.profile` |
| Сборка producer | `toolkit.version`, `toolkit.revision` |
| SQL-артефакт | `records.path`, `records.count`, `records.bytes`, `records.sha256` |
| Release provenance | `provenance.releaseManifest.path`, `provenance.releaseManifest.sha256` |
| Collection provenance | `provenance.collectionProvenance.path`, `provenance.collectionProvenance.sha256` |
| Лицензирование источников | `sourceAttribution.notice`, `sourceAttribution.components` |

Для текущего consumer обязательны фиксированные v1-значения: `schemaVersion: 1`,
`kind: nearventure.poi-product-import`,
`compatibility.recordsFormat: nearventure-poi-product-sql-v1`,
`territory.profile: nearventure-v1` и пути
`reports/poi_product_import.manifest.json`, `reports/poi_product_import.sql`,
`release/manifest.json`, `reports/collection-provenance.json`. SHA-256 — 64
символа lowercase hex и относится к фактически переданным байтам. Импортёр v`1.0.0`
принимает bundle только когда
`minImporterVersion <= 1.0.0 < maxImporterVersionExclusive`.

**Порядок потребителя:** (1) producer завершает и локально проверяет полный
неизменяемый v1 bundle; (2) передаёт перечисленные идентификаторы, три digest
(SQL, release manifest, collection provenance) и release evidence; (3) оператор
Nearventure проверяет окно совместимости и помещает неизменённую директорию под
trusted root; (4) выполняет обязательный dry-run; (5) создаёт backup и запускает
импорт; (6) проверяет `poi_import_audit` и сохраняет evidence. Успех команды
`release` или `export-sql` в poi-toolkit **не является** принятием Nearventure.
Исправленный или новый набор требует новых `datasetVersion`, `run.id`, manifest и
набора digest — нельзя заменять уже принятый bundle на месте.

### Trusted root импортёра (C6)

Manifest-валидируемый импортёр (C6) никогда не резолвит run-директорию по
pathname: всё читается через цепочку удерживаемых directory-descriptor'ов
(Linux `/proc/self/fd`), заякоренную на **trusted root** — явный путь,
который оператор передаёт `--trusted-root` (или `POI_IMPORT_TRUSTED_ROOT`).

**Продакшен-вызов** — одноразовый Compose-сервис `poi-importer` (профиль
`import`), который переиспользует собранный образ приложения и получает
trusted root read-only mount. Сервис не запускается сам (`profiles: ["import"]`,
дефолтная команда — безопасный `--help`): импорт всегда требует явного `--run-dir`.

```bash
COMPOSE="docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml"
$COMPOSE build app                              # образ = nearventure-app:local

# 1) Проверка bundle без записи в БД (обязательный первый шаг):
#    <tag> = тег GitHub Release poi-toolkit (например, v0.1.0);
#    архив оттуда распаковывается как releases/<tag> в trusted-root (см. ниже).
$COMPOSE --profile import run --rm poi-importer --dry-run --run-dir releases/v0.1.0

# 2) Бэкап БД (даже atomic-swap — обязателен):
docker exec nearventure-db sh -c 'pg_dump -U nearventure -d nearventure' | gzip > \
  ~/backups/poi-pre-$(date +%Y%m%d-%H%M).sql.gz

# 3) Обычный импорт (атомарный staging swap, poi_overrides не трогается):
$COMPOSE --profile import run --rm poi-importer --run-dir releases/v0.1.0
```

Локальная разработка (из `apps/backend`, без сборки):

```bash
npm run import:poi -- --trusted-root /abs/path/to/imports --run-dir releases/v0.1.0
```

Правила безопасности и порядка:

- **Владение и права:** каталог принадлежит root с правами `0750`
  (`drwxr-x---`); приложение и любой сетевой процесс НЕ имеют права писать в
  него, а сам mount в `poi-importer` — read-only. Настройка (на сервере, от root):

  ```bash
  sudo install -d -m 0750 -o root -g root /srv/nearventure/imports
  # bundle кладётся как /srv/nearventure/imports/releases/<tag> (например, rsync
  # под вашим пользователем), затем фиксируется: содержимое после публикации
  # менять нельзя (иначе не сойдутся SHA-256 из манифеста):
  sudo chown -R root:root /srv/nearventure/imports/releases/<tag>
  sudo chmod -R a-w /srv/nearventure/imports/releases/<tag>
  ```
- **Бэкап перед импортом** — всегда (см. шаг 2 выше). Пока данные целы,
  откат на предыдущий датасет делается восстановлением дампа.
- **Dry-run перед обычным импортом** — всегда: полная валидация артефактов
  и грамматики SQL без единой записи.
- **Replay отклоняется по умолчанию.** Тот же bundle (тот же
  `manifest_sha256`) импортируется повторно только с явным `--allow-replay`
  и только после проверки `poi_import_audit` — например, для повторного
  прогона после ручного восстановления из дампа.
- **`--run-dir` — только чистый относительный путь** без `..`, абсолютных путей
  и `\`; любые симлинки в цепочке ниже trusted root отклоняются (`path_escape`).
- Trusted root открывается ровно один раз с `O_DIRECTORY|O_NOFOLLOW` и
  привязывается по dev/ino (identity binding, записан до open); подмена
  каталога по настроенному пути отклоняется. Остаточное окно — подмена самого
  *сконфигурированного* пути между stat и open — находится внутри
  доверительной границы администратора (root).
- Не-Linux платформы: импортёр отказывает с `secure_open_unsupported`
  (fail closed, никогда не слабее).

## Подводный камень: короткие тупики в маршрутизации

`docker/graphhopper/config.yml`: `prepare.min_network_size: 200` — GraphHopper
**отбрасывает изолированные куски сети короче 200 м**. Если новая дорога —
короткий тупик, не стыкующийся с основной сетью, она не попадёт в граф даже после
реимпорта. Проверьте в OSM, что дорога связана с остальной сетью (или рассмотрите
снижение порога, помня о размере графа и RAM VPS).
