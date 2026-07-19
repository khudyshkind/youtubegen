-- ============================================================
-- Migration 003: expiry notices + admin plan extension
-- SUBSCRIPTIONS v1 — STAGE 3
-- Run AFTER 002_expire_plan.sql
-- Idempotent (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION).
-- ============================================================

-- 1. Anti-spam timestamp for expiry reminders (cron sets it after each send)
alter table public.profiles
  add column if not exists last_expiry_notice_at timestamptz;

-- 2. Plan events log (admin extensions, bulk ops)
create table if not exists public.plan_events (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references public.profiles(id) on delete cascade,  -- null allowed for bulk events
  operation   text        not null,   -- 'plan_extended' | 'plan_extended_bulk'
  days_added  integer,
  reason      text,
  actor_email text,
  metadata    jsonb,
  created_at  timestamptz default now() not null
);

alter table public.plan_events enable row level security;

-- service_role can do everything; authenticated can read their own events
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'plan_events' and policyname = 'service_role_all'
  ) then
    create policy "service_role_all" on public.plan_events
      for all to service_role using (true) with check (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'plan_events' and policyname = 'users_read_own'
  ) then
    create policy "users_read_own" on public.plan_events
      for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

grant all   on public.plan_events to service_role;
grant select on public.plan_events to authenticated;

-- 3. extend_plan RPC: add N days to plan_expires_at, log in plan_events
--    Returns: { ok, new_expires_at, days_added } or { ok: false, error }
--    Guards:
--      - user_not_found  : id does not exist
--      - plan_is_free    : plan = 'free' (nothing to extend)
--      - no_expiry_set   : plan_expires_at IS NULL (manually-activated plan, outside subscription model)
create or replace function public.extend_plan(
  p_user_id     uuid,
  p_days        integer,
  p_reason      text,
  p_actor_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan        text;
  v_expires_at  timestamptz;
  v_new_expires timestamptz;
begin
  select plan, plan_expires_at
  into   v_plan, v_expires_at
  from   public.profiles
  where  id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  if v_plan = 'free' then
    return jsonb_build_object('ok', false, 'error', 'plan_is_free');
  end if;

  -- NULL plan_expires_at = manually-activated plan without subscription expiry.
  -- Extending it is outside the model: admin should set plan_expires_at explicitly first.
  if v_expires_at is null then
    return jsonb_build_object('ok', false, 'error', 'no_expiry_set');
  end if;

  -- Extend from now if already expired (cron missed), otherwise from current expiry
  v_new_expires := greatest(v_expires_at, now()) + (p_days || ' days')::interval;

  update public.profiles
  set    plan_expires_at = v_new_expires
  where  id = p_user_id;

  insert into public.plan_events (user_id, operation, days_added, reason, actor_email)
  values (p_user_id, 'plan_extended', p_days, p_reason, p_actor_email);

  return jsonb_build_object(
    'ok',            true,
    'new_expires_at', v_new_expires,
    'days_added',    p_days
  );
end;
$$;

grant execute on function public.extend_plan(uuid, integer, text, text) to service_role;
