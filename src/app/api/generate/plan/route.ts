import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJsonArray } from '@/lib/parse-claude-json'
import type { PlanSection } from '@/lib/types'

const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'Russian', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', it: 'Italian', pt: 'Portuguese', zh: 'Chinese',
  ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi',
  nl: 'Dutch', pl: 'Polish', tr: 'Turkish', sv: 'Swedish',
  no: 'Norwegian', da: 'Danish', fi: 'Finnish', uk: 'Ukrainian',
  cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', el: 'Greek',
  he: 'Hebrew', th: 'Thai', id: 'Indonesian', vi: 'Vietnamese',
}

function calcSectionCount(durationMinutes: number): number {
  return Math.min(20, Math.max(2, Math.round(durationMinutes * 0.4 + 2)))
}

function buildPrompt(
  topic: string,
  duration_minutes: number,
  language: string,
  narrative_style: string,
  tone: string,
): string {
  const n = calcSectionCount(duration_minutes)
  const minsPerSection = (duration_minutes / n).toFixed(1)
  const langName = LANGUAGE_NAMES[language] ?? language
  return [
    `Generate a structural plan for a YouTube video. Write all titles and descriptions in ${langName}.`,
    '',
    `Topic: "${topic}"`,
    `Duration: ${duration_minutes} min (target: 130 words/min)`,
    `Style: ${narrative_style}`,
    `Tone: ${tone}`,
    '',
    `Create exactly ${n} sections (~${minsPerSection} min each).`,
    'Each section needs a short title and a 1-2 sentence description of its content.',
    '',
    'Return ONLY a JSON array, no markdown, no extra text:',
    '[',
    '  {"title": "...", "description": "..."},',
    '  ...',
    ']',
  ].join('\n')
}

function parseSections(raw: string): PlanSection[] {
  const parsed = parseClaudeJsonArray<{ title?: unknown; description?: unknown }>(raw, 'plan-sections')
  return parsed
    .filter((s) => s && typeof s.title === 'string' && typeof s.description === 'string')
    .map((s) => ({ title: String(s.title).trim(), description: String(s.description).trim() }))
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const cost = CREDIT_COSTS.plan
    const check = await requireCreditsAmount(user.id, cost, supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const body = await request.json()
    const { topic, duration_minutes, language, narrative_style, tone, project_id } = body

    if (!topic?.trim()) {
      return NextResponse.json({ ok: false, error: 'Тема не указана' }, { status: 400 })
    }

    const prompt = buildPrompt(topic, duration_minutes ?? 5, language ?? 'ru', narrative_style ?? 'storytelling', tone ?? 'neutral')

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = message.content[0]
    const raw = block.type === 'text' ? block.text : ''
    if (!raw) return NextResponse.json({ ok: false, error: 'Модель вернула пустой ответ' }, { status: 502 })

    let sections: PlanSection[]
    try {
      sections = parseSections(raw)
    } catch {
      console.error('[generate/plan] parse error, raw:', raw.slice(0, 300))
      return NextResponse.json({ ok: false, error: 'Ошибка разбора плана от модели' }, { status: 502 })
    }

    if (sections.length === 0) {
      return NextResponse.json({ ok: false, error: 'Модель вернула пустой план' }, { status: 502 })
    }

    await spendCredits(user.id, cost, 'plan', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({ plan_sections: sections })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { sections } })
  } catch (error) {
    console.error('[generate/plan]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации плана' }, { status: 500 })
  }
}
