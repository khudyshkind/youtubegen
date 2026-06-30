import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'


async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${YT_BASE}${path}`)
  url.searchParams.set('key', env('YOUTUBE_API_KEY'))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`YouTube API ${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

interface YtChannelListResponse {
  items?: Array<{
    id: string
    snippet: { title: string; description: string; customUrl?: string }
    statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string }
  }>
}

interface YtSearchResponse {
  items?: Array<{ id: { videoId?: string; channelId?: string }; snippet: { channelTitle: string } }>
}

interface YtVideoListResponse {
  items?: Array<{
    id: string
    snippet: {
      publishedAt: string
      title: string
      description: string
      tags?: string[]
    }
    statistics: { viewCount?: string; likeCount?: string; commentCount?: string }
  }>
}

interface TopVideo {
  title: string
  views: number
  url: string
  published_at: string
}

// Resolve channel identifier (URL, @handle, or plain name) → channelId + name
async function resolveChannel(input: string): Promise<{ id: string; name: string } | null> {
  const trimmed = input.trim()

  const handleMatch = trimmed.match(/(?:youtube\.com\/@|^@)([^/?&\s]+)/)
  if (handleMatch) {
    const data = await ytFetch('/channels', { part: 'id,snippet', forHandle: handleMatch[1] }) as YtChannelListResponse
    const ch = data.items?.[0]
    return ch ? { id: ch.id, name: ch.snippet.title } : null
  }

  const channelIdMatch = trimmed.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/)
  if (channelIdMatch) {
    const data = await ytFetch('/channels', { part: 'id,snippet', id: channelIdMatch[1] }) as YtChannelListResponse
    const ch = data.items?.[0]
    return ch ? { id: ch.id, name: ch.snippet.title } : null
  }

  const userMatch = trimmed.match(/youtube\.com\/user\/([^/?&\s]+)/)
  if (userMatch) {
    const data = await ytFetch('/channels', { part: 'id,snippet', forUsername: userMatch[1] }) as YtChannelListResponse
    const ch = data.items?.[0]
    return ch ? { id: ch.id, name: ch.snippet.title } : null
  }

  const search = await ytFetch('/search', { part: 'snippet', type: 'channel', q: trimmed, maxResults: '1' }) as YtSearchResponse
  const item = search.items?.[0]
  if (!item?.id.channelId) return null
  return { id: item.id.channelId, name: item.snippet.channelTitle }
}

interface ChannelStats {
  id: string
  name: string
  subscribers: number
  total_views: number
  video_count: number
  avg_views: number
  upload_frequency: number
  engagement_rate: number
  recent_video_count: number
  top_videos: TopVideo[]
  common_tags: string[]
  publish_days: string[]          // e.g. ["Пн", "Ср", "Пт"]
}

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

