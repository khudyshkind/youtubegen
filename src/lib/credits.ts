import { createServiceClient } from './supabase-server'
import { CREDIT_COSTS, PLAN_MAX_CREDITS } from './types'
import { sendLowCreditsEmail } from './email'
import type { ApiResponse, Plan } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

const LOW_CREDITS_THRESHOLD = 5

export async function hasCredits(
  userId: string,
  amount: number,
  supabase?: SupabaseClient
): Promise<boolean> {
  const client = supabase ?? createServiceClient()
  const { data } = await client
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single()
  return (data?.credits ?? 0) >= amount
}

export async function spendCredits(
  userId: string,
  amount: number,
  operation: string,
  projectId?: string
): Promise<{ ok: boolean; remaining: number }> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_operation: operation,
    p_project_id: projectId ?? null,
  })

  if (error || !(data as { success: boolean })?.success) {
    return { ok: false, remaining: 0 }
  }

  const remaining = (data as { remaining: number }).remaining

  // Fire-and-forget low balance alert
  if (remaining < LOW_CREDITS_THRESHOLD) {
    void (async () => {
      try {
        const svc = createServiceClient()
        const { data: profile } = await svc.from('profiles').select('email, full_name').eq('id', userId).single()
        if (profile?.email) {
          await sendLowCreditsEmail({ email: profile.email, name: profile.full_name }, remaining)
        }
      } catch (e) {
        console.error('[credits] sendLowCreditsEmail error:', e)
      }
    })()
  }

  return { ok: true, remaining }
}

export async function addCredits(
  userId: string,
  amount: number,
  operation: 'purchase' | 'signup_bonus' | 'referral_bonus' | 'referral_reward' | 'topup',
  projectId?: string
): Promise<void> {
  const supabase = createServiceClient()

  // Enforce per-plan maximum balance
  const { data: profile } = await supabase
    .from('profiles')
    .select('credits, plan')
    .eq('id', userId)
    .single()

  let creditsToAdd = amount
  if (profile) {
    const maxCredits = PLAN_MAX_CREDITS[profile.plan as Plan] ?? amount
    const current = profile.credits ?? 0
    creditsToAdd = Math.max(0, Math.min(amount, maxCredits - current))
  }

  if (creditsToAdd <= 0) return

  await supabase.rpc('add_credits', {
    p_user_id: userId,
    p_amount: creditsToAdd,
    p_operation: operation,
    p_project_id: projectId ?? null,
  })
}

export async function requireCreditsAmount(
  userId: string,
  amount: number,
  supabase?: SupabaseClient
): Promise<ApiResponse<{ credits: number }>> {
  const client = supabase ?? createServiceClient()
  const { data, error } = await client
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[requireCreditsAmount] DB error:', error.message)
    return { ok: false, error: 'Ошибка проверки кредитов', code: 'NO_CREDITS' }
  }

  const credits = data?.credits ?? 0
  if (credits < amount) {
    return { ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }
  }
  return { ok: true, data: { credits } }
}

// Pass the user's session supabase client so the JWT satisfies RLS — no service role needed
export async function requireCredits(
  userId: string,
  operation: keyof typeof CREDIT_COSTS,
  supabase?: SupabaseClient
): Promise<ApiResponse<{ credits: number }>> {
  const cost = CREDIT_COSTS[operation]
  const client = supabase ?? createServiceClient()
  const { data, error } = await client
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[requireCredits] DB error:', error.message, '| op:', operation)
    return { ok: false, error: 'Ошибка проверки кредитов', code: 'NO_CREDITS' }
  }

  const credits = data?.credits ?? 0
  if (credits < cost) {
    return { ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }
  }
  return { ok: true, data: { credits } }
}
