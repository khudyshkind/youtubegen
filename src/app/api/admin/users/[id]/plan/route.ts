export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import type { Plan } from '@/lib/types'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']
const VALID_PLANS: Plan[] = ['free', 'starter', 'pro', 'agency']

export async function PATCH(
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
    const body = await request.json() as { plan?: string }
    const { plan } = body

    if (!plan || !VALID_PLANS.includes(plan as Plan)) {
      return NextResponse.json({ ok: false, error: 'Недопустимый тариф' }, { status: 400 })
    }

    const svc = createServiceClient()
    const { error } = await svc
      .from('profiles')
      .update({ plan })
      .eq('id', id)

    if (error) {
      console.error('[admin/plan] update error:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[admin/plan] error:', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
