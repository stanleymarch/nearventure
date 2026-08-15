# Деплой Nearventure
Продакшен-стек Nearventure — это Docker Compose из пяти сервисов на одном VPS.
Здесь описано, как развернуть проект «с нуля» и как обновлять.

```
        интернет (80/443)
              │
      ┌───────▼────────┐
      │  nginx + TLS   │  ← единственные публичные порты; Let's Encrypt
      └───┬────────────┘
          │ /api/*  /tg/*  /
   ┌──────▼──────┐  ┌──────────────┐  ┌──────────────┐
   │ app (NestJS)│──│ db (Postgres │  │ graphhopper  │
   │ :3000 внутр.│  │  +PostGIS    │  │ PFO PBF +    │
   │ SPA+API+бот│  │  +pgvector)  │  │ SRTM высоты  │
   └─────────────┘  └──────────────┘  └──────────────┘
            docker network `nearventure_net`
```

Только `nginx` торчит наружу (80/443). Всё остальное — на приватной docker-сети
или привязано к `127.0.0.1`.

---

## Требования к серверу

- Linux (Ubuntu 22.04+ / Debian 12+), `systemd`, пользователь с `sudo NOPASSWD`
- **2 vCPU / 4 ГБ RAM / 30 ГБ диск** + мы создаём 4 ГБ swap (GraphHopper нужно пространство)
- Открытые порты **80** и **443** (для nginx + ACME)
- Установленный **Docker** + `docker compose` v2
- Домен (`nearventure.ru`) с A-записью → IP сервера

> Скрипт первичной настройки сервера (Docker + swap + UFW) —
> [`scripts/deploy/prepare-server.sh`](../scripts/deploy/prepare-server.sh).
> Запускается один раз на свежем VPS.

---

## 1. Первичный деплой «с нуля»

### 1.1. Подготовить `.env.prod`

```bash
cp docker/.env.prod.example docker/.env.prod
```

Заполните (см. [environment.md](./environment.md) — каждое поле с пояснением):

- `DOMAIN=nearventure.ru`
- `LETSENCRYPT_EMAIL=…`
- `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD` — **сгенерируйте случайно**
  (`openssl rand -hex 32`)
