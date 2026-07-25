-- 011_grants_and_metrics_fix.sql
-- Records changes applied manually to the live DB on 2026-07-25.
-- Run once in Supabase SQL Editor. Idempotent: CREATE OR REPLACE, ALTER FUNCTION,
-- REVOKE and GRANT are all safe to re-run on an already-patched database.
--
-- What this migration does:
--   1. deduct_credits: add last_active_at = now() to UPDATE profiles (metrics).
--   2. All 7 credit RPCs: harden SET search_path to block search-path injection
--      attacks possible on SECURITY DEFINER functions.
--   3. All 7 credit RPCs: REVOKE EXECUTE from PUBLIC and authenticated.
--      These functions accept p_user_id as a parameter and do NOT verify
--      auth.uid(). PostgREST exposes every SECURITY DEFINER function at
--      /rest/v1/rpc/{name}, so any bearer of the anon key (PUBLIC) or a user
--      JWT (authenticated) could call add_credits(arbitrary_uuid, large_amount)
--      and grant themselves credits. All legitimate callers in application code
--      use SUPABASE_SERVICE_ROLE_KEY (role: service_role).
--   4. All 7 credit RPCs: explicit GRANT EXECUTE to service_role.
--   5. analytics_events: GRANT INSERT to service_role. trackEvent() uses
--      createServiceClient(); without this grant every insert failed silently
--      inside a try/catch and no analytics data was written.
--   6. analytics_events: REVOKE TRUNCATE from anon and authenticated (default
--      privilege cleanup to reduce blast radius of a compromised token).

-- ── 1 + 2. deduct_credits: add last_active_at + harden search_path ───────────
-- Exact diff vs 001_subscription_foundation.sql:
--   + LANGUAGE / SECURITY DEFINER / SET search_path moved to function options
--   + last_active_at = now()  in the UPDATE public.profiles block

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

-- ── 2. Harden search_path on the remaining 6 SECURITY DEFINER functions ───────
-- ALTER FUNCTION SET search_path is idempotent: safe to re-run.
-- expire_plan and extend_plan already had SET search_path = public in their
-- original migration bodies; this confirms the setting is present.

ALTER FUNCTION public.add_plan_credits(uuid, integer, text, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.add_purchased_credits(uuid, integer, text, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.add_credits(uuid, integer, text, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.spend_credits(uuid, integer, text, uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.expire_plan(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.extend_plan(uuid, integer, text, text)
  SET search_path = public, pg_temp;

-- ── 3. REVOKE EXECUTE from PUBLIC and authenticated ───────────────────────────

REVOKE EXECUTE ON FUNCTION public.add_plan_credits(uuid, integer, text, uuid)      FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_purchased_credits(uuid, integer, text, uuid) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_credits(uuid, integer, text, uuid)           FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.spend_credits(uuid, integer, text, uuid)         FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, uuid)        FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_plan(uuid)                                FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.extend_plan(uuid, integer, text, text)           FROM PUBLIC, authenticated;

-- ── 4. GRANT EXECUTE to service_role (explicit for self-contained migration) ──

GRANT EXECUTE ON FUNCTION public.add_plan_credits(uuid, integer, text, uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.add_purchased_credits(uuid, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_credits(uuid, integer, text, uuid)           TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, integer, text, uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_plan(uuid)                                TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_plan(uuid, integer, text, text)           TO service_role;

-- ── 5. analytics_events: GRANT INSERT to service_role ────────────────────────

GRANT INSERT ON public.analytics_events TO service_role;

-- ── 6. analytics_events: REVOKE superfluous default grants ───────────────────

REVOKE TRUNCATE ON public.analytics_events FROM anon, authenticated;
