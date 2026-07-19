export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { activatePlan } from '@/lib/activate-plan'
import { TOPUP_PACKAGES } from '@/lib/types'
import type { Plan } from '@/lib/types'

const VALID_PLANS: Plan[] = ['basic', 'starter', 'pro', 'agency']

// Maps TG-bot topup keys (topup_500 / topup_2000 / topup_5000) → TOPUP_PACKAGES index.
// Order must match TG_TOPUP_KEYS in src/app/api/plans/route.ts.
const TOPUP_KEY_MAP: Record<string, number> = {
  topup_500:  0,
  topup_2000: 1,
  topup_5000: 2,
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.RAILWAY_API_SECRET
    if (!secret || request.headers.get('x-api-secret') !== secret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as {
      email?: string
      plan?: string
      claim_id?: string | null
      telegram_chat_id?: string | null
    }
    const { email, plan, claim_id: claimId, telegram_chat_id: telegramChatId } = body

    if (!email || !plan) {
      return NextResponse.json({ ok: false, error: 'email и plan обязательны' }, { status: 400 })
    }

    const isTopup = plan.startsWith('topup_')

    if (!isTopup && !VALID_PLANS.includes(plan as Plan)) {
      return NextResponse.json({ ok: false, error: `Недопустимый тариф: ${plan}` }, { status: 400 })
    }
    if (isTopup && !(plan in TOPUP_KEY_MAP)) {
      return NextResponse.json({ ok: false, error: `Недопустимый топап: ${plan}` }, { status: 400 })
    }

    const svc = createServiceClient()

    // Idempotency: if this claimId was already processed, bail out early.
    if (claimId) {
      const { data: existing } = await svc
        .from('bot_settings')
        .select('value')
        .eq('key', `claim_${claimId}`)
        .single()
      if (existing?.value === 'activated') {
        console.log(`[activate] claim ${claimId} already activated — skipping`)
        return NextResponse.json({ ok: true, already_activated: true })
      }
    }

    // Find user by email via Supabase Auth Admin
    const { data: { users }, error: listErr } = await svc.auth.admin.listUsers({ perPage: 1000 })
    if (listErr) {
      console.error('[activate] listUsers error:', listErr.message)
      return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 })
    }

    const targetUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (!targetUser) {
      return NextResponse.json(
        { ok: false, error: `Пользователь с email ${email} не найден` },
        { status: 404 },
      )
    }

    // Helper: mark claim as used to prevent double-credit on repeated owner button clicks.
    const markClaim = async () => {
      if (!claimId) return
      await svc
        .from('bot_settings')
        .upsert(
          { key: `claim_${claimId}`, value: 'activated', updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        )
    }

    // ── Topup path: add to eternal wallet only, do NOT change plan ────────────
    if (isTopup) {
      const pkg = TOPUP_PACKAGES[TOPUP_KEY_MAP[plan]]
      const { error: credErr } = await svc.rpc('add_purchased_credits', {
        p_user_id:    targetUser.id,
        p_amount:     pkg.credits,
        p_operation:  'topup_russia',
        p_project_id: null,
      })
      if (credErr) {
        console.error('[activate] topup add_purchased_credits error:', credErr.message)
        return NextResponse.json({ ok: false, error: credErr.message }, { status: 500 })
      }
      await markClaim()
      console.log(`[activate] topup plan=${plan} credits=${pkg.credits} user=${targetUser.id} email=${email}`)
      return NextResponse.json({
        ok: true,
        data: { userId: targetUser.id, plan, credits: pkg.credits, topup: true },
      })
    }

    // ── Subscription plan path: full activation via unified function ──────────
    const result = await activatePlan(targetUser.id, plan as Plan, 'tg_manual')
    if (!result.ok) {
      console.error('[activate] activatePlan error:', result.error)
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }

    // Save telegram_chat_id if the bot passed it (non-fatal)
    if (telegramChatId) {
      const { error: tgErr } = await svc
        .from('profiles')
        .update({ telegram_chat_id: String(telegramChatId) })
        .eq('id', targetUser.id)
      if (tgErr) {
        console.warn('[activate] telegram_chat_id save error:', tgErr.message)
      }
    }

    await markClaim()
    console.log(
      `[activate] plan=${plan} plan_credits=${result.plan_credits} ` +
      `expires=${result.expires_at} user=${targetUser.id} email=${email}`,
    )
    return NextResponse.json({
      ok: true,
      data: { userId: targetUser.id, plan, credits: result.plan_credits ?? 0 },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[activate] error:', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
