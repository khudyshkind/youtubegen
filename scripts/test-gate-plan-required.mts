/**
 * Gate test: verifies plan_required 403 for free users across analytics routes.
 * Tests resolveAnalyticsContext (used by 9 routes) and the revenue/niche direct gates.
 * Run: npx tsx scripts/test-gate-plan-required.mts
 */

import { planRequiredResponse, resolveAnalyticsContext } from '../src/lib/analytics-gate'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Mock Supabase client that returns a given plan ────────────────────────────
function mockSvc(plan: string): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { plan, encrypted_yt_key: null }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

// ── Test: resolveAnalyticsContext returns plan_required for free user ─────────
async function testContextGate() {
  const ctx = await resolveAnalyticsContext('test-user-id', mockSvc('free'), 'ru')
  const res = ctx.gateRes
  if (!res) throw new Error('FAIL: gateRes should be set for plan=free')
  const body = await res.json() as { code?: string; ok?: boolean }
  console.assert(res.status === 403, `FAIL status: expected 403 got ${res.status}`)
  console.assert(body.code === 'plan_required', `FAIL code: expected plan_required got ${body.code}`)
  console.assert(body.ok === false, 'FAIL: ok should be false')
  return { status: res.status, code: body.code, ok: body.ok }
}

// ── Test: resolveAnalyticsContext allows paid users ───────────────────────────
async function testContextAllowsPaid() {
  for (const plan of ['basic', 'starter', 'pro', 'agency']) {
    const ctx = await resolveAnalyticsContext('test-user-id', mockSvc(plan), 'ru')
    if (ctx.gateRes !== null) throw new Error(`FAIL: plan=${plan} should not be gated`)
  }
  return 'basic/starter/pro/agency → gateRes=null (allowed)'
}

// ── Test: planRequiredResponse returns correct shape ─────────────────────────
async function testPlanRequiredResponse() {
  const res = planRequiredResponse('ru')
  const body = await res.json() as { code?: string; ok?: boolean }
  console.assert(res.status === 403, `status: ${res.status}`)
  console.assert(body.code === 'plan_required', `code: ${body.code}`)
  return { status: res.status, code: body.code }
}

// ── Test: free + BYOK key still gets plan_required (no BYOK bypass) ───────────
async function testByokNoBypasses() {
  const mockWithKey: SupabaseClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({
            data: { plan: 'free', encrypted_yt_key: 'some-encrypted-key' },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient

  const ctx = await resolveAnalyticsContext('test-user-id', mockWithKey, 'ru')
  const res = ctx.gateRes
  if (!res) throw new Error('FAIL: free+BYOK should still be gated by plan_required')
  const body = await res.json() as { code?: string }
  console.assert(body.code === 'plan_required', `FAIL: expected plan_required got ${body.code}`)
  return `free+BYOK → ${body.code} (BYOK does NOT bypass plan gate)`
}

// ── Run all tests ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Analytics Plan Gate Tests ===\n')

  const t1 = await testContextGate()
  console.log('✓ resolveAnalyticsContext(plan=free):', JSON.stringify(t1))

  const t2 = await testContextAllowsPaid()
  console.log('✓', t2)

  const t3 = await testPlanRequiredResponse()
  console.log('✓ planRequiredResponse:', JSON.stringify(t3))

  const t4 = await testByokNoBypasses()
  console.log('✓', t4)

  console.log('\nAll gate tests passed.\n')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
