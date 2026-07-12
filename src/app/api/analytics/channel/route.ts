import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { YouTubeQuotaError, checkYouTubeQuota, quotaExceededResponse } from '@/lib/youtube-quota'
import { checkAnalyticsGate } from '@/lib/analytics-gate'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function getChannelPrompt1(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик, специализирующийся на углублённом анализе каналов. На основе данных канала (подписчики, видео, просмотры) и топ видео определи ключевые характеристики канала.

МЕТОДОЛОГИЯ АНАЛИЗА:
• upload_frequency — частота публикаций (оцени по количеству видео и возрасту канала)
• growth_trend — "Растёт" / "Стабильно" / "Снижается" (оцени по соотношению просмотров к подписчикам)
• best_topics — топ 3 темы, которые работают лучше всего (определи по названиям и просмотрам топ видео)
• worst_topics — 2 темы, которые уступают другим по показателям
• strengths — 3 конкретные сильные стороны канала на основе данных
• weaknesses — 2 конкретные слабые стороны

ВАЖНО: Основывай анализ ТОЛЬКО на реальных данных. Не придумывай числа и факты, которых нет в данных.

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"upload_frequency":"2 видео в неделю","growth_trend":"Растёт","best_topics":["Тест-драйвы новинок","Сравнение моделей","Советы при покупке"],"worst_topics":["Влоги с выставок","Видео о тюнинге"],"strengths":["Стабильный график публикаций — 2 видео в неделю","Высокий CTR на сравнительных видео","Экспертная подача без воды"],"weaknesses":["Слабые миниатюры на роликах о б/у авто","Нет коротких форматов — Shorts отсутствуют"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких блоков \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube channel analyst. Based on channel data (subscribers, videos, views) and top videos, identify key channel characteristics.

ANALYSIS METHODOLOGY:
• upload_frequency — upload frequency (estimate from video count and channel age)
• growth_trend — "Growing" / "Stable" / "Declining" (estimate from views-to-subscribers ratio)
• best_topics — top 3 topics performing best (from video titles and view counts)
• worst_topics — 2 topics underperforming relative to others
• strengths — 3 specific channel strengths based on data
• weaknesses — 2 specific weaknesses

IMPORTANT: Base analysis ONLY on actual data provided. Do not invent numbers or facts not in the data.

RESPONSE FORMAT — strict JSON without markdown:
{"upload_frequency":"2 videos per week","growth_trend":"Growing","best_topics":["New Model Test Drives","Car Comparisons","Buying Advice"],"worst_topics":["Auto Show Vlogs","Tuning Videos"],"strengths":["Consistent 2-video-per-week schedule","High CTR on comparison videos","Expert delivery without filler"],"weaknesses":["Weak thumbnails on used car videos","No short-form content — Shorts absent"]}

IMPORTANT: Return ONLY valid JSON. All text values must be in English. No \`\`\`json blocks. No explanations. Start with { end with }.`
}

function getChannelPrompt2(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик, специализирующийся на определении форматов видео и разработке стратегий роста каналов. На основе данных канала и топ видео определи какие форматы работают и дай практические рекомендации.

МЕТОДОЛОГИЯ ОПРЕДЕЛЕНИЯ ФОРМАТОВ:
• Анализируй названия топ видео для определения форматов: тест-драйвы, обзоры, сравнения, топы, how-to, разборы, истории
• best_formats — топ 2-3 формата с наибольшими средними просмотрами
• worst_formats — 1-2 формата с наименьшими просмотрами
• avg_views — среднее количество просмотров для видео в этом формате

РЕКОМЕНДАЦИИ: 3 конкретных совета что изменить или улучшить. Основывай на реальных данных. Конкретные действия, а не общие советы.

ВАЖНО: НЕ включай поле "example" с конкретными названиями видео.

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"best_formats":[{"name":"Тест-драйвы","avg_views":450000},{"name":"Обзоры","avg_views":280000}],"worst_formats":[{"name":"Влоги за кулисами","avg_views":5000}],"recommendations":["Сосредоточьтесь на тест-драйвах — они дают в 3 раза больше просмотров чем остальные форматы на этом канале","Добавляйте временны́е метки в описание: зрители активно используют их и это улучшает удержание","Снимайте сравнительные видео в формате X vs Y — они хорошо работают в данной нише и на канале их пока нет"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких блоков \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube analyst specializing in video format identification and channel growth strategies. Based on channel data and top videos, identify which formats work and provide practical recommendations.

FORMAT METHODOLOGY:
• Analyze top video titles to identify formats: test drives, reviews, comparisons, top lists, how-to, breakdowns, stories
• best_formats — top 2-3 formats with highest average views
• worst_formats — 1-2 formats with lowest average views
• avg_views — estimated average view count for videos in this format

RECOMMENDATIONS: 3 specific actionable tips to change or improve. Base on real data. Specific actions, not generic advice.

IMPORTANT: Do NOT include an "example" field with specific video titles.

RESPONSE FORMAT — strict JSON without markdown:
{"best_formats":[{"name":"Test Drives","avg_views":450000},{"name":"Reviews","avg_views":280000}],"worst_formats":[{"name":"Behind-the-Scenes Vlogs","avg_views":5000}],"recommendations":["Focus on test drives — they get 3x more views than other formats on this channel","Add timestamps to descriptions: viewers use them heavily and it improves watch time retention","Film X vs Y comparison videos — they perform well in this niche and the channel has none yet"]}

IMPORTANT: Return ONLY valid JSON. All text values must be in English. No \`\`\`json blocks. No explanations. Start with { end with }.`
}


async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const key = env('YOUTUBE_API_KEY')
  const qs = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  console.log(`[channel] yt ${path} status=${res.status} body=${text.slice(0, 300)}`)
  if (!res.ok) {
    checkYouTubeQuota(res.status, text)
    throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

import { detectChannelInput } from '@/lib/youtube-channel'

export async function POST(req: NextRequest) {
  let lang = 'ru'
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { channel?: string; lang?: string; ui_lang?: string }
    const channelInput = body.channel?.trim() ?? ''
    lang = body.ui_lang ?? body.lang ?? 'ru'
    if (!channelInput) return NextResponse.json({ ok: false, error: 'Введите канал' }, { status: 400 })

    const gateRes = await checkAnalyticsGate(user.id, supabase, lang)
    if (gateRes) return gateRes

    console.log(`[channel] start input="${channelInput}" lang=${lang}`)

    const svc = createServiceClient()
    const cacheKey = channelInput.toLowerCase().replace(/\s+/g, '-') + `|${lang}|v2`

    // Cache check — non-fatal
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'channel')
        .eq('cache_key', cacheKey)
        .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        .maybeSingle()
      if (cached) {
        console.log('[channel] cache hit, saving report for user:', user.id)
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
    let quotaUsed = 0

    type ChItem = { id: string; snippet: { title: string; description: string; publishedAt: string }; statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string } }
    let channelId: string
    let ch: ChItem | undefined

    const ref = detectChannelInput(channelInput)

    if (ref.type === 'handle') {
      console.log(`[channel] step 1: handle @${ref.handle} → /channels?forHandle (1 quota unit)`)
      const res = await ytFetch('/channels', {
        part: 'statistics,snippet', forHandle: ref.handle,
      }) as { items?: ChItem[] }
      quotaUsed += 1
      ch = res.items?.[0]
      if (!ch) return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })
      channelId = ch.id

    } else if (ref.type === 'id') {
      console.log(`[channel] step 1: direct id ${ref.channelId} → /channels?id (1 quota unit)`)
      const res = await ytFetch('/channels', {
        part: 'statistics,snippet', id: ref.channelId,
      }) as { items?: ChItem[] }
      quotaUsed += 1
      ch = res.items?.[0]
      if (!ch) return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })
      channelId = ch.id

    } else {
      console.log(`[channel] step 1: text search "${ref.query}" → /search (100 quota units)`)
      const channelSearch = await ytFetch('/search', {
        part: 'snippet', type: 'channel', q: ref.query, maxResults: '1',
      }) as { items?: Array<{ id: { channelId: string }; snippet: { title: string } }> }
      quotaUsed += 100
      channelId = channelSearch.items?.[0]?.id?.channelId ?? ''
      if (!channelId) return NextResponse.json({ ok: false, error: 'Канал не найден' }, { status: 404 })

      console.log(`[channel] channel id: ${channelId} | step 2: channel stats (1 quota unit)`)
      const channelStats = await ytFetch('/channels', {
        part: 'statistics,snippet', id: channelId,
      }) as { items?: ChItem[] }
      quotaUsed += 1
      ch = channelStats.items?.[0]
      if (!ch) return NextResponse.json({ ok: false, error: 'Данные канала не найдены' }, { status: 404 })
    }

    console.log(`[channel] channel id: ${channelId}`)

    const channelData = {
      name: ch.snippet.title,
      description: ch.snippet.description?.slice(0, 500),
      subscribers: parseInt(ch.statistics.subscriberCount ?? '0'),
      total_videos: parseInt(ch.statistics.videoCount ?? '0'),
      total_views: parseInt(ch.statistics.viewCount ?? '0'),
      created_at: ch.snippet.publishedAt,
    }
    console.log(`[channel] name="${channelData.name}" subs=${channelData.subscribers}`)

    console.log('[channel] step 3: last 50 videos (100 quota units)')
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', channelId,
      order: 'date', maxResults: '50', type: 'video',
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; publishedAt: string } }> }
    quotaUsed += 100

    const videoItems = videoSearch.items ?? []
    const videoIds = videoItems.map(v => v.id.videoId).filter(Boolean).join(',')
    console.log(`[channel] videos found: ${videoItems.length}`)

    let videosData: Array<{ title: string; views: number; url: string; publishedAt: string }> = []
    if (videoIds) {
      console.log('[channel] step 4: video stats (1 quota unit)')
      const vStats = await ytFetch('/videos', {
        part: 'statistics,snippet', id: videoIds,
      }) as { items?: Array<{ id: string; snippet: { title: string; publishedAt: string }; statistics: { viewCount?: string; likeCount?: string } }> }
      quotaUsed += 1

      videosData = (vStats.items ?? []).map(v => ({
        title: v.snippet.title,
        views: parseInt(v.statistics.viewCount ?? '0'),
        url: `https://www.youtube.com/watch?v=${v.id}`,
        publishedAt: v.snippet.publishedAt,
      })).sort((a, b) => b.views - a.views)
      console.log(`[channel] video stats count: ${videosData.length}`)
    }

    console.log(`[channel] total quota used: ${quotaUsed} units`)

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
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: [{ type: 'text', text: getChannelPrompt1(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataCtx }],
    })
    console.log('[channel] msg1 cache input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg1.usage.cache_creation_input_tokens ?? 0)
    if (msg1.stop_reason === 'max_tokens') console.warn('[channel] claude1 truncated by max_tokens')
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
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: [{ type: 'text', text: getChannelPrompt2(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${dataCtx}\n\nОпредели форматы видео и дай рекомендации.` }],
    })
    console.log('[channel] msg2 cache input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg2.usage.cache_creation_input_tokens ?? 0)
    if (msg2.stop_reason === 'max_tokens') console.warn('[channel] claude2 truncated by max_tokens')
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

    await spendCredits(user.id, CREDIT_COSTS.channel_analysis, 'channel_analysis')

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
        .lt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[channel] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    if (error instanceof YouTubeQuotaError) return quotaExceededResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/channel] fatal error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа канала: ${msg}` }, { status: 500 })
  }
}
