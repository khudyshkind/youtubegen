import { NextRequest, NextResponse } from 'next/server'
import { Paddle, Environment } from '@paddle/paddle-node-sdk'
import type { Subscription, Transaction } from '@paddle/paddle-node-sdk'
import { createServiceClient } from '@/lib/supabase-server'
import { addCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { PLAN_CREDITS } from '@/lib/types'
import type { Plan } from '@/lib/types'

function getPaddle() {
  return new Paddle(env('PADDLE_API_KEY'), {
    environment:
      process.env.NODE_ENV === 'production'
        ? Environment.production
        : Environment.sandbox,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('paddle-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const paddle = getPaddle()
  let event
  try {
    event = await paddle.webhooks.unmarshal(
      body,
      env('PADDLE_WEBHOOK_SECRET'),
      signature
    )
  } catch (err) {
    console.error('[paddle/webhook] signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createServiceClient()

  try {
    switch (event.eventType) {
      case 'subscription.activated': {
        const sub = event.data as Subscription
        const customData = sub.customData as { userId?: string; plan?: Plan } | null
        const userId = customData?.userId
        const plan = customData?.plan

        if (!userId || !plan) break

        await supabase
          .from('profiles')
          .update({
            paddle_customer_id: sub.customerId,
            paddle_subscription_id: sub.id,
            plan,
          })
          .eq('id', userId)

        const credits = PLAN_CREDITS[plan] ?? 0
        if (credits > 0) {
          await addCredits(userId, credits, 'purchase')
        }
        break
      }

      case 'subscription.updated': {
        const sub = event.data as Subscription
        const customData = sub.customData as { plan?: Plan } | null
        const newPlan = customData?.plan

        if (!newPlan) break

        await supabase
          .from('profiles')
          .update({ plan: newPlan })
          .eq('paddle_customer_id', sub.customerId)
        break
      }

      case 'subscription.canceled': {
        const sub = event.data as Subscription
        await supabase
          .from('profiles')
          .update({ plan: 'free', paddle_subscription_id: null })
          .eq('paddle_customer_id', sub.customerId)
        break
      }

      case 'transaction.completed': {
        const tx = event.data as Transaction
        // Only handle renewals (transactions tied to a subscription)
        if (!tx.subscriptionId) break

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, plan')
          .eq('paddle_customer_id', tx.customerId)
          .single()

        if (profile) {
          const credits = PLAN_CREDITS[profile.plan as Plan] ?? 0
          if (credits > 0) {
            await addCredits(profile.id, credits, 'purchase')
          }
        }
        break
      }

      default:
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[paddle/webhook] handler error', error)
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    )
  }
}
