/**
 * Live refund gate test — run AFTER the Railway injection is deployed.
 *
 * Usage:
 *   1. Railway is running with INJECTED FAILURE in processVideoJob
 *   2. Run this script (it reads owner balance and starts watching)
 *   3. Start a 1-image render from the browser
 *   4. Within ~10s, the failure fires and this script captures the result
 *
 *   node scripts/live-refund-gate.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = resolve(__dir, '../.env.local')
  try {
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=["']?([^"'\n]*)["']?/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch { /* ignore */ }
}
loadEnv()

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim()
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
  process.exit(1)
}

const hdrs = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
})

async function sbGet(table, qs) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: hdrs() })
  if (!res.ok) throw new Error(`sbGet ${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── 0. Owner identity ─────────────────────────────────────────────────────────
const [ownerProfile] = await sbGet('profiles', 'order=created_at&limit=1&select=id,credits,email')
const OWNER_ID = ownerProfile.id
console.log(`\n👤 Owner: ${ownerProfile.email ?? OWNER_ID}`)

// ── 1. Balance BEFORE ─────────────────────────────────────────────────────────
const creditsBefore = ownerProfile.credits ?? 0
console.log(`💰 Balance BEFORE render:   ${creditsBefore} кр.`)
const windowStart = new Date(Date.now() - 5000).toISOString()   // 5s back for safety
console.log(`\n🚀 Start a 1-image render from the browser NOW.`)
console.log('   (render route will deduct credits and write credits_charged)')
console.log('   Waiting for a new failed video_job to appear…\n')

// ── 2. Poll for a new failed video_job ───────────────────────────────────────
let job = null
let elapsed = 0
const TIMEOUT_MS = 90_000

while (!job && elapsed < TIMEOUT_MS) {
  await new Promise(r => setTimeout(r, 2000))
  elapsed += 2000

  const rows = await sbGet(
    'video_jobs',
    `user_id=eq.${OWNER_ID}&status=eq.failed&created_at=gt.${windowStart}&select=id,status,error_message,credits_charged,credits_refunded_at,project_id&order=created_at.desc&limit=1`
  )
  if (rows.length > 0) {
    job = rows[0]
  } else {
    process.stdout.write(`  … ${Math.round(elapsed / 1000)}s elapsed\r`)
  }
}

if (!job) {
  console.error(`\n❌ Timeout: no failed video_job appeared within ${TIMEOUT_MS / 1000}s`)
  process.exit(1)
}

console.log(`\n✅ Failed job detected: ${job.id}`)

// ── 3. Read state immediately after Railway refund ───────────────────────────
const [profile1] = await sbGet('profiles', `id=eq.${OWNER_ID}&select=credits`)
const creditsAfter = profile1.credits ?? 0

console.log('\n─── DB SNAPSHOT (immediately after failure) ─────────────────────')
console.log(`  video_jobs.id:                 ${job.id}`)
console.log(`  video_jobs.status:             ${job.status}`)
console.log(`  video_jobs.error_message:      ${job.error_message}`)
console.log(`  video_jobs.credits_charged:    ${job.credits_charged}`)
console.log(`  video_jobs.credits_refunded_at: ${job.credits_refunded_at ?? 'NULL ← ⚠️ refund NOT fired yet'}`)
console.log(`  profiles.credits BEFORE:       ${creditsBefore}`)
console.log(`  profiles.credits AFTER:        ${creditsAfter}`)
console.log(`  diff:                          ${creditsAfter - creditsBefore < 0 ? creditsAfter - creditsBefore : '+' + (creditsAfter - creditsBefore)}`)

// If refund_at is still null, the Railway refund fired first but credits_charged was 0 at read time
// (race), OR the Vercel fallback hasn't polled yet.  Wait up to 8 more seconds.
if (!job.credits_refunded_at) {
  console.log('\n  ⏳ credits_refunded_at is null — waiting up to 8s for refund to land…')
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const [refreshed] = await sbGet('video_jobs', `id=eq.${job.id}&select=credits_charged,credits_refunded_at`)
    const [p] = await sbGet('profiles', `id=eq.${OWNER_ID}&select=credits`)
    if (refreshed.credits_refunded_at) {
      job = { ...job, ...refreshed }
      const creditsNow = p.credits ?? 0
      console.log(`  ✅ Refund landed after ${(i + 1) * 2}s:`)
      console.log(`     credits_refunded_at: ${job.credits_refunded_at}`)
      console.log(`     profiles.credits:    ${creditsNow} (+${creditsNow - creditsBefore})`)
      break
    }
  }
}

// ── 4. credit_transactions entry ─────────────────────────────────────────────
const txns = await sbGet('credit_transactions',
  `user_id=eq.${OWNER_ID}&operation=eq.video_refund&project_id=eq.${job.project_id}&order=created_at.desc&limit=1&select=amount,operation,created_at`)
console.log('\n─── credit_transactions (video_refund) ────────────────────────────')
if (txns.length > 0) {
  console.log(`  operation: ${txns[0].operation}  amount: ${txns[0].amount}  at: ${txns[0].created_at}`)
} else {
  console.log('  ⚠️  No video_refund entry found in credit_transactions (refund may not have fired)')
}

// ── 5. Idempotency: wait 3s, balance must not change again ───────────────────
console.log('\n─── Idempotency check (3s window) ─────────────────────────────────')
await new Promise(r => setTimeout(r, 3000))
const [profile2] = await sbGet('profiles', `id=eq.${OWNER_ID}&select=credits`)
const creditsIdempotent = profile2.credits ?? 0
const [job2] = await sbGet('video_jobs', `id=eq.${job.id}&select=credits_charged,credits_refunded_at`)
console.log(`  profiles.credits after 3s:    ${creditsIdempotent}`)
console.log(`  credits_refunded_at (stable): ${job2.credits_refunded_at}`)

let passed = 0; let failed = 0
function check(label, actual, expected) {
  if (actual === expected) { console.log(`  ✅  ${label}`); passed++ }
  else { console.log(`  ❌  ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); failed++ }
}

console.log('\n─── Assertions ─────────────────────────────────────────────────────')
check('job status is failed',                       job.status, 'failed')
check('error_message contains INJECTED',            job.error_message?.includes('INJECTED') ?? false, true)
check('credits_charged > 0',                        (job2.credits_charged ?? 0) > 0, true)
check('credits_refunded_at is set',                 !!job2.credits_refunded_at, true)
check('balance increased by credits_charged',       creditsAfter - creditsBefore, job2.credits_charged ?? 0)
check('balance unchanged after 3s (no re-refund)',  creditsIdempotent, creditsAfter)
check('credit_transactions has video_refund entry', txns.length > 0, true)

console.log(`\n${'─'.repeat(55)}`)
console.log(`Live gate: ${passed}/${passed + failed} assertions passed`)
if (failed === 0) {
  console.log('✅ Live refund door confirmed — safe to revert injection.\n')
  process.exit(0)
} else {
  console.log('❌ Some assertions failed — investigate before reverting.\n')
  process.exit(1)
}