async function getChannelStats(channelId: string, channelName: string): Promise<ChannelStats> {
  // Get channel base stats
  const chData = await ytFetch('/channels', { part: 'statistics', id: channelId }) as YtChannelListResponse
  const stats = chData.items?.[0]?.statistics ?? {}
  const subscribers = Number(stats.subscriberCount ?? 0)
  const total_views = Number(stats.viewCount ?? 0)
  const video_count = Number(stats.videoCount ?? 0)

  // Get last 20 videos (by date — for schedule analysis)
  const search = await ytFetch('/search', {
    part: 'id', channelId, type: 'video', order: 'date', maxResults: '20',
  }) as YtSearchResponse
  const videoIds = (search.items ?? []).map(i => i.id.videoId).filter((id): id is string => !!id)

  if (videoIds.length === 0) {
    return { id: channelId, name: channelName, subscribers, total_views, video_count, avg_views: 0, upload_frequency: 0, engagement_rate: 0, recent_video_count: 0, top_videos: [], common_tags: [], publish_days: [] }
  }

  const vidsData = await ytFetch('/videos', {
    part: 'snippet,statistics', id: videoIds.join(','),
  }) as YtVideoListResponse
  const videos = vidsData.items ?? []

  // avg_views
  const viewsList = videos.map(v => Number(v.statistics.viewCount ?? 0))
  const avg_views = viewsList.length > 0
    ? Math.round(viewsList.reduce((a, b) => a + b, 0) / viewsList.length) : 0

  // upload_frequency
  let upload_frequency = 0
  if (videos.length >= 2) {
    const dates = videos.map(v => new Date(v.snippet.publishedAt).getTime()).sort((a, b) => b - a)
    const spanDays = (dates[0] - dates[dates.length - 1]) / (1000 * 60 * 60 * 24)
    if (spanDays > 0) upload_frequency = Math.round((videos.length / (spanDays / 7)) * 10) / 10
  }

  // engagement_rate
  const engagements = videos.map(v => {
    const views = Number(v.statistics.viewCount ?? 0)
    if (views === 0) return 0
    return ((Number(v.statistics.likeCount ?? 0) + Number(v.statistics.commentCount ?? 0)) / views) * 100
  })
  const engagement_rate = engagements.length > 0
    ? Math.round((engagements.reduce((a, b) => a + b, 0) / engagements.length) * 10) / 10 : 0

  // Top 5 by views
  const top_videos: TopVideo[] = [...videos]
    .sort((a, b) => Number(b.statistics.viewCount ?? 0) - Number(a.statistics.viewCount ?? 0))
    .slice(0, 5)
    .map(v => ({
      title:        v.snippet.title,
      views:        Number(v.statistics.viewCount ?? 0),
      url:          `https://youtu.be/${v.id}`,
      published_at: v.snippet.publishedAt.slice(0, 10),
    }))

  // Collect common tags (top 5 by frequency)
  const tagFreq = new Map<string, number>()
  for (const v of videos) {
    for (const tag of (v.snippet.tags ?? []).slice(0, 10)) {
      tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1)
    }
  }
  const common_tags = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag)

  // Publication days
  const dayCounts = new Array<number>(7).fill(0)
  for (const v of videos) {
    const dow = new Date(v.snippet.publishedAt).getDay()
    dayCounts[dow]++
  }
  const maxDayCount = Math.max(...dayCounts)
  const publish_days = maxDayCount > 0
    ? dayCounts.map((c, i) => ({ day: DAY_NAMES[i], c }))
        .filter(d => d.c >= maxDayCount * 0.5)
        .map(d => d.day)
    : []

  return { id: channelId, name: channelName, subscribers, total_views, video_count, avg_views, upload_frequency, engagement_rate, recent_video_count: videos.length, top_videos, common_tags, publish_days }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `${Math.round(n / 1_000)}К`
  return String(n)
}

