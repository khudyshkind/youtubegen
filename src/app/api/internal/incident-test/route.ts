export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'

const EXPECTED_SECRET = 'incident-test-2026-07-22'
const USER_ID = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'
const PLAN_PAYMENT_ID = '31f2b91f-000f-5001-8000-14fe55f57490'  // Pro plan, already activated

async function fetchYkPayment(paymentId: string) {
  const shopId = env('YOOKASSA_SHOP_ID')
  const secret = env('YOOKASSA_SECRET_KEY')
  const auth   = `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`
  const res    = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { Authorization: auth },
  })
  if (!res.ok) throw new Error(`YooKassa ${res.status}`)
  return res.json()
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

/**
 * GET /api/internal/incident-test?action=snapshot|incidents
 * POST /api/internal/incident-test  — runs the mismatch test
 *
 * Test sequence:
 * 1. Fetch real Pro payment object from YooKassa
 * 2. Tamper: set amount.value to '1.00' (mismatch vs 3990 ₽)
 * 3. POST to /api/webhooks/yookassa with tampered body
 * 4. Check payment_incidents for the new row
 * 5. POST same tampered body again (idempotency: should still be 1 row)
 * 6. Return full report
 */
export async function GET(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== EXPECTED_SECRET) return unauthorized()
  const svc    = createServiceClient()
  const action = req.nextUrl.searchParams.get('action') ?? 'snapshot'

  if (action === 'incidents') {
    const { data } = await svc
      .from('payment_incidents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    return NextResponse.json({ incidents: data })
  }

  const { data: profile } = await svc
    .from('profiles')
    .select('credits, plan_credits, purchased_credits, plan, plan_expires_at')
    .eq('id', USER_ID)
    .single()
  return NextResponse.json({ snapshot: profile })
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== EXPECTED_SECRET) return unauthorized()
  const svc = createServiceClient()

  // 1. Fetch real payment
  let realPayment: Record<string, unknown>
  try {
    realPayment = await fetchYkPayment(PLAN_PAYMENT_ID)
  } catch (e) {
    return NextResponse.json({ error: `YooKassa fetch: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  // 2. Tamper amount to trigger mismatch (1 ₽ vs expected 3990 ₽)
  const tampered = structuredClone(realPayment) as Record<string, unknown>
  ;(tampered.amount as Record<string, string>).value = '1.00'

  // 3. Clear any existing incident for this payment (fresh test)
  await svc.from('payment_incidents').delete().eq('payment_id', PLAN_PAYMENT_ID)

  // 4. Count incidents before
  const { count: before_count } = await svc
    .from('payment_incidents')
    .select('*', { count: 'exact', head: true })
    .eq('payment_id', PLAN_PAYMENT_ID)

  const webhookUrl  = `${(env('NEXT_PUBLIC_APP_URL') || 'https://lefiro.co').replace(/\/$/, '')}/api/webhooks/yookassa`
  const webhookBody = JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: tampered })

  // 5. First delivery
  const r1 = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: webhookBody })
  const t1 = await r1.text()

  // 6. Second delivery (idempotency — should NOT create a second row)
  const r2 = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: webhookBody })
  const t2 = await r2.text()

  // 7. Fetch resulting incidents
  const { data: incidents, count: after_count } = await svc
    .from('payment_incidents')
    .select('*', { count: 'exact' })
    .eq('payment_id', PLAN_PAYMENT_ID)

  // 8. Profile must not have changed
  const { data: profile } = await svc
    .from('profiles')
    .select('credits, plan_credits, purchased_credits, plan, plan_expires_at')
    .eq('id', USER_ID)
    .single()

  return NextResponse.json({
    webhook_url:             webhookUrl,
    tampered_amount:         '1.00',
    expected_amount:         3990,
    delivery_1_status:       r1.status,
    delivery_1_response:     t1,
    delivery_2_status:       r2.status,
    delivery_2_response:     t2,
    incidents_before:        before_count,
    incidents_after:         after_count,
    idempotent:              after_count === 1,
    incident_rows:           incidents,
    profile_unchanged:       profile,
    verdict_mismatch_caught: (incidents?.length ?? 0) > 0 && incidents![0].reason === 'amount_mismatch',
    verdict_idempotent:      after_count === 1,
  })
}
