import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import type { SeoData, PlanSection, SubtitleBlock } from '@/lib/types'

interface SaveRunRequest {
  tool_type: 'script-gen' | 'seo' | 'repack' | 'uniqueize' | 'titles-niche' | 'subtitles'
  title: string
  input_text: string
  result_text?: string
  result_seo?: SeoData
  plan_sections?: PlanSection[]
  subtitle_blocks?: SubtitleBlock[]
  audio_storage_path?: string  // cleaned up from Storage after successful save
  credits_spent: number
  language?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as SaveRunRequest
    const {
      tool_type, title, input_text, result_text, result_seo,
      plan_sections, subtitle_blocks, audio_storage_path,
      credits_spent, language,
    } = body

    if (!tool_type || !title || !input_text) {
      return NextResponse.json({ ok: false, error: 'Не указаны обязательные поля' }, { status: 400 })
    }

    const { data, error } = await supabase.from('projects').insert({
      user_id: user.id,
      type: 'tool_run',
      title,
      topic: input_text.slice(0, 500),
      status: 'completed',
      image_style: tool_type,
      script: result_text ?? null,
      seo: result_seo ?? null,
      plan_sections: plan_sections ?? null,
      subtitle_blocks: subtitle_blocks ?? null,
      language: language ?? null,
      credits_spent: credits_spent ?? 0,
    }).select('id, script, seo, subtitle_blocks').single()

    if (error) {
      console.error('[tools/save-run]', error.message)
      return NextResponse.json({ ok: false, error: 'Ошибка сохранения' }, { status: 500 })
    }

    // Delete temp audio file now that result is persisted
    if (audio_storage_path) {
      const svc = createServiceClient()
      const { error: delErr } = await svc.storage.from('audio').remove([audio_storage_path])
      if (delErr) console.warn('[tools/save-run] audio delete error:', delErr.message)
    }

    return NextResponse.json({
      ok: true,
      data: { project_id: data.id, script: data.script, seo: data.seo, subtitle_blocks: data.subtitle_blocks },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[tools/save-run]', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
