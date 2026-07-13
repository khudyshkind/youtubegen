import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptKey } from './crypto'
import { env } from './env'

// ─── Response helpers ──────────────────────────────────────────────────────────

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

// ─── Analytics context (single DB read) ───────────────────────────────────────

export interface AnalyticsContext {
  /** Non-null → caller must return this response immediately */
  gateRes: NextResponse | null
  /** Resolved YouTube API key: user's decrypted key or shared env key */
  apiKey: string
  /** Shared env key to use if user's key hits quota (paid plans only) */
  fallbackKey: string | null
  /** True when user supplied their own decrypted key (applies 30% discount) */
  userHasKey: boolean
  /** User plan string */
  plan: string
  /** Returns base cost with 30% BYOK discount when userHasKey=true */
  cost: (base: number) => number
}

/**
 * Single DB read combining gate check + key resolution + discount.
 * Must be called with a service_role Supabase client so it can read
 * the encrypted_yt_key column without RLS restriction.
 * Falls open on any DB error (credits check catches real auth issues).
 */
export async function resolveAnalyticsContext(
  userId: string,
  svc: SupabaseClient,
  lang = 'ru'
): Promise<AnalyticsContext> {
  const sharedKey = env('YOUTUBE_API_KEY')
  const failOpen: AnalyticsContext = {
    gateRes: null,
    apiKey: sharedKey,
    fallbackKey: null,
    userHasKey: false,
    plan: 'paid',
    cost: (b) => b,
  }

  const { data, error } = await svc
    .from('profiles')
    .select('plan, encrypted_yt_key')
    .eq('id', userId)
    .single()

  if (error || !data) return failOpen

  const plan: string = (data as { plan: string }).plan
  const encryptedKey: string | null =
    (data as { encrypted_yt_key?: string | null }).encrypted_yt_key ?? null
  const hasEncryptedKey = !!encryptedKey

  // Decrypt BEFORE gate decision so the gate knows the real key status,
  // not just whether the field is non-null.
  let apiKey = sharedKey
  let fallbackKey: string | null = null
  let userHasKey = false

  if (hasEncryptedKey && encryptedKey) {
    try {
      const decrypted = decryptKey(encryptedKey)
      apiKey = decrypted
      userHasKey = true
      // Paid users can fall back to shared key when their quota runs out
      if (plan !== 'free') fallbackKey = sharedKey
    } catch {
      if (plan === 'free') {
        // Corrupted key = no working key for free plan → gate fires.
        // Never fall back to shared quota for free users.
        return { ...failOpen, plan, gateRes: byokRequiredResponse(lang) }
      }
      // Paid plan: decryption failed → shared key fallback, no discount
    }
  }

  // Gate: free plan requires a successfully decrypted working key
  if (plan === 'free' && !userHasKey) {
    return { ...failOpen, plan, gateRes: byokRequiredResponse(lang) }
  }

  const cost = userHasKey
    ? (b: number) => Math.round(b * 0.7)
    : (b: number) => b

  return { gateRes: null, apiKey, fallbackKey, userHasKey, plan, cost }
}

/**
 * Lightweight gate-only check (no key decryption, no discount).
 * Kept for backward compat; prefer resolveAnalyticsContext in routes.
 */
export async function checkAnalyticsGate(
  userId: string,
  supabase: SupabaseClient,
  lang = 'ru'
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan, encrypted_yt_key')
    .eq('id', userId)
    .single()

  if (error || !data) return null // fail open
  const plan: string = (data as { plan: string }).plan
  const hasKey = !!(data as { encrypted_yt_key?: string | null }).encrypted_yt_key
  if (plan !== 'free') return null
  if (!hasKey) return byokRequiredResponse(lang)
  return null
}
