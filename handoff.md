# Отчёт: 2026-08-05

## Что сделано

**Разведка: привязка Telegram через deep link.** Кода не менялось.

### Пункт 1 — /start в боте

`index.js:2094` — условие `text === '/start' || text.startsWith('/start ')`.
`index.js:2103` — payload уже извлекается: `startArg = text.slice(7).trim()`.
Два существующих ветки: `support` (2108) и `pay_<plan>` (2122).
При `/start abc123` — `startArg = 'abc123'` не матчится ни с чем → default: приветствие. Токен молча игнорируется. Добавлять новую ветку достаточно.

### Пункт 2 — Генерация и хранение токенов

Механизма одноразовых токенов нет: в `supabase/schema.sql` только `plan_expires_at` (строка 52) и `telegram_chat_id` (строка 53). Таблицы `link_tokens`, `verification_tokens` не существует.

Есть в криптографии: AES-256-GCM (`src/lib/crypto.ts`), HMAC-SHA256 (`sentry/route.ts:11`), AWS S4 sigv4 (`index.js:147`), `randomUUID()` в двух API-роутах.

Рекомендация: stateful-токен — `crypto.randomBytes(16).toString('hex')` → новая таблица `tg_link_tokens(token pk, user_id, expires_at, used_at)`. Stateless HMAC(user_id+expires, BOT_TOKEN) возможен, но нельзя отозвать раньше TTL.

### Пункт 3 — Где показывать кнопку

Страница настроек: `/settings` → `src/components/settings/SettingsClient.tsx`. Пять секций, Telegram отсутствует — место для новой секции.

Момент долгой генерации (рекомендованное место):
- Картинки: `Step5Images.tsx:847` — блок `phase === 'generating'` (ждать 5+ мин)
- Видео: `Step6Video.tsx:802` — `renderState === 'queued'|'processing'` (до 15 мин)

### Пункт 4 — Текущее состояние привязки

Поле `profiles.telegram_chat_id text` добавлено через `schema.sql:53`.
Запрос состояния:
```sql
SELECT COUNT(*) FILTER (WHERE telegram_chat_id IS NOT NULL) AS bound, COUNT(*) AS total FROM profiles;
```
В интерфейсе статус не отображается (`SettingsClient.tsx` не использует `telegram_chat_id`, хотя тип `Profile` включает его на строке 217 `src/lib/types.ts`). Механизма отвязки нет.

### Пункт 5 — Безопасность

Владелец: `OWNER_ID = env('TELEGRAM_OWNER_ID')` (`index.js:97`), проверка `userId !== OWNER_ID` (`index.js:1728, 2029`). `userId` = `message.from.id` из Telegram.

Подписанные токены: не используются для сессионных данных. YouTube API-ключ зашифрован AES-256-GCM, Sentry-вебхук верифицируется HMAC — но это входящая верификация, не выдача токенов.

Для нового deep-link токена модуль `crypto` уже подключён с обеих сторон. Хватает `randomBytes(16)`.

## Что не получилось

—

## Изменения в файлах состояния

TASKS:   задача «Привязка Telegram через deep link» дополнена результатами разведки
CONTEXT: без изменений
WORKFLOW: без изменений

## Открытые вопросы владельцу

1. **Подход к хранению токена:** новая таблица `tg_link_tokens` (чисто, отзываемо) или два поля в `profiles` (`tg_link_token + tg_link_token_expires_at`, без отзыва по требованию)? Рекомендую таблицу.
2. **TTL токена:** 15 минут достаточно? Пользователь должен успеть нажать кнопку, пока ждёт генерацию.
3. **Механизм отвязки:** показывать кнопку «Отвязать» в настройках или оставить только привязку?
