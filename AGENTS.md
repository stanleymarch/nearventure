# Гайд для AI-агентов

Этот файл — для AI-ассистентов (Copilot, Cursor, Claude Code, и т.п.), которые
работают с репозиторием Nearventure. Краткая карта, чтобы не навредить.

> Для людей — см. [CONTRIBUTING.md](CONTRIBUTING.md). Этот файл только про
> навигацию и безопасные границы для агентов.

---

## Прочитай сначала

1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — как устроено (слои, capabilities, ADR).
2. **[docs/ROADMAP.md](docs/ROADMAP.md)** — что делаем и в каком порядке.
3. **[docs/environment.md](docs/environment.md)** — переменные окружения.

Канонический принцип: **доменная логика пишется один раз** в слое *capabilities*
(NestJS-сервисы) и экспонируется тонкими транспортами (REST / Telegram). MCP-сервер — в планах.
**Не дублируйте** логику между поверхностями.

## Безопасные границы

- **Не коммитьте секреты.** Файлы `.env`, `.env.prod`, токены, API-ключи — в
  `.gitignore`. Перед коммитом проверяйте staged-диф на секреты.
- **Не запускайте прод-сервисы сами** без явной просьбы. Дев-серверы —
  `npm run dev:backend:log` / `dev:frontend:log`; останов — `kill:backend` /
  `kill:frontend` (PID-файлы в `logs/`).
- **Бинарные данные не коммитятся:** `docker/data/` (OSM PBF, graph-cache, SRTM),
  БД (`*.sqlite`), `node_modules/`, `dist/` — всё в `.gitignore`.
- **Бэкенд собирается строго:** `npm run build:backend` должен быть зелёным.
  На фронтенде `npm run build` собирает бандл; `npm run typecheck` — отдельная
  строгая проверка.

## Где что лежит

```
apps/backend/    NestJS: pois, routing, routes, telegram, analytics, subscriptions
apps/frontend/   Vue 3 SPA: AdventureView (карта), каталог, лендинг
apps/miniapp/    Telegram Mini App (Vue, base=/tg/, шарит код с frontend через @shared)
apps/backend/src/importer/   Manifest-валидируемый импортёр POI (atomic staging swap)
docker/          compose (dev+prod), Dockerfile-ы, nginx/graphhopper/postgres
docs/            архитектура, роадмап, деплой, env
scripts/         download-osm.sh, log-runner, kill-service, deploy-скрипты
e2e/             Playwright через Chrome CDP

> Канонический POI-пайплайн (сбор/дедупликация/экспорт) — ВНЕШНИЙ репозиторий
> [poi-toolkit](https://github.com/stanleymarch/poi-toolkit) (TypeScript).
> Nearventure только валидирует manifest и импортирует датасет.
```

## Частые задачи

- **Обновить POI-датасет / импорт** → `apps/backend/src/importer/` (C6):
  прод — одноразовый Compose-сервис `poi-importer` (профиль `import`,
  `docker compose --profile import run --rm poi-importer --run-dir releases/<tag>`);
  локально — `npm run import:poi -- --trusted-root ... --run-dir ...`; bundle
  выпускает внешний [poi-toolkit](https://github.com/stanleymarch/poi-toolkit).
  Сам пайплайн сбора/дедупликации живёт там же (внешний репозиторий).
- **Новый capability** → сервис в `apps/backend/src/<domain>/`, экспонируй через
  контроллер (REST). Telegram (и в перспективе MCP) зовут тот же сервис.
- **Новый слой карты / маркер** → `apps/frontend/src/components/AdventureMap.vue`,
  состояние карты — реактивные refs (компаньон и клики пишут в одни refs).
- **Маршрут/GPX** → `apps/backend/src/routes/` (gpx.service) и `routing/`.

## Язык

Документация и коммит-сообщения — на русском или английском. Код (идентификаторы,
комментарии) — английский.
