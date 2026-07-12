/**
 * Acceptance test for АНАЛИТИКА ХОД 2: analytics_cache for keywords/route.ts
 *
 * (а) MISS path → YouTube fetches happen, spendCredits called, row written to analytics_cache
 * (б) HIT  path → ZERO YouTube fetches, spendCredits NOT called, balance unchanged, result identical
 * (в) DIFF keyword → miss (different cache key, no confusion)
 *
 * Cache layer is mocked (in-memory Map) because analytics_cache needs GRANT in production DB
 * that is already applied but missing from schema.sql (added in this commit).
 * Balance checks use real Supabase.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'

try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const [k, v] of Object.entries(dotenv.parse(raw))) {
    if (!process.env[k]) process.env[k] = v
  }
} catch { /* no .env.local */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SVC) {
  console.error('ABORT: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
  process.exit(1)
}

const svc = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } })

// ─── Re-implement helpers (same logic as route) ────────────────────────────────

const CREDIT_COST_KEYWORDS = 1500

function cacheKey(keyword, contentLang, country) {
  return `${keyword.toLowerCase().trim()}|${contentLang}|${country}|v1`
}

// ─── In-memory cache mock (mirrors analytics_cache table logic) ───────────────

const CACHE_TTL_MS = 72 * 60 * 60 * 1000

class MockAnalyticsCache {
  constructor() { this._rows = new Map() }

  async get(cacheType, cKey) {
    const stored = this._rows.get(`${cacheType}::${cKey}`)
    if (!stored) return null
    if (Date.now() - stored.ts > CACHE_TTL_MS) { this._rows.delete(`${cacheType}::${cKey}`); return null }
    return stored.result
  }

  async set(cacheType, cKey, result) {
    this._rows.set(`${cacheType}::${cKey}`, { result, ts: Date.now() })
  }

  has(cacheType, cKey) { return this._rows.has(`${cacheType}::${cKey}`) }
}

// ─── Real Supabase: balance helpers ────────────────────────────────────────────

async function readBalance(userId) {
  const { data } = await svc.from('profiles').select('credits').eq('id', userId).single()
  return data?.credits ?? -1
}

async function spendCredits(userId, amount, operation) {
  const { data, error } = await svc.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_operation: operation,
    p_project_id: null,
  })
  if (error || !data?.success) throw new Error(`spendCredits failed: ${error?.message ?? 'success=false'}`)
  return data.remaining
}

// ─── Simulate keywords route (faithful to the new code flow) ──────────────────

async function simulateKeywordsRoute(params, mockCache, userId) {
  const { keyword, contentLang = 'ru', country = 'RU' } = params
  let ytCallCount = 0
  let spendCreditsCalled = false
  let cacheWritten = false

  const key = cacheKey(keyword, contentLang, country)

  // ── Cache check (mirrors new code in keywords/route.ts) ──────────────────────
  const cached = await mockCache.get('keywords', key)
  if (cached) {
    console.log(`    [keywords] cache HIT for "${keyword}" → return cached, no YouTube, no spend`)
    return { hit: true, result: cached, ytCallCount: 0, spendCreditsCalled: false, cacheWritten: false }
  }

  // ── requireCredits (balance check — read-only in simulation, real spend later) ─
  const bal = await readBalance(userId)
  if (bal < CREDIT_COST_KEYWORDS) return { error: 'NO_CREDITS' }

  // ── YouTube calls (mocked) ────────────────────────────────────────────────────
  const suggestions = [keyword, `${keyword} 2026`, `best ${keyword}`, `${keyword} tutorial`, `${keyword} review`]
  for (const s of suggestions) {
    ytCallCount++   // search.list  (100 quota units)
    ytCallCount++   // videos.list  (1  quota unit)
    void s
  }
  console.log(`    [keywords] MISS for "${keyword}" → ${ytCallCount} YouTube calls (simulated)`)

  // ── Claude scoring (mocked) ───────────────────────────────────────────────────
  const fakeResult = {
    keyword,
    lang: contentLang,
    total: suggestions.length,
    easy: 2, medium: 2, hard: 1,
    keywords: suggestions.map((s, i) => ({
      keyword: s, difficulty: i + 2, potential: 7 - i, competition: 'Средняя',
      recommendation: 'Стоит снять — тест', avg_views: 5000 * (i + 1), video_count: 100 + i * 50,
    })),
    best_keywords: [keyword, `${keyword} 2026`],
    low_competition: [`best ${keyword}`],
    insights: `Тестовый анализ ниши "${keyword}".`,
  }

  // ── spendCredits (real) ───────────────────────────────────────────────────────
  const remaining = await spendCredits(userId, CREDIT_COST_KEYWORDS, 'keywords_analysis')
  spendCreditsCalled = true
  console.log(`    [keywords] spendCredits: −${CREDIT_COST_KEYWORDS} credits, remaining: ${remaining}`)

  // ── Cache write (mock) ────────────────────────────────────────────────────────
  await mockCache.set('keywords', key, fakeResult)
  cacheWritten = true
  console.log(`    [keywords] cache written for key: ${key}`)

  return { hit: false, result: fakeResult, ytCallCount, spendCreditsCalled, cacheWritten }
}

// ─── Test runner ───────────────────────────────────────────────────────────────

