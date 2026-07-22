-- 008_payment_incidents.sql
-- Records every accepted-but-unactivated YooKassa payment so no money is lost silently.

CREATE TABLE IF NOT EXISTS payment_incidents (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id       text        NOT NULL UNIQUE,   -- idempotent: YooKassa retries don't create duplicates
  user_id          uuid,                          -- from metadata; null if metadata was broken
  kind             text,                          -- 'plan' | 'topup' | null
  plan_or_topup    text,                          -- plan_id or topup_index as stored in metadata
  amount_received  numeric,                       -- what YooKassa actually received
  amount_expected  numeric,                       -- what types.ts says it should be
  reason           text        NOT NULL,          -- 'amount_mismatch' | 'bad_metadata' | 'unknown_plan' | 'activation_failed'
  raw_payload      jsonb,                         -- full payment object for forensics
  resolved         boolean     NOT NULL DEFAULT false,
  resolved_note    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_incidents_unresolved_idx
  ON payment_incidents (resolved, created_at DESC);

-- service_role can do everything; authenticated has no direct access (admin only)
GRANT SELECT, INSERT, UPDATE ON payment_incidents TO service_role;
