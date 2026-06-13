import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { data: project, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return NextResponse.json({ ok: false, error: 'Проект не найден' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, data: { project } })
  } catch (err) {
    console.error('[projects/:id GET]', err)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ ok: false, error: 'Ошибка удаления проекта' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[projects/:id DELETE]', err)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
