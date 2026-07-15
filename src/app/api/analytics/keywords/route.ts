import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { YouTubeQuotaError, checkYouTubeQuota, quotaExceededResponse, byokQuotaResponse } from '@/lib/youtube-quota'
import { resolveAnalyticsContext } from '@/lib/analytics-gate'
import { isBillingError, notifyBillingError } from '@/lib/telegram'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function getKeywordsPrompt1(lang: string, keyword: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube SEO аналитик, специализирующийся на оценке ключевых слов. Тема: "${keyword}" (контекст: YouTube видео).

ФИЛЬТРАЦИЯ: Сначала отсей нерелевантные запросы. Если тема "${keyword}" — например "автомобили" или "cars" — исключи запросы про волосы, похудение, API, программирование, еду и прочие темы не связанные с исходной. Оставь только те ключевые слова, которые реально могут быть темой YouTube видео по запросу "${keyword}".

МЕТОДОЛОГИЯ ОЦЕНКИ (только для релевантных):
• difficulty (1-10) — сложность ранжирования: 1-3 = низкая, 4-6 = средняя, 7-10 = высокая
  Учитывай: video_count (больше = выше difficulty), avg_views (больше = выше difficulty)
• potential (1-10) — потенциал трафика: 1-3 = мало просмотров, 7-10 = много просмотров у топ видео
• competition — "Низкая" / "Средняя" / "Высокая"
• recommendation — конкретный совет: "Стоит снять" / "Сложно, но возможно" / "Слишком высокая конкуренция" + причина

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"keywords":[{"keyword":"авто зимой","difficulty":6,"potential":8,"competition":"Средняя","recommendation":"Стоит снять — хороший баланс просмотров и конкуренции"},{"keyword":"купить электромобиль","difficulty":8,"potential":9,"competition":"Высокая","recommendation":"Сложно — нужен сильный канал с хорошей историей просмотров"}]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube SEO analyst specializing in keyword evaluation. Topic: "${keyword}" (context: YouTube videos).

FILTERING: First remove irrelevant queries. If the topic is "${keyword}" — e.g. "cars" — exclude queries about hair, weight loss, APIs, programming, food, or any subject unrelated to the original topic. Keep only keywords that could realistically be a YouTube video about "${keyword}".

EVALUATION METHODOLOGY (relevant keywords only):
• difficulty (1-10) — ranking difficulty: 1-3 = low, 4-6 = medium, 7-10 = high
  Consider: video_count (more = higher difficulty), avg_views (more = higher difficulty)
• potential (1-10) — traffic potential: 1-3 = few views, 7-10 = high views on top videos
• competition — "Low" / "Medium" / "High"
• recommendation — specific advice: "Worth filming" / "Possible but tough" / "Competition too high" + reason

RESPONSE FORMAT — strict JSON without markdown:
{"keywords":[{"keyword":"car review 2026","difficulty":5,"potential":7,"competition":"Medium","recommendation":"Worth filming — good balance of views and competition"},{"keyword":"best electric car","difficulty":8,"potential":9,"competition":"High","recommendation":"Tough — requires an established channel with strong watch history"}]}

IMPORTANT: Return ONLY valid JSON. All text values must be in English. No \`\`\`json. No explanations. Start with { end with }.`
}

function getKeywordsPrompt2(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube SEO стратег, помогающий контент-мейкерам выбирать лучшие ключевые слова. На основе списка ключевых слов выбери наиболее перспективные и дай итоговый анализ ниши.

МЕТОДОЛОГИЯ ОТБОРА:
• best_keywords — 3-5 лучших ключевых слов: высокий потенциал + низкая/средняя сложность
• low_competition — 3-5 ключевых слов с минимальной конкуренцией (отлично для новых каналов)
• insights — краткий вывод по нише (2-3 конкретных предложения с рекомендациями)

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"best_keywords":["купить авто 2026","тест-драйв новинки","лучший автомобиль до миллиона"],"low_competition":["авто для семьи советы","как выбрать первый автомобиль"],"insights":"Ниша автомобилей очень конкурентна в топовых запросах, но есть возможности в длинных ключах. Начинайте с запросов о конкретных моделях и сравнениях — там конкуренция ниже а интент покупки выше. Делайте акцент на запросы с годом (2026) — они свежее и менее насыщены контентом."}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube SEO strategist helping content creators choose the best keywords. Based on the keyword list, select the most promising ones and provide a final niche analysis.

