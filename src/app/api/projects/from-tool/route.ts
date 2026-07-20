import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { PlanSection, Project } from '@/lib/types'

interface FromToolBody {
  topic: string
  duration_minutes?: number
  language?: string
  script: string
  plan_sections?: PlanSection[]
  credits_spent?: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as FromToolBody
    const { topic, duration_minutes = 5, language, script, plan_sections, credits_spent } = body

    if (!topic?.trim()) {
      return NextResponse.json({ ok: false, error: 'Тема видео обязательна' }, { status: 400 })
    }
    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'Сценарий обязателен' }, { status: 400 })
    }

    const rawTopic = topic.trim()
    const autoTitle = rawTopic.length > 60 ? rawTopic.slice(0, 57) + '…' : rawTopic

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        type: 'project',
        topic: rawTopic,
        title: autoTitle,
        duration_minutes,
        language: language ?? null,
        script,
        plan_sections: plan_sections ?? null,
        status: 'draft',
        credits_spent: credits_spent ?? 0,
      })
      .select()
      .single<Project>()

    if (error) {
      console.error('[projects/from-tool]', error.message)
      return NextResponse.json({ ok: false, error: 'Ошибка создания проекта' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, data: { project } }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[projects/from-tool]', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}
