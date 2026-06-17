export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import type { Plan } from '@/lib/types'

const VALID_PLANS: Plan[] = ['starter', 'pro', 'agency']

const PLAN_CREDITS: Record<string, number> = {
  starter: 100,
  pro:     300,
  agency:  1000,
}

export async function POST(request: NextRequest) {
  try {
    // Auth: shared secret between Railway bot and Vercel
    const secret = process.env.RAILWAY_API_SECRET
    if (!secret || request.headers.get('x-api-secret') !== secret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as { email?: string; plan?: string }
    const { email, plan } = body

    if (!email || !plan) {
      return NextResponse.json({ ok: false, error: 'email и plan обязательны' }, { status: 400 })
    }

    if (!VALID_PLANS.includes(plan as Plan)) {
      return NextResponse.json({ ok: false, error: `Недопустимый тариф: ${plan}` }, { status: 400 })
    }

    const svc = createServiceClient()

    // Find user by email via Supabase Auth Admin
    const { data: { users }, error: listErr } = await svc.auth.admin.listUsers({ perPage: 1000 })
    if (listErr) {
      console.error('[activate] listUsers error:', listErr.message)
      return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 })
    }

    const targetUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (!targetUser) {
      return NextResponse.json({ ok: false, error: `Пользователь с email ${email} не найден` }, { status: 404 })
    }

    // Update plan
    const { error: planErr } = await svc
      .from('profiles')
      .update({ plan })
      .eq('id', targetUser.id)

    if (planErr) {
      console.error('[activate] plan update error:', planErr.message)
      return NextResponse.json({ ok: false, error: planErr.message }, { status: 500 })
    }

    // Add credits
    const credits = PLAN_CREDITS[plan] ?? 0
    const { error: credErr } = await svc.rpc('add_credits', {
      p_user_id:   targetUser.id,
      p_amount:    credits,
      p_operation: 'russia_payment',
      p_project_id: null,
    })

    if (credErr) {
      console.error('[activate] add_credits error:', credErr.message)
      return NextResponse.json({ ok: false, error: credErr.message }, { status: 500 })
    }

    console.log(`[activate] plan=${plan} credits=${credits} user=${targetUser.id} email=${email}`)
    return NextResponse.json({ ok: true, data: { userId: targetUser.id, plan, credits } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[activate] error:', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
