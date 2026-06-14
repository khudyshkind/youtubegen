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
    const body = await request.json() as { amount?: number; reason?: string }
    const { amount, reason = 'admin_adjustment' } = body

    if (typeof amount !== 'number' || amount === 0) {
      return NextResponse.json({ ok: false, error: 'Укажите ненулевую сумму' }, { status: 400 })
    }

    const svc = createServiceClient()

    // Use existing add_credits RPC which handles atomic update + transaction log
    const { error } = await svc.rpc('add_credits', {
      p_user_id: id,
      p_amount: amount,
      p_operation: reason || 'admin_adjustment',
      p_project_id: null,
    })

    if (error) {
      console.error('[admin/credits] rpc error:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[admin/credits] error:', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
