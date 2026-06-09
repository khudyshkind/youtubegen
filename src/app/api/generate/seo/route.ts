import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import type { SeoData } from '@/lib/types'

interface SeoRequest {
  script: string
  topic: string
  project_id?: string
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

    const check = await requireCredits(user.id, 'seo')
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const { script, topic, project_id }: SeoRequest = await request.json()

    const prompt = `На основе следующего сценария для YouTube видео составь SEO-оптимизацию.

Тема: ${topic}

Сценарий (первые 1000 символов):
${script.slice(0, 1000)}

Верни ответ строго в формате JSON (без markdown-обёрток):
{
  "title": "Цепляющий заголовок до 70 символов с ключевым словом",
  "description": "Описание видео 150-300 символов с ключевыми словами и призывом к действию",
  "tags": ["тег1", "тег2", "тег3", "тег4", "тег5", "тег6", "тег7", "тег8", "тег9", "тег10"]
}`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText =
      message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    let seo: SeoData
    try {
      seo = JSON.parse(rawText) as SeoData
    } catch {
      // Strip possible markdown code fences and retry
      const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
      seo = JSON.parse(cleaned) as SeoData
    }

    await spendCredits(user.id, 5, 'seo', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({
          seo,
          title: seo.title,
          status: 'completed',
        })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { seo } })
  } catch (error) {
    console.error('[generate/seo]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка генерации SEO' },
      { status: 500 }
    )
  }
}
