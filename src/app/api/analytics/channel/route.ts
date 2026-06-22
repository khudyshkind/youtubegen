import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

const CHANNEL_SYSTEM_PROMPT_1 = `Ты опытный YouTube аналитик, специализирующийся на углублённом анализе каналов. На основе данных канала (подписчики, видео, просмотры) и топ видео определи ключевые характеристики канала.

МЕТОДОЛОГИЯ АНАЛИЗА:
• upload_frequency — частота публикаций (оцени по количеству видео и возрасту канала)
• growth_trend — "Растёт" / "Стабильно" / "Снижается" (оцени по соотношению просмотров к подписчикам)
• best_topics — топ 3 темы, которые работают лучше всего (определи по названиям и просмотрам топ видео)
• worst_topics — 2 темы, которые уступают другим по показателям
• strengths — 3 конкретные сильные стороны канала на основе данных
• weaknesses — 2 конкретные слабые стороны

ВАЖНО: Основывай анализ ТОЛЬКО на реальных данных из запроса. Не придумывай числа и факты, которых нет в данных.

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"upload_frequency":"X видео в неделю","growth_trend":"Растёт","best_topics":["Тема 1","Тема 2","Тема 3"],"worst_topics":["Слабая тема 1","Слабая тема 2"],"strengths":["Сила 1","Сила 2","Сила 3"],"weaknesses":["Слабость 1","Слабость 2"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких блоков \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`

const CHANNEL_SYSTEM_PROMPT_2 = `Ты опытный YouTube аналитик, специализирующийся на определении форматов видео и разработке стратегий роста каналов. На основе данных канала и топ видео определи какие форматы работают и дай практические рекомендации.

МЕТОДОЛОГИЯ ОПРЕДЕЛЕНИЯ ФОРМАТОВ:
• Анализируй названия топ видео для определения форматов: тест-драйвы, обзоры, сравнения, топы, how-to, разборы, истории
• best_formats — топ 2-3 формата с наибольшими средними просмотрами
• worst_formats — 1-2 формата с наименьшими просмотрами
• avg_views — среднее количество просмотров для видео в этом формате (оцени из данных)

РЕКОМЕНДАЦИИ:
• 3 конкретных совета что изменить или улучшить
• Основывай на реальных данных — слабых сторонах и возможностях канала
• Конкретные действия, а не общие советы типа "публикуй чаще"

ВАЖНО: НЕ включай поле "example" с конкретными названиями видео — заголовки видео в JSON вызывают проблемы с экранированием.

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"best_formats":[{"name":"Тест-драйвы","avg_views":450000},{"name":"Обзоры","avg_views":280000}],"worst_formats":[{"name":"Слабый формат","avg_views":5000}],"recommendations":["Конкретная рекомендация 1","Рекомендация 2","Рекомендация 3"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких блоков \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`

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

    const body = await req.json() as { channel?: string; lang?: string }
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
      model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
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