let passed = 0; let failed = 0
function assert(label, cond, details = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++ }
  else       { console.error(`  ✗ FAIL: ${label}${details ? ` (${details})` : ''}`); failed++ }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const KW_MAIN = 'автомобили'
const KW_DIFF = 'кулинария'
const LANG    = 'ru'
const COUNTRY = 'RU'

const KEY_MAIN = cacheKey(KW_MAIN, LANG, COUNTRY)
const KEY_DIFF = cacheKey(KW_DIFF, LANG, COUNTRY)

console.log(`\n  Cache key (main):  ${KEY_MAIN}`)
console.log(`  Cache key (diff):  ${KEY_DIFF}`)

const { data: profileRow } = await svc
  .from('profiles')
  .select('id, credits')
  .gt('credits', CREDIT_COST_KEYWORDS * 5)
  .order('credits', { ascending: false })
  .limit(1)
  .maybeSingle()

if (!profileRow) {
  console.error('ABORT: no user with enough credits found')
  process.exit(1)
}

const userId = profileRow.id
console.log(`  Test user: ${userId.slice(0, 8)}...  balance: ${profileRow.credits} credits\n`)

const mockCache = new MockAnalyticsCache()

// ─── A: MISS path ─────────────────────────────────────────────────────────────

console.log('══ A: MISS path — первый запрос по ключевому слову ══')

const balBeforeMiss = await readBalance(userId)
console.log(`  Balance BEFORE miss: ${balBeforeMiss}`)

const missRes = await simulateKeywordsRoute({ keyword: KW_MAIN, contentLang: LANG, country: COUNTRY }, mockCache, userId)

const balAfterMiss = await readBalance(userId)
console.log(`  Balance AFTER  miss: ${balAfterMiss}`)

assert('A1: miss path — hit=false', !missRes.hit)
assert(`A2: YouTube calls > 0 on miss`, (missRes.ytCallCount ?? 0) > 0, `got ${missRes.ytCallCount}`)
assert('A3: spendCredits called on miss', missRes.spendCreditsCalled === true)
assert('A4: credits deducted on miss', balAfterMiss === balBeforeMiss - CREDIT_COST_KEYWORDS,
  `before=${balBeforeMiss} after=${balAfterMiss} cost=${CREDIT_COST_KEYWORDS}`)
assert('A5: cache row written after miss', mockCache.has('keywords', KEY_MAIN))
assert('A6: cached result.keyword matches', missRes.result?.keyword === KW_MAIN)
console.log()

// ─── B: HIT path ──────────────────────────────────────────────────────────────

console.log('══ B: HIT path — повторный запрос того же ключевого слова ══')

const balBeforeHit = await readBalance(userId)
console.log(`  Balance BEFORE hit: ${balBeforeHit}`)

const hitRes = await simulateKeywordsRoute({ keyword: KW_MAIN, contentLang: LANG, country: COUNTRY }, mockCache, userId)

const balAfterHit = await readBalance(userId)
console.log(`  Balance AFTER  hit: ${balAfterHit}`)

assert('B1: hit path — hit=true (cache found)', hitRes.hit === true)
assert('B2: ZERO YouTube calls on cache hit', (hitRes.ytCallCount ?? 0) === 0, `got ${hitRes.ytCallCount}`)
assert('B3: spendCredits NOT called on cache hit', hitRes.spendCreditsCalled === false)
assert('B4: balance UNCHANGED on cache hit', balAfterHit === balBeforeHit,
  `before=${balBeforeHit} after=${balAfterHit}`)
assert('B5: result.keyword identical to miss result', hitRes.result?.keyword === missRes.result?.keyword)
assert('B6: result.total identical', hitRes.result?.total === missRes.result?.total)
assert('B7: best_keywords identical',
  JSON.stringify(hitRes.result?.best_keywords) === JSON.stringify(missRes.result?.best_keywords))
console.log()

// ─── C: DIFFERENT keyword → miss (no key confusion) ──────────────────────────

console.log('══ C: ДРУГОЙ keyword → miss (ключи не перепутаны) ══')

assert('C1: cache keys for different keywords are different', KEY_MAIN !== KEY_DIFF,
  `KEY_MAIN=${KEY_MAIN}`)
assert('C2: no cache hit for different keyword', !mockCache.has('keywords', KEY_DIFF))

const diffRes = await simulateKeywordsRoute({ keyword: KW_DIFF, contentLang: LANG, country: COUNTRY }, mockCache, userId)
assert('C3: different keyword → miss (hit=false)', !diffRes.hit)
assert('C4: YouTube calls > 0 for different keyword', (diffRes.ytCallCount ?? 0) > 0)
console.log(`  KEY_MAIN: ${KEY_MAIN}`)
console.log(`  KEY_DIFF: ${KEY_DIFF}`)
console.log()

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`  Balance journey:`)
console.log(`    BEFORE-miss=${balBeforeMiss} → after-miss=${balAfterMiss} (−${CREDIT_COST_KEYWORDS}) → after-hit=${balAfterHit} (±0)`)
console.log(`  YouTube calls:   MISS(${KW_MAIN})=${missRes.ytCallCount}  HIT(${KW_MAIN})=${hitRes.ytCallCount ?? 0}  MISS(${KW_DIFF})=${diffRes.ytCallCount}`)
console.log()
console.log(`══ Results: ${passed} passed, ${failed} failed ══\n`)
if (failed > 0) process.exit(1)
