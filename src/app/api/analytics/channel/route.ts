import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

const CHANNEL_SYSTEM_PROMPT_1 = `You are an experienced YouTube analyst specializing in in-depth channel analysis. Based on channel data (subscribers, videos, views) and top videos, identify the key characteristics of the channel.

ANALYSIS METHODOLOGY:
• upload_frequency — publishing frequency (estimate from video count and channel age if known)
• growth_trend — "Растёт" / "Стабильно" / "Снижается" (estimate from view-to-subscriber ratio)
• best_topics — top 3 topics that perform best (identify from titles and view counts of top videos)
• worst_topics — 2 topics that underperform relative to others
• strengths — 3 specific strengths of the channel based on data
• weaknesses — 2 specific weaknesses

IMPORTANT: Base your analysis ONLY on real data provided in the request. Do not invent numbers or facts not present in the data.

RESPONSE FORMAT — strictly JSON without markdown without explanations:
{"upload_frequency":"X videos per week","growth_trend":"Растёт","best_topics":["Topic 1","Topic 2","Topic 3"],"worst_topics":["Weak topic 1","Weak topic 2"],"strengths":["Strength 1","Strength 2","Strength 3"],"weaknesses":["Weakness 1","Weakness 2"]}

IMPORTANT: Return ONLY valid JSON. No \`\`\`json blocks. No explanations. Start with { and end with }.

OUTPUT LANGUAGE: Write best_topics, worst_topics, strengths, and weaknesses in the same language as the channel data provided.`

const CHANNEL_SYSTEM_PROMPT_2 = `You are an experienced YouTube analyst specializing in identifying video formats and developing growth strategies for channels. Based on channel data and top videos, identify which formats work and provide practical recommendations.

FORMAT IDENTIFICATION METHODOLOGY:
• Analyze top video titles to identify formats: test-drives, reviews, comparisons, top-lists, how-to, breakdowns, stories
• best_formats — top 2-3 formats with highest average views
• worst_formats — 1-2 formats with lowest views
• avg_views — average view count for videos in this format (estimate from the data)

RECOMMENDATIONS:
• 3 concrete tips on what to change or improve
• Base on real data — channel weaknesses and opportunities
• Specific actions, not generic advice like "post more often"

CRITICAL: Do NOT include an "example" field with specific video names — video titles in JSON cause escaping issues.

RESPONSE FORMAT — strictly JSON without markdown without explanations:
{"best_formats":[{"name":"Test-drives","avg_views":450000},{"name":"Reviews","avg_views":280000}],"worst_formats":[{"name":"Weak format","avg_views":5000}],"recommendations":["Specific recommendation 1","Recommendation 2","Recommendation 3"]}

IMPORTANT: Return ONLY valid JSON. No \`\`\`json blocks. No explanations. Start with { and end with }.

OUTPUT LANGUAGE: Write format names and recommendations in the same language as the channel data provided.`

