import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

const COMMENTS_SYSTEM_PROMPT = `Ты опытный аналитик аудитории YouTube специализирующийся на извлечении ценных инсайтов из комментариев зрителей. Твоя задача — систематически анализировать комментарии чтобы помочь создателю контента лучше понять свою аудиторию и создавать востребованный контент.

МЕТОДОЛОГИЯ АНАЛИЗА КОММЕНТАРИЕВ:

1. ЗАПРОСЫ НА ВИДЕО (video_requests)
• Что аудитория ЯВНО просит снять — ищи фразы «сними про», «хочу видео о», «расскажи о», «как насчёт», «интересно было бы»
• count — приблизительное количество похожих запросов (1 = единичный, 5+ = популярный запрос)
• Группируй похожие запросы в один

2. БОЛИ И ПРОБЛЕМЫ (pain_points)
• Проблемы с которыми сталкивается аудитория: что не работает, что непонятно, что раздражает
• Формулируй как конкретную проблему а не абстракцию
• Пример: «Не понимают как выбрать правильный размер» а не «проблема с выбором»

3. НЕЗАКРЫТЫЕ ВОПРОСЫ (unanswered_questions)
• Вопросы на которые зрители не нашли ответа в видео
• Это прямые подсказки для следующих видео
• Ищи вопросительные предложения в комментариях

4. ПОЗИТИВНЫЕ РЕАКЦИИ (positive_reactions)
• Что конкретно понравилось: формат, подача, конкретные моменты
• Что хвалят, что отмечают как полезное, что просят продолжить

5. НЕГАТИВНЫЕ РЕАКЦИИ (negative_reactions)
• Что не понравилось, что критикуют, что хотят изменить
• Формулируй конструктивно — это обратная связь а не жалобы

6. ИДЕИ ДЛЯ ВИДЕО (video_ideas)
• Конкретные идеи для новых видео на основе комментариев
• title — готовый рабочий заголовок видео
• reason — почему это сработает (аудитория просит / много похожих вопросов)
• based_on — из каких комментариев идея

7. ПОРТРЕТ АУДИТОРИИ (audience_portrait)
• Кто смотрит: возраст уровень экспертизы интересы
• Какие у них цели и мотивация
• 2-3 предложения конкретного описания

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"video_requests":[{"request":"Снимите про зимние шины","count":5}],"pain_points":["боль 1","боль 2"],"unanswered_questions":["вопрос 1","вопрос 2"],"positive_reactions":["что понравилось 1"],"negative_reactions":["что не понравилось 1"],"video_ideas":[{"title":"Готовое название видео","reason":"почему сработает","based_on":"из какого комментария идея"}],"audience_portrait":"Краткое описание кто смотрит"}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Без \`\`\`json блоков. Без пояснений. Начни с { и закончи }.`

function parseClaudeJson<T>(text: string, label: string): T {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error(`${label}: no { found`)
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    if (c === '}') { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T }
  }
  throw new Error(`${label}: unbalanced braces`)
}

async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${YT_BASE}${path}`)
  url.searchParams.set('key', env('YOUTUBE_API_KEY'))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`YouTube API ${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

// Extract video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// Extract channel handle or ID from URL
function extractChannelIdentifier(url: string): { type: 'handle' | 'id' | 'user'; value: string } | null {
  const handle = url.match(/youtube\.com\/@([^/?&]+)/)
  if (handle) return { type: 'handle', value: handle[1] }
  const channelId = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/)
  if (channelId) return { type: 'id', value: channelId[1] }
  const user = url.match(/youtube\.com\/user\/([^/?&]+)/)
  if (user) return { type: 'user', value: user[1] }
  return null
}

interface YtChannelListResponse {
  items?: Array<{ id: string; snippet: { title: string } }>
}
interface YtSearchResponse {
  items?: Array<{ id: { videoId?: string }; snippet: { title: string } }>
}
interface YtVideoListResponse {
  items?: Array<{
    id: string
    snippet: { title: string }
    statistics: { viewCount?: string }
  }>
}
interface YtCommentThreadsResponse {
  items?: Array<{
    snippet: {
      topLevelComment: {
        snippet: { textDisplay: string; likeCount: number; authorDisplayName: string }
      }
    }
  }>
}

async function resolveChannelId(identifier: { type: 'handle' | 'id' | 'user'; value: string }): Promise<string> {
  if (identifier.type === 'id') return identifier.value

  let forParam: Record<string, string>
  if (identifier.type === 'handle') {
    forParam = { forHandle: identifier.value, part: 'id,snippet' }
  } else {
    forParam = { forUsername: identifier.value, part: 'id,snippet' }
  }

  const data = await ytFetch('/channels', forParam) as YtChannelListResponse
  const channelId = data.items?.[0]?.id
  if (!channelId) throw new Error(`Канал не найден: @${identifier.value}`)
  return channelId
}

async function getTopVideoIds(channelId: string, limit: number): Promise<string[]> {
  const search = await ytFetch('/search', {
    part: 'id,snippet',
    channelId,
    type: 'video',
    order: 'viewCount',
    maxResults: String(limit),
  }) as YtSearchResponse

  const ids = (search.items ?? [])
    .map(i => i.id.videoId)
    .filter((id): id is string => !!id)

  if (ids.length === 0) return []

  // Get actual view counts to confirm top videos
  const vids = await ytFetch('/videos', {
    part: 'id,snippet,statistics',
    id: ids.join(','),
  }) as YtVideoListResponse

  return (vids.items ?? [])
    .sort((a, b) => Number(b.statistics.viewCount ?? 0) - Number(a.statistics.viewCount ?? 0))
    .map(v => v.id)
}

