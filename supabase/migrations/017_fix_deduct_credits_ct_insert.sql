-- 017_fix_deduct_credits_ct_insert.sql
-- Purpose: Ensure deduct_credits always inserts into credit_transactions with wallet='mixed'.
--
-- Evidence for the bug: all 1,000 rows in credit_transactions have wallet=NULL,
-- meaning the INSERT step inside deduct_credits never ran after migration_001 was applied.
-- Profile balances show 136,008 credits consumed — the UPDATE on profiles works correctly,
-- but the INSERT into credit_transactions is missing from the live function body.
--
-- This migration re-applies the exact function body from 011_grants_and_metrics_fix.sql,
-- which is the authoritative version. It is idempotent: CREATE OR REPLACE is safe to re-run
-- if the function already matches. Grants are unchanged.
--
-- Before running: confirm the current live body in Supabase SQL Editor:
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'deduct_credits';
--
-- After running: execute a credit-spending operation and confirm a new row appears
-- in credit_transactions with wallet='mixed'.
-- ============================================================

CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- This INSERT was missing from the live function, causing credit_transactions
  -- to be empty for all studio-pipeline operations (audio_secretvoicer,
  -- audio_voicer, images/secretslider, video_render, image_*).
  INSERT INTO public.credit_transactions (user_id, amount, operation, project_id, wallet)
    VALUES (p_user_id, -p_amount, p_operation, p_project_id, 'mixed');

  RETURN json_build_object(
    'success',        true,
    'remaining',      v_plan_cr + v_purch_cr - p_amount,
    'from_plan',      v_from_plan,
    'from_purchased', v_from_purch
  );
END;
$$;

-- Grants are already correct from 011_grants_and_metrics_fix; re-stating for completeness.
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, uuid) FROM PUBLIC, authenticated;
GRANT  EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, uuid) TO   service_role;
