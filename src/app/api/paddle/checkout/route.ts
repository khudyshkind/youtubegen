import { NextRequest, NextResponse } from 'next/server'
import { Paddle, Environment } from '@paddle/paddle-node-sdk'
import { createServerSupabase, getProfile } from '@/lib/supabase-server'
import type { Plan } from '@/lib/types'

function getPaddle() {
  return new Paddle(process.env.PADDLE_API_KEY!, {
    environment:
      process.env.NODE_ENV === 'production'
        ? Environment.production
        : Environment.sandbox,
  })
}

function getPriceIds(): Record<Exclude<Plan, 'free'>, string> {
  return {
    starter: process.env.PADDLE_PRICE_STARTER!,
    pro: process.env.PADDLE_PRICE_PRO!,
    agency: process.env.PADDLE_PRICE_AGENCY!,
  }
}

interface CheckoutRequest {
  plan: Exclude<Plan, 'free'>
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Необходима авторизация' },
        { status: 401 }
      )
    }

    const { plan }: CheckoutRequest = await request.json()

    const priceId = getPriceIds()[plan]
    if (!priceId) {
      return NextResponse.json(
        { ok: false, error: 'Неверный тарифный план' },
        { status: 400 }
      )
    }

    const paddle = getPaddle()
    const profile = await getProfile(user.id)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    const transactionBody: Parameters<typeof paddle.transactions.create>[0] = {
      items: [{ priceId, quantity: 1 }],
      customData: { userId: user.id, plan } as Record<string, unknown>,
    }

    // Attach existing Paddle customer to pre-fill checkout form
    if (profile?.paddle_customer_id) {
      transactionBody.customerId = profile.paddle_customer_id
    }

    const transaction = await paddle.transactions.create(transactionBody)

    const checkoutUrl = transaction.checkout?.url
    if (!checkoutUrl) {
      return NextResponse.json(
        { ok: false, error: 'Не удалось получить ссылку на оплату' },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true, data: { url: checkoutUrl } })
  } catch (error) {
    console.error('[paddle/checkout]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка создания сессии оплаты' },
      { status: 500 }
    )
  }
}
