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
  lang?: string
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

const SEO_SYSTEM_PROMPT = `You are a YouTube SEO expert with extensive experience ranking videos at the top of search results. Your specialty is crafting highly clickable titles, descriptions, and tags that attract viewers and rank well in the YouTube algorithm.

Return ONLY valid JSON without markdown wrappers in this format:
{
  "title": "...",
  "title_alt": "...",
  "description": "...",
  "hashtags": [...],
  "tags": [...]
}

═══ TITLE RULES ═══
• Maximum 70 characters each
• Must include a number OR a powerful hook word appropriate for the content language (e.g., SHOCKING / SECRET / TRUTH / REVEALED / NOBODY KNOWS / HERE'S WHY — or their equivalents in the content language)
• title and title_alt must use DIFFERENT formulas:
  – "N Facts About [Topic] That Will SHOCK You"
  – "The TRUTH About [Topic]: Why NOBODY Talks About This"
  – "Here's Why [Topic] Is [Strong Claim]"
  – "[Topic]: The SECRET They're Hiding From You"
  – Question: "Why Does NOBODY Explain [Topic] Honestly?"
• Title must create an information gap — viewer must want to know what's inside
• Avoid clickbait without substance — title must match the video content

═══ DESCRIPTION RULES ═══
Follow this structure strictly (\\n for line breaks, do NOT include hashtags here — they go in the hashtags field):

Line 1 (≤100 chars): Most compelling fact or question — this is the first thing seen in search
Line 2 (≤100 chars): What the viewer will learn / why they should watch to the end
[blank line]
Paragraph 1 (2-3 sentences): What this video is about, main topic
Paragraph 2 (2-3 sentences): Key insights or facts from the video
[blank line]
VIDEO CHAPTERS — if timecodes are provided, list them here (YouTube creates chapters automatically)
[blank line]
👍 Like if this was helpful and subscribe — new videos every week!

Description requirements:
• First 2 lines are most important (visible without expanding)
• Use keywords naturally in the first paragraph
• Description should complement, not duplicate the title
• Length: 200-400 words is optimal

═══ HASHTAG RULES (field "hashtags") ═══
• 3-5 hashtags, each starting with #
• Short broad topics: #history #science #top10 #facts #documentary
• Only the most relevant ones that people actually search on YouTube
• Example: ["#history", "#facts", "#science", "#top10"]

═══ TAG RULES (field "tags") ═══
20-25 tags total — three tiers:
• 5-7 short tags (1-2 words): broad topic — maximum reach
• 8-10 medium tags (3-4 words): specific topic — target audience
• 5-7 long tags (5+ words): exact search queries — low competition, high relevance
• 2-3 tags in English for international reach when relevant

Tags should cover: main topic, related topics, content types, questions the audience asks.

═══ QUALITY AND ACCURACY ═══
• Titles and descriptions must accurately reflect the video content — no deceptive clickbait
• SEO optimization must not compromise honesty with the viewer
• Analyze the provided script and timecodes — use real facts and moments from the video
• Hashtags and tags must genuinely help the right audience find the video

OUTPUT LANGUAGE: Write all output (titles, description, hashtags, tags) in the same language as the video topic and script provided.`

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const check = await requireCredits(user.id, 'seo', supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const { script, topic, project_id, duration_minutes = 5, subtitle_blocks, lang }: SeoRequest =
      await request.json()

    // Build timeline: real subtitles take priority over estimated scene markers
    const hasRealSubtitles = subtitle_blocks && subtitle_blocks.length > 0
    const transcriptTimeline = hasRealSubtitles
      ? buildSubtitleTimeline(subtitle_blocks)
      : estimateChaptersFromScript(script, duration_minutes)

    const chaptersBlock = transcriptTimeline
      ? `\n\nТРАНСКРИПТ ДЛЯ ОПРЕДЕЛЕНИЯ ГЛАВ (${hasRealSubtitles ? 'реальные' : 'расчётные'} таймкоды):\n${transcriptTimeline}`
      : ''

    const chaptersInstruction = transcriptTimeline
      ? `\n\nГЛАВЫ ВИДЕО (определи 4-8 ключевых момента с РЕАЛЬНЫМИ таймкодами из транскрипта ниже — YouTube создаёт главы автоматически):\n0:00 Введение\n[следующие главы с реальными таймкодами]\n[пустая строка]`
      : ''

    const userMessage = `Тема: ${topic}
Длительность: ~${duration_minutes} мин${chaptersInstruction}

Сценарий (первые 2500 символов):
${script.slice(0, 2500)}
${chaptersBlock}${lang ? `\n\nOUTPUT LANGUAGE: Write ALL output (titles, description, hashtags, tags) strictly in ${lang}.` : ''}`

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: [{ type: 'text', text: SEO_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })
    console.log('[seo] cache input:', message.usage.input_tokens, 'cache_read:', message.usage.cache_read_input_tokens ?? 0, 'cache_write:', message.usage.cache_creation_input_tokens ?? 0)

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
