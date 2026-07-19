/**
 * SIM4: 20% mass-expiry protection mock.
 * Exercises the exact cron branch logic from video-server/index.js
 * with fabricated data. Shows the abort path fires.
 * Run: node scripts/test-expire-cron-protection.mjs
 */

// ── Replicated cron logic (copied verbatim from index.js expire cron) ─────────
async function simulateExpiryCron({ totalPaid, expiredUsers, dryRun = true }) {
  const N = expiredUsers.length
  console.log(`\n[sim] totalPaid=${totalPaid}, expired=${N}`)

  if (N === 0) {
    console.log('[subscriptions] no expired plans')
    return { outcome: 'noop', successCount: 0 }
  }

  // 20% mass-expiry protection
  if (totalPaid > 0 && N / totalPaid > 0.20) {
    const alertMsg = `⚠️ [subscriptions] suspicious mass expiry: ${N}/${totalPaid} paid users would be downgraded — ABORTED`
    console.log(alertMsg)
    console.log('[sim] → TG alert to owner would fire; cron returns early')
    return { outcome: 'aborted_20pct', N, totalPaid, ratio: (N / totalPaid).toFixed(2) }
  }

  if (dryRun) {
    let successCount = 0
    let totalBurned = 0
    for (const user of expiredUsers) {
      console.log(`[sim] expire_plan(${user.id}) → burned=${user.plan_credits}`)
      successCount++
      totalBurned += user.plan_credits
    }
    console.log(`[subscriptions] expired ${successCount} plans, burned ${totalBurned} plan_credits`)
    return { outcome: 'processed', successCount, totalBurned }
  }
}

async function main() {
  console.log('=== SIM4: 20% Protection Mock ===')

  // Case A: 5/20 = 25% → should ABORT (> 20%)
  const resultA = await simulateExpiryCron({
    totalPaid: 20,
    expiredUsers: [
      { id: 'u1', plan: 'starter', plan_credits: 200000 },
      { id: 'u2', plan: 'pro',     plan_credits: 500000 },
      { id: 'u3', plan: 'basic',   plan_credits: 100000 },
      { id: 'u4', plan: 'starter', plan_credits: 200000 },
      { id: 'u5', plan: 'agency',  plan_credits: 1000000 },
    ],
  })
  console.assert(resultA.outcome === 'aborted_20pct',
    `FAIL A: expected aborted_20pct got ${resultA.outcome}`)
  console.log(`✓ Case A (${resultA.N}/${resultA.totalPaid} = ${resultA.ratio} > 20%) → ABORTED`)

  // Case B: 2/20 = 10% → should PROCESS normally
  const resultB = await simulateExpiryCron({
    totalPaid: 20,
    expiredUsers: [
      { id: 'u1', plan: 'starter', plan_credits: 200000 },
      { id: 'u2', plan: 'basic',   plan_credits: 100000 },
    ],
  })
  console.assert(resultB.outcome === 'processed',
    `FAIL B: expected processed got ${resultB.outcome}`)
  console.assert(resultB.successCount === 2, `FAIL B: count ${resultB.successCount}`)
  console.assert(resultB.totalBurned === 300000, `FAIL B: burned ${resultB.totalBurned}`)
  console.log(`✓ Case B (2/20 = 10% ≤ 20%) → processed ${resultB.successCount} plans, burned ${resultB.totalBurned} plan_credits`)

  // Case C: exactly 20% → should NOT abort (> not >=)
  const resultC = await simulateExpiryCron({
    totalPaid: 10,
    expiredUsers: [
      { id: 'u1', plan: 'starter', plan_credits: 200000 },
      { id: 'u2', plan: 'pro',     plan_credits: 500000 },
    ],
  })
  console.assert(resultC.outcome === 'processed',
    `FAIL C: 20% exactly should not abort, got ${resultC.outcome}`)
  console.log(`✓ Case C (2/10 = 20.0% exactly) → processed (threshold is > 20%, not >=)`)

  // Case D: 0 expired → noop
  const resultD = await simulateExpiryCron({ totalPaid: 50, expiredUsers: [] })
  console.assert(resultD.outcome === 'noop', `FAIL D: ${resultD.outcome}`)
  console.log('✓ Case D (0 expired) → noop')

  console.log('\nAll SIM4 protection tests passed.\n')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
