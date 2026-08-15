# Переменные окружения

Nearventure использует три конфига окружения. Примеры лежат рядом, настоящие
файлы (с секретами) — в `.gitignore`.

| Файл | Назначение | Копировать из |
|:--|:--|:--|
| `apps/backend/.env` | Локальная разработка бэкенда (БД, JWT, токены) | `apps/backend/.env.example` |
| `apps/frontend/.env` | Локальная разработка фронтенда (базовый URL API) | `apps/frontend/.env.example` |
| `docker/.env.prod` | Продакшен (домен, TLS, прод-секреты) — читается prod-compose | `docker/.env.prod.example` |

---

## `apps/backend/.env` — бэкенд (и дев, и прод)

### База данных

| Переменная | По умолчанию | Описание |
|:--|:--|:--|
| `DB_HOST` | `localhost` | Хост PostgreSQL (дев: localhost; прод-compose: `db`) |
| `DB_PORT` | `5432` | Порт PostgreSQL |
| `DB_USERNAME` | `nearventure` | Пользователь БД |
| `DB_PASSWORD` | — | Пароль БД. **В проде — длинный случайный**, обязателен явно и не может быть `nearventure_dev`. |
| `DB_DATABASE` | `nearventure` | Имя базы |
| `DB_LOGGING` | `false` | Логировать SQL-запросы (полезно при отладке) |
| `ALLOW_DB_RESET` | — | Одноразовый opt-in для `npm run db:reset`: значение должно быть строго `1`; reset также принимает только точный loopback `DB_HOST` (`localhost`, `127.0.0.0/8`, `::1`). Проверки выполняются до подключения к БД. |

> Указанные defaults применяются только вне production. В production все пять
> `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` должны быть
> переданы явно; известный dev-пароль `nearventure_dev` отклоняется. Это же
> централизованное разрешение используют migration и POI-import CLI.

### Сервер и безопасность

| Переменная | По умолчанию | Описание |
|:--|:--|:--|
| `PORT` | `3000` | Порт бэкенда |
| `JWT_SECRET` | dev: `dev-secret-change-me` | Секрет подписи JWT (админ-панель). **В проде обязателен** и не должен быть dev-значением — при его отсутствии/равенстве dev-дефолту приложение **не стартует** (fail closed). Сгенерируйте `openssl rand -hex 32` |
| `ADMIN_LOGIN` | dev: `admin` | Логин первого админа (создаётся один раз на пустой БД). **В проде обязателен** — compose и приложение падают (fail closed) без него, вместо создания известного `admin` |
| `ADMIN_PASSWORD` | dev: `admin` | Пароль первого админа. **В проде обязателен** при пустой БД — без него старт упадёт (fail closed), вместо создания известного `admin/admin`. В логи никогда не пишется |
| `CORS_ORIGIN` | localhost… | Разрешённые CORS-origins через запятую (прод: `https://nearventure.ru`) |
| `GIT_SHA` | — | Не секретный полный lowercase SHA (`^[0-9a-f]{40}$`) исходного commit, переданный Docker build-arg. Публичный `GET /api/build` без кэша возвращает только `{ "buildRevision": GIT_SHA \| null }`; отсутствующее или невалидное значение возвращается как `null`. В production задаётся только для `$COMPOSE build app` согласно [deployment.md](./deployment.md). |

### Защита публичных routing-эндпоинтов (rate/size/concurrency)

| Переменная | По умолчанию | Описание |
|:--|:--|:--|
| `HTTP_RATE_LIMIT_MAX` | `60` | Fixed-window лимит запросов на IP на каждый публичный routing-эндпоинт (`POST /api/routing/{route,plan,round-trip,isochrone}`). При превышении — `429` + заголовок `Retry-After` |
| `HTTP_RATE_LIMIT_WINDOW_MS` | `60000` | Длина окна rate-limit в миллисекундах |
| `HTTP_RATE_LIMIT_MAX_BUCKETS` | `10000` | Жёсткий потолок хранимых rate-limit-корзин (ключ на IP). Истёкшие корзины вычищаются при достижении потолка; новые ключи сверх потолка получают `429` — память не растёт безгранично |
| `TRUSTED_PROXIES` | — (пусто) | Разрешённые прокси (IP или IPv4-CIDR через запятую), которые могут задавать `X-Forwarded-For`. В прод-compose — закреплённый IP nginx (`172.28.0.10`), который перезаписывает заголовок значением `$remote_addr`. Пусто в деве = поддельные заголовки игнорируются, identity — реальный socket-peer |
| `ROUTING_MAX_CONCURRENCY` | `4` | Максимум одновременных исходящих запросов к GraphHopper (все потребители: HTTP, бот, оптимизатор маршрутов). Очередь FIFO, liveness-пробa не ограничена |
| `ROUTING_MAX_QUEUE` | `100` | Потолок ожидающих в очереди GraphHopper-запросов. Превышение — новый запрос отклоняется `503` (ограниченное ожидание вместо бесконечной очереди) |

