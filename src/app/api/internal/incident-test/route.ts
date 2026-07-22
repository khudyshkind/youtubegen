export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'

const EXPECTED_SECRET = 'incident-test-2026-07-22'
const USER_ID         = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'
// Pro plan payment: real YooKassa test payment, amount=3990 ₽.
// PLAN_PRICES_RUB.pro is temporarily set to 99990 → mismatch will fire.
const PRO_PAYMENT_ID  = '31f2b91f-000f-5001-8000-14fe55f57490'

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

/** GET ?action=snapshot|incidents */
export async function GET(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== EXPECTED_SECRET) return unauthorized()
  const svc    = createServiceClient()
  const action = req.nextUrl.searchParams.get('action') ?? 'snapshot'

  if (action === 'incidents') {
    const { data } = await svc
      .from('payment_incidents')
      .select('*')
      .eq('payment_id', PRO_PAYMENT_ID)
      .order('created_at', { ascending: false })
    return NextResponse.json({ incidents: data })
  }

  const { data: profile } = await svc
    .from('profiles')
    .select('credits, plan_credits, purchased_credits, plan, plan_expires_at')
    .eq('id', USER_ID)
    .single()
  return NextResponse.json({ snapshot: profile })
}

/**
 * POST — full acceptance sequence:
 * 1. Baseline snapshot
 * 2. Clear previous test incident for this payment_id
 * 3. First webhook delivery (real Pro payment_id; PLAN_PRICES_RUB.pro = 99990 ≠ 3990)
 *    → amount_mismatch → incident row created
 * 4. Second webhook delivery (same payload) → idempotent, still 1 row
 * 5. Snapshot AFTER — profile must be unchanged
 * 6. Return full report
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== EXPECTED_SECRET) return unauthorized()
  const svc = createServiceClient()

  // 1. Baseline
  const { data: before } = await svc
    .from('profiles')
    .select('credits, plan_credits, purchased_credits, plan, plan_expires_at')
    .eq('id', USER_ID)
    .single()

  // 2. Clear any stale test incident (fresh run)
  await svc.from('payment_incidents').delete().eq('payment_id', PRO_PAYMENT_ID)

  // 3. Webhook body — real payment_id, no tampering.
  //    The webhook will re-fetch from YooKassa (amount=3990) and compare
  //    against PLAN_PRICES_RUB.pro=99990 → mismatch fires.
  const appUrl      = (env('NEXT_PUBLIC_APP_URL') || 'https://lefiro.co').replace(/\/$/, '')
  const webhookUrl  = `${appUrl}/api/webhooks/yookassa`
  const webhookBody = JSON.stringify({
    type:   'notification',
    event:  'payment.succeeded',
    object: { id: PRO_PAYMENT_ID },
  })

  // Delivery 1
  const r1 = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: webhookBody })
  const t1 = await r1.text()

  // Short pause so the upsert settles
  await new Promise(r => setTimeout(r, 500))

  // Delivery 2 (idempotency — must NOT create a second row)
  const r2 = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: webhookBody })
  const t2 = await r2.text()

  await new Promise(r => setTimeout(r, 300))

  // 4. Check incident rows
  const { data: incidents, count } = await svc
    .from('payment_incidents')
    .select('*', { count: 'exact' })
    .eq('payment_id', PRO_PAYMENT_ID)

  // 5. Profile after — must be identical to baseline
  const { data: after } = await svc
    .from('profiles')
    .select('credits, plan_credits, purchased_credits, plan, plan_expires_at')
    .eq('id', USER_ID)
    .single()

  const profileUnchanged = JSON.stringify(before) === JSON.stringify(after)
  const incidentCreated  = (count ?? 0) === 1
  const incidentRow      = incidents?.[0]

  return NextResponse.json({
    webhook_url:          webhookUrl,
    pro_payment_id:       PRO_PAYMENT_ID,
    delivery_1_status:    r1.status,
    delivery_1_response:  t1,
    delivery_2_status:    r2.status,
    delivery_2_response:  t2,
    incident_row_count:   count,
    incident_row:         incidentRow ?? null,
    profile_before:       before,
    profile_after:        after,
    verdicts: {
      incident_created:   incidentCreated  ? '✅ строка создана' : '🔴 строки нет',
      idempotent:         incidentCreated  ? '✅ 1 строка, не 2' : '🔴 не проверить',
      credits_unchanged:  profileUnchanged ? '✅ кредиты не изменились' : '🔴 КРЕДИТЫ ИЗМЕНИЛИСЬ',
      reason_correct:     incidentRow?.reason === 'amount_mismatch' ? '✅ amount_mismatch' : `🔴 reason=${incidentRow?.reason}`,
      amounts_filled:     (incidentRow?.amount_received != null && incidentRow?.amount_expected != null)
                            ? `✅ received=${incidentRow.amount_received} expected=${incidentRow.amount_expected}`
                            : '🔴 суммы не заполнены',
    },
  })
}
