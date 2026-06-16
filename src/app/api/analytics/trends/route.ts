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

function cacheKey(topic: string, period: string) {
  const day = new Date().toISOString().slice(0, 10) // invalidates daily
  return `${topic.toLowerCase().trim()}|${period}|${day}`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { topic?: string; period?: string }
    const topic = body.topic?.trim() ?? ''
    const period = body.period ?? 'week'

    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const svc = createServiceClient()
    const key = cacheKey(topic, period)

    // Check cache (24h)
    const { data: cached } = await svc
      .from('analytics_cache')
      .select('result, created_at')
      .eq('cache_type', 'trends')
      .eq('cache_key', key)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cached) {
      return NextResponse.json({ ok: true, data: cached.result, cached: true })
    }

    const check = await requireCredits(user.id, 'trends', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const days = period === 'month' ? 30 : 7
    const publishedAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // 1. Search trending videos
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', type: 'video', q: topic,
      order: 'viewCount', publishedAfter,
      maxResults: '20',
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string } }> }

    const videoItems = videoSearch.items ?? []
    const videoIds = videoItems.map(v => v.id.videoId).filter(Boolean).join(',')

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

    // 2. Claude trend analysis
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const prompt = `Ты эксперт по YouTube маркетингу. Проанализируй вирусные видео в нише "${topic}" за последние ${days} дней:

${JSON.stringify(videosData.slice(0, 15))}

Найди паттерны и определи тренды. Ответь только JSON без markdown:
{
  "trends": [
    {
      "topic": "Конкретная тема которая сейчас вирусится",
      "reason": "Почему это работает — заголовки, форматы, триггеры",
      "urgency": "Срочно",
      "video_ideas": ["Идея 1 для видео", "Идея 2 для видео", "Идея 3 для видео"],
      "example_videos": [
        { "title": "...", "views": 1200000, "url": "..." }
      ]
    }
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

    await spendCredits(user.id, 5, 'trends')

    await svc.from('analytics_cache').upsert({
      cache_type: 'trends',
      cache_key: key,
      result: analysis,
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_type,cache_key' })

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/trends] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка анализа трендов' }, { status: 500 })
  }
}
