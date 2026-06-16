import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const key = env('YOUTUBE_API_KEY')
  const qs = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  if (!res.ok) throw new Error(`YouTube API error ${res.status}: ${await res.text()}`)
  return res.json()
}

function extractChannelQuery(input: string): string {
  // Handle @handle, full URL, or plain name
  const handleMatch = input.match(/@([\w-]+)/)
  if (handleMatch) return handleMatch[1]
  const urlMatch = input.match(/youtube\.com\/(?:channel\/|c\/|user\/)([\w-]+)/)
  if (urlMatch) return urlMatch[1]
  return input.trim()
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { channel?: string }
    const channelInput = body.channel?.trim() ?? ''
    if (!channelInput) return NextResponse.json({ ok: false, error: 'Введите канал' }, { status: 400 })

    const svc = createServiceClient()
    const cacheKey = channelInput.toLowerCase().replace(/\s+/g, '-')

    // Check cache (24h)
    const { data: cached } = await svc
      .from('analytics_cache')
      .select('result, created_at')
      .eq('cache_type', 'channel')
      .eq('cache_key', cacheKey)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cached) {
      return NextResponse.json({ ok: true, data: cached.result, cached: true })
    }

    const check = await requireCredits(user.id, 'channel_analysis', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // 1. Find channel
    const query = extractChannelQuery(channelInput)
    const channelSearch = await ytFetch('/search', {
      part: 'snippet', type: 'channel', q: query, maxResults: '1',
    }) as { items?: Array<{ id: { channelId: string }; snippet: { title: string } }> }

    const channelId = channelSearch.items?.[0]?.id?.channelId
    if (!channelId) {
      return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })
    }

    // 2. Channel stats
    const channelStats = await ytFetch('/channels', {
      part: 'statistics,snippet,brandingSettings',
      id: channelId,
    }) as { items?: Array<{ snippet: { title: string; description: string; publishedAt: string }; statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string } }> }

    const ch = channelStats.items?.[0]
    if (!ch) return NextResponse.json({ ok: false, error: 'Данные канала не найдены' }, { status: 404 })

    const channelData = {
      name: ch.snippet.title,
      description: ch.snippet.description?.slice(0, 500),
      subscribers: parseInt(ch.statistics.subscriberCount ?? '0'),
      total_videos: parseInt(ch.statistics.videoCount ?? '0'),
      total_views: parseInt(ch.statistics.viewCount ?? '0'),
      created_at: ch.snippet.publishedAt,
    }

    // 3. Last 50 videos
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', channelId,
      order: 'date', maxResults: '50', type: 'video',
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; publishedAt: string } }> }

    const videoItems = videoSearch.items ?? []
    const videoIds = videoItems.map(v => v.id.videoId).filter(Boolean).join(',')

    let videosData: Array<{ title: string; views: number; url: string; publishedAt: string }> = []
    if (videoIds) {
      const vStats = await ytFetch('/videos', {
        part: 'statistics,snippet', id: videoIds,
      }) as { items?: Array<{ id: string; snippet: { title: string; publishedAt: string }; statistics: { viewCount?: string; likeCount?: string } }> }

      videosData = (vStats.items ?? []).map(v => ({
        title: v.snippet.title,
        views: parseInt(v.statistics.viewCount ?? '0'),
        url: `https://youtube.com/watch?v=${v.id}`,
        publishedAt: v.snippet.publishedAt,
      })).sort((a, b) => b.views - a.views)
    }

    // 4. Claude analysis
    const avgViews = videosData.length > 0
      ? Math.round(videosData.reduce((s, v) => s + v.views, 0) / videosData.length)
      : 0

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const prompt = `Ты эксперт по YouTube маркетингу. Проанализируй канал:

Канал: ${JSON.stringify(channelData)}
Последние видео (топ по просмотрам): ${JSON.stringify(videosData.slice(0, 20))}

Составь детальный отчёт. Ответь только JSON без markdown:
{
  "overview": {
    "subscribers": ${channelData.subscribers},
    "total_views": ${channelData.total_views},
    "avg_views": ${avgViews},
    "upload_frequency": "Примерно X видео в неделю"
  },
  "best_formats": [
    { "name": "Тип формата", "avg_views": 500000, "examples": ["Название видео 1"] }
  ],
  "worst_formats": [
    { "name": "Тип формата", "avg_views": 5000 }
  ],
  "best_topics": ["Тема 1", "Тема 2", "Тема 3"],
  "worst_topics": ["Тема А", "Тема Б"],
  "growth_trend": "Растёт",
  "strengths": ["Сила 1", "Сила 2", "Сила 3"],
  "weaknesses": ["Слабость 1", "Слабость 2"],
  "recommendations": ["Конкретная рекомендация 1", "Конкретная рекомендация 2", "Конкретная рекомендация 3"],
  "top_videos": [
    { "title": "...", "views": 1000000, "url": "..." }
  ],
  "worst_videos": [
    { "title": "...", "views": 1000, "url": "..." }
  ]
}`

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (msg.content[0] as { text: string }).text.trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude вернул невалидный JSON')
    const analysis = JSON.parse(jsonMatch[0])

    // Ensure overview has channel name
    analysis.channel_name = channelData.name
    if (!analysis.top_videos || analysis.top_videos.length === 0) {
      analysis.top_videos = videosData.slice(0, 5)
    }
    if (!analysis.worst_videos || analysis.worst_videos.length === 0) {
      analysis.worst_videos = [...videosData].sort((a, b) => a.views - b.views).slice(0, 3)
    }

    await spendCredits(user.id, 15, 'channel_analysis')

    await svc.from('analytics_cache').upsert({
      cache_type: 'channel',
      cache_key: cacheKey,
      result: analysis,
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_type,cache_key' })

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/channel] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка анализа канала' }, { status: 500 })
  }
}
