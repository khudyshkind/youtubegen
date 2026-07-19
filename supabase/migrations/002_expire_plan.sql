-- ============================================================
-- Migration 002: expire_plan RPC
-- SUBSCRIPTIONS v1 — STAGE 2
-- Run AFTER 001_subscription_foundation.sql
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

-- Atomically downgrades an expired paid user to free.
-- Idempotent: already free or not yet expired → noop.
-- plan_expires_at is preserved for audit history.
create or replace function public.expire_plan(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan         text;
  v_plan_credits integer;
  v_purchased    integer;
  v_expires_at   timestamptz;
begin
  select plan, plan_credits, purchased_credits, plan_expires_at
  into   v_plan, v_plan_credits, v_purchased, v_expires_at
  from   public.profiles
  where  id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  -- Idempotent: already free
  if v_plan = 'free' then
    return jsonb_build_object('ok', true, 'noop', true, 'reason', 'already_free');
  end if;

  -- Idempotent: not expired yet (or expiry not set)
  if v_expires_at is null or v_expires_at >= now() then
    return jsonb_build_object('ok', true, 'noop', true, 'reason', 'not_expired');
  end if;

  -- Log credit burn before zeroing
  if v_plan_credits > 0 then
    insert into public.credit_transactions (user_id, amount, operation, wallet)
    values (p_user_id, -v_plan_credits, 'plan_expired', 'plan');
  end if;

  -- Downgrade: zero plan wallet, credits = purchased only
  -- plan_expires_at intentionally kept for audit history
  update public.profiles
  set    plan              = 'free',
         plan_credits      = 0,
         credits           = v_purchased,
         plan_activated_at = null
  where  id = p_user_id;

  return jsonb_build_object(
    'ok',                true,
    'burned',            v_plan_credits,
    'remaining_credits', v_purchased
  );
end;
$$;

grant execute on function public.expire_plan(uuid) to authenticated, service_role;
