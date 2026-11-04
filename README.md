# QuickStride CRM — Next.js-версія (блок 0 поетапного плану)

Telegram Mini App CRM для українських фрилансерів. Це перенесення наявного
Vite-прототипу на Next.js (App Router); база даних не підключена, дані —
демонстраційні, у localStorage браузера (`quickstride.crm.v1`).

## Запуск

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build && pnpm start   # продакшн-білд
pnpm check      # строгий typecheck
pnpm test       # vitest: гроші та фінансові селектори
```

## Структура

- `app/` — маршрути: `/` (головна), `/projects`, `/finance`, `/clients`, `/reminders`
- `components/` — AppShell (навігація), форми, шітки, тема
- `lib/` — типи, робота з грошима (копійки), демодані, store (localStorage), Telegram WebApp

## Що знати

- Суми зберігаються в найменших одиницях валюти; отримано/залишок завжди
  обчислюються з операцій.
- Валюти (UAH/EUR/USD) ніколи не об'єднуються без конвертації.
- Перенесення не завершує міграцію «назавжди»: Telegram initData не
  перевіряється на сервері, записів у БД немає — це наступні блоки плану.
