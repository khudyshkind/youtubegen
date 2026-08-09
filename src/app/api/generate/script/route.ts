import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { isBillingError, notifyBillingError, notifyError } from '@/lib/telegram'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'
import type { ScriptParams, PlanSection, ScriptModel } from '@/lib/types'
import { CREDIT_COSTS } from '@/lib/types'
import { isGuardOk, countWords, runParallelGuarded, MIN_TOKENS, MIN_OUTPUT_RATIO } from '@/lib/enhance-guard'
import { parseClaudeJsonArray } from '@/lib/parse-claude-json'
import { isAnthropicOverload, isAnthropicTimeout } from '@/lib/anthropic-retry'

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
    `- Длительность: ${p.duration_minutes} мин. TTS-голос воспроизводит текст в темпе ~130 слов/мин — ориентируйся именно на этот темп при написании.`,
    `- Объём текста: не менее ${wordsTarget} слов. Если текст кажется завершённым раньше — дополни деталями, примерами или переходами. Сокращать нельзя.`,
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

// Pass 2 prompt: asks model to expand an existing draft to the target word count.
// The model outputs the FULL expanded text (draft merged with additions).
function buildExpandPrompt(p: ScriptParams, draft: string, draftWords: number, targetWords: number): string {
  const langName = LANGUAGE_NAMES[p.language] ?? p.language
  const needed = targetWords - draftWords
  return [
    `Ниже — черновик сценария YouTube-видео на тему "${p.topic}" (${draftWords} слов из целевых ${targetWords}).`,
    '',
    `ЗАДАЧА: дополни черновик до ${targetWords} слов — нужно дописать ещё ~${needed} слов.`,
    'Не переписывай — только расширяй существующий текст:',
    '• добавляй конкретные примеры, факты, истории',
    '• углубляй тезисы — объясняй «почему» и «как»',
    '• добавляй плавные переходы между мыслями',
    '• расширяй разделы, которые можно раскрыть подробнее',
    '',
    `Весь текст — на ${langName} языке. Без Markdown, без заголовков, без ремарок типа «(пауза)». Только сплошной текст для голосовой озвучки.`,
    'Выведи ПОЛНЫЙ текст (черновик + дополнения слитно, без разрывов и меток «черновик/добавление»).',
    '',
    '═══ ЧЕРНОВИК ═══',
    draft,
    '═══ КОНЕЦ ЧЕРНОВИКА ═══',
  ].join('\n')
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

// Dynamic SDK timeout: 15 ms/token ≈ 67 tok/s.
// Measured on 2026-08-09: 20-min video timed out at 12ms/tok (83 tok/s floor proved too optimistic).
// Cap at 130 s: two attempts + 16 s delay = 276 s < maxDuration=300 s.
// Reference (single-call path, CHUNKED_THRESHOLD=18 so max single-call is ~17 min):
//   5 min → 2 458 tok →  36 870 ms
//  10 min → 4 914 tok →  73 710 ms
//  15 min → 7 373 tok → 110 595 ms
//  17 min → 8 334 tok → 125 010 ms  ← max single-call (< 18 min threshold)
function calcTimeout(maxTokens: number): number {
  return Math.min(130_000, Math.max(30_000, maxTokens * 15))
}

type GenResult = { text: string; stopReason: string | null }

const scriptSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function generateWithClaude(prompt: string, opus: boolean, maxTokens: number, timeoutMs: number): Promise<GenResult> {
  // maxRetries:0 — we handle overload/timeout retries ourselves with a proper 16s delay
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: timeoutMs, maxRetries: 0 })
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

