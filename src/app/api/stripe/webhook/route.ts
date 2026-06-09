import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServiceClient } from '@/lib/supabase-server'
import { addCredits } from '@/lib/credits'
import { PLAN_CREDITS } from '@/lib/types'
import type { Plan } from '@/lib/types'

// Stripe requires raw body for signature verification — do not use request.json()
export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createServiceClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.userId
        const plan = session.metadata?.plan as Plan | undefined

        if (!userId || !plan) break

        // Save Stripe customer ID on first purchase
        if (session.customer) {
          await supabase
            .from('profiles')
            .update({
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              plan,
            })
            .eq('id', userId)
        }

        // Credit the purchased plan's credits
        const credits = PLAN_CREDITS[plan] ?? 0
        if (credits > 0) {
          await addCredits(userId, credits, 'purchase')
        }
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, plan')
          .eq('stripe_customer_id', customerId)
          .single()

        if (profile) {
          const credits = PLAN_CREDITS[profile.plan as Plan] ?? 0
          if (credits > 0) {
            await addCredits(profile.id, credits, 'purchase')
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        await supabase
          .from('profiles')
          .update({
            plan: 'free',
            stripe_subscription_id: null,
          })
          .eq('stripe_customer_id', customerId)
        break
      }

      default:
        // Unhandled event types are ignored
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[stripe/webhook] handler error', error)
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    )
  }
}
