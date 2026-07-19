import { NextRequest, NextResponse } from 'next/server'
import { Paddle, Environment } from '@paddle/paddle-node-sdk'
import type { Subscription, Transaction } from '@paddle/paddle-node-sdk'
import { createServiceClient } from '@/lib/supabase-server'
import { addCredits } from '@/lib/credits'
import { activatePlan } from '@/lib/activate-plan'
import { env } from '@/lib/env'
import type { Plan } from '@/lib/types'

function getPaddle() {
  const useSandbox = process.env.PADDLE_SANDBOX === 'true'
  return new Paddle(env('PADDLE_API_KEY'), {
    environment: useSandbox ? Environment.sandbox : Environment.production,
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
            paddle_customer_id:     sub.customerId,
            paddle_subscription_id: sub.id,
          })
          .eq('id', userId)

        await activatePlan(userId, plan, 'paddle')
        break
      }

      case 'subscription.updated': {
        // Plan label change only (no credit adjustment — user gets new plan's credits on next renewal).
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
        // Do NOT downgrade plan immediately — access continues until end of billing period.
        // Étape 2 cron handles downgrade when plan_expires_at passes.
        const sub = event.data as Subscription
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, unknown> = { paddle_subscription_id: null }

        // Preserve access until the end of the current billing period if available
        const periodEnd = sub.currentBillingPeriod?.endsAt
        if (periodEnd) {
          const endDate = new Date(periodEnd)
          if (endDate > new Date()) {
            updateData.plan_expires_at = endDate.toISOString()
            console.log(`[paddle/webhook] canceled: access until ${endDate.toISOString()}`)
          }
        }

        await supabase
          .from('profiles')
          .update(updateData)
          .eq('paddle_customer_id', sub.customerId)
        break
      }

      case 'transaction.completed': {
        const tx = event.data as Transaction
        const customData = tx.customData as { userId?: string; type?: string; credits?: number; plan?: Plan } | null

        if (!tx.subscriptionId) {
          // One-time topup purchase → eternal wallet, no cap
          const userId = customData?.userId
          const credits = customData?.credits
          if (userId && credits && credits > 0) {
            await addCredits(userId, credits, 'topup')
          }
          break
        }

        // Subscription renewal — add this period's plan credit batch
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, plan')
          .eq('paddle_customer_id', tx.customerId)
          .single()

        if (profile) {
          await activatePlan(profile.id, profile.plan as Plan, 'paddle')
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
