import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'
import type { ScriptParams, PlanSection, ScriptModel } from '@/lib/types'
import { CREDIT_COSTS } from '@/lib/types'
import { isGuardOk, countWords, runParallelGuarded, MIN_TOKENS, MIN_OUTPUT_RATIO } from '@/lib/enhance-guard'
import { parseClaudeJsonArray } from '@/lib/parse-claude-json'

export const maxDuration = 300

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
      lines.push(`${i + 1}. ${s.title} — ${s.description}`)
    }
    if (p.scene_markers) {
      lines.push('Используй названия секций выше как заголовки маркеров [Сцена N: Название].')
    }
  }

  lines.push(
    '',
    'ФОРМАТ ВЫВОДА:',
    'Выводи только текст сценария для озвучки. Без вступительных фраз, без пояснений, без ремарок типа «(пауза)» или «(музыка)» — только слова для чтения вслух.',
    'НЕ используй Markdown-разметку: никаких # ## заголовков, никаких --- разделителей, никаких **жирный** или *курсив* символов. Только чистый связный текст.',
    'НЕ добавляй структурные заголовки и метки: никаких «Сцена 1», «Секция 2», «Глава 3», «Часть 4», «Scene/Section/Chapter/Part N» — ни со скобками, ни без. Текст должен быть сплошным повествованием для диктора.',
  )
  if (p.scene_markers) {
    lines.push('ЕДИНСТВЕННОЕ исключение: маркеры строго в формате [Сцена N: Название] на отдельной строке, как указано выше.')
  }
  lines.push(
    '',
    'ПРАВИЛА ДЛЯ ОЗВУЧКИ (TTS):',
    'Текст будет синтезирован голосом — пиши так, как это ПРОИЗНОСИТСЯ, а не как пишется в статье.',
    'Числа — словами: «5%» → «пять процентов», «2026 год» → «две тысячи двадцать шестой год», «100$» → «сто долларов», «3,5 млн» → «три с половиной миллиона». Годы, проценты, суммы, количества — всегда словами на языке сценария.',
    'Сокращения — раскрывай полностью: «т.к.» → «так как», «т.е.» → «то есть», «и т.д.» → «и так далее», «напр.» → «например», «др.» → «другие». Аналогично для сокращений на других языках.',
    'Символы — словами: «№» → «номер», «%» → «процентов», «$» → «долларов», «₽» → «рублей», «&» → «и», знак «+» в тексте → «плюс».',
    'Аббревиатуры — расшифровывай при первом употреблении, если они не читаются как слово и не очевидны широкой аудитории.',
    'Предложения — произносимые: избегай очень длинных конструкций с несколькими придаточными подряд. Разбивай на короткие там, где это естественно для речи.',
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

// Dynamic token budget: 130 words/min × 2.9 tok/word (RU ≈2.9; EN cheaper — intentional headroom) × 1.3 buffer.
// Cap: GPT-4o 16 384; Claude 32 768 (covers RU up to ~87 min before cap bites).
function calcMaxTokens(durationMinutes: number, model: ScriptModel): number {
  const raw = Math.max(2048, Math.ceil(durationMinutes * 130 * 2.9 * 1.3))
  const cap  = model === 'gpt-4o' ? 16_384 : 32_768
  return Math.min(cap, raw)
}

type GenResult = { text: string; stopReason: string | null }

async function generateWithClaude(prompt: string, opus: boolean, maxTokens: number): Promise<GenResult> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  const modelId = opus ? 'claude-opus-4-5' : 'claude-sonnet-4-6'
  const message = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  console.log(`[generate/script] stop_reason=${message.stop_reason} usage=${JSON.stringify(message.usage)}`)
  const block = message.content[0]
  return { text: block.type === 'text' ? block.text : '', stopReason: message.stop_reason }
}

async function generateWithGpt4o(prompt: string, maxTokens: number): Promise<GenResult> {
  const openai = new OpenAI({ apiKey: env('OPENAI_API_KEY') })
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  })
  const choice = completion.choices[0]
  console.log(`[generate/script] stop_reason=${choice.finish_reason} usage=${JSON.stringify(completion.usage)}`)
  return { text: choice.message.content ?? '', stopReason: choice.finish_reason ?? null }
}

