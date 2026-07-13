/**
 * TEMPORARY — delete after acceptance test run.
 * Runs BYOK end-to-end acceptance test server-side so it has access to
 * production env vars (YOUTUBE_API_KEY, YT_KEY_ENCRYPT_SECRET) without
 * exposing them in logs or the test caller.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

export const maxDuration = 120

const TEST_SECRET = '32d243d8c46eb092ad12738257f67c85'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('s') !== TEST_SECRET) {
    return NextResponse.json({ ok: false }, { status: 403 })
  }

  const TEST_YT_KEY        = env('YOUTUBE_API_KEY')
  const SUPABASE_URL       = env('NEXT_PUBLIC_SUPABASE_URL')
  const SERVICE_KEY        = env('SUPABASE_SERVICE_ROLE_KEY')
  const ANON_KEY           = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const APP_URL            = 'https://lefiro.co'
  const KEYWORDS_BASE      = 10_000
  const KEYWORDS_BYOK      = Math.round(KEYWORDS_BASE * 0.7)  // 7000

  const results: Array<{ test: string; pass: boolean; detail: string }> = []
  function assert(name: string, cond: boolean, detail = '') {
    results.push({ test: name, pass: cond, detail })
  }

  const svc  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const anon = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } })

  const EMAIL = `byok3b-${Date.now()}@test.internal`
  const PASS  = `ByokTest${Date.now()}!`
  let userId = ''
  let cookieName = ''
  let cookieVal  = ''

  try {
    // ── Setup ────────────────────────────────────────────────────────────────
    const { data: created } = await svc.auth.admin.createUser({
      email: EMAIL, password: PASS, email_confirm: true,
    })
    if (!created.user) return NextResponse.json({ ok: false, error: 'create user failed' })
    userId = created.user.id

    await svc.from('profiles').update({
      plan: 'free', credits: 50_000, encrypted_yt_key: null,
    }).eq('id', userId)

    const { data: sess } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASS })
    if (!sess.session) return NextResponse.json({ ok: false, error: 'sign-in failed' })
    const s = sess.session
    const ref = SUPABASE_URL.match(/\/\/([^.]+)\./)?.[1] ?? ''
    cookieName = `sb-${ref}-auth-token`
    cookieVal  = encodeURIComponent(JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_in: s.expires_in,    expires_at: s.expires_at,
      token_type: s.token_type,    user: s.user,
    }))

    async function callApi(method: string, path: string, body: unknown) {
      const opts: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: `${cookieName}=${cookieVal}` },
      }
      if (body !== null) opts.body = JSON.stringify(body as Record<string, unknown>)
      const res = await fetch(`${APP_URL}${path}`, opts)
      return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> }
    }

    async function getBalance(): Promise<number | null> {
      const { data } = await svc.from('profiles').select('credits').eq('id', userId).single()
      return (data as { credits: number } | null)?.credits ?? null
    }
    async function getEncKey(): Promise<string | null> {
      const { data } = await svc.from('profiles').select('encrypted_yt_key').eq('id', userId).single()
      return (data as { encrypted_yt_key?: string | null } | null)?.encrypted_yt_key ?? null
    }

    // ── Test 1: baseline byok_required ───────────────────────────────────────
    {
      const before = await getBalance()
      const { status, json } = await callApi('POST', '/api/analytics/keywords', {
        keyword: 'test', content_lang: 'en', ui_lang: 'en', country: 'US',
      })
      const after = await getBalance()
      assert('1a. HTTP 403 byok_required', status === 403 && json['code'] === 'byok_required', `status=${status} code=${json['code']}`)
      assert('1b. balance unchanged',      before === after,                                    `${before} → ${after}`)
    }

    // ── Test 2: save YouTube API key ──────────────────────────────────────────
    {
      const { status, json } = await callApi('POST', '/api/settings/save-yt-key', {
        key: TEST_YT_KEY,
      })
      assert('2. save-yt-key → 200 ok', status === 200 && json['ok'] === true,
        `status=${status} ok=${json['ok']} code=${json['code'] ?? ''} err=${json['error'] ?? ''}`)
    }

    // ── Test 3: DB hex verification ──────────────────────────────────────────
    {
      const stored = await getEncKey()
      const isHex   = typeof stored === 'string' && /^[0-9a-f]+$/i.test(stored)
      const differs = stored !== TEST_YT_KEY
      const lenOk   = (stored?.length ?? 0) >= 116
      assert('3a. encrypted_yt_key not null in DB', stored !== null,  `value=${stored}`)
      assert('3b. stored value is valid hex',        isHex,            `isHex=${isHex}`)
      assert('3c. stored ≠ plaintext key',           differs,          `differs=${differs}`)
      assert('3d. hex length ≥ 116 (IV+tag+cipher)', lenOk,           `len=${stored?.length ?? 0}`)
    }

    // ── Test 4: BYOK gate passes + 7000 credit deduction ────────────────────
    {
      // Use unique keyword to guarantee cache miss
      const kw = `byok3b-${Date.now()}`
      await svc.from('analytics_cache').delete()
        .eq('cache_type', 'keywords').eq('cache_key', `${kw}|en|US|v1`)

      const before = await getBalance()
      const { status, json } = await callApi('POST', '/api/analytics/keywords', {
        keyword: kw, content_lang: 'en', ui_lang: 'en', country: 'US',
      })
      const after    = await getBalance()
      const deducted = (before ?? 0) - (after ?? 0)

      const gateOk = !(status === 403 && json['code'] === 'byok_required')
      assert('4a. gate unlocked (not byok_required)', gateOk,              `status=${status} code=${json['code'] ?? ''}`)
      assert('4b. HTTP 200 OK',                        status === 200,      `status=${status} err=${json['error'] ?? ''}`)
      assert('4c. 7000 credits deducted (30% off)',    deducted === KEYWORDS_BYOK, `deducted=${deducted} expected=${KEYWORDS_BYOK}`)
      assert('4d. NOT full base cost 10000',           deducted !== KEYWORDS_BASE, `deducted=${deducted}`)
    }

    // ── Test 5: delete key ────────────────────────────────────────────────────
    {
      const { status, json } = await callApi('DELETE', '/api/settings/save-yt-key', null)
      const stored = await getEncKey()
      assert('5a. delete → 200 ok',              status === 200 && json['ok'] === true, `status=${status}`)
      assert('5b. encrypted_yt_key null in DB',  stored === null,                       `stored=${stored}`)
    }

    // ── Test 6: gate restored ─────────────────────────────────────────────────
    {
      const { status, json } = await callApi('POST', '/api/analytics/keywords', {
        keyword: 'test', content_lang: 'en', ui_lang: 'en', country: 'US',
      })
      assert('6. byok_required gate restored', status === 403 && json['code'] === 'byok_required', `status=${status} code=${json['code']}`)
    }

  } finally {
    if (userId) await svc.auth.admin.deleteUser(userId)
  }

  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length

  return NextResponse.json({
    ok:      failed === 0,
    summary: `${passed} passed, ${failed} failed`,
    results,
  })
}
