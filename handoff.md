# Отчёт: 2026-08-05

## Что сделано

**Баг: ссылка на пост в теме группы открывала лендинг lefiro.co вместо сообщения.**

Причина: `groupPostLink` строил `t.me/c/{numId}/{threadId}/{msgId}` — формат для приватных групп.
У группы `Lefiro_community` есть публичный username; правильный формат: `t.me/Lefiro_community/3/4`.

**Фикс:**

1. `groupConfig` расширен полем `groupUsername` (читается из `tg_group_username` в `bot_settings`).
2. `channelConfig = { username: null }` — читается из `tg_channel_username` (был хардкод `lefiro_channel`).
3. `groupPostLink`:
   - username есть → `t.me/{username}/{threadId}/{msgId}`
   - только groupId → `t.me/c/{numId}/{threadId}/{msgId}` (приватная группа)
   - ни того ни другого → `null` (ссылка не вставляется, не ведёт на лендинг)
4. `channelPostLink`: убран хардкод, читает `channelConfig.username`; нет username → `null`.
5. Промпт генерации поста: явный запрет `#`, `##`, `---`, списков `- / *`.
   Telegram Markdown v1 рендерит только `*жирный*` и `_курсив_`.

Коммит: `f4b41b9` (main).

**Действие владельца (обязательно для активации фикса):**
Добавить в таблицу `bot_settings` две строки:
- `tg_group_username` = `Lefiro_community`
- `tg_channel_username` = `lefiro_channel`

До этого: `channelPostLink` и `groupPostLink` вернут `null` → ссылки в подтверждениях
просто не будут вставляться (лучше, чем вести на лендинг).

## Что не получилось

—

## Изменения в файлах состояния

TASKS:    закрыта «Ссылка на пост в теме группы» (строка 232 → `- [x]`);
          добавлена в 📌 ЗАКРЫТО запись groupPostLink/channelPostLink [Δ13]
CONTEXT:  без изменений
WORKFLOW: без изменений

## Открытые вопросы владельцу

1. Внести два ключа в `bot_settings`: `tg_group_username = Lefiro_community` и `tg_channel_username = lefiro_channel`.
   После Railway-деплоя ссылки заработают правильно.
