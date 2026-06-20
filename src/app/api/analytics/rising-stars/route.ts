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
  console.log(`[rising] yt ${path} status=${res.status} body=${text.slice(0, 400)}`)
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
    // months_max=0 means no age restriction; undefined falls back to 0 (no restriction)
    const monthsMax = body.months_max ?? 0

    console.log(`[rising] start topic="${topic}" sub_min=${subMin} sub_max=${subMax} months_max=${monthsMax}`)

    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const check = await requireCredits(user.id, 'rising_stars', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // ── Step 1: Search recent videos in the niche ─────────────────────────────
    // Searching videos (not channels) finds channels with RECENT activity,
    // which is the correct definition of "rising stars".
    const videoSearchParams: Record<string, string> = {
      part: 'snippet',
      type: 'video',
      q: topic,
      order: 'viewCount',
      maxResults: '50',
    }
    if (monthsMax > 0) {
      const after = new Date()
      after.setMonth(after.getMonth() - monthsMax)
      videoSearchParams.publishedAfter = after.toISOString()
    }

    const videoSearch = await ytFetch('/search', videoSearchParams) as {
      items?: Array<{
        id: { videoId: string }
        snippet: { channelId: string; channelTitle: string; publishedAt: string }
      }>
    }

    const videoItems = videoSearch.items ?? []
    console.log(`[rising] found ${videoItems.length} videos from search`)

    // ── Step 2: Collect unique channel IDs and video IDs ──────────────────────
    const channelVideoMap = new Map<string, { videoIds: string[]; channelTitle: string }>()
    for (const v of videoItems) {
      const cid = v.snippet.channelId
      if (!cid) continue
      const entry = channelVideoMap.get(cid) ?? { videoIds: [], channelTitle: v.snippet.channelTitle }
      if (v.id.videoId) entry.videoIds.push(v.id.videoId)
      channelVideoMap.set(cid, entry)
    }

    const channelIds = [...channelVideoMap.keys()]
    console.log(`[rising] unique channels from videos: ${channelIds.length}`)

    if (channelIds.length === 0) {
      console.log('[rising] 0 channels — returning empty result')
      await spendCredits(user.id, CREDIT_COSTS.rising_stars, 'rising_stars')
      return NextResponse.json({ ok: true, data: { topic, total_found: 0, channels: [], common_patterns: [] } })
    }

    // ── Step 3: Batch-fetch video statistics ──────────────────────────────────
    const allVideoIds = videoItems.map(v => v.id.videoId).filter(Boolean)
    const videoStatsRes = allVideoIds.length > 0
      ? await ytFetch('/videos', { part: 'statistics', id: allVideoIds.join(',') }) as {
          items?: Array<{ id: string; statistics: { viewCount?: string } }>
        }
      : { items: [] }

    const videoViewMap = new Map<string, number>()
    for (const v of videoStatsRes.items ?? []) {
      videoViewMap.set(v.id, parseInt(v.statistics.viewCount ?? '0'))
    }

    // ── Step 4: Batch-fetch channel statistics (up to 50 at a time) ───────────
    const statsRes = await ytFetch('/channels', {
      part: 'statistics,snippet',
      id: channelIds.slice(0, 50).join(','),
    }) as {
      items?: Array<{
        id: string
        snippet: { title: string; publishedAt: string; customUrl?: string }
        statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean }
      }>
    }

    const channelItems = statsRes.items ?? []
    console.log(`[rising] channel stats fetched: ${channelItems.length}`)

    // Log raw data for the first 5 channels to diagnose filtering
    const now = Date.now()
    for (const ch of channelItems.slice(0, 5)) {
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      const publishedAt = ch.snippet.publishedAt
      const monthsOld = (now - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      const hidden = ch.statistics.hiddenSubscriberCount
      console.log(`[rising] ch="${ch.snippet.title}" subs=${subs} hidden=${hidden} videos=${videos} created=${publishedAt} months_old=${monthsOld.toFixed(1)}`)
    }

    // ── Step 5: Filter ────────────────────────────────────────────────────────
    const afterSubFilter = channelItems.filter(ch => {
      if (ch.statistics.hiddenSubscriberCount) return false
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      return subs >= subMin && subs <= subMax
    })
    console.log(`[rising] after subscriber filter (${subMin}–${subMax}): ${afterSubFilter.length}`)

    const afterVideoFilter = afterSubFilter.filter(ch => {
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      return videos > 5
    })
    console.log(`[rising] after video count filter (>5): ${afterVideoFilter.length}`)

    // Note: age filter is handled by publishedAfter in the video search above.
    // channelItems already represent channels with recent activity in the niche.
    console.log(`[rising] final filtered: ${afterVideoFilter.length}`)

    // ── Step 6: Compute metrics ───────────────────────────────────────────────
    const enriched = afterVideoFilter.slice(0, 10).map(ch => {
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      const totalViews = parseInt(ch.statistics.viewCount ?? '0')
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      const publishedAt = new Date(ch.snippet.publishedAt).getTime()
      const monthsOld = Math.max(1, (now - publishedAt) / (1000 * 60 * 60 * 24 * 30.44))

      // Use views of the recent videos we found for this channel
      const chVideoIds = channelVideoMap.get(ch.id)?.videoIds ?? []
      const recentViews = chVideoIds.map(vid => videoViewMap.get(vid) ?? 0)
      const avgViews = recentViews.length > 0
        ? Math.round(recentViews.reduce((a, b) => a + b, 0) / recentViews.length)
        : videos > 0 ? Math.round(totalViews / videos) : 0

      const viralRatio = subs > 0 ? Math.round((avgViews / subs) * 10) / 10 : 0
      const monthlyGrowthEstimate = Math.round(subs / monthsOld)

      return {
        channel_id: ch.id,
        name: ch.snippet.title,
        url: `https://www.youtube.com/${ch.snippet.customUrl ?? `channel/${ch.id}`}`,
        created_at: ch.snippet.publishedAt,
        months_old: Math.round(monthsOld),
        subscribers: subs,
        monthly_growth_estimate: monthlyGrowthEstimate,
        video_count: videos,
        upload_frequency: 0,
        avg_views: avgViews,
        viral_ratio: viralRatio,
      }
    })

    // Sort by viral_ratio desc, then monthly growth
    const maxGrowth = Math.max(1, ...enriched.map(e => e.monthly_growth_estimate))
    enriched.sort((a, b) => {
      const scoreA = a.viral_ratio * 0.6 + (a.monthly_growth_estimate / maxGrowth) * 10 * 0.4
      const scoreB = b.viral_ratio * 0.6 + (b.monthly_growth_estimate / maxGrowth) * 10 * 0.4
      return scoreB - scoreA
    })

    console.log(`[rising] enriched channels for Claude: ${enriched.length}`)

    await spendCredits(user.id, CREDIT_COSTS.rising_stars, 'rising_stars')

    if (enriched.length === 0) {
      const svc2 = createServiceClient()
      try {
        await svc2.from('analytics_reports').insert({
          user_id: user.id,
          report_type: 'rising_stars',
          title: `Восходящие звёзды: ${topic}`,
          query: topic,
          result: { topic, total_found: 0, channels: [], common_patterns: [] },
        })
      } catch { /* ignore */ }
      return NextResponse.json({ ok: true, data: { topic, total_found: 0, channels: [], common_patterns: [] } })
    }

    // ── Step 7: Claude analysis ───────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const channelsSummary = enriched.map(ch =>
      `${ch.name}: ${ch.subscribers} подп., ${ch.months_old} мес. старый, ${ch.video_count} видео, ${ch.avg_views} ср. просм., виральность ${ch.viral_ratio}x`
    ).join('\n')

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      messages: [{
        role: 'user',
        content: `Ты эксперт по YouTube росту. Ниша: "${topic}".
Восходящие каналы с недавней высокопросматриваемой активностью:
${channelsSummary}

Для каждого канала определи: причину роста, стратегию контента, что перенять.
Верни JSON (ровно ${enriched.length} элементов в channels):
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
      console.warn('[rising] claude parse failed:', e instanceof Error ? e.message : String(e))
    }

    const finalChannels = enriched.map(ch => {
      const insight = claudeResult.channels.find(c => {
        const cLow = c.name.toLowerCase()
        const chLow = ch.name.toLowerCase()
        return cLow.includes(chLow.split(' ')[0]) || chLow.includes(cLow.split(' ')[0])
      })
      return {
        ...ch,
        growth_reason: insight?.growth_reason ?? 'Активность в нише с высокими просмотрами',
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
      console.warn('[rising] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[rising]', msg)
    return NextResponse.json({ ok: false, error: `Ошибка: ${msg}` }, { status: 500 })
  }
}
