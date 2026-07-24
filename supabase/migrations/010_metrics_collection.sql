-- 010_metrics_collection.sql
-- Adds columns and indexes for metrics collection.
-- Idempotent: all statements use IF NOT EXISTS / CREATE OR REPLACE.
-- Run once in Supabase SQL Editor.

-- ── New columns ────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS phase_updated_at timestamptz;

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS payment_amount   numeric,
  ADD COLUMN IF NOT EXISTS payment_currency text;

-- ── Indexes ────────────────────────────────────────────────────────────────────

-- Needed for revenue queries (30-day windows, monthly sums).
CREATE INDEX IF NOT EXISTS credit_transactions_created_at_idx
  ON public.credit_transactions (created_at);

-- Needed for group-by-operation breakdowns (opCounts in dashboard).
CREATE INDEX IF NOT EXISTS credit_transactions_operation_idx
  ON public.credit_transactions (operation);

-- Needed for failed-rate / active-job queries on video_jobs.
CREATE INDEX IF NOT EXISTS video_jobs_status_idx
  ON public.video_jobs (status);

-- ── spend_credits: track last_active_at ───────────────────────────────────────
-- Rewriting the whole function because ALTER FUNCTION cannot change the body.
-- Only change vs previous version: add `last_active_at = now()` to the profiles UPDATE.

CREATE OR REPLACE FUNCTION public.spend_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_plan_cr    integer;
  v_purch_cr   integer;
  v_from_plan  integer;
  v_from_purch integer;
BEGIN
  SELECT plan_credits, purchased_credits
    INTO v_plan_cr, v_purch_cr
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF v_plan_cr + v_purch_cr < p_amount THEN
    RETURN json_build_object('success', false, 'remaining', v_plan_cr + v_purch_cr);
  END IF;

  v_from_plan  := LEAST(p_amount, v_plan_cr);
  v_from_purch := p_amount - v_from_plan;

  UPDATE public.profiles
    SET plan_credits      = plan_credits      - v_from_plan,
        purchased_credits = purchased_credits - v_from_purch,
        credits           = credits           - p_amount,
        last_active_at    = now()
    WHERE id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, amount, operation, project_id, wallet)
    VALUES (p_user_id, -p_amount, p_operation, p_project_id, 'mixed');

  RETURN json_build_object(
    'success',        true,
    'remaining',      v_plan_cr + v_purch_cr - p_amount,
    'from_plan',      v_from_plan,
    'from_purchased', v_from_purch
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grants are inherited from the existing function; re-state for clarity.
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, integer, text, uuid)
  TO authenticated, service_role;
