-- 014_refund_incidents.sql
-- Extend payment_incidents to support refund failures from Railway job handlers.
-- payment_id becomes nullable so job-based incidents can be recorded without a YooKassa ID.

ALTER TABLE payment_incidents
  ALTER COLUMN payment_id DROP NOT NULL;

ALTER TABLE payment_incidents
  ADD COLUMN IF NOT EXISTS job_id text;

CREATE INDEX IF NOT EXISTS payment_incidents_job_id_idx
  ON payment_incidents (job_id)
  WHERE job_id IS NOT NULL;

COMMENT ON COLUMN payment_incidents.payment_id IS 'YooKassa payment ID (null for non-payment incidents such as refund_failed)';
COMMENT ON COLUMN payment_incidents.job_id     IS 'Railway job ID for refund_failed incidents; null for payment incidents';
