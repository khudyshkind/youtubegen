import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { YouTubeQuotaError, checkYouTubeQuota, quotaExceededResponse } from '@/lib/youtube-quota'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

interface TitlesByNicheRequest {
  niche: string
  language?: string
}

interface YtSearchItem {
  id: { videoId?: string }
  snippet: { title: string; channelTitle?: string }
}

interface YtVideoStatsItem {
  id: string
  statistics?: { viewCount?: string }
}

interface TitleResult {
  title: string
  sources: string[]  // video IDs that inspired this title
}

interface HookResult {
  hook: string
  sources: string[]
}

interface TitlesOutput {
  patterns: string[]
  titles: TitleResult[]
  hooks: HookResult[]
}

function buildPrompt(niche: string, lang: string, videos: Array<{ id: string; title: string; views: number }>): string {
  const isRu = lang !== 'en'
  const videoList = videos
    .slice(0, 50)
    .map((v, i) => `${i + 1}. [${v.id}] "${v.title}" (${(v.views / 1000).toFixed(0)}K просмотров)`)
    .join('\n')

  if (isRu) {
    return `Ты — YouTube-стратег. Проанализируй топ-50 видео по теме "${niche}" и выдели паттерны успешных названий.

ТОП-50 ВИДЕО (формат: [video_id] "название" (просмотры)):
${videoList}

ЗАДАЧА:
1. Выдели 5-7 паттернов успешных названий (формулы, триггеры, числа, слова-магниты)
2. Создай 10 новых уникальных названий для видео по теме "${niche}" на русском языке
3. Создай 5 цепляющих хуков (первые 15-20 секунд видео) для темы "${niche}" на русском языке
4. Для каждого названия и хука укажи 1-3 video_id из списка, которые вдохновили его

ФОРМАТ — строго JSON без markdown:
{
  "patterns": ["ЧИСЛО + объект + эффект (топ-10 лучших...)", "ШОК-факт + вопрос (ты не знал что...)", "..."],
  "titles": [
    {"title": "10 Ошибок которые убивают ваш канал", "sources": ["videoId1", "videoId2"]},
    {"title": "...", "sources": ["..."]}
  ],
  "hooks": [
    {"hook": "Вы знаете что делают все успешные YouTubers в первые 5 минут после загрузки видео? Сегодня я расскажу секрет который изменил всё.", "sources": ["videoId3"]},
    {"hook": "...", "sources": ["..."]}
  ]
}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких \`\`\`json. Начни с { и заканчивай }.`
  }

  return `You are a YouTube strategist. Analyze the top-50 videos for the niche "${niche}" and identify winning title patterns.

TOP-50 VIDEOS (format: [video_id] "title" (views)):
${videoList}

TASK:
1. Identify 5-7 patterns from successful titles (formulas, triggers, numbers, power words)
2. Create 10 new unique video titles for the "${niche}" niche in English
3. Create 5 compelling hooks (first 15-20 seconds of the video) for the "${niche}" niche in English
4. For each title and hook, list 1-3 video_ids from the list that inspired it

FORMAT — strict JSON without markdown:
{
  "patterns": ["NUMBER + subject + outcome (top 10 best...)", "SHOCK fact + question (you didn't know...)", "..."],
  "titles": [
    {"title": "10 Mistakes That Are Killing Your YouTube Channel", "sources": ["videoId1", "videoId2"]},
    {"title": "...", "sources": ["..."]}
  ],
  "hooks": [
    {"hook": "Do you know what all successful YouTubers do in the first 5 minutes after uploading? Today I'll reveal the secret that changed everything.", "sources": ["videoId3"]},
    {"hook": "...", "sources": ["..."]}
  ]
}

IMPORTANT: Return ONLY valid JSON. No \`\`\`json. Start with { and end with }.`
}

