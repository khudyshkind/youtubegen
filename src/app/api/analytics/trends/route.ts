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

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'


async function ytFetch(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  console.log(`[trends] yt ${path} status=${res.status} body=${text.slice(0, 300)}`)
  if (!res.ok) {
    checkYouTubeQuota(res.status, text)
    throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

function getTrendsPrompt1(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик, специализирующийся на выявлении трендов и вирусных тем. На основе данных о топ видео за указанный период найди 4 ключевых тренда в нише.

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
{"trends":[{"topic":"Электромобили в России","urgency":"Срочно","reason":"3 видео из топ-5 набрали >1М просмотров за последние 2 недели"},{"topic":"Тема 2","urgency":"Актуально","reason":"причина"},{"topic":"Тема 3","urgency":"Набирает","reason":"причина"},{"topic":"Тема 4","urgency":"Стабильно","reason":"причина"}]}

ТРЕБОВАНИЯ: ровно 4 тренда | topic — конкретная тема, не абстракция | reason — конкретная причина на основе данных видео
Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких \`\`\`json. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube trend analyst. Based on top video data for the specified period, identify 4 key trends in the niche.

TREND METHODOLOGY:
• Trend = topic or format gaining views faster than usual
• Analyze: video titles, view counts, publication dates
• Videos with high views and recent dates = strong trend signal
• Look for repeating topics and patterns in top video titles

URGENCY LEVELS:
• "Urgent" — trend is at peak right now, film immediately
• "Active" — trend has been active for 1-2 weeks
• "Rising" — trend just starting, good time to enter
• "Evergreen" — evergreen topic with stable audience interest

RESPONSE FORMAT — strict JSON without markdown:
{"trends":[{"topic":"Electric Vehicles Comparison 2026","urgency":"Urgent","reason":"3 of top 5 videos got >1M views in the last 2 weeks"},{"topic":"Topic 2","urgency":"Active","reason":"reason"},{"topic":"Topic 3","urgency":"Rising","reason":"reason"},{"topic":"Topic 4","urgency":"Evergreen","reason":"reason"}]}

REQUIREMENTS: exactly 4 trends | topic = specific, not abstract | reason = specific evidence from video data
Return ONLY valid JSON. All text values must be in English. No \`\`\`json. Start with { end with }.`
}

function getTrendsPrompt2(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик и контент-стратег. На основе списка трендов в нише сгенерируй конкретные идеи видео, которые можно снять прямо сейчас.

МЕТОДОЛОГИЯ ГЕНЕРАЦИИ ИДЕЙ:
• Для каждого тренда предложи 3 разные идеи видео
• Идеи должны быть конкретными — не "обзор темы", а "5 причин почему X лучше Y в 2026"
• Варьируй форматы: топ, разбор, сравнение, история, how-to, реакция
• Учитывай что зрители уже знают о тренде — дай им новый угол зрения
• Заголовки должны быть кликабельными и конкретными

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"video_ideas":[{"trend":"Электромобили в России","ideas":["5 причин купить электромобиль в 2026 — даже при нашей инфраструктуре","Зарядил электромобиль на трассе М4 — честный опыт","Tesla vs отечественные EV: что реально выгоднее?"]}]}

ТРЕБОВАНИЯ: video_ideas — один объект на каждый тренд | 3 идеи на тренд
Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких \`\`\`json. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube analyst and content strategist. Based on niche trends, generate specific video ideas you can film right now.

VIDEO IDEA METHODOLOGY:
• Propose 3 different video ideas per trend
• Ideas must be specific — not "topic overview" but "5 reasons why X beats Y in 2026"
• Vary formats: top list, breakdown, comparison, story, how-to, reaction
• Assume viewers already know the trend — give them a fresh angle
• Titles must be clickable and specific

RESPONSE FORMAT — strict JSON without markdown:
{"video_ideas":[{"trend":"Electric Vehicles 2026","ideas":["5 Reasons to Buy an EV in 2026 — Even With Today's Infrastructure","I Charged My EV on a Road Trip — Honest Experience","Tesla vs Budget EVs: Which Is Actually Worth It?"]}]}

REQUIREMENTS: one object per trend | 3 ideas per trend
Return ONLY valid JSON. All text values must be in English. No \`\`\`json. Start with { end with }.`
}

function cacheKey(topic: string, period: string, country: string, contentLang: string) {
  const day = new Date().toISOString().slice(0, 10)
  return `${topic.toLowerCase().trim()}|${period}|${country}|${contentLang}|${day}|v2`
}

export async function POST(req: NextRequest) {
  let lang = 'ru'
  let userHasKey = false
  let plan = 'free'
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { topic?: string; period?: string; lang?: string; ui_lang?: string; country?: string; content_lang?: string }
    const topic = body.topic?.trim() ?? ''
    const period = body.period ?? 'week'
    lang = body.ui_lang ?? body.lang ?? 'ru'
    const country = body.country ?? 'RU'
    const contentLang = body.content_lang ?? body.lang ?? 'ru'

    console.log(`[trends] start topic="${topic}" period=${period} lang=${lang} country=${country} contentLang=${contentLang}`)
    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const svc = createServiceClient()
    const ctx = await resolveAnalyticsContext(user.id, svc, lang)
    const { gateRes, apiKey, fallbackKey, cost } = ctx
    userHasKey = ctx.userHasKey
    plan = ctx.plan
    if (gateRes) return gateRes

    // ytFetch with per-key fallback for paid BYOK users
    async function ytf(path: string, params: Record<string, string>): Promise<unknown> {
      try { return await ytFetch(path, params, apiKey) }
      catch (e) { if (e instanceof YouTubeQuotaError && fallbackKey) return ytFetch(path, params, fallbackKey); throw e }
    }

    const key = cacheKey(topic, period, country, contentLang)

    // Cache check — non-fatal
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'trends')
        .eq('cache_key', key)
        .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        .maybeSingle()
      if (cached) {
        console.log('[trends] cache hit, saving report for user:', user.id)
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'trends')
            .eq('query', `${topic}|${period}`)
            .gte('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
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

    const actualCost = cost(CREDIT_COSTS.trends)
    const check = await requireCreditsAmount(user.id, actualCost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const days = period === 'month' ? 30 : 7
    const publishedAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const regionCode = country === 'worldwide' ? undefined : country

    // ── YouTube data ──────────────────────────────────────────────────────────

    console.log(`[trends] step 1: search trending videos | regionCode=${regionCode ?? 'omitted'} relevanceLanguage=${contentLang}`)
    const videoSearchParams: Record<string, string> = {
      part: 'snippet', type: 'video', q: topic,
      order: 'viewCount', publishedAfter,
      maxResults: '20', relevanceLanguage: contentLang,
    }
    if (regionCode) videoSearchParams.regionCode = regionCode
    const videoSearch = await ytf('/search', videoSearchParams) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string } }> }

    const videoItems = videoSearch.items ?? []
    console.log(`[trends] videos count: ${videoItems.length}`)
    const videoIds = videoItems.map(v => v.id.videoId).filter(Boolean).join(',')

    let videosData: Array<{ title: string; views: number; channel: string; url: string; publishedAt: string }> = []
    if (videoIds) {
      console.log('[trends] step 2: video stats')
      const vStats = await ytf('/videos', {
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
      max_tokens: 1000,
      system: [{ type: 'text', text: getTrendsPrompt1(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataCtx }],
    })
    console.log('[trends] msg1 cache input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg1.usage.cache_creation_input_tokens ?? 0)
    if (msg1.stop_reason === 'max_tokens') console.warn('[trends] claude1 truncated by max_tokens')
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
      max_tokens: 900,
      system: [{ type: 'text', text: getTrendsPrompt2(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Ниша: "${topic}". Тренды: ${JSON.stringify(trendNames)}\n\nДля каждого тренда — 3 идеи для видео.` }],
    })
    console.log('[trends] msg2 cache input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg2.usage.cache_creation_input_tokens ?? 0)
    if (msg2.stop_reason === 'max_tokens') console.warn('[trends] claude2 truncated by max_tokens')
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

    await spendCredits(user.id, actualCost, 'trends')

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
        .lt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[trends] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    if (error instanceof YouTubeQuotaError) return (userHasKey && plan === 'free') ? byokQuotaResponse(lang) : quotaExceededResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/trends] fatal error:', msg)
    if (isYouTubeKeyError(msg)) return youTubeKeyErrorResponse(lang)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/analytics/trends').catch(() => {})
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}
