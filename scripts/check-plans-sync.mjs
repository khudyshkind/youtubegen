#!/usr/bin/env node
// Smoke-test: verifies /api/plans returns correct shape and all expected keys.
// Usage: node scripts/check-plans-sync.mjs [APP_URL]
//   APP_URL defaults to https://lefiro.co
//
// Exit 0 = OK, Exit 1 = mismatch (fails CI).

const APP_URL = process.argv[2] || 'https://lefiro.co'

console.log(`\nChecking ${APP_URL}/api/plans ...`)
let res
try {
  res = await fetch(`${APP_URL}/api/plans`, { signal: AbortSignal.timeout(10_000) })
} catch (e) {
  console.error(`FAIL: fetch error — ${e.message}`)
  process.exit(1)
}

if (!res.ok) {
  console.error(`FAIL: HTTP ${res.status}`)
  process.exit(1)
}

const { plan_credits, topup_packages } = await res.json()

const EXPECTED_PLANS    = ['free', 'basic', 'starter', 'pro', 'agency']
const EXPECTED_TG_KEYS  = ['topup_500', 'topup_2000', 'topup_5000']

let ok = true

for (const key of EXPECTED_PLANS) {
  const cr = plan_credits?.[key]
  if (!cr || cr <= 0) {
    console.error(`FAIL: plan_credits.${key} = ${cr}`)
    ok = false
  }
}

if (!Array.isArray(topup_packages) || topup_packages.length !== 3) {
  console.error(`FAIL: topup_packages length = ${topup_packages?.length}`)
  ok = false
} else {
  for (const [i, tgKey] of EXPECTED_TG_KEYS.entries()) {
    const pkg = topup_packages[i]
    if (!pkg || pkg.tg_key !== tgKey || !pkg.credits || pkg.credits <= 0) {
      console.error(`FAIL: topup_packages[${i}] = ${JSON.stringify(pkg)}, expected tg_key=${tgKey}`)
      ok = false
    }
  }
}

if (ok) {
  console.log('\nOK — /api/plans shape valid')
  console.log('\nplan_credits:')
  for (const [k, v] of Object.entries(plan_credits)) console.log(`  ${k}: ${v}`)
  console.log('\ntopup_packages:')
  for (const p of topup_packages) console.log(`  ${p.tg_key}: ${p.credits} кр @ $${p.price}`)
  console.log()
} else {
  process.exit(1)
}
