# Отчёт: 2026-08-06

## Что сделано

### Задача: addCredits игнорирует ошибку RPC — оплата без начисления

---

## Изменения

### 1. `src/lib/credits.ts` — `addCredits()`

**Было:** `Promise<void>`, результат RPC игнорировался.

**Стало:** `Promise<{ ok: boolean; error?: string }>`. При `error`:
- `console.error` с user/op/amount/err
- `sendTelegramAlert` владельцу
- `return { ok: false, error: error.message }`

Добавлен импорт `sendTelegramAlert` из `./telegram`.

### 2. `src/app/api/paddle/webhook/route.ts` — `transaction.completed` / topup

**Было:** `await addCredits(userId, credits, 'topup')` — результат игнорировался.

**Стало:** проверяем `grantResult.ok`. При сбое:
- `addCredits` уже отправил Telegram алерт
- Вставляем строку в `payment_incidents` (`payment_id: null`, `reason: 'activation_failed'`, `raw_payload` содержит `paddle_tx_id`, `userId`, `credits`, `error`)
- Возвращаем 200 — чтобы Paddle не повторял запрос (двойное начисление опаснее тишины)

### 3. `src/app/api/generate/audio/status/route.ts` — возврат кредитов при failed job

**Было:** `await svc.rpc('add_credits', ...)` — результат игнорировался.

**Стало:** `const rpcRes = await svc.rpc(...)`. При `rpcRes.error`:
- `console.error`
- `Sentry.captureException`
- `sendTelegramAlert` владельцу
- аналитика `audio_refunded` НЕ записывается (правильно — кредиты не вернулись)

Добавлен импорт `sendTelegramAlert` из `@/lib/telegram`.

---

## Полный аудит: все места работы с кредитами

| Файл | Строка | Операция | Статус |
|------|--------|----------|--------|
| `src/lib/credits.ts:addCredits()` | 61 | `add_credits` RPC | ✅ **Исправлено** — возвращает `{ok,error?}`, алертит |
| `src/app/api/paddle/webhook/route.ts` | ~110 | `addCredits` topup | ✅ **Исправлено** — проверяет результат, пишет инцидент |
| `src/app/api/generate/audio/status/route.ts` | ~82 | `add_credits` refund RPC | ✅ **Исправлено** — Sentry + Telegram при сбое |
| `src/app/api/generate/video/status/route.ts` | ~142 | `add_credits` refund RPC | ✅ Уже проверялось правильно (Sentry + log) |
| `src/lib/activate-plan.ts` | ~81 | `add_plan_credits` RPC | ⚠️ **Открыто** — при сбое падает на legacy `add_credits`, но если и legacy упадёт, `activatePlan` возвращает `{ok: true}` (ложный успех). Алерта нет. |
| `src/lib/activate-plan.ts` | ~91 | `add_credits` legacy fallback | ⚠️ **Открыто** — `if (legacyErr)` логирует `console.error` но не алертит и не меняет возвращаемое значение (`ok: true`) |
| `src/app/api/paddle/webhook/route.ts` | ~58 | `activatePlan` subscription.activated | ⚠️ **Открыто** — результат не проверяется: plan активирован молча даже при сбое |
| `src/app/api/paddle/webhook/route.ts` | ~123 | `activatePlan` subscription renewal | ⚠️ **Открыто** — то же самое |
| `src/lib/credits.ts:spendCredits()` | ~30 | `deduct_credits` RPC | ✅ Проверяет `error`, возвращает `{ok: false}` |
| Railway `refundAudioJobCredits` / `refundVideoJobCredits` / `refundImageJobCredits` | video-server | `add_credits` RPC | ✅ Исправлено в предыдущей задаче — все возвращают `{ok,amount,error?}`, записывают `payment_incidents` |

---

## Что не сделано (за рамками задачи)

- `src/lib/activate-plan.ts`: при двойном сбое `add_plan_credits` + `add_credits` — функция возвращает `{ok: true}`. Это ложный успех: план активирован в `profiles`, но кредиты не начислены. Нужна отдельная задача.
- Paddle webhook: `activatePlan` при `subscription.activated` и renewal — результат не проверяется.

---

## Коммит

`a0b1115` — запушен в `origin/main`.
