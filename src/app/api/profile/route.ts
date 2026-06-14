import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('credits, plan')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ ok: false }, { status: 404 })

    return NextResponse.json({ ok: true, credits: profile.credits as number, plan: profile.plan as string })
  } catch (err) {
    console.error('[api/profile GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: { onboarding_completed?: boolean } = await request.json()

    if (typeof body.onboarding_completed !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'Неверные параметры' }, { status: 400 })
    }

    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_completed: body.onboarding_completed })
      .eq('id', user.id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/profile PATCH]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка обновления профиля' }, { status: 500 })
  }
}
