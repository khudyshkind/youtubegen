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

const HOOK_LABELS_RU: Record<string, string> = {
  question:    'риторический вопрос',
  statistic:   'удивительная статистика',
  story:       'захватывающая история',
  provocation: 'провокационное заявление',
}

const HOOK_LABELS_EN: Record<string, string> = {
  question:    'rhetorical question',
  statistic:   'surprising statistic',
  story:       'captivating story',
  provocation: 'provocative statement',
}

function buildPrompt(
  hook: boolean,
  hookType: string,
  cta: boolean,
  pauses: boolean,
  outputLang: string,
): string {
  const langName = LANG_NAMES[outputLang] ?? outputLang
  const isRu = outputLang === 'ru'
  const hookLabels = isRu ? HOOK_LABELS_RU : HOOK_LABELS_EN

  const instructions: string[] = []
  if (hook) {
    if (isRu) {
      instructions.push(`- Хук в начале: ${hookLabels[hookType] ?? hookType} (первые 15 секунд должны захватывать внимание)`)
    } else {
      instructions.push(`- Hook at the start: ${hookLabels[hookType] ?? hookType} (first 15 seconds must grab the viewer's attention)`)
    }
  }
  if (cta) {
    if (isRu) {
      instructions.push('- В конце добавь призыв к действию: попроси подписаться, лайкнуть или написать комментарий')
    } else {
      instructions.push('- At the end, add a call to action: ask viewers to subscribe, like, or leave a comment')
    }
  }
  if (pauses) {
    if (isRu) {
      instructions.push('- Добавь паузы для дыхания в виде [...] в местах естественных остановок')
    } else {
      instructions.push('- Add breathing pauses as [...] at natural stopping points in the speech')
    }
  }

  if (isRu) {
    return [
      `LANGUAGE RULE: Write your ENTIRE response in ${langName}. Enhance the existing text — do NOT translate or change the language of the content.`,
      '',
      'Усиль этот готовый текст сценария, применив следующие улучшения. Сохрани смысл, структуру и стиль текста:',
      '',
      ...instructions,
      '',
      'ФОРМАТ ВЫВОДА:',
      'Верни только усиленный текст. Без вступительных фраз, без пояснений — только текст сценария.',
    ].join('\n')
  }

  return [
    `LANGUAGE RULE: Write your ENTIRE response in ${langName}. Enhance the existing text — do NOT translate or change the language of the content.`,
    '',
    'Enhance this ready script by applying the following improvements. Preserve the meaning, structure, and style of the text:',
    '',
    ...instructions,
    '',
    'OUTPUT FORMAT:',
    'Return only the enhanced text. No introductory phrases, no explanations — only the script text.',
  ].join('\n')
}

// Words → tokens: conservative ratio covers Russian (≈2.3 tok/word), EN (≈1.3 tok/word), mixed content.
const ENHANCE_TOKENS_PER_WORD  = 2.9
// Safety headroom: hooks, CTA, and pauses can lengthen the output by up to 40 %.
const ENHANCE_SAFETY_FACTOR    = 1.4
const ENHANCE_MIN_TOKENS       = 4_096
const ENHANCE_MAX_TOKENS       = 32_768
// Guard: output must retain ≥ this fraction of input word count; otherwise the response was truncated.
const ENHANCE_MIN_OUTPUT_RATIO = 0.85

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function calcEnhanceMaxTokens(inputText: string): number {
  const raw = Math.ceil(countWords(inputText) * ENHANCE_TOKENS_PER_WORD * ENHANCE_SAFETY_FACTOR)
  return Math.min(ENHANCE_MAX_TOKENS, Math.max(ENHANCE_MIN_TOKENS, raw))
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

    let outputLang = Object.keys(LANG_NAMES).includes(output_lang) ? output_lang : 'ru'
    const hookType = Object.keys(HOOK_LABELS_RU).includes(hook_type) ? hook_type : 'question'

    const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    // Resolve actual language from DB (authoritative) or detect from script when DB has null.
    // Overrides the client default 'ru' so pasted EN scripts are enhanced in English.
    if (project_id) {
      const { data: proj } = await supabase.from('projects').select('language').eq('id', project_id).eq('user_id', user.id).single()
      if (proj?.language && Object.keys(LANG_NAMES).includes(proj.language)) {
        if (proj.language !== outputLang) console.log(`[enhance-script] lang from DB: ${proj.language} (client: ${outputLang})`)
        outputLang = proj.language
      } else if (proj !== null && !proj.language) {
        // DB null — detect from first 500 chars of script
        try {
          const detect = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 5,
            messages: [{ role: 'user', content: `Reply with ONLY the ISO 639-1 language code of this text (e.g. "en", "ru", "es"). Nothing else.\n\n${script.slice(0, 500)}` }],
          })
          const detected = detect.content[0].type === 'text' ? detect.content[0].text.trim().toLowerCase().slice(0, 5) : null
          if (detected && Object.keys(LANG_NAMES).includes(detected)) {
            console.log(`[enhance-script] lang detected: ${detected} (client: ${outputLang})`)
            outputLang = detected
            void supabase.from('projects').update({ language: detected }).eq('id', project_id).eq('user_id', user.id)
          }
        } catch { /* keep outputLang from client */ }
      }
    }

    const check = await requireCreditsAmount(user.id, CREDIT_COSTS.enhance, supabase)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    const systemPrompt = buildPrompt(hook, hookType, cta, pauses, outputLang)
    const maxTokens  = calcEnhanceMaxTokens(script)
    const inputWords = countWords(script)
    console.log(`[enhance-script] hook=${hook}(${hookType}) cta=${cta} pauses=${pauses} lang=${outputLang} maxTokens=${maxTokens} inputWords=${inputWords}`)

    const callClaude = () => client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `ТЕКСТ:\n${script}` }],
    })

    type ClaudeMsg = Awaited<ReturnType<typeof callClaude>>

    const extractText = (msg: ClaudeMsg) =>
      msg.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('').trim()

    const guardOk = (msg: ClaudeMsg, text: string) =>
      msg.stop_reason !== 'max_tokens' && countWords(text) >= inputWords * ENHANCE_MIN_OUTPUT_RATIO

    const msg1 = await callClaude()
    console.log(`[enhance-script] attempt=1 stop_reason=${msg1.stop_reason} input_tokens=${msg1.usage.input_tokens} cache_read=${msg1.usage.cache_read_input_tokens ?? 0}`)
    let result = extractText(msg1)

    if (!result) {
      return NextResponse.json({ ok: false, error: 'Пустой ответ от Claude' }, { status: 502 })
    }

    if (!guardOk(msg1, result)) {
      console.warn(`[enhance-script] guard fail attempt=1 outputWords=${countWords(result)} inputWords=${inputWords} stop_reason=${msg1.stop_reason} — retrying`)
      const msg2 = await callClaude()
      console.log(`[enhance-script] attempt=2 stop_reason=${msg2.stop_reason}`)
      const result2 = extractText(msg2)

      if (!result2 || !guardOk(msg2, result2)) {
        console.error(`[enhance-script] guard fail attempt=2 outputWords=${countWords(result2)} — aborting, credits not charged`)
        return NextResponse.json({
          ok: false,
          error: 'Не удалось оживить текст целиком — попробуйте ещё раз или разбейте текст на части',
          code: 'ENHANCE_TRUNCATED',
        }, { status: 422 })
      }
      result = result2
    }

    await spendCredits(user.id, CREDIT_COSTS.enhance, 'enhance_script', project_id)

    return NextResponse.json({ ok: true, data: { script: result } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/enhance-script] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка усиления текста' }, { status: 500 })
  }
}
