import { createServiceClient } from './supabase-server'
import { addCredits } from './credits'
import { sendReferralBonusEmail } from './email'

const REFERRER_BONUS = 20  // credits for the user who shared the link
const REFEREE_BONUS = 5    // extra credits for the newly registered user

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
    .select('id, email, full_name, referral_count, referral_credits_earned, credits')
    .eq('referral_code', code)
    .single()

  if (!referrer) return { ok: false, error: 'Реферальный код не найден' }
  if (referrer.id === newUserId) return { ok: false, error: 'Нельзя использовать собственный код' }

  // Mark referral first (idempotency guard for subsequent steps)
  await supabase
    .from('profiles')
    .update({ referred_by: code })
    .eq('id', newUserId)

  // Credit both parties in parallel
  await Promise.all([
    addCredits(newUserId, REFEREE_BONUS, 'referral_bonus'),
    addCredits(referrer.id, REFERRER_BONUS, 'referral_reward'),
  ])

  // Update referrer stats (display only — credits are already atomic)
  await supabase
    .from('profiles')
    .update({
      referral_count: (referrer.referral_count ?? 0) + 1,
      referral_credits_earned: (referrer.referral_credits_earned ?? 0) + REFERRER_BONUS,
    })
    .eq('id', referrer.id)

  // Fire-and-forget: notify referrer about the bonus
  if (referrer.email) {
    const newUserProfile = await supabase
      .from('profiles')
      .select('email')
      .eq('id', newUserId)
      .single()
    const newUserEmail = newUserProfile.data?.email ?? '—'
    const newBalance = (referrer.credits ?? 0) + REFERRER_BONUS
    void sendReferralBonusEmail(
      { email: referrer.email, name: referrer.full_name },
      newUserEmail,
      REFERRER_BONUS,
      newBalance,
    )
  }

  return { ok: true }
}
