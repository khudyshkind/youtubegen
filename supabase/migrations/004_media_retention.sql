-- ============================================================
-- Migration 004: media_expires_at + media_purged_at
-- HONEST RETENTION — Phase A
--
-- media_expires_at : planned deletion date (written by retention cron on every
--                    dry-run pass, safe to run while RETENTION_DRY_RUN=true).
--                    Displayed to users as the countdown badge in the dashboard.
--
-- media_purged_at  : actual purge timestamp (written AFTER files are deleted,
--                    only when RETENTION_DRY_RUN=false).
--                    commit 91069d7 added this to types.ts but the column was
--                    never created in production — this migration fixes that.
--
-- Run in Supabase Dashboard → SQL Editor before enabling RETENTION_DRY_RUN=false.
-- Idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS media_expires_at  TIMESTAMPTZ;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS media_purged_at   TIMESTAMPTZ;

-- Index for the retention cron daily scan:
--   SELECT ... WHERE media_purged_at IS NULL AND media_expires_at IS NOT NULL
-- Partial index is tiny — only rows the cron actually reads.
CREATE INDEX IF NOT EXISTS projects_media_retention_idx
  ON public.projects(media_expires_at)
  WHERE media_purged_at IS NULL;