function buildChannelBlock(ch: ChannelStats): string {
  const topTitles = ch.top_videos.map((v, i) =>
    `  ${i + 1}. "${v.title}" — ${fmtNum(v.views)} просм. (${v.published_at})`
  ).join('\n')
  const tags = ch.common_tags.length > 0 ? ch.common_tags.join(', ') : 'нет данных'
  const days = ch.publish_days.length > 0 ? ch.publish_days.join(', ') : 'без расписания'
  return `Канал "${ch.name}":
  Подписчики: ${fmtNum(ch.subscribers)}, Ср. просмотры: ${fmtNum(ch.avg_views)}, Вовлечённость: ${ch.engagement_rate}%, Видео/нед: ${ch.upload_frequency}
  Топ-5 видео:
${topTitles}
  Частые теги: ${tags}
  Дни публикаций: ${days}`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { channels?: string[] }
    const inputs = (body.channels ?? []).map(s => s?.trim()).filter(Boolean)

    if (inputs.length < 2) return NextResponse.json({ ok: false, error: 'Введите минимум 2 канала' }, { status: 400 })
    if (inputs.length > 3) return NextResponse.json({ ok: false, error: 'Максимум 3 канала' }, { status: 400 })

    const check = await requireCredits(user.id, 'channels_compare', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    console.log('[compare] resolving channels:', inputs)
    const resolved = await Promise.all(inputs.map(resolveChannel))

    const notFound = resolved.findIndex(r => r === null)
    if (notFound !== -1) {
      return NextResponse.json({ ok: false, error: `Канал не найден: "${inputs[notFound]}". Используйте URL или @handle` }, { status: 404 })
    }

    const channels = resolved as Array<{ id: string; name: string }>

    console.log('[compare] fetching stats for:', channels.map(c => c.name))
    const statsArr = await Promise.all(channels.map(ch => getChannelStats(ch.id, ch.name)))

    // Build enriched text blocks for Claude
    const channelBlocks = statsArr.map(buildChannelBlock).join('\n\n')
    const channelNames = statsArr.map(ch => ch.name).join(', ')

    const prompt1 = `Ты стратегический консультант по YouTube.
Сравни каналы на основе их реального контента:

${channelBlocks}

Найди КОНКРЕТНЫЕ различия в стратегии контента: какие темы работают, форматы заголовков, уникальность каждого канала.

Верни JSON строго в этом формате, только JSON, никакого текста до или после:
{"channels":[{"name":"Название","content_strategy":"конкретное описание стратегии на 1-2 предложения","winning_formula":"что именно приносит просмотры","strongest_metric":"Вовлечённость","weakest_metric":"Частота публикаций"}],"winner":{"overall":"Название лучшего","by_engagement":"Название","by_views":"Название","by_consistency":"Название"}}`

    const prompt2 = `На основе анализа этих YouTube каналов и их контента дай КОНКРЕТНЫЕ рекомендации — не общие слова, а действия которые можно сделать завтра.

${channelBlocks}

Верни JSON строго в этом формате, только JSON, никакого текста до или после:
{"insights":["Конкретный факт о различии в контенте"],"recommendations":["Конкретное действие которое нужно сделать"],"opportunities":["Конкретная незанятая тема или формат"],"steal_ideas":[{"from_channel":"Название канала","idea":"Что именно перенять конкретно","example_video":"Точное название конкретного видео для вдохновения"}]}`

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const [msg1, msg2] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt1 }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt2 }],
      }),
    ])

    const text1 = (msg1.content[0] as { text: string }).text
    const text2 = (msg2.content[0] as { text: string }).text
    console.log('[compare] claude1 raw:', text1.substring(0, 300))
    console.log('[compare] claude2 raw:', text2.substring(0, 300))
    if (msg1.stop_reason === 'max_tokens') console.warn('[compare] claude1 truncated by max_tokens')
    if (msg2.stop_reason === 'max_tokens') console.warn('[compare] claude2 truncated by max_tokens')

    interface CompareMetrics {
      channels: Array<{
        name: string
        content_strategy: string
        winning_formula: string
        strongest_metric: string
        weakest_metric: string
      }>
      winner: { overall: string; by_engagement: string; by_views: string; by_consistency: string }
    }
    interface CompareInsights {
      insights:        string[]
      recommendations: string[]
      opportunities:   string[]
      steal_ideas:     Array<{ from_channel: string; idea: string; example_video: string }>
    }

    const metrics  = parseClaudeJson<CompareMetrics>(text1, 'claude1')
    const insights = parseClaudeJson<CompareInsights>(text2, 'claude2')

    const metricsMap = new Map((metrics.channels ?? []).map(c => [c.name, c]))

    const enrichedChannels = statsArr.map(ch => {
      const a = metricsMap.get(ch.name) ?? { content_strategy: '', winning_formula: '', strongest_metric: '', weakest_metric: '' }
      return { ...ch, ...a }
    })

    const maxSubs       = Math.max(...statsArr.map(c => c.subscribers))
    const maxViews      = Math.max(...statsArr.map(c => c.avg_views))
    const maxFreq       = Math.max(...statsArr.map(c => c.upload_frequency))
    const maxEngagement = Math.max(...statsArr.map(c => c.engagement_rate))

    const result = {
      channels:           enrichedChannels,
      winner:             metrics.winner ?? { overall: '', by_engagement: '', by_views: '', by_consistency: '' },
      max_subscribers:    maxSubs,
      max_avg_views:      maxViews,
      max_upload_freq:    maxFreq,
      max_engagement:     maxEngagement,
      insights:           insights.insights        ?? [],
      recommendations:    insights.recommendations ?? [],
      opportunities:      insights.opportunities   ?? [],
      steal_ideas:        insights.steal_ideas     ?? [],
    }

    await spendCredits(user.id, 10, 'channels_compare')

    const svc = createServiceClient()
    try {
      const { data: old } = await svc
        .from('analytics_reports').select('id')
        .eq('user_id', user.id).eq('report_type', 'compare')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) await svc.from('analytics_reports').delete().eq('id', old![0].id)
      await svc.from('analytics_reports').insert({
        user_id:     user.id,
        report_type: 'compare',
        title:       `Сравнение: ${statsArr.map(c => c.name).join(' vs ')}`,
        query:       inputs.join('|'),
        result,
      })
      console.log('[compare] report saved')
    } catch (e) {
      console.warn('[compare] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/compare] error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка сравнения: ${msg}` }, { status: 500 })
  }
}