async function fetchComments(videoId: string, maxResults: number): Promise<string[]> {
  try {
    const data = await ytFetch('/commentThreads', {
      part: 'snippet',
      videoId,
      maxResults: String(Math.min(maxResults, 100)),
      order: 'relevance',
    }) as YtCommentThreadsResponse

    return (data.items ?? []).map(item => {
      const s = item.snippet.topLevelComment.snippet
      const likes = s.likeCount > 0 ? ` [${s.likeCount} лайков]` : ''
      return `${s.textDisplay}${likes}`
    })
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { url?: string; count?: number }
    const url = body.url?.trim() ?? ''
    const count = [50, 100, 200].includes(body.count ?? 0) ? (body.count as 50 | 100 | 200) : 100

    if (!url) return NextResponse.json({ ok: false, error: 'Введите URL видео или канала' }, { status: 400 })
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return NextResponse.json({ ok: false, error: 'Введите корректный URL YouTube' }, { status: 400 })
    }

    const check = await requireCredits(user.id, 'comments_analysis', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    let comments: string[] = []
    let topic = ''
    let sourceLabel = ''

    const videoId = extractVideoId(url)

    if (videoId) {
      // Single video
      const vids = await ytFetch('/videos', {
        part: 'id,snippet,statistics',
        id: videoId,
      }) as YtVideoListResponse

      const video = vids.items?.[0]
      if (!video) return NextResponse.json({ ok: false, error: 'Видео не найдено' }, { status: 404 })

      topic = video.snippet.title
      sourceLabel = video.snippet.title
      comments = await fetchComments(videoId, count)

      if (comments.length === 0) {
        return NextResponse.json({ ok: false, error: 'Комментарии отключены или их нет под этим видео' }, { status: 400 })
      }
    } else {
      // Channel URL
      const channelIdent = extractChannelIdentifier(url)
      if (!channelIdent) {
        return NextResponse.json({ ok: false, error: 'Не удалось распознать URL. Поддерживается: /watch?v=..., /shorts/..., /@channel, /channel/...' }, { status: 400 })
      }

      const channelId = await resolveChannelId(channelIdent)

      // Get channel info
      const chInfo = await ytFetch('/channels', {
        part: 'snippet',
        id: channelId,
      }) as YtChannelListResponse
      topic = chInfo.items?.[0]?.snippet.title ?? channelIdent.value
      sourceLabel = `канал ${topic}`

      const perVideo = Math.ceil(count / 3)
      const topVideoIds = await getTopVideoIds(channelId, 3)

      if (topVideoIds.length === 0) {
        return NextResponse.json({ ok: false, error: 'Не удалось найти видео на канале' }, { status: 400 })
      }

      const allComments = await Promise.all(
        topVideoIds.map(vid => fetchComments(vid, perVideo))
      )
      comments = allComments.flat()

      if (comments.length === 0) {
        return NextResponse.json({ ok: false, error: 'Комментарии отключены на всех видео канала' }, { status: 400 })
      }
    }

    console.log(`[comments] fetched ${comments.length} comments for: ${topic}`)

    // Trim to requested count
    const selectedComments = comments.slice(0, count)
    const commentsText = selectedComments
      .map((c, i) => `${i + 1}. ${c}`)
      .join('\n')

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: [{ type: 'text', text: COMMENTS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Видео/канал на тему: "${topic}"\n\n${selectedComments.length} комментариев:\n${commentsText}` }],
    })
    const raw = (msg.content[0] as { text: string }).text
    console.log('[comments] claude raw:', raw.substring(0, 300))
    console.log('[comments] cache input:', msg.usage.input_tokens, 'cache_read:', msg.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg.usage.cache_creation_input_tokens ?? 0)

    interface CommentsAnalysis {
      video_requests: Array<{ request: string; count: number }>
      pain_points: string[]
      unanswered_questions: string[]
      positive_reactions: string[]
      negative_reactions: string[]
      video_ideas: Array<{ title: string; reason: string; based_on: string }>
      audience_portrait: string
    }

    const analysis = parseClaudeJson<CommentsAnalysis>(raw, 'claude')

    const result = {
      url,
      topic,
      source_label: sourceLabel,
      comments_count: selectedComments.length,
      video_requests:       analysis.video_requests       ?? [],
      pain_points:          analysis.pain_points          ?? [],
      unanswered_questions: analysis.unanswered_questions ?? [],
      positive_reactions:   analysis.positive_reactions   ?? [],
      negative_reactions:   analysis.negative_reactions   ?? [],
      video_ideas:          analysis.video_ideas          ?? [],
      audience_portrait:    analysis.audience_portrait    ?? '',
    }

    await spendCredits(user.id, 8, 'comments_analysis')

    // Save to analytics_reports (non-fatal, 20-limit)
    const svc = createServiceClient()
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'comments')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'comments',
        title: `Комментарии: ${topic}`,
        query: url,
        result,
      })
      console.log('[comments] report saved')
    } catch (e) {
      console.warn('[comments] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/comments] error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа: ${msg}` }, { status: 500 })
  }
}
