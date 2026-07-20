-- ============================================================
-- Migration 005: projects.type column for tool runs
-- WAVE 1 TOOLS — Phase 0
--
-- type = 'project' : regular video wizard project (default, existing rows)
-- type = 'tool_run': standalone tool result stored in the projects table
--                    to inherit dashboard, retention, credit history
--
-- Tool type slug is stored in image_style for tool_run rows.
-- Status stays 'completed'/'failed' — no changes to the status CHECK constraint.
--
-- Run in Supabase Dashboard → SQL Editor. Idempotent.
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'project';

-- Partial index for fast dashboard queries filtering by tool_run type
CREATE INDEX IF NOT EXISTS projects_type_user_idx
  ON public.projects(user_id, created_at DESC)
  WHERE type = 'tool_run';
