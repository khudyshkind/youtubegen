# Отчёт: 2026-08-06

## Что сделано

### Задача: activatePlan возвращает ложный успех при несостоявшемся начислении

---

## Изменения

### 1. `src/lib/activate-plan.ts`

**Было:** при двойном сбое `add_plan_credits` + `add_credits` — `console.error` есть,
но функция возвращает `{ ok: true, plan_credits: N }`. Вызывающий код обманут.

**Стало:** возвращает `{ ok: boolean; creditsGranted: boolean; error?; plan_credits?; expires_at? }`.

Три честных исхода:
| ok | creditsGranted | Смысл |
|----|---------------|-------|
| `true` | `true` | Полный успех: план + кредиты |
| `true` | `false` | Даунгрейд на free, кредиты не нужны |
| `false` | `false` | Сбой (план или кредиты) |

При двойном сбое RPC (оба `add_plan_credits` и `add_credits` упали) **до** возврата:
- `console.error` с деталями обеих ошибок
- `sendTelegramAlert` с пометкой "требуется ручное вмешательство"
- `insert` в `payment_incidents` (`payment_id: null, reason: 'activation_failed'`, обе ошибки в `raw_payload`)
- возвращает `{ ok: false, creditsGranted: false, plan_credits: N, expires_at }` — план в profiles активен, но кредитов нет

Все ранние `return { ok: false }` дополнены `creditsGranted: false`.

### 2. `src/app/api/paddle/webhook/route.ts`

**Было:** `await activatePlan(...)` — результат не проверялся в двух местах.

**Стало:**

`subscription.activated`:
- Проверяет `!activateResult.ok`
- Вставляет `payment_incidents` с `paddle_sub_id` в `raw_payload`
- Алертит только при сбое на уровне плана (`!plan_credits`) — при сбое кредитов `activatePlan` уже алертил
- Возвращает 200 (не ретрай Paddle — двойная активация опаснее)

`transaction.completed` (renewal):
- Аналогично, с `paddle_tx_id` в `raw_payload`

### 3. YooKassa webhook — без изменений

Существующий `if (!result.ok)` корректен. После исправления `activatePlan` он
теперь автоматически отловит и сбой кредитов — раньше он был недостижим из-за
ложного `ok: true`. Поведение: запись инцидента + алерт + ответ 500 (ретрай ЮKassa).

---

## Полный аудит мест работы с кредитами (актуальный)

| Файл | Операция | Статус |
|------|----------|--------|
| `src/lib/credits.ts:addCredits()` | `add_credits` RPC | ✅ Исправлено (пред. задача) |
| `src/lib/activate-plan.ts` | `add_plan_credits` + `add_credits` fallback | ✅ **Исправлено** |
| `src/app/api/paddle/webhook/route.ts:activatePlan` (×2) | plan activation | ✅ **Исправлено** |
| `src/app/api/paddle/webhook/route.ts:addCredits` | topup | ✅ Исправлено (пред. задача) |
| `src/app/api/webhooks/yookassa/route.ts:activatePlan` | plan activation | ✅ Работало, теперь ловит и кредиты |
| `src/app/api/generate/audio/status/route.ts` | refund `add_credits` | ✅ Исправлено (пред. задача) |
| `src/app/api/generate/video/status/route.ts` | refund `add_credits` | ✅ Было правильно |
| `src/lib/credits.ts:spendCredits()` | `deduct_credits` | ✅ Было правильно |
| Railway refund functions (×3) | `add_credits` | ✅ Исправлено (задача -2) |

**Открытых пробелов в billing-путях больше не выявлено.**

---

## Коммиты

- `4993252` — fix: activatePlan / Paddle (эта задача)
- `a0b1115` — fix: addCredits / audio/status (предыдущая задача)
- `5f22d29` — fix: Railway refund incidents (задача -2)

Все запушены в `origin/main`.
