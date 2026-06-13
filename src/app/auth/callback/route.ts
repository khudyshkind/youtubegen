import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const googleError = url.searchParams.get('error')
  const googleErrorDesc = url.searchParams.get('error_description')
  const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard'
  const origin = url.origin

  console.log('[callback] full URL:', request.url)
  console.log('[callback] code:', code ? 'present' : 'MISSING')
  console.log('[callback] google error param:', googleError ?? 'none')
  console.log('[callback] google error_description:', googleErrorDesc ?? 'none')
  console.log('[callback] redirectTo:', redirectTo)

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
            console.log('[callback] setting cookies:', cookiesToSet.map(c => c.name))
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

    console.log('[callback] exchange SUCCESS, user:', data.user?.email, 'session expires:', data.session?.expires_at)
    console.log('[callback] redirecting to:', redirectTo)
    return response
  }

  console.warn('[callback] no code in URL — redirecting to', redirectTo, '(no session set)')
  return NextResponse.redirect(new URL(redirectTo, origin))
}
