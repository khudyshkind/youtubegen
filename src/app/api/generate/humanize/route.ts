import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'

export const maxDuration = 60

function detectLanguage(text: string): 'en' | 'ru' {
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length
  const cyrillic = (text.match(/[а-яёА-ЯЁ]/g) ?? []).length
  return latin > cyrillic ? 'en' : 'ru'
}

function buildHumanizePrompt(lang: 'en' | 'ru'): string {
  if (lang === 'en') {
    return `You are a text editor. Rewrite this script to sound like a real human, not an AI.

Rules:
1. Add small speech imperfections — thoughts that trail off and come back, slight repetitions for emphasis
2. Use conversational phrases and contractions
3. Vary sentence length — mix short and long, sometimes very short for impact. Like this.
4. Add personal asides: 'by the way', 'interestingly', 'here's the thing', 'you know what?'
5. Remove perfect structure — real people don't always speak in order
6. Replace formal words with conversational synonyms
7. Add rhetorical questions to the audience
8. Keep all meaning and facts — only the style changes
9. Keep scene markers [SCENE N] if present
10. Keep approximately the same volume of text

IMPORTANT: The text is in English. Keep it in English. Do NOT translate to any other language.

Return only the rewritten text without explanations.`
  }
  return `Ты редактор текста. Перепиши этот сценарий так чтобы он звучал как живой человек а не как ИИ.

Правила переписывания:
1. Добавь небольшие речевые несовершенства — незаконченные мысли которые потом возвращаются, лёгкие повторения для акцента
2. Используй разговорные обороты и сокращения
3. Варьируй длину предложений — чередуй короткие и длинные, иногда очень короткие для акцента. Вот так.
4. Добавь личные отступления: 'кстати', 'между прочим', 'вот что интересно', 'и знаете что?'
5. Убери идеальную структуру — настоящий человек не всегда говорит по плану
6. Замени книжные слова на разговорные синонимы
7. Добавь риторические вопросы к аудитории
8. Сохрани весь смысл и все факты — только стиль меняется
9. Сохрани маркеры сцен [СЦЕНА N] если они есть
10. Объём текста должен остаться примерно таким же

ВАЖНО: Текст на русском языке. Сохрани русский язык. НЕ переводи на другой язык.

Верни только переписанный текст без пояснений.`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as { script?: string; project_id?: string }
    const { script, project_id } = body

    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'Сценарий не может быть пустым' }, { status: 400 })
    }

    const check = await requireCredits(user.id, 'humanize', supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const lang = detectLanguage(script)

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `${buildHumanizePrompt(lang)}\n\nТЕКСТ:\n${script}`,
        },
      ],
    })

    const humanized = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    if (!humanized) {
      return NextResponse.json({ ok: false, error: 'Пустой ответ от Claude' }, { status: 502 })
    }

    await spendCredits(user.id, 1, 'humanize', project_id)
    void trackEvent(user.id, 'step_completed', { step: 'humanize', project_id })

    return NextResponse.json({ ok: true, data: { script: humanized } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/humanize] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка очеловечивания текста' }, { status: 500 })
  }
}
