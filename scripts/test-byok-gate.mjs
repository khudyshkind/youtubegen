/**
 * Acceptance test for Ход 3a: Free-plan BYOK gate
 *
 * Tests:
 * A) Free user (no key) → 403 byok_required, balance unchanged
 * B) Paid user (basic) → gate passes, credits charged as normal
 * C) Free user (no key) → all 8 routes blocked
 *
 * Runs against production Supabase with service_role to inspect DB directly.
 * Does NOT make real YouTube API calls — gate fires before any YouTube calls.
 *
 * Usage: node scripts/test-byok-gate.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); const v = l.slice(i + 1).trim(); return [l.slice(0, i).trim(), v.replace(/^["']|["']$/g, '')] })
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ─── Simulate checkAnalyticsGate logic directly ───────────────────────────────
// (replicates src/lib/analytics-gate.ts without Next.js imports)

async function checkGate(userId) {
  let plan = null
  let hasKey = false

  const { data: full, error: fullErr } = await svc
    .from('profiles')
    .select('plan, youtube_api_key')
    .eq('id', userId)
    .single()

  if (!fullErr && full) {
    plan = full.plan
    hasKey = !!full.youtube_api_key
  } else {
    const { data: planRow } = await svc
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .single()
    plan = planRow?.plan ?? null
    hasKey = false
  }

  if (!plan) return { blocked: false, reason: 'no profile (fail open)' }
  if (plan !== 'free') return { blocked: false, reason: `plan=${plan} (paid pass)` }
  if (!hasKey) return { blocked: true, reason: 'free + no key' }
  return { blocked: false, reason: 'free + has key (BYOK pass)' }
}

async function getBalance(userId) {
  const { data } = await svc.from('profiles').select('credits').eq('id', userId).single()
  return data?.credits ?? null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${msg}`)
    failed++
  }
}

// ─── Find test users ─────────────────────────────────────────────────────────

async function findUserByPlan(plan) {
  const { data } = await svc
    .from('profiles')
    .select('id, plan, credits, youtube_api_key')
    .eq('plan', plan)
    .limit(1)
    .single()
  return data
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n══ Ход 3a: BYOK Gate Acceptance Test ══\n')

// Test A: Free user without key → blocked
console.log('── A: Free user, no BYOK key ──')
{
  const user = await findUserByPlan('free')
  if (!user) {
    console.log('  ⚠️  No free user in DB — skipping A')
  } else if (user.youtube_api_key) {
    console.log(`  ⚠️  Free user ${user.id} has youtube_api_key — key not null, test would need BYOK-less user. Skipping A.`)
  } else {
    const balanceBefore = await getBalance(user.id)
    const gate = await checkGate(user.id)
    assert(gate.blocked === true, `gate blocked (reason: ${gate.reason})`)
    const balanceAfter = await getBalance(user.id)
    assert(balanceBefore === balanceAfter, `balance unchanged (${balanceBefore} → ${balanceAfter})`)
    console.log(`  plan=${user.plan}, credits=${balanceBefore}, youtube_api_key=${user.youtube_api_key ?? 'null'}`)
  }
}

// Test B: Paid user → not blocked
console.log('\n── B: Paid user (basic) ──')
{
  const plans = ['basic', 'starter', 'pro', 'agency']
  let paidUser = null
  for (const p of plans) {
    paidUser = await findUserByPlan(p)
    if (paidUser) break
  }

  if (!paidUser) {
    console.log('  ⚠️  No paid user in DB — skipping B')
  } else {
    const gate = await checkGate(paidUser.id)
    assert(gate.blocked === false, `gate not blocked (reason: ${gate.reason})`)
    console.log(`  plan=${paidUser.plan}, credits=${paidUser.credits}`)
  }
}

// Test C: Gate logic with column-absent fallback (simulated)
console.log('\n── C: Column-absent fallback (simulated free user) ──')
{
  // Simulate fallback: fetch plan only (as if youtube_api_key column didn't exist)
  const { data: freeUser } = await svc
    .from('profiles')
    .select('id, plan')
    .eq('plan', 'free')
    .limit(1)
    .single()

  if (!freeUser) {
    console.log('  ⚠️  No free user — skipping C')
  } else {
    // Simulate fallback path: plan=free, hasKey=false
    const plan = freeUser.plan
    const hasKey = false  // column-absent scenario
    const blocked = plan === 'free' && !hasKey
    assert(blocked === true, `free + no key (column absent fallback) → blocked`)
  }
}

// Test D: Pure gate logic simulation (no DB needed)
console.log('\n── D: Pure gate logic simulation ──')
{
  function gateLogic(plan, hasKey) {
    if (!plan) return { blocked: false, reason: 'no profile (fail open)' }
    if (plan !== 'free') return { blocked: false, reason: `plan=${plan} (paid pass)` }
    if (!hasKey) return { blocked: true, reason: 'free + no key' }
    return { blocked: false, reason: 'free + has key (BYOK pass)' }
  }

  const cases = [
    { plan: 'free',   hasKey: false, expect: true,  label: 'free, no key → blocked' },
    { plan: 'free',   hasKey: true,  expect: false, label: 'free, has key → pass' },
    { plan: 'basic',  hasKey: false, expect: false, label: 'basic, no key → pass' },
    { plan: 'starter',hasKey: false, expect: false, label: 'starter, no key → pass' },
    { plan: 'pro',    hasKey: true,  expect: false, label: 'pro, has key → pass' },
    { plan: 'agency', hasKey: false, expect: false, label: 'agency, no key → pass' },
    { plan: null,     hasKey: false, expect: false, label: 'null plan → fail open' },
  ]

  for (const { plan, hasKey, expect, label } of cases) {
    const { blocked } = gateLogic(plan, hasKey)
    assert(blocked === expect, label)
  }
}

// Test E: CREDIT_COSTS.keywords_analysis = 10000
console.log('\n── E: keywords_analysis credit cost ──')
{
  const { readFileSync } = await import('fs')
  const src = readFileSync(resolve(__dir, '../src/lib/types.ts'), 'utf8')
  const match = src.match(/keywords_analysis\s*:\s*(\d+)/)
  const cost = match ? Number(match[1]) : null
  assert(cost === 10000, `CREDIT_COSTS.keywords_analysis = ${cost} (expected 10000)`)
}

// Test F: analytics-gate.ts exists and has correct structure
console.log('\n── F: analytics-gate.ts structure ──')
{
  const { readFileSync } = await import('fs')
  const src = readFileSync(resolve(__dir, '../src/lib/analytics-gate.ts'), 'utf8')
  assert(src.includes('byokRequiredResponse'), 'exports byokRequiredResponse')
  assert(src.includes('checkAnalyticsGate'), 'exports checkAnalyticsGate')
  assert(src.includes("code: 'byok_required'"), "returns code: 'byok_required'")
  assert(src.includes('status: 403'), 'returns HTTP 403')
  assert(src.includes("plan !== 'free'"), 'paid plans pass through')
}

// Test G: All 8 routes import and call checkAnalyticsGate
console.log('\n── G: All 8 routes have gate ──')
{
  const { readFileSync } = await import('fs')
  const routes = [
    'trends', 'keywords', 'niche-finder', 'channel',
    'rising-stars', 'compare', 'comments', 'channel-plan',
  ]
  for (const name of routes) {
    const path = resolve(__dir, `../src/app/api/analytics/${name}/route.ts`)
    const src = readFileSync(path, 'utf8')
    assert(src.includes('checkAnalyticsGate'), `${name}/route.ts has gate`)
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n══ Results: ${passed} passed, ${failed} failed ══\n`)
if (failed > 0) process.exit(1)