const CHUNKED_THRESHOLD = 18  // duration_minutes >= this → parallel section generation

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

  const promptLines = [
    `Generate a structural plan for a YouTube video. Write all titles and descriptions in ${langName}.`,
    '',
    `Topic: "${p.topic}"`,
    `Duration: ${p.duration_minutes} min (target: 130 words/min)`,
    `Style: ${p.narrative_style}`,
    `Tone: ${p.tone}`,
    '',
    `Create exactly ${n} sections (~${minsPerSection} min each).`,
    'Each section description must state WHAT HAPPENS or WHAT IS REVEALED in that section — not just its theme.',
    'Every section must introduce events, revelations, or information that appear in NO other section.',
  ]
  if (p.narrative_style === 'storytelling') {
    promptLines.push(
      '',
      'For STORYTELLING style — additional requirements:',
      '• Sections must follow a narrative arc: introduction → complication → escalation → turning point → resolution.',
      '• Each description must state WHAT HAPPENS and WHAT CHANGES, not just name the theme.',
      '• A story event (e.g. a separation, confrontation, or turning point) must appear in EXACTLY ONE section — never split the same event across two sections.',
      '• The story must move FORWARD: each section takes the narrative past where the previous one ended.',
    )
  }
  promptLines.push(
    '',
    'Return ONLY a JSON array, no markdown, no extra text:',
    '[',
    '  {"title": "...", "description": "..."},',
    '  ...',
    ']',
  )
  const prompt = promptLines.join('\n')

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
function buildSystemPrompt(p: ScriptParams, factsCard?: string): string {
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
    'NO section headers: no "[Сцена N]", "[Scene N]", "Section N:", "Part N:", "Chapter N:" labels of any kind.',
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

  if (factsCard) {
    lines.push(
      '',
      'CANONICAL FACTS — follow exactly, never contradict:',
      factsCard,
      '',
      'TIMELINE RULE: do NOT introduce any new date, duration, or time interval not listed in TIMELINE above.',
    )
  }

  return lines.join('\n')
}

function buildSectionUserMessage(
  p: ScriptParams,
  section: PlanSection,
  idx: number,
  sections: PlanSection[],
  wordsTarget: number,
): string {
  const total = sections.length
  const isFirst = idx === 0
  const isLast  = idx === total - 1

  // Jitter: 0 / +5% / +10% cycling so adjacent sections target different lengths
  const j = (idx % 3) * 0.05
  const low  = Math.round(wordsTarget * (1.05 + j))
  const high = Math.round(wordsTarget * (1.25 + j))

  const lines: string[] = [
    `Напиши фрагмент сценария — секция ${idx + 1} из ${total} видео на тему: "${p.topic}".`,
    `Объём секции: от ${low} до ${high} слов.`,
    '',
    'Полная структура видео (что раскрыто в других секциях — НЕ повторяй их факты, не представляй заново людей/объекты, упомянутые там):',
    ...sections.map((s, i) => `${i + 1}. ${s.title}: ${s.description}`),
    '',
    '[Содержание ЭТОЙ секции — напиши только её]:',
    `${section.title}: ${section.description}`,
    '',
  ]

  if (isFirst) {
    if (p.hook) {
      lines.push(`Начни с хука (${HOOK_LABELS[p.hook_type] ?? p.hook_type}) — первые 15 секунд захватывают внимание.`)
    } else {
      lines.push('Начни со вступления к видео.')
    }
  } else {
    lines.push('Начни секцию в СВОЕЙ манере, не повторяя манеру соседних: где-то с факта, где-то со сцены, вопроса, короткой реплики или детали. Запрещены только шаблонные открытия («Представьте себе», «Давайте поговорим», «Итак»).')
    lines.push('Длина абзацев и ритм предложений в этой секции не должны повторять соседние — пиши естественно, с неровностями живой речи, без канцелярита.')
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

// One Haiku call before parallel sections: fixes cross-section inconsistencies (names, dates,
// locations, season, motif assignment, objects) without sacrificing parallelism (~2-3s overhead).
// If the plan omits a fact, Haiku invents a concrete one — never leaves a field vague.
// max_tokens 500: storytelling TIMELINE expands to month-by-month (~200 tok); other styles ~100 tok.
async function buildFactsCard(p: ScriptParams, sections: PlanSection[]): Promise<string> {
  const langName = PLAN_LANG_NAMES[p.language] ?? p.language
  const sectionList = sections.map((s, i) => `${i + 1}. ${s.title}: ${s.description}`).join('\n')
  const haiku = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 20_000, maxRetries: 0 })
  const isStorytelling = p.narrative_style === 'storytelling'

  const promptLines = [
    `You are preparing canonical facts for a YouTube script written entirely in ${langName}.`,
    `Topic: "${p.topic}"`,
    `Style: ${p.narrative_style}`,
    '',
    'Video plan:',
    sectionList,
    '',
    `Extract or INVENT specific canonical facts. Write ALL values in ${langName}.`,
    'If a fact is absent from the plan — invent a concrete specific one; never leave a field vague or blank.',
  ]

  if (isStorytelling) {
    promptLines.push(
      'For TIMELINE: list ALL story events in chronological order with explicit months/years',
      '(e.g. "Янв 2023 — свадьба; Апр — переезд; Авг — изгнание; Дек 2023 — финал").',
      'Cover from the very first event to the very last, so sections have no gaps to fill themselves.',
    )
  }

  promptLines.push(
    'For OBJECTS: name any emotionally significant prop that recurs across multiple scenes',
    '(toy, letter, key, photo). Give exact visual description (color, size, damage). Write "none" if no such prop.',
    '',
    'Reply in this exact format (one line per field):',
    'CHARACTERS: [name — role; name — role]',
    isStorytelling
      ? 'TIMELINE: [month year — event; month — event; ... all events in order]'
      : 'TIMELINE: [key durations, ages, or dates]',
    'LOCATIONS: [key places where events happen]',
    'SEASON/TIME: [season or time period when story takes place]',
    'MOTIFS: [unique phrase or image → section N only; phrases that must NOT repeat across sections]',
    'OBJECTS: [prop with exact visual detail — first appears section N; or "none"]',
  )

  const message = await haiku.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: promptLines.join('\n') }],
  })

  const block = message.content[0]
  return block.type === 'text' ? block.text.trim() : ''
}

