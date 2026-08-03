import { createServiceClient } from './supabase-server'
import type { NextRequest } from 'next/server'

export async function saveSignupTracking(
  req: NextRequest,
  userId: string,
  utms?: Record<string, string | null>,
): Promise<void> {
  const ip      = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua      = req.headers.get('user-agent') ?? null
  const country = req.headers.get('x-vercel-ip-country') ?? null
  const rawCity = req.headers.get('x-vercel-ip-city')
  const city    = rawCity ? decodeURIComponent(rawCity) : null

  const svc = createServiceClient()
  await svc.from('profiles').update({
    signup_ip:         ip,
    signup_user_agent: ua,
    signup_country:    country,
    signup_city:       city,
    ...(utms ? {
      utm_source:   utms.utm_source   ?? null,
      utm_medium:   utms.utm_medium   ?? null,
      utm_campaign: utms.utm_campaign ?? null,
    } : {}),
  }).eq('id', userId)
}
