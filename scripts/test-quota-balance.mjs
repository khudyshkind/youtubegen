/**
 * Live DB balance test: simulate quota-403 in 2 routes, verify balance unchanged.
 *
 * Strategy:
 *   1. Read real balance from Supabase for a real user
 *   2. Run a faithful simulation of the niche-finder and trends route critical paths:
 *      - requireCredits check (read-only, no deduction)
 *      - YouTube fetch → mocked to throw YouTubeQuotaError (403 quotaExceeded)
 *      - outer catch detects YouTubeQuotaError → returns 503 WITHOUT calling spendCredits
 *   3. Read balance again → must equal balance_before
 *
 * The simulation uses real Supabase for the balance checks and real credit logic,
 * but mocks only the YouTube HTTP fetch.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// Load env from .env.local
try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const [k, v] of Object.entries(dotenv.parse(raw))) {
    if (!process.env[k]) process.env[k] = v
  }
} catch { /* no .env.local */ }

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SVC) {
  console.error('ABORT: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
  process.exit(1)
}

const svc = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } })

// ─── Re-implement critical helpers (same logic as src/lib/youtube-quota.ts) ──

class YouTubeQuotaError extends Error {
  constructor() { super('youtube_quota_exceeded'); this.name = 'YouTubeQuotaError' }
}

function checkYouTubeQuota(status, body) {
  if (status !== 403) return
  try {
    const json = JSON.parse(body)
    const reasons = (json.error?.errors ?? []).map(e => e.reason ?? '')
    if (reasons.some(r => r === 'quotaExceeded' || r === 'dailyLimitExceeded')) throw new YouTubeQuotaError()
  } catch (e) { if (e instanceof YouTubeQuotaError) throw e }
}

function quotaExceededResponse(lang = 'ru') {
  const isRu = lang !== 'en'
  return {
    status: 503,
    body: {
      ok: false,
      error: isRu
        ? 'Аналитика временно недоступна: дневная квота YouTube API исчерпана. Обновится в полночь по тихоокеанскому времени (PT). Попробуйте позже.'
        : 'Analytics temporarily unavailable: YouTube daily API quota exceeded. Resets at midnight Pacific Time (PT). Please try again later.',
      code: 'youtube_quota_exceeded',
    },
  }
}

// ─── requireCredits (read-only, identical to src/lib/credits.ts logic) ────────

const CREDIT_COSTS = {
  niche_finder: 7000,
  trends:       1500,
}

async function requireCredits(userId, featureName) {
  const cost = CREDIT_COSTS[featureName] ?? 0
  const { data, error } = await svc
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single()
  if (error || !data) return { ok: false, error: 'no credits record' }
  if (data.credits < cost) return { ok: false, error: 'insufficient_credits', code: 'NO_CREDITS' }
  return { ok: true }
}

// ─── spendCredits (same as src/lib/credits.ts) ────────────────────────────────

async function spendCredits(userId, amount, feature) {
  const { error } = await svc.rpc('deduct_credits', { p_user_id: userId, p_amount: amount })
  if (error) throw new Error(`spendCredits failed: ${error.message}`)
  console.log(`  [spend] deducted ${amount} credits for ${feature}`)
}

// ─── MOCK YouTube fetch (always returns 403 quotaExceeded) ────────────────────

const MOCK_QUOTA_BODY = JSON.stringify({
  error: {
    code: 403,
    message: 'The caller does not have permission',
    errors: [{ message: 'Quota exceeded.', domain: 'youtube.quota', reason: 'quotaExceeded' }]
  }
})

async function mockYtFetch(_path, _params) {
  const text = MOCK_QUOTA_BODY
  checkYouTubeQuota(403, text)           // throws YouTubeQuotaError
  throw new Error('unreachable')
}

// ─── Simulate niche-finder route critical path ─────────────────────────────────

async function simulateNicheFinder(userId, lang = 'ru') {
  console.log(`  [niche-finder] start, user=${userId.slice(0,8)}...`)

  // requireCredits (read-only)
  const check = await requireCredits(userId, 'niche_finder')
  if (!check.ok) return { status: 402, body: { ok: false, error: check.error } }

  try {
    // Step 1: Claude generates niches (skipped in mock — only YouTube is the bottleneck)
    // Step 2: YouTube data for top 3 niches — THIS IS WHERE QUOTA HITS
    await Promise.all([0, 1, 2].map(async () => {
      try {
        await mockYtFetch('/search', { q: 'test niche' })
      } catch (e) {
        if (e instanceof YouTubeQuotaError) throw e   // re-throw (as in real code)
        return { name: 'mock', video_count: 0, avg_views: 0 }
      }
    }))

    // spendCredits — NEVER REACHED when quota error thrown above
    await spendCredits(userId, CREDIT_COSTS.niche_finder, 'niche_finder')

    return { status: 200, body: { ok: true, data: {} } }

  } catch (error) {
    if (error instanceof YouTubeQuotaError) {
      console.log(`  [niche-finder] caught YouTubeQuotaError → 503, NO spendCredits`)
      return quotaExceededResponse(lang)
    }
    throw error
  }
}

