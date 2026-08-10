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
