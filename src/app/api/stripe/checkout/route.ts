import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerSupabase, getProfile } from '@/lib/supabase-server'
import type { Plan } from '@/lib/types'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!)
}

function getPriceIds(): Record<Exclude<Plan, 'free'>, string> {
  return {
    starter: process.env.STRIPE_PRICE_STARTER!,
    pro: process.env.STRIPE_PRICE_PRO!,
    agency: process.env.STRIPE_PRICE_AGENCY!,
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

    const stripe = getStripe()
    const priceId = getPriceIds()[plan]
    if (!priceId) {
      return NextResponse.json(
        { ok: false, error: 'Неверный тарифный план' },
        { status: 400 }
      )
    }

    const profile = await getProfile(user.id)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${appUrl}/billing?success=true&plan=${plan}`,
      cancel_url: `${appUrl}/billing?canceled=true`,
      metadata: { userId: user.id, plan },
    }

    // Attach to existing Stripe customer if available
    if (profile?.stripe_customer_id) {
      sessionParams.customer = profile.stripe_customer_id
    } else {
      sessionParams.customer_email = user.email ?? undefined
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    return NextResponse.json({ ok: true, data: { url: session.url } })
  } catch (error) {
    console.error('[stripe/checkout]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка создания сессии оплаты' },
      { status: 500 }
    )
  }
}
