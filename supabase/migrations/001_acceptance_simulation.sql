-- ============================================================
-- Acceptance simulation for migration 001_subscription_foundation
-- Run in Supabase SQL Editor AFTER running 001_subscription_foundation.sql
--
-- ПЕРЕД ЗАПУСКОМ:
--   1. Найдите ваш UUID: Supabase Dashboard → Authentication → Users → колонка UUID
--   2. Сделайте Find & Replace: замените REPLACE-WITH-YOUR-UUID на реальный UUID
--   3. Запускайте весь блок целиком
--
-- FK profiles.id → auth.users(id) не позволяет вставить фейкового юзера;
-- скрипт использует реальный аккаунт владельца.
-- Все изменения внутри BEGIN...ROLLBACK — данные не сохраняются.
-- ============================================================

begin;

-- ── Стартовое состояние (до симуляций) ───────────────────────────────────────

select 'BASELINE' as sim,
       plan, credits, plan_credits, purchased_credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;

-- ── SIM 1: Инвариант после миграции ──────────────────────────────────────────
-- credits должен равняться plan_credits + purchased_credits.

select 'SIM1 INVARIANT' as sim,
       credits, plan_credits, purchased_credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: invariant_ok = true

-- ── Сброс для симуляций 2-8 ──────────────────────────────────────────────────
-- Фиксируем чистое состояние: free, 0 plan_credits, 50000 purchased, 50000 credits.
-- ROLLBACK отменит это в конце.

update public.profiles
set plan              = 'free',
    plan_credits      = 0,
    purchased_credits = 50000,
    credits           = 50000,
    plan_activated_at = null,
    plan_expires_at   = null
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;

select 'RESET' as sim, plan, credits, plan_credits, purchased_credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan='free', credits=50000, plan_credits=0, purchased_credits=50000, invariant_ok=true

-- ── SIM 2: free → paid (сначала план, потом кредиты — как в activatePlan) ────
-- Порядок критичен: add_plan_credits читает profiles.plan для расчёта кепа.

-- Шаг A: установить план и даты
update public.profiles
set plan              = 'starter',
    plan_activated_at = now(),
    plan_expires_at   = now() + interval '30 days'
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;

-- Шаг Б: начислить план-кредиты (cap читает plan='starter' → 400000)
select public.add_plan_credits(
  'REPLACE-WITH-YOUR-UUID'::uuid,
  200000,
  'plan_activation_tg_manual',
  null
);
-- v_plan='starter', v_max_cap=400000, v_cur_plan=0 → v_to_add=200000

select 'SIM2 POST' as sim, plan, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan='starter', plan_credits=200000, purchased_credits=50000,
--           credits=250000, invariant_ok=true

-- ── SIM 3: Списание — сначала plan_credits ───────────────────────────────────

select public.spend_credits(
  'REPLACE-WITH-YOUR-UUID'::uuid,
  70000,
  'video_render_test',
  null
) as spend_result;
-- from_plan=min(70000,200000)=70000, from_purchased=0
-- Expected: {"success":true,"remaining":180000,"from_plan":70000,"from_purchased":0}

select 'SIM3 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan_credits=130000, purchased_credits=50000, credits=180000, invariant_ok=true

-- ── SIM 4: Списание через границу кошельков ──────────────────────────────────

select public.spend_credits(
  'REPLACE-WITH-YOUR-UUID'::uuid,
  160000,
  'video_render_big',
  null
) as spend_result;
-- from_plan=min(160000,130000)=130000, from_purchased=160000-130000=30000
-- Expected: {"success":true,"remaining":20000,"from_plan":130000,"from_purchased":30000}

select 'SIM4 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan_credits=0, purchased_credits=20000, credits=20000, invariant_ok=true

-- ── SIM 5: Нехватка баланса → отказ, балансы не изменяются ──────────────────

select public.spend_credits(
  'REPLACE-WITH-YOUR-UUID'::uuid,
  999999,
  'should_fail',
  null
) as spend_result;
-- total=0+20000=20000 < 999999 → ранний return, INSERT не выполняется
-- Expected: {"success":false,"remaining":20000}

select 'SIM5 POST (= SIM4)' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan_credits=0, purchased_credits=20000, credits=20000 (не изменились)

-- ── SIM 6: Топап → только purchased_credits, plan_credits не трогается ────────

select public.add_purchased_credits(
  'REPLACE-WITH-YOUR-UUID'::uuid,
  50000,
  'topup_russia',
  null
);

select 'SIM6 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan_credits=0 (не изменился), purchased_credits=70000,
--           credits=70000, invariant_ok=true

-- ── SIM 7: Продление до истечения — add_plan_credits при ненулевом expires ────
-- Симулируем: план-кредиты сожжены, до конца периода осталось 15 дней.
-- purchased_credits и credits остаются на 70000 (из SIM 6).

update public.profiles
set plan_credits    = 0,
    plan_expires_at = now() + interval '15 days'
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;

select public.add_plan_credits(
  'REPLACE-WITH-YOUR-UUID'::uuid,
  200000,
  'plan_activation_paddle',
  null
);
-- plan='starter', cap=400000, cur_plan=0 → to_add=200000
-- plan_credits: 0+200000=200000, credits: 70000+200000=270000

select 'SIM7 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok,
       plan_expires_at
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan_credits=200000, purchased_credits=70000, credits=270000, invariant_ok=true

-- ── SIM 8: Кап PLAN_MAX_CREDITS (starter = 400000) ───────────────────────────
-- cur_plan=200000, пробуем добавить 300000 → cap режет до 200000

select public.add_plan_credits(
  'REPLACE-WITH-YOUR-UUID'::uuid,
  300000,
  'plan_activation_overflow_test',
  null
);
-- v_to_add = LEAST(300000, 400000-200000) = LEAST(300000, 200000) = 200000
-- plan_credits: 200000+200000=400000, credits: 270000+200000=470000

select 'SIM8 POST (кап)' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = 'REPLACE-WITH-YOUR-UUID'::uuid;
-- Expected: plan_credits=400000, purchased_credits=70000, credits=470000, invariant_ok=true

-- ── Лог транзакций симуляции ─────────────────────────────────────────────────
-- Фильтр по operation исключает реальные транзакции юзера.
-- 'should_fail' отсутствует — spend_credits не вставляет при отказе.
-- Итого 6 строк.

select 'TXLOG' as section, operation, amount, wallet, created_at
from public.credit_transactions
where user_id = 'REPLACE-WITH-YOUR-UUID'::uuid
  and operation in (
    'plan_activation_tg_manual',
    'video_render_test',
    'video_render_big',
    'topup_russia',
    'plan_activation_paddle',
    'plan_activation_overflow_test'
  )
order by created_at;
-- Expected 6 rows:
--   plan_activation_tg_manual     +200000  plan
--   video_render_test              -70000  mixed
--   video_render_big              -160000  mixed
--   topup_russia                   +50000  purchased
--   plan_activation_paddle        +200000  plan
--   plan_activation_overflow_test +200000  plan  ← 200000, не 300000 (кап)

-- ── ROLLBACK — все изменения откатываются, данные не сохраняются ─────────────

rollback;

select 'SIMULATION COMPLETE — все изменения откачены' as result;
