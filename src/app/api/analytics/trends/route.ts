import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function parseClaudeJson<T>(text: string, label: string): T {
  console.log(`[trends] ${label} raw:`, text.substring(0, 500))
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
  console.log(`[trends] yt ${path} status=${res.status} body=${text.slice(0, 300)}`)
  if (!res.ok) throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

const TRENDS_SYSTEM_PROMPT_1 = `Ты опытный YouTube аналитик, специализирующийся на выявлении трендов и вирусных тем. На основе данных о топ видео за указанный период найди 4 ключевых тренда в нише.

МЕТОДОЛОГИЯ ВЫЯВЛЕНИЯ ТРЕНДОВ:
• Тренд — тема или формат, набирающий просмотры быстрее обычного
• Анализируй: названия видео, количество просмотров, даты публикации
• Видео с большим числом просмотров и свежими датами — сильный сигнал тренда
• Ищи повторяющиеся темы и паттерны в названиях топ видео

УРОВНИ СРОЧНОСТИ:
• "Срочно" — тренд сейчас на пике, нужно снимать немедленно
• "Актуально" — тренд активен последние 1-2 недели
• "Набирает" — тренд только начинается, хорошее время для входа
• "Стабильно" — вечнозелёная тема со стабильным интересом аудитории

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"trends":[{"topic":"Конкретная тема","urgency":"Срочно","reason":"Почему вирусится"},{"topic":"Тема 2","urgency":"Актуально","reason":"Причина"},{"topic":"Тема 3","urgency":"Набирает","reason":"Причина"},{"topic":"Тема 4","urgency":"Стабильно","reason":"Причина"}]}

ТРЕБОВАНИЯ:
• Ровно 4 тренда в массиве
• topic — конкретная тема, а не абстракция
• reason — конкретная причина на основе данных видео
• Верни ТОЛЬКО валидный JSON. Никаких \`\`\`json. Начни с { и заканчивай с }.`

const TRENDS_SYSTEM_PROMPT_2 = `Ты опытный YouTube аналитик и контент-стратег. На основе списка трендов в нише сгенерируй конкретные идеи видео, которые можно снять прямо сейчас.

МЕТОДОЛОГИЯ ГЕНЕРАЦИИ ИДЕЙ:
• Для каждого тренда предложи 3 разные идеи видео
• Идеи должны быть конкретными — не "обзор темы", а "5 причин почему X лучше Y в 2026"
• Варьируй форматы: топ, разбор, сравнение, история, how-to, реакция
• Учитывай что зрители уже знают о тренде — дай им новый угол зрения
• Заголовки должны быть кликабельными и конкретными

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"video_ideas":[{"trend":"название тренда","ideas":["Конкретная идея/заголовок 1","Конкретная идея/заголовок 2","Конкретная идея/заголовок 3"]}]}

ТРЕБОВАНИЯ:
• video_ideas содержит один объект на каждый тренд из запроса
• 3 идеи на тренд
• Верни ТОЛЬКО валидный JSON. Никаких \`\`\`json. Начни с { и заканчивай с }.`

function cacheKey(topic: string, period: string, lang: string) {
  const day = new Date().toISOString().slice(0, 10)
  return `${topic.toLowerCase().trim()}|${period}|${day}|${lang}`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { topic?: string; period?: string; lang?: string }
    const topic = body.topic?.trim() ?? ''
    const period = body.period ?? 'week'
    const lang = body.lang ?? 'ru'

    console.log(`[trends] start topic="${topic}" period=${period} lang=${lang}`)
    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const svc = createServiceClient()
    const key = cacheKey(topic, period, lang)

    // Cache check — non-fatal
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'trends')
        .eq('cache_key', key)
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .single()
      if (cached) {
        console.log('[trends] cache hit, saving report for user:', user.id)
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'trends')
            .eq('query', `${topic}|${period}`)
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle()
          if (!existing) {
            const days = period === 'month' ? 30 : 7
            const { data: old } = await svc
              .from('analytics_reports')
              .select('id')
              .eq('user_id', user.id)
              .eq('report_type', 'trends')
              .order('created_at', { ascending: true })
            if ((old?.length ?? 0) >= 20) {
              await svc.from('analytics_reports').delete().eq('id', old![0].id)
            }
            const { error: saveErr } = await svc.from('analytics_reports').insert({
              user_id: user.id,
              report_type: 'trends',
              title: `Тренды: ${topic} (${days} дн.)`,
              query: `${topic}|${period}`,
              result: cached.result,
            })
            console.log('[trends] cache-hit save result:', saveErr?.message ?? 'ok')
          } else {
            console.log('[trends] cache-hit: report already saved today, skip')
          }
        } catch (saveEx) {
          console.warn('[trends] cache-hit report save failed:', saveEx instanceof Error ? saveEx.message : String(saveEx))
        }
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[trends] cache check skipped:', e instanceof Error ? e.message : String(e))
    }

    const check = await requireCredits(user.id, 'trends', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const days = period === 'month' ? 30 : 7
    const publishedAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // ── YouTube data ──────────────────────────────────────────────────────────

    console.log('[trends] step 1: search trending videos')
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', type: 'video', q: topic,
      order: 'viewCount', publishedAfter,
      maxResults: '20',
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string } }> }

    const videoItems = videoSearch.items ?? []
    console.log(`[trends] videos count: ${videoItems.length}`)
    const videoIds = videoItems.map(v => v.id.videoId).filter(Boolean).join(',')

    let videosData: Array<{ title: string; views: number; channel: string; url: string; publishedAt: string }> = []
    if (videoIds) {
      console.log('[trends] step 2: video stats')
      const vStats = await ytFetch('/videos', {
        part: 'statistics,snippet', id: videoIds,
      }) as { items?: Array<{ id: string; snippet: { title: string; channelTitle: string; publishedAt: string }; statistics: { viewCount?: string } }> }

      videosData = (vStats.items ?? []).map(v => ({
        title: v.snippet.title,
        views: parseInt(v.statistics.viewCount ?? '0'),
        channel: v.snippet.channelTitle,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        publishedAt: v.snippet.publishedAt,
      })).sort((a, b) => b.views - a.views)
      console.log(`[trends] sorted videos: ${videosData.length}`)
    }

    // ── Claude: two small requests ────────────────────────────────────────────

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const dataCtx = `Ниша: "${topic}", период: ${days} дней.
Топ видео: ${JSON.stringify(videosData.slice(0, 12).map(v => ({ title: v.title, views: v.views, publishedAt: v.publishedAt })))}`

    // Request 1 — flat trend list
    console.log('[trends] step 3a: claude trend list')
    const msg1 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: [{ type: 'text', text: TRENDS_SYSTEM_PROMPT_1, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataCtx }],
    })
    console.log('[trends] msg1 cache input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg1.usage.cache_creation_input_tokens ?? 0)
    const text1 = (msg1.content[0] as { text: string }).text

    interface TrendList {
      trends: Array<{ topic: string; urgency: string; reason: string }>
    }
    const trendList = parseClaudeJson<TrendList>(text1, 'claude1')

    // Request 2 — video ideas per trend
    console.log('[trends] step 3b: claude video ideas')
    const trendNames = (trendList.trends ?? []).slice(0, 4).map(t => t.topic)
    const msg2 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: [{ type: 'text', text: TRENDS_SYSTEM_PROMPT_2, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Ниша: "${topic}". Тренды: ${JSON.stringify(trendNames)}\n\nДля каждого тренда — 3 идеи для видео.` }],
    })
    console.log('[trends] msg2 cache input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg2.usage.cache_creation_input_tokens ?? 0)
    const text2 = (msg2.content[0] as { text: string }).text

    interface VideoIdeas {
      video_ideas: Array<{ trend: string; ideas: string[] }>
    }
    const ideasRes = parseClaudeJson<VideoIdeas>(text2, 'claude2')

    // ── Merge into final shape ────────────────────────────────────────────────

    const ideasMap = new Map<string, string[]>()
    for (const vi of (ideasRes.video_ideas ?? [])) {
      ideasMap.set(vi.trend, vi.ideas ?? [])
    }

    const analysis = {
      trends: (trendList.trends ?? []).map((t, i) => ({
        topic: t.topic,
        urgency: t.urgency,
        reason: t.reason,
        video_ideas: ideasMap.get(t.topic) ?? [],
        example_videos: videosData.slice(i * 3, i * 3 + 3).map(v => ({
          title: v.title,
          views: v.views,
          url: v.url,
        })),
      })),
    }

    console.log('[trends] analysis merged ok, trends count:', analysis.trends.length)

    await spendCredits(user.id, 5, 'trends')

    try {
      await svc.from('analytics_cache').upsert({
        cache_type: 'trends',
        cache_key: key,
        result: analysis,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[trends] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    // Save to reports history (non-fatal)
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'trends')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'trends',
        title: `Тренды: ${topic} (${days} дн.)`,
        query: `${topic}|${period}`,
        result: analysis,
      })
    } catch (e) {
      console.warn('[trends] report save failed:', e instanceof Error ? e.message : String(e))
    }

    // Cleanup stale cache (non-fatal)
    try {
      await svc.from('analytics_cache')
        .delete()
        .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[trends] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/trends] fatal error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа трендов: ${msg}` }, { status: 500 })
  }
}
