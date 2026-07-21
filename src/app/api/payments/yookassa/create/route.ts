export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import { PLAN_CREDITS, PLAN_PRICES_RUB, TOPUP_PACKAGES } from '@/lib/types'
import type { Plan } from '@/lib/types'
import { randomUUID } from 'crypto'

const VALID_PLANS = ['basic', 'starter', 'pro', 'agency'] as const

function planDescription(plan: string): string {
  const credits = PLAN_CREDITS[plan as Plan] ?? 0
  const name = plan.charAt(0).toUpperCase() + plan.slice(1)
  return `Подписка Lefiro ${name} — ${credits.toLocaleString('ru-RU')} кредитов, 30 дней`.slice(0, 128)
}

export async function POST(req: NextRequest) {
  const shopId  = env('YOOKASSA_SHOP_ID')
  const secret  = env('YOOKASSA_SECRET_KEY')
  if (!shopId || !secret) {
    return NextResponse.json({ error: 'YooKassa не настроена на сервере' }, { status: 503 })
  }

  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await req.json() as { plan?: string; topup_index?: number }
    const { plan, topup_index: topupIndex } = body

    const isPlan  = typeof plan === 'string'
    const isTopup = typeof topupIndex === 'number'

    if (!isPlan && !isTopup) {
      return NextResponse.json({ error: 'Укажите plan или topup_index' }, { status: 400 })
    }
    if (isPlan && !(VALID_PLANS as readonly string[]).includes(plan)) {
      return NextResponse.json({ error: 'Недопустимый тариф' }, { status: 400 })
    }
    if (isTopup && (topupIndex < 0 || topupIndex >= TOPUP_PACKAGES.length)) {
      return NextResponse.json({ error: 'Недопустимый индекс пакета' }, { status: 400 })
    }

    // Amount — ONLY from types.ts, never from client
    const amountRub = isPlan
      ? PLAN_PRICES_RUB[plan as Exclude<Plan, 'free'>]
      : TOPUP_PACKAGES[topupIndex!].priceRub
    const amountStr = amountRub.toFixed(2)

    const description = isPlan
      ? planDescription(plan)
      : `Пополнение баланса Lefiro — ${TOPUP_PACKAGES[topupIndex!].label}`.slice(0, 128)

    const metadata = isPlan
      ? { user_id: user.id, kind: 'plan',  plan_id:     plan }
      : { user_id: user.id, kind: 'topup', topup_index: topupIndex }

    const appUrl    = env('NEXT_PUBLIC_APP_URL') || 'https://lefiro.co'
    const returnUrl = `${appUrl}/billing?paid=1`

    const paymentBody = {
      amount:       { value: amountStr, currency: 'RUB' },
      capture:      true,
      confirmation: { type: 'redirect', return_url: returnUrl },
      description,
      metadata,
      receipt: {
        customer: { email: user.email },
        items: [
          {
            description,
            quantity:        '1.00',
            amount:          { value: amountStr, currency: 'RUB' },
            vat_code:        1,
            payment_mode:    'full_payment',
            payment_subject: 'service',
          },
        ],
      },
    }

    const idempotenceKey = randomUUID()
    const authHeader     = `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`

    const ykRes = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        Authorization:    authHeader,
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify(paymentBody),
    })

    const ykData = await ykRes.json() as {
      id?: string
      status?: string
      confirmation?: { confirmation_url?: string }
      description?: string
      code?: string
    }

    if (!ykRes.ok) {
      console.error('[yookassa/create] API error:', JSON.stringify(ykData))
      return NextResponse.json(
        { error: ykData.description ?? `YooKassa error ${ykRes.status}` },
        { status: 502 },
      )
    }

    const confirmationUrl = ykData.confirmation?.confirmation_url
    if (!confirmationUrl) {
      console.error('[yookassa/create] no confirmation_url:', JSON.stringify(ykData))
      return NextResponse.json({ error: 'Не получен URL оплаты' }, { status: 502 })
    }

    // Log for payment reconciliation
    console.log(
      `[yookassa/create] payment_id=${ykData.id} user_id=${user.id} ` +
      `kind=${isPlan ? `plan:${plan}` : `topup:${topupIndex}`} ` +
      `amount=${amountStr} idempotence_key=${idempotenceKey}`,
    )

    return NextResponse.json({ ok: true, confirmation_url: confirmationUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[yookassa/create] error:', msg)
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
