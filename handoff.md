# Отчёт: 2026-08-11

## Что сделано

**Задача: разведка источника Fluid Active CPU и 503K Function Invocations** — без изменений кода.

Выводы:

1. **503 986 Function Invocations** — Navbar polling. `Navbar.tsx:119`: `setInterval(fetchCredits, 10_000)` — `/api/profile` вызывается каждые 10 с для любого залогиненного пользователя с любой открытой вкладкой (dashboard, studio, billing, settings и т.д.). ~3.9 постоянных вкладок разработчика за 30 дней = 503K вызовов. Это Lambda, не Fluid CPU.

2. **4 ч 32 мин Fluid Active CPU** — единственный SSE-маршрут `generate/images/route.ts` (ReadableStream, maxDuration=300). Для 272 мин достаточно 20–40 прогонов при тестировании фичи + обрывы (stream держится до abort-таймаута 270 с). Изображений не нужно было много — достаточно регулярного тестирования в начале периода.

3. **Build failures ≠ Fluid CPU.** Vercel считает их отдельно: Build CPU Minutes, не Fluid. 7 упавших сборок по ~1 мин = ~7 Build CPU Minutes.

4. **Полная таблица polling-интервалов:**

| Маршрут | Интервал | Условие старта |
|---|---|---|
| `/api/profile` (Navbar) | **10 с, всегда** | любая залогиненная вкладка |
| `/api/generate/audio/status` | 3 с | только во время аудиогенерации |
| `/api/generate/video/status` | 3 с | только во время рендера |
| `/api/generate/images-async/status` | 5 с | только во время Railway image job |
| `/api/telegram/link` (GET) | 1 раз на маунт | переход на Step5 или Step6 |

5. **Где смотреть в Observability:** Vercel → Project → Observability → Functions, сортировать по Invocations descending. `/api/profile` должен быть первым с отрывом. Для Fluid CPU — найти строку `generate/images` и посмотреть суммарный Duration.

## Что не получилось

—

## Изменения в файлах состояния

TASKS: ✅ закрыто «TS-ошибка audio/route.ts:902» (коммит `29db530`, 2026-08-10); обновлено «Vercel Fluid Active CPU» — добавлены результаты разведки
CONTEXT: в разделе «Стек и инфраструктура» добавлены: результаты разведки Fluid CPU vs Function Invocations, уточнение про Build Minutes, таблица polling-интервалов, пометка что TS-ошибка закрыта
WORKFLOW: без изменений

## Открытые вопросы владельцу

Проверить в Vercel Observability → Functions: сколько вызовов у `/api/profile` за период? Если ~500K — диагноз подтверждён. Если нет — нужно смотреть другие маршруты.

Если `/api/profile` подтверждён — обсудить снижение частоты Navbar polling (10 с → 30 с или 60 с) для сокращения Function Invocations. Текущая частота архитектурно избыточна: баланс обновляется через `refreshCredits()` сразу после каждой операции, так что 10-секундный интервал страхует только экстренные случаи.
