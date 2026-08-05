# Отчёт: 2026-08-05

## Что сделано

**Баг: бот засорял супергруппу -1003901518115 сообщением "Используй кнопки внизу или /help".**

Причина: webhook-обработчик не проверял `chat.type`. Когда OWNER_ID писал в группу,
`userId === OWNER_ID` → owner-путь → switch default → `sendTo(chatId, ...)` → chatId = группа.

**Фикс — один guard** после строки извлечения полей (index.js, ~строка 2000):

```js
const chatType    = message.chat?.type
const msgThreadId = message.message_thread_id ?? null

if (chatType === 'group' || chatType === 'supergroup') {
  const isReplyToBot = message.reply_to_message?.from?.is_bot === true
  const isMentionCmd = text.startsWith('/') && text.includes('@')
  if (!isReplyToBot && !isMentionCmd) return
}
```

Дополнительно: в двух fallback-ответах (owner default + public fallback) добавлен
`message_thread_id` — если бот всё же отвечает в группе, ответ идёт в ту же тему.

## Аудит обработчиков, которые могли срабатывать в группе

**Публичный путь (`userId !== OWNER_ID`):**

| Обработчик | Строка | Условие срабатывания | Опасность |
|---|---|---|---|
| Support state | ~2008 | любой текст в состоянии `waiting_description` | средняя |
| Payment proof | ~2058 | media/текст в `awaiting_proof` | средняя |
| `/start` / `/pay` / `/menu` | ~2067 | точный текст команды | низкая |
| `🆘 Поддержка` | ~2144 | точный текст кнопки | низкая |
| KB_QUERIES | ~2162 | точный текст кнопок | низкая |
| **AI consultant** | **~2170** | **любой текст + `lefiroKB`** | **высокая** |
| **Fallback** | **~2177** | **всё остальное** | **высокая** |

**Путь владельца (`userId === OWNER_ID`):**

| Обработчик | Строка | Условие срабатывания | Опасность |
|---|---|---|---|
| Support reply | ~2184 | любой текст в `awaitingSupportReply` | средняя |
| Payment activation | ~2200 | любой текст в `awaitingActivate` | средняя |
| awaitingTopic | ~2285 | любой текст → `generateAndHandle` в группе | высокая |
| **switch default** | **~2404** | **любой неизвестный текст** | **высокая — ВИНОВНИК** |
| switch error catch | ~2407 | ошибка в любом handler | высокая |

**Все закрыты одним guard** на строке ~2000.

## Что не получилось

—

## Изменения в файлах состояния

TASKS:    добавлена ссылка groupPostLink в 🟡, закрыто в 📌 ЗАКРЫТО
CONTEXT:  без изменений
WORKFLOW: без изменений

## Открытые вопросы владельцу

Нет. Guard работает немедленно после Railway-деплоя.
