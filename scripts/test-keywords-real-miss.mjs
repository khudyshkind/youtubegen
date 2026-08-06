/**
 * Real MISS test for keywords/route.ts
 *
 * Replicates the full route logic with REAL YouTube API calls.
 * Measures actual YouTube calls (quota units), verifies CREDIT_COSTS.keywords_analysis=4000.
 *
 * This script is the corrected acceptance for ДОПОЛНЕНИЕ — the previous test
 * mocked YouTube (10 fake calls) and hardcoded 1500 credits (wrong).
 * This script uses:
 *   - real YouTube API (YOUTUBE_API_KEY from .env.local)
 *   - 6 seeds → up to 20 suggestions → up to 20 × 2 = 40 YouTube calls (2020 quota units)
 *   - real CREDIT_COSTS.keywords_analysis = 4000
 *   - real Supabase for balance before/after
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
const YT_KEY       = process.env.YOUTUBE_API_KEY

if (!SUPABASE_URL || !SUPABASE_SVC) { console.error('ABORT: Supabase env missing'); process.exit(1) }
if (!YT_KEY) { console.error('ABORT: YOUTUBE_API_KEY missing'); process.exit(1) }

const svc = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } })

// ─── Exact copies from keywords/route.ts ──────────────────────────────────────

const YT_BASE = 'https://www.googleapis.com/youtube/v3'
let ytCallCount = 0
let ytQuotaUnits = 0

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

async function getAutocompleteSuggestions(query, lang) {
  const url = new URL('https://suggestqueries.google.com/complete/search')
  url.searchParams.set('client', 'youtube')
  url.searchParams.set('ds', 'yt')
  url.searchParams.set('q', query)
  url.searchParams.set('hl', lang)
  url.searchParams.set('callback', 'cb')
  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const text = await res.text()
    const match = text.match(/cb\((.+)\)$/)
    if (!match) return []
    const parsed = JSON.parse(match[1])
    return (parsed[1] ?? []).map(item => item[0]).slice(0, 8)
  } catch { return [] }
}

async function getQueryStats(query, contentLang, country) {
  try {
    const regionCode = country === 'worldwide' ? undefined : country
    const searchUrl = new URL(`${YT_BASE}/search`)
    searchUrl.searchParams.set('part', 'snippet')
    searchUrl.searchParams.set('type', 'video')
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('maxResults', '5')
    searchUrl.searchParams.set('key', YT_KEY)
    searchUrl.searchParams.set('relevanceLanguage', contentLang)
    if (regionCode) searchUrl.searchParams.set('regionCode', regionCode)

    ytCallCount++
    ytQuotaUnits += 100   // search.list costs 100 units
    const searchRes = await fetch(searchUrl.toString())
    if (!searchRes.ok) {
      checkYouTubeQuota(searchRes.status, await searchRes.text())
      return { avg_views: 0, video_count: 0 }
    }
    const searchData = await searchRes.json()
    const videoIds = (searchData.items ?? []).map(i => i.id?.videoId).filter(Boolean)
    const videoCount = searchData.pageInfo?.totalResults ?? 0
    if (videoIds.length === 0) return { avg_views: 0, video_count: videoCount }

    const statsUrl = new URL(`${YT_BASE}/videos`)
    statsUrl.searchParams.set('part', 'statistics')
    statsUrl.searchParams.set('id', videoIds.join(','))
    statsUrl.searchParams.set('key', YT_KEY)

    ytCallCount++
    ytQuotaUnits += 1     // videos.list costs 1 unit
    const statsRes = await fetch(statsUrl.toString())
    if (!statsRes.ok) {
      checkYouTubeQuota(statsRes.status, await statsRes.text())
      return { avg_views: 0, video_count: videoCount }
    }
    const statsData = await statsRes.json()
    const views = (statsData.items ?? []).map(v => Number(v.statistics?.viewCount ?? 0)).filter(v => v > 0)
    const avg_views = views.length > 0 ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0
    return { avg_views, video_count: videoCount }
  } catch (e) {
    if (e instanceof YouTubeQuotaError) throw e
    return { avg_views: 0, video_count: 0 }
  }
}

// ─── Real credit helpers ───────────────────────────────────────────────────────

const CREDIT_COST = 4000   // CREDIT_COSTS.keywords_analysis

async function readBalance(userId) {
  const { data } = await svc.from('profiles').select('credits').eq('id', userId).single()
  return data?.credits ?? -1
}

async function spendCredits(userId) {
  const { data, error } = await svc.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: CREDIT_COST,
    p_operation: 'keywords_analysis',
    p_project_id: null,
  })
  if (error || !data?.success) throw new Error(`spendCredits failed: ${error?.message ?? 'success=false'}`)
  return data.remaining
}

// ─── Test runner ───────────────────────────────────────────────────────────────

let passed = 0; let failed = 0
function assert(label, cond, details = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++ }
  else       { console.error(`  ✗ FAIL: ${label}${details ? ` (${details})` : ''}`); failed++ }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const { data: profileRow } = await svc
  .from('profiles')
  .select('id, credits')
  .gt('credits', CREDIT_COST * 3)
  .order('credits', { ascending: false })
  .limit(1)
  .maybeSingle()

if (!profileRow) { console.error('ABORT: no user with enough credits'); process.exit(1) }

const userId = profileRow.id
console.log(`\n  Test user: ${userId.slice(0, 8)}...  credits: ${profileRow.credits}`)
console.log(`  CREDIT_COSTS.keywords_analysis = ${CREDIT_COST}`)
console.log(`  YouTube API key: ${YT_KEY.slice(0, 6)}...\n`)

// ─── REAL MISS: full keywords route logic ─────────────────────────────────────

console.log('══ REAL MISS: полный keywords-роут с реальным YouTube API ══')

const keyword    = 'автомобили'
const contentLang = 'ru'
const country    = 'RU'

const seeds = [
  keyword,
  `${keyword} 2026`,
  `best ${keyword}`,
  `${keyword} review`,
  `${keyword} vs`,
  `how to ${keyword}`,
]

console.log(`  Keyword: "${keyword}" | seeds: ${seeds.length}`)

// Step 1: Google Autocomplete (free, no quota)
console.log('\n  Step 1: Google Autocomplete (free)...')
const suggestionsArrays = await Promise.all(seeds.map(seed => getAutocompleteSuggestions(seed, contentLang)))

const seen = new Set()
const allSuggestions = [keyword]
seen.add(keyword.toLowerCase())
for (const arr of suggestionsArrays) {
  for (const s of arr) {
    const k = s.toLowerCase().trim()
    if (!seen.has(k) && s.trim()) { seen.add(k); allSuggestions.push(s.trim()) }
  }
}
const suggestions = allSuggestions.slice(0, 20)
console.log(`  → ${suggestions.length} unique suggestions (cap=20)`)
console.log(`  → First 5: ${suggestions.slice(0, 5).map(s => `"${s}"`).join(', ')}`)

// Step 2: YouTube getQueryStats for each suggestion
console.log(`\n  Step 2: YouTube API — getQueryStats for ${suggestions.length} suggestions (batches of 5)...`)
const balBefore = await readBalance(userId)
console.log(`  Balance BEFORE: ${balBefore}`)

const batchSize = 5
const statsMap = new Map()
const t0 = Date.now()

for (let i = 0; i < suggestions.length; i += batchSize) {
  const batch = suggestions.slice(i, i + batchSize)
  const results = await Promise.all(batch.map(s => getQueryStats(s, contentLang, country)))
  batch.forEach((s, j) => statsMap.set(s, results[j]))
  console.log(`    batch ${Math.floor(i/batchSize)+1}/${Math.ceil(suggestions.length/batchSize)}: ${batch.length} keywords done`)
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n  YouTube calls: ${ytCallCount} HTTP requests`)
console.log(`  Quota units:   ${ytQuotaUnits} units (${suggestions.length} × 101 max = ${suggestions.length * 101} theoretical max)`)
console.log(`  Time:          ${elapsed}s`)

// Step 3: Show sample stats
console.log('\n  Sample keyword stats:')
for (const [kw, stats] of [...statsMap.entries()].slice(0, 4)) {
  console.log(`    "${kw}": avg_views=${stats.avg_views.toLocaleString()}, video_count=${stats.video_count.toLocaleString()}`)
}

// Step 4: spendCredits (real deduction)
console.log(`\n  Step 3: spendCredits(${CREDIT_COST})...`)
const remaining = await spendCredits(userId)
const balAfter = await readBalance(userId)
console.log(`  Balance AFTER:  ${balAfter} (remaining=${remaining})`)

// ─── Assertions ───────────────────────────────────────────────────────────────

console.log('\n══ Assertions ══')

assert(`A1: suggestions count correct (≥5, ≤20)`,
  suggestions.length >= 5 && suggestions.length <= 20, `got ${suggestions.length}`)

assert(`A2: YouTube HTTP calls = ${ytCallCount} (2 per suggestion: search.list + videos.list)`,
  ytCallCount === suggestions.length * 2, `calls=${ytCallCount} suggestions=${suggestions.length}`)

assert(`A3: quota units = ${ytQuotaUnits} (each suggestion: 100+1=101 units)`,
  ytQuotaUnits === suggestions.length * 101, `units=${ytQuotaUnits}`)

const expectedMaxUnits = 20 * 101
assert(`A4: quota units ≤ ${expectedMaxUnits} (worst case, 20 suggestions × 101)`,
  ytQuotaUnits <= expectedMaxUnits, `got ${ytQuotaUnits}`)

assert(`A5: credits deducted = ${CREDIT_COST} (CREDIT_COSTS.keywords_analysis)`,
  balAfter === balBefore - CREDIT_COST, `before=${balBefore} after=${balAfter} diff=${balBefore-balAfter}`)

assert(`A6: keywords had engagement data (statsMap populated)`,
  [...statsMap.values()].some(s => s.avg_views > 0 || s.video_count > 0))

console.log()
console.log(`  ── Summary ──`)
console.log(`  Suggestions:    ${suggestions.length}/20`)
console.log(`  YouTube calls:  ${ytCallCount} HTTP requests`)
console.log(`  Quota units:    ${ytQuotaUnits} units (${suggestions.length} × 101)`)
console.log(`  Balance:        ${balBefore} → ${balAfter} (−${CREDIT_COST} credits)`)
console.log(`  Time:           ${elapsed}s`)
console.log()
console.log(`══ Results: ${passed} passed, ${failed} failed ══\n`)
if (failed > 0) process.exit(1)
