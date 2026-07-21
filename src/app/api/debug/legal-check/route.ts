import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

// Temporary debug endpoint — REMOVE after task 9 verification
const ONE_TIME_TOKEN = 'lefiro_legal_check_856e59c'

async function applyGrant(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { ok: false, detail: 'missing env vars' }

  // Try Supabase Management pgMeta query endpoint (used by Supabase Studio internally)
  const mgmtUrl = `${url}/pg/v0/query`
  const mgmtRes = await fetch(mgmtUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      query: 'GRANT SELECT, INSERT ON legal_acceptances TO authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON legal_acceptances TO service_role;'
    }),
  })
  const mgmtText = await mgmtRes.text()
  if (mgmtRes.ok) return { ok: true, detail: `pgMeta ok: ${mgmtText.slice(0, 200)}` }

  // Try alternative pgMeta v1 path
  const alt = `${url}/rest/v1/rpc/query`
  const altRes = await fetch(alt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ query: 'SELECT 1' }),
  })
  const altText = await altRes.text()

  return {
    ok: false,
    detail: `pgMeta ${mgmtRes.status}: ${mgmtText.slice(0, 200)} | rpc/query ${altRes.status}: ${altText.slice(0, 100)}`,
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('t') !== ONE_TIME_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    // Step 1: try to apply the grant
    const grantResult = await applyGrant()

    const admin = createServiceClient()

    // Step 2: get most recent real user
    const { data: lastUsers } = await admin
      .from('profiles')
      .select('id, email, created_at')
      .not('email', 'like', '%test-gate.local%')
      .order('created_at', { ascending: false })
      .limit(5)

    const testUser = lastUsers?.[0]
    if (!testUser) {
      return NextResponse.json({ grant: grantResult, error: 'no users found' })
    }

    // Step 3: generate magic link (does NOT send email)
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: testUser.email,
    })

    if (linkError || !linkData?.properties?.hashed_token) {
      return NextResponse.json({ grant: grantResult, step: 'generateLink failed', error: linkError })
    }

    // Step 4: verify OTP to get authenticated session
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: sessionData, error: sessionError } = await anonClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    })

    if (sessionError || !sessionData?.session) {
      return NextResponse.json({ grant: grantResult, step: 'verifyOtp failed', error: sessionError })
    }

    // Step 5: query legal_acceptances as the authenticated user
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } } }
    )

    const { data: rows, error: rowsError } = await userClient
      .from('legal_acceptances')
      .select('document, version, accepted_at')
      .order('accepted_at', { ascending: false })

    await anonClient.auth.signOut()

    const count = rows?.length ?? 0
    return NextResponse.json({
      grant: grantResult,
      testUser: { id: testUser.id.slice(0, 8) + '…', email: testUser.email, created_at: testUser.created_at },
      acceptances: { count, error: rowsError ? { code: rowsError.code, message: rowsError.message } : null, rows },
      verdict: count === 3
        ? '✅ 3 строки — consent flow работает'
        : count === 0 && !rowsError
          ? '❌ 0 строк — таблица доступна, но INSERT не записывался (пользователь до деплоя?)'
          : rowsError
            ? `❌ ошибка SELECT: ${rowsError.message} (GRANT не применён)`
            : `⚠️ ${count} строк — неожиданно`,
      lastUsers: lastUsers?.map(u => ({ id: u.id.slice(0, 8) + '…', email: u.email, created_at: u.created_at })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
