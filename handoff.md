# Отчёт: 2026-08-10 — разведка кеширования промптов Anthropic

## Контекст

Anthropic прислал уведомление о низком cache hit rate. Задача: только разведка (без изменений в коде), 5-точечный анализ.

---

## Что найдено

### 1. Где повторяется одинаковое

| Место | Файл | Строки | Модель | N вызовов за операцию | Инвариантная часть |
|---|---|---|---|---|---|
| Script chunked — system | `script/route.ts` | 297–347, 494–499 | Sonnet/Opus | N секций (8–14 для 18–40 мин) | ≈220–450 tok |
| Script chunked — план в user | тот же | 365–373 | Sonnet/Opus | те же N | ≈500–650 tok (одинаков во всех N) |
| Images Vercel — system | `images/route.ts` | 295, 480 | Haiku 4.5 | ceil(сцен/50) чанков | ≈1 250 tok (photo) / ≈2 450 tok (illustration) |
| Images Railway — system | `video-server/index.js` | 5930, 6069 | Haiku 4.5 | то же | те же |
| Bot consultant — system | `video-server/index.js` | 894–925 | Haiku 4.5 | 1 за сообщение, но одинаков | KB + ~150 слов инструкций |

Всё остальное (`/generate/plan`, `/generate/seo`, `/generate/uniqueize`, аналитика, TTS-нормализация) — единичные вызовы, кеширование бессмысленно.

### 2. Размеры и пороги

| Модель | Минимум |
|---|---|
| Sonnet 4.6 | 1 024 tok |
| Opus 5 | 512 tok |
| **Haiku 4.5 (`claude-haiku-4-5-20251001`)** | **4 096 tok** (не 2048 — это Haiku 3/3.5) |

**Script route (Sonnet/Opus):** system ≈220–450 tok — ниже **обоих** порогов. `cache_control: ephemeral` уже стоит (`script/route.ts:497`), но кеш не создаётся физически.

**Images (Haiku 4.5):** photo ≈1 250 tok, illustration ≈2 450 tok — ниже 4 096 в 1.7–3.3×. Раздувать не рекомендуется. Кеш принципиально недостижим без смены модели.

**Bot consultant (Haiku 4.5):** `cache_control` отсутствует вообще. Выгодно добавить, если KB > 4 096 tok. Размер виден в логах: `[ai-consultant] KB loaded, chars: N`.

### 3. Порядок полей и «что меняется»

Script chunked — порядок **правильный** (system → user). Проблема в другом: инвариантная часть (план всего видео) лежит в **user**-сообщении, а не в system:

```
buildSectionUserMessage():
  'Напиши фрагмент...'      ← уникально
  'Полная структура видео'  ← ОДИНАКОВО во всех N
  sections.map(...)         ← ОДИНАКОВО во всех N  (500–650 tok)
  section.title/description ← уникально
```

Если перенести `sections.map(...)` в `buildSystemPrompt` → system вырастет до ≈720–1 100 tok → 1 024-порог Sonnet пройдён для 6+ секций.

**Параллельность:** `runParallelGuarded` запускает все N секций через `Promise.all` одновременно. Кеш записывается только с первым ответом; остальные N−1 уже в полёте → не читают кеш. Реальная польза: retry-вызовы и повторные прогоны в течение 5 минут.

### 4. Цена вопроса — арифметика (8 секций)

Цены Sonnet 4.6: input $3.00/M, cache write $3.75/M, cache read $0.30/M.

При system = 1 024 tok:

| | Без кеша | С кешем (1 write + 7 reads) |
|---|---|---|
| System-блок, 8 вызовов | 8 × 1 024 × $3.00/M = **$0.0246** | write: $0.0038 + reads: $0.0022 = **$0.0060** |
| Экономия | — | **$0.0186 (76%)** на system-части |

User-часть (~400–600 tok уникальный контент) по-прежнему оплачивается полностью. Итого на прогон: ≈**$0.015–0.020** экономии. При 100 прогонах/мес → ≈$1.50–2.00/мес. Масштабируется с нагрузкой.

### 5. Что не трогать

| Маршрут | Причина |
|---|---|
| `/generate/script` < 18 мин | 1 вызов → нет повтора |
| `/generate/plan` | 1–2 вызова, prompt уникален (topic меняется) |
| `/generate/seo`, `/uniqueize`, `/enhance-script`, `/repack` | 1 вызов |
| `/generate/thumbnail` | 1 вызов |
| Аналитика (`niche`, `channel`, `keywords`, …) | 1 вызов, user-контент уникален |
| `/generate/audio` Haiku-нормализация | 1 вызов |
| `/generate/images` (Haiku 4.5) | Ниже порога 4 096 в 1.7–3.3×, не достичь без раздувания |

