# Storyteller Catalog

Публичная Telegram Mini App для каталога Сорассказчика.

- `src/` — React/Vite-интерфейс для GitHub Pages;
- `public/` — собранный публичный каталог и оптимизированные изображения;
- `api/` — Cloudflare Worker, схема D1 и тесты авторизации;
- `wrangler.jsonc` — D1/R2-конфигурация Worker.

Локальная проверка:

```bash
pnpm install
pnpm test
pnpm build
pnpm dev
```

Полная инструкция по формату историй, деплою API и модерации находится в
`catalog_app/README.md` основного приватного репозитория.
