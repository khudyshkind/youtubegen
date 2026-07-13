/**
 * Live acceptance test: BYOK save / encrypt / gate / discount / delete (Ход 3b)
 *
 * Usage:
 *   TEST_YT_KEY=AIzaSy... node scripts/test-byok-acceptance.mjs
 *
 * Covers:
 *   1. Free user without key → byok_required (gate baseline)
 *   2. POST /api/settings/save-yt-key  → 200 ok
 *   3. DB row: encrypted_yt_key is hex, NOT equal to plaintext (encryption confirmed)
 *   4. Free+BYOK → keywords analytics passes; exactly 7000 credits deducted (10000×0.7)
 *   5. DELETE /api/settings/save-yt-key → key removed from DB
 *   6. After delete → byok_required returns again
 *   Cleanup: test user deleted at the end.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envRaw = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
const env = Object.fromEntries(
  envRaw
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      const v = l.slice(i + 1).trim()
      return [l.slice(0, i).trim(), v.replace(/^["']|["']$/g, '')]
    })
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SVC_KEY     = env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY    = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const APP_URL     = 'https://lefiro.co'

const TEST_YT_KEY = process.env.TEST_YT_KEY
if (!TEST_YT_KEY) {
  console.error('\nERROR: TEST_YT_KEY not set.')
  console.error('Usage: TEST_YT_KEY=AIzaSy... node scripts/test-byok-acceptance.mjs\n')
  process.exit(1)
}

// ── Supabase clients ─────────────────────────────────────────────────────────
const svc  = createClient(SUPABASE_URL, SVC_KEY,  { auth: { persistSession: false } })
const anon = createClient(SUPABASE_URL, ANON_KEY || SVC_KEY, { auth: { persistSession: false } })

// ── Test user setup ──────────────────────────────────────────────────────────
const TEST_EMAIL    = `byok3b-${Date.now()}@acceptance.internal`
const TEST_PASSWORD = `ByokAccept${Date.now()}!`
const INIT_CREDITS  = 50_000
const KEYWORDS_BASE = 10_000
const KEYWORDS_BYOK = Math.round(KEYWORDS_BASE * 0.7) // 7000

// Unique keyword to guarantee cache miss
const TEST_KEYWORD  = `byok-accept-${Date.now()}`

// ── Assertion helpers ────────────────────────────────────────────────────────
let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else       { console.error(`  ❌ FAIL: ${msg}`); failed++ }
}

async function getBalance(userId) {
  const { data } = await svc.from('profiles').select('credits').eq('id', userId).single()
  return data?.credits ?? null
}
async function getEncryptedKey(userId) {
  const { data } = await svc.from('profiles').select('encrypted_yt_key').eq('id', userId).single()
  return data?.encrypted_yt_key ?? null
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('\n══ BYOK Acceptance Test (Ход 3b) ══\n')
console.log(`App:                 ${APP_URL}`)
console.log(`Keywords base cost:  ${KEYWORDS_BASE} credits`)
console.log(`Keywords BYOK cost:  ${KEYWORDS_BYOK} credits (30% off)`)
console.log(`Test keyword:        ${TEST_KEYWORD}`)

// ── 0. Create & configure test user ─────────────────────────────────────────
console.log('\n── Step 0: create test user (free, 50k credits) ──')
const { data: created, error: createErr } = await svc.auth.admin.createUser({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
  email_confirm: true,
})
if (createErr || !created.user) {
  console.error('Failed to create test user:', createErr?.message)
  process.exit(1)
}
const userId = created.user.id
console.log(`  user_id: ${userId}`)

await svc.from('profiles').update({
  plan:            'free',
  credits:         INIT_CREDITS,
  encrypted_yt_key: null,
}).eq('id', userId)
console.log(`  plan=free, credits=${INIT_CREDITS}, encrypted_yt_key=null`)

// Sign in as test user
const { data: sess, error: signErr } = await anon.auth.signInWithPassword({
  email: TEST_EMAIL, password: TEST_PASSWORD,
})
if (signErr || !sess.session) {
  console.error('Sign-in failed:', signErr?.message)
  await svc.auth.admin.deleteUser(userId)
  process.exit(1)
}
const s = sess.session
const PROJECT_REF = SUPABASE_URL.match(/\/\/([^.]+)\./)?.[1] ?? ''
const cookieName  = `sb-${PROJECT_REF}-auth-token`
const cookieVal   = encodeURIComponent(JSON.stringify({
  access_token:  s.access_token,
  refresh_token: s.refresh_token,
  expires_in:    s.expires_in,
  expires_at:    s.expires_at,
  token_type:    s.token_type,
  user:          s.user,
}))
console.log(`  signed in, session cookie: ${cookieName}=<json>`)

// ── HTTP helper ──────────────────────────────────────────────────────────────
async function callApi(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${cookieName}=${cookieVal}`,
    },
  }
  if (body !== null) opts.body = JSON.stringify(body)
  const res = await fetch(`${APP_URL}${path}`, opts)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 1: Free user (no key) → byok_required
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 1: Free user, no key → byok_required ──')
{
  const before = await getBalance(userId)
  const { status, json } = await callApi('POST', '/api/analytics/keywords', {
    keyword: TEST_KEYWORD, content_lang: 'en', ui_lang: 'en', country: 'US',
  })
  const after = await getBalance(userId)
  console.log(`  HTTP ${status}, code=${json.code}`)
  assert(status === 403,                    `HTTP 403 (got ${status})`)
  assert(json.code === 'byok_required',     `code=byok_required (got ${json.code})`)
  assert(before === after,                  `balance unchanged: ${before} → ${after}`)
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 2: Save YouTube API key via /api/settings/save-yt-key
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 2: Save YouTube API key ──')
{
  const { status, json } = await callApi('POST', '/api/settings/save-yt-key', {
    key: TEST_YT_KEY,
  })
  console.log(`  HTTP ${status}, ok=${json.ok}${json.code ? ', code=' + json.code : ''}`)
  if (!json.ok) console.error(`  server error: ${json.error ?? '(no message)'}`)
  assert(status === 200, `HTTP 200 (got ${status})`)
  assert(json.ok === true, `ok=true`)
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 3: DB row confirms encryption (hex, ≠ plaintext, correct length)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 3: DB row confirms AES-256-GCM encryption ──')
{
  const stored = await getEncryptedKey(userId)
  const isHex       = typeof stored === 'string' && /^[0-9a-f]+$/i.test(stored)
  const differsFrom = stored !== TEST_YT_KEY
  // AES-256-GCM output: IV(12B) + AuthTag(16B) + ciphertext(≥30B) → ≥116 hex chars
  const lenOk       = typeof stored === 'string' && stored.length >= 116

  console.log(`  stored length: ${stored?.length ?? 'null'} chars (min expected 116)`)
  console.log(`  is valid hex:   ${isHex}`)
  console.log(`  ≠ plaintext:    ${differsFrom}`)
  assert(stored !== null,   `encrypted_yt_key is NOT null in DB`)
  assert(isHex,             `stored value is hex string (not plaintext)`)
  assert(differsFrom,       `stored value ≠ plaintext key → encryption confirmed`)
  assert(lenOk,             `hex length ≥ 116 chars (IV+AuthTag+ciphertext)`)
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 4: Free+BYOK → keywords passes, exactly 7000 credits deducted
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 4: Free+BYOK → keywords passes (30% discount = 7000 credits) ──')
console.log('  (this calls Claude + YouTube — may take up to 60s)')
{
  // Pre-clear any residual cache entry for this keyword (shouldn't exist, but be safe)
  await svc.from('analytics_cache')
    .delete()
    .eq('cache_type', 'keywords')
    .eq('cache_key', `${TEST_KEYWORD.toLowerCase()}|en|US|v1`)

  const before = await getBalance(userId)
  console.log(`  credits before: ${before}`)

  const { status, json } = await callApi('POST', '/api/analytics/keywords', {
    keyword: TEST_KEYWORD, content_lang: 'en', ui_lang: 'en', country: 'US',
  })

  const after    = await getBalance(userId)
  const deducted = before - after
  console.log(`  HTTP ${status}`)
  console.log(`  credits after:  ${after}`)
  console.log(`  deducted:       ${deducted} (expected ${KEYWORDS_BYOK})`)
  if (json.ok === false) console.log(`  response code:  ${json.code ?? '?'}, error: ${json.error ?? ''}`)

  const gateUnlocked = !(status === 403 && json.code === 'byok_required')
  assert(gateUnlocked,                  `BYOK gate UNLOCKED (not 403 byok_required)`)
  assert(status === 200,                `HTTP 200 OK (got ${status}) — route completed`)
  assert(deducted === KEYWORDS_BYOK,    `deducted exactly ${KEYWORDS_BYOK} (got ${deducted})`)
  assert(deducted !== KEYWORDS_BASE,    `NOT full base cost ${KEYWORDS_BASE} — discount applied`)
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 5: DELETE key → DB shows null
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 5: Delete key ──')
{
  const { status, json } = await callApi('DELETE', '/api/settings/save-yt-key', null)
  console.log(`  HTTP ${status}, ok=${json.ok}`)
  assert(status === 200,   `HTTP 200 (got ${status})`)
  assert(json.ok === true, `ok=true`)

  const stored = await getEncryptedKey(userId)
  console.log(`  encrypted_yt_key in DB: ${stored}`)
  assert(stored === null, `encrypted_yt_key = null after delete`)
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 6: After delete → byok_required returns
// ────────────────────────────────────────────────────────────────────────────
console.log('\n── Test 6: After delete → byok_required gate restored ──')
{
  const { status, json } = await callApi('POST', '/api/analytics/keywords', {
    keyword: TEST_KEYWORD, content_lang: 'en', ui_lang: 'en', country: 'US',
  })
  console.log(`  HTTP ${status}, code=${json.code}`)
  assert(status === 403,                `HTTP 403 (got ${status})`)
  assert(json.code === 'byok_required', `code=byok_required (got ${json.code})`)
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
console.log('\n── Cleanup ──')
await svc.auth.admin.deleteUser(userId)
console.log(`  test user ${userId} deleted`)

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n══ Results: ${passed} passed, ${failed} failed ══\n`)
if (failed > 0) process.exit(1)
