import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Project } from '@/lib/types'

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Необходима авторизация' },
        { status: 401 }
      )
    }

    const { data: projects, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Ошибка загрузки проектов' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: { projects } })
  } catch (error) {
    console.error('[projects GET]', error)
    return NextResponse.json(
      { ok: false, error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    )
  }
}

interface CreateProjectBody {
  topic: string
  title?: string
  duration_minutes?: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Необходима авторизация' },
        { status: 401 }
      )
    }

    const body: CreateProjectBody = await request.json()
    const { topic, title, duration_minutes = 5 } = body

    if (!topic?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Тема видео обязательна' },
        { status: 400 }
      )
    }

    const rawTopic = topic.trim()
    const autoTitle = rawTopic.length > 60 ? rawTopic.slice(0, 57) + '…' : rawTopic
    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        topic: rawTopic,
        title: title?.trim() || autoTitle,
        duration_minutes,
        status: 'draft',
      })
      .select()
      .single<Project>()

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Ошибка создания проекта' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, data: { project } }, { status: 201 })
  } catch (error) {
    console.error('[projects POST]', error)
    return NextResponse.json(
      { ok: false, error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    )
  }
}
