export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
      return NextResponse.json({ ok: false, error: 'Нет доступа' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json() as { days?: unknown; reason?: unknown }
    const { days, reason } = body

    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
      return NextResponse.json({ ok: false, error: 'days должно быть числом от 1 до 365' }, { status: 400 })
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      return NextResponse.json({ ok: false, error: 'Укажите причину (минимум 3 символа)' }, { status: 400 })
    }

    const svc = createServiceClient()
    const { data, error } = await svc.rpc('extend_plan', {
      p_user_id:     id,
      p_days:        days,
      p_reason:      reason.trim(),
      p_actor_email: user.email,
    })

    if (error) {
      console.error('[admin/extend-plan] rpc error:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const result = data as { ok: boolean; error?: string; new_expires_at?: string; days_added?: number }
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? 'rpc returned ok=false' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, new_expires_at: result.new_expires_at })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[admin/extend-plan] error:', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