// ── Constants for chunked generation ─────────────────────────────────────────

const CHUNKED_THRESHOLD = 30  // duration_minutes >= this → parallel section generation

// English language names for the internal plan prompt (mirrors plan/route.ts convention)
const PLAN_LANG_NAMES: Record<string, string> = {
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

// Generate a plan internally when user skipped the plan step. Not charged (no spendCredits).
async function generateInternalPlan(anthropic: Anthropic, p: ScriptParams): Promise<PlanSection[]> {
  const n = calcSectionCount(p.duration_minutes)
  const maxTokens = n * 150 + 500
  const langName = PLAN_LANG_NAMES[p.language] ?? p.language
  const minsPerSection = (p.duration_minutes / n).toFixed(1)

  const prompt = [
    `Generate a structural plan for a YouTube video. Write all titles and descriptions in ${langName}.`,
    '',
    `Topic: "${p.topic}"`,
    `Duration: ${p.duration_minutes} min (target: 130 words/min)`,
    `Style: ${p.narrative_style}`,
    `Tone: ${p.tone}`,
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

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })

  console.log(`[generate/script] internal-plan stop_reason=${message.stop_reason} sections_n=${n}`)

  const block = message.content[0]
  const raw = block.type === 'text' ? block.text : ''
  if (!raw) return []

  try {
    const parsed = parseClaudeJsonArray<{ title?: unknown; description?: unknown }>(raw, 'internal-plan')
    return parsed
      .filter(s => s && typeof s.title === 'string' && typeof s.description === 'string')
      .map(s => ({ title: String(s.title).trim(), description: String(s.description).trim() }))
  } catch {
    console.error('[generate/script] internal-plan parse error, raw tail:', raw.slice(-300))
    return []
  }
}

// System prompt shared by all section calls (cached via cache_control: ephemeral)
function buildSystemPrompt(p: ScriptParams): string {
  const langName = PLAN_LANG_NAMES[p.language] ?? p.language

  const lines: string[] = [
    'CRITICAL LANGUAGE RULE — READ THIS FIRST:',
    `Write your ENTIRE response in ${langName}. ALL output text must be in ${langName} only.`,
    '',
    'You are a professional YouTube scriptwriter writing one section of a video script.',
    '',
    'VIDEO PARAMETERS:',
    `- Narrative style: ${NARRATIVE_STYLE_LABELS[p.narrative_style] ?? p.narrative_style}`,
    `- Tone: ${TONE_LABELS[p.tone] ?? p.tone}`,
    `- Target audience: ${AUDIENCE_LABELS[p.target_audience] ?? p.target_audience}`,
  ]

  if (p.pauses) {
    lines.push('- Add breathing pauses as [...] at natural stopping points')
  }

  lines.push(
    '',
    'OUTPUT FORMAT:',
    'Output ONLY the voiceover text for this section. No preamble, no explanations, no labels.',
    'NO Markdown: no # headings, no --- separators, no **bold** or *italic* formatting.',
    'NO section headers: no "Section N:", "Part N:", "Chapter N:" labels of any kind.',
  )

  if (p.scene_markers) {
    lines.push('EXCEPTION: start this section with exactly one scene marker [Сцена N: Title] on its own line.')
  }

  lines.push(
    '',
    'TTS RULES (text will be synthesized by voice):',
    'Numbers as words. Expand all abbreviations. Symbols as words.',
    'Decode acronyms on first use. Keep sentences natural and speakable.',
  )

  return lines.join('\n')
}

