import { createServiceClient } from './supabase-server'
import { PLAN_CREDITS } from './types'
import type { Plan } from './types'

export type ActivationSource = 'paddle' | 'tg_manual' | 'admin' | 'yookassa'

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freeUpdate: any = { plan }
    // plan_expires_at / plan_activated_at columns exist only after migration 001
    freeUpdate.plan_expires_at   = null
    freeUpdate.plan_activated_at = null
    const { error } = await svc.from('profiles').update(freeUpdate).eq('id', userId)
    if (error) {
      // Column may not exist pre-migration; fall back to plan-only update
      if (error.message.includes('column') || error.message.includes('does not exist')) {
        console.warn('[activatePlan] new columns absent, updating plan only:', error.message)
        await svc.from('profiles').update({ plan }).eq('id', userId)
      } else {
        console.error('[activatePlan] free downgrade error:', error.message)
        return { ok: false, error: error.message }
      }
    }
    console.log(`[activatePlan] user=${userId} downgraded to free src=${source}`)
    return { ok: true }
  }

  // plan_expires_at column may not exist yet (pre-migration); treat missing column as null.
  const { data: current } = await svc
    .from('profiles')
    .select('plan_expires_at')
    .eq('id', userId)
    .single()

  const now = new Date()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawExpires = (current as any)?.plan_expires_at as string | null | undefined
  const existingExpires = rawExpires ? new Date(rawExpires) : now
  // If current plan has time left, extend from that date; otherwise start from now
  const base = existingExpires > now ? existingExpires : now
  const newExpires = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const planUpdate: any = {
    plan,
    plan_activated_at: now.toISOString(),
    plan_expires_at:   newExpires.toISOString(),
  }
  const { error: planErr } = await svc.from('profiles').update(planUpdate).eq('id', userId)
  if (planErr) {
    // If new columns absent (pre-migration), update plan only
    if (planErr.message.includes('column') || planErr.message.includes('does not exist')) {
      console.warn('[activatePlan] new columns absent, updating plan only:', planErr.message)
      const { error: planOnlyErr } = await svc.from('profiles').update({ plan }).eq('id', userId)
      if (planOnlyErr) {
        console.error('[activatePlan] plan-only update error:', planOnlyErr.message)
        return { ok: false, error: planOnlyErr.message }
      }
    } else {
      console.error('[activatePlan] plan update error:', planErr.message)
      return { ok: false, error: planErr.message }
    }
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
      // Pre-migration fallback: add_plan_credits doesn't exist until migration 001 runs.
      // After migration this branch is never taken; remove when migration is confirmed live.
      console.warn('[activatePlan] add_plan_credits unavailable, falling back to add_credits:', credErr.message)
      const { error: legacyErr } = await svc.rpc('add_credits', {
        p_user_id:    userId,
        p_amount:     credits,
        p_operation:  `plan_activation_${source}`,
        p_project_id: null,
      })
      if (legacyErr) {
        console.error('[activatePlan] fallback add_credits also failed:', legacyErr.message)
      }
    }
  }

  console.log(
    `[activatePlan] user=${userId} plan=${plan} src=${source} ` +
    `expires=${newExpires.toISOString()} plan_credits=${credits}`,
  )
  return { ok: true, plan_credits: credits, expires_at: newExpires.toISOString() }
}
