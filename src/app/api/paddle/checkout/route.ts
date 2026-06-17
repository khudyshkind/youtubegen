import { NextRequest, NextResponse } from 'next/server'
import { Paddle, Environment } from '@paddle/paddle-node-sdk'
import { createServerSupabase, getProfile } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import { TOPUP_PACKAGES } from '@/lib/types'
import type { Plan } from '@/lib/types'

function getPaddle() {
  const useSandbox = process.env.PADDLE_SANDBOX === 'true'
  return new Paddle(env('PADDLE_API_KEY'), {
    environment: useSandbox ? Environment.sandbox : Environment.production,
  })
}

function getPlanPriceIds(): Record<Exclude<Plan, 'free'>, string> {
  const ids = {
    basic:   process.env.PADDLE_PRICE_BASIC,
    starter: process.env.PADDLE_PRICE_STARTER,
    pro:     process.env.PADDLE_PRICE_PRO,
    agency:  process.env.PADDLE_PRICE_AGENCY,
  }
  console.log('[checkout] plan price ids:', ids)
  return ids as Record<Exclude<Plan, 'free'>, string>
}

function getTopupPriceIds(): string[] {
  const ids = [
    process.env.PADDLE_PRICE_TOPUP_500,
    process.env.PADDLE_PRICE_TOPUP_2000,
    process.env.PADDLE_PRICE_TOPUP_5000,
  ]
  console.log('[checkout] topup price ids:', ids)
  return ids as string[]
}

interface CheckoutRequest {
  plan?: Exclude<Plan, 'free'>
  topup_index?: number  // 0 | 1 | 2 — index into TOPUP_PACKAGES
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { plan, topup_index }: CheckoutRequest = await request.json()

    const paddle = getPaddle()
    const profile = await getProfile(user.id)

    let priceId: string
    let customData: Record<string, unknown>

    if (topup_index !== undefined) {
      // One-time topup purchase
      const pkg = TOPUP_PACKAGES[topup_index]
      if (!pkg) {
        return NextResponse.json({ ok: false, error: 'Неверный пакет кредитов' }, { status: 400 })
      }
      priceId = getTopupPriceIds()[topup_index]
      if (!priceId) {
        return NextResponse.json({ ok: false, error: 'Paddle price ID для топапа не настроен' }, { status: 500 })
      }
      customData = { userId: user.id, type: 'topup', credits: pkg.credits }
    } else if (plan) {
      // Subscription plan
      priceId = getPlanPriceIds()[plan]
      if (!priceId) {
        return NextResponse.json({ ok: false, error: 'Неверный тарифный план' }, { status: 400 })
      }
      customData = { userId: user.id, plan }
    } else {
      return NextResponse.json({ ok: false, error: 'Укажи plan или topup_index' }, { status: 400 })
    }

    const transactionBody: Parameters<typeof paddle.transactions.create>[0] = {
      items: [{ priceId, quantity: 1 }],
      customData,
    }

    if (profile?.paddle_customer_id) {
      transactionBody.customerId = profile.paddle_customer_id
    }

    console.log('[checkout] creating transaction, priceId:', priceId, 'customData:', customData)
    const transaction = await paddle.transactions.create(transactionBody)
    console.log('[checkout] transaction id:', transaction.id, 'status:', transaction.status, 'checkout:', transaction.checkout)
    const checkoutUrl = transaction.checkout?.url

    if (!checkoutUrl) {
      console.error('[checkout] no checkout URL in response:', JSON.stringify(transaction.checkout))
      return NextResponse.json({ ok: false, error: 'Не удалось получить ссылку на оплату' }, { status: 502 })
    }

    return NextResponse.json({ ok: true, data: { url: checkoutUrl } })
  } catch (error) {
    console.error('[paddle/checkout] error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: `Ошибка создания сессии оплаты: ${msg}` }, { status: 500 })
  }
}
