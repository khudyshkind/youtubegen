-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- pg_net: async HTTP requests from triggers (Supabase Pro plan)
-- Secret is hardcoded in the DB function body (not in git); see ops runbook.
create extension if not exists pg_net;

-- ─────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────

create table if not exists public.profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  email           text        not null,
  full_name       text,
  avatar_url      text,
  plan            text        not null default 'free'
                    check (plan in ('free', 'basic', 'starter', 'pro', 'agency')),
  credits         integer     not null default 30,
  paddle_customer_id      text unique,
  paddle_subscription_id  text unique,
  onboarding_completed    boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Migration: add onboarding_completed to existing databases
alter table public.profiles add column if not exists onboarding_completed boolean not null default false;

-- Migration: admin flag
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Migration: add 'basic' plan to constraint (run once on existing databases)
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'basic', 'starter', 'pro', 'agency'));

-- Migration: Paddle billing (add if missing — safe to run multiple times)
alter table public.profiles add column if not exists paddle_customer_id text unique;
alter table public.profiles add column if not exists paddle_subscription_id text unique;

-- Migration: referral program
alter table public.profiles add column if not exists referral_code text unique;
alter table public.profiles add column if not exists referred_by text;
alter table public.profiles add column if not exists referral_count integer not null default 0;
alter table public.profiles add column if not exists referral_credits_earned integer not null default 0;
alter table public.profiles add column if not exists encrypted_yt_key text;

-- Migration: subscriptions v1 — two-wallet model
alter table public.profiles add column if not exists plan_credits      integer     not null default 0;
alter table public.profiles add column if not exists purchased_credits integer     not null default 0;
alter table public.profiles add column if not exists plan_activated_at timestamptz;
alter table public.profiles add column if not exists plan_expires_at   timestamptz;
alter table public.profiles add column if not exists telegram_chat_id  text;

-- Migration: wallet column on credit_transactions
alter table public.credit_transactions add column if not exists wallet text;

create table if not exists public.projects (
  id              uuid        default uuid_generate_v4() primary key,
  user_id         uuid        references public.profiles(id) on delete cascade not null,
  title           text        not null default 'Новый проект',
  status          text        not null default 'draft'
                    check (status in (
                      'draft', 'generating_script', 'generating_audio',
                      'generating_subtitles', 'generating_images',
                      'generating_video', 'generating_seo', 'completed', 'failed'
                    )),
  topic           text        not null,
  duration_minutes integer    not null default 5,
  voice_id        text,
  script          text,
  audio_url       text,
  subtitle_blocks jsonb,
  scene_images    jsonb,
  image_interval  integer     not null default 10,
  image_style     text,
  thumbnail_url   text,
  thumbnail_text_mode text not null default 'overlay',
  video_url       text,
  seo             jsonb,
  credits_spent   integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id          uuid        default uuid_generate_v4() primary key,
  user_id     uuid        references public.profiles(id) on delete cascade not null,
  amount      integer     not null,
  operation   text        not null,
  project_id  uuid        references public.projects(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────

create index if not exists projects_user_id_idx          on public.projects(user_id);
create index if not exists projects_status_idx           on public.projects(status);
create index if not exists credit_transactions_user_id_idx on public.credit_transactions(user_id);

-- ─────────────────────────────────────────
-- Auto-update updated_at
-- ─────────────────────────────────────────

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profiles_updated
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger on_projects_updated
  before update on public.projects
  for each row execute function public.handle_updated_at();

-- ─────────────────────────────────────────
-- Auto-create profile on signup
-- ─────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger as $$
declare
  -- Secret hardcoded in DB only (not in git). See ops runbook for rotation procedure.
  _secret text := '<NUW_WEBHOOK_SECRET>';
begin
  insert into public.profiles (id, email, full_name, avatar_url, credits, plan, purchased_credits)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    10000,
    'free',
    10000  -- signup bonus → eternal wallet (no cap, no expiry)
  );
  -- referral_code is generated by the set_referral_code BEFORE INSERT trigger on profiles

  -- Async new-user webhook via pg_net (non-blocking; registration never blocked on failure)
  begin
    if _secret <> '' and _secret <> '<NUW_WEBHOOK_SECRET>' then
      perform net.http_post(
        url     := 'https://lefiro.co/api/webhooks/new-user',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || _secret
        ),
        body    := jsonb_build_object(
          'id',        new.id::text,
          'email',     new.email,
          'provider',  new.raw_app_meta_data->>'provider',
          'full_name', new.raw_user_meta_data->>'full_name'
        )::text
      );
    end if;
  exception when others then
    null; -- pg_net not available or call failed; registration is unaffected
  end;

  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────
