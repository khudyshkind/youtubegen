import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJsonArray } from '@/lib/parse-claude-json'
import type { PlanSection } from '@/lib/types'
import { isBillingError, notifyBillingError, notifyError } from '@/lib/telegram'
import { isAnthropicOverload, withAnthropicRetry } from '@/lib/anthropic-retry'
import { startOpLog, finishOpLog } from '@/lib/operation-log'

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
  const lines = [
    `Generate a structural plan for a YouTube video. Write all titles and descriptions in ${langName}.`,
    '',
    `Topic: "${topic}"`,
    `Duration: ${duration_minutes} min (target: 130 words/min)`,
    `Style: ${narrative_style}`,
    `Tone: ${tone}`,
    '',
    `Create exactly ${n} sections (~${minsPerSection} min each).`,
    'Each section description must state WHAT HAPPENS or WHAT IS REVEALED in that section — not just its theme.',
    'Every section must introduce events, revelations, or information that appear in NO other section.',
  ]
  if (narrative_style === 'storytelling') {
    lines.push(
      '',
      'For STORYTELLING style — additional requirements:',
      '• Sections must follow a narrative arc: introduction → complication → escalation → turning point → resolution.',
      '• Each description must state WHAT HAPPENS and WHAT CHANGES, not just name the theme.',
      '• A story event (e.g. a separation, confrontation, or turning point) must appear in EXACTLY ONE section — never split the same event across two sections.',
      '• The story must move FORWARD: each section takes the narrative past where the previous one ended.',
    )
  }
  lines.push(
    '',
    'Return ONLY a JSON array, no markdown, no extra text:',
    '[',
    '  {"title": "...", "description": "..."},',
    '  ...',
    ']',
  )
  return lines.join('\n')
}

function parseSections(raw: string): PlanSection[] {
  const parsed = parseClaudeJsonArray<{ title?: unknown; description?: unknown }>(raw, 'plan-sections')
  return parsed
    .filter((s) => s && typeof s.title === 'string' && typeof s.description === 'string')
    .map((s) => ({ title: String(s.title).trim(), description: String(s.description).trim() }))
}

export async function POST(request: NextRequest) {
  let alertUserId: string | undefined
  let alertProjectId: string | undefined
  let _opLogId: string | null = null
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }
    alertUserId = user.id

    const cost = CREDIT_COSTS.plan
    const check = await requireCreditsAmount(user.id, cost, supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const body = await request.json()
    const { topic, duration_minutes, language, narrative_style, tone, project_id } = body
    alertProjectId = project_id ?? undefined

    if (!topic?.trim()) {
      return NextResponse.json({ ok: false, error: 'Тема не указана' }, { status: 400 })
    }

    _opLogId = await startOpLog({ userId: user.id, projectId: project_id ?? null, opType: 'plan', provider: 'claude-sonnet-4-6' })

    const sectionCount = calcSectionCount(duration_minutes ?? 5)
    const planMaxTokens = sectionCount * 150 + 500
    const prompt = buildPrompt(topic, duration_minutes ?? 5, language ?? 'ru', narrative_style ?? 'storytelling', tone ?? 'neutral')

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 60_000, maxRetries: 0 })

    async function callPlan() {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: planMaxTokens,
        messages: [{ role: 'user', content: prompt }],
      })
      console.log(`[generate/plan] stop_reason=${message.stop_reason} usage=${JSON.stringify(message.usage)} sections_n=${sectionCount}`)
      const block = message.content[0]
      return { raw: block.type === 'text' ? block.text : '', stopReason: message.stop_reason }
    }

    let { raw, stopReason } = await withAnthropicRetry(callPlan, 'generate/plan')

    if (stopReason === 'max_tokens') {
      console.warn(`[generate/plan] max_tokens attempt=1 sections_n=${sectionCount} — retrying`)
      const retry = await callPlan()
      raw = retry.raw
      stopReason = retry.stopReason
      if (stopReason === 'max_tokens') {
        console.error(`[generate/plan] max_tokens attempt=2 — aborting, credits not charged`)
        void finishOpLog(_opLogId, { status: 'failed', errorText: 'PLAN_TRUNCATED: max_tokens after retry' })
        return NextResponse.json({
          ok: false,
          error: 'Не удалось сгенерировать план целиком — попробуйте ещё раз.',
          code: 'PLAN_TRUNCATED',
        }, { status: 422 })
      }
    }

    if (!raw) {
      void finishOpLog(_opLogId, { status: 'failed', errorText: 'empty model response' })
      return NextResponse.json({ ok: false, error: 'Модель вернула пустой ответ' }, { status: 502 })
    }

    let sections: PlanSection[]
    try {
      sections = parseSections(raw)
    } catch {
      console.error('[generate/plan] parse error, raw tail:', raw.slice(-300))
      void finishOpLog(_opLogId, { status: 'failed', errorText: 'plan parse error' })
      return NextResponse.json({ ok: false, error: 'Ошибка разбора плана от модели' }, { status: 502 })
    }

    if (sections.length === 0) {
      void finishOpLog(_opLogId, { status: 'failed', errorText: 'empty sections returned' })
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

    void finishOpLog(_opLogId, { status: 'done', creditsSpent: cost })
    return NextResponse.json({ ok: true, data: { sections } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    void finishOpLog(_opLogId, { status: 'failed', errorText: msg.slice(0, 500) })
    console.error('[generate/plan]', msg)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/generate/plan', { userId: alertUserId, projectId: alertProjectId }).catch(() => {})
    else await notifyError('/generate/plan', msg, { userId: alertUserId, projectId: alertProjectId }).catch(() => {})
    if (isAnthropicOverload(error)) {
      return NextResponse.json({ ok: false, error: 'Нейросеть перегружена — попробуйте через минуту', code: 'OVERLOADED' }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: 'Ошибка генерации плана' }, { status: 500 })
  }
}
