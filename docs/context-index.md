# Индекс документации

Канонические документы Nearventure. Если что-то расходится с кодом — правим код
или док (код обычно правим).

## Главное

| Документ | О чём |
|:--|:--|
| [README.md](../README.md) | Главная: идея, стек, быстрый старт, дорожная карта |
| [product-vision.md](./product-vision.md) | Видение продукта, ключевые сценарии, не-цели и ADRs |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Каноническая архитектура: продукт, слои, данные, роутинг и импорт POI |
| [architecture-future-and-adr.md](./architecture-future-and-adr.md) | Продолжение архитектуры: будущие возможности, ADR и открытые вопросы |
| [ROADMAP.md](./ROADMAP.md) | Поэтапный план со статусом и критериями приёмки |
| [miniapp-roadmap.md](./miniapp-roadmap.md) | Детальная дорожная карта Mini App и Telegram-поверхностей |
| [deployment.md](./deployment.md) | Деплой на VPS: Docker, домен, TLS, вебхук, Mini App |
| [environment.md](./environment.md) | Все переменные окружения — где, что и зачем |
| [beta-acceptance-checklist.md](./beta-acceptance-checklist.md) | Приёмка беты по проверяемым доказательствам и внешние owner gates |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Как контрибьютить |
| [ACKNOWLEDGMENTS.md](../ACKNOWLEDGMENTS.md) | Источники данных, библиотеки, шрифты, лицензии |
| [LICENSE](../LICENSE) | AGPL-3.0 (код) + ODbL (данные) |

## POI-пайплайн

| Документ | О чём |
|:--|:--|
| [data-refresh.md](./data-refresh.md) | Обновление геоданных и импорт POI (manifest-импортёр, trusted root) |
| [poi-toolkit](https://github.com/stanleymarch/poi-toolkit) | Канонический пайплайн сбора/дедупликации/экспорта POI (внешний репозиторий) |
| [apps/backend/src/importer/](../apps/backend/src/importer/) | Manifest-валидируемый импортёр Nearventure (C6, atomic staging swap) |

## Инфраструктура

| Файл | О чём |
|:--|:--|
| [../docker/](../docker/) | Docker Compose (dev + prod), Dockerfile-ы, конфиги nginx/GraphHopper/Postgres |
| [../scripts/](../scripts/) | `download-osm.sh`, `log-runner.mjs`, `kill-service.mjs`, deploy-скрипты |
| [../e2e/](../e2e/) | E2E-тесты Playwright (через Chrome CDP) |
| [AGENTS.md](../AGENTS.md) | Гайд для AI-агентов, работающих с репозиторием |
