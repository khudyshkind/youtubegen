import { createServiceClient } from './supabase-server'
import { CREDIT_COSTS } from './types'
import type { ApiResponse } from './types'

export async function hasCredits(userId: string, amount: number): Promise<boolean> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single()
  return (data?.credits ?? 0) >= amount
}

export async function spendCredits(
  userId: string,
  amount: number,
  operation: keyof typeof CREDIT_COSTS,
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

  return { ok: true, remaining: (data as { remaining: number }).remaining }
}

export async function addCredits(
  userId: string,
  amount: number,
  operation: 'purchase' | 'signup_bonus',
  projectId?: string
): Promise<void> {
  const supabase = createServiceClient()
  await supabase.rpc('add_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_operation: operation,
    p_project_id: projectId ?? null,
  })
}

// Call before every paid API operation — returns 402 if not enough credits
export async function requireCredits(
  userId: string,
  operation: keyof typeof CREDIT_COSTS
): Promise<ApiResponse<{ credits: number }>> {
  const cost = CREDIT_COSTS[operation]
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single()

  const credits = data?.credits ?? 0
  if (credits < cost) {
    return { ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }
  }
  return { ok: true, data: { credits } }
}