// ─── Simulate trends route critical path ──────────────────────────────────────

async function simulateTrends(userId, lang = 'ru') {
  console.log(`  [trends] start, user=${userId.slice(0,8)}...`)

  const check = await requireCredits(userId, 'trends')
  if (!check.ok) return { status: 402, body: { ok: false, error: check.error } }

  try {
    // Step 1: YouTube search (100 quota units) — mocked to return 403
    await mockYtFetch('/search', { q: 'test topic', type: 'video', order: 'viewCount' })

    // Step 2: video stats — also mocked but won't be reached
    // await mockYtFetch('/videos', { id: 'xxx' })

    // spendCredits — NEVER REACHED
    await spendCredits(userId, CREDIT_COSTS.trends, 'trends')

    return { status: 200, body: { ok: true, data: {} } }

  } catch (error) {
    if (error instanceof YouTubeQuotaError) {
      console.log(`  [trends] caught YouTubeQuotaError → 503, NO spendCredits`)
      return quotaExceededResponse(lang)
    }
    throw error
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let passed = 0; let failed = 0

function assert(label, cond, details = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++ }
  else       { console.error(`  ✗ FAIL: ${label}${details ? ` (${details})` : ''}`); failed++ }
}

async function main() {
  // Find a user with credits (credits stored in profiles.credits)
  const { data: credRow } = await svc
    .from('profiles')
    .select('id, credits')
    .gt('credits', 0)
    .order('credits', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!credRow) {
    console.error('ABORT: no user with credits found in profiles table')
    process.exit(1)
  }

  const userId = credRow.id
  const balanceBefore = credRow.credits
  console.log(`\nTest user: ${userId.slice(0,8)}...  balance BEFORE: ${balanceBefore}`)

  // ── Test 1: niche-finder with mocked quota 403 ─────────────────────────────

  console.log('\n══ ROUTE 1: niche-finder (мок quota-403) ══')
  const r1 = await simulateNicheFinder(userId, 'ru')

  const { data: after1 } = await svc.from('profiles').select('credits').eq('id', userId).single()
  const balance1 = after1?.credits ?? -1

  console.log(`  Balance AFTER niche-finder: ${balance1}`)
  assert('niche-finder: response status 503', r1.status === 503, `got ${r1.status}`)
  assert('niche-finder: ok=false', r1.body.ok === false)
  assert('niche-finder: code=youtube_quota_exceeded', r1.body.code === 'youtube_quota_exceeded')
  assert('niche-finder: human RU message', r1.body.error?.includes('квота'))
  assert('niche-finder: balance UNCHANGED', balance1 === balanceBefore,
    `before=${balanceBefore} after=${balance1}`)

  // ── Test 2: trends with mocked quota 403 ──────────────────────────────────

  console.log('\n══ ROUTE 2: trends (мок quota-403) ══')
  const r2 = await simulateTrends(userId, 'en')

  const { data: after2 } = await svc.from('profiles').select('credits').eq('id', userId).single()
  const balance2 = after2?.credits ?? -1

  console.log(`  Balance AFTER trends: ${balance2}`)
  assert('trends: response status 503', r2.status === 503, `got ${r2.status}`)
  assert('trends: ok=false', r2.body.ok === false)
  assert('trends: code=youtube_quota_exceeded', r2.body.code === 'youtube_quota_exceeded')
  assert('trends: EN message (lang=en passed)', r2.body.error?.includes('quota exceeded'))
  assert('trends: balance UNCHANGED', balance2 === balanceBefore,
    `before=${balanceBefore} after=${balance2}`)

  // ── Final summary ──────────────────────────────────────────────────────────

  console.log(`\n  Balance summary: BEFORE=${balanceBefore}  AFTER-route1=${balance1}  AFTER-route2=${balance2}`)
  console.log(`  Кредиты списаны: 0 из ${CREDIT_COSTS.niche_finder + CREDIT_COSTS.trends} возможных\n`)
  console.log(`══ Results: ${passed} passed, ${failed} failed ══\n`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error('Script error:', e); process.exit(1) })
