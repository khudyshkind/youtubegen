import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import type { SeoData, SubtitleBlock } from '@/lib/types'

interface SeoRequest {
  script: string
  topic: string
  project_id?: string
  duration_minutes?: number
  subtitle_blocks?: SubtitleBlock[]
}

// Build a sampled transcript timeline for Claude to identify real chapter moments.
// Picks one line per ~15 seconds so the context stays compact but representative.
function buildSubtitleTimeline(blocks: SubtitleBlock[]): string {
  if (!blocks || blocks.length === 0) return ''
  const SAMPLE_INTERVAL = 15  // seconds between samples
  const lines: string[] = []
  let lastTime = -SAMPLE_INTERVAL

  for (const block of blocks) {
    if (block.start >= lastTime + SAMPLE_INTERVAL) {
      const m = Math.floor(block.start / 60)
      const s = Math.floor(block.start % 60)
      const ts = `${m}:${String(s).padStart(2, '0')}`
      lines.push(`${ts} — "${block.text.slice(0, 80).trim()}"`)
      lastTime = block.start
    }
  }

  return lines.slice(0, 35).join('\n')
}

// Fallback: estimate timestamps from [СЦЕНА N] markers in the script
function estimateChaptersFromScript(script: string, durationMin: number): string {
  const scenes = script.match(/\[СЦЕНА\s*\d+[^\]]*\]|\[SCENE\s*\d+[^\]]*\]/gi) ?? []
  if (scenes.length === 0) return ''
  const totalSec = durationMin * 60
  const interval = Math.floor(totalSec / (scenes.length + 1))
  const stamps = scenes.slice(0, 12).map((scene, i) => {
    const sec = (i + 1) * interval
    const label = scene.replace(/\[|\]/g, '').replace(/^СЦЕНА\s*\d+\s*|^SCENE\s*\d+\s*/i, '').trim() || `Часть ${i + 1}`
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} — "${label}"`
  })
  return `0:00 — "Введение"\n${stamps.join('\n')}`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const check = await requireCredits(user.id, 'seo', supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const { script, topic, project_id, duration_minutes = 5, subtitle_blocks }: SeoRequest =
      await request.json()

    // Build timeline: real subtitles take priority over estimated scene markers
    const hasRealSubtitles = subtitle_blocks && subtitle_blocks.length > 0
    const transcriptTimeline = hasRealSubtitles
      ? buildSubtitleTimeline(subtitle_blocks)
      : estimateChaptersFromScript(script, duration_minutes)

    const chaptersBlock = transcriptTimeline
      ? `\n\nТРАНСКРИПТ ДЛЯ ОПРЕДЕЛЕНИЯ ГЛАВ (${hasRealSubtitles ? 'реальные' : 'расчётные'} таймкоды):\n${transcriptTimeline}`
      : ''

    const prompt = `Ты — эксперт по YouTube SEO для русскоязычного контента. Создай максимально кликабельную оптимизацию для видео.

Тема: ${topic}
Длительность: ~${duration_minutes} мин

Сценарий (первые 2500 символов):
${script.slice(0, 2500)}
${chaptersBlock}

Верни ТОЛЬКО валидный JSON без markdown-обёрток:
{
  "title": "...",
  "title_alt": "...",
  "description": "...",
  "hashtags": [...],
  "tags": [...]
}

═══ ПРАВИЛА ДЛЯ ЗАГОЛОВКОВ ═══
• Максимум 70 символов каждый
• Обязательно: число ИЛИ одно из слов: ШОКИРУЕТ / НИКТО НЕ ЗНАЕТ / ПРАВДА / ЗАПРЕЩЕНО / ВОТ ПОЧЕМУ / НАКОНЕЦ-ТО / СЕКРЕТ / ОТКРЫТИЕ
• title и title_alt — РАЗНЫЕ формулы:
  – "N фактов о [теме] которые тебя ШОКИРУЮТ"
  – "ПРАВДА о [теме]: почему НИКТО не говорит об этом"
  – "Вот почему [тема] — это [сильное утверждение]"
  – "[Тема]: СЕКРЕТ который скрывают от тебя"
  – Вопрос: "Почему [тема] НИКТО не объясняет честно?"

═══ ПРАВИЛА ДЛЯ ОПИСАНИЯ ═══
Строго следуй структуре (\\n для переносов, НЕ включай хэштеги — они идут отдельно):

Строка 1 (≤100 символов): Самый цепляющий факт или вопрос — это первое что видят в поиске
Строка 2 (≤100 символов): Что зритель узнает / почему стоит смотреть до конца
[пустая строка]
Абзац 1 (2-3 предложения): О чём это видео, основная тема
Абзац 2 (2-3 предложения): Ключевые инсайты или факты из видео
[пустая строка]
${transcriptTimeline ? `ГЛАВЫ ВИДЕО (проанализируй транскрипт и определи 4-8 ключевых момента с РЕАЛЬНЫМИ таймкодами из транскрипта — YouTube создаёт главы автоматически):
0:00 Введение
[следующие главы с реальными таймкодами]
[пустая строка]` : ''}
👍 Ставь лайк если было полезно и подписывайся — новые видео каждую неделю!

═══ ПРАВИЛА ДЛЯ ХЭШТЕГОВ (поле "hashtags") ═══
• 3-5 хэштегов, каждый начинается с #
• Короткие, широкие темы: #история #наука #топ10 #факты #документальное
• Только самые релевантные, которые реально ищут на YouTube
• Пример: ["#история", "#факты", "#наука", "#топ10"]

═══ ПРАВИЛА ДЛЯ ТЕГОВ (поле "tags") ═══
Всего 20-25 тегов:
• 5-7 коротких (1-2 слова): широкая тема
• 8-10 средних (3-4 слова): конкретная тема
• 5-7 длинных (5+ слов): точные поисковые запросы
• 2-3 тега на английском языке`

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    let seo: SeoData
    try {
      seo = JSON.parse(rawText) as SeoData
    } catch {
      const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
      seo = JSON.parse(cleaned) as SeoData
    }

    // Enforce 70-char limit on titles
    if (seo.title.length > 70) seo.title = seo.title.slice(0, 70).trimEnd()
    if (seo.title_alt && seo.title_alt.length > 70) seo.title_alt = seo.title_alt.slice(0, 70).trimEnd()

    // Ensure hashtags is always an array, each item starts with #
    if (!Array.isArray(seo.hashtags)) seo.hashtags = []
    seo.hashtags = seo.hashtags
      .slice(0, 5)
      .map((h) => (h.startsWith('#') ? h : `#${h}`))

    await spendCredits(user.id, CREDIT_COSTS.seo, 'seo', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({ seo, title: seo.title, status: 'completed' })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { seo } })
  } catch (error) {
    console.error('[generate/seo]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации SEO' }, { status: 500 })
  }
}
