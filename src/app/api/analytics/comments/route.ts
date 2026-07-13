import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { YouTubeQuotaError, checkYouTubeQuota, quotaExceededResponse, byokQuotaResponse } from '@/lib/youtube-quota'
import { resolveAnalyticsContext } from '@/lib/analytics-gate'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function getCommentsPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный аналитик аудитории YouTube, специализирующийся на извлечении ценных инсайтов из комментариев зрителей. Твоя задача — систематически анализировать комментарии, чтобы помочь автору лучше понять свою аудиторию и создавать контент, который резонирует.

МЕТОДОЛОГИЯ АНАЛИЗА КОММЕНТАРИЕВ:
1. ЗАПРОСЫ НА ВИДЕО (video_requests): что аудитория ЯВНО просит снять | count = количество похожих запросов
2. БОЛИ И ПРОБЛЕМЫ (pain_points): конкретные проблемы аудитории, не абстракции
3. НЕЗАКРЫТЫЕ ВОПРОСЫ (unanswered_questions): вопросы без ответа в видео
4. ПОЗИТИВНЫЕ РЕАКЦИИ (positive_reactions): что конкретно понравилось
5. НЕГАТИВНЫЕ РЕАКЦИИ (negative_reactions): что критикуют, что хотят изменить
6. ИДЕИ ДЛЯ ВИДЕО (video_ideas): title = готовое название | reason = почему сработает | based_on = из каких комментариев
7. ПОРТРЕТ АУДИТОРИИ (audience_portrait): кто смотрит, 2-3 конкретных предложения

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"video_requests":[{"request":"Снимите про зимние шины для кроссовера","count":5},{"request":"Сравните масло 5W-30 и 5W-40","count":3}],"pain_points":["Дилеры навязывают дополнительные опции и непонятно как отказаться","Непонятно когда менять тормозные колодки без опыта"],"unanswered_questions":["Сколько реально тратится на содержание такой машины в год?","Есть ли смысл брать расширенную гарантию?"],"positive_reactions":["Честный отзыв без рекламы — редкость на ютубе","Очень понятно объяснили про каско без занудства"],"negative_reactions":["Слишком быстро говоришь — не успеваю записывать","Хотелось бы больше конкретных цифр"],"video_ideas":[{"title":"Реальные расходы на авто за год — считаю до копейки","reason":"Много вопросов про стоимость владения, аудитория хочет честных цифр","based_on":"Комментарии про непонятные расходы и вопросы про страховку"}],"audience_portrait":"Мужчины 28-45 лет, покупают или недавно купили первый новый автомобиль. Ищут честную информацию без рекламного глянца. Интересует практическая сторона: обслуживание, расходы, надёжность."}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких блоков \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube audience analyst specializing in extracting valuable insights from viewer comments. Your task is to systematically analyze comments to help the creator understand their audience and create resonant content.

COMMENT ANALYSIS METHODOLOGY:
1. VIDEO REQUESTS (video_requests): what the audience EXPLICITLY asks to film | count = number of similar requests
2. PAIN POINTS (pain_points): specific audience problems, not abstractions
3. UNANSWERED QUESTIONS (unanswered_questions): questions viewers couldn't find answers to in the video
4. POSITIVE REACTIONS (positive_reactions): what specifically they liked
5. NEGATIVE REACTIONS (negative_reactions): what they criticize, what they want changed
6. VIDEO IDEAS (video_ideas): title = ready-to-use title | reason = why it will work | based_on = which comments inspired it
7. AUDIENCE PORTRAIT (audience_portrait): who watches, 2-3 specific sentences

RESPONSE FORMAT — strict JSON without markdown:
{"video_requests":[{"request":"Do a video on winter tires for SUVs","count":5},{"request":"Compare 5W-30 vs 5W-40 oil","count":3}],"pain_points":["Dealerships push add-ons and it's unclear how to refuse","Hard to know when to replace brake pads without experience"],"unanswered_questions":["How much does it actually cost to own this car per year?","Is an extended warranty worth it?"],"positive_reactions":["Honest review without ads — rare on YouTube","Explained insurance really clearly without being boring"],"negative_reactions":["Talking too fast — hard to take notes","Would like more specific numbers and prices"],"video_ideas":[{"title":"Real Car Ownership Costs for a Year — Every Dollar Counted","reason":"Many questions about total cost of ownership, audience wants honest numbers","based_on":"Comments about unclear expenses and insurance questions"}],"audience_portrait":"Men 28-45 buying or recently bought their first new car. Looking for honest information without marketing spin. Interested in practical aspects: maintenance, costs, reliability."}

IMPORTANT: Return ONLY valid JSON. All text values must be in English. No \`\`\`json blocks. No explanations. Start with { end with }.`
}


type YtFn = (path: string, params: Record<string, string>) => Promise<unknown>

