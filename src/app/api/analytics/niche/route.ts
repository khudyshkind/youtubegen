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

function cacheKey(topic: string, country: string, lang: string) {
  return `${topic.toLowerCase().trim()}|${country}|${lang}`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { topic?: string; country?: string; lang?: string }
    const topic = body.topic?.trim() ?? ''
    const country = body.country ?? 'RU'
    const lang = body.lang ?? 'ru'

    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const svc = createServiceClient()
    const key = cacheKey(topic, country, lang)

    // Check cache (24h)
    const { data: cached } = await svc
      .from('analytics_cache')
      .select('result, created_at')
      .eq('cache_type', 'niche')
      .eq('cache_key', key)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cached) {
      return NextResponse.json({ ok: true, data: cached.result, cached: true })
    }

    // Check credits
    const check = await requireCredits(user.id, 'niche_analysis', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // 1. Search channels
    const channelSearch = await ytFetch('/search', {
      part: 'snippet', type: 'channel', q: topic,
      maxResults: '10', relevanceLanguage: lang, regionCode: country,
    }) as { items?: Array<{ id: { channelId: string }; snippet: { title: string; description: string } }> }

    const channelIds = (channelSearch.items ?? []).map(i => i.id.channelId).filter(Boolean).join(',')

    // 2. Channel statistics
    let channelsData: Array<{ name: string; subscribers: number; videos: number; views: number }> = []
    if (channelIds) {
      const statsRes = await ytFetch('/channels', {
        part: 'statistics,snippet', id: channelIds,
      }) as { items?: Array<{ snippet: { title: string }; statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string } }> }

      channelsData = (statsRes.items ?? []).map(ch => ({
        name: ch.snippet.title,
        subscribers: parseInt(ch.statistics.subscriberCount ?? '0'),
        videos: parseInt(ch.statistics.videoCount ?? '0'),
        views: parseInt(ch.statistics.viewCount ?? '0'),
      }))
    }

    // 3. Top videos (last year)
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', type: 'video', q: topic,
      order: 'viewCount', publishedAfter: oneYearAgo,
      maxResults: '10', relevanceLanguage: lang, regionCode: country,
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string } }> }

    const videoItems = videoSearch.items ?? []
    const videoIds = videoItems.map(v => v.id.videoId).filter(Boolean).join(',')

    // 4. Video statistics
    let videosData: Array<{ title: string; views: number; channel: string; url: string; publishedAt: string }> = []
    if (videoIds) {
      const vStats = await ytFetch('/videos', {
        part: 'statistics,snippet', id: videoIds,
      }) as { items?: Array<{ id: string; snippet: { title: string; channelTitle: string; publishedAt: string }; statistics: { viewCount?: string } }> }

      videosData = (vStats.items ?? []).map(v => ({
        title: v.snippet.title,
        views: parseInt(v.statistics.viewCount ?? '0'),
        channel: v.snippet.channelTitle,
        url: `https://youtube.com/watch?v=${v.id}`,
        publishedAt: v.snippet.publishedAt,
      })).sort((a, b) => b.views - a.views)
    }

    // 5. Claude analysis
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const prompt = `Ты эксперт по YouTube маркетингу. Проанализируй нишу "${topic}" на основе данных:

Топ каналы: ${JSON.stringify(channelsData.slice(0, 5))}
Топ видео: ${JSON.stringify(videosData.slice(0, 5))}
Язык контента: ${lang}, Страна: ${country}

Составь подробный отчёт в формате JSON (только JSON, без markdown):
{
  "competition": { "score": 7, "level": "Высокая", "reason": "..." },
  "potential": { "trend": "Растёт", "growth": "+23%", "reason": "..." },
  "rpm": { "min": 1.5, "max": 3.0, "currency": "USD" },
  "subniches": [
    { "name": "...", "competition": "Низкая", "potential": "Высокий" }
  ],
  "monetization": {
    "videos_per_week_1": "18-24 месяца",
    "videos_per_week_2": "10-14 месяцев",
    "videos_per_week_3": "7-10 месяцев"
  },
  "best_time": { "days": ["Вторник", "Четверг"], "hours": "18:00-20:00 МСК" },
  "top_formats": [
    { "name": "...", "avg_views": 450000 }
  ],
  "top_channels": [
    { "name": "...", "subscribers": 2100000, "videos": 500, "avg_views": 450000 }
  ],
  "top_videos": [
    { "title": "...", "views": 2000000, "channel": "...", "url": "..." }
  ],
  "recommendations": ["...", "...", "..."]
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

    // Enrich with real YouTube data
    if (!analysis.top_channels || analysis.top_channels.length === 0) {
      analysis.top_channels = channelsData.slice(0, 5).map(c => ({
        name: c.name,
        subscribers: c.subscribers,
        videos: c.videos,
        avg_views: c.videos > 0 ? Math.round(c.views / c.videos) : 0,
      }))
    }
    if (!analysis.top_videos || analysis.top_videos.length === 0) {
      analysis.top_videos = videosData.slice(0, 5)
    }

    // Spend credits
    await spendCredits(user.id, 10, 'niche_analysis')

    // Cache result
    await svc.from('analytics_cache').upsert({
      cache_type: 'niche',
      cache_key: key,
      result: analysis,
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_type,cache_key' })

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/niche] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка анализа ниши' }, { status: 500 })
  }
}
