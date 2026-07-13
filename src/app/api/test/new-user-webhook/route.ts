/**
 * TEMPORARY — delete after acceptance test passes.
 * One-time secret: nuw-test-2026-9f3e
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

const ONE_TIME_SECRET = 'nuw-test-2026-9f3e'
const WEBHOOK_URL = 'https://lefiro.co/api/webhooks/new-user'

export async function GET(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== ONE_TIME_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const results: { test: string; pass: boolean; detail: string }[] = []
  let passed = 0
  let failed = 0

  function assert(cond: boolean, test: string, detail: string) {
    results.push({ test, pass: cond, detail })
    if (cond) passed++; else failed++
  }

  const svc = createServiceClient()
  const webhookSecret = process.env.NEW_USER_WEBHOOK_SECRET ?? ''

  // ── 1. No Authorization header → 401 ──────────────────────────────────────
  {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fake', email: 'test@test.com', provider: 'email' }),
    })
    assert(r.status === 401, '1. no auth header → 401', `got ${r.status}`)
  }

  // ── 2. Wrong secret → 401 ─────────────────────────────────────────────────
  {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-secret' },
      body: JSON.stringify({ id: 'fake', email: 'test@test.com', provider: 'email' }),
    })
    assert(r.status === 401, '2. wrong secret → 401', `got ${r.status}`)
  }

  // ── 3. Valid payload (no real user) → 200 ─────────────────────────────────
  {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webhookSecret}` },
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', email: 'nuw-test@lefiro.internal', provider: 'email' }),
    })
    const j = await r.json().catch(() => ({})) as Record<string, unknown>
    assert(r.status === 200, '3. valid payload → 200', `got ${r.status}`)
    assert(j.ok === true, '4. valid payload → ok=true', `ok=${j.ok}`)
  }

  // ── 5–6. Real user → profile INSERT → pg_net fires ───────────────────────
  const testEmail = `nuw-acc-${Date.now()}@webhook.internal`
  let userId = ''
  try {
    const { data, error } = await svc.auth.admin.createUser({
      email: testEmail,
      password: `NuwAcc${Date.now()}!`,
      email_confirm: true,
    })
    if (error || !data.user) {
      assert(false, '5. create test user', `error: ${error?.message ?? 'no user'}`)
    } else {
      userId = data.user.id
      assert(true, '5. create test user', `id=${userId}`)

      // Wait for pg_net to fire (async, after transaction commit)
      await new Promise(r => setTimeout(r, 4000))

      // Verify profile was created (trigger ran)
      const { data: profile } = await svc.from('profiles').select('email').eq('id', userId).single()
      assert(profile?.email === testEmail, '6. profile INSERT confirmed (trigger ran)', `email=${profile?.email}`)
    }
  } catch (err) {
    assert(false, '5. create test user', String(err))
  }

  // ── 7. Telegram API reachable ─────────────────────────────────────────────
  {
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const ownerId = process.env.TELEGRAM_OWNER_ID ?? ''
    if (!botToken || !ownerId) {
      assert(false, '7. Telegram ping', 'TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID not set')
    } else {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ownerId,
          text: `✅ <b>NUW acceptance test — Telegram ping OK</b>\nEmail тестового юзера: <code>${testEmail}</code>`,
          parse_mode: 'HTML',
        }),
      })
      const j = await r.json().catch(() => ({})) as Record<string, unknown>
      assert(r.ok && j.ok === true, '7. Telegram ping → ok', `ok=${j.ok} status=${r.status}`)
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  if (userId) {
    await svc.auth.admin.deleteUser(userId)
    assert(true, '8. cleanup: test user deleted', userId)
  }

  return NextResponse.json({
    ok: failed === 0,
    summary: `${passed} passed, ${failed} failed`,
    results,
    note: 'If test 7 passed, check Telegram: a message for the test email should have arrived from the pg_net webhook flow (4s wait). If not, run the SQL migration in Supabase to enable pg_net and set app.new_user_webhook_secret.',
  })
}
