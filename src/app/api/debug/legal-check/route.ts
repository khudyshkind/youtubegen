import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

// Temporary debug endpoint — REMOVE after task 9 verification
const ONE_TIME_TOKEN = 'lefiro_legal_check_856e59c'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('t') !== ONE_TIME_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    const admin = createServiceClient()

    // Get most recent real user (not bot/test accounts)
    const { data: lastUsers } = await admin
      .from('profiles')
      .select('id, email, created_at')
      .not('email', 'like', '%test-gate.local%')
      .order('created_at', { ascending: false })
      .limit(5)

    const testUser = lastUsers?.[0]
    if (!testUser) {
      return NextResponse.json({ error: 'no users found' }, { status: 404 })
    }

    // Generate a magic link token for the test user (does NOT send email)
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: testUser.email,
    })

    if (linkError || !linkData?.properties?.hashed_token) {
      return NextResponse.json({
        step: 'generateLink failed',
        error: linkError,
        testUser: { id: testUser.id.slice(0, 8) + '…', email: testUser.email },
      }, { status: 500 })
    }

    // Sign in with the generated token to get an authenticated session
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: sessionData, error: sessionError } = await anonClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    })

    if (sessionError || !sessionData?.session) {
      return NextResponse.json({
        step: 'verifyOtp failed',
        error: sessionError,
        testUser: { id: testUser.id.slice(0, 8) + '…', email: testUser.email },
      }, { status: 500 })
    }

    // Query legal_acceptances as the authenticated user
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } } }
    )

    const { data: rows, error: rowsError } = await userClient
      .from('legal_acceptances')
      .select('document, version, accepted_at')
      .order('accepted_at', { ascending: false })

    // Sign out to invalidate the temporary session
    await anonClient.auth.signOut()

    return NextResponse.json({
      testUser: { id: testUser.id.slice(0, 8) + '…', email: testUser.email, created_at: testUser.created_at },
      acceptances: {
        count: rows?.length ?? 0,
        error: rowsError ? { code: rowsError.code, message: rowsError.message } : null,
        rows,
      },
      verdict: rows?.length === 3
        ? '✅ 3 строки (offer/terms/privacy) — consent flow работает'
        : rows?.length === 0
          ? '❌ 0 строк — INSERT не записывается (или пользователь до деплоя регистрировался)'
          : `⚠️ ${rows?.length} строк — неожиданное количество`,
      lastUsers: lastUsers?.map(u => ({ id: u.id.slice(0, 8) + '…', email: u.email, created_at: u.created_at })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
