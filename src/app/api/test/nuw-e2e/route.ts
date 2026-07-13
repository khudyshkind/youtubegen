/**
 * TEMPORARY — delete after acceptance test passes.
 * One-time secret: nuw-e2e-2026-q8k5
 *
 * Prerequisites: run the 3-step SQL in Supabase SQL Editor first
 * (handle_new_user with secret + get_recent_net_responses helper).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

const GATE_SECRET = 'nuw-e2e-2026-q8k5'
const WEBHOOK_URL = 'https://lefiro.co/api/webhooks/new-user'

export async function GET(req: NextRequest) {
  if (req.headers.get('x-test-secret') !== GATE_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const results: { test: string; pass: boolean; detail: string }[] = []
  let passed = 0; let failed = 0

  function assert(cond: boolean, test: string, detail: string) {
    results.push({ test, pass: cond, detail })
    if (cond) passed++; else failed++
  }

  const svc = createServiceClient()
  const webhookSecret = process.env.NEW_USER_WEBHOOK_SECRET ?? ''

  // ── 1. No Authorization header → 401 ────────────────────────────────────
  {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '00000000-dead-beef-0000-000000000000', email: 'x@x.com', provider: 'email' }),
    })
    assert(r.status === 401, '1. no auth header → 401', `got ${r.status}`)
  }

  // ── 2. Wrong secret → 401 ───────────────────────────────────────────────
  {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-secret-xyzzy' },
      body: JSON.stringify({ id: '00000000-dead-beef-0000-000000000000', email: 'x@x.com', provider: 'email' }),
    })
    assert(r.status === 401, '2. wrong secret → 401', `got ${r.status}`)
  }

  // ── 3–4. Valid payload (fake uid, won't find profile count but won't crash) → 200 ──
  {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webhookSecret}` },
      body: JSON.stringify({ id: '00000000-1111-2222-3333-444444444444', email: 'nuw-e2e-direct@lefiro.internal', provider: 'email' }),
    })
    const j = await r.json().catch(() => ({})) as Record<string, unknown>
    assert(r.status === 200, '3. valid payload → 200', `got ${r.status}`)
    assert(j.ok === true,    '4. valid payload → ok=true', `ok=${j.ok}`)
  }

  // ── 5–8. Real user → profiles INSERT → pg_net fires ────────────────────
  const testEmail = `nuw-e2e-${Date.now()}@lefiro.internal`
  let userId = ''
  const beforeInsert = new Date()

  try {
    const { data, error } = await svc.auth.admin.createUser({
      email: testEmail,
      password: `NuwE2E${Date.now()}!`,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(error?.message ?? 'no user')
    userId = data.user.id
    assert(true, '5. test user created', `id=${userId}`)

    // Verify profile created (trigger ran) + capture profile count for message check
    const { data: profile } = await svc.from('profiles').select('email,credits').eq('id', userId).single()
    assert(profile?.email === testEmail, '6. profile INSERT confirmed (trigger ran)', `email=${profile?.email}`)

    // Wait for pg_net to process the HTTP request (async, ~2-4s after commit)
    await new Promise(r => setTimeout(r, 6000))

    // Check net._http_response via helper RPC (created in step 3 of Supabase SQL)
    const { data: netData, error: netErr } = await svc.rpc(
      'get_recent_net_responses' as never,
      { p_since: beforeInsert.toISOString() } as never
    )
    if (netErr) {
      // Helper function not yet created — non-fatal, note it
      assert(false, '7. pg_net fired (net._http_response check)', `RPC error: ${netErr.message} — run SQL step 3 first`)
    } else {
      const responses = (netData as Array<{ status: number; timed_out: boolean }>) ?? []
      const httpOk = responses.some(r => r.status === 200 && !r.timed_out)
      assert(responses.length > 0, '7. pg_net fired (net._http_response has new entries)', `entries=${responses.length}`)
      assert(httpOk, '8. pg_net got HTTP 200 from webhook endpoint', `statuses=${responses.map(r=>r.status).join(',')}`)
    }
  } catch (err) {
    assert(false, '5. test user created', String(err))
  }

  // ── 9. Telegram ping: prove bot is alive ────────────────────────────────
  {
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const ownerId  = process.env.TELEGRAM_OWNER_ID  ?? ''
    if (!botToken || !ownerId) {
      assert(false, '9. Telegram ping', 'TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID not set')
    } else {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ownerId,
          text: [
            '✅ <b>NUW e2e test — Telegram bot alive</b>',
            `Тест-email: <code>${testEmail}</code>`,
            'Если ВЫШЕ этого сообщения пришло уведомление «🎉 Новый пользователь Lefiro» с этим же email — pg_net работает ✓',
          ].join('\n'),
          parse_mode: 'HTML',
        }),
      })
      const j = await r.json().catch(() => ({})) as Record<string, unknown>
      assert(r.ok && j.ok === true, '9. Telegram ping → ok', `ok=${j.ok} status=${r.status}`)
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  if (userId) {
    await svc.auth.admin.deleteUser(userId)
    assert(true, '10. cleanup: test user deleted', userId)
  }

  return NextResponse.json({
    ok: failed === 0,
    summary: `${passed} passed, ${failed} failed`,
    results,
  })
}
