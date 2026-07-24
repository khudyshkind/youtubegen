-- ============================================================
-- Remove PLAN_MAX_CREDITS cap from add_plan_credits
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Idempotent: CREATE OR REPLACE.
-- ============================================================

-- Rewrite add_plan_credits without cap logic.
-- FOR UPDATE row lock is kept to serialise concurrent calls for the same user.

create or replace function public.add_plan_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns void as $$
begin
  perform 1 from public.profiles where id = p_user_id for update;

  update public.profiles
    set plan_credits = plan_credits + p_amount,
        credits      = credits      + p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, p_amount, p_operation, p_project_id, 'plan');
end;
$$ language plpgsql security definer;

grant execute on function public.add_plan_credits(uuid, integer, text, uuid) to authenticated, service_role;
