import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const redirectTo = url.searchParams.get('redirectTo') ?? '/dashboard'
  const origin = url.origin

  if (code) {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[auth/callback]', error.message)
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent('Ошибка авторизации')}`, origin)
      )
    }
  }

  return NextResponse.redirect(new URL(redirectTo, origin))
}
