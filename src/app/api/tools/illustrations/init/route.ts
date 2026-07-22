// Creates a stub tool_run project before SSE image generation starts.
// Client calls this first to get a project_id, then streams /api/generate/images with it.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

interface InitRequest {
  title: string
  script: string
  engine: string
  style_value: string
  custom_style?: string
  language?: string
  scene_count: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { title, script, engine, style_value, custom_style, language, scene_count }: InitRequest =
      await request.json()

    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'script обязателен' }, { status: 400 })
    }

    // Metadata stored in topic for restore path (engine/style for single-image regen after restore)
    const topicMeta = JSON.stringify({
      engine: engine || 'flux_schnell',
      style_value: style_value || '',
      custom_style: custom_style || '',
      scene_count: scene_count || 1,
    })

    const { data, error } = await supabase.from('projects').insert({
      user_id: user.id,
      type: 'tool_run',
      title: (title || 'Иллюстрации').slice(0, 200),
      topic: topicMeta,
      script: script.slice(0, 50000),
      status: 'generating_images',
      image_style: 'image-illustrations',  // routing slug — finalize resets to this after gen overwrites
      language: language ?? null,
      credits_spent: 0,
    }).select('id').single()

    if (error) {
      console.error('[illustrations/init]', error.message)
      return NextResponse.json({ ok: false, error: 'Ошибка создания проекта' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, data: { project_id: data.id } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[illustrations/init]', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
