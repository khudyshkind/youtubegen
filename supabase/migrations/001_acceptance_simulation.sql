-- ============================================================
-- Acceptance simulation for migration 001_subscription_foundation
-- Run in Supabase SQL Editor AFTER running 001_subscription_foundation.sql
-- Uses a throw-away test user; rolls back at the end — nothing persists.
-- ============================================================

begin;

-- ── Create a throw-away test user ────────────────────────────────────────────

insert into public.profiles (id, email, plan, credits, plan_credits, purchased_credits)
values (
  '00000000-0000-0000-0000-000000000001',
  'migration-test@simulation.local',
  'free',
  50000,   -- simulate existing user who had 50 000 credits before migration
  0,
  0
);

-- ── SIM 1: Balance transfer (step 3 of migration) ────────────────────────────

-- Verify pre-transfer state
select 'SIM1 PRE' as sim, credits, plan_credits, purchased_credits
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

update public.profiles
set purchased_credits = credits, plan_credits = 0
where id = '00000000-0000-0000-0000-000000000001'
  and plan_credits = 0 and purchased_credits = 0 and credits > 0;

-- Expected: credits=50000, plan_credits=0, purchased_credits=50000
select 'SIM1 POST' as sim, credits, plan_credits, purchased_credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── SIM 2: free → paid activation ────────────────────────────────────────────

perform public.add_plan_credits(
  '00000000-0000-0000-0000-000000000001'::uuid,
  200000,
  'plan_activation_tg_manual',
  null
);

update public.profiles
set plan = 'starter',
    plan_activated_at = now(),
    plan_expires_at = now() + interval '30 days'
where id = '00000000-0000-0000-0000-000000000001';

-- Expected: plan='starter', plan_credits=200000, purchased_credits=50000, credits=250000
select 'SIM2 POST' as sim, plan, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── SIM 3: Spend credits — plan wallet first ─────────────────────────────────

select public.spend_credits(
  '00000000-0000-0000-0000-000000000001'::uuid,
  70000,
  'video_render_test',
  null
) as spend_result;

-- Expected: plan_credits=130000, purchased_credits=50000, credits=180000
-- from_plan=70000, from_purchased=0
select 'SIM3 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── SIM 4: Spend crossing wallet boundary ────────────────────────────────────

select public.spend_credits(
  '00000000-0000-0000-0000-000000000001'::uuid,
  160000,  -- more than plan_credits (130000) → dips into purchased
  'video_render_big',
  null
) as spend_result;

-- Expected: plan_credits=0, purchased_credits=20000, credits=20000
-- from_plan=130000, from_purchased=30000
select 'SIM4 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── SIM 5: Insufficient balance → refused, balances untouched ────────────────

select public.spend_credits(
  '00000000-0000-0000-0000-000000000001'::uuid,
  999999,  -- way more than available 20000
  'should_fail',
  null
) as spend_result;  -- Expected: {success:false, remaining:20000}

-- Balances must be UNCHANGED
select 'SIM5 POST (must equal SIM4 POST)' as sim, plan_credits, purchased_credits, credits
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── SIM 6: Topup → purchased only, plan_credits untouched ────────────────────

perform public.add_purchased_credits(
  '00000000-0000-0000-0000-000000000001'::uuid,
  50000,
  'topup_russia',
  null
);

-- Expected: plan_credits=0 (unchanged), purchased_credits=70000, credits=70000
select 'SIM6 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── SIM 7: Renewal before expiry — extend from existing date ─────────────────

-- Simulate plan with 15 days remaining
update public.profiles
set plan_credits = 0,
    plan_expires_at = now() + interval '15 days'
where id = '00000000-0000-0000-0000-000000000001';

-- activatePlan logic: base = max(now, expires) = expires (+15d), newExpires = expires + 30d = +45d
-- add_plan_credits: cap for 'starter' = 400000, cur = 0 → adds 200000
perform public.add_plan_credits(
  '00000000-0000-0000-0000-000000000001'::uuid,
  200000,
  'plan_activation_paddle',
  null
);

-- Expected: plan_credits=200000
select 'SIM7 POST' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok,
       plan_expires_at
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── SIM 8: PLAN_MAX_CREDITS cap enforcement ───────────────────────────────────

-- Starter cap = 400000. Current plan_credits = 200000.
-- Try to add 300000 → should cap at 400000 (add only 200000).
perform public.add_plan_credits(
  '00000000-0000-0000-0000-000000000001'::uuid,
  300000,
  'plan_activation_overflow_test',
  null
);

-- Expected: plan_credits=400000 (capped), credits = 400000 + 70000 (purchased) = 470000
select 'SIM8 POST (cap)' as sim, plan_credits, purchased_credits, credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles where id = '00000000-0000-0000-0000-000000000001';

-- ── Credit transaction log ────────────────────────────────────────────────────

select 'TXLOG' as section, operation, amount, wallet, created_at
from public.credit_transactions
where user_id = '00000000-0000-0000-0000-000000000001'
order by created_at;

-- ── ROLLBACK — nothing persists ──────────────────────────────────────────────

rollback;

select 'SIMULATION COMPLETE — all changes rolled back' as result;
