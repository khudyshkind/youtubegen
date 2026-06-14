/**
 * Run Supabase migrations via Management API.
 *
 * Setup:
 *   1. Get personal access token: https://supabase.com/dashboard/account/tokens
 *   2. Add to .env.local:
 *        SUPABASE_ACCESS_TOKEN=sbp_xxxxxx
 *        NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   3. node scripts/migrate.mjs
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// Load .env.local manually (no dotenv dependency needed)
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
const envVars = {}
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const stripped = line.replace(/^﻿/, '').trim()
    if (!stripped || stripped.startsWith('#')) continue
    const eq = stripped.indexOf('=')
    if (eq === -1) continue
    const k = stripped.slice(0, eq).trim()
    const v = stripped.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    envVars[k] = v
  }
} catch {
  console.error('Could not read .env.local — make sure it exists')
  process.exit(1)
}

const token = envVars['SUPABASE_ACCESS_TOKEN'] || process.env.SUPABASE_ACCESS_TOKEN
const url   = envVars['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL

if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN in .env.local')
  console.error('Get it at: https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}
if (!url) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local')
  process.exit(1)
}

// Extract project ref from URL: https://abcdef.supabase.co -> abcdef
const match = url.match(/https?:\/\/([^.]+)\.supabase\.co/)
if (!match) {
  console.error('Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL:', url)
  process.exit(1)
}
const projectRef = match[1]
console.log('Project ref:', projectRef)

const MIGRATIONS = [
  {
    name: 'add paddle_customer_id to profiles',
    sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paddle_customer_id text UNIQUE;',
  },
  {
    name: 'add paddle_subscription_id to profiles',
    sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paddle_subscription_id text UNIQUE;',
  },
  {
    name: 'add is_admin to profiles',
    sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;',
  },
  {
    name: 'add referral_code to profiles',
    sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;',
  },
  {
    name: 'add referred_by to profiles',
    sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by text;',
  },
  {
    name: 'add referral_count to profiles',
    sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_count integer NOT NULL DEFAULT 0;',
  },
  {
    name: 'add referral_credits_earned to profiles',
    sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_credits_earned integer NOT NULL DEFAULT 0;',
  },
  {
    name: 'create analytics_events table',
    sql: `
      CREATE TABLE IF NOT EXISTS public.analytics_events (
        id          uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id     uuid        REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
        event       text        NOT NULL,
        properties  jsonb       NOT NULL DEFAULT '{}',
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx ON public.analytics_events(user_id);
      CREATE INDEX IF NOT EXISTS analytics_events_event_idx   ON public.analytics_events(event);
    `.trim(),
  },
  {
    name: 'enable RLS on analytics_events',
    sql: `
      ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.analytics_events TO authenticated;
    `.trim(),
  },
]

async function runQuery(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  )
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { ok: res.ok, status: res.status, body: json }
}

async function main() {
  console.log(`\nRunning ${MIGRATIONS.length} migrations...\n`)

  for (const m of MIGRATIONS) {
    process.stdout.write(`  • ${m.name} ... `)
    const { ok, status, body } = await runQuery(m.sql)
    if (ok) {
      console.log('✓')
    } else {
      const msg = body?.message || body?.error || JSON.stringify(body)
      // "already exists" errors are safe to ignore
      if (msg?.toLowerCase().includes('already exists') || msg?.toLowerCase().includes('duplicate')) {
        console.log('✓ (already exists)')
      } else {
        console.log(`✗ [${status}] ${msg}`)
      }
    }
  }

  console.log('\nDone.\n')
}

main().catch((err) => { console.error(err); process.exit(1) })
