/**
 * Partial acceptance test: gate behavior WITHOUT needing a real YouTube API key.
 * Covers:
 *   1. Free user, encrypted_yt_key=null  → keywords returns byok_required (403)
 *   2. Insert dummy hex into encrypted_yt_key via service_role
 *      → keywords returns something OTHER than byok_required (gate lifts)
 *      (analytics may fail for other reasons since key is fake — that is expected)
 *   3. Set encrypted_yt_key=null again → byok_required returns
 * Balance must be unchanged throughout (gate fires before requireCredits).
 *
 * Full test with real key: TEST_YT_KEY=AIzaSy... node scripts/test-byok-acceptance.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const rawEnv = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
const env = Object.fromEntries(
  rawEnv.split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => {
    const i = l.indexOf('='); const v = l.slice(i + 1).trim()
    return [l.slice(0, i).trim(), v.replace(/^["']|["']$/g, '')]
  })
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SVC_KEY     = env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY    = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const APP_URL     = 'https://lefiro.co'

const svc  = createClient(SUPABASE_URL, SVC_KEY,  { auth: { persistSession: false } })
const anon = createClient(SUPABASE_URL, ANON_KEY || SVC_KEY, { auth: { persistSession: false } })

const TEST_EMAIL    = `byok-gate-${Date.now()}@gate-only.internal`
const TEST_PASSWORD = `GateOnly${Date.now()}!`
const INIT_CREDITS  = 50_000

// Plausible-length dummy hex: 12B IV + 16B tag + 30B ciphertext = 58B = 116 hex chars
const DUMMY_ENCRYPTED_HEX = 'a'.repeat(116)

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else       { console.error(`  ❌ FAIL: ${msg}`); failed++ }
}
async function getBalance(uid) {
  const { data } = await svc.from('profiles').select('credits').eq('id', uid).single()
  return data?.credits ?? null
}

console.log('\n══ BYOK Gate-Only Acceptance Test ══\n')
console.log(`App: ${APP_URL}`)
console.log('(No real YouTube key needed — tests gate presence/absence only)')

// ── 0. Setup test user ───────────────────────────────────────────────────────
console.log('\n── Step 0: create test user (free, 50k credits) ──')
const { data: created, error: ce } = await svc.auth.admin.createUser({
  email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true,
})
if (ce || !created.user) { console.error('create user failed:', ce?.message); process.exit(1) }
const userId = created.user.id
console.log(`  user_id: ${userId}`)

await svc.from('profiles').update({ plan: 'free', credits: INIT_CREDITS, encrypted_yt_key: null }).eq('id', userId)
console.log(`  plan=free, credits=${INIT_CREDITS}, encrypted_yt_key=null`)

const { data: sess, error: se } = await anon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })
if (se || !sess.session) { console.error('sign-in failed:', se?.message); await svc.auth.admin.deleteUser(userId); process.exit(1) }
const s = sess.session
const REF = SUPABASE_URL.match(/\/\/([^.]+)\./)?.[1] ?? ''
const cookieName = `sb-${REF}-auth-token`
const cookieVal  = encodeURIComponent(JSON.stringify({
  access_token: s.access_token, refresh_token: s.refresh_token,
  expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type, user: s.user,
}))
console.log(`  signed in, cookie ready`)

async function callKeywords() {
  const res = await fetch(`${APP_URL}/api/analytics/keywords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${cookieName}=${cookieVal}` },
    body: JSON.stringify({ keyword: `gate-test-${Date.now()}`, content_lang: 'en', ui_lang: 'en', country: 'US' }),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

// ── Test 1: no key → byok_required ─────────────────────────────────────────
console.log('\n── Test 1: encrypted_yt_key=null → byok_required ──')
{
  const before = await getBalance(userId)
  const { status, json } = await callKeywords()
  const after = await getBalance(userId)
  console.log(`  HTTP ${status}, code=${json.code}`)
  assert(status === 403,                `HTTP 403 (got ${status})`)
  assert(json.code === 'byok_required', `code=byok_required`)
  assert(before === after,              `balance unchanged: ${before} → ${after}`)
}

// ── Test 2: set dummy hex → gate lifts (not byok_required) ─────────────────
console.log('\n── Test 2: set encrypted_yt_key (dummy hex) → gate lifts ──')
{
  await svc.from('profiles').update({ encrypted_yt_key: DUMMY_ENCRYPTED_HEX }).eq('id', userId)
  console.log(`  encrypted_yt_key set to dummy hex (${DUMMY_ENCRYPTED_HEX.length} chars)`)

  const before = await getBalance(userId)
  const { status, json } = await callKeywords()
  const after = await getBalance(userId)
  console.log(`  HTTP ${status}, code=${json.code ?? '(none)'}`)
  console.log(`  balance: ${before} → ${after}`)

  // Gate lifts: anything OTHER than 403 byok_required counts
  const gatePassed = !(status === 403 && json.code === 'byok_required')
  assert(gatePassed,       `gate LIFTED — not 403 byok_required (got ${status} ${json.code ?? ''})`)
  // Credits deducted or not: route may fail at decryption (dummy key → bad GCM tag)
  // If credits deducted, it means requireCredits ran (gate was past). If not, route failed before.
  // Either way, gate is confirmed lifted by status ≠ 403/byok_required.
  console.log(`  note: analytics may error on bad GCM tag (dummy key) — that is expected`)
}

// ── Test 3: clear key → byok_required returns ───────────────────────────────
console.log('\n── Test 3: set encrypted_yt_key=null → byok_required restored ──')
{
  await svc.from('profiles').update({ encrypted_yt_key: null }).eq('id', userId)
  console.log(`  encrypted_yt_key cleared to null`)

  const before = await getBalance(userId)
  const { status, json } = await callKeywords()
  const after = await getBalance(userId)
  console.log(`  HTTP ${status}, code=${json.code}`)
  assert(status === 403,                `HTTP 403 restored (got ${status})`)
  assert(json.code === 'byok_required', `code=byok_required restored`)
  assert(before === after,              `balance unchanged: ${before} → ${after}`)
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
console.log('\n── Cleanup ──')
await svc.auth.admin.deleteUser(userId)
console.log(`  test user ${userId} deleted`)

console.log(`\n══ Results: ${passed} passed, ${failed} failed ══\n`)
console.log('For full test (save-yt-key route, encryption round-trip, 7000 credit discount):')
console.log('  TEST_YT_KEY=AIzaSy... node scripts/test-byok-acceptance.mjs\n')
if (failed > 0) process.exit(1)