-- Credit functions (atomic, bypass RLS)
-- Two-wallet model: plan_credits (expiring) + purchased_credits (eternal).
-- profiles.credits is a materialized sum updated atomically by these RPCs only.
-- ─────────────────────────────────────────

-- add_plan_credits: adds to expiring wallet. No cap (removed in 003_remove_plan_cap).
create or replace function public.add_plan_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns void as $$
begin
  perform 1 from public.profiles where id = p_user_id for update;

  update public.profiles
    set plan_credits = plan_credits + p_amount,
        credits      = credits      + p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, p_amount, p_operation, p_project_id, 'plan');
end;
$$ language plpgsql security definer;

-- add_purchased_credits: adds to eternal wallet, no cap.
create or replace function public.add_purchased_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns void as $$
begin
  update public.profiles
    set purchased_credits = purchased_credits + p_amount,
        credits           = credits           + p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, p_amount, p_operation, p_project_id, 'purchased');
end;
$$ language plpgsql security definer;

-- spend_credits: deducts plan_credits first, then purchased_credits.
-- Returns {success, remaining, from_plan, from_purchased}.
create or replace function public.spend_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns json as $$
declare
  v_plan_cr    integer;
  v_purch_cr   integer;
  v_from_plan  integer;
  v_from_purch integer;
begin
  select plan_credits, purchased_credits
    into v_plan_cr, v_purch_cr
    from public.profiles
    where id = p_user_id
    for update;

  if v_plan_cr + v_purch_cr < p_amount then
    return json_build_object('success', false, 'remaining', v_plan_cr + v_purch_cr);
  end if;

  v_from_plan  := least(p_amount, v_plan_cr);
  v_from_purch := p_amount - v_from_plan;

  update public.profiles
    set plan_credits      = plan_credits      - v_from_plan,
        purchased_credits = purchased_credits - v_from_purch,
        credits           = credits           - p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, -p_amount, p_operation, p_project_id, 'mixed');

  return json_build_object(
    'success',        true,
    'remaining',      v_plan_cr + v_purch_cr - p_amount,
    'from_plan',      v_from_plan,
    'from_purchased', v_from_purch
  );
end;
$$ language plpgsql security definer;

-- add_credits: legacy entrypoint — routes to purchased_credits (eternal, no cap).
-- All existing callers (refunds, Paddle topups, referral bonuses, admin adjustments)
-- naturally belong in the eternal wallet. Use add_plan_credits() for subscriptions.
create or replace function public.add_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns void as $$
begin
  update public.profiles
    set purchased_credits = purchased_credits + p_amount,
        credits           = credits           + p_amount
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, p_amount, p_operation, p_project_id, 'purchased');
end;
$$ language plpgsql security definer;

