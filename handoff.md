# Отчёт: 2026-08-05

## Что сделано

**Фича: привязка Telegram через deep link.** Коммит `9460822`.

### 1. Миграция — `supabase/migrations/013_tg_link_tokens.sql`

```sql
tg_link_tokens (token text pk, user_id uuid → profiles, created_at, expires_at, used_at)
```

Индекс по `user_id`. `REVOKE` anon/authenticated, `GRANT service_role`. Нужно запустить вручную в Supabase SQL Editor.

### 2. API — `src/app/api/telegram/link/route.ts`

- `GET` → `{ ok, linked }` — проверить статус привязки (для баннеров в студии)
- `POST` → создаёт `randomBytes(16)` токен, TTL 60 мин, инвалидирует предыдущие unused токены этого пользователя, возвращает `{ ok, link: 'https://t.me/<bot>?start=link_<token>' }`. Имя бота из `TELEGRAM_BOT_USERNAME` env.
- `DELETE` → обнуляет `profiles.telegram_chat_id`

### 3. Бот — `video-server/index.js` (~строка 2107)

Новая ветка `startArg.startsWith('link_')` перед `support`:

| Ситуация | Ответ |
|---|---|
| Токен не найден | «Ссылка недействительна. Получите новую в настройках…» |
| `used_at` уже заполнен | «Ссылка уже была использована. Получите новую…» |
| `expires_at` в прошлом | «Ссылка устарела — она действует 60 минут. Получите новую…» |
| Успех | Запись `chat_id` → `profiles`, гашение `used_at`, сообщение «Telegram подключён» со списком уведомлений |

### 4. Настройки — `src/components/settings/SettingsClient.tsx`

Секция «Telegram-уведомления» между YouTube API и Appearance:
- `telegram_chat_id` пуст → кнопка «Подключить Telegram» (POST → window.open)
- Заполнен → «✓ Подключено» + кнопка «Отвязать» (DELETE)

### 5. Студия — `Step5Images.tsx` и `Step6Video.tsx`

`TelegramBanner` компонент добавлен в оба файла. Показывается только если `tgLinked === false` (не null, т.е. проверка завершена) во время генерации. Статус запрашивается `GET /api/telegram/link` один раз при монтировании. Уже подключённым не показывается.

## Что не получилось

—

## Изменения в файлах состояния

TASKS:   задача «Привязка Telegram» закрыта `[x]`; добавлена в 📌 ЗАКРЫТО
CONTEXT: без изменений
WORKFLOW: без изменений

## Открытые вопросы владельцу

1. **Запустить миграцию 013** в Supabase SQL Editor (`supabase/migrations/013_tg_link_tokens.sql`).
2. **Добавить `TELEGRAM_BOT_USERNAME`** в env Vercel + Railway (значение без `@`, например `lefiro_bot`).
   Без этой переменной `POST /api/telegram/link` вернёт 503.
3. После деплоя Railway — ветка `link_` в боте активируется.
   Протестировать: открыть `/settings`, нажать «Подключить Telegram», пройти по ссылке, проверить ответ бота.
