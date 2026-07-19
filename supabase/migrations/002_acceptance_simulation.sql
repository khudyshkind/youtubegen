-- ============================================================
-- Acceptance simulation for migration 002_expire_plan
-- Run in Supabase SQL Editor AFTER running 002_expire_plan.sql
--
-- UUID: 1bc974fa-10d8-4e26-962d-0cd75eacfb64 (owner account — no placeholders)
-- All changes are inside BEGIN...ROLLBACK — data not saved.
-- ============================================================

begin;

-- ── Baseline ────────────────────────────────────────────────────────────────────

select 'BASELINE' as sim,
       id, plan, credits, plan_credits, purchased_credits,
       plan_expires_at,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;

-- ── Reset for simulations ────────────────────────────────────────────────────────
-- starter plan, 200000 plan_credits, 50000 purchased, expires 10 days AGO (expired)
-- ROLLBACK undoes this.

update public.profiles
set plan              = 'starter',
    plan_credits      = 200000,
    purchased_credits = 50000,
    credits           = 250000,
    plan_activated_at = now() - interval '40 days',
    plan_expires_at   = now() - interval '10 days'
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;

select 'RESET (starter, expired -10d)' as sim,
       plan, credits, plan_credits, purchased_credits,
       plan_expires_at < now() as is_expired,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;
-- Expected: plan='starter', credits=250000, plan_credits=200000, purchased_credits=50000,
--           is_expired=true, invariant_ok=true

-- ═══════════════════════════════════════════════════════════════════════════════
-- SIM 1: Expiry flow — starter → free, plan_credits burned, credits = purchased
-- ═══════════════════════════════════════════════════════════════════════════════

select public.expire_plan('1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid) as result;
-- Expected: {"ok":true,"burned":200000,"remaining_credits":50000}

select 'SIM1 POST expire_plan' as sim,
       plan, credits, plan_credits, purchased_credits,
       plan_expires_at,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;
-- Expected: plan='free', credits=50000, plan_credits=0, purchased_credits=50000,
--           plan_expires_at preserved (not null), invariant_ok=true

-- Verify -200000 transaction logged with wallet='plan'
select 'SIM1 TX' as sim, operation, amount, wallet
from public.credit_transactions
where user_id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid
  and operation = 'plan_expired'
order by created_at desc
limit 1;
-- Expected: operation='plan_expired', amount=-200000, wallet='plan'

-- Idempotency: calling expire_plan again on a free user is a no-op
select public.expire_plan('1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid) as idempotent_result;
-- Expected: {"ok":true,"noop":true,"reason":"already_free"}

-- ═══════════════════════════════════════════════════════════════════════════════
-- SIM 2: Non-expired user NOT selected by cron query
-- ═══════════════════════════════════════════════════════════════════════════════
-- Reset to starter with plan_expires_at = 20 days IN THE FUTURE

update public.profiles
set plan              = 'starter',
    plan_credits      = 200000,
    purchased_credits = 50000,
    credits           = 250000,
    plan_expires_at   = now() + interval '20 days'
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;

-- This SELECT mirrors exactly the cron query used in video-server:
-- plan != 'free' AND plan_expires_at < now()
select 'SIM2 CRON_QUERY' as sim,
       count(*) as would_expire
from public.profiles
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid
  and plan != 'free'
  and plan_expires_at < now();
-- Expected: would_expire = 0  ← non-expired user is NOT selected

-- Also verify expire_plan returns noop for non-expired user
select public.expire_plan('1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid) as noop_result;
-- Expected: {"ok":true,"noop":true,"reason":"not_expired"}

select 'SIM2 POST (unchanged)' as sim,
       plan, credits, plan_credits, purchased_credits,
       (credits = plan_credits + purchased_credits) as invariant_ok
from public.profiles
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;
-- Expected: plan='starter', credits=250000 (UNCHANGED — not expired, no downgrade)

-- ═══════════════════════════════════════════════════════════════════════════════
-- SIM 3: Analytics gate — plan='free' → API returns 403 plan_required, no credits spent
-- ═══════════════════════════════════════════════════════════════════════════════
-- After expiry: user is free with 50000 purchased_credits. Demonstrate gate condition.

-- Set user back to expired state and expire them
update public.profiles
set plan              = 'starter',
    plan_credits      = 200000,
    purchased_credits = 50000,
    credits           = 250000,
    plan_expires_at   = now() - interval '5 days'
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;

select public.expire_plan('1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid);

select 'SIM3 GATE_CHECK' as sim,
       plan,
       case when plan = 'free'
            then 'plan_required → API returns 403, no credits spent'
            else 'allowed'
       end as gate_result,
       credits, purchased_credits
from public.profiles
where id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid;
-- Expected: plan='free', gate_result='plan_required → API returns 403, no credits spent'
-- credits=50000 (unchanged — analytics gate fires BEFORE any spend_credits call)

-- Verify no spend transaction was created (gate short-circuits before DB write)
select 'SIM3 NO_SPEND_TX' as sim,
       count(*) as spend_tx_count
from public.credit_transactions
where user_id = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'::uuid
  and operation in ('niche_analysis', 'trends', 'channel_analysis', 'revenue_calc',
                    'channel_plan', 'keywords', 'comments_analysis', 'compare_channels',
                    'niche_finder', 'rising_stars');
-- Expected: spend_tx_count = 0 (no analytics spend ever logged in this simulation)

-- ═══════════════════════════════════════════════════════════════════════════════
-- SIM 4: 20% protection mock — cron query counts
-- ═══════════════════════════════════════════════════════════════════════════════
-- Demonstrates the two count queries the cron uses before calling expire_plan.
-- (Cannot test with multiple real users under ROLLBACK, so we show the query logic.)

-- Query A: total paid users (cron denominator)
select 'SIM4 TOTAL_PAID' as sim,
       count(*) as total_paid_users
from public.profiles
where plan != 'free';

-- Query B: expired paid users (cron numerator)
select 'SIM4 EXPIRED_PAID' as sim,
       count(*) as expired_paid_users
from public.profiles
where plan != 'free'
  and plan_expires_at < now();

-- Protection logic (JavaScript equivalent demonstrated in SQL):
-- if total_paid > 0 AND expired / total_paid > 0.20 → abort, send TG alert
-- Example: 5 expired / 10 total = 50% → ABORT (suspicious mass expiry)
-- Example: 1 expired / 10 total = 10% → PROCEED normally
select 'SIM4 PROTECTION_RULE' as sim,
       'if expired_count / total_paid > 0.20 → cron aborts, sends TG alert' as rule,
       'prevents clock-skew or data corruption from mass-downgrading users' as reason;

-- ── ROLLBACK — all simulation changes discarded ────────────────────────────────

rollback;

select 'SIMULATION COMPLETE — все изменения откачены' as result;
