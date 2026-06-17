import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function parseClaudeJson<T>(text: string, label: string): T {
  console.log(`[niche] ${label} raw:`, text.substring(0, 500))
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  // Find first { to last matching }
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
  console.log(`[niche] yt ${path} status=${res.status} body=${text.slice(0, 300)}`)
  if (!res.ok) throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
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

    console.log(`[niche] start topic="${topic}" country=${country} lang=${lang}`)
    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const svc = createServiceClient()
    const key = cacheKey(topic, country, lang)

    // Cache check — non-fatal
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'niche')
        .eq('cache_key', key)
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .single()
      if (cached) {
        console.log('[niche] cache hit, saving report for user:', user.id)
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'niche')
            .eq('query', topic)
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle()
          if (!existing) {
            const { data: old } = await svc
              .from('analytics_reports')
              .select('id')
              .eq('user_id', user.id)
              .eq('report_type', 'niche')
              .order('created_at', { ascending: true })
            if ((old?.length ?? 0) >= 20) {
              await svc.from('analytics_reports').delete().eq('id', old![0].id)
            }
            const { error: saveErr } = await svc.from('analytics_reports').insert({
              user_id: user.id,
              report_type: 'niche',
              title: `Анализ ниши: ${topic}`,
              query: topic,
              result: cached.result,
            })
            console.log('[niche] cache-hit save result:', saveErr?.message ?? 'ok')
          } else {
            console.log('[niche] cache-hit: report already saved today, skip')
          }
        } catch (saveEx) {
          console.warn('[niche] cache-hit report save failed:', saveEx instanceof Error ? saveEx.message : String(saveEx))
        }
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[niche] cache check skipped:', e instanceof Error ? e.message : String(e))
    }

    const check = await requireCredits(user.id, 'niche_analysis', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // ── YouTube data ──────────────────────────────────────────────────────────

    console.log('[niche] step 1: search channels')
    const channelSearch = await ytFetch('/search', {
      part: 'snippet', type: 'channel', q: topic,
      maxResults: '10', relevanceLanguage: lang, regionCode: country,
    }) as { items?: Array<{ id: { channelId: string } }> }

    const channelIds = (channelSearch.items ?? []).map(i => i.id.channelId).filter(Boolean).join(',')
    console.log(`[niche] channel ids: ${channelIds.slice(0, 80)}`)

    let channelsData: Array<{ name: string; subscribers: number; videos: number; views: number }> = []
    if (channelIds) {
      console.log('[niche] step 2: channel stats')
      const statsRes = await ytFetch('/channels', {
        part: 'statistics,snippet', id: channelIds,
      }) as { items?: Array<{ snippet: { title: string }; statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string } }> }
      channelsData = (statsRes.items ?? []).map(ch => ({
        name: ch.snippet.title,
        subscribers: parseInt(ch.statistics.subscriberCount ?? '0'),
        videos: parseInt(ch.statistics.videoCount ?? '0'),
        views: parseInt(ch.statistics.viewCount ?? '0'),
      }))
      console.log(`[niche] channels: ${channelsData.length}`)
    }

    console.log('[niche] step 3: search videos')
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', type: 'video', q: topic,
      order: 'viewCount', publishedAfter: oneYearAgo,
      maxResults: '10', relevanceLanguage: lang, regionCode: country,
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string } }> }

    const videoIds = (videoSearch.items ?? []).map(v => v.id.videoId).filter(Boolean).join(',')
    console.log(`[niche] video ids: ${videoIds.slice(0, 80)}`)

    let videosData: Array<{ title: string; views: number; channel: string; url: string }> = []
    if (videoIds) {
      console.log('[niche] step 4: video stats')
      const vStats = await ytFetch('/videos', {
        part: 'statistics,snippet', id: videoIds,
      }) as { items?: Array<{ id: string; snippet: { title: string; channelTitle: string; publishedAt: string }; statistics: { viewCount?: string } }> }
      videosData = (vStats.items ?? []).map(v => ({
        title: v.snippet.title,
        views: parseInt(v.statistics.viewCount ?? '0'),
        channel: v.snippet.channelTitle,
        url: `https://youtube.com/watch?v=${v.id}`,
      })).sort((a, b) => b.views - a.views)
      console.log(`[niche] videos: ${videosData.length}`)
    }

    // ── Claude: two small requests ────────────────────────────────────────────

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const dataCtx = `Топ каналы: ${JSON.stringify(channelsData.slice(0, 5))}
Топ видео: ${JSON.stringify(videosData.slice(0, 5))}
Язык: ${lang}, Страна: ${country}`

    // Request 1 — metrics
    console.log('[niche] step 5a: claude metrics')
    const prompt1 = `Ты YouTube аналитик. Ниша: "${topic}".
${dataCtx}

Верни JSON СТРОГО в этом формате, только JSON, никакого текста до или после:
{"competition_score":7,"competition_level":"Высокая","competition_reason":"коротко почему","trend":"Растёт","growth":"+23%","trend_reason":"коротко почему","rpm_min":1.5,"rpm_max":3.0,"monetization_1_video":"18-24 мес","monetization_2_videos":"10-14 мес","monetization_3_videos":"7-10 мес"}`

    const msg1 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt1 }],
    })
    const text1 = (msg1.content[0] as { text: string }).text

    interface Metrics {
      competition_score: number
      competition_level: string
      competition_reason: string
      trend: string
      growth: string
      trend_reason: string
      rpm_min: number
      rpm_max: number
      monetization_1_video: string
      monetization_2_videos: string
      monetization_3_videos: string
    }
    const metrics = parseClaudeJson<Metrics>(text1, 'claude1')

    // Request 2 — recommendations + formats with real avg_views
    console.log('[niche] step 5b: claude recommendations')
    const prompt2 = `Ты YouTube аналитик. Ниша: "${topic}".
${dataCtx}

Определи топ форматы на основе РЕАЛЬНЫХ видео выше. Для каждого формата укажи среднее количество просмотров из предоставленных данных.
Верни JSON СТРОГО в этом формате, только JSON, никакого текста до или после:
{"subniches":["Подниша 1","Подниша 2","Подниша 3"],"subniches_competition":["Низкая","Средняя","Низкая"],"top_formats":[{"name":"Тест-драйвы","avg_views":450000},{"name":"Обзоры","avg_views":280000},{"name":"Сравнения","avg_views":150000}],"best_days":["Вторник","Четверг"],"best_hours":"18:00-20:00","recommendations":["Совет 1","Совет 2","Совет 3"]}`

    const msg2 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt2 }],
    })
    const text2 = (msg2.content[0] as { text: string }).text

    interface Recs {
      subniches: string[]
      subniches_competition: string[]
      top_formats: Array<{ name: string; avg_views: number } | string>
      best_days: string[]
      best_hours: string
      recommendations: string[]
    }
    const recs = parseClaudeJson<Recs>(text2, 'claude2')

    // ── Merge into final shape ────────────────────────────────────────────────

    const analysis = {
      competition: {
        score: metrics.competition_score,
        level: metrics.competition_level,
        reason: metrics.competition_reason,
      },
      potential: {
        trend: metrics.trend,
        growth: metrics.growth,
        reason: metrics.trend_reason,
      },
      rpm: { min: metrics.rpm_min, max: metrics.rpm_max, currency: 'USD' },
      subniches: (recs.subniches ?? []).map((name, i) => ({
        name,
        competition: recs.subniches_competition?.[i] ?? 'Средняя',
        potential: 'Высокий',
      })),
      monetization: {
        videos_per_week_1: metrics.monetization_1_video,
        videos_per_week_2: metrics.monetization_2_videos,
        videos_per_week_3: metrics.monetization_3_videos,
      },
      best_time: { days: recs.best_days ?? [], hours: recs.best_hours ?? '' },
      top_formats: (recs.top_formats ?? []).map(f =>
        typeof f === 'string' ? { name: f, avg_views: 0 } : { name: f.name, avg_views: f.avg_views ?? 0 }
      ),
      top_channels: channelsData.slice(0, 5).map(c => ({
        name: c.name,
        subscribers: c.subscribers,
        videos: c.videos,
        avg_views: c.videos > 0 ? Math.round(c.views / c.videos) : 0,
      })),
      top_videos: videosData.slice(0, 5),
      recommendations: recs.recommendations ?? [],
    }

    console.log('[niche] analysis merged ok')

    await spendCredits(user.id, 10, 'niche_analysis')

    try {
      await svc.from('analytics_cache').upsert({
        cache_type: 'niche',
        cache_key: key,
        result: analysis,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[niche] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    // Save to reports history (non-fatal)
    console.log('[niche] saving report for user:', user.id)
    try {
      const { data: old, error: oldErr } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'niche')
        .order('created_at', { ascending: true })
      console.log('[niche] existing reports count:', old?.length ?? 0, 'fetchErr:', oldErr?.message ?? 'none')
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      const { error: saveError } = await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'niche',
        title: `Анализ ниши: ${topic}`,
        query: topic,
        result: analysis,
      })
      console.log('[niche] save result:', saveError?.message ?? 'ok')
    } catch (e) {
      console.warn('[niche] report save failed:', e instanceof Error ? e.message : String(e))
    }

    // Cleanup stale cache (non-fatal)
    try {
      await svc.from('analytics_cache')
        .delete()
        .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[niche] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/niche] fatal error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа: ${msg}` }, { status: 500 })
  }
}
