-- ============================================================
-- Subscriptions v1 Foundation
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- All statements are idempotent (IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================

-- ─── 1. New columns on profiles ──────────────────────────────────────────────

alter table public.profiles
  add column if not exists plan_credits      integer     not null default 0,
  add column if not exists purchased_credits integer     not null default 0,
  add column if not exists plan_activated_at timestamptz,
  add column if not exists plan_expires_at   timestamptz,
  add column if not exists telegram_chat_id  text;

-- ─── 2. Wallet column on credit_transactions ─────────────────────────────────
-- Values: 'plan' | 'purchased' | 'mixed' | NULL (legacy rows before this migration)

alter table public.credit_transactions
  add column if not exists wallet text;

-- ─── 3. Initial balance transfer ─────────────────────────────────────────────
-- Move all existing credit balances into purchased_credits (eternal wallet).
-- Condition: only rows where both new columns are still zero, so the transfer
-- is never re-applied if this script is run a second time.

update public.profiles
set purchased_credits = credits,
    plan_credits      = 0
where plan_credits = 0
  and purchased_credits = 0
  and credits > 0;

-- ─── 4. add_plan_credits ─────────────────────────────────────────────────────
-- Adds credits to the expiring (plan) wallet.
-- Respects PLAN_MAX_CREDITS cap on the amount added; never cuts existing balance.
-- Cap values MUST stay in sync with PLAN_MAX_CREDITS in src/lib/types.ts.

create or replace function public.add_plan_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns void as $$
declare
  v_plan     text;
  v_max_cap  integer;
  v_cur_plan integer;
  v_to_add   integer;
begin
  select plan, plan_credits
    into v_plan, v_cur_plan
    from public.profiles
    where id = p_user_id
    for update;

  -- Must stay in sync with PLAN_MAX_CREDITS in src/lib/types.ts
  v_max_cap := case v_plan
    when 'basic'   then 160000
    when 'starter' then 400000
    when 'pro'     then 1000000
    when 'agency'  then 3000000
    else 10000  -- free
  end;

  v_to_add := greatest(0, least(p_amount, v_max_cap - v_cur_plan));

  update public.profiles
    set plan_credits = plan_credits + v_to_add,
        credits      = credits      + v_to_add
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, v_to_add, p_operation, p_project_id, 'plan');
end;
$$ language plpgsql security definer;

-- ─── 5. add_purchased_credits ────────────────────────────────────────────────
-- Adds credits to the eternal wallet (topups, admin adjustments, referral bonuses).
-- No cap.

create or replace function public.add_purchased_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns void as $$
begin
  update public.profiles
    set purchased_credits = purchased_credits + p_amount,
        credits           = credits           + p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, p_amount, p_operation, p_project_id, 'purchased');
end;
$$ language plpgsql security definer;

-- ─── 6. spend_credits ────────────────────────────────────────────────────────
-- Deducts plan_credits first, then purchased_credits (atomic).
-- Returns {success, remaining, from_plan, from_purchased}.

create or replace function public.spend_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns json as $$
declare
  v_plan_cr    integer;
  v_purch_cr   integer;
  v_from_plan  integer;
  v_from_purch integer;
begin
  select plan_credits, purchased_credits
    into v_plan_cr, v_purch_cr
    from public.profiles
    where id = p_user_id
    for update;

  if v_plan_cr + v_purch_cr < p_amount then
    return json_build_object(
      'success',   false,
      'remaining', v_plan_cr + v_purch_cr
    );
  end if;

  v_from_plan  := least(p_amount, v_plan_cr);
  v_from_purch := p_amount - v_from_plan;

  update public.profiles
    set plan_credits      = plan_credits      - v_from_plan,
        purchased_credits = purchased_credits - v_from_purch,
        credits           = credits           - p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, -p_amount, p_operation, p_project_id, 'mixed');

  return json_build_object(
    'success',        true,
    'remaining',      v_plan_cr + v_purch_cr - p_amount,
    'from_plan',      v_from_plan,
    'from_purchased', v_from_purch
  );
end;
$$ language plpgsql security definer;

-- ─── 7. Update add_credits → routes to purchased_credits ─────────────────────
-- All existing callers (refunds, Paddle topups, referral bonuses, admin adjustments)
-- now naturally add to the eternal wallet.
-- For plan credit batches (subscriptions), use add_plan_credits() instead.

create or replace function public.add_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns void as $$
begin
  update public.profiles
    set purchased_credits = purchased_credits + p_amount,
        credits           = credits           + p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, p_amount, p_operation, p_project_id, 'purchased');
end;
$$ language plpgsql security definer;

-- ─── 8. Update deduct_credits → two-wallet spend logic ───────────────────────
-- Preserves return format {success, remaining} for backward compat.
-- Deducts plan_credits first, then purchased_credits.

create or replace function public.deduct_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns json as $$
declare
  v_plan_cr    integer;
  v_purch_cr   integer;
  v_from_plan  integer;
  v_from_purch integer;
begin
  select plan_credits, purchased_credits
    into v_plan_cr, v_purch_cr
    from public.profiles
    where id = p_user_id
    for update;

  if v_plan_cr + v_purch_cr < p_amount then
    return json_build_object('success', false, 'remaining', v_plan_cr + v_purch_cr);
  end if;

  v_from_plan  := least(p_amount, v_plan_cr);
  v_from_purch := p_amount - v_from_plan;

  update public.profiles
    set plan_credits      = plan_credits      - v_from_plan,
        purchased_credits = purchased_credits - v_from_purch,
        credits           = credits           - p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, -p_amount, p_operation, p_project_id, 'mixed');

  return json_build_object(
    'success',        true,
    'remaining',      v_plan_cr + v_purch_cr - p_amount,
    'from_plan',      v_from_plan,
    'from_purchased', v_from_purch
  );
end;
$$ language plpgsql security definer;

-- ─── 9. Grants ───────────────────────────────────────────────────────────────

grant execute on function public.add_plan_credits(uuid, integer, text, uuid)      to authenticated, service_role;
grant execute on function public.add_purchased_credits(uuid, integer, text, uuid) to authenticated, service_role;
grant execute on function public.spend_credits(uuid, integer, text, uuid)         to authenticated, service_role;
