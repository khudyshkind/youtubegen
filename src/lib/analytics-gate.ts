import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export function byokRequiredResponse(lang = 'ru'): NextResponse {
  const isRu = lang !== 'en'
  return NextResponse.json(
    {
      ok: false,
      error: isRu
        ? 'Аналитика на бесплатном тарифе доступна с вашим YouTube API-ключом. Загрузите ключ в настройках или перейдите на платный тариф для доступа без ключа.'
        : 'Analytics on the free plan requires your own YouTube API key. Add your key in Settings or upgrade to a paid plan for access without a key.',
      code: 'byok_required',
    },
    { status: 403 }
  )
}

/**
 * Gate for analytics routes: free users need their own YouTube API key (BYOK).
 * Returns 403 byok_required if the user is on the free plan without a key.
 * Returns null if the request should proceed.
 *
 * Note: profiles.youtube_api_key is added in 3b. Until then, the combined
 * query fails gracefully and free users are blocked (expected behaviour for 3a).
 */
export async function checkAnalyticsGate(
  userId: string,
  supabase: SupabaseClient,
  lang = 'ru'
): Promise<NextResponse | null> {
  let plan: string | null = null
  let hasKey = false

  // Attempt combined query — succeeds after 3b adds the youtube_api_key column
  const { data: full, error: fullErr } = await supabase
    .from('profiles')
    .select('plan, youtube_api_key')
    .eq('id', userId)
    .single()

  if (!fullErr && full) {
    plan = (full as { plan: string; youtube_api_key?: string | null }).plan
    hasKey = !!(full as { youtube_api_key?: string | null }).youtube_api_key
  } else {
    // Column missing (pre-3b) or other transient error — fall back to plan-only read
    const { data: planRow } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', userId)
      .single()
    plan = planRow?.plan ?? null
    hasKey = false  // column absent → treat as no key → free users blocked
  }

  if (!plan) return null           // fail open — credits check covers real auth issues
  if (plan !== 'free') return null  // paid plans: always pass

  // Free plan without own YouTube API key → blocked
  if (!hasKey) return byokRequiredResponse(lang)
  return null
}