-- deduct_credits: two-wallet spend; backward-compat return format {success, remaining}.
-- 011: added last_active_at = now() + SET search_path hardening.
create or replace function public.deduct_credits(
  p_user_id    uuid,
  p_amount     integer,
  p_operation  text,
  p_project_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_cr    integer;
  v_purch_cr   integer;
  v_from_plan  integer;
  v_from_purch integer;
begin
  select plan_credits, purchased_credits
    into v_plan_cr, v_purch_cr
    from public.profiles
    where id = p_user_id
    for update;

  if v_plan_cr + v_purch_cr < p_amount then
    return json_build_object('success', false, 'remaining', v_plan_cr + v_purch_cr);
  end if;

  v_from_plan  := least(p_amount, v_plan_cr);
  v_from_purch := p_amount - v_from_plan;

  update public.profiles
    set plan_credits      = plan_credits      - v_from_plan,
        purchased_credits = purchased_credits - v_from_purch,
        credits           = credits           - p_amount,
        last_active_at    = now()
    where id = p_user_id;

  insert into public.credit_transactions (user_id, amount, operation, project_id, wallet)
    values (p_user_id, -p_amount, p_operation, p_project_id, 'mixed');

  return json_build_object(
    'success',        true,
    'remaining',      v_plan_cr + v_purch_cr - p_amount,
    'from_plan',      v_from_plan,
    'from_purchased', v_from_purch
  );
end;
$$;

-- ─────────────────────────────────────────
-- Role grants (required for RLS to work)
-- ─────────────────────────────────────────

grant usage on schema public to anon, authenticated;

grant select, update                          on public.profiles             to authenticated;
grant select, insert, update, delete          on public.projects             to authenticated;
grant select, insert, update, delete          on public.projects             to service_role;
grant select                                  on public.credit_transactions  to authenticated;

-- ── credit RPC grants: only service_role (011_grants_and_metrics_fix) ─────────
-- SECURITY DEFINER functions accept p_user_id as a parameter without verifying
-- auth.uid(). PostgREST exposes them at /rest/v1/rpc/{name}. Granting PUBLIC or
-- authenticated access would allow any JWT holder to credit an arbitrary user.
-- All app callers use SUPABASE_SERVICE_ROLE_KEY (role: service_role).
--
-- DO block: iterates pg_proc so the block is safe even when expire_plan /
-- extend_plan are not yet defined (they live in migrations 002/003 and will
-- be processed by migration 011 after those migrations run).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN (
             'add_plan_credits', 'add_purchased_credits', 'add_credits',
             'spend_credits', 'deduct_credits', 'expire_plan', 'extend_plan'
           )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO   service_role',          r.oid::regprocedure);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────

alter table public.profiles             enable row level security;
alter table public.projects             enable row level security;
alter table public.credit_transactions  enable row level security;

-- Profiles
create policy "profiles: own read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);

-- Projects
create policy "projects: own select"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "projects: own insert"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "projects: own update"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "projects: own delete"
  on public.projects for delete
  using (auth.uid() = user_id);

-- Credit transactions
create policy "transactions: own select"
  on public.credit_transactions for select
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- Referral code auto-generation trigger
-- ─────────────────────────────────────────

create or replace function public.set_referral_code()
returns trigger as $$
begin
  if new.referral_code is null then
    new.referral_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$ language plpgsql;

create or replace trigger set_referral_code_trigger
  before insert on public.profiles
  for each row execute function public.set_referral_code();

-- ─────────────────────────────────────────
-- Analytics events
-- ─────────────────────────────────────────

create table if not exists public.analytics_events (
  id          uuid        default uuid_generate_v4() primary key,
  user_id     uuid        references public.profiles(id) on delete cascade not null,
  event       text        not null,
  properties  jsonb       not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists analytics_events_user_id_idx on public.analytics_events(user_id);
create index if not exists analytics_events_event_idx   on public.analytics_events(event);
create index if not exists analytics_events_created_at_idx on public.analytics_events(created_at);

alter table public.analytics_events enable row level security;

grant select on public.analytics_events to authenticated;
grant insert on public.analytics_events to service_role;
revoke truncate on public.analytics_events from anon, authenticated;

create policy "analytics_events: own select"
  on public.analytics_events for select
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- YouTube Analytics cache (24h TTL)
-- ─────────────────────────────────────────

create table if not exists public.analytics_cache (
  id          uuid        default uuid_generate_v4() primary key,
  cache_type  text        not null,
  cache_key   text        not null,
  result      jsonb       not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists analytics_cache_type_key_idx
  on public.analytics_cache(cache_type, cache_key);

create index if not exists analytics_cache_created_at_idx
  on public.analytics_cache(created_at);

-- service role reads/writes cache; no RLS needed (server-side only)
alter table public.analytics_cache enable row level security;
grant all on public.analytics_cache to service_role;
grant select, insert, update, delete on public.analytics_cache to authenticated;

-- ─────────────────────────────────────────
-- Analytics reports history (per-user, max 20)
-- ─────────────────────────────────────────

create table if not exists public.analytics_reports (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references public.profiles(id) on delete cascade not null,
  report_type text        not null,
  title       text        not null,
  query       text        not null,
  result      jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists analytics_reports_user_id_idx
  on public.analytics_reports(user_id, created_at desc);

alter table public.analytics_reports enable row level security;

-- Users can read/delete their own reports (via authenticated client)
create policy "analytics_reports: own select"
  on public.analytics_reports for select
  using (auth.uid() = user_id);

create policy "analytics_reports: own delete"
  on public.analytics_reports for delete
  using (auth.uid() = user_id);

-- service_role needs explicit grant (new tables don't inherit default privs automatically)
grant all on public.analytics_reports to service_role;
-- authenticated users can read/delete their own reports (RLS enforces user_id filter)
grant select, delete on public.analytics_reports to authenticated;

-- ─────────────────────────────────────────
-- Storage buckets
-- ─────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict do nothing;

-- Storage RLS: users can only access their own files
create policy "audio: own access"
  on storage.objects for all
  using (bucket_id = 'audio' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "images: public read"
  on storage.objects for select
  using (bucket_id = 'images');

create policy "images: own write"
  on storage.objects for insert
  with check (bucket_id = 'images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "videos: public read"
  on storage.objects for select
  using (bucket_id = 'videos');

create policy "videos: service write"
  on storage.objects for insert
  with check (bucket_id = 'videos');

-- ─────────────────────────────────────────
-- Telegram bot persistence tables
-- (accessed only via service_role from video-server)
-- ─────────────────────────────────────────

create table if not exists public.bot_content_queue (
  id           uuid        default gen_random_uuid() primary key,
  topic        text        not null,
  status       text        not null default 'pending'
                 check (status in ('pending', 'published', 'declined')),
  created_at   timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists bot_content_queue_status_idx
  on public.bot_content_queue(status, created_at);

create table if not exists public.bot_seen_urls (
  url        text        primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.bot_settings (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

insert into public.bot_settings (key, value) values
  ('auto_publish',     'false'),
  ('monitor_interval', 'daily'),
  ('post_time',        '12:00'),
  ('plan_paused',      'false')
on conflict (key) do nothing;

grant all on public.bot_content_queue to service_role;
grant all on public.bot_seen_urls     to service_role;
grant all on public.bot_settings      to service_role;

create table if not exists public.support_tickets (
  id                uuid        default gen_random_uuid() primary key,
  ticket_number     serial,
  user_telegram_id  text        not null,
  username          text,
  category          text        not null,
  description       text        not null,
  status            text        not null default 'open'
                      check (status in ('open', 'answered', 'closed')),
  created_at        timestamptz not null default now()
);

grant all on public.support_tickets to service_role;
grant usage, select on sequence public.support_tickets_ticket_number_seq to service_role;

-- Migration: image_style (was used in-memory only, now persisted)
alter table public.projects add column if not exists image_style text;

-- Migration: thumbnail text mode
alter table public.projects add column if not exists thumbnail_text_mode text not null default 'overlay';

-- Migration: project language (was in-memory only; subtitles Whisper needs correct language hint)
alter table public.projects add column if not exists language text;

-- Migration: free plan default credits 20 → 30
alter table public.profiles alter column credits set default 30;
update public.profiles set credits = 30 where plan = 'free' and credits < 30;

-- Migration: plan_sections for the new Plan step (Step 2, between Topic and Script)
alter table public.projects add column if not exists plan_sections jsonb;

-- Migration: completed_at (first video completion timestamp, retention anchor)
alter table public.projects add column if not exists completed_at timestamptz;
create index if not exists projects_created_at_idx   on public.projects(created_at);
create index if not exists projects_completed_at_idx on public.projects(completed_at);

-- Migration: Sentry webhook deduplication (prevents notification spam for same issue)
create table if not exists public.sentry_alert_dedup (
  issue_id     text        primary key,
  last_sent_at timestamptz not null default now()
);
grant all on public.sentry_alert_dedup to service_role;

-- Migration: subtitle burn-in degradation warnings (run once in Supabase SQL Editor)
alter table public.video_jobs add column if not exists warnings jsonb;

-- Migration: metrics collection (010_metrics_collection.sql)
alter table public.profiles         add column if not exists last_active_at    timestamptz;
alter table public.video_jobs       add column if not exists phase_updated_at  timestamptz;
alter table public.credit_transactions add column if not exists payment_amount   numeric;
alter table public.credit_transactions add column if not exists payment_currency text;

create index if not exists credit_transactions_created_at_idx on public.credit_transactions (created_at);
create index if not exists credit_transactions_operation_idx  on public.credit_transactions (operation);
create index if not exists video_jobs_status_idx              on public.video_jobs (status);

-- ─────────────────────────────────────────
-- Async image generation jobs
-- Mirrors video_jobs / audio_jobs pattern.
-- Managed by video-server (Railway).
-- ─────────────────────────────────────────

create table if not exists public.image_jobs (
  id                  uuid        default gen_random_uuid() primary key,
  project_id          uuid        references public.projects(id) on delete set null,
  user_id             uuid        not null,
  engine              text        not null default 'secretslider',
  status              text        not null default 'pending'
                        check (status in ('pending', 'processing', 'finalizing', 'completed', 'failed', 'awaiting_webhook')),
  progress            integer     not null default 0,
  script              text,
  topic               text,
  duration_sec        integer,
  image_count         integer     not null,
  image_interval      integer     not null default 10,
  image_style         text,
  custom_style        text,
  scene_images        jsonb,
  credits_charged     integer     not null default 0,
  cost_per_image      integer     not null default 0,
  credits_refunded_at timestamptz,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists image_jobs_status_idx      on public.image_jobs (status);
create index if not exists image_jobs_user_id_idx     on public.image_jobs (user_id);
create index if not exists image_jobs_project_id_idx  on public.image_jobs (project_id);
create index if not exists image_jobs_created_at_idx  on public.image_jobs (created_at);

grant all on public.image_jobs to service_role;

-- Migration: finalization_claimed_at — DB-atomic claim (replaces in-memory Map).
-- Claimed by webhook handler or poll loop via PATCH WHERE finalization_claimed_at IS NULL.
-- Run in Supabase SQL Editor:
--   ALTER TABLE public.image_jobs
--     ADD COLUMN IF NOT EXISTS finalization_claimed_at timestamptz;
alter table public.image_jobs
  add column if not exists finalization_claimed_at timestamptz;

-- Migration: SS webhook event dedup table (replaces ssProcessedEventIds in-memory Map).
-- INSERT ON CONFLICT DO NOTHING; rows with event_id already present are duplicates.
-- Run in Supabase SQL Editor:
create table if not exists public.ss_processed_events (
  event_id     text        primary key,
  processed_at timestamptz not null default now()
);
create index if not exists ss_processed_events_at_idx on public.ss_processed_events (processed_at);
grant all on public.ss_processed_events to service_role;

-- Migration: add awaiting_webhook to image_jobs status check constraint.
-- Required for the poll-timeout fallback path: processImageJob sets this status when
-- IMAGES_ASYNC_POLL_MAX_MIN is exceeded but the SS task is still running; the webhook
-- handler finalises when the real webhook arrives (up to WATCHDOG_IMAGES_TIMEOUT_MIN).
-- Run in Supabase SQL Editor:
alter table public.image_jobs
  drop constraint if exists image_jobs_status_check;
alter table public.image_jobs
  add constraint image_jobs_status_check
    check (status in ('pending', 'processing', 'finalizing', 'completed', 'failed', 'awaiting_webhook'));
