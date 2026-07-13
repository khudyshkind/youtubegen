/**
 * TEMPORARY — delete after concept-fix acceptance test.
 * Tests 4 scenarios for the BYOK gate fix:
 *   (а) Free + corrupted key → 403 byok_required (not 200), balance unchanged
 *   (б) Free + working key   → 200, 7000 deducted (regression 3b intact)
 *   (в) Paid + corrupted key → 200, full price (no discount), shared key used
 *   (г) Free + no key        → 403 byok_required (baseline)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

export const maxDuration = 120

const TEST_SECRET = '9a2a2975ff32541a0d9f2eac9b638221'

// Unambiguously corrupted hex: valid hex characters but wrong AES-GCM auth tag
// (12 B IV + 16 B tag + 39 B ciphertext = 67 B = 134 hex chars, all 'a')
const CORRUPTED_HEX = 'a'.repeat(134)

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('s') !== TEST_SECRET) {
    return NextResponse.json({ ok: false }, { status: 403 })
  }

  const YOUTUBE_API_KEY = env('YOUTUBE_API_KEY')
  const SUPABASE_URL    = env('NEXT_PUBLIC_SUPABASE_URL')
  const SERVICE_KEY     = env('SUPABASE_SERVICE_ROLE_KEY')
  const ANON_KEY        = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const APP_URL         = 'https://lefiro.co'
  const KEYWORDS_BASE   = 10_000
  const KEYWORDS_BYOK   = Math.round(KEYWORDS_BASE * 0.7)  // 7000
  const INIT_CREDITS    = 50_000

  const results: Array<{ test: string; pass: boolean; detail: string }> = []
  function assert(name: string, cond: boolean, detail = '') {
    results.push({ test: name, pass: cond, detail })
  }

  const svc  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const anon = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } })

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function createTestUser(planType: 'free' | 'starter') {
    const email = `byok-cf-${planType}-${Date.now()}@test.internal`
    const pass  = `CfTest${Date.now()}!`
    const { data: created } = await svc.auth.admin.createUser({ email, password: pass, email_confirm: true })
    if (!created.user) throw new Error(`create user failed (${planType})`)
    const uid = created.user.id
    await svc.from('profiles').update({ plan: planType, credits: INIT_CREDITS, encrypted_yt_key: null }).eq('id', uid)
    return { uid, email, pass }
  }

  async function signIn(email: string, pass: string) {
    const { data: sess } = await anon.auth.signInWithPassword({ email, password: pass })
    if (!sess.session) throw new Error('sign-in failed')
    const s = sess.session
    const ref = SUPABASE_URL.match(/\/\/([^.]+)\./)?.[1] ?? ''
    const name = `sb-${ref}-auth-token`
    const val  = encodeURIComponent(JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type, user: s.user,
    }))
    return { name, val }
  }

  async function callKeywords(cookieName: string, cookieVal: string, keyword = 'test') {
    const res = await fetch(`${APP_URL}/api/analytics/keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${cookieName}=${cookieVal}` },
      body: JSON.stringify({ keyword, content_lang: 'en', ui_lang: 'en', country: 'US' }),
    })
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> }
  }

  async function getBalance(uid: string): Promise<number> {
    const { data } = await svc.from('profiles').select('credits').eq('id', uid).single()
    return (data as { credits: number } | null)?.credits ?? 0
  }

  async function setEncKey(uid: string, val: string | null) {
    await svc.from('profiles').update({ encrypted_yt_key: val }).eq('id', uid)
  }

  async function clearCache(keyword: string) {
    await svc.from('analytics_cache').delete()
      .eq('cache_type', 'keywords').eq('cache_key', `${keyword}|en|US|v1`)
  }

  const cleanups: string[] = []

  try {

    // ── (а) Free + CORRUPTED key → 403, balance unchanged ───────────────────
    {
      const { uid, email, pass } = await createTestUser('free')
      cleanups.push(uid)
      await setEncKey(uid, CORRUPTED_HEX)
      const { name, val } = await signIn(email, pass)

      const before = await getBalance(uid)
      const { status, json } = await callKeywords(name, val)
      const after = await getBalance(uid)

      assert('(а)1 Free+corrupted → HTTP 403',        status === 403,                     `got ${status}`)
      assert('(а)2 code=byok_required (not 200)',      json['code'] === 'byok_required',   `code=${json['code']}`)
      assert('(а)3 balance unchanged (no quota burn)', before === after,                   `${before} → ${after}`)
    }

    // ── (б) Free + WORKING key → 200, 7000 deducted (regression) ────────────
    {
      const { uid, email, pass } = await createTestUser('free')
      cleanups.push(uid)

      // Save key via API (validates + encrypts using production YT_KEY_ENCRYPT_SECRET)
      const { name, val } = await signIn(email, pass)
      const saveRes = await fetch(`${APP_URL}/api/settings/save-yt-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `${name}=${val}` },
        body: JSON.stringify({ key: YOUTUBE_API_KEY }),
      })
      const saveJson = await saveRes.json() as Record<string, unknown>
      assert('(б)1 save-yt-key → 200 ok', saveRes.status === 200 && saveJson['ok'] === true,
        `status=${saveRes.status} ok=${saveJson['ok']}`)

      const kw = `byok-cf-b-${Date.now()}`
      await clearCache(kw)
      const before = await getBalance(uid)
      const { status, json } = await callKeywords(name, val, kw)
      const after    = await getBalance(uid)
      const deducted = before - after

      assert('(б)2 gate unlocked (not byok_required)', !(status === 403 && json['code'] === 'byok_required'), `status=${status}`)
      assert('(б)3 HTTP 200 OK',                        status === 200,                   `status=${status}`)
      assert('(б)4 7000 deducted (30% discount)',        deducted === KEYWORDS_BYOK,      `deducted=${deducted}`)
      assert('(б)5 NOT full price 10000',                deducted !== KEYWORDS_BASE,      `deducted=${deducted}`)
    }

    // ── (в) Paid + CORRUPTED key → 200, full price, shared key ──────────────
    {
      const { uid, email, pass } = await createTestUser('starter')
      cleanups.push(uid)
      await setEncKey(uid, CORRUPTED_HEX)
      const { name, val } = await signIn(email, pass)

      const kw = `byok-cf-c-${Date.now()}`
      await clearCache(kw)
      const before = await getBalance(uid)
      const { status, json } = await callKeywords(name, val, kw)
      const after    = await getBalance(uid)
      const deducted = before - after

      assert('(в)1 Paid+corrupted → NOT 403 byok_required', !(status === 403 && json['code'] === 'byok_required'), `status=${status}`)
      assert('(в)2 HTTP 200 OK (shared key fallback)',        status === 200,              `status=${status} err=${json['error'] ?? ''}`)
      assert('(в)3 full price 10000 (no discount)',           deducted === KEYWORDS_BASE,  `deducted=${deducted}`)
      assert('(в)4 NOT discounted price 7000',                deducted !== KEYWORDS_BYOK,  `deducted=${deducted}`)
    }

    // ── (г) Free + NO key → 403 byok_required (baseline) ────────────────────
    {
      const { uid, email, pass } = await createTestUser('free')
      cleanups.push(uid)
      const { name, val } = await signIn(email, pass)

      const before = await getBalance(uid)
      const { status, json } = await callKeywords(name, val)
      const after = await getBalance(uid)

      assert('(г)1 Free+no key → HTTP 403',        status === 403,                   `got ${status}`)
      assert('(г)2 code=byok_required',             json['code'] === 'byok_required', `code=${json['code']}`)
      assert('(г)3 balance unchanged',              before === after,                 `${before} → ${after}`)
    }

  } finally {
    for (const uid of cleanups) await svc.auth.admin.deleteUser(uid)
  }

  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length

  return NextResponse.json({
    ok:      failed === 0,
    summary: `${passed} passed, ${failed} failed`,
    results,
  })
}