function buildSectionUserMessage(
  p: ScriptParams,
  section: PlanSection,
  idx: number,
  total: number,
  wordsTarget: number,
  prevSection: PlanSection | null,
  nextSection: PlanSection | null,
): string {
  const isFirst = idx === 0
  const isLast  = idx === total - 1

  const lines: string[] = [
    `Напиши фрагмент сценария — секция ${idx + 1} из ${total} видео на тему: "${p.topic}".`,
    `Объём секции: от ${Math.round(wordsTarget * 1.05)} до ${Math.round(wordsTarget * 1.25)} слов. Не короче нижней границы — секция с недобором будет отклонена. Пиши развёрнуто, не обрывай мысли.`,
    '',
  ]

  if (prevSection || nextSection) {
    lines.push('[Контекст соседних секций — в твой текст НЕ включать]:')
    if (prevSection) lines.push(`Предыдущая: "${prevSection.title}" — ${prevSection.description}`)
    if (nextSection) lines.push(`Следующая: "${nextSection.title}" — ${nextSection.description}`)
    lines.push('')
  }

  lines.push('[Содержание этой секции]:')
  lines.push(`${section.title}: ${section.description}`)
  lines.push('')

  if (isFirst) {
    if (p.hook) {
      lines.push(`Начни с хука (${HOOK_LABELS[p.hook_type] ?? p.hook_type}) — первые 15 секунд захватывают внимание.`)
    } else {
      lines.push('Начни со вступления к видео.')
    }
  } else {
    lines.push('Начни сразу с содержания секции (без приветствий, вступлений и анонса).')
  }

  if (isLast) {
    if (p.cta) {
      lines.push('Заверши призывом к действию: попроси подписаться, поставить лайк, написать комментарий.')
    } else {
      lines.push('Заверши итогом и прощанием.')
    }
  } else {
    lines.push('Заверши мысль секции естественно — без финального слова, итога или прощания.')
  }

  if (p.scene_markers) {
    lines.push(`Начни строго с маркера [Сцена ${idx + 1}: ${section.title}] на отдельной строке.`)
  }

  return lines.join('\n')
}