SELECTION METHODOLOGY:
• best_keywords — 3-5 best keywords: high potential + low/medium difficulty
• low_competition — 3-5 keywords with minimal competition (great for new channels)
• insights — brief niche analysis (2-3 specific sentences with recommendations)

RESPONSE FORMAT — strict JSON without markdown:
{"best_keywords":["buy car 2026","new model test drive","best car under 30000"],"low_competition":["family car advice","how to choose your first car"],"insights":"The auto niche is highly competitive for broad queries, but there are opportunities in long-tail keywords. Start with specific model reviews and comparisons — competition is lower there and purchase intent is higher. Focus on queries with the current year (2026) — they are fresher and less saturated with content."}

IMPORTANT: Return ONLY valid JSON. All text values must be in English. No \`\`\`json. No explanations. Start with { end with }.`
}


// YouTube Autocomplete (free, no API key needed)
async function getAutocompleteSuggestions(query: string, lang: string): Promise<string[]> {
  const url = new URL('https://suggestqueries.google.com/complete/search')
  url.searchParams.set('client', 'youtube')
  url.searchParams.set('ds', 'yt')
  url.searchParams.set('q', query)
  url.searchParams.set('hl', lang)
  url.searchParams.set('callback', 'cb')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const text = await res.text()
    // Response is JSONP: cb(["query",[["suggestion1",0],["suggestion2",0],...]])
    const match = text.match(/cb\((.+)\)$/)
    if (!match) return []
    const parsed = JSON.parse(match[1]) as [string, Array<[string, number]>]
    return (parsed[1] ?? []).map(item => item[0]).slice(0, 8)
  } catch {
    return []
  }
}

interface YtSearchResponse {
  items?: Array<{
    id: { videoId?: string }
    snippet: { title: string }
  }>
}

interface YtVideoListResponse {
  items?: Array<{
    id: string
    statistics: { viewCount?: string }
  }>
}

// Get avg views for top-5 videos on a query
async function getQueryStats(
  query: string, contentLang: string, country: string,
  apiKey: string, fallbackKey: string | null
): Promise<{ avg_views: number; video_count: number }> {
  async function fetchStats(key: string): Promise<{ avg_views: number; video_count: number }> {
    const regionCode = country === 'worldwide' ? undefined : country
    const searchUrl = new URL(`${YT_BASE}/search`)
    searchUrl.searchParams.set('part', 'snippet')
    searchUrl.searchParams.set('type', 'video')
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('maxResults', '5')
    searchUrl.searchParams.set('key', key)
    searchUrl.searchParams.set('relevanceLanguage', contentLang)
    if (regionCode) searchUrl.searchParams.set('regionCode', regionCode)

    const searchRes = await fetch(searchUrl.toString())
    if (!searchRes.ok) {
      checkYouTubeQuota(searchRes.status, await searchRes.text())
      return { avg_views: 0, video_count: 0 }
    }
    const searchData = await searchRes.json() as YtSearchResponse & { pageInfo?: { totalResults?: number } }

    const videoIds = (searchData.items ?? [])
      .map(i => i.id.videoId)
      .filter((id): id is string => !!id)

    const videoCount = (searchData as { pageInfo?: { totalResults?: number } }).pageInfo?.totalResults ?? 0

    if (videoIds.length === 0) return { avg_views: 0, video_count: videoCount }

    const statsUrl = new URL(`${YT_BASE}/videos`)
    statsUrl.searchParams.set('part', 'statistics')
    statsUrl.searchParams.set('id', videoIds.join(','))
    statsUrl.searchParams.set('key', key)

    const statsRes = await fetch(statsUrl.toString())
    if (!statsRes.ok) {
      checkYouTubeQuota(statsRes.status, await statsRes.text())
      return { avg_views: 0, video_count: videoCount }
    }
    const statsData = await statsRes.json() as YtVideoListResponse

    const views = (statsData.items ?? [])
      .map(v => Number(v.statistics.viewCount ?? 0))
      .filter(v => v > 0)

    const avg_views = views.length > 0
      ? Math.round(views.reduce((a, b) => a + b, 0) / views.length)
      : 0

    return { avg_views, video_count: videoCount }
  }

  try {
    return await fetchStats(apiKey)
  } catch (e) {
    if (e instanceof YouTubeQuotaError && fallbackKey) return fetchStats(fallbackKey)
    if (e instanceof YouTubeQuotaError) throw e
    return { avg_views: 0, video_count: 0 }
  }
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `${Math.round(n / 1_000)}К`
  return String(n)
}

