# Релизы и воспроизводимость

Этот документ описывает минимальную публичную базу Nearventure. Он не объявляет
текущий рабочий код production-релизом и не заменяет операционные проверки из
[beta-acceptance-checklist.md](beta-acceptance-checklist.md).

## Воспроизводимая проверка исходного кода

Для каждого тега или commit SHA зафиксируйте точную ревизию и выполните на чистой
checkout с Node.js 22:

```bash
npm ci
npm run build
npm run typecheck --workspace=apps/frontend
npm test --workspace=apps/backend
npm test --workspace=apps/frontend
npm test --workspace=apps/miniapp
```

`npm ci` устанавливает ровно граф зависимостей из отслеживаемого
[`package-lock.json`](../package-lock.json) и завершится ошибкой, если lockfile
не соответствует `package.json`. Не заменяйте его в release-проверке на
`npm install`: последний может обновить lockfile или выбрать новые допустимые
версии зависимостей.

Workflow [CI](../.github/workflows/ci.yml) выполняет эти же build, typecheck и
unit-test команды для push в `main` и pull request. Он намеренно не запускает
Playwright E2E, production/deploy-команды, импорт POI или `db:reset`: им нужны
внешние сервисы, данные или явное destructive opt-in.

## Evidence для релиза

Перед публикацией release maintainer должен сохранить или сослаться на:

1. tag и полный Git commit SHA;
2. Node.js и npm версии, а также неизменённый `package-lock.json` этой ревизии;
3. результаты команд выше (ссылка на успешный CI run либо локальные логи);
4. результаты обязательного независимого review и применимые production evidence.

Для production-образа также передавайте полный SHA как не-секретный `GIT_SHA`
согласно [deployment.md](deployment.md). `GET /api/build` показывает только
проверенный по формату runtime label из этой переменной; он не связывает SHA с
образом или исходным кодом и не заменяет release evidence.

## Текущие ограничения

- CI не публикует release artifacts, их checksums или архив build logs.
- Проект пока не генерирует и не публикует SBOM (CycloneDX/SPDX).
- Проект пока не создаёт SLSA/in-toto provenance, signed attestations или signed
  tags/release assets.
- `package-lock.json` закрепляет npm dependency graph и integrity hashes, но не
  гарантирует побитово идентичные результаты: на output могут влиять Node.js,
  npm, ОС, нативные зависимости (например `sharp`/`sqlite3`) и инструменты
  сборки.
- Успешный CI подтверждает только перечисленные команды. Он не является
  доказательством production deploy, доступности GraphHopper/внешних картографических
  сервисов, device acceptance Telegram или отсутствия секретов в исторических
  коммитах.

До появления SBOM/provenance не заявляйте, что release имеет криптографически
проверяемое происхождение или полную supply-chain attestation. Публичная
публикация остаётся заблокированной owner gate по ротации секретов и clean
GitHub baseline, указанному в [чек-листе беты](beta-acceptance-checklist.md).