export async function POST(request: NextRequest) {
  let lang = 'ru'
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: TitlesByNicheRequest = await request.json()
    const { niche, language = 'ru' } = body
    lang = language

    if (!niche?.trim()) {
      return NextResponse.json({ ok: false, error: 'Введите тему или ключевое слово' }, { status: 400 })
    }

    const cost = CREDIT_COSTS.titles_by_niche
    const check = await requireCreditsAmount(user.id, cost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const ytKey = env('YOUTUBE_API_KEY')

    // 1. Search top 50 videos by relevance (YT doesn't sort search by viewCount server-side reliably)
    //    We get 50 and then sort by view count from statistics
    const searchUrl = `${YT_BASE}/search?part=snippet&q=${encodeURIComponent(niche)}&type=video&maxResults=50&order=viewCount&regionCode=RU&key=${ytKey}`
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(20_000) })
    if (!searchRes.ok) {
      const searchBody = await searchRes.text()
      checkYouTubeQuota(searchRes.status, searchBody)
      console.error('[titles-by-niche] YT search error:', searchRes.status, searchBody.slice(0, 200))
      return NextResponse.json({ ok: false, error: 'Ошибка поиска YouTube' }, { status: 502 })
    }
    const searchData = await searchRes.json() as { items?: YtSearchItem[] }
    const searchItems = searchData.items ?? []

    const videoIds = searchItems
      .map(item => item.id.videoId)
      .filter((id): id is string => Boolean(id))

    if (videoIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'Нет видео по этой теме' }, { status: 404 })
    }

    // 2. Fetch view counts for all found videos in one request
    const statsUrl = `${YT_BASE}/videos?part=statistics&id=${videoIds.join(',')}&key=${ytKey}`
    const statsRes = await fetch(statsUrl, { signal: AbortSignal.timeout(15_000) })
    if (!statsRes.ok) {
      const statsBody = await statsRes.text()
      checkYouTubeQuota(statsRes.status, statsBody)
      console.warn('[titles-by-niche] stats fetch failed, using search order:', statsRes.status)
    }
    const statsData = statsRes.ok ? (await statsRes.json() as { items?: YtVideoStatsItem[] }) : { items: [] }
    const statsMap = new Map<string, number>()
    for (const item of (statsData.items ?? [])) {
      statsMap.set(item.id, parseInt(item.statistics?.viewCount ?? '0', 10))
    }

    // 3. Build sorted video list with titles + view counts
    const videos = searchItems
      .map(item => ({
        id: item.id.videoId ?? '',
        title: item.snippet.title,
        views: statsMap.get(item.id.videoId ?? '') ?? 0,
      }))
      .filter(v => v.id)
      .sort((a, b) => b.views - a.views)

    // 4. Claude analysis
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const prompt = buildPrompt(niche, lang, videos)

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    // claude-sonnet-5 returns a thinking block first; find the text block by type
    const textBlock = (msg.content as Array<{ type: string; text?: string }>).find(b => b.type === 'text')
    if (!textBlock || !textBlock.text) {
      console.error('[titles-by-niche] no text block in response. types:', msg.content.map(b => b.type).join(','))
      return NextResponse.json({ ok: false, error: 'Нейросеть вернула неожиданный ответ — попробуйте ещё раз' }, { status: 500 })
    }

    const parsed = parseClaudeJson<TitlesOutput>(textBlock.text, 'titles-by-niche')

    await spendCredits(user.id, cost, 'titles_by_niche')

    return NextResponse.json({
      ok: true,
      data: {
        niche,
        patterns: parsed.patterns ?? [],
        titles: parsed.titles,
        hooks: parsed.hooks,
        // Provide video metadata so the UI can render clickable source links
        source_videos: Object.fromEntries(
          videos.slice(0, 50).map(v => [v.id, { title: v.title, views: v.views }])
        ),
      },
    })
  } catch (error) {
    if (error instanceof YouTubeQuotaError) return quotaExceededResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[titles-by-niche]', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации названий' }, { status: 500 })
  }
}
