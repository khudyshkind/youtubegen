import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { saveSignupTracking } from '@/lib/save-signup-tracking'

export const runtime = 'nodejs'

// Called by the client immediately after supabase.auth.signUp() succeeds.
// This is the only server-side point where we have both the user session
// (via cookie set during signUp) and the real browser request headers (IP, geo, UA).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
    }

    // Guard against replays: only track within 60s of account creation.
    const ageMs = Date.now() - new Date(user.created_at).getTime()
    if (ageMs > 60_000) {
      return NextResponse.json({ ok: true, skipped: 'not new' })
    }

    let utms: Record<string, string | null> = {}
    try {
      const rawBody = await req.text() // TEMP DIAGNOSTIC
      console.log('[TEMP DIAGNOSTIC] track-signup: raw body text:', JSON.stringify(rawBody)) // TEMP DIAGNOSTIC
      utms = JSON.parse(rawBody) as Record<string, string | null> // TEMP DIAGNOSTIC
      console.log('[TEMP DIAGNOSTIC] track-signup: parsed utms:', JSON.stringify(utms)) // TEMP DIAGNOSTIC
    } catch (e) {
      console.log('[TEMP DIAGNOSTIC] track-signup: body parse error:', e) // TEMP DIAGNOSTIC
      /* UTMs are optional — malformed body is fine */
    }

    await saveSignupTracking(req, user.id, utms)

    return NextResponse.json({ ok: true })
  } catch (err) {
    // Best-effort: never break registration even if tracking fails.
    console.error('[track-signup] non-fatal error:', err)
    return NextResponse.json({ ok: true })
  }
}