async function generateChunkedScript(p: ScriptParams, sections: PlanSection[]): Promise<string | null> {
  const opus = p.model === 'claude-opus'
  const modelId = opus ? 'claude-opus-4-5' : 'claude-sonnet-4-6'
  const wordsPerSection = Math.round((p.duration_minutes * 130) / sections.length)
  const sectionMaxTokens = Math.max(MIN_TOKENS, Math.ceil(wordsPerSection * 2.9 * 1.3))
  // maxRetries:0 — SDK default (2) would silently retry on 529, burning 240s × 3 attempts > maxDuration=300s.
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: calcTimeout(sectionMaxTokens), maxRetries: 0 })

  // Facts card: one Haiku call (~2-3s) before parallel sections fixes names/dates/season/motifs globally.
  let factsCard = ''
  try {
    factsCard = await buildFactsCard(p, sections)
    console.log(`[generate/script] facts-card: ${factsCard.slice(0, 120).replace(/\n/g, ' ')}`)
  } catch (err) {
    console.warn('[generate/script] facts-card failed, proceeding without it:', err instanceof Error ? err.message.slice(0, 80) : String(err))
  }

  const systemPrompt = buildSystemPrompt(p, factsCard || undefined)
  console.log(`[generate/script] chunked model=${modelId} sections=${sections.length} wordsPerSec=${wordsPerSection}`)

  const callSection = async (section: PlanSection, idx: number): Promise<GenResult> => {
    const userMessage = buildSectionUserMessage(p, section, idx, sections, wordsPerSection)

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

  // prompt caching: system ~220 tok + plan ~500-650 tok + facts card ~100-200 tok ≈ 820-1070.
  // May cross the 1024-token Sonnet minimum for longer videos with storytelling cards — cache can activate.
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
      // This client is used only for generateInternalPlan (plan JSON, small output).
      // maxRetries:0 — consistent with single-call path; sections handled by generateChunkedScript's own client.
      const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 60_000, maxRetries: 0 })
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
    const timeoutMs = calcTimeout(maxTokens)
    const targetWords = scriptParams.duration_minutes * 130
    console.log(`[generate/script] duration=${scriptParams.duration_minutes}min max_tokens=${maxTokens} timeout=${timeoutMs}ms target_words=${targetWords}`)

    const callGenerate = (): Promise<GenResult> =>
      model === 'gpt-4o'
        ? generateWithGpt4o(prompt, maxTokens)
        : generateWithClaude(prompt, model === 'claude-opus', maxTokens, timeoutMs)

    // GPT-4o uses 'length' for the same concept as Claude's 'max_tokens'
    const normaliseStop = (r: string | null) => r === 'length' ? 'max_tokens' : r

    // API-level retry: on 529/503 (overload) or timeout, wait 16s and retry once.
    // Math: 130s attempt1 + 16–20s sleep + 130s attempt2 = 276–280s < maxDuration=300s.
    // didRetry flag: skip two-pass expand when retry happened to stay within the 300s budget.
    let gen: GenResult
    let didRetry = false
    try {
      gen = await callGenerate()
    } catch (apiErr1) {
      if (!isAnthropicOverload(apiErr1) && !isAnthropicTimeout(apiErr1)) throw apiErr1
      const delay = 16_000 + Math.floor(Math.random() * 4_000)
      const e1 = apiErr1 instanceof Error ? apiErr1.message.slice(0, 120) : String(apiErr1)
      console.warn(`[generate/script] overload/timeout attempt=1: ${e1} — retrying in ${Math.round(delay / 1000)}s`)
      await scriptSleep(delay)
      gen = await callGenerate()  // throws on attempt 2 failure → outer catch
      didRetry = true
    }
    let normStop = normaliseStop(gen.stopReason)

    if (!gen.text) {
      return NextResponse.json({ ok: false, error: 'Модель вернула пустой ответ' }, { status: 502 })
    }

    // Two-pass expansion: if draft ended naturally but is < 95 % of target,
    // ask the model to expand it rather than blindly retry the full generation.
    // Skipped when stop_reason=max_tokens (truncated output — expansion unreliable).
    // Skipped when didRetry=true: retry already consumed ~260s of the 300s budget.
    const EXPAND_THRESHOLD = 0.95
    if (!didRetry && normStop !== 'max_tokens' && countWords(gen.text) < targetWords * EXPAND_THRESHOLD) {
      const draftWords = countWords(gen.text)
      console.log(`[generate/script] two-pass expand: draft=${draftWords} target=${targetWords} stop=${normStop}`)
      const expandPrompt = buildExpandPrompt(scriptParams, gen.text, draftWords, targetWords)
      try {
        const expanded = model === 'gpt-4o'
          ? await generateWithGpt4o(expandPrompt, maxTokens)
          : await generateWithClaude(expandPrompt, model === 'claude-opus', maxTokens, timeoutMs)
        const expandedWords = countWords(expanded.text)
        console.log(`[generate/script] expand result: words=${expandedWords} stop=${expanded.stopReason}`)
        if (expanded.text && expandedWords > draftWords) {
          gen = expanded
          normStop = normaliseStop(expanded.stopReason)
          trackEvent(user.id, 'script_expand', {
            model,
            draft_words:    draftWords,
            target_words:   targetWords,
            expanded_words: expandedWords,
          }).catch(() => {})
        }
      } catch (expandErr) {
        console.warn('[generate/script] expand call failed, using draft:', expandErr instanceof Error ? expandErr.message.slice(0, 120) : String(expandErr))
      }
    }

    // Final guard: applied to draft OR expanded result
    if (!isGuardOk(normStop, gen.text, targetWords)) {
      const actualWords = countWords(gen.text)
      const SHORT_RATIO = 0.80
      if (normStop !== 'max_tokens' && actualWords >= targetWords * SHORT_RATIO) {
        console.warn(`[generate/script] guard fallback: words=${actualWords}/${targetWords} (${Math.round(actualWords / targetWords * 100)}%) — returning with SCRIPT_SHORT`)
        await spendCredits(user.id, cost, operation, project_id)
        if (project_id) {
          const shortUpdate: Record<string, unknown> = { script: gen.text, status: 'draft', credits_spent: cost, language: scriptParams.language ?? null }
          if (plan_sections && plan_sections.length > 0) shortUpdate.plan_sections = plan_sections
          await supabase.from('projects').update(shortUpdate).eq('id', project_id).eq('user_id', user.id)
        }
        void trackEvent(user.id, 'step_completed', { step: 'script', model, project_id, short: true })
        return NextResponse.json({ ok: true, data: { script: gen.text, script_short: true, actual_words: actualWords, target_words: targetWords } })
      }
      console.error(`[generate/script] guard fail: words=${actualWords} stop=${normStop} — aborting, credits not charged`)
      return NextResponse.json({
        ok: false,
        error: 'Не удалось сгенерировать сценарий полностью — попробуйте ещё раз.',
        code: 'SCRIPT_TRUNCATED',
      }, { status: 422 })
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
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/script]', msg)
    Sentry.captureException(error)
    if (isBillingError(msg)) {
      await notifyBillingError('Anthropic', '/generate/script').catch(() => {})
    } else {
      await notifyError('/generate/script', msg).catch(() => {})
    }
    if (isAnthropicOverload(error)) {
      return NextResponse.json({ ok: false, error: 'Нейросеть перегружена — попробуйте через минуту', code: 'OVERLOADED' }, { status: 503 })
    }
    if (isAnthropicTimeout(error)) {
      return NextResponse.json({
        ok: false,
        error: 'Anthropic не успел сгенерировать сценарий в отведённое время. Кредиты не списаны. Попробуйте ещё раз или уменьшите длительность видео.',
        code: 'TIMEOUT',
      }, { status: 504 })
    }
    return NextResponse.json({ ok: false, error: 'Ошибка генерации сценария' }, { status: 500 })
  }
}
