-- Migration 016: unified operation log for all product operations.
-- Run manually in Supabase SQL Editor.
-- Tracks every operation (plan, script, audio, images, video, seo, etc.)
-- from all Vercel routes and Railway workers in a single table.

create table if not exists public.operation_log (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  user_id          uuid not null references auth.users(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,
  op_type          text not null,
  provider         text,
  status           text not null check (status in ('running', 'done', 'failed')),
  credits_spent    integer not null default 0,
  credits_refunded integer not null default 0,
  error_text       text
);

create index if not exists operation_log_user_id_idx    on public.operation_log(user_id);
create index if not exists operation_log_started_at_idx on public.operation_log(started_at desc);
create index if not exists operation_log_status_idx     on public.operation_log(status);
create index if not exists operation_log_op_type_idx    on public.operation_log(op_type);

alter table public.operation_log enable row level security;

-- service_role bypasses RLS and is used by the helper (Vercel) and Railway worker
grant all on public.operation_log to service_role;

-- authenticated users can only see their own rows (admin reads via service_role)
create policy "Users see own operation_log rows"
  on public.operation_log
  for select
  to authenticated
  using (auth.uid() = user_id);
