import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import type { ScriptParams } from '@/lib/types'

interface ScriptRequest extends ScriptParams {
  project_id?: string
  model?: 'claude' | 'gpt-4o'
}

function buildPrompt(params: ScriptParams): string {
  const wordsTarget = params.duration_minutes * 130
  return `Напиши сценарий для YouTube видео на тему: "${params.topic}".

Требования:
- Длительность: ${params.duration_minutes} минут (~${wordsTarget} слов, темп 130 слов/мин)
- Стиль: ${params.style ?? 'educational'}
- Целевая аудитория: ${params.target_audience ?? 'широкая аудитория'}
- Язык: русский

Сценарий должен быть готов для озвучки — только текст для чтения вслух, без ремарок, сценических указаний и заголовков разделов. Пиши живым, разговорным языком.`
}

async function generateWithClaude(prompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = message.content[0]
  return block.type === 'text' ? block.text : ''
}

async function generateWithGpt4o(prompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  })
  return completion.choices[0].message.content ?? ''
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

    const check = await requireCredits(user.id, 'script')
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const body: ScriptRequest = await request.json()
    const { project_id, model = 'claude', ...scriptParams } = body

    const prompt = buildPrompt(scriptParams)
    const script =
      model === 'gpt-4o'
        ? await generateWithGpt4o(prompt)
        : await generateWithClaude(prompt)

    if (!script) {
      return NextResponse.json(
        { ok: false, error: 'Модель вернула пустой ответ' },
        { status: 502 }
      )
    }

    await spendCredits(user.id, 10, 'script', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({ script, status: 'draft', credits_spent: 10 })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { script } })
  } catch (error) {
    console.error('[generate/script]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка генерации сценария' },
      { status: 500 }
    )
  }
}