Также действуют:
- глобальный лимит тела JSON-запроса **5 MB** (`main.ts`), urlencoded — 1 MB; превышение → `413`;
- DTO-валидация `POST /api/routes` (`CreateRouteFromMapDto`): `pois` ≤ 1000 элементов, `title` ≤ 200 симв., неизвестные поля отклоняются (`forbidNonWhitelisted`);
- DTO-валидация routing-координат: `RouteRequestDto.points` ≤ 100 и `PlanRequestDto.waypoints` ≤ 50 элементов — превышение отклоняется `400` до обращения к GraphHopper.

### Роутинг и данные

| Переменная | По умолчанию | Описание |
|:--|:--|:--|
| `GRAPHHOPPER_URL` | `http://localhost:8981` | URL GraphHopper (дев: docker-compose порт 8981; прод: `http://graphhopper:8989`) |
| `GRAPHHOPPER_PATH_DETAILS` | — (выключено) | Необязательный comma-separated allow-list фактов дороги для маршрутов: `road_class`, `surface`, `road_environment`, `track_type`. Пусто сохраняет быстрый прежний запрос без `details`; неизвестные значения игнорируются и логируются при старте. Факты возвращаются только когда GraphHopper прислал корректные интервалы. |
| `GRAPHHOPPER_LIVE` | — (выключено) | Только для opt-in тестового live-корпуса: установите `1`, чтобы запустить прямые проверки **локального loopback** GraphHopper. В рантайме приложения не читается. |
| `GRAPHHOPPER_LIVE_CORPUS` | Встроенный `live-routing-corpus.pfo.json`, разрешаемый модулем теста относительно своего исходника | Только для тестов: абсолютный путь к заменяющему JSON-корпусу. Обычный локальный корпус покрывает текущий PFO GraphHopper graph и не является ограничением территории продукта. |
| — | — | _POI-датасет не собирается рантаймом: Nearventure импортирует готовый bundle внешнего poi-toolkit через manifest-валидируемый импортёр (прод: одноразовый Compose-сервис `poi-importer`, профиль `import`; локально — `npm run import:poi`, см. [data-refresh.md](./data-refresh.md)). PBF нужен только GraphHopper/Nominatim._ |
| `MEDIA_DIR` | `<cwd>/media/poi` | Каталог загрузок фото POI (прод-волюм `app_media` → `/app/media`) |

### Безопасность удалённых POI-изображений

Публичный `GET /api/pois/:id/media` сохраняет поведение для локальных путей `/media/...`.
Для внешнего `image_url` proxy принимает только HTTPS URL без credentials и IP-literal,
резолвит каждый redirect-hop и отклоняет хосты с loopback, private, link-local или
reserved адресами. Redirect-цепочка ограничена тремя переходами, общий deadline — 10 s,
ответ — 8 MiB и только `image/jpeg`, `image/png`, `image/webp`, `image/gif` или
`image/avif`. Декодирование Sharp ограничено 40 млн пикселей. Ошибки источника дают
для media endpoint обычный `404`, а не `500`; параметры не настраиваются через env.

### Telegram (бот + вебхук + аналитика)

