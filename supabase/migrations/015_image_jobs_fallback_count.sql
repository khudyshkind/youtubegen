-- Migration: add fallback_scene_count to image_jobs.
-- Tracks how many scenes used a generic fallback prompt (Claude API failure).
-- Queryable indicator for whether a job was affected by an Anthropic billing/overload event.
alter table public.image_jobs
  add column if not exists fallback_scene_count int not null default 0;
