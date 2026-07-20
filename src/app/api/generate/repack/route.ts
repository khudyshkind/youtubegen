import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { isBillingError, notifyBillingError, notifyError } from '@/lib/telegram'
import { isAnthropicOverload, withAnthropicRetry } from '@/lib/anthropic-retry'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import { parseClaudeJson } from '@/lib/parse-claude-json'

export const maxDuration = 120

interface RepackFormats {
  telegram: string
  dzen: string
  thread: string
}

function buildPrompt(script: string, language: string): string {
  const isRu = language === 'ru' || !language
  return isRu ? buildPromptRu(script) : buildPromptEn(script, language)
}

function buildPromptRu(script: string): string {
  return `Ты профессиональный контент-стратег. Переупакуй текст ниже в 3 РАЗНЫХ формата для разных платформ.

СТРОГИЕ ПРАВИЛА:
- НЕ начинай ни один формат с фраз: «Привет, дорогой читатель», «В современном мире», «Сегодня мы поговорим», «Давайте поговорим», «В наше время», «В данной статье», «Добро пожаловать»
- Каждый формат должен начинаться ПРИНЦИПИАЛЬНО по-разному — разный угол, разный зачин, разная структура
- Сохраняй тон и стиль исходного текста
- Пиши на том же языке, что исходный текст

ФОРМАТ 1 — Telegram-пост (200–800 символов):
- Живой, неформальный, 1–3 эмодзи максимум
- Без маркированных списков — только короткие абзацы
- Заканчивай вопросом или призывом к действию

ФОРМАТ 2 — Статья для Дзена (800–1500 слов):
- Повествовательный стиль, сторителлинг
- 3–5 разделов с подзаголовками (## Заголовок)
- Конкретные примеры и факты из исходника
- Начало: хук, а не «приветственное» вступление

ФОРМАТ 3 — Тред (5–7 постов, каждый до 280 символов):
- Нумерация: 1/ 2/ 3/ и т.д.
- Первый пост — хук
- Каждый пост ценен сам по себе
- Последний пост: итог + вопрос для вовлечения

Верни ТОЛЬКО JSON-объект, без markdown, без лишнего текста:
{"telegram": "...", "dzen": "...", "thread": "..."}

ИСХОДНЫЙ ТЕКСТ:
${script}`
}

function buildPromptEn(script: string, language: string): string {
  return `You are a professional content strategist. Repackage the text below into 3 DIFFERENT formats for different platforms. Write in ${language}.

STRICT RULES:
- Do NOT start any format with: "Hello dear reader", "In today's world", "Today we will talk", "Welcome", "In this article"
- Each format must begin COMPLETELY differently — different angle, different opening, different structure
- Keep the tone and style of the original text

FORMAT 1 — Short social post (200–800 characters):
- Casual, punchy, 1–3 emojis max
- No bullet lists — short paragraphs
- End with a question or call to action

FORMAT 2 — Long-form article (800–1500 words):
- Narrative, storytelling style
- 3–5 sections with subheadings (## Heading)
- Concrete examples and facts from the original
- Open with a hook, not a welcome paragraph

FORMAT 3 — Thread (5–7 posts, max 280 chars each):
- Numbered: 1/ 2/ 3/ etc.
- First post: hook
- Each post stands alone
- Last post: summary + engagement question

Return ONLY a JSON object, no markdown, no extra text:
{"telegram": "...", "dzen": "...", "thread": "..."}

INPUT TEXT:
${script}`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const cost = CREDIT_COSTS.repack
    const check = await requireCreditsAmount(user.id, cost, supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const body = await request.json()
    const { script, language = 'ru', project_id } = body

    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'Текст не указан' }, { status: 400 })
    }

    if (script.length > 30_000) {
      return NextResponse.json({ ok: false, error: 'Текст слишком длинный (макс 30 000 символов)' }, { status: 400 })
    }

    const prompt = buildPrompt(script.trim(), language)
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 90_000, maxRetries: 0 })

    const message = await withAnthropicRetry(() => anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }), 'generate/repack')

    console.log(`[generate/repack] stop_reason=${message.stop_reason} usage=${JSON.stringify(message.usage)}`)

    const block = message.content[0]
    const raw = block.type === 'text' ? block.text : ''

    if (!raw) {
      return NextResponse.json({ ok: false, error: 'Модель вернула пустой ответ' }, { status: 502 })
    }

    let formats: RepackFormats
    try {
      const parsed = parseClaudeJson<RepackFormats>(raw, 'repack')
      if (!parsed.telegram || !parsed.dzen || !parsed.thread) {
        throw new Error('missing required fields')
      }
      formats = parsed
    } catch {
      console.error('[generate/repack] parse error, raw tail:', raw.slice(-300))
      return NextResponse.json({ ok: false, error: 'Ошибка разбора ответа модели' }, { status: 502 })
    }

    await spendCredits(user.id, cost, 'repack', project_id ?? null)

    return NextResponse.json({ ok: true, data: { formats } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/repack]', msg)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/generate/repack').catch(() => {})
    else await notifyError('/generate/repack', msg).catch(() => {})
    if (isAnthropicOverload(error)) {
      return NextResponse.json({ ok: false, error: 'Нейросеть перегружена — попробуйте через минуту', code: 'OVERLOADED' }, { status: 503 })
    }
    return NextResponse.json({ ok: false, error: 'Ошибка генерации' }, { status: 500 })
  }
}
