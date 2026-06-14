import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { applyReferral } from '@/lib/referral'
import { sendWelcomeEmail } from '@/lib/email'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const ref = url.searchParams.get('ref')
  const googleError = url.searchParams.get('error')
  const googleErrorDesc = url.searchParams.get('error_description')
  const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard'
  const origin = url.origin

  if (googleError) {
    console.error('[callback] Google returned error:', googleError, googleErrorDesc)
    return NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(googleErrorDesc ?? googleError)}`, origin)
    )
  }

  if (code) {
    const response = NextResponse.redirect(new URL(redirectTo, origin))

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[callback] exchangeCodeForSession FAILED:', error.message, error.status)
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent('Ошибка авторизации: ' + error.message)}`, origin)
      )
    }

    // Send welcome email for new users (created within last 30 seconds)
    if (data.user) {
      const isNew = new Date(data.user.created_at).getTime() > Date.now() - 30_000
      if (isNew) {
        void sendWelcomeEmail({
          email: data.user.email!,
          name: data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? null,
        })
      }
    }

    // Apply referral if ?ref= was present — best-effort, won't block login on failure
    if (ref && data.user?.id) {
      applyReferral(data.user.id, ref).catch((err) =>
        console.error('[callback] applyReferral error:', err)
      )
    }

    return response
  }

  return NextResponse.redirect(new URL(redirectTo, origin))
}
