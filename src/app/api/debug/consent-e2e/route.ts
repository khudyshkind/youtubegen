import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

// Temporary end-to-end consent verification — REMOVE after use
const TOKEN = 'lefiro_e2e_0a89cf0'
const TEST_EMAIL = 'denisregion88+ct1@gmail.com'
const TEST_PASS = 'TestPass_ct1_2026!'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('t') !== TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const log: string[] = []
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  log.push(`url=${url?.slice(0, 40) ?? 'MISSING'}`)
  log.push(`anon=${anonKey ? 'ok' : 'MISSING'}`)
  log.push(`svc=${svcKey ? 'ok' : 'MISSING'}`)

  const admin = createServiceClient()

  // ── Step 1: Try Management API to apply GRANT ──────────────────────────────
  // Needs SUPABASE_ACCESS_TOKEN (PAT) env var — optional but attempted
  const pat = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
  if (pat && projectRef) {
    try {
      const mgmtRes = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pat}`,
          },
          body: JSON.stringify({
            query:
              'GRANT SELECT, INSERT ON legal_acceptances TO authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON legal_acceptances TO service_role;',
          }),
        }
      )
      const mgmtBody = await mgmtRes.text()
      log.push(`mgmt api GRANT: ${mgmtRes.status} ${mgmtBody.slice(0, 120)}`)
    } catch (e) {
      log.push(`mgmt api GRANT error: ${e}`)
    }
  } else {
    log.push('SUPABASE_ACCESS_TOKEN not set — skipping Management API GRANT')
  }

  // ── Step 2: Create test user via admin API ────────────────────────────────
  let userId: string | null = null
  let accessToken: string | null = null

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASS,
    email_confirm: true,
  })
  if (created?.user) {
    userId = created.user.id
    log.push(`user created: ${userId.slice(0, 8)}…`)
  } else {
    log.push(`createUser: ${createErr?.message} — will try sign-in`)
  }

  // ── Step 3: Sign in to obtain JWT ─────────────────────────────────────────
  const anonClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASS,
  })
  if (signIn?.session) {
    userId = signIn.user.id
    accessToken = signIn.session.access_token
    log.push(`signed in: user=${userId.slice(0, 8)}… jwt=${accessToken.slice(0, 24)}…`)
  } else {
    log.push(`signIn failed: ${signInErr?.message}`)
    return NextResponse.json({ log, error: 'sign-in failed — stop' })
  }

  // ── Step 4: INSERT 3 rows using user JWT (replicates /api/legal/accept) ───
  // This directly tests GRANT + RLS INSERT policy, same as the real route
  const userClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  // First clear any prior rows for idempotency
  await admin.from('legal_acceptances').delete().eq('user_id', userId)

  const { error: insertErr } = await userClient.from('legal_acceptances').insert([
    { user_id: userId, document: 'offer',   version: '1.0' },
    { user_id: userId, document: 'terms',   version: '1.0' },
    { user_id: userId, document: 'privacy', version: '1.0' },
  ])

  if (insertErr) {
    log.push(`INSERT error: code=${insertErr.code} msg=${insertErr.message}`)
  } else {
    log.push('INSERT: ok (3 rows)')
  }

  // ── Step 5: SELECT via admin (bypasses RLS) ───────────────────────────────
  const { data: adminRows, error: adminSelErr } = await admin
    .from('legal_acceptances')
    .select('document, version, accepted_at')
    .eq('user_id', userId)
    .order('accepted_at', { ascending: false })

  log.push(`admin SELECT: count=${adminRows?.length ?? 0} err=${adminSelErr?.message ?? 'none'}`)

  // ── Step 6: SELECT via user JWT (tests RLS SELECT policy) ────────────────
  const { data: userRows, error: userSelErr } = await userClient
    .from('legal_acceptances')
    .select('document, version, accepted_at')
    .order('accepted_at', { ascending: false })

  log.push(`user SELECT: count=${userRows?.length ?? 0} err=${userSelErr?.message ?? 'none'}`)

  // ── Verdict ───────────────────────────────────────────────────────────────
  const rows = adminRows ?? userRows
  const count = rows?.length ?? 0

  let verdict: string
  if (count === 3) {
    verdict = '✅ 3 строки — consent flow работает!'
  } else if (insertErr?.code === '42501') {
    verdict = '❌ permission denied — GRANT из migration 007 не применён. Выполни вручную в Supabase SQL Editor: GRANT SELECT, INSERT ON legal_acceptances TO authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON legal_acceptances TO service_role;'
  } else if (count > 0) {
    verdict = `⚠️ ${count} строк — неожиданное количество`
  } else {
    verdict = `❌ 0 строк — INSERT: ${insertErr?.message ?? 'unknown'}`
  }

  return NextResponse.json({
    verdict,
    log,
    user: { id: userId.slice(0, 8) + '…', email: TEST_EMAIL },
    rows,
    insert_error: insertErr ? { code: insertErr.code, message: insertErr.message } : null,
  })
}

// DELETE to clean up the test user
export async function DELETE(req: NextRequest) {
  if (req.nextUrl.searchParams.get('t') !== TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const admin = createServiceClient()

  const { data: { users }, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) return NextResponse.json({ error: listErr.message })

  const testUser = users?.find(u => u.email === TEST_EMAIL)
  if (!testUser) return NextResponse.json({ ok: true, note: 'user not found' })

  await admin.from('legal_acceptances').delete().eq('user_id', testUser.id)
  const { error } = await admin.auth.admin.deleteUser(testUser.id)
  return NextResponse.json({ ok: !error, error: error?.message, deleted: testUser.email })
}
