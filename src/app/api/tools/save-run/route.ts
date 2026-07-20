import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { SeoData, PlanSection } from '@/lib/types'

interface SaveRunRequest {
  tool_type: 'script-gen' | 'seo' | 'repack' | 'uniqueize'
  title: string
  input_text: string
  result_text?: string
  result_seo?: SeoData
  plan_sections?: PlanSection[]
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
    const { tool_type, title, input_text, result_text, result_seo, plan_sections, credits_spent, language } = body

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
      language: language ?? null,
      credits_spent: credits_spent ?? 0,
    }).select('id, script, seo').single()

    if (error) {
      console.error('[tools/save-run]', error.message)
      return NextResponse.json({ ok: false, error: 'Ошибка сохранения' }, { status: 500 })
    }

    // Return saved fields so the client can verify content was actually persisted
    return NextResponse.json({ ok: true, data: { project_id: data.id, script: data.script, seo: data.seo } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[tools/save-run]', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