async function ytFetch(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const url = new URL(`${YT_BASE}${path}`)
  url.searchParams.set('key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) {
    const text = await res.text()
    checkYouTubeQuota(res.status, text)
    throw new Error(`YouTube API ${path} ${res.status}: ${text.slice(0, 200)}`)
  }
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

async function resolveChannelId(identifier: { type: 'handle' | 'id' | 'user'; value: string }, ytf: YtFn): Promise<string> {
  if (identifier.type === 'id') return identifier.value

  let forParam: Record<string, string>
  if (identifier.type === 'handle') {
    forParam = { forHandle: identifier.value, part: 'id,snippet' }
  } else {
    forParam = { forUsername: identifier.value, part: 'id,snippet' }
  }

  const data = await ytf('/channels', forParam) as YtChannelListResponse
  const channelId = data.items?.[0]?.id
  if (!channelId) throw new Error(`Канал не найден: @${identifier.value}`)
  return channelId
}

async function getTopVideoIds(channelId: string, limit: number, ytf: YtFn): Promise<string[]> {
  const search = await ytf('/search', {
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
  const vids = await ytf('/videos', {
    part: 'id,snippet,statistics',
    id: ids.join(','),
  }) as YtVideoListResponse

  return (vids.items ?? [])
    .sort((a, b) => Number(b.statistics.viewCount ?? 0) - Number(a.statistics.viewCount ?? 0))
    .map(v => v.id)
}

async function fetchComments(videoId: string, maxResults: number, ytf: YtFn): Promise<string[]> {
  try {
    const data = await ytf('/commentThreads', {
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
  } catch (e) {
    if (e instanceof YouTubeQuotaError) throw e
    return []
  }
}

export async function POST(req: NextRequest) {
  let lang = 'ru'
  let userHasKey = false
  let plan = 'free'
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { url?: string; count?: number; lang?: string; ui_lang?: string }
    const url = body.url?.trim() ?? ''
    lang = body.ui_lang ?? body.lang ?? 'ru'
    const count = [50, 100, 200].includes(body.count ?? 0) ? (body.count as 50 | 100 | 200) : 100

    if (!url) return NextResponse.json({ ok: false, error: 'Введите URL видео или канала' }, { status: 400 })
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return NextResponse.json({ ok: false, error: 'Введите корректный URL YouTube' }, { status: 400 })
    }

    const svc = createServiceClient()
    const ctx = await resolveAnalyticsContext(user.id, svc, lang)
    const { gateRes, apiKey, fallbackKey, cost } = ctx
    userHasKey = ctx.userHasKey
    plan = ctx.plan
    if (gateRes) return gateRes
    async function ytf(path: string, params: Record<string, string>): Promise<unknown> {
      try { return await ytFetch(path, params, apiKey) }
      catch (e) { if (e instanceof YouTubeQuotaError && fallbackKey) return ytFetch(path, params, fallbackKey); throw e }
    }

    const actualCost = cost(CREDIT_COSTS.comments_analysis)
    const check = await requireCreditsAmount(user.id, actualCost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    let comments: string[] = []
    let topic = ''
    let sourceLabel = ''

    const videoId = extractVideoId(url)

    if (videoId) {
      // Single video
      const vids = await ytf('/videos', {
        part: 'id,snippet,statistics',
        id: videoId,
      }) as YtVideoListResponse

      const video = vids.items?.[0]
      if (!video) return NextResponse.json({ ok: false, error: 'Видео не найдено' }, { status: 404 })

      topic = video.snippet.title
      sourceLabel = video.snippet.title
      comments = await fetchComments(videoId, count, ytf)

      if (comments.length === 0) {
        return NextResponse.json({ ok: false, error: 'Комментарии отключены или их нет под этим видео' }, { status: 400 })
      }
    } else {
      // Channel URL
      const channelIdent = extractChannelIdentifier(url)
      if (!channelIdent) {
        return NextResponse.json({ ok: false, error: 'Не удалось распознать URL. Поддерживается: /watch?v=..., /shorts/..., /@channel, /channel/...' }, { status: 400 })
      }

      const channelId = await resolveChannelId(channelIdent, ytf)

      // Get channel info
      const chInfo = await ytf('/channels', {
        part: 'snippet',
        id: channelId,
      }) as YtChannelListResponse
      topic = chInfo.items?.[0]?.snippet.title ?? channelIdent.value
      sourceLabel = `канал ${topic}`

      const perVideo = Math.ceil(count / 3)
      const topVideoIds = await getTopVideoIds(channelId, 3, ytf)

      if (topVideoIds.length === 0) {
        return NextResponse.json({ ok: false, error: 'Не удалось найти видео на канале' }, { status: 400 })
      }

      const allComments = await Promise.all(
        topVideoIds.map(vid => fetchComments(vid, perVideo, ytf))
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
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: [{ type: 'text', text: getCommentsPrompt(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Видео/канал на тему: "${topic}"\n\n${selectedComments.length} комментариев:\n${commentsText}` }],
    })
    const raw = (msg.content[0] as { text: string }).text
    console.log('[comments] claude raw:', raw.substring(0, 300))
    console.log('[comments] cache input:', msg.usage.input_tokens, 'cache_read:', msg.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg.usage.cache_creation_input_tokens ?? 0)
    if (msg.stop_reason === 'max_tokens') console.warn('[comments] claude truncated by max_tokens')

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

    await spendCredits(user.id, actualCost, 'comments_analysis')

    // Save to analytics_reports (non-fatal, 20-limit)
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
    if (error instanceof YouTubeQuotaError) return (userHasKey && plan === 'free') ? byokQuotaResponse(lang) : quotaExceededResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/comments] error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа: ${msg}` }, { status: 500 })
  }
}
