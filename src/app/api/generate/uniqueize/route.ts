import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'

export const maxDuration = 120

const UNIQUEIZE_PROMPT = `Ты редактор текста. Перепиши этот текст чтобы он был полностью уникальным и прошёл проверку антиплагиата.

Правила:
1. Измени структуру каждого предложения
2. Замени слова синонимами сохраняя смысл
3. Измени порядок подачи информации где возможно
4. Разбей длинные предложения на короткие и наоборот
5. Сохрани все факты, цифры и ключевые мысли
6. Сохрани маркеры сцен [СЦЕНА N] если они есть
7. Объём текста должен остаться примерно таким же
8. Стиль — нейтральный, чистый, без разговорных оборотов

Верни только переписанный текст без пояснений.`

const HUMANIZE_PROMPT = `Ты редактор текста. Перепиши этот сценарий так чтобы он звучал как живой человек а не как ИИ.

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

Верни только переписанный текст без пояснений.`

async function callClaude(client: Anthropic, prompt: string, text: string): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: `${prompt}\n\nТЕКСТ:\n${text}` }],
  })
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim()
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as { script?: string; project_id?: string; mode?: string }
    const { script, project_id, mode = 'unique' } = body

    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'Текст не может быть пустым' }, { status: 400 })
    }

    if (!['unique', 'human', 'both'].includes(mode)) {
      return NextResponse.json({ ok: false, error: 'Неверный режим' }, { status: 400 })
    }

    const creditCost = mode === 'both' ? 2 : 1
    const check = await requireCreditsAmount(user.id, creditCost, supabase)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    let result: string

    if (mode === 'unique') {
      result = await callClaude(client, UNIQUEIZE_PROMPT, script)
    } else if (mode === 'human') {
      result = await callClaude(client, HUMANIZE_PROMPT, script)
    } else {
      // both: uniqueize first, then humanize
      const uniqueized = await callClaude(client, UNIQUEIZE_PROMPT, script)
      result = await callClaude(client, HUMANIZE_PROMPT, uniqueized)
    }

    if (!result) {
      return NextResponse.json({ ok: false, error: 'Пустой ответ от Claude' }, { status: 502 })
    }

    await spendCredits(user.id, creditCost, `uniqueize_${mode}`, project_id)
    void trackEvent(user.id, 'step_completed', { step: 'uniqueize', mode, project_id })

    return NextResponse.json({ ok: true, data: { script: result } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/uniqueize] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка обработки текста' }, { status: 500 })
  }
}
