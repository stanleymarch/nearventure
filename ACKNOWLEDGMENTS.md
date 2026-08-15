# Благодарности

Nearventure стоит на плечах огромного объёма открытой работы — кода, данных и
карт. Этот файл благодарит проекты, материалы и дизайн которых включены в проект
или на которые он опирается, с указанием их лицензий.

Если вы считаете, что что-то здесь атрибутировано неточно или пропущено —
откройте issue, и мы это поправим.

---

## Источники данных POI

Датасет точек интереса (POI) собирается внешним пайплайном
[poi-toolkit](https://github.com/stanleymarch/poi-toolkit) из открытых
источников и импортируется в Nearventure через manifest-валидируемый импортёр
(`apps/backend/src/importer/`). Лицензия итогового датасета определяется
лицензиями исходных данных (см. [LICENSE](LICENSE)).

| Источник | Что даёт | Лицензия |
|:--|:--|:--|
| **[OpenStreetMap](https://www.openstreetmap.org)** | Именованные объекты карты, геометрия, теги (природа, наследие, религия) | **ODbL** (Open Database License). © участники OSM |
| **[Wikidata](https://www.wikidata.org)** | Структурированные данные, координаты, описания, категории, связи | **CC0** (общественное достояние). © Wikimedia Foundation |
| **[Wikivoyage](https://wikivoyage.org)** | Кураторские описания достопримечательностей (See/Do) | **CC BY-SA 4.0**. © авторы Wikivoyage |
| **[ЕГРКН](https://opendata.mkrf.ru)** (Министерство культуры РФ) | Официальный реестр объектов культурного наследия (ОКН) | Открытые данные государства (правовая охрана ОКН учитывается) |

> **ODbL-производная работа.** Поскольку датасет содержит данные OpenStreetMap,
> итоговый bundle внешнего poi-toolkit распространяется на условиях **ODbL**.
> Это значит: можно свободно использовать и адаптировать, но производные базы
> данных тоже должны открываться под ODbL, с указанием авторства OSM. Компоненты
> из Wikivoyage несут CC BY-SA 4.0 (share-alike), из Wikidata — CC0.

## Картографические assets

Базовая подложка ПФО — локальный файл **PMTiles** `pfo.pmtiles`, который nginx
отдаёт приложению. Однако бета не является полностью self-hosted map stack:
часть assets и оверлеев запрашивается у внешних провайдеров.

| Asset / слой | Назначение | Условия использования |
|:--|:--|:--|
| **[Protomaps](https://protomaps.com)** Planet → локальный PMTiles | Векторная базовая подложка ПФО | Производный локальный artifact; данные OpenStreetMap (ODbL) и условия источника Planet |
| **[Protomaps basemaps assets](https://github.com/protomaps/basemaps)** | Внешние glyph/sprite для стиля карты | Условия и лицензии проекта Protomaps |
| **[CyclOSM](https://www.cyclosm.org)** | Велосипедный raster-оверлей; также проксируется Mini App | © CyclOSM/OSM France; данные © OSM (ODbL); условия провайдера |
| **[Waymarked Trails](https://waymarkedtrails.org)** | Пеший raster-оверлей | Данные © участники OSM; условия провайдера |
| **[ArcGIS World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)** | Спутниковый raster-слой | Условия Esri/ArcGIS |
| **[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)** | Terrain/elevation tiles для рельефа | Условия AWS Open Data и источника данных |

> Доступность и условия внешних providers — ограничение беты. Перечень
> проверок и owner gates — в [docs/beta-acceptance-checklist.md](docs/beta-acceptance-checklist.md).

## Сервисы Docker Compose

Запускаются как контейнеры рядом с приложением (`docker/docker-compose.yml` /
`docker-compose.prod.yml`), не модифицируются — только композятся:

| Сервис | Образ | Назначение | Лицензия |
|:--|:--|:--|:--|
| **[PostgreSQL](https://www.postgresql.org)** + **[PostGIS](https://postgis.net)** + **[pgvector](https://github.com/pgvector/pgvector)** | `postgis/postgis` | Пространственные запросы + семантический поиск (векторы) в одной БД | PostgreSQL License (BSD-like) / GPLv2 |
| **[GraphHopper](https://github.com/graphhopper/graphhopper)** | `israelhikingmap/graphhopper:11.0` (community build == upstream 11.0) | Роутинг (велосипед/пешком/авто) с высотами, round-trip, optimize/TSP | Apache-2.0 |
| **[nginx](https://nginx.org)** | `nginx:1.27-alpine` | Reverse proxy, TLS, статика | BSD-2-Clause |
| **[Certbot](https://certbot.eff.org)** | `certbot/certbot` | Сертификаты Let's Encrypt и их продление | Apache-2.0 |

## Бэкенд-зависимости (NestJS / Node)

Ключевые из `apps/backend/package.json`:

| Пакет | Назначение | Лицензия |
|:--|:--|:--|
| **[NestJS](https://nestjs.com)** | Бэкенд-фреймворк (DI, модули, cron) | MIT |
| **[TypeORM](https://typeorm.io)** | ORM поверх PostgreSQL/PostGIS | MIT |
| **[grammY](https://grammy.dev)** | Telegram-бот в том же процессе | MIT |
| **[pg](https://github.com/brianc/node-postgres) + [pgvector](https://github.com/pgvector/pgvector-node)** | Драйвер БД + типы векторов | MIT |
| **[Passport](https://passportjs.org) + [@nestjs/jwt](https://docs.nestjs.com/security/authentication)** | JWT-аутентификация (админ/куратор) | MIT |
| **[bcrypt](https://github.com/kelektiv/node.bcrypt.js)** | Хэширование паролей | MIT |
| **[class-validator](https://github.com/typestack/class-validator)** / **class-transformer** | Валидация и преобразование DTO | MIT |

## Фронтенд- и мини-апп-зависимости

| Пакет | Назначение | Лицензия |
|:--|:--|:--|
| **[Vue 3](https://vuejs.org)** | UI-фреймворк (SPA-карта + мини-апп) | MIT |
| **[Vite](https://vitejs.dev)** | Сборщик/дев-сервер | MIT |
| **[Leaflet](https://leafletjs.com)** | Интерактивная карта | BSD-2-Clause |
| **[Tailwind CSS](https://tailwindcss.com)** | Утилитарный CSS | MIT |
| **[vue-router](https://router.vuejs.org)** | Хэш-роутинг SPA | MIT |
| **[Axios](https://axios-http.com)** | HTTP-клиент для REST API | MIT |
| **[Telegram WebApp SDK](https://core.telegram.org/bots/webapps)** | Бридж между мини-аппом и клиентом Telegram | Соблюдается [Telegram API ToS](https://core.telegram.org/api/terms) |

## Шрифты

Подключаются с Google Fonts (CDN), не вендорятся в репозитории:

| Шрифт | Назначение | Лицензия | Автор |
|:--|:--|:--|:--|
| **[Geologica](https://fonts.google.com/specimen/Geologica)** | Заголовки и текст (основной шрифт проекта) | **SIL Open Font License 1.1** | [Undercase Type](https://undercase.xyz) |
| **[Material Symbols](https://fonts.google.com/icons)** (Outlined) | Иконки интерфейса | **Apache-2.0** | Google |

## Технологические решения (на чём стоит дизайн-система)

- **[Material 3](https://m3.material.io)** (Material Design 3) — палитра/токены тёплой цветовой схемы (light + dark) реализованы как CSS-переменные. Соблюдается [Creative Commons Attribution 4.0](https://m3.material.io/brand-guidelines) дизайн-гайдов.
- **[shadcn-vue](https://www.shadcn-vue.com)** — паттерны компонентов поверх [reka-ui](https://reka-ui.com): примитивы копируются в репозиторий и владеются проектом, а не тянутся тяжёлой UI-зависимостью. MIT.
- Дизайн лендинга и карты прототипировался в **[Google Stitch](https://stitch.withgoogle.com)** на ранних этапах и затем сделан «настоящим» и привязан к живым API.

## AI-ассистенты

Значительная часть Nearventure написана **с помощью** языковых моделей, а не
только человеком. Проект не существовал бы без них — благодарность:

- **GLM-5.2** (Zhipu AI) — планирование архитектуры и роадмапа
- **GLM-4.7** (Zhipu AI) — реализация
- **DeepSeek 4 Flash** (DeepSeek) — реализация
- **GPT-5.6** (OpenAI) — реализация, безопасность и релизная подготовка

## Спасибо

Автор проекта — **[@staniverse](https://t.me/staniverse)** (Telegram: вопросы,
идеи, фидбек).

Друзьям и тестировщикам, которые помогали отлаживать маршруты и карты; и
сообществу OpenStreetMap Кировской области, чьи данные делают проект возможным.

---

### Примечание о совместимости лицензий

Выбор **AGPL-3.0** для кода совместим со всем стеком: ни одна ключевая
зависимость не является копилефтной (NestJS / Vue / grammY / GraphHopper / Postgres
— всё MIT или Apache-2.0 / BSD). Сетевая клаузула AGPL (раздел 13) обеспечивает
главное требование проекта: тот, кто запускает модифицированный Nearventure как
сервис, обязан открыть исходники изменений. Подробности — в [LICENSE](LICENSE).
