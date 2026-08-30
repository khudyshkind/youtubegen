-- Add styled_prompts column to image_jobs so partial jobs can be resumed
-- without re-running Claude scene generation.
-- Apply manually in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wugzjpgmiptkaaqdworx/sql/new

alter table public.image_jobs
  add column if not exists styled_prompts jsonb;
