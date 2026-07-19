export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

// Canonical WHERE for bulk extend:
//   plan != 'free'           — paid user
//   plan_expires_at IS NOT NULL — has a subscription expiry (excludes manually-activated plans)
// Note: plan_expires_at < now() is intentionally NOT excluded — if the cron hasn't run yet
//       the admin can still give compensation to users whose plans just expired.
// Both GET (count) and POST (execute) use the exact same filter so the confirm number
// matches what is actually processed.

// GET → { ok, count }  (dry-run: how many users would be extended)
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
      return NextResponse.json({ ok: false, error: 'Нет доступа' }, { status: 403 })
    }

    const svc = createServiceClient()
    const { count, error } = await svc
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .neq('plan', 'free')
      .not('plan_expires_at', 'is', null)

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, count: count ?? 0 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// POST { days, reason } → bulk extend, same WHERE as GET
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
      return NextResponse.json({ ok: false, error: 'Нет доступа' }, { status: 403 })
    }

    const body = await request.json() as { days?: unknown; reason?: unknown }
    const { days, reason } = body

    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
      return NextResponse.json({ ok: false, error: 'days должно быть числом от 1 до 365' }, { status: 400 })
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      return NextResponse.json({ ok: false, error: 'Укажите причину (минимум 3 символа)' }, { status: 400 })
    }

    const svc = createServiceClient()

    // Fetch using the SAME WHERE as GET so confirm-count == actually-extended
    const { data: paidUsers, error: fetchError } = await svc
      .from('profiles')
      .select('id, plan_expires_at')
      .neq('plan', 'free')
      .not('plan_expires_at', 'is', null)

    if (fetchError) return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 })

    const users = paidUsers ?? []
    let extended = 0
    const errors: string[] = []

    for (const u of users) {
      // plan_expires_at is guaranteed non-null by the WHERE clause above
      const currentExpiry = new Date(u.plan_expires_at as string)
      // Extend from now if already expired (cron missed), otherwise from current expiry
      const base = currentExpiry > new Date() ? currentExpiry : new Date()
      const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)

      const { error: upErr } = await svc
        .from('profiles')
        .update({ plan_expires_at: newExpiry.toISOString() })
        .eq('id', u.id)

      if (upErr) { errors.push(u.id); continue }
      extended++
    }

    // Log single bulk event in plan_events (user_id=null for bulk)
    await svc.from('plan_events').insert({
      user_id: null,
      operation: 'plan_extended_bulk',
      days_added: days,
      reason: (reason as string).trim(),
      actor_email: user.email,
      metadata: { affected: extended, total: users.length, errors: errors.length },
    })

    return NextResponse.json({ ok: true, extended, errors: errors.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[admin/extend-bulk] error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
