import { createServiceClient } from './supabase-server'
import { REFERRER_BONUS, REFEREE_BONUS } from './referral-config'

export async function applyReferral(
  newUserId: string,
  referralCode: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceClient()
  const code = referralCode.toUpperCase().trim()

  // Guard: check new user profile and whether referral was already applied
  const { data: newUser } = await supabase
    .from('profiles')
    .select('id, referred_by')
    .eq('id', newUserId)
    .single()

  if (!newUser) return { ok: false, error: 'Профиль не найден' }
  if (newUser.referred_by) return { ok: false, error: 'Реферал уже применён' }

  // Find referrer
  const { data: referrer } = await supabase
    .from('profiles')
    .select('id, referral_count')
    .eq('referral_code', code)
    .single()

  if (!referrer) return { ok: false, error: 'Реферальный код не найден' }
  if (referrer.id === newUserId) return { ok: false, error: 'Нельзя использовать собственный код' }

  // Mark referral first (idempotency guard for subsequent steps)
  await supabase
    .from('profiles')
    .update({ referred_by: code })
    .eq('id', newUserId)

  // Stage 1: give new user signup bonus immediately.
  // Uses RPC directly to bypass PLAN_MAX_CREDITS cap in addCredits()
  // (free user starts at 10 000 = cap, so JS wrapper would give 0).
  await supabase.rpc('add_credits', {
    p_user_id:    newUserId,
    p_amount:     REFEREE_BONUS,
    p_operation:  'referral_bonus',
    p_project_id: null,
  })

  // Increment referrer's invite counter (invited count, not conversion count)
  await supabase
    .from('profiles')
    .update({ referral_count: (referrer.referral_count ?? 0) + 1 })
    .eq('id', referrer.id)

  // Stage 2 (referrer gets REFERRER_BONUS when this user first converts to paid)
  // is handled atomically by DB trigger on_profile_plan_upgraded.

  return { ok: true }
}