function cacheKey(keyword: string, contentLang: string, country: string): string {
  return `${keyword.toLowerCase().trim()}|${contentLang}|${country}|v1`
}

export async function POST(req: NextRequest) {
  let lang = 'ru'
  let userHasKey = false
  let plan = 'free'
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { keyword?: string; content_lang?: string; ui_lang?: string; lang?: string; country?: string }
    const keyword = body.keyword?.trim() ?? ''
    const contentLang = body.content_lang ?? body.lang ?? 'ru'
    const uiLang = body.ui_lang ?? body.lang ?? 'ru'
    lang = uiLang
    const country = body.country ?? 'RU'

    if (!keyword) return NextResponse.json({ ok: false, error: 'Введите ключевое слово' }, { status: 400 })

    const svc = createServiceClient()
    const ctx = await resolveAnalyticsContext(user.id, svc, lang)
    const { gateRes, apiKey, fallbackKey, cost } = ctx
    userHasKey = ctx.userHasKey
    plan = ctx.plan
    if (gateRes) return gateRes

    const key = cacheKey(keyword, contentLang, country)

    // Cache check — non-fatal
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'keywords')
        .eq('cache_key', key)
        .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        .maybeSingle()
      if (cached) {
        console.log('[keywords] cache hit, saving report for user:', user.id)
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'keywords')
            .eq('query', keyword)
            .gte('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
            .maybeSingle()
          if (!existing) {
            const { data: old } = await svc
              .from('analytics_reports')
              .select('id')
              .eq('user_id', user.id)
              .eq('report_type', 'keywords')
              .order('created_at', { ascending: true })
            if ((old?.length ?? 0) >= 20) {
              await svc.from('analytics_reports').delete().eq('id', old![0].id)
            }
            await svc.from('analytics_reports').insert({
              user_id: user.id,
              report_type: 'keywords',
              title: `Ключевые слова: ${keyword}`,
              query: keyword,
              result: cached.result,
            })
          } else {
            console.log('[keywords] cache-hit: report already saved, skip')
          }
        } catch (saveEx) {
          console.warn('[keywords] cache-hit report save failed:', saveEx instanceof Error ? saveEx.message : String(saveEx))
        }
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[keywords] cache check skipped:', e instanceof Error ? e.message : String(e))
    }

    const actualCost = cost(CREDIT_COSTS.keywords_analysis)
    const check = await requireCreditsAmount(user.id, actualCost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // Collect autocomplete suggestions from multiple seed queries
    const seeds = [
      keyword,
      `${keyword} 2026`,
      `best ${keyword}`,
      `${keyword} review`,
      `${keyword} vs`,
      `how to ${keyword}`,
    ]

    console.log(`[keywords] fetching suggestions for: ${keyword} (content: ${contentLang}, ui: ${uiLang}, country: ${country})`)

    const suggestionsArrays = await Promise.all(
      seeds.map(seed => getAutocompleteSuggestions(seed, contentLang))
    )

    // Deduplicate and add the keyword itself
    const seen = new Set<string>()
    const allSuggestions: string[] = [keyword]
    seen.add(keyword.toLowerCase())

    for (const arr of suggestionsArrays) {
      for (const s of arr) {
        const key = s.toLowerCase().trim()
        if (!seen.has(key) && s.trim()) {
          seen.add(key)
          allSuggestions.push(s.trim())
        }
      }
    }

    // Limit to 20 unique suggestions to avoid too many API calls
    const suggestions = allSuggestions.slice(0, 20)
    console.log(`[keywords] collected ${suggestions.length} suggestions`)

    // Fetch stats for each suggestion in parallel (batches to avoid rate limits)
    const batchSize = 5
    const statsMap = new Map<string, { avg_views: number; video_count: number }>()

    for (let i = 0; i < suggestions.length; i += batchSize) {
      const batch = suggestions.slice(i, i + batchSize)
      const results = await Promise.all(batch.map(s => getQueryStats(s, contentLang, country, apiKey, fallbackKey)))
      batch.forEach((s, j) => statsMap.set(s, results[j]))
    }

    // Filter out truly dead keywords (zero views AND zero competition)
    const strictFiltered = suggestions.filter(s => {
      const stats = statsMap.get(s) ?? { avg_views: 0, video_count: 0 }
      return !(stats.avg_views === 0 && stats.video_count === 0)
    })
    // Fall back to unfiltered if too few results remain
    const filteredSuggestions = strictFiltered.length >= 5 ? strictFiltered : suggestions
    console.log(`[keywords] after filter: ${filteredSuggestions.length}/${suggestions.length} (strict: ${strictFiltered.length})`)

    // Build input strings for Claude
    const keywordsData = filteredSuggestions.map(s => {
      const stats = statsMap.get(s) ?? { avg_views: 0, video_count: 0 }
      return `- "${s}": avg_views=${fmtViews(stats.avg_views)}, video_count=${stats.video_count}`
    }).join('\n')

    const keywordsList = filteredSuggestions.map(s => `- "${s}"`).join('\n')

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const [msg1, msg2] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: [{ type: 'text', text: getKeywordsPrompt1(uiLang, keyword), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Ниша: "${keyword}"\nДанные (avg_views — среднее топ-5 видео, video_count — конкуренция):\n${keywordsData}` }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        system: [{ type: 'text', text: getKeywordsPrompt2(uiLang), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Ниша: "${keyword}"\nКлючевые слова:\n${keywordsList}` }],
      }),
    ])

    const text1 = (msg1.content[0] as { text: string }).text
    const text2 = (msg2.content[0] as { text: string }).text
    console.log('[keywords] claude1 raw:', text1.substring(0, 300))
    console.log('[keywords] claude2 raw:', text2.substring(0, 300))
    console.log('[keywords] msg1 cache input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg1.usage.cache_creation_input_tokens ?? 0)
    console.log('[keywords] msg2 cache input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg2.usage.cache_creation_input_tokens ?? 0)
    if (msg1.stop_reason === 'max_tokens') console.warn('[keywords] claude1 truncated by max_tokens')
    if (msg2.stop_reason === 'max_tokens') console.warn('[keywords] claude2 truncated by max_tokens')

    interface ScoredKeywords {
      keywords: Array<{
        keyword: string
        difficulty: number
        potential: number
        competition: string
        recommendation: string
      }>
    }
    interface KeywordsInsights {
      best_keywords:   string[]
      low_competition: string[]
      insights:        string
    }

    const scored   = parseClaudeJson<ScoredKeywords>(text1, 'claude1')
    const insights = parseClaudeJson<KeywordsInsights>(text2, 'claude2')

    // Merge: scored keywords + real stats from statsMap
    const enrichedKeywords = (scored.keywords ?? []).map(kw => {
      const real = statsMap.get(kw.keyword) ?? { avg_views: 0, video_count: 0 }
      return {
        ...kw,
        avg_views:   real.avg_views,
        video_count: real.video_count,
      }
    })

    const easy   = enrichedKeywords.filter(k => k.difficulty <= 4).length
    const medium = enrichedKeywords.filter(k => k.difficulty >= 5 && k.difficulty <= 7).length
    const hard   = enrichedKeywords.filter(k => k.difficulty >= 8).length

    const result = {
      keyword,
      lang: contentLang,
      total: enrichedKeywords.length,
      easy,
      medium,
      hard,
      keywords:        enrichedKeywords,
      best_keywords:   insights.best_keywords   ?? [],
      low_competition: insights.low_competition ?? [],
      insights:        insights.insights        ?? '',
    }

    await spendCredits(user.id, actualCost, 'keywords_analysis')

    try {
      await svc.from('analytics_cache').upsert({
        cache_type: 'keywords',
        cache_key: key,
        result,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[keywords] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    // Save to analytics_reports (non-fatal, 20-limit)
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'keywords')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'keywords',
        title: `Ключевые слова: ${keyword}`,
        query: keyword,
        result,
      })
      console.log('[keywords] report saved')
    } catch (e) {
      console.warn('[keywords] report save failed:', e instanceof Error ? e.message : String(e))
    }

    // Cleanup stale cache (non-fatal)
    try {
      await svc.from('analytics_cache')
        .delete()
        .lt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[keywords] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result, cached: false })
  } catch (error) {
    if (error instanceof YouTubeQuotaError) return (userHasKey && plan === 'free') ? byokQuotaResponse(lang) : quotaExceededResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/keywords] error:', msg)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/analytics/keywords').catch(() => {})
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}
