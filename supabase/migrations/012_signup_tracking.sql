-- Add signup tracking columns to profiles.
-- All columns are nullable — their absence never blocks registration.
-- Run in Supabase SQL Editor (service_role) after deploying the application changes.
alter table public.profiles
  add column if not exists signup_ip         text,
  add column if not exists signup_user_agent text,
  add column if not exists signup_country    text,
  add column if not exists signup_city       text,
  add column if not exists utm_source        text,
  add column if not exists utm_medium        text,
  add column if not exists utm_campaign      text;