---

## Итог

**Приоритет 1 — Script chunked:** перенести `sections.map(...)` из `buildSectionUserMessage` в `buildSystemPrompt`. Фикс в `src/app/api/generate/script/route.ts`, функции `buildSystemPrompt` (строка 298) и `buildSectionUserMessage` (строки 349–393). Чистая архитектурная правка: план — глобальный контекст, ему место в system.

**Приоритет 2 — Bot consultant:** добавить `cache_control: ephemeral` в system-блок вызова (`video-server/index.js:924`), предварительно проверив размер KB в логах Railway (`[ai-consultant] KB loaded, chars: N` — нужно > 16 384 символов).

**Не трогать:** images-маршруты на Haiku 4.5 — порог 4 096 недостижим без смены модели.

---

## Файлы

- `docs/CONTEXT.md` — секция «Prompt caching» дополнена: script-route и bot consultant
- `docs/TASKS.md` — новый пункт «Кеширование сценария» в разделе 🎬 РЕНДЕР И ГЕНЕРАЦИЯ
- `handoff.md` — этот файл

## Что не трогалось

- Ни один файл кода не изменён — чистая разведка
- SV balance monitoring (коммит `55ad650`) остаётся в силе

---

# Отчёт: 2026-08-10 — мониторинг баланса TTS-поставщиков

## Что сделано

### 1. Мониторинг баланса SecretVoicer

Добавлены `fetchSVBalance()` и `checkSVBalance()` в `video-server/index.js` (после `checkApihostBalance`, перед 30-мин кроном).

**Эндпоинт:** `GET https://secret-voicer.ru/api/v1/balance` с `X-API-Key` заголовком.

**Обоснование:** Secret Slider (тот же оператор, тот же анонимный поставщик) имеет подтверждённый `GET /api/v2/balance` → `api_credits`. SV на v1 API — предполагаем аналогичный путь `/api/v1/balance`. Если эндпоинта нет — функция логирует `[sv/balance] API unavailable (endpoint may not exist), skipping` и молчит.

**Паттерн:** зеркало `checkApihostBalance`. Bot_settings ключи: `sv_balance`, `sv_balance_ts`, `sv_balance_alert_state`, `sv_balance_alert_at`, `sv_balance_threshold`.

**Порог:** env `SV_BALANCE_ALERT_THRESHOLD`, дефолт 100 api_credits.

**Cron:** добавлен в 30-мин блок; лог `[cron] balance check: fal / elevenlabs / apihost / secretvoicer`.

### 2. Enriched timeout error message (SV)

Строка `SecretVoicer: timeout after 600s` → `SecretVoicer: timeout after 600s — задача осталась PENDING; возможно, исчерпан баланс`. Помогает при разборе логов напрямую указать на причину инцидента 10.08.

### 3. Воронка Voicer

Документированного balance API у `voicer.mat3u.com` не найдено ни в коде, ни в CONTEXT. Реализация отложена. Рекомендация: уточнить у поставщика через Telegram. Пока — опираться на таймаут-ошибки в логах.

### 4. Кандидат в правила (WORKFLOW.md)

Добавлен кандидат о том, что PENDING-таймаут у TTS — симптом пустого баланса, а не сбоя кода.

## Файлы

- `video-server/index.js` — константа `SV_BALANCE_ALERT_THRESHOLD`, функции `fetchSVBalance` / `checkSVBalance`, обновлённый cron, обогащённое сообщение об ошибке таймаута SV, threshold в startup write
- `docs/WORKFLOW.md` — кандидат в правила
- `docs/CONTEXT.md` — заметки по SV balance endpoint и Voicer
- `docs/TASKS.md` — задача закрыта
- `handoff.md` — этот файл

## Что не трогалось

- SV_CHUNK_TIMEOUT_MS = 600 с
- Voicer retry, concurrency, AbortSignal (из предыдущей задачи)
- Vercel-код

## Открытые вопросы

1. **Проверить в логах Railway**: запускается ли `[sv/balance]` и что отдаёт (success/unavailable). Если `unavailable` — у SV нет balance API, надо придумать иначе.
2. **Voicer balance**: если хочется мониторинга — спросить поддержку Voicer в TG.
3. **SV_BALANCE_ALERT_THRESHOLD**: дефолт 100 api_credits. Если знаете, какой уровень критичен — задать в Railway env.
