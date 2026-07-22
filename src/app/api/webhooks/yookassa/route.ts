export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { activatePlan } from '@/lib/activate-plan'
import { env } from '@/lib/env'
import { PLAN_PRICES_RUB, TOPUP_PACKAGES } from '@/lib/types'
import type { Plan } from '@/lib/types'
import { sendTelegramAlert } from '@/lib/telegram'

const VALID_PLANS = ['basic', 'starter', 'pro', 'agency'] as const

// YooKassa IP ranges (optional allowlist — primary verification is via API re-fetch)
const YK_CIDRS = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.154.128/25',  // covers 77.75.154.128–255 (confirmed production range)
  '77.75.156.11/32',
  '77.75.156.35/32',
]

function ipInCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bits] = cidr.split('/')
    const mask   = ~((1 << (32 - Number(bits))) - 1)
    const toInt  = (s: string) => s.split('.').reduce((a, b) => (a << 8) | Number(b), 0)
    return (toInt(ip) & mask) === (toInt(range) & mask)
  } catch { return false }
}

function isYooKassaIp(rawIp: string): boolean {
  // Vercel passes IPv4-mapped IPv6 (::ffff:x.x.x.x) — normalise to plain IPv4
  const ip = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp
  if (YK_CIDRS.some(cidr => ipInCidr(ip, cidr))) return true
  // YooKassa IPv6 range 2a02:5180::/32
  if (ip.startsWith('2a02:5180:')) return true
  return false
}