async function generateChunkedScript(p: ScriptParams, sections: PlanSection[]): Promise<string | null> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  const opus = p.model === 'claude-opus'
  const modelId = opus ? 'claude-opus-4-5' : 'claude-sonnet-4-6'
  const systemPrompt = buildSystemPrompt(p)
  const wordsPerSection = Math.round((p.duration_minutes * 130) / sections.length)
  const sectionMaxTokens = Math.max(MIN_TOKENS, Math.ceil(wordsPerSection * 2.9 * 1.3))

  console.log(`[generate/script] chunked model=${modelId} sections=${sections.length} wordsPerSec=${wordsPerSection}`)

  const callSection = async (section: PlanSection, idx: number): Promise<GenResult> => {
    const prevSection = idx > 0 ? sections[idx - 1] : null
    const nextSection = idx < sections.length - 1 ? sections[idx + 1] : null
    const userMessage = buildSectionUserMessage(p, section, idx, sections.length, wordsPerSection, prevSection, nextSection)

    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: sectionMaxTokens,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    console.log(`[generate/script] section=${idx + 1}/${sections.length} stop_reason=${message.stop_reason} usage=${JSON.stringify(message.usage)}`)

    const block = message.content[0]
    return { text: block.type === 'text' ? block.text.trim() : '', stopReason: message.stop_reason }
  }

  const guardSection = (result: GenResult) => isGuardOk(result.stopReason, result.text, wordsPerSection, 0.75)

  // prompt caching вернуть, если системник вырастет ≥1024 ток
  const results = await runParallelGuarded(sections, callSection, guardSection, 'generate/script-chunked')
  if (results === null) return null

  const assembled = results.map(r => r.text).join('\n\n')

  const totalWords = countWords(assembled)
  const totalTarget = p.duration_minutes * 130
  if (totalWords < totalTarget * MIN_OUTPUT_RATIO) {
    console.error(`[generate/script] chunked final guard fail: words=${totalWords} target=${totalTarget}`)
    return null
  }

  return assembled
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

    // GPT-4o cannot run section-parallel generation (16 384 token cap is too low per section).
    if (model === 'gpt-4o' && scriptParams.duration_minutes >= CHUNKED_THRESHOLD) {
      return NextResponse.json({
        ok: false,
        error: `GPT-4o не поддерживает посекционную генерацию для видео ${CHUNKED_THRESHOLD} мин и длиннее. Выберите Claude Sonnet или Opus.`,
        code: 'GPT4O_DURATION_LIMIT',
      }, { status: 422 })
    }

    const operation = modelOperation(model)
    const cost = modelCost(model)

    const check = await requireCredits(user.id, operation, supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    if (scriptParams.duration_minutes >= CHUNKED_THRESHOLD) {
      // ── Chunked path: parallel section generation ─────────────────────────
      const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
      let usedSections: PlanSection[]

      if (plan_sections && plan_sections.length > 0) {
        usedSections = plan_sections
      } else {
        console.log(`[generate/script] generating internal plan for ${scriptParams.duration_minutes}min`)
        usedSections = await generateInternalPlan(anthropic, scriptParams)
        if (usedSections.length === 0) {
          return NextResponse.json({ ok: false, error: 'Не удалось сгенерировать план для посекционной генерации' }, { status: 502 })
        }
        console.log(`[generate/script] internal plan: ${usedSections.length} sections`)
      }

      const script = await generateChunkedScript(scriptParams, usedSections)
      if (script === null) {
        return NextResponse.json({
          ok: false,
          error: 'Не удалось сгенерировать сценарий полностью — попробуйте ещё раз.',
          code: 'SCRIPT_TRUNCATED',
        }, { status: 422 })
      }

      await spendCredits(user.id, cost, operation, project_id)

      if (project_id) {
        await supabase
          .from('projects')
          .update({
            script,
            status: 'draft',
            credits_spent: cost,
            language: scriptParams.language ?? null,
            plan_sections: usedSections,
          })
          .eq('id', project_id)
          .eq('user_id', user.id)
      }

      void trackEvent(user.id, 'step_completed', { step: 'script', model, project_id, chunked: true })
      return NextResponse.json({ ok: true, data: { script } })
    }

    // ── Single-call path (duration < CHUNKED_THRESHOLD) ──────────────────────
    const prompt = buildPrompt(scriptParams, plan_sections)
    const maxTokens = calcMaxTokens(scriptParams.duration_minutes, model)
    const targetWords = scriptParams.duration_minutes * 130
    console.log(`[generate/script] duration=${scriptParams.duration_minutes}min max_tokens=${maxTokens} target_words=${targetWords}`)

    const callGenerate = (): Promise<GenResult> =>
      model === 'gpt-4o'
        ? generateWithGpt4o(prompt, maxTokens)
        : generateWithClaude(prompt, model === 'claude-opus', maxTokens)

    // GPT-4o uses 'length' for the same concept as Claude's 'max_tokens'
    const normaliseStop = (r: string | null) => r === 'length' ? 'max_tokens' : r

    let gen = await callGenerate()
    let normStop = normaliseStop(gen.stopReason)

    if (!gen.text) {
      return NextResponse.json({ ok: false, error: 'Модель вернула пустой ответ' }, { status: 502 })
    }

    // Guard: stop_reason=max_tokens OR output < 85 % of target words → retry once, then 422 (no credits)
    if (!isGuardOk(normStop, gen.text, targetWords)) {
      console.warn(`[generate/script] guard fail attempt=1 words=${countWords(gen.text)} target=${targetWords} stop_reason=${normStop} — retrying`)
      const retry = await callGenerate()
      const retryStop = normaliseStop(retry.stopReason)
      if (!retry.text || !isGuardOk(retryStop, retry.text, targetWords)) {
        console.error(`[generate/script] guard fail attempt=2 words=${retry.text ? countWords(retry.text) : 0} stop_reason=${retryStop} — aborting, credits not charged`)
        return NextResponse.json({
          ok: false,
          error: 'Не удалось сгенерировать сценарий полностью — попробуйте ещё раз.',
          code: 'SCRIPT_TRUNCATED',
        }, { status: 422 })
      }
      gen = retry
    }

    const script = gen.text

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
