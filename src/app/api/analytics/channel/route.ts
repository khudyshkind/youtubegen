import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { YouTubeQuotaError, checkYouTubeQuota, quotaExceededResponse, byokQuotaResponse, isYouTubeKeyError, youTubeKeyErrorResponse } from '@/lib/youtube-quota'
import { resolveAnalyticsContext } from '@/lib/analytics-gate'
import { env } from '@/lib/env'
import { isBillingError, notifyBillingError } from '@/lib/telegram'
import { fetchChannelFeed } from '@/lib/youtube-rss'
import { detectChannelInput } from '@/lib/youtube-channel'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

// ── Helpers ───────────────────────────────────────────────────────────────────

// subscriberCount is rounded by YouTube API to 3 sig figs since Nov 2019.
// Show "≈" to avoid false precision in the UI.
function fmtSubscribers(n: number): string {
  if (n >= 1_000_000) return `≈${(n / 1_000_000).toFixed(1)} млн`
  if (n >= 10_000)    return `≈${Math.round(n / 1_000)} тыс.`
  if (n >= 1_000)     return `≈${(n / 1_000).toFixed(1)} тыс.`
  return String(n)  // < 1000: API gives exact count
}

// Compact number for Claude prompt (e.g. 1234567 → "1.2M")
function fmtN(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

function medianOf(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? Math.round(((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2) : (s[m] ?? 0)
}

function avgEngagementRate(videos: { views: number; likes: number }[]): number {
  const w = videos.filter(v => v.views > 0)
  if (!w.length) return 0
  return parseFloat((w.reduce((s, v) => s + v.likes / v.views, 0) / w.length * 100).toFixed(2))
}

// Computes long-form uploads per week from an array of dated videos.
function longsPerWeek(videos: { published: Date }[]): number {
  if (videos.length < 2) return 0
  const sorted = [...videos].sort((a, b) => a.published.getTime() - b.published.getTime())
  const spanMs    = (sorted.at(-1)!.published.getTime()) - sorted[0].published.getTime()
  const spanWeeks = spanMs / (7 * 24 * 60 * 60 * 1000)
  if (spanWeeks < 0.5) return 0
  return parseFloat((videos.length / spanWeeks).toFixed(1))
}

function extractTopicCategories(urls?: string[]): string {
  return (urls ?? [])
    .map(u => decodeURIComponent(u.split('/wiki/')[1] ?? '').replace(/_/g, ' '))
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')
}

// ── Deep scan helpers ────────────────────────────────────────────────────────

function parseDurationSec(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0')
}

interface DeepVideoItem {
  title: string; views: number; likes: number; comments: number
  published: string; duration: string; duration_sec: number; tags: string[]
  caption: boolean; url: string; thumbnail: string
}

function computeDeepStats(videos: DeepVideoItem[]) {
  const n = videos.length
  if (!n) return null
  const durations = videos.map(v => v.duration_sec).filter(d => d > 0)
  const avgDurSec = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0
  const medDurSec = medianOf(durations)
  const buckets = { under5m: 0, m5to15: 0, m15to30: 0, m30to60: 0, over60m: 0 }
  for (const d of durations) {
    if (d < 300) buckets.under5m++
    else if (d < 900) buckets.m5to15++
    else if (d < 1800) buckets.m15to30++
    else if (d < 3600) buckets.m30to60++
    else buckets.over60m++
  }
  const captionPct = Math.round(videos.filter(v => v.caption).length / n * 100)
  const engVideos = videos.filter(v => v.views > 0)
  const avgEngRate = engVideos.length
    ? parseFloat((engVideos.reduce((s, v) => s + (v.likes + v.comments) / v.views, 0) / engVideos.length * 100).toFixed(2))
    : 0
  const tagCounts: Record<string, number> = {}
  for (const v of videos) for (const tag of v.tags) { const t = tag.toLowerCase(); tagCounts[t] = (tagCounts[t] ?? 0) + 1 }
  const topTags: Array<[string, number]> = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)
  const viewSorted = [...videos].sort((a, b) => b.views - a.views)
  const qSize = Math.max(1, Math.ceil(n / 4))
  const hitTagCounts: Record<string, number> = {}
  const dudTagCounts: Record<string, number> = {}
  for (const v of viewSorted.slice(0, qSize)) v.tags.forEach(t => { const k = t.toLowerCase(); hitTagCounts[k] = (hitTagCounts[k] ?? 0) + 1 })
  for (const v of viewSorted.slice(-qSize)) v.tags.forEach(t => { const k = t.toLowerCase(); dudTagCounts[k] = (dudTagCounts[k] ?? 0) + 1 })
  const hitTags = Object.entries(hitTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)
  const dudTags = Object.entries(dudTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)
  const yearMap: Record<number, { count: number; totalViews: number }> = {}
  for (const v of videos) {
    const year = new Date(v.published).getFullYear()
    yearMap[year] ??= { count: 0, totalViews: 0 }
    yearMap[year].count++
    yearMap[year].totalViews += v.views
  }
  const yearly = Object.entries(yearMap)
    .map(([y, { count, totalViews }]) => ({ year: parseInt(y), count, avg_views: count > 0 ? Math.round(totalViews / count) : 0 }))
    .sort((a, b) => a.year - b.year)
  return { total_deep: n, avg_duration_sec: avgDurSec, median_duration_sec: medDurSec, caption_pct: captionPct, avg_engagement_rate: avgEngRate, top_tags: topTags, hit_tags: hitTags, dud_tags: dudTags, duration_buckets: buckets, yearly }
}

// ── Claude prompts ────────────────────────────────────────────────────────────

function getChannelPrompt1(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик. На основе данных канала определи ключевые характеристики.

ДАННЫЕ: будут переданы метрики канала и последние 15 длинных видео с РЕАЛЬНЫМИ датами, просмотрами и лайками.

МЕТОДОЛОГИЯ:
• upload_frequency — вычисли из реальных дат публикаций (например "2.1 длинных видео/нед."). Учти только длинные видео.
• growth_trend — "Растёт" / "Стабильно" / "Снижается" — определи по динамике просмотров от старых к новым видео.
• best_topics — топ 3 темы с лучшими просмотрами (определи из названий).
• worst_topics — 2 темы с наихудшими просмотрами.
• strengths — 3 конкретные сильные стороны, основанные на данных.
• weaknesses — 2 конкретные слабые стороны.

ФОРМАТ — строго JSON без markdown:
{"upload_frequency":"2.1 длинных видео/нед.","growth_trend":"Растёт","best_topics":["Тест-драйвы","Сравнения","Советы"],"worst_topics":["Влоги","Тюнинг"],"strengths":["Стабильный график","Высокий CTR на сравнениях","Экспертная подача"],"weaknesses":["Слабые миниатюры на б/у авто","Нет Shorts"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON на русском. Начни с {.`
    : `You are an experienced YouTube channel analyst. Based on channel data provided, identify key characteristics.

DATA: channel metrics and last 15 long-form videos with REAL dates, views, and likes will be provided.

METHODOLOGY:
• upload_frequency — compute from actual publication dates (e.g. "2.1 longs/week"). Long-form only.
• growth_trend — "Growing" / "Stable" / "Declining" — based on view trend from older to newer videos.
• best_topics — top 3 topics with best views (from titles).
• worst_topics — 2 topics with lowest views.
• strengths — 3 specific channel strengths based on actual data.
• weaknesses — 2 specific weaknesses.

FORMAT — strict JSON without markdown:
{"upload_frequency":"2.1 longs/week","growth_trend":"Growing","best_topics":["Test Drives","Comparisons","Buying Advice"],"worst_topics":["Vlogs","Tuning"],"strengths":["Consistent schedule","High CTR on comparisons","Expert delivery"],"weaknesses":["Weak thumbnails on used cars","No Shorts"]}

IMPORTANT: Return ONLY valid JSON in English. Start with {.`
}

function getChannelPrompt2(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик. На основе данных канала определи форматы видео и дай рекомендации.

ДАННЫЕ: метрики, 15 длинных видео с просмотрами/лайками, топ всех времён.

МЕТОДОЛОГИЯ:
• Анализируй названия для определения форматов: тест-драйвы, обзоры, сравнения, топы, how-to, истории.
• best_formats — топ 2-3 формата с наибольшими средними просмотрами. Поле avg_views — целое число.
• worst_formats — 1-2 формата с наименьшими просмотрами. Поле avg_views — целое число.
• recommendations — 3 конкретных совета. Используй данные о вовлечённости (лайки/просмотры) если они есть.

ВАЖНО: НЕ включай поле "example".

ФОРМАТ — строго JSON без markdown:
{"best_formats":[{"name":"Тест-драйвы","avg_views":450000}],"worst_formats":[{"name":"Влоги","avg_views":5000}],"recommendations":["Совет 1","Совет 2","Совет 3"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON на русском. Начни с {.`
    : `You are an experienced YouTube channel analyst. Based on channel data, identify video formats and give recommendations.

DATA: metrics, 15 long-form videos with views/likes, all-time top.

METHODOLOGY:
• Analyze titles to identify formats: test drives, reviews, comparisons, top lists, how-to, stories.
• best_formats — top 2-3 formats with highest avg views. avg_views must be an integer.
• worst_formats — 1-2 formats with lowest avg views. avg_views must be an integer.
• recommendations — 3 specific actionable tips. Use engagement data (likes/views) if available.

IMPORTANT: Do NOT include "example" field.

FORMAT — strict JSON without markdown:
{"best_formats":[{"name":"Test Drives","avg_views":450000}],"worst_formats":[{"name":"Vlogs","avg_views":5000}],"recommendations":["Tip 1","Tip 2","Tip 3"]}

IMPORTANT: Return ONLY valid JSON in English. Start with {.`
}

// ── YouTube fetch helper ──────────────────────────────────────────────────────

async function ytFetch(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const qs  = new URLSearchParams({ ...params, key: apiKey }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  console.log(`[channel] yt ${path} status=${res.status} body=${text.slice(0, 200)}`)
  if (!res.ok) {
    checkYouTubeQuota(res.status, text)
    throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

// ── Channel API type (enriched with brandingSettings + topicDetails) ──────────

type ChItem = {
  id: string
  snippet: {
    title: string
    description: string
    publishedAt: string
    country?: string
    customUrl?: string
  }
  statistics: {
    subscriberCount?: string
    videoCount?: string
    viewCount?: string
    hiddenSubscriberCount?: boolean
  }
  brandingSettings?: {
    channel?: { keywords?: string }
  }
  topicDetails?: {
    topicCategories?: string[]
  }
}

// All channels.list calls use this part string — same 1 quota unit, richer data.
const CH_PARTS = 'snippet,statistics,brandingSettings,topicDetails'

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let lang = 'ru'
  let userHasKey = false
  let plan = 'free'
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { channel?: string; lang?: string; ui_lang?: string }
    const channelInput = body.channel?.trim() ?? ''
    lang = body.ui_lang ?? body.lang ?? 'ru'
    if (!channelInput) return NextResponse.json({ ok: false, error: 'Введите канал' }, { status: 400 })

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

    console.log(`[channel] start input="${channelInput}" lang=${lang}`)

    // v5: deep scan (playlistItems+videos.list up to 200), deep_videos + deep_stats
    const cacheKey = channelInput.toLowerCase().replace(/\s+/g, '-') + `|${lang}|v5`

    // ── Cache check ──────────────────────────────────────────────────────────
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'channel')
        .eq('cache_key', cacheKey)
        .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        .maybeSingle()
      if (cached) {
        console.log('[channel] cache hit')
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'channel')
            .eq('query', channelInput)
            .gte('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
            .maybeSingle()
          if (!existing) {
            const { data: old } = await svc
              .from('analytics_reports')
              .select('id')
              .eq('user_id', user.id)
              .eq('report_type', 'channel')
              .order('created_at', { ascending: true })
            if ((old?.length ?? 0) >= 20) await svc.from('analytics_reports').delete().eq('id', old![0].id)
            const cachedName = (cached.result as { channel_name?: string })?.channel_name ?? channelInput
            await svc.from('analytics_reports').insert({
              user_id: user.id, report_type: 'channel',
              title: `Канал: ${cachedName}`, query: channelInput, result: cached.result,
            })
          }
        } catch (saveEx) {
          console.warn('[channel] cache-hit report save failed:', saveEx instanceof Error ? saveEx.message : String(saveEx))
        }
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[channel] cache check skipped:', e instanceof Error ? e.message : String(e))
    }

    const actualCost = cost(CREDIT_COSTS.channel_analysis)
    const check = await requireCreditsAmount(user.id, actualCost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // ── Step 1: channels.list — 1 quota unit (same price regardless of parts) ─
    let quotaUsed = 0
    let channelId: string
    let ch: ChItem | undefined

    const ref = detectChannelInput(channelInput)

    if (ref.type === 'handle') {
      console.log(`[channel] step 1: @${ref.handle} → /channels?forHandle (1 unit)`)
      const res = await ytf('/channels', { part: CH_PARTS, forHandle: ref.handle }) as { items?: ChItem[] }
      quotaUsed += 1
      ch = res.items?.[0]
      if (!ch) return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })
      channelId = ch.id

    } else if (ref.type === 'id') {
      console.log(`[channel] step 1: id=${ref.channelId} → /channels?id (1 unit)`)
      const res = await ytf('/channels', { part: CH_PARTS, id: ref.channelId }) as { items?: ChItem[] }
      quotaUsed += 1
      ch = res.items?.[0]
      if (!ch) return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })
      channelId = ch.id

    } else {
      console.log(`[channel] step 1: text search "${ref.query}" → /search (100 units)`)
      const sr = await ytf('/search', { part: 'snippet', type: 'channel', q: ref.query, maxResults: '1' }) as { items?: Array<{ id: { channelId: string } }> }
      quotaUsed += 100
      channelId = sr.items?.[0]?.id?.channelId ?? ''
      if (!channelId) return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })

      console.log(`[channel] step 2: /channels?id (1 unit)`)
      const cr = await ytf('/channels', { part: CH_PARTS, id: channelId }) as { items?: ChItem[] }
      quotaUsed += 1
      ch = cr.items?.[0]
      if (!ch) return NextResponse.json({ ok: false, error: 'Данные канала не найдены' }, { status: 404 })
    }

    const rawSubs = parseInt(ch.statistics.subscriberCount ?? '0')
    const channelData = {
      name:              ch.snippet.title,
      description:       ch.snippet.description?.slice(0, 500) ?? '',
      subscribers:       rawSubs,
      subscribers_display: fmtSubscribers(rawSubs),
      total_videos:      parseInt(ch.statistics.videoCount ?? '0'),
      total_views:       parseInt(ch.statistics.viewCount ?? '0'),
      created_at:        ch.snippet.publishedAt ?? '',
      country:           ch.snippet.country ?? '',
      seo_tags:          ch.brandingSettings?.channel?.keywords ?? '',
      topic_category:    extractTopicCategories(ch.topicDetails?.topicCategories),
    }
    console.log(`[channel] name="${channelData.name}" subs=${channelData.subscribers} total_quota=${quotaUsed}`)

    // ── Steps 2+3: UULP RSS (0 units) + UULF deep scan via API ──────────────
    console.log('[channel] step 2: UULP RSS + UULF playlistItems deep scan')
    const bare = channelId.replace(/^UC/, '')

    // Parallel: popular RSS (0 units) + first UULF playlist page (1 unit)
    type PIItem = { snippet?: { title?: string; resourceId?: { videoId?: string } }; contentDetails?: { videoPublishedAt?: string } }
    type PIPage = { items?: PIItem[]; nextPageToken?: string }
    type VItem  = { id: string; snippet?: { title?: string; publishedAt?: string; tags?: string[]; thumbnails?: { maxres?: { url?: string }; high?: { url?: string }; medium?: { url?: string } } }; contentDetails?: { duration?: string; caption?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }

    const [rssPopular, pi1Raw] = await Promise.all([
      fetchChannelFeed(channelId, 'popular'),
      ytf('/playlistItems', { part: 'snippet,contentDetails', playlistId: `UULF${bare}`, maxResults: '50' }),
    ])
    const pi1 = pi1Raw as PIPage
    quotaUsed += 1

    const allPlaylistItems: PIItem[] = [...(pi1.items ?? [])]
    let piNextToken = pi1.nextPageToken
    while (piNextToken && allPlaylistItems.length < 200) {
      const pg = await ytf('/playlistItems', { part: 'snippet,contentDetails', playlistId: `UULF${bare}`, maxResults: '50', pageToken: piNextToken }) as PIPage
      quotaUsed += 1
      allPlaylistItems.push(...(pg.items ?? []))
      piNextToken = pg.nextPageToken
    }
    console.log(`[channel] UULF playlist: ${allPlaylistItems.length} videos total_quota=${quotaUsed}`)

    let deepVideos: DeepVideoItem[] = []
    let shortsOnly = false

    if (allPlaylistItems.length > 0) {
      // Batch videos.list for all collected IDs (50 per call, in parallel)
      const videoIds = allPlaylistItems.slice(0, 200).map(i => i.snippet?.resourceId?.videoId ?? '').filter(Boolean)
      const batches: string[][] = []
      for (let i = 0; i < videoIds.length; i += 50) batches.push(videoIds.slice(i, i + 50))

      const batchResults = await Promise.all(batches.map(ids =>
        ytf('/videos', { part: 'snippet,contentDetails,statistics', id: ids.join(','), maxResults: '50' })
      )) as Array<{ items?: VItem[] }>
      quotaUsed += batches.length
      console.log(`[channel] videos.list: ${batches.length} batches total_quota=${quotaUsed}`)

      deepVideos = batchResults.flatMap(r => r.items ?? []).map(v => ({
        title:        v.snippet?.title ?? '',
        views:        parseInt(v.statistics?.viewCount  ?? '0'),
        likes:        parseInt(v.statistics?.likeCount  ?? '0'),
        comments:     parseInt(v.statistics?.commentCount ?? '0'),
        published:    v.snippet?.publishedAt ?? '',
        duration:     v.contentDetails?.duration ?? '',
        duration_sec: parseDurationSec(v.contentDetails?.duration ?? ''),
        tags:         v.snippet?.tags ?? [],
        caption:      v.contentDetails?.caption === 'true',
        url:          `https://youtube.com/watch?v=${v.id}`,
        thumbnail:    v.snippet?.thumbnails?.maxres?.url ?? v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url ?? '',
      }))
      deepVideos.sort((a, b) => a.published.localeCompare(b.published))  // oldest → newest

    } else {
      // Shorts-only fallback: UU RSS (0 units)
      console.log('[channel] UULF empty — shorts-only fallback to RSS')
      const rssAll = await fetchChannelFeed(channelId, 'all')
      if (rssAll.length > 0) {
        shortsOnly = rssAll.every(v => v.isShort)
        deepVideos = rssAll
          .sort((a, b) => a.published.getTime() - b.published.getTime())
          .map(v => ({
            title: v.title, views: v.views, likes: v.likes, comments: 0,
            published: v.published.toISOString(), duration: '', duration_sec: 0,
            tags: [], caption: false, url: v.url, thumbnail: v.thumbnail,
          }))
      }
    }

    // ── Metrics — from deep scan (up to 200 videos) ───────────────────────────
    const avgViewsLong  = deepVideos.length > 0
      ? Math.round(deepVideos.reduce((s, v) => s + v.views, 0) / deepVideos.length)
      : 0
    const medianViews   = medianOf(deepVideos.map(v => v.views))
    const engagementPct = avgEngagementRate(deepVideos)
    const postsPerWeek  = allPlaylistItems.length > 0 && deepVideos.length > 1
      ? longsPerWeek(deepVideos.map(v => ({ published: new Date(v.published) })))
      : 0
    const deepStats     = computeDeepStats(deepVideos)

    // Oldest → newest (already sorted above)
    const chronoLong = deepVideos

    // ── Claude context ────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const lines: string[] = [
      `Канал: "${channelData.name}", ${channelData.subscribers_display} подписчиков, ${channelData.total_videos} видео, ${fmtN(channelData.total_views)} просмотров.`,
    ]
    if (channelData.created_at)    lines.push(`Создан: ${channelData.created_at.slice(0, 10)}.`)
    if (channelData.topic_category) lines.push(`Категория: ${channelData.topic_category}.`)
    if (channelData.seo_tags)       lines.push(`SEO-теги: ${channelData.seo_tags.slice(0, 200)}.`)
    if (shortsOnly) lines.push('ВАЖНО: У канала нет длинных роликов — он публикует только шортсы (Shorts). Учитывай это при анализе форматов и частоты публикаций.')
    lines.push(`Средние просмотры: ${fmtN(avgViewsLong)}, медиана: ${fmtN(medianViews)}, вовлечённость: ${engagementPct}%, частота: ${postsPerWeek} длинных/нед.`)

    if (deepStats) {
      const avgMin = Math.round(deepStats.avg_duration_sec / 60)
      const medMin = Math.round(deepStats.median_duration_sec / 60)
      lines.push(`Длина роликов: ср. ${avgMin} мин, медиана ${medMin} мин.`)
      lines.push(`Субтитры: ${deepStats.caption_pct}% роликов.`)
      lines.push(`Вовлечённость (лайки+комменты/просмотры): ${deepStats.avg_engagement_rate}%.`)
      if (deepStats.top_tags.length > 0) {
        lines.push(`Топ теги: ${deepStats.top_tags.slice(0, 10).map(([t, c]) => `${t}(${c})`).join(', ')}.`)
      }
      if (deepStats.yearly.length > 0) {
        lines.push(`По годам: ${deepStats.yearly.map(y => `${y.year}: ${y.count} вид., ср. ${fmtN(y.avg_views)}`).join('; ')}.`)
      }
    }

    if (chronoLong.length > 0) {
      const oldest5 = chronoLong.slice(0, 5)
      const newest5 = chronoLong.slice(-5)
      const sample  = chronoLong.length <= 10 ? chronoLong : [...oldest5, ...newest5]
      lines.push('')
      lines.push(`${shortsOnly ? 'Шортсы' : 'Ролики'} (первые и последние из ${chronoLong.length}, от старых к новым):`)
      lines.push(JSON.stringify(sample.map(v => ({ title: v.title, date: v.published.slice(0, 10), views: v.views, likes: v.likes }))))
    }
    if (rssPopular.length > 0) {
      lines.push('')
      lines.push('Топ видео всех времён:')
      lines.push(JSON.stringify(rssPopular.slice(0, 5).map(v => ({ title: v.title, views: v.views }))))
    }
    const dataCtx = lines.join('\n')

    // ── Claude msg1: overview ─────────────────────────────────────────────────
    console.log('[channel] step 3a: claude overview')
    const msg1 = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 900,
      system:   [{ type: 'text', text: getChannelPrompt1(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataCtx }],
    })
    console.log('[channel] msg1 input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0)
    if (msg1.stop_reason === 'max_tokens') console.warn('[channel] claude1 truncated')
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

    // ── Claude msg2: formats + recommendations ────────────────────────────────
    console.log('[channel] step 3b: claude formats')
    const msg2 = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 900,
      system:   [{ type: 'text', text: getChannelPrompt2(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${dataCtx}\n\nОпредели форматы и дай рекомендации.` }],
    })
    console.log('[channel] msg2 input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0)
    if (msg2.stop_reason === 'max_tokens') console.warn('[channel] claude2 truncated')
    const text2 = (msg2.content[0] as { text: string }).text

    interface Formats {
      best_formats: Array<{ name: string; avg_views: number; example?: string } | string>
      worst_formats: Array<{ name: string; avg_views: number } | string>
      recommendations: string[]
    }
    const formats = parseClaudeJson<Formats>(text2, 'claude2')

    console.log(`[channel] total quota used: ${quotaUsed} units`)

    // ── Merge analysis ────────────────────────────────────────────────────────
    const topByViews     = [...deepVideos].sort((a, b) => b.views - a.views)
    const top5Long       = topByViews.slice(0, 5).map(v => ({ title: v.title, views: v.views, url: v.url }))
    const worst3Long     = topByViews.slice(-3).reverse().map(v => ({ title: v.title, views: v.views, url: v.url }))
    const top5Alltime    = rssPopular.slice(0, 5).map(v => ({ title: v.title, views: v.views, url: v.url, thumbnail: v.thumbnail }))
    // Recent 15 for backward-compat UI block (newest first)
    const recent15       = [...deepVideos].reverse().slice(0, 15)

    const analysis = {
      // ── Existing fields (UI contract — unchanged) ──────────────────────────
      channel_name: channelData.name,
      overview: {
        subscribers:         channelData.subscribers,
        subscribers_display: channelData.subscribers_display,
        total_views:         channelData.total_views,
        total_videos:        channelData.total_videos,
        avg_views:           avgViewsLong,
        median_views:        medianViews,
        upload_frequency:    overview.upload_frequency ?? '',
        engagement_rate:     engagementPct,
        longs_per_week:      postsPerWeek,
        country:             channelData.country,
        created_at:          channelData.created_at.slice(0, 10),
        seo_tags:            channelData.seo_tags,
        topic_category:      channelData.topic_category,
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
      best_topics:     overview.best_topics   ?? [],
      worst_topics:    overview.worst_topics  ?? [],
      strengths:       overview.strengths     ?? [],
      weaknesses:      overview.weaknesses    ?? [],
      recommendations: formats.recommendations ?? [],
      top_videos:      top5Long,
      worst_videos:    worst3Long,
      // ── New fields ─────────────────────────────────────────────────────────
      top_videos_alltime: top5Alltime,
      recent_videos: recent15.map(v => ({
        title: v.title, views: v.views, likes: v.likes,
        published: v.published,
        isShort: false, url: v.url, thumbnail: v.thumbnail || undefined,
      })),
      // ── Deep scan fields (v5) ──────────────────────────────────────────────
      deep_videos: deepVideos.map(v => ({
        title: v.title, views: v.views, likes: v.likes, comments: v.comments,
        published: v.published, duration: v.duration, duration_sec: v.duration_sec,
        tags: v.tags, caption: v.caption, url: v.url,
        thumbnail: v.thumbnail || undefined,
      })),
      deep_stats: deepStats,
    }

    console.log('[channel] analysis merged ok')

    await spendCredits(user.id, actualCost, 'channel_analysis')

    // ── Write cache ───────────────────────────────────────────────────────────
    try {
      await svc.from('analytics_cache').upsert({
        cache_type: 'channel',
        cache_key:  cacheKey,
        result:     analysis,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[channel] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    // ── Save to reports history ───────────────────────────────────────────────
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'channel')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) await svc.from('analytics_reports').delete().eq('id', old![0].id)
      await svc.from('analytics_reports').insert({
        user_id: user.id, report_type: 'channel',
        title: `Канал: ${channelData.name}`, query: channelInput, result: analysis,
      })
    } catch (e) {
      console.warn('[channel] report save failed:', e instanceof Error ? e.message : String(e))
    }

    // ── Cleanup stale cache ───────────────────────────────────────────────────
    try {
      await svc.from('analytics_cache').delete()
        .lt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[channel] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: analysis, cached: false })

  } catch (error) {
    if (error instanceof YouTubeQuotaError) {
      return (userHasKey && plan === 'free') ? byokQuotaResponse(lang) : quotaExceededResponse(lang)
    }
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/channel] fatal error:', msg)
    if (isYouTubeKeyError(msg)) return youTubeKeyErrorResponse(lang)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/analytics/channel').catch(() => {})
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}