// Re-fetch the payment from YooKassa to verify it (don't trust the webhook body).
async function fetchPayment(paymentId: string): Promise<{
  id: string
  status: string
  amount: { value: string; currency: string }
  metadata?: Record<string, string | number>
} | null> {
  const shopId = env('YOOKASSA_SHOP_ID')
  const secret = env('YOOKASSA_SECRET_KEY')
  if (!shopId || !secret) return null

  const authHeader = `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { Authorization: authHeader },
  })
  if (!res.ok) return null
  return res.json()
}

// ── Incident recorder ─────────────────────────────────────────────────────────
interface IncidentParams {
  paymentId:       string
  userId?:         string | null
  kind?:           string | null
  planOrTopup?:    string | null
  amountReceived?: number | null
  amountExpected?: number | null
  reason:          'amount_mismatch' | 'bad_metadata' | 'unknown_plan' | 'activation_failed'
  rawPayload?:     unknown
}

async function recordIncident(svc: ReturnType<typeof createServiceClient>, p: IncidentParams) {
  try {
    // upsert with ignoreDuplicates: true = INSERT ... ON CONFLICT (payment_id) DO NOTHING
    // YooKassa retries the same webhook up to 7× — this ensures only 1 row per payment.
    await svc.from('payment_incidents').upsert({
      payment_id:       p.paymentId,
      user_id:          p.userId         ?? null,
      kind:             p.kind           ?? null,
      plan_or_topup:    p.planOrTopup    ?? null,
      amount_received:  p.amountReceived ?? null,
      amount_expected:  p.amountExpected ?? null,
      reason:           p.reason,
      raw_payload:      p.rawPayload     ?? null,
    }, { onConflict: 'payment_id', ignoreDuplicates: true })
  } catch (e) {
    // Best-effort: never let incident recording crash the webhook handler
    console.error('[yookassa/webhook] recordIncident failed:', e instanceof Error ? e.message : String(e))
  }
}

export async function POST(req: NextRequest) {
  // 503 if env not configured — safe fallback
  if (!env('YOOKASSA_SHOP_ID') || !env('YOOKASSA_SECRET_KEY')) {
    console.warn('[yookassa/webhook] env not configured — returning 200 to stop retries')
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  let rawBody = ''
  try {
    rawBody = await req.text()
  } catch (e) {
    console.error('[yookassa/webhook] failed to read request body:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: true })
  }

  // Log YooKassa IP for monitoring (verification via API re-fetch below)
  const rawClientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const clientIp    = rawClientIp.startsWith('::ffff:') ? rawClientIp.slice(7) : rawClientIp
  const ipOk        = isYooKassaIp(rawClientIp)
  if (!ipOk) {
    console.warn(`[yookassa/webhook] unexpected source IP: ${rawClientIp} (normalised: ${clientIp}) — proceeding with API re-fetch verification`)
  }

  // YooKassa body: { type: "notification", event: "payment.succeeded", object: {...} }
  // The "type" field is always "notification"; the actual event name is in "event".
  let body: {
    type:   string  // always "notification"
    event:  string  // "payment.succeeded" | "payment.canceled" | "refund.succeeded" | …
    object: { id: string }
  }
  try {
    body = JSON.parse(rawBody)
  } catch {
    console.error('[yookassa/webhook] invalid JSON body')
    return NextResponse.json({ ok: true })
  }

  // Ack all non-succeeded events immediately (ЮKassa expects 200 for all notifications)
  if (body.event !== 'payment.succeeded') {
    console.log(`[yookassa/webhook] event=${body.event} — acknowledged`)
    return NextResponse.json({ ok: true })
  }

  const paymentId = body.object?.id
  if (!paymentId) {
    console.error('[yookassa/webhook] payment.succeeded without object.id')
    return NextResponse.json({ ok: true })
  }

  // ── Verification: re-fetch from YooKassa API ──────────────────────────────
  const payment = await fetchPayment(paymentId)
  if (!payment) {
    console.error(`[yookassa/webhook] failed to re-fetch payment ${paymentId}`)
    await sendTelegramAlert(`🔴 <b>YooKassa webhook</b>\nНе удалось проверить платёж: <code>${paymentId}</code>`)
    return NextResponse.json({ ok: false, error: 'verification failed' }, { status: 500 })
  }

  if (payment.status !== 'succeeded') {
    console.warn(`[yookassa/webhook] payment ${paymentId} status=${payment.status} — not succeeded, ignoring`)
    return NextResponse.json({ ok: true })
  }

  const svc     = createServiceClient()
  const meta    = payment.metadata ?? {}
  const userId  = meta.user_id as string | undefined
  const kind    = meta.kind    as string | undefined
  const actualAmount = parseFloat(payment.amount.value)

  if (!userId || !kind) {
    console.error(`[yookassa/webhook] payment ${paymentId} missing metadata user_id or kind`)
    await Promise.all([
      recordIncident(svc, {
        paymentId,
        userId:          userId ?? null,
        kind:            kind   ?? null,
        amountReceived:  actualAmount,
        reason:          'bad_metadata',
        rawPayload:      payment,
      }),
      sendTelegramAlert(
        `🔴 <b>YooKassa — битые метаданные</b>\npayment_id: <code>${paymentId}</code>\nuser_id: <code>${userId ?? 'ОТСУТСТВУЕТ'}</code>\nkind: <code>${kind ?? 'ОТСУТСТВУЕТ'}</code>\nСумма: ${actualAmount} ₽\n⚠️ Зафиксировано в payment_incidents`,
      ),
    ])
    return NextResponse.json({ ok: true })
  }

  // ── Amount verification against types.ts ──────────────────────────────────
  let expectedAmount: number

  // Log parsed metadata to help trace activation failures
  console.log(`[yookassa/webhook] payment ${paymentId} meta: kind=${kind} user_id=${userId} topup_index=${meta.topup_index ?? 'n/a'} plan_id=${meta.plan_id ?? 'n/a'}`)

  if (kind === 'plan') {
    const planId = meta.plan_id as string
    if (!(VALID_PLANS as readonly string[]).includes(planId)) {
      console.error(`[yookassa/webhook] unknown plan_id=${planId} for payment ${paymentId}`)
      await Promise.all([
        recordIncident(svc, {
          paymentId,
          userId,
          kind,
          planOrTopup:     planId,
          amountReceived:  actualAmount,
          reason:          'unknown_plan',
          rawPayload:      payment,
        }),
        sendTelegramAlert(
          `🔴 <b>YooKassa — неизвестный plan_id</b>\npayment_id: <code>${paymentId}</code>\nuser_id: <code>${userId}</code>\nplan_id: <code>${planId}</code>\nСумма: ${actualAmount} ₽\n⚠️ Зафиксировано в payment_incidents`,
        ),
      ])
      return NextResponse.json({ ok: true })
    }
    expectedAmount = PLAN_PRICES_RUB[planId as Exclude<Plan, 'free'>]
  } else if (kind === 'topup') {
    const idx = Number(meta.topup_index)
    if (isNaN(idx) || idx < 0 || idx >= TOPUP_PACKAGES.length) {
      console.error(`[yookassa/webhook] invalid topup_index=${String(meta.topup_index)} (parsed=${idx}) for payment ${paymentId}`)
      await Promise.all([
        recordIncident(svc, {
          paymentId,
          userId,
          kind,
          planOrTopup:     String(meta.topup_index ?? 'undefined'),
          amountReceived:  actualAmount,
          reason:          'unknown_plan',
          rawPayload:      payment,
        }),
        sendTelegramAlert(
          `🔴 <b>YooKassa — неверный topup_index</b>\npayment_id: <code>${paymentId}</code>\nuser_id: <code>${userId}</code>\ntopup_index: <code>${String(meta.topup_index)}</code>\nСумма: ${actualAmount} ₽\n⚠️ Зафиксировано в payment_incidents`,
        ),
      ])
      return NextResponse.json({ ok: true })
    }
    expectedAmount = TOPUP_PACKAGES[idx].priceRub
  } else {
    console.error(`[yookassa/webhook] unknown kind=${kind} for payment ${paymentId}`)
    await Promise.all([
      recordIncident(svc, {
        paymentId,
        userId,
        kind,
        amountReceived:  actualAmount,
        reason:          'unknown_plan',
        rawPayload:      payment,
      }),
      sendTelegramAlert(
        `🔴 <b>YooKassa — неизвестный kind</b>\npayment_id: <code>${paymentId}</code>\nuser_id: <code>${userId}</code>\nkind: <code>${kind}</code>\nСумма: ${actualAmount} ₽\n⚠️ Зафиксировано в payment_incidents`,
      ),
    ])
    return NextResponse.json({ ok: true })
  }

  if (Math.abs(actualAmount - expectedAmount) > 0.01) {
    console.error(`[yookassa/webhook] amount mismatch: got ${actualAmount}, expected ${expectedAmount} for ${kind}`)
    await Promise.all([
      recordIncident(svc, {
        paymentId,
        userId,
        kind,
        planOrTopup:     kind === 'plan' ? String(meta.plan_id) : String(meta.topup_index),
        amountReceived:  actualAmount,
        amountExpected:  expectedAmount,
        reason:          'amount_mismatch',
        rawPayload:      payment,
      }),
      sendTelegramAlert(
        `🔴 <b>YooKassa — сумма не совпала</b>\npayment_id: <code>${paymentId}</code>\nuser_id: <code>${userId}</code>\nВид: ${kind} · ${kind === 'plan' ? meta.plan_id : `топап[${meta.topup_index}]`}\nОжидали: <b>${expectedAmount} ₽</b> · Получили: <b>${actualAmount} ₽</b>\n⚠️ Зафиксировано в payment_incidents`,
      ),
    ])
    return NextResponse.json({ ok: true }) // 200 to stop retries
  }

  // ── Idempotency check ──────────────────────────────────────────────────────
  const claimKey  = `claim_yookassa_${paymentId}`

  const { data: existing } = await svc
    .from('bot_settings')
    .select('value')
    .eq('key', claimKey)
    .single()

  if (existing?.value === 'activated') {
    console.log(`[yookassa/webhook] payment ${paymentId} already activated — skipping duplicate webhook`)
    return NextResponse.json({ ok: true, already_activated: true })
  }

  // ── Activation ────────────────────────────────────────────────────────────
  if (kind === 'plan') {
    const planId = meta.plan_id as string
    const result = await activatePlan(userId, planId as Plan, 'yookassa')
    if (!result.ok) {
      console.error(`[yookassa/webhook] activatePlan failed: ${result.error}`)
      await Promise.all([
        recordIncident(svc, {
          paymentId,
          userId,
          kind,
          planOrTopup:    planId,
          amountReceived: actualAmount,
          amountExpected: expectedAmount,
          reason:         'activation_failed',
          rawPayload:     payment,
        }),
        sendTelegramAlert(
          `🔴 <b>YooKassa — activatePlan упал</b>\npayment_id: <code>${paymentId}</code>\nuser_id: <code>${userId}</code>\nplan: ${planId} · ${expectedAmount} ₽\nerror: ${result.error}\n⚠️ Зафиксировано в payment_incidents`,
        ),
      ])
      return NextResponse.json({ ok: false, error: 'activation failed' }, { status: 500 })
    }

    // Mark claim as used
    await svc.from('bot_settings').upsert(
      { key: claimKey, value: 'activated', updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

    console.log(`[yookassa/webhook] plan activated: user=${userId} plan=${planId} payment=${paymentId} expires=${result.expires_at}`)
    await sendTelegramAlert(
      `✅ <b>YooKassa — план оплачен</b>\nuser_id: <code>${userId}</code>\nПлан: <b>${planId}</b> · ${expectedAmount} ₽\nДо: ${result.expires_at?.slice(0, 10) ?? '?'}\npayment_id: <code>${paymentId}</code>`,
    )

  } else {
    // kind === 'topup'
    const idx = Number(meta.topup_index)
    const pkg = TOPUP_PACKAGES[idx]

    const { error: credErr } = await svc.rpc('add_purchased_credits', {
      p_user_id:    userId,
      p_amount:     pkg.credits,
      p_operation:  'topup_yookassa',
      p_project_id: null,
    })

    if (credErr) {
      // Pre-migration fallback
      console.warn('[yookassa/webhook] add_purchased_credits unavailable, falling back:', credErr.message)
      const { error: legacyErr } = await svc.rpc('add_credits', {
        p_user_id:    userId,
        p_amount:     pkg.credits,
        p_operation:  'topup_yookassa',
        p_project_id: null,
      })
      if (legacyErr) {
        console.error('[yookassa/webhook] topup fallback failed:', legacyErr.message)
        await Promise.all([
          recordIncident(svc, {
            paymentId,
            userId,
            kind,
            planOrTopup:    String(idx),
            amountReceived: actualAmount,
            amountExpected: expectedAmount,
            reason:         'activation_failed',
            rawPayload:     payment,
          }),
          sendTelegramAlert(
            `🔴 <b>YooKassa — начисление кредитов упало</b>\npayment_id: <code>${paymentId}</code>\nuser_id: <code>${userId}</code>\nкредиты: ${pkg.credits} · ${expectedAmount} ₽\nerror: ${legacyErr.message}\n⚠️ Зафиксировано в payment_incidents`,
          ),
        ])
        return NextResponse.json({ ok: false, error: 'credit add failed' }, { status: 500 })
      }
    }

    // Mark claim as used
    await svc.from('bot_settings').upsert(
      { key: claimKey, value: 'activated', updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

    console.log(`[yookassa/webhook] topup credited: user=${userId} credits=${pkg.credits} payment=${paymentId}`)
    await sendTelegramAlert(
      `✅ <b>YooKassa — топап оплачен</b>\nuser_id: <code>${userId}</code>\nКредиты: <b>+${pkg.credits.toLocaleString('ru-RU')}</b> · ${expectedAmount} ₽\npayment_id: <code>${paymentId}</code>`,
    )
  }

  return NextResponse.json({ ok: true })
}