| Переменная | По умолчанию | Описание |
|:--|:--|:--|
| `TELEGRAM_BOT_TOKEN` | — | Токен от [@BotFather](https://t.me/BotFather). Питает бота, вебхук, кнопку Mini App, push аналитики. Пусто = бот выключен; значение никогда не попадает в документацию, логи или Git |
| `TELEGRAM_WEBHOOK_DOMAIN` | — | Домен для вебхука **без схемы** (`nearventure.ru`). Режим вебхука включается, если задан и **не является точным loopback-хостом** (`localhost`, `127.0.0.0/8`, `::1` с портом). Публичный домен, лишь *содержащий* подстроку `localhost` (например `localhost.example.com`), — это вебхук-режим и требует секрет. Иначе — polling (дев) |
| `TELEGRAM_WEBHOOK_SECRET` | — | Случайная строка, защищает `/api/telegram/webhook` от спуфинга. **Обязательна в вебхук-режиме**: без неё эндпоинт отвечает `503` (fail closed), при неверном/отсутствующем заголовке `X-Telegram-Bot-Api-Secret-Token` — `401`. `openssl rand -hex 16` |
| `ADMIN_TELEGRAM_CHAT_ID` | — | Chat id для push аналитики (фидбэк + daily-дайджест). Как получить: напишите боту → `https://api.telegram.org/bot<TOKEN>/getUpdates` → `chat.id`. Пусто = push выключен |
| `PUBLIC_URL` | — | Явный публичный **HTTPS origin** приложения: без credentials, path, query и hash (trailing `/` нормализуется). В production обязателен; без него приложение не стартует. Строит persisted SPA share URLs (`<PUBLIC_URL>/#/route/<id>`) и URL кнопки Mini App (`<PUBLIC_URL>/tg/`); `TELEGRAM_WEBHOOK_DOMAIN` больше не используется как fallback. |

> **Ворота беты:** наличие переменной не доказывает Telegram acceptance. Владелец
> должен предоставить действительный replacement token и проверить бота на целевом
> устройстве; токен нельзя передавать в issue, чат, снимки экрана или Git.

### Внешние ссылки для поддержки (опционально — пусто = скрыть)

| Переменная | По умолчанию | Описание |
|:--|:--|:--|
| `DONATE_BOOSTY_URL` | — | Ссылка на Boosty-страницу проекта. Пример: `https://boosty.to/staniverse` |
| `DONATE_CLOUDTIPS_URL` | — | Ссылка на CloudTips-страницу. Пример: `https://pay.cloudtips.ru/p/5e805926` |

Ссылки задаются через env-переменные, а не захардкожены в коде. Кнопки появляются
в боте только если соответствующая переменная задана. Nearventure не принимает
Telegram Stars, криптовалюту или платежи внутри приложения.

---

## `apps/frontend/.env` — фронтенд (дев)

| Переменная | По умолчанию | Описание |
|:--|:--|:--|
| `VITE_API_BASE_URL` | `/` | Базовый URL API. Дев: `/` (проксируется Vite → `:3000`). Прод: `/` (same-origin, nginx проксирует `/api`) |
| `VITE_MINIAPP_BASE_URL` | `http://localhost:5173` | Базовый URL для ссылок на Mini App (дев) |

> В проде фронтенд собирается в статику и раздаётся бэкендом/nginx — отдельный
> `.env` не нужен, `VITE_API_BASE_URL=/` зашит на этапе сборки образа.

---

## `docker/.env.prod` — продакшен

Читается `docker-compose.prod.yml`. Дублирует часть backend-env (через подстановку
`environment:` в compose) + добавляет домен/TLS.

| Переменная | Описание |
|:--|:--|
| `DOMAIN` | Публичный домен (`nearventure.ru`). nginx получает под него Let's Encrypt; вебхук и Mini App обслуживаются под ним |
| `LETSENCRYPT_EMAIL` | Email для уведомлений Let's Encrypt |
| `DB_*` | Учётка Postgres (см. выше) |
| `JWT_SECRET`, `ADMIN_*` | Секреты приложения (см. выше) |
| `GRAPHHOPPER_PATH_DETAILS` | Необязательный allow-list path-details (см. backend-таблицу); пусто = выключено |
| `TELEGRAM_BOT_TOKEN` | Токен бота |
| `TELEGRAM_WEBHOOK_SECRET` | Секрет вебхука |
| `ADMIN_TELEGRAM_CHAT_ID` | Push аналитики |
| `DONATE_BOOSTY_URL` | Внешняя ссылка Boosty |
| `DONATE_CLOUDTIPS_URL` | Внешняя ссылка CloudTips |
| `GIT_SHA` | Не указывать в `.env.prod`: передать из shell только как non-secret build arg для `$COMPOSE build app` (см. [deployment.md](./deployment.md)); compose сохраняет его в образе как runtime env. |

> compose явно передаёт приложению `PUBLIC_URL=https://$DOMAIN`,
> `TELEGRAM_WEBHOOK_DOMAIN=$DOMAIN`, `CORS_ORIGIN=https://$DOMAIN`,
> `GRAPHHOPPER_URL=http://graphhopper:8989`, `DB_HOST=db` — их в `.env.prod`
> указывать **не нужно**. При запуске production без compose задайте валидный
> `PUBLIC_URL` самостоятельно.

---

## Где что читается

- **Дев:** бэкенд читает `apps/backend/.env` (`dotenv/config` в `main.ts`). Фронтенд —
  `apps/frontend/.env` (через Vite, переменные `VITE_*`).
- **Прод:** переменные приходят из `docker/.env.prod` → подставляются в `environment:`
  сервиса `app` в `docker-compose.prod.yml` → контейнер видит их как обычный env.

Все `process.env.*` в коде бэкенда перечислены в таблицах выше; новых «скрытых»
переменных нет. Карта использует локальную PMTiles-подложку, но не становится
полностью self-hosted: внешние map assets перечислены в
[чек-листе беты](./beta-acceptance-checklist.md). О тестовом корпусе и формате его
fixture см. [routing-live-corpus.md](./routing-live-corpus.md).
