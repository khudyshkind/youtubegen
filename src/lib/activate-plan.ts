import { createServiceClient } from './supabase-server'
import { PLAN_CREDITS } from './types'
import type { Plan } from './types'

export type ActivationSource = 'paddle' | 'tg_manual' | 'admin'

/**
 * Unified plan activation: sets plan metadata and adds the monthly plan credit batch.
 * All paths (Paddle, TG manual, admin panel) must go through here.
 *
 * plan='free' → downgrade: clear expiry + activated_at, no credits added.
 * plan=paid   → set activated_at=now, expires_at=max(now,current)+30d, add plan_credits via RPC.
 */
export async function activatePlan(
  userId: string,
  plan: Plan,
  source: ActivationSource,
): Promise<{ ok: boolean; error?: string; plan_credits?: number; expires_at?: string }> {
  const svc = createServiceClient()

  if (plan === 'free') {
    const { error } = await svc
      .from('profiles')
      .update({ plan, plan_expires_at: null, plan_activated_at: null })
      .eq('id', userId)
    if (error) {
      console.error('[activatePlan] free downgrade error:', error.message)
      return { ok: false, error: error.message }
    }
    console.log(`[activatePlan] user=${userId} downgraded to free src=${source}`)
    return { ok: true }
  }

  const { data: current, error: fetchErr } = await svc
    .from('profiles')
    .select('plan_expires_at')
    .eq('id', userId)
    .single()

  if (fetchErr) {
    console.error('[activatePlan] fetch profile error:', fetchErr.message)
    return { ok: false, error: fetchErr.message }
  }

  const now = new Date()
  const existingExpires = current?.plan_expires_at ? new Date(current.plan_expires_at) : now
  // If current plan has time left, extend from that date; otherwise start from now
  const base = existingExpires > now ? existingExpires : now
  const newExpires = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000)

  const { error: planErr } = await svc
    .from('profiles')
    .update({
      plan,
      plan_activated_at: now.toISOString(),
      plan_expires_at:   newExpires.toISOString(),
    })
    .eq('id', userId)

  if (planErr) {
    console.error('[activatePlan] plan update error:', planErr.message)
    return { ok: false, error: planErr.message }
  }

  const credits = PLAN_CREDITS[plan] ?? 0
  if (credits > 0) {
    const { error: credErr } = await svc.rpc('add_plan_credits', {
      p_user_id:    userId,
      p_amount:     credits,
      p_operation:  `plan_activation_${source}`,
      p_project_id: null,
    })
    if (credErr) {
      // Non-fatal: plan metadata is set. Credits can be adjusted manually.
      console.error('[activatePlan] add_plan_credits error:', credErr.message)
    }
  }

  console.log(
    `[activatePlan] user=${userId} plan=${plan} src=${source} ` +
    `expires=${newExpires.toISOString()} plan_credits=${credits}`,
  )
  return { ok: true, plan_credits: credits, expires_at: newExpires.toISOString() }
}
