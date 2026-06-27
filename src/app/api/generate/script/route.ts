import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'
import type { ScriptParams, PlanSection } from '@/lib/types'
import { CREDIT_COSTS } from '@/lib/types'

interface ScriptRequest extends ScriptParams {
  project_id?: string
  plan_sections?: PlanSection[]
}

const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'русском', en: 'английском', es: 'испанском', fr: 'французском',
  de: 'немецком', it: 'итальянском', pt: 'португальском', zh: 'китайском',
  ja: 'японском', ko: 'корейском', ar: 'арабском', hi: 'хинди',
  nl: 'нидерландском', pl: 'польском', tr: 'турецком', sv: 'шведском',
  no: 'норвежском', da: 'датском', fi: 'финском', uk: 'украинском',
  cs: 'чешском', ro: 'румынском', hu: 'венгерском', el: 'греческом',
  he: 'иврите', th: 'тайском', id: 'индонезийском', vi: 'вьетнамском',
}

const NARRATIVE_STYLE_LABELS: Record<string, string> = {
  storytelling: 'сторителлинг — через историю, с нарративной дугой',
  science: 'научно-популярный — факты, исследования, эксперты',
  documentary: 'документальный — нейтральный и объективный',
  conversational: 'разговорный — как будто говоришь с другом',
  children: 'детский — простые слова, яркие образы',
}

const TONE_LABELS: Record<string, string> = {
  neutral: 'нейтральный',
  emotional: 'эмоциональный',
  humorous: 'юмористический',
  dramatic: 'драматический',
  inspiring: 'вдохновляющий',
}

const AUDIENCE_LABELS: Record<string, string> = {
  children: 'дети (6–12 лет)',
  teens: 'подростки (13–18 лет)',
  wide: 'широкая аудитория',
  adults: 'взрослые 25+',
}

const HOOK_LABELS: Record<string, string> = {
  question: 'риторический вопрос',
  statistic: 'удивительная статистика',
  story: 'захватывающая история',
  provocation: 'провокационное заявление',
}

function buildPrompt(p: ScriptParams, planSections?: PlanSection[]): string {
  const wordsTarget = p.duration_minutes * 130
  const langName = LANGUAGE_NAMES[p.language] ?? p.language

  const lines: string[] = [
    `Напиши сценарий для YouTube видео на тему: "${p.topic}".`,
    '',
    'ТЕХНИЧЕСКИЕ ПАРАМЕТРЫ:',
    `- Язык: ${langName}`,
    `- Длительность: ${p.duration_minutes} мин (~${wordsTarget} слов при темпе 130 слов/мин)`,
    `- Нарративный стиль: ${NARRATIVE_STYLE_LABELS[p.narrative_style] ?? p.narrative_style}`,
    `- Тон: ${TONE_LABELS[p.tone] ?? p.tone}`,
    `- Целевая аудитория: ${AUDIENCE_LABELS[p.target_audience] ?? p.target_audience}`,
  ]

  if (p.hook) {
    lines.push(`- Хук в начале: ${HOOK_LABELS[p.hook_type] ?? p.hook_type} (первые 15 секунд должны захватывать внимание)`)
  }
  if (p.cta) {
    lines.push('- В конце добавь призыв к действию: попроси подписаться, лайкнуть или написать комментарий')
  }
  if (p.scene_markers) {
    lines.push('- Раздели текст на сцены с заголовками в формате [Сцена N: Название]')
  }
  if (p.pauses) {
    lines.push('- Добавь паузы для дыхания в виде [...] в местах естественных остановок')
  }

  if (planSections && planSections.length > 0) {
    lines.push(
      '',
      'СТРУКТУРА ВИДЕО (следуй этому плану точно — количество и порядок секций):',
    )
    for (let i = 0; i < planSections.length; i++) {
      const s = planSections[i]
      lines.push(`[Секция ${i + 1}: ${s.title}]`)
      lines.push(s.description)
      lines.push('')
    }
    if (p.scene_markers) {
      lines.push('Используй названия секций выше как заголовки маркеров [Сцена N: Название].')
    }
  }

  lines.push(
    '',
    'ФОРМАТ ВЫВОДА:',
    'Выводи только текст сценария для озвучки. Без вступительных фраз, без пояснений, без ремарок типа «(пауза)» или «(музыка)» — только слова для чтения вслух.',
  )

  return lines.join('\n')
}

function modelOperation(model: string): keyof typeof CREDIT_COSTS {
  if (model === 'claude-opus') return 'script_opus'
  if (model === 'gpt-4o') return 'script_gpt'
  return 'script_sonnet'
}

function modelCost(model: string): number {
  if (model === 'claude-opus') return CREDIT_COSTS.script_opus
  if (model === 'gpt-4o') return CREDIT_COSTS.script_gpt
  return CREDIT_COSTS.script_sonnet
}

// Dynamic token budget: 130 words/min × 2 tokens/word (Cyrillic-safe) × 1.3 buffer.
// Capped at 8192 — safe max output for Claude 4 Sonnet/Opus and GPT-4o.
function calcMaxTokens(durationMinutes: number): number {
  return Math.min(8192, Math.max(2048, Math.ceil(durationMinutes * 130 * 2 * 1.3)))
}

async function generateWithClaude(prompt: string, opus: boolean, maxTokens: number): Promise<string> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  const modelId = opus ? 'claude-opus-4-5' : 'claude-sonnet-4-6'
  const message = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = message.content[0]
  return block.type === 'text' ? block.text : ''
}

async function generateWithGpt4o(prompt: string, maxTokens: number): Promise<string> {
  const openai = new OpenAI({ apiKey: env('OPENAI_API_KEY') })
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  })
  return completion.choices[0].message.content ?? ''
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: ScriptRequest = await request.json()
    const { project_id, plan_sections, ...scriptParams } = body
    const { model } = scriptParams

    Sentry.setUser({ id: user.id })
    Sentry.setContext('generate', { project_id, model })

    const operation = modelOperation(model)
    const cost = modelCost(model)

    const check = await requireCredits(user.id, operation, supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const prompt = buildPrompt(scriptParams, plan_sections)
    const maxTokens = calcMaxTokens(scriptParams.duration_minutes)
    console.log(`[generate/script] duration=${scriptParams.duration_minutes}min max_tokens=${maxTokens}`)

    let script: string
    if (model === 'gpt-4o') {
      script = await generateWithGpt4o(prompt, maxTokens)
    } else {
      script = await generateWithClaude(prompt, model === 'claude-opus', maxTokens)
    }

    if (!script) {
      return NextResponse.json({ ok: false, error: 'Модель вернула пустой ответ' }, { status: 502 })
    }

    await spendCredits(user.id, cost, operation, project_id)

    if (project_id) {
      const update: Record<string, unknown> = {
        script,
        status: 'draft',
        credits_spent: cost,
        language: scriptParams.language ?? null,
      }
      if (plan_sections && plan_sections.length > 0) {
        update.plan_sections = plan_sections
      }
      await supabase
        .from('projects')
        .update(update)
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    void trackEvent(user.id, 'step_completed', { step: 'script', model, project_id })
    return NextResponse.json({ ok: true, data: { script } })
  } catch (error) {
    console.error('[generate/script]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации сценария' }, { status: 500 })
  }
}
