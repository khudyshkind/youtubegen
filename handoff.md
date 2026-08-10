# Отчёт: 2026-08-10 — разведка Vercel Fluid Active CPU

## Что найдено

### 🚨 КРИТИЧНО: Vercel деплои сломаны с 02:29 МСК

Файл: `src/app/api/generate/audio/route.ts:902`

```typescript
// БЫЛО (ломает сборку):
await supabase
    .from('projects')
    .update({ media_expires_at: newExpiry })
    .eq('id', audioPid)
    .eq('user_id', user.id)
    .or(`media_expires_at.is.null,media_expires_at.lt.${newExpiry}`)
    .catch(() => {})  // ← TS Error: Property 'catch' does not exist on PostgrestFilterBuilder

// КАК ЧИНИТЬ:
try {
  await supabase
    .from('projects')
    .update({ media_expires_at: newExpiry })
    .eq('id', audioPid)
    .eq('user_id', user.id)
    .or(`media_expires_at.is.null,media_expires_at.lt.${newExpiry}`)
} catch { /* best-effort */ }
```

Введено в коммите `8ce60f4` (02:29 МСК Aug 10). Все 6+ последующих деплоев — `● Error`.
Продакшен застрял на версии до `8ce60f4`. **В проде отсутствует:**
- `media_expires_at` фикс (`8ce60f4`)
- TTS надёжность — SV concurrency 1, Voicer retry (`8f85daf`)
- SV balance monitoring (`55ad650`)
- cache_control AI-консультанта (`ded8c7d`)

---

### 1. Что жжёт Fluid Active CPU

Единственный **Fluid (SSE)** маршрут — `generate/images/route.ts:957` (ReadableStream + `text/event-stream`). Fluid billing считает активное CPU-время пока соединение открыто.

| Маршрут | maxDuration | Billing mode | CPU на прогон | Частота |
|---|---|---|---|---|
| `generate/images` | 300 с | **Fluid (SSE)** | ~2–3 мин (open connection) | пользователи |
| `generate/script` | 300 с | Lambda | ~0.5–2 мин (I/O wait) | пользователи |
| `generate/audio` (sync: EL/Google/apihost) | 300 с | Lambda | ~0.5–2 мин | пользователи |
| `generate/subtitles` | 300 с | Lambda | ~1–4 мин | пользователи |
| `analytics/sub-niche-finder` | 300 с | Lambda | ~1–3 мин | пользователи |
| Аналитика × 9 (niche, channel, …) | 120 с | Lambda | ~0.5–1.5 мин | пользователи |
| `generate/images-async` | **30 с** | Lambda | <5 с (dispatch only) | пользователи |

Fluid Active CPU лимит Hobby = 4 ч. При ~2.5 мин/прогон картинок → **96 прогонов = 100% лимита**.

Фоновых задач на Vercel нет: `vercel.json` отсутствует, `next.config.ts` не определяет cron-routes, grep по всем API-маршрутам: 0 `export.*schedule`.

### 2. Можно ли разгрузить

**Главный Fluid-потребитель — `generate/images` (SSE):**
- Перенести на Railway: возможно, но потребует рефакторинга SSE → polling
- Проще: перевести на `generate/images-async` паттерн для FAL-движков

**`generate/script` → Railway (приоритет 1):**
- Паттерн готов: `POST → job_id → polling` (зеркало audio async)
- Убирает 300-с Lambda вызовы с Vercel, переводит на Railway $5/мес
- Нет архитектурного блокера; было построено как Next.js route исторически

**`generate/audio` sync-пути** (EL/Google/apihost/openai → ещё на Vercel):
- SV/Voicer уже на Railway async
- Остальные движки нишевые, менее приоритетны

### 3. Фоновые задачи

`vercel.json` **отсутствует**. Нет Vercel Cron Jobs. `automaticVercelMonitors: true` в `next.config.ts` — это Sentry Cron Monitors (мониторинг Railway-кронов), не Vercel Crons.

### 4. Упавший деплой 10.08 02:33

Коммит `8ce60f4` запущен в 02:29 МСК, Vercel-деплой начался ~02:30-02:33. Ошибка:
```
Type error: Property 'catch' does not exist on type 'PostgrestFilterBuilder'. Did you mean 'match'?
at src/app/api/generate/audio/route.ts:902
```
Все последующие деплои (`c50284a`, `8f85daf`, `55ad650`, `9359fce`, `ded8c7d`) также падают с той же ошибкой на той же строке. Продакшен живой (на pre-`8ce60f4` деплое), но не получил ни одного из 5 последних коммитов.

---

## Файлы

- `docs/TASKS.md` — два новых КРИТИЧНЫХ пункта (TS ошибка + Fluid CPU); пункт переноса script на Railway
- `docs/CONTEXT.md` — стек: добавлены ⚠️ про Fluid CPU лимит и сломанные деплои
- `handoff.md` — этот файл

## Что не трогалось

Код не изменён — чистая разведка.

## Что делать немедленно

1. **Починить `audio/route.ts:902`**: заменить `.catch(() => {})` на `try/catch` — это разблокирует все деплои и выкатит все накопленные правки
2. **Vercel Fluid CPU**: следить в Vercel Dashboard → Usage → Fluid Active CPU; при приближении к лимиту — обновить план или уменьшить нагрузку на `generate/images`
