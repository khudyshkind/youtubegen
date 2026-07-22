export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'

// One-time secret embedded in the route — delete this file after the test.
const EXPECTED_SECRET = 'yk-idem-test-2026-07-22'
const USER_ID = '1bc974fa-10d8-4e26-962d-0cd75eacfb64'

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

async function fetchProfile(svc: ReturnType<typeof createServiceClient>) {
  const { data } = await svc
    .from('profiles')
    .select('credits, plan_credits, purchased_credits, plan, plan_expires_at')
    .eq('id', USER_ID)
    .single()
  return data
}

async function fetchYkPayment(paymentId: string) {
  const shopId = env('YOOKASSA_SHOP_ID')
  const secret = env('YOOKASSA_SECRET_KEY')
  const auth   = `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`
  const res    = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { Authorization: auth },
  })
  if (!res.ok) throw new Error(`YooKassa ${res.status}: ${await res.text()}`)
  return res.json()
}

/** GET /api/internal/idempotency-test?action=snapshot|claims */
export async function GET(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== EXPECTED_SECRET) return unauthorized()
  const svc    = createServiceClient()
  const action = req.nextUrl.searchParams.get('action') ?? 'snapshot'

  if (action === 'claims') {
    const { data, error } = await svc
      .from('bot_settings')
      .select('key, value, updated_at')
      .like('key', 'claim_yookassa_%')
      .order('updated_at', { ascending: false })
    return NextResponse.json({ claims: data, db_error: error?.message ?? null })
  }

  const snap = await fetchProfile(svc)
  return NextResponse.json({ snapshot: snap, action_received: action })
}

/**
 * POST /api/internal/idempotency-test
 * Body: { payment_id: string, label: string }
 * 1. Snapshot BEFORE
 * 2. Fetch real YooKassa payment object
 * 3. POST duplicate webhook to our own endpoint
 * 4. Snapshot AFTER
 * 5. Return full diff
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== EXPECTED_SECRET) return unauthorized()

  const { payment_id, label } = (await req.json()) as { payment_id: string; label: string }
  if (!payment_id) return NextResponse.json({ error: 'payment_id required' }, { status: 400 })

  const svc = createServiceClient()

  // ── 1. Baseline ─────────────────────────────────────────────────────────────
  const before = await fetchProfile(svc)

  // ── 2. Fetch real payment object from YooKassa ───────────────────────────────
  let paymentObject: Record<string, unknown>
  try {
    paymentObject = await fetchYkPayment(payment_id)
  } catch (e) {
    return NextResponse.json({ error: `YooKassa fetch failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  // ── 3. POST duplicate webhook to our own production endpoint ─────────────────
  const appUrl     = (env('NEXT_PUBLIC_APP_URL') || 'https://lefiro.co').replace(/\/$/, '')
  const webhookUrl = `${appUrl}/api/webhooks/yookassa`
  const body       = JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: paymentObject })

  const whRes     = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const whStatus  = whRes.status
  const whBody    = await whRes.text()

  // ── 4. After snapshot ────────────────────────────────────────────────────────
  const after = await fetchProfile(svc)

  // ── 5. Idempotency verdict ───────────────────────────────────────────────────
  const idemOk = JSON.stringify(before) === JSON.stringify(after)

  return NextResponse.json({
    label,
    payment_id,
    webhook_url: webhookUrl,
    webhook_status: whStatus,
    webhook_response: whBody,
    before,
    after,
    idempotent: idemOk,
    verdict: idemOk ? '✅ ДЕРЖИТ — цифры не изменились' : '🔴 НАРУШЕНА — цифры изменились',
  })
}
