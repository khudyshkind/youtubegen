import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function parseClaudeJson<T>(text: string): T {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error('no { found')
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
  throw new Error('unbalanced braces')
}

async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const key = env('YOUTUBE_API_KEY')
  const qs = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as {
      topic?: string
      sub_min?: number
      sub_max?: number
      months_max?: number
    }

    const topic = body.topic?.trim() ?? ''
    const subMin = body.sub_min ?? 1000
    const subMax = body.sub_max ?? 100000
    const monthsMax = body.months_max ?? 12

    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const check = await requireCredits(user.id, 'rising_stars', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // Step 1: Search channels by topic
    const channelSearch = await ytFetch('/search', {
      part: 'snippet',
      type: 'channel',
      q: topic,
      maxResults: '30',
    }) as { items?: Array<{ id: { channelId: string } }> }

    const channelIds = (channelSearch.items ?? []).map(i => i.id.channelId).filter(Boolean)

    if (channelIds.length === 0) {
      return NextResponse.json({ ok: true, data: { topic, total_found: 0, channels: [], common_patterns: [] } })
    }

    // Step 2: Batch fetch channel stats
    const statsRes = await ytFetch('/channels', {
      part: 'statistics,snippet',
      id: channelIds.join(','),
    }) as {
      items?: Array<{
        id: string
        snippet: { title: string; publishedAt: string; customUrl?: string }
        statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string }
      }>
    }

    const now = Date.now()

    // Step 3: Filter by subscriber range, age, and activity
    const filtered = (statsRes.items ?? []).filter(ch => {
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      const publishedAt = new Date(ch.snippet.publishedAt).getTime()
      const monthsOld = (now - publishedAt) / (1000 * 60 * 60 * 24 * 30.44)

      if (subs < subMin || subs > subMax) return false
      if (videos <= 5) return false
      if (monthsMax > 0 && monthsOld > monthsMax) return false

      return true
    })

    // Step 4: Enrich with video stats (limit to top 10 filtered channels)
    const enriched: Array<{
      channel_id: string
      name: string
      url: string
      created_at: string
      months_old: number
      subscribers: number
      monthly_growth_estimate: number
      video_count: number
      upload_frequency: number
      avg_views: number
      viral_ratio: number
    }> = []

    for (const ch of filtered.slice(0, 10)) {
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      const totalViews = parseInt(ch.statistics.viewCount ?? '0')
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      const publishedAt = new Date(ch.snippet.publishedAt).getTime()
      const monthsOld = Math.max(1, (now - publishedAt) / (1000 * 60 * 60 * 24 * 30.44))

      let avgViews = videos > 0 ? Math.round(totalViews / videos) : 0
      let uploadFrequency = 0

      try {
        const videoSearch = await ytFetch('/search', {
          part: 'id',
          channelId: ch.id,
          type: 'video',
          maxResults: '10',
          order: 'date',
        }) as { items?: Array<{ id: { videoId: string } }> }

        const videoIds = (videoSearch.items ?? []).map(v => v.id.videoId).filter(Boolean)

        if (videoIds.length > 0) {
          const vStats = await ytFetch('/videos', {
            part: 'statistics,snippet',
            id: videoIds.join(','),
          }) as {
            items?: Array<{
              snippet: { publishedAt: string }
              statistics: { viewCount?: string }
            }>
          }

          const vItems = vStats.items ?? []
          if (vItems.length > 0) {
            const totalVV = vItems.reduce((s, v) => s + parseInt(v.statistics.viewCount ?? '0'), 0)
            avgViews = Math.round(totalVV / vItems.length)

            if (vItems.length >= 2) {
              const dates = vItems
                .map(v => new Date(v.snippet.publishedAt).getTime())
                .sort((a, b) => b - a)
              const spanWeeks = (dates[0] - dates[dates.length - 1]) / (1000 * 60 * 60 * 24 * 7)
              uploadFrequency = spanWeeks > 0 ? Math.round((vItems.length / spanWeeks) * 10) / 10 : 0
            }
          }
        }
      } catch (e) {
        console.warn(`[rising-stars] video fetch failed for ${ch.snippet.title}:`, e instanceof Error ? e.message : String(e))
      }

      const viralRatio = subs > 0 ? Math.round((avgViews / subs) * 10) / 10 : 0
      const monthlyGrowthEstimate = Math.round(subs / monthsOld)

      enriched.push({
        channel_id: ch.id,
        name: ch.snippet.title,
        url: `https://www.youtube.com/${ch.snippet.customUrl ?? `channel/${ch.id}`}`,
        created_at: ch.snippet.publishedAt,
        months_old: Math.round(monthsOld),
        subscribers: subs,
        monthly_growth_estimate: monthlyGrowthEstimate,
        video_count: videos,
        upload_frequency: uploadFrequency,
        avg_views: avgViews,
        viral_ratio: viralRatio,
      })
    }

    // Sort by composite score: viral_ratio (60%) + normalized monthly growth (40%)
    const maxGrowth = Math.max(1, ...enriched.map(e => e.monthly_growth_estimate))
    enriched.sort((a, b) => {
      const scoreA = a.viral_ratio * 0.6 + (a.monthly_growth_estimate / maxGrowth) * 10 * 0.4
      const scoreB = b.viral_ratio * 0.6 + (b.monthly_growth_estimate / maxGrowth) * 10 * 0.4
      return scoreB - scoreA
    })

    if (enriched.length === 0) {
      return NextResponse.json({ ok: true, data: { topic, total_found: 0, channels: [], common_patterns: [] } })
    }

    // Step 5: Claude analyzes top channels
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const channelsSummary = enriched.slice(0, 10).map(ch =>
      `${ch.name}: ${ch.subscribers} подп., создан ${ch.months_old} мес. назад, ${ch.video_count} видео, ${ch.avg_views} ср. просм., виральность ${ch.viral_ratio}x`
    ).join('\n')

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      messages: [{
        role: 'user',
        content: `Ты эксперт по YouTube росту. Ниша: "${topic}".
Восходящие каналы:
${channelsSummary}

Для каждого канала определи: причину роста, стратегию контента, что перенять.
Верни JSON (ровно ${enriched.slice(0, 10).length} элементов в channels):
{
  "channels": [
    {
      "name": "название как в данных",
      "growth_reason": "Конкретная причина роста (1-2 предложения)",
      "strategy": "Стратегия контента (1-2 предложения)",
      "key_takeaway": "Что скопировать (1 предложение)"
    }
  ],
  "common_patterns": [
    "Общий паттерн у нескольких каналов (1-2 предложения)"
  ]
}
Только JSON, без markdown.`,
      }],
    })

    const claudeText = (msg.content[0] as { type: string; text: string }).text

    let claudeResult: {
      channels: Array<{ name: string; growth_reason: string; strategy: string; key_takeaway: string }>
      common_patterns: string[]
    } = { channels: [], common_patterns: [] }

    try {
      claudeResult = parseClaudeJson(claudeText)
    } catch (e) {
      console.warn('[rising-stars] claude parse failed:', e instanceof Error ? e.message : String(e))
    }

    const finalChannels = enriched.slice(0, 10).map(ch => {
      const insight = claudeResult.channels.find(c => {
        const cLow = c.name.toLowerCase()
        const chLow = ch.name.toLowerCase()
        return cLow.includes(chLow.split(' ')[0]) || chLow.includes(cLow.split(' ')[0])
      })
      return {
        ...ch,
        growth_reason: insight?.growth_reason ?? 'Быстрый рост в нише',
        strategy: insight?.strategy ?? 'Регулярные публикации по теме',
        key_takeaway: insight?.key_takeaway ?? 'Анализировать топ видео канала',
      }
    })

    const result = {
      topic,
      total_found: finalChannels.length,
      channels: finalChannels,
      common_patterns: claudeResult.common_patterns ?? [],
    }

    await spendCredits(user.id, CREDIT_COSTS.rising_stars, 'rising_stars')

    const svc = createServiceClient()
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'rising_stars')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'rising_stars',
        title: `Восходящие звёзды: ${topic}`,
        query: topic,
        result,
      })
    } catch (e) {
      console.warn('[rising-stars] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[rising-stars]', msg)
    return NextResponse.json({ ok: false, error: `Ошибка: ${msg}` }, { status: 500 })
  }
}
