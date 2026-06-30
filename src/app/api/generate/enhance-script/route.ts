import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'

export const maxDuration = 120

const LANG_NAMES: Record<string, string> = {
  ru: 'Russian (русский)',
  en: 'English',
  de: 'German (Deutsch)',
  fr: 'French (Français)',
  es: 'Spanish (Español)',
  it: 'Italian (Italiano)',
  pt: 'Portuguese (Português)',
  zh: 'Chinese (中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  ar: 'Arabic (العربية)',
  hi: 'Hindi (हिंदी)',
  nl: 'Dutch (Nederlands)',
  pl: 'Polish (Polski)',
  tr: 'Turkish (Türkçe)',
  sv: 'Swedish (Svenska)',
  no: 'Norwegian (Norsk)',
  da: 'Danish (Dansk)',
  fi: 'Finnish (Suomi)',
  uk: 'Ukrainian (Українська)',
  cs: 'Czech (Čeština)',
  ro: 'Romanian (Română)',
  hu: 'Hungarian (Magyar)',
  el: 'Greek (Ελληνικά)',
  he: 'Hebrew (עברית)',
  th: 'Thai (ภาษาไทย)',
  id: 'Indonesian (Bahasa Indonesia)',
  vi: 'Vietnamese (Tiếng Việt)',
}

// Copied verbatim from script/route.ts:50-55 — keep in sync if source changes.
const HOOK_LABELS: Record<string, string> = {
  question:    'риторический вопрос',
  statistic:   'удивительная статистика',
  story:       'захватывающая история',
  provocation: 'провокационное заявление',
}

function buildPrompt(
  hook: boolean,
  hookType: string,
  cta: boolean,
  pauses: boolean,
  outputLang: string,
): string {
  const langName = LANG_NAMES[outputLang] ?? outputLang

  const instructions: string[] = []
  if (hook) {
    // Verbatim from script/route.ts:73
    instructions.push(`- Хук в начале: ${HOOK_LABELS[hookType] ?? hookType} (первые 15 секунд должны захватывать внимание)`)
  }
  if (cta) {
    // Verbatim from script/route.ts:76
    instructions.push('- В конце добавь призыв к действию: попроси подписаться, лайкнуть или написать комментарий')
  }
  if (pauses) {
    // Verbatim from script/route.ts:82
    instructions.push('- Добавь паузы для дыхания в виде [...] в местах естественных остановок')
  }

  return [
    `LANGUAGE RULE: Write your ENTIRE response in ${langName}. The input is already in this language — do NOT translate. Preserve the language exactly.`,
    '',
    'Усиль этот готовый текст сценария, применив следующие улучшения. Сохрани смысл, структуру и стиль текста:',
    '',
    ...instructions,
    '',
    'ФОРМАТ ВЫВОДА:',
    'Верни только усиленный текст. Без вступительных фраз, без пояснений — только текст сценария.',
  ].join('\n')
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as {
      script?: string
      hook?: boolean
      hook_type?: string
      cta?: boolean
      pauses?: boolean
      output_lang?: string
      project_id?: string
    }

    const {
      script,
      hook = false,
      hook_type = 'question',
      cta = false,
      pauses = false,
      output_lang = 'ru',
      project_id,
    } = body

    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'Текст не может быть пустым' }, { status: 400 })
    }

    if (!hook && !cta && !pauses) {
      return NextResponse.json({ ok: false, error: 'Выберите хотя бы одно улучшение' }, { status: 400 })
    }

    const outputLang = Object.keys(LANG_NAMES).includes(output_lang) ? output_lang : 'ru'
    const hookType = Object.keys(HOOK_LABELS).includes(hook_type) ? hook_type : 'question'

    const check = await requireCreditsAmount(user.id, CREDIT_COSTS.enhance, supabase)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    const systemPrompt = buildPrompt(hook, hookType, cta, pauses, outputLang)
    console.log(`[enhance-script] hook=${hook}(${hookType}) cta=${cta} pauses=${pauses} lang=${outputLang}`)

    const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `ТЕКСТ:\n${script}` }],
    })
    console.log(`[enhance-script] cache input:`, message.usage.input_tokens, 'cache_read:', message.usage.cache_read_input_tokens ?? 0, 'cache_write:', message.usage.cache_creation_input_tokens ?? 0)

    const result = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    if (!result) {
      return NextResponse.json({ ok: false, error: 'Пустой ответ от Claude' }, { status: 502 })
    }

    await spendCredits(user.id, CREDIT_COSTS.enhance, 'enhance_script', project_id)

    return NextResponse.json({ ok: true, data: { script: result } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/enhance-script] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка усиления текста' }, { status: 500 })
  }
}
