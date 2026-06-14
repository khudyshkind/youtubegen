import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { applyReferral } from '@/lib/referral'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as { referral_code?: string; new_user_id?: string }
    const { referral_code, new_user_id } = body

    if (!referral_code || typeof referral_code !== 'string') {
      return NextResponse.json({ ok: false, error: 'Не указан реферальный код' }, { status: 400 })
    }

    // Only the authenticated user can apply a referral to their own profile
    const targetId = new_user_id ?? user.id
    if (targetId !== user.id) {
      return NextResponse.json({ ok: false, error: 'Нельзя применить реферал к чужому профилю' }, { status: 403 })
    }

    const result = await applyReferral(user.id, referral_code)

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[referral/apply] error:', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