function parseClaudeJson<T>(text: string, label: string): T {
  console.log(`[channel] ${label} raw:`, text.substring(0, 500))
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
  const key = env('YOUTUBE_API_KEY')
  const qs = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  console.log(`[channel] yt ${path} status=${res.status} body=${text.slice(0, 300)}`)
  if (!res.ok) throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

function extractChannelQuery(input: string): string {
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

    console.log(`[channel] start input="${channelInput}"`)

    const svc = createServiceClient()
    const cacheKey = channelInput.toLowerCase().replace(/\s+/g, '-')

    // Cache check — non-fatal
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'channel')
        .eq('cache_key', cacheKey)
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .single()
      if (cached) {
        console.log('[channel] cache hit, saving report for user:', user.id)
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'channel')
            .eq('query', channelInput)
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle()
          if (!existing) {
            const { data: old } = await svc
              .from('analytics_reports')
              .select('id')
              .eq('user_id', user.id)
              .eq('report_type', 'channel')
              .order('created_at', { ascending: true })
            if ((old?.length ?? 0) >= 20) {
              await svc.from('analytics_reports').delete().eq('id', old![0].id)
            }
            const cachedName = (cached.result as { channel_name?: string })?.channel_name ?? channelInput
            const { error: saveErr } = await svc.from('analytics_reports').insert({
              user_id: user.id,
              report_type: 'channel',
              title: `Канал: ${cachedName}`,
              query: channelInput,
              result: cached.result,
            })
            console.log('[channel] cache-hit save result:', saveErr?.message ?? 'ok')
          } else {
            console.log('[channel] cache-hit: report already saved today, skip')
          }
        } catch (saveEx) {
          console.warn('[channel] cache-hit report save failed:', saveEx instanceof Error ? saveEx.message : String(saveEx))
        }
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[channel] cache check skipped:', e instanceof Error ? e.message : String(e))
    }

    const check = await requireCredits(user.id, 'channel_analysis', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // ── YouTube data ──────────────────────────────────────────────────────────

    console.log('[channel] step 1: find channel')
    const query = extractChannelQuery(channelInput)
    const channelSearch = await ytFetch('/search', {
      part: 'snippet', type: 'channel', q: query, maxResults: '1',
    }) as { items?: Array<{ id: { channelId: string }; snippet: { title: string } }> }

    const channelId = channelSearch.items?.[0]?.id?.channelId
    if (!channelId) return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })

    console.log(`[channel] channel id: ${channelId}`)

    console.log('[channel] step 2: channel stats')
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
    console.log(`[channel] name="${channelData.name}" subs=${channelData.subscribers}`)

    console.log('[channel] step 3: last 50 videos')
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', channelId,
      order: 'date', maxResults: '50', type: 'video',
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; publishedAt: string } }> }

    const videoItems = videoSearch.items ?? []
    const videoIds = videoItems.map(v => v.id.videoId).filter(Boolean).join(',')
    console.log(`[channel] videos found: ${videoItems.length}`)

    let videosData: Array<{ title: string; views: number; url: string; publishedAt: string }> = []
    if (videoIds) {
      console.log('[channel] step 4: video stats')
      const vStats = await ytFetch('/videos', {
        part: 'statistics,snippet', id: videoIds,
      }) as { items?: Array<{ id: string; snippet: { title: string; publishedAt: string }; statistics: { viewCount?: string; likeCount?: string } }> }

      videosData = (vStats.items ?? []).map(v => ({
        title: v.snippet.title,
        views: parseInt(v.statistics.viewCount ?? '0'),
        url: `https://www.youtube.com/watch?v=${v.id}`,
        publishedAt: v.snippet.publishedAt,
      })).sort((a, b) => b.views - a.views)
      console.log(`[channel] video stats count: ${videosData.length}`)
    }

    const avgViews = videosData.length > 0
      ? Math.round(videosData.reduce((s, v) => s + v.views, 0) / videosData.length)
      : 0

    // ── Claude: two small requests ────────────────────────────────────────────

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    // Limit to 5 videos to keep prompt compact and avoid Claude quoting titles in JSON
    const dataCtx = `Канал: "${channelData.name}", ${channelData.subscribers} подписчиков, ${channelData.total_videos} видео, ср. просмотры: ${avgViews}.
Топ видео: ${JSON.stringify(videosData.slice(0, 5).map(v => ({ title: v.title, views: v.views })))}`

    // Request 1 — overview + topics
    console.log('[channel] step 5a: claude overview')
    const msg1 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: [{ type: 'text', text: CHANNEL_SYSTEM_PROMPT_1, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataCtx }],
    })
    console.log('[channel] msg1 cache input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg1.usage.cache_creation_input_tokens ?? 0)
    const text1 = (msg1.content[0] as { text: string }).text

    interface Overview {
      upload_frequency: string
      growth_trend: string
      best_topics: string[]
      worst_topics: string[]
      strengths: string[]
      weaknesses: string[]
    }
    const overview = parseClaudeJson<Overview>(text1, 'claude1')

    // Request 2 — formats + recommendations (no "example" field — video titles break JSON escaping)
    console.log('[channel] step 5b: claude formats')
    const msg2 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: [{ type: 'text', text: CHANNEL_SYSTEM_PROMPT_2, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${dataCtx}\n\nОпредели форматы видео и дай рекомендации.` }],
    })
    console.log('[channel] msg2 cache input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg2.usage.cache_creation_input_tokens ?? 0)
    const text2 = (msg2.content[0] as { text: string }).text
    console.log('[channel] claude2 raw:', text2.substring(0, 500))

    interface Formats {
      best_formats: Array<{ name: string; avg_views: number; example?: string } | string>
      worst_formats: Array<{ name: string; avg_views: number } | string>
      recommendations: string[]
    }
    const formats = parseClaudeJson<Formats>(text2, 'claude2')

    // ── Merge into final shape ────────────────────────────────────────────────

    const analysis = {
      channel_name: channelData.name,
      overview: {
        subscribers: channelData.subscribers,
        total_views: channelData.total_views,
        avg_views: avgViews,
        upload_frequency: overview.upload_frequency ?? '',
      },
      growth_trend: overview.growth_trend ?? '',
      best_formats: (formats.best_formats ?? []).map(f =>
        typeof f === 'string'
          ? { name: f, avg_views: 0, examples: [] }
          : { name: f.name, avg_views: f.avg_views ?? 0, examples: f.example ? [f.example] : [] }
      ),
      worst_formats: (formats.worst_formats ?? []).map(f =>
        typeof f === 'string' ? { name: f, avg_views: 0 } : { name: f.name, avg_views: f.avg_views ?? 0 }
      ),
      best_topics: overview.best_topics ?? [],
      worst_topics: overview.worst_topics ?? [],
      strengths: overview.strengths ?? [],
      weaknesses: overview.weaknesses ?? [],
      recommendations: formats.recommendations ?? [],
      top_videos: videosData.slice(0, 5),
      worst_videos: [...videosData].sort((a, b) => a.views - b.views).slice(0, 3),
    }

    console.log('[channel] analysis merged ok')

    await spendCredits(user.id, 15, 'channel_analysis')

    try {
      await svc.from('analytics_cache').upsert({
        cache_type: 'channel',
        cache_key: cacheKey,
        result: analysis,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[channel] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    // Save to reports history (non-fatal)
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'channel')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'channel',
        title: `Канал: ${channelData.name}`,
        query: channelInput,
        result: analysis,
      })
    } catch (e) {
      console.warn('[channel] report save failed:', e instanceof Error ? e.message : String(e))
    }

    // Cleanup stale cache (non-fatal)
    try {
      await svc.from('analytics_cache')
        .delete()
        .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[channel] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/channel] fatal error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа канала: ${msg}` }, { status: 500 })
  }
}
