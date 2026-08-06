# Отчёт: 2026-08-06

## Задача: добавить логирование в notifyUserTelegram

**Коммит:** `7ae834b` — *Add logging to notifyUserTelegram silent failure points*

---

## Что сделано

**Файл:** `src/lib/telegram.ts` — функция `notifyUserTelegram`

| Точка | Было | Стало |
|-------|------|-------|
| `!botToken` | молчит, `return` | `console.error('[telegram] notifyUserTelegram: TELEGRAM_BOT_TOKEN not set')` |
| `!chatId` | молчит, `return` | `console.log('[telegram] skip: no chat_id user=<id>')` |
| успешная отправка | нет лога | `console.log('[telegram] sent user=<id>')` |
| лишний лог | `console.log([telegram] notifyUser user=... chat_id=...)` | удалён |

Уровни выбраны по смыслу: отсутствие токена — поломка конфигурации (`error`); отсутствие chat_id — норма, пользователь не привязал Telegram (`log`).

---

## Контекст

Задача выросла из диагностики: уведомление не пришло по синхронному пути генерации картинок.
Диагноз был двойной:

1. **Порог 90 с** (`images/route.ts:1208`) никогда не достигается для flux_schnell при CONCURRENCY=40 — генерация занимает ~15–30 с. Порог не трогали.
2. **Тихие return** в `notifyUserTelegram` не давали понять, дошла ли функция до отправки. Теперь в Vercel Function Logs видно, на каком шаге она остановилась.

---

## Что проверить в Vercel Logs

После следующего запуска генерации с подключённым Telegram:
- `[telegram] skip: no chat_id user=...` — токен есть, но пользователь не привязал бот
- `[telegram] sent user=...` — уведомление отправлено
- `[telegram] notifyUserTelegram: TELEGRAM_BOT_TOKEN not set` — токен не задан в Vercel env
