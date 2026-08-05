-- 013_tg_link_tokens.sql
-- One-time Telegram deep-link binding tokens.
-- Token is single-use (used_at marks consumption) with a TTL (expires_at).
-- Multiple pending tokens per user are allowed; the API invalidates older ones
-- when issuing a new one, so only the latest link is active.

create table if not exists public.tg_link_tokens (
  token      text        primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists tg_link_tokens_user_id_idx on public.tg_link_tokens(user_id);

-- No anon or user-level access. Only service_role (bot + API routes).
revoke all on public.tg_link_tokens from anon, authenticated;
grant select, insert, update, delete on public.tg_link_tokens to service_role;
