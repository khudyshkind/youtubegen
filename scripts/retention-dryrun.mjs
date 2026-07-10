/**
 * Dry-run test for the media retention cleanup logic.
 * Queries the real DB, applies threshold logic, logs candidates.
 * Does NOT touch storage (B2, Supabase) or send Telegram messages.
 *
 * Usage:
 *   railway run --service video-server node scripts/retention-dryrun.mjs
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  console.error('Run with: railway run --service video-server node scripts/retention-dryrun.mjs')
  process.exit(1)
}

// ── Same config as in index.js (must stay in sync) ───────────────────────────
const RETENTION_DAYS = {
  free: { abandoned: 1, completed: 2 },
  paid: { abandoned: 3, completed: 5 },
}
const retentionTier = (plan) => plan === 'free' ? 'free' : 'paid'

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

async function sbGet(table, qs = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`sbGet ${table}: ${res.status} ${await res.text().catch(() => '')}`)
  return res.json()
}

// ── Main dry-run logic ───────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════')
console.log(' retention-dryrun.mjs — DRY-RUN candidate check')
console.log('══════════════════════════════════════════════════')
console.log(`SUPABASE_URL: ${SUPABASE_URL}`)
console.log(`RETENTION_DAYS:`, RETENTION_DAYS)
console.log('')

// 1. Active video jobs (safety exclusion)
console.log('1. Fetching active video_jobs (pending/processing)…')
let activeProjectIds = new Set()
try {
  const activeJobs = await sbGet('video_jobs', 'select=project_id&status=in.(pending,processing)')
  activeJobs.forEach(j => { if (j.project_id) activeProjectIds.add(j.project_id) })
  console.log(`   → ${activeProjectIds.size} active job project(s)`)
} catch (e) {
  console.error('   ERROR — aborting for safety:', e.message)
  process.exit(1)
}

const now = Date.now()
const iso = (d) => new Date(now - d * 86400_000).toISOString()

// 2A. Abandoned candidates (DB query)
console.log('\n2A. Querying ABANDONED candidates (video_url IS NULL, not generating_*)…')
console.log(`    SQL threshold: created_at < ${iso(RETENTION_DAYS.free.abandoned)} (free=${RETENTION_DAYS.free.abandoned}d)`)
let abandoned = []
try {
  abandoned = await sbGet('projects',
    `select=id,user_id,created_at,status,profiles!inner(plan)` +
    `&video_url=is.null` +
    `&status=not.like.generating_*` +
    `&created_at=lt.${iso(RETENTION_DAYS.free.abandoned)}` +
    `&limit=500`
  )
  console.log(`    → ${abandoned.length} row(s) from DB`)
} catch (e) { console.error('    ERROR:', e.message) }

// 2B. Completed candidates (DB query)
console.log('\n2B. Querying COMPLETED candidates (video_url IS NOT NULL)…')
console.log(`    SQL threshold: completed_at/updated_at < ${iso(RETENTION_DAYS.free.completed)} (free=${RETENTION_DAYS.free.completed}d)`)
let completed = []
try {
  const ageFilter = `or=(completed_at.lt.${iso(RETENTION_DAYS.free.completed)},and(completed_at.is.null,updated_at.lt.${iso(RETENTION_DAYS.free.completed)}))`
  completed = await sbGet('projects',
    `select=id,user_id,completed_at,updated_at,status,profiles!inner(plan)` +
    `&video_url=not.is.null` +
    `&${ageFilter}` +
    `&limit=500`
  )
  console.log(`    → ${completed.length} row(s) from DB`)
} catch (e) { console.error('    ERROR:', e.message) }

// 3. JS threshold filter
console.log('\n3. Applying plan-specific JS thresholds…')
const candidates = []

for (const p of abandoned) {
  if (activeProjectIds.has(p.id)) { console.log(`   [skip] ${p.id} — active job`); continue }
  const plan = p.profiles?.plan ?? 'free'
  const tier = retentionTier(plan)
  const ageDays = (now - new Date(p.created_at).getTime()) / 86400_000
  const threshold = RETENTION_DAYS[tier].abandoned
  const pass = ageDays >= threshold
  console.log(`   abandoned plan=${plan} tier=${tier} age=${ageDays.toFixed(2)}d threshold=${threshold}d → ${pass ? 'CANDIDATE ✓' : 'skip (too fresh)'}`)
  if (pass) candidates.push({ ...p, _category: 'abandoned', _ageDays: ageDays.toFixed(1), _tier: tier })
}

for (const p of completed) {
  if (activeProjectIds.has(p.id)) { console.log(`   [skip] ${p.id} — active job`); continue }
  const plan = p.profiles?.plan ?? 'free'
  const tier = retentionTier(plan)
  const anchor = p.completed_at ?? p.updated_at     // ← fallback logic
  const anchorSource = p.completed_at ? 'completed_at' : 'updated_at'
  const ageDays = (now - new Date(anchor).getTime()) / 86400_000
  const threshold = RETENTION_DAYS[tier].completed
  const pass = ageDays >= threshold
  console.log(`   completed plan=${plan} tier=${tier} anchor=${anchorSource} age=${ageDays.toFixed(2)}d threshold=${threshold}d → ${pass ? 'CANDIDATE ✓' : 'skip (too fresh)'}`)
  if (pass) candidates.push({ ...p, _category: 'completed', _ageDays: ageDays.toFixed(1), _tier: tier })
}

// 4. Summary
console.log('\n══════════════════════════════════════════════════')
console.log(`RESULT: ${candidates.length} candidate(s) for deletion`)
if (candidates.length > 0) {
  console.log('\nCandidates:')
  for (const c of candidates) {
    console.log(`  [${c._category.toUpperCase()}] project=${c.id} user=${c.user_id} tier=${c._tier} age=${c._ageDays}d`)
    console.log(`    Storage prefixes that WOULD be listed:`)
    console.log(`      Supabase audio:  ${c.user_id}/${c.id}/`)
    console.log(`      Supabase images: ${c.user_id}/${c.id}/`)
    console.log(`      B2 media:        users/${c.user_id}/${c.id}/`)
  }
}
const counts = { abandoned: { free: 0, paid: 0 }, completed: { free: 0, paid: 0 } }
for (const c of candidates) counts[c._category][c._tier === 'free' ? 'free' : 'paid']++

console.log('')
console.log('[DRY RUN] БЫЛО БЫ удалено:')
console.log(`  Брошенных:   ${counts.abandoned.free} free + ${counts.abandoned.paid} paid`)
console.log(`  Завершённых: ${counts.completed.free} free + ${counts.completed.paid} paid`)
console.log(`  Итого:       ${candidates.length} проектов`)
console.log('══════════════════════════════════════════════════\n')
