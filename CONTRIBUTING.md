# Контрибьютинг в Nearventure

Спасибо, что хотите помочь! Nearventure — маленький проект одного автора, и любой
вклад ценен: от исправления опечатки до нового модуля. Этот файл объясняет, как
начать.

> Русскоязычный: обсуждения и коммиты можно вести на русском или английском.
> Документация проекта — на русском.

---

## С чего начать

- Загляните в [Issues](https://github.com/stanleymarch/nearventure/issues) — задачи
  для новичков помечены `good first issue`.
- Прочитайте [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (как устроено) и
  [docs/ROADMAP.md](docs/ROADMAP.md) (что делаем и зачем именно в таком порядке).
- Прежде чем брать крупную фичу — откройте issue/обсуждение, чтобы убедиться, что
  направление совпадает с планом и никто уже не делает то же самое.

## Разработка

```bash
npm install
bash scripts/download-osm.sh                          # один раз: OSM PBF ПФО
docker compose -f docker/docker-compose.yml up -d     # Postgres + GraphHopper
cp apps/backend/.env.example apps/backend/.env && …   # заполнить секреты
npm run dev:backend:log    # → :3000
npm run dev:frontend:log   # → :5173
```

Подробно — в [README](README.md#быстрый-старт-разработка) и
[docs/environment.md](docs/environment.md).

> **Запуск сервисов.** `dev:backend:log` / `dev:frontend:log` запускают процессы с
> логированием (PID в `logs/`). Останавливайте через `npm run kill:backend` /
> `kill:frontend`. Не оставляйте зомби-процессы.

## E2E-тесты (Playwright)

Сьюта e2e-тестов лежит в [`e2e/`](e2e/). Использует Chrome через CDP
(Chrome DevTools Protocol) — браузер должен быть запущен отдельно с флагом
`--remote-debugging-port=9222`. Локально тесты запускаются на собранном стеке.

### Предусловия

```bash
# 1. Локальный стек (см. выше): Postgres, GraphHopper (:8981), бэкенд (:3000)
npm run dev:backend:log
npm run dev:frontend:log
# или через скрипт быстрого старта:
npm run dev

# 2. Chrome с CDP (в отдельном окне терминала):
start chrome --remote-debugging-port=9222 --user-data-dir="$TMPDIR/chrome-e2e"
```

### Запуск

```bash
cd e2e
npx playwright test                    # полный прогон
npx playwright test --reporter=list     # verbose-список
npx playwright test tests/map.spec.ts   # один файл
npx playwright test "tests/map.spec.ts:50"  # один тест по номеру строки
npx playwright show-report              # HTML-отчёт
```

### Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:5173` | Базовый URL фронтенда |
| `PLAYWRIGHT_TEST_BASE_URL` | — | Алиас `E2E_BASE_URL` (приоритет у `E2E_BASE_URL`) |
| `E2E_BROWSER_MODE` | `cdp` | Режим браузера: `cdp` (Chrome с `--remote-debugging-port`), `headless` (Playwright-браузер) |
| `CI` | — | При установке: retries=2, reporter=list, forbidOnly |

### Архитектура

- **Фикстуры** (`fixtures.ts`) — `connectedPage` создаёт новую вкладку в открытом
  Chrome через CDP. Каждый тест получает изолированный контекст.
- **Селекторы** — современные: `getByRole`, `getByText`, `getByTestId`, `locator`
  с aria-атрибутами. Старые BEM-селекторы (`.nv-*`) не используются.
- **Тесты** пишутся для критических юзер-флоу: карта (POI-маркеры, кластеры,
  изохроны), каталог, админка, онбординг, доступность.

### CI/CD

В CI (GitHub Actions) запускаются только build, typecheck и unit-тесты
(см. `.github/workflows/ci.yml`). E2E (Playwright через CDP) в CI не входит —
он требует локально поднятого стека и Chrome с CDP.

## Стиль кода

- **Бэкенд:** NestJS-модули, DI, возможности пишутся один раз в *capabilities* и
  экспонируются через тонкие транспорты (см. ARCHITECTURE §2, §5). Не дублируйте
  логику между REST / Telegram / MCP.
- **Фронтенд:** Vue 3 `<script setup>`, переиспользуемые composables, Tailwind по
  дизайн-токенам (CSS-переменные в `style.css`).
- **Типы:** TypeScript строгий. Бэкенд собирается чисто (`npm run build:backend`).
  На фронтенде `npm run build` собирает бандл; строгая проверка типов — отдельно
  `npm run typecheck`.
- **Двуязычность:** данные POI и UI — ru/en с первого дня (см. ARCHITECTURE §11).

## Коммиты и PR

- Делайте коммиты с понятными сообщениями. Рекомендуется
  [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`, `chore:`), но это не строго.
- Одна фича/фикс — один PR. Держите diff обзорным.
- Убедитесь, что `npm run build` проходит (бэкенд собирается без ошибок).
- Если меняете API/схему — обновите документацию (`docs/`, `AGENTS.md` если касается
  поверхности API). Не отмечайте внешние owner gates беты как выполненные без
  доказательства владельца: Telegram device acceptance с replacement token и чистый
  публичный GitHub baseline после ротации секретов остаются вне обычного PR.

## Данные — самый ценный контрибьют

Код важен, но **открытые данные** — сердце проекта. Огромный вклад без единой
строки кода:

- **Дополняйте OpenStreetMap** в Кировской области (POI, тропинки, покрытие). Это
  делает Nearventure и все карты лучше. Скоринг «интересности» маршрутов работает
  на этих данных.
- **Wikimedia Commons / Wikidata** — фото и описания объектов обогащают карточки.
- Пайплайн сбора/дедупликации — внешний репозиторий
  [poi-toolkit](https://github.com/stanleymarch/poi-toolkit) (TypeScript).
  Nearventure-сторона — только импортёр: `apps/backend/src/importer/`
  (`npm run import:poi`). Если нашли баг в матчинге/дедупликации — идите в
  poi-toolkit; баг в импорте/валидации manifest — в `src/importer/`.
- Не публикуйте POI через SQL или старые collector/sync-скрипты. Для production
  обязательны trusted root, backup и dry-run — см. [docs/data-refresh.md](docs/data-refresh.md).
  Зафиксированный beta audit `pfo-v0.1-v1` (30 359 POI) не освобождает новый
  import от этой процедуры.

## Лицензия контрибьюций

Принимая контрибьют, вы соглашаетесь, что он лицензируется под
[AGPL-3.0](LICENSE) (код) и/или **ODbL** (данные, как производная от OSM). Это
обеспечивает принцип проекта: производные сервисы тоже должны открывать исходники.

## Обнаружили проблему безопасности?

Не открывайте публичный issue для утечек секретов/уязвимостей. Напишите лично через
[профиль автора](https://github.com/stanleymarch) или на контакт в боте.

---

Ещё раз спасибо. Хорошей поездки. 🚲