- `TELEGRAM_BOT_TOKEN` — от [@BotFather](https://t.me/BotFather)
- `TELEGRAM_WEBHOOK_SECRET` — `openssl rand -hex 16`
- `ADMIN_TELEGRAM_CHAT_ID` — ваш chat id (как получить — в [environment.md](./environment.md))
- (опц.) `DONATE_BOOSTY_URL`, `DONATE_CLOUDTIPS_URL` — внешние ссылки Boosty/CloudTips в Telegram-боте; Nearventure не принимает Stars, криптовалюту или платежи внутри приложения

### 1.2. Положить OSM-выгрузку и (опц.) дамп БД

GraphHopper-у (маршрутизация) нужна выгрузка OSM. Nominatim (геокодинг) —
опциональный dev-only инструмент (см. `docker/nominatim/`), в prod-стек он
не входит. Положите PBF в
`docker/data/pfo-latest.osm.pbf` (на сервере — туда же, куда зальёте проект):

```bash
# локально, до заливки:
bash scripts/download-osm.sh     # → docker/data/pfo-latest.osm.pbf (~730 МБ)
```

> **Базу POI можно не собирать с нуля** — если у вас есть готовый дамп
> (`nearventure.sql.gz`), восстановите его после старта БД (шаг 1.5). Иначе POI
> импортируются из bundle внешнего пайплайна poi-toolkit через
> manifest-валидируемый импортёр (одноразовый сервис `poi-importer`, см. шаг 1.6).
> Из PBF в prod берётся только граф маршрутизации (GraphHopper). Геокодинг через
> Nominatim — dev-only и опционально (отдельный локальный контейнер).

### 1.3. Залить проект на сервер

Способ зависит от вашего набора инструментов (SFTP + SSH, rsync, git clone).
Рекомендуемый паттерн в этом репозитории — tar.gz через SFTP, затем распаковка по SSH.

Архивируйте закоммиченное дерево (неотслеживаемые и игнорируемые файлы в него
не попадают):

```bash
git archive --format=tar.gz -o .tmp/release.tar.gz HEAD
```

Before creating the archive, record its source commit (the archive deliberately
excludes `.git`):

```bash
git rev-parse HEAD
```

Pass that exact full SHA to the production image build as `GIT_SHA`. It is
non-secret build provenance, not an application credential.

### 1.4. Поднять стек

На сервере, в корне проекта, сначала соберите приложение и запустите БД, затем обязательно накатите TypeORM migrations **до** запуска нового backend:

```bash
COMPOSE="docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml"
# Set this to the full SHA recorded for the uploaded archive (not the server checkout).
export GIT_SHA=<archive-commit-sha>
$COMPOSE build app
$COMPOSE up -d db
$COMPOSE run --rm app node dist/database/cli/migrate.js up
$COMPOSE up -d graphhopper app nginx certbot
```

`migrationsRun=false`, поэтому запуск нового backend без migration gate запрещён. В частности, migration `1744650000002-AddRouteLoop` добавляет nullable topology для публичных маршрутов; legacy-строки остаются `NULL`.

Что произойдёт:
- `db` — стартует Postgres+PostGIS+pgvector, создаёт БД и расширения (через
  `init-extensions.sql`). Первый старт.
- `graphhopper` — на первом старте импортирует PBF и тянет тайлы SRTM (~1–3 мин).
- `app` — собирается из `docker/app/Dockerfile` (фронтенд + мини-апп + бэкенд), ждёт БД.
- `nginx` — стартует с временным self-signed сертификатом (пока нет Let's Encrypt).
- `certbot` — запускает цикл продления.

### 1.5. (Если есть дамп) Восстановить базу POI

```bash
# дамп кладём в контейнер и восстанавливаем
docker cp nearventure.sql.gz nearventure-db:/tmp/
docker exec nearventure-db sh -c "gunzip -c /tmp/nearventure.sql.gz | psql -U nearventure -d nearventure"
```

### 1.6. Импорт POI-каталога из bundle

POI-каталог импортируется только manifest-валидируемым сервисом `poi-importer`
из bundle внешнего [poi-toolkit](https://github.com/stanleymarch/poi-toolkit);
прямой SQL и legacy Python-пути запрещены. Полный и **канонический consumer
runbook** — [data-refresh.md: «Приём v1 bundle от poi-toolkit»](./data-refresh.md#приём-v1-bundle-от-poi-toolkit).

До этого шага завершите основной deploy (включая `$COMPOSE build app`), затем
следуйте runbook без копирования шагов сюда: он задаёт required handoff
identifiers, проверку compatibility, trusted-root permissions, dry-run, backup,
atomic import, audit, replay и rollback. Сервис `poi-importer` находится в
профиле `import`, не запускается автоматически и всегда требует явного
`--run-dir`.

Историческое production-наблюдение `pfo-v0.1-v1` (30 359 POI, audit и category
counts) зафиксировано датированным операторским наблюдением (2026-08-1x); оно не
заменяет процедуру для следующего bundle.

### 1.7. Получить TLS-сертификат

```bash
bash scripts/deploy/init-letsencrypt.sh
```

Скрипт ставит временный self-signed, поднимает nginx, получает настоящий сертификат
Let's Encrypt и перезагружает nginx. После этого `https://nearventure.ru` работает.

### 1.8. Вебхук Telegram и Mini App

Бэкенд **сам** регистрирует вебхук при старте, если заданы `TELEGRAM_WEBHOOK_DOMAIN`
и `TELEGRAM_WEBHOOK_SECRET` (это делает `telegram.module.ts` → `setWebhook`).
Никаких ручных шагов: `TELEGRAM_WEBHOOK_DOMAIN=nearventure.ru` → вебхук
`https://nearventure.ru/api/telegram/webhook`.

Mini App живёт на `/tg/` (статика отдаётся бэкендом, проксируется nginx). Кнопка
`web_app` в боте указывает на `https://nearventure.ru/tg/` (строится из `PUBLIC_URL`).
У БотФазера слаг миниаппа: `t.me/nearventure_bot/nearapp`.

### 1.9. Healthcheck

```bash
curl -s https://nearventure.ru/api/routing/health     # → GraphHopper status/profiles (без внутренних деталей)
curl -s https://nearventure.ru/api/build              # → only {"buildRevision":"<full GIT_SHA>"}
# /api/build has Cache-Control: no-store; buildRevision must equal the GIT_SHA passed to the image build
curl -s https://nearventure.ru/api/telegram/health    # → liveness: {"status":"ok"}
curl -sI https://nearventure.ru/tg/                    # → 200, Mini App index.html
```

Снимок app/API/routing health и наличие backup/GraphHopper rollback-артефактов
зафиксированы датированным операторским наблюдением (2026-08-1x);
оно не подтверждает восстановление и не заменяет владельцу Telegram device
acceptance с действительным replacement token. Полный набор проверок и незакрытые
owner gates — в [чек-листе беты](./beta-acceptance-checklist.md).

---

## 2. Обновление приложения

```bash
# 1. залить новый код (SFTP/SSH — см. 1.3)
COMPOSE="docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml"
# 2. Set the full SHA recorded for this uploaded archive, then build the image.
export GIT_SHA=<archive-commit-sha>
$COMPOSE build app
# 3. обязательный migration gate
$COMPOSE run --rm app node dist/database/cli/migrate.js up
# 4. переключить app на новый image
$COMPOSE up -d app
# 5. Evidence: /api/build buildRevision must exactly equal $GIT_SHA.
curl -s https://nearventure.ru/api/build
```

`db`, `graphhopper`, `nginx` не трогаются — их волюмы персистентны. Схема **не** обновляется автоматически: production использует `synchronize:false` и `migrationsRun:false`.

> **Важно:** всегда `--build`, иначе образ возьмётся из кэша и новый код не попадёт.
> Сначала `rm -rf apps/*/dist` локально не нужно — Dockerfile собирает с нуля в стадии build.

---

## 3. Волюмы и персистентность

| Волюм / bind | Что хранит | Удаляется при деплое? |
|:--|:--|:--|
| `db_data` (named volume) | Данные Postgres (POI, пользователи, взаимодействия) | **НЕТ** — переживает пересоздание контейнера `db` |
| `app_media` (named volume) | Загруженные фото POI (`/app/media`) | **НЕТ** |
| `./data` (bind mount) | OSM PBF + graph-cache + SRTM-кэш GraphHopper | **НЕТ** — на хосте, переживает всё |
| `/srv/nearventure/imports` (host, read-only mount в `poi-importer`) | bundle POI для manifest-импортёра (C6); `app` доступа не имеет | **НЕТ** — создаётся и обслуживается root'ом |
| `certbot_conf`, `certbot_www` (named) | Сертификаты Let's Encrypt | **НЕТ** |

> Чтобы **полностью** снести данные (например, пересобрать БД с нуля):
> `docker compose ... down -v` удалит named-волюмы. Делайте только осознанно.

---

## 4. Логи и отладка

```bash
# все сервисы:
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml logs -f --tail=100
# конкретный:
docker logs -f nearventure-app
docker logs -f nearventure-graphhopper
# рестарт одного сервиса:
docker compose ... restart app
```

---

## 5. Частые проблемы

| Симптом | Причина | Фикс |
|:--|:--|:--|
| GraphHopper падает / OOM | мало RAM | проверьте swap (4 ГБ), `-Xmx3500m -Xms1500m -XX:ActiveProcessorCount=1` в compose (Volga extract) |
| `502 Bad Gateway` от nginx | `app` ещё грузится или упал | `docker logs nearventure-app`; дождитесь healthcheck БД |
| Сертификат не получен | DNS ещё не делегирован / порты закрыты | A-запись → IP; `ufw allow 80,443/tcp`; перезапустить `init-letsencrypt.sh` |
| Вебхук бота не приходит | `TELEGRAM_WEBHOOK_DOMAIN` без https или не тот домен | должен быть голый домен `nearventure.ru` (бэкенд сам добавит https) |
| Mini App пустой на `/tg/` | мини-апп не собран в образе | проверьте Dockerfile: стадия build собирает `apps/miniapp/dist` |
| `CORS blocked` | `CORS_ORIGIN` не содержит домен | compose уже ставит `https://$DOMAIN` — проверьте `.env.prod` |
| Маршруты 400 «Cannot find point N» | точка вне графа (за пределами PBF) | PBF покрывает только регион старта |

---

## 6. Важно: Telegram бот и Российские VPS

Production Compose всегда задаёт `TELEGRAM_WEBHOOK_DOMAIN=$DOMAIN`, поэтому бот
работает только в webhook-режиме. `TELEGRAM_PROXY` и SOCKS/long-polling fallback
в этом стеке **не поддерживаются**: compose не передаёт такую переменную, а код
не создаёт proxy agent.

Telegram должен иметь возможность доставлять webhook на публичный HTTPS-домен.
Если `getWebhookInfo` показывает `pending > 0` или `last_error: Connection timed out`,
а `/api/telegram/webhook` доступен снаружи, используйте VPS/сеть, доступную Telegram.
Не удаляйте `TELEGRAM_WEBHOOK_DOMAIN` из production-конфигурации: Compose восстановит
его из обязательной переменной `DOMAIN` при следующем запуске.

---

## 7. Что НЕ делает этот стек (по умолчанию)

- **SSH-hardening / fail2ban** — настройте отдельно на этапе `prepare-server.sh`.
- **Backups БД** — настройте `pg_dump` по cron в объектное хранилище (не входит в compose).
- **Медиа-хранилище** — пока локально на VPS; внешнее S3/R2/B2 подключается в Фазе 7 (ADR-007).
- **Полностью self-hosted карта** — базовая PMTiles-подложка локальна, но внешние
  glyph/sprite Protomaps, CyclOSM, Waymarked Trails, ArcGIS World Imagery и terrain
  tiles остаются зависимостями беты.

Полный перечень env — [environment.md](./environment.md).
